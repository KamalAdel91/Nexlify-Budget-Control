# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from nexlify_budget_control.nexlify_budget_control.hand_off import record as record_hand_off
from frappe import _
from frappe.model.document import Document


class ProjectOverview(Document):
	def validate(self):
		self.sync_from_project()
		self.set_financials()
		self.stamp_workflow_tracking()

	def sync_from_project(self):
		if not self.project:
			return
		cost_budget, revenue_budget, contract_value = frappe.db.get_value(
			"Project", self.project, ["custom_budget_cost", "custom_project_planning", "custom_planned_revenue"]
		)
		if revenue_budget:
			cost_budget = frappe.db.get_value("Project Planning", revenue_budget, "estimation") or cost_budget
		self.cost_budget = cost_budget
		self.revenue_budget = revenue_budget

	def set_financials(self):
		"""Stored copy of the numbers the Overview summary shows (frozen once approved)."""
		from frappe.utils import flt
		revenue = flt(self.contract_value)
		cost = 0
		if self.cost_budget and frappe.db.get_value("Project Estimation", self.cost_budget, "docstatus") == 1:
			cost = flt(frappe.db.get_value("Project Estimation", self.cost_budget, "total_cost"))
		self.planned_cost = cost
		self.expected_profit = revenue - cost
		self.margin_pct = flt(self.expected_profit / revenue * 100, 2) if revenue else 0

	def _pending_states(self):
		"""Every draft state after the first one in the active Workflow, so edits from the UI keep working."""
		from frappe.model.workflow import get_workflow_name
		name = get_workflow_name(self.doctype)
		if not name:
			return set()
		states = frappe.get_cached_doc("Workflow", name).states
		return {s.state for s in states[1:] if str(s.doc_status) == "0"}

	def stamp_workflow_tracking(self):
		now = frappe.utils.now_datetime()
		if self.docstatus == 1 and not self.approved_on:
			self.approved_on = now
		if not self.is_new() and not self.has_value_changed("workflow_state"):
			return
		self.pending_since = now if self.workflow_state in self._pending_states() else None
		if not self.is_new() and self._return_step():
			self.return_count = frappe.utils.cint(self.return_count) + 1

	def on_update(self):
		self._apply_return()
		if not self.project:
			return
		if frappe.db.get_value("Project", self.project, "custom_project_overview") != self.name:
			frappe.db.set_value("Project", self.project, "custom_project_overview", self.name)

	def before_submit(self):
		if not frappe.utils.flt(self.contract_value):
			frappe.throw(_("Cannot approve: the Contract Value is zero. Set the Planned Revenue on the project first."))
		if not self.cost_budget:
			frappe.throw(_("Cannot approve: Estimation has not been created for this project yet."))
		if not self.revenue_budget:
			frappe.throw(_("Cannot approve: Plan has not been created for this project yet."))

		cost_status = frappe.db.get_value("Project Estimation", self.cost_budget, "docstatus")
		plan_status = frappe.db.get_value("Project Planning", self.revenue_budget, "docstatus")

		if cost_status != 1:
			frappe.throw(_("Cannot approve: Estimation has not been submitted yet."))
		if plan_status != 1 and frappe.db.get_value("Project Planning", self.revenue_budget, "status") != "Pending Approval":
			frappe.throw(_("Cannot approve: the Plan has not been sent for approval."))

	def on_submit(self):
		self._submit_plan()
		if self.project:
			frappe.db.set_value("Project", self.project, "is_active", "Yes")

	def on_cancel(self):
		if self.project:
			frappe.db.set_value("Project", self.project, "is_active", "No")

	def _return_step(self):
		before = self.get_doc_before_save()
		if not before or not self.has_value_changed("workflow_state"):
			return None
		step = (before.workflow_state, self.workflow_state)
		if step == ("Pending COO Approval", "In Planning"):
			return "planning"
		if step == ("Pending CEO Approval", "Pending COO Approval"):
			return "coo"
		return None

	def before_save(self):
		if self._return_step() and not (self.return_reason or "").strip():
			frappe.throw(_("Enter the reason for returning it."))

	def _apply_return(self):
		step = self._return_step()
		if not step:
			return
		who = frappe.utils.get_fullname(frappe.session.user)
		reason = frappe.utils.escape_html(self.return_reason)
		if step == "planning":
			msg = _("Returned to Planning by {0}: {1}").format(who, reason)
			plan = self.revenue_budget
			if plan and frappe.db.get_value("Project Planning", plan, "docstatus") == 0:
				frappe.db.set_value("Project Planning", plan, {"status": "Draft", "rejection_reason": self.return_reason})
				record_hand_off("Project Planning", plan)
				frappe.get_doc("Project Planning", plan).add_comment("Comment", msg)
		else:
			msg = _("Returned to the COO by {0}: {1}").format(who, reason)
		self.add_comment("Comment", msg)

	def _submit_plan(self):
		"""The final approval submits the plan (checks already ran when it was sent for approval)."""
		if not self.revenue_budget:
			return
		plan = frappe.get_doc("Project Planning", self.revenue_budget)
		if plan.docstatus != 0:
			return
		plan.status = "Approved"
		plan.flags.ignore_permissions = True
		plan.flags.approved_from_overview = True
		plan.submit()
		plan.add_comment("Info", _("Approved in Project Overview {0}.").format(self.name))


@frappe.whitelist()
def set_return_reason(name, reason):
	"""Saves the reason before a Return action (apply_workflow reloads the doc from the database)."""
	frappe.has_permission("Project Overview", "write", doc=name, throw=True)
	if frappe.db.get_value("Project Overview", name, "docstatus") != 0:
		frappe.throw(_("The Project Overview is already approved."))
	reason = (reason or "").strip()
	if not reason:
		frappe.throw(_("Enter the reason for returning it."))
	frappe.db.set_value("Project Overview", name, "return_reason", reason, update_modified=False)
