# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProjectPlanning(Document):
	def after_insert(self):
		if self.amended_from:
			from nexlify_budget_control.nexlify_budget_control.budget_enforcement import carry_over_amended_planning
			carry_over_amended_planning(self.amended_from, self.name)

	def before_submit(self):
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
		if self._has_bypass_role():
			return

		cost_budget = frappe.db.get_value("Project", self.project, "custom_budget_cost")
		if not cost_budget:
			return

		def _n(x):
			return "%g" % round(flt(x), 2)

		scope_rows = frappe.get_all(
			"Project Equipment Scope",
			filters={"cost_budget": cost_budget, "docstatus": 1},
			fields=["name", "equipment", "quantity", "total_days"],
		)

		issues = []
		for scope in scope_rows:
			estimated = flt(scope.quantity)
			planned = flt(frappe.db.sql(
				"""
				select coalesce(sum(quantity), 0)
				from `tabProject Visit Day`
				where project_planning = %s and equipment = %s and docstatus < 2
				""",
				(self.name, scope.equipment),
			)[0][0])
			if planned > estimated:
				issues.append(_("{0}: {1} planned, but only {2} in the Estimation (over by {3}).").format(
					scope.equipment, _n(planned), _n(estimated), _n(planned - estimated)))
			elif planned < estimated:
				issues.append(_("{0}: only {1} of {2} planned ({3} not planned yet).").format(
					scope.equipment, _n(planned), _n(estimated), _n(estimated - planned)))

			roles = frappe.get_all(
				"Project Equipment Scope Role",
				filters={"parent": scope.name, "parenttype": "Project Equipment Scope"},
				fields=["trade", "count"],
			)
			for role in roles:
				allowed_days = flt(role.count) * flt(scope.total_days)
				used_days = flt(frappe.db.sql(
					"""
					select coalesce(sum(r.count), 0)
					from `tabProject Equipment Scope Role` r
					inner join `tabProject Visit Day` d on d.name = r.parent and r.parenttype = 'Project Visit Day'
					where d.project_planning = %s and d.equipment = %s
					and r.trade = %s and d.docstatus < 2
					""",
					(self.name, scope.equipment, role.trade),
				)[0][0])
				if used_days > allowed_days:
					issues.append(_("{0} on {1}: {2} person-days planned, but only {3} in the Estimation.").format(
						role.trade, scope.equipment, _n(used_days), _n(allowed_days)))

		if issues:
			frappe.throw(
				"<br>".join("&bull; " + i for i in issues),
				title=_("Plan does not match the Estimation"),
			)

	def _has_bypass_role(self):
		bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
		if not bypass_role:
			return False
		return bypass_role in frappe.get_roles(frappe.session.user)
