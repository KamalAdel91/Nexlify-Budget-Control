# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class ProjectOverview(Document):
	def validate(self):
		self.sync_from_project()
		contract = frappe.db.get_value("Project", self.project, "custom_planned_revenue") if self.project else self.contract_value
		self.update(deal_numbers(contract, self.cost_budget))

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

		cost_status = frappe.db.get_value("Project Cost Budget", self.cost_budget, "docstatus")
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


def deal_numbers(contract, cost_budget):
	"""Cost, price, profit and the contract against the Estimation price (stored on the Overview)."""
	flt = frappe.utils.flt
	cost, price = (frappe.db.get_value("Project Cost Budget", cost_budget, ["total_cost", "total_price"]) or (0, 0)) if cost_budget else (0, 0)
	contract, cost, price = flt(contract), flt(cost), flt(price)
	profit = contract - cost
	return {
		"estimated_cost": cost,
		"estimation_price": price,
		"expected_profit": flt(profit, 2),
		"profit_percentage": flt(profit / contract * 100, 2) if contract else 0,
		"contract_vs_price": flt((contract / price - 1) * 100, 2) if price else 0,
	}


def store_deal_numbers(overview):
	ov = frappe.db.get_value("Project Overview", overview, ["contract_value", "cost_budget"], as_dict=True)
	if ov:
		frappe.db.set_value("Project Overview", overview, deal_numbers(ov.contract_value, ov.cost_budget), update_modified=False)
