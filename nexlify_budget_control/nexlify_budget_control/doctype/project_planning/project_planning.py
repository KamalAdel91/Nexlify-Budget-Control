# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProjectPlanning(Document):
	def on_trash(self):
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import cascade_delete_planning
		cascade_delete_planning(self)

	def after_insert(self):
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import link_project_document
		link_project_document(self.project, "custom_project_planning", self.name)
		if self.amended_from:
			from nexlify_budget_control.nexlify_budget_control.budget_enforcement import carry_over_amended_planning
			carry_over_amended_planning(self.amended_from, self.name)
		else:
			from nexlify_budget_control.nexlify_budget_control.budget_enforcement import auto_copy_planning_scope
			auto_copy_planning_scope(self.name)

	def validate(self):
		if self.docstatus == 0:
			self.estimation = _active_estimation(self.project)
		other = frappe.db.get_value(
			"Project Planning",
			{"project": self.project, "docstatus": ["<", 2], "name": ["!=", self.name or ""]},
			"name",
		)
		if other:
			frappe.throw(_("This project already has a Project Planning ({0}). Open it instead of creating a new one.").format(other))

	def before_submit(self):
		if self.flags.approved_from_overview:
			return
		self.validate_invoice_percentage_total()
		self.validate_execution_distribution()

	def validate_invoice_percentage_total(self):
		invoices = frappe.get_all(
			"Project Invoicing",
			filters={"project_planning": self.name},
			fields=["invoice_percentage"],
		)
		total = sum(flt(i.invoice_percentage) for i in invoices)
		if abs(total - 100) > 0.01:
			frappe.throw(
				_("Total Invoice Percentage across all Invoices must equal 100%. Currently: {0}%").format(total)
			)

	def validate_execution_distribution(self):
		"""Blocks Submit unless the plan follows the Estimation and is fully allocated to the visits."""
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import (
			_planning_cost_budget,
			_reconcile_planning_scope,
		)

		flt, cint, esc = frappe.utils.flt, frappe.utils.cint, frappe.utils.escape_html

		cost_budget = _planning_cost_budget(self.name)
		if not cost_budget or frappe.db.get_value("Project Cost Budget", cost_budget, "docstatus") != 1:
			frappe.throw(_("The project's Estimation must be submitted before submitting the plan."),
				title=_("Estimation not submitted"))

		if self._has_bypass_role():
			return

		_reconcile_planning_scope(self.name)

		def roles_of(parent, parenttype):
			return {r.trade: cint(r.count) for r in frappe.get_all(
				"Project Equipment Scope Role", filters={"parent": parent, "parenttype": parenttype},
				fields=["trade", "count"])}

		scope = frappe.get_all(
			"Project Planning Scope", filters={"project_planning": self.name, "docstatus": 0},
			fields=["name", "equipment", "quantity", "days_per_equipment", "estimation_scope"], order_by="creation asc")
		if not scope:
			frappe.throw(_("The Planning Scope is empty. Copy it from the Estimation first."))

		allocated = {r.planning_scope: flt(r.qty) for r in frappe.db.sql(
			"""select a.planning_scope, sum(a.quantity) as qty
			from `tabProject Visit Allocation` a
			inner join `tabProject Visits` v on v.name = a.parent and a.parenttype = 'Project Visits'
			where v.project_planning = %s group by a.planning_scope""", (self.name,), as_dict=True)}

		scope_issues, alloc_issues, visit_issues, team_issues = [], [], [], []
		for s in scope:
			est = frappe.db.get_value("Project Equipment Scope", s.estimation_scope,
				["name", "quantity", "days_per_equipment", "cost_budget", "docstatus"], as_dict=True) if s.estimation_scope else None
			if not est or est.cost_budget != cost_budget or est.docstatus != 1:
				scope_issues.append(_("{0}: not in the Estimation. Remove it from the plan.").format(s.equipment))
				continue
			if flt(s.quantity) > flt(est.quantity):
				scope_issues.append(_("{0}: quantity {1} is above the Estimation ({2}).").format(
					s.equipment, flt(s.quantity), flt(est.quantity)))
			if flt(s.days_per_equipment) > flt(est.days_per_equipment):
				scope_issues.append(_("{0}: days per equipment {1} is above the Estimation ({2}).").format(
					s.equipment, flt(s.days_per_equipment), flt(est.days_per_equipment)))
			est_roles = roles_of(est.name, "Project Equipment Scope")
			for trade, count in roles_of(s.name, "Project Planning Scope").items():
				if count > est_roles.get(trade, 0):
					scope_issues.append(_("{0}: {1} x{2} is above the Estimation ({3}).").format(
						s.equipment, trade, count, est_roles.get(trade, 0)))

			alloc = flt(allocated.get(s.name), 4)
			planned = flt(s.quantity, 4)
			if alloc > planned:
				alloc_issues.append(_("{0}: {1} allocated to the visits, but the plan has {2} (over by {3}).").format(
					s.equipment, alloc, planned, flt(alloc - planned, 4)))
			elif alloc < planned:
				alloc_issues.append(_("{0}: {1} of {2} allocated to the visits ({3} remaining).").format(
					s.equipment, alloc, planned, flt(planned - alloc, 4)))

		for v in frappe.get_all("Project Visits", filters={"project_planning": self.name},
								fields=["name", "visit_label"], order_by="creation asc"):
			label = v.visit_label or v.name
			allocs = frappe.get_all("Project Visit Allocation", filters={"parent": v.name, "parenttype": "Project Visits"},
									pluck="planning_scope")
			if not allocs:
				visit_issues.append(_("{0}: has no equipment.").format(label))
				continue
			needed = set()
			for sc in allocs:
				needed |= set(roles_of(sc, "Project Planning Scope"))
			team = {t.trade for t in frappe.get_all("Project Visit Team",
				filters={"parent": v.name, "parenttype": "Project Visits"}, fields=["trade", "headcount"]) if cint(t.headcount) > 0}
			missing = sorted(needed - team)
			if missing:
				team_issues.append(_("{0}: the Visit Team has no {1}.").format(label, ", ".join(missing)))

		sections = [
			(_("Planning Scope vs Estimation"), scope_issues),
			(_("Allocation to the visits"), alloc_issues),
			(_("Visits"), visit_issues),
			(_("Visit Teams"), team_issues),
		]
		html = "".join(
			f"<b>{title}</b><ul>{''.join(f'<li>{esc(m)}</li>' for m in msgs)}</ul>"
			for title, msgs in sections if msgs
		)
		if html:
			frappe.throw(html, title=_("The plan cannot be submitted"))

	def before_save(self):
		if self._is_being_sent_for_approval():
			if not self.project:
				frappe.throw(_("The plan has no project."))
			if not frappe.utils.flt(frappe.db.get_value("Project", self.project, "custom_planned_revenue")):
				frappe.throw(_("The project's Planned Revenue (Opportunity Amount) is zero. Set it before sending the plan for approval."))
			self.validate_invoice_percentage_total()
			self.validate_execution_distribution()

	def on_update(self):
		if self._is_being_sent_for_approval():
			from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _open_overview_for_plan
			value = frappe.utils.flt(frappe.db.get_value("Project", self.project, "custom_planned_revenue"))
			overview = _open_overview_for_plan(self, value)
			self.add_comment("Info", _("Sent for approval. Project Overview: {0}").format(overview))

	def _is_being_sent_for_approval(self):
		return (self.docstatus == 0 and not self.is_new() and self.status == "Pending Approval"
			and self.has_value_changed("status"))

	def _has_bypass_role(self):
		bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
		if not bypass_role:
			return False
		return bypass_role in frappe.get_roles(frappe.session.user)


def _active_estimation(project):
	if not project:
		return None
	return (frappe.db.get_value("Project Cost Budget", {"project": project, "docstatus": 1}, "name")
		or frappe.db.get_value("Project", project, "custom_budget_cost"))
