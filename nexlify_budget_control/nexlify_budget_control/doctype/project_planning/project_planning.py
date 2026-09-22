# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProjectPlanning(Document):
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

		scope_rows = frappe.get_all(
			"Project Equipment Scope",
			filters={"cost_budget": cost_budget, "docstatus": 1},
			fields=["name", "equipment", "quantity", "total_days"],
		)

		for scope in scope_rows:
			used_quantity = frappe.db.sql(
				"""
				select coalesce(sum(sp.quantity), 0)
				from `tabProject Visit Sub Period` sp
				inner join `tabProject Visits` v on v.name = sp.parent
				where v.project_planning = %s and sp.equipment = %s
				""",
				(self.name, scope.equipment),
			)[0][0]
			if flt(used_quantity) > flt(scope.quantity):
				frappe.throw(
					_(
						"Equipment '{0}' is over-distributed across visits: {1} used, "
						"but only {2} available in the Estimation."
					).format(scope.equipment, used_quantity, scope.quantity)
				)

			role_totals = frappe.get_all(
				"Project Equipment Scope Role",
				filters={"parent": scope.name, "parenttype": "Project Equipment Scope"},
				fields=["trade", "count"],
			)
			for role in role_totals:
				required_days = flt(role.count) * flt(scope.total_days)
				used_days = frappe.db.sql(
					"""
					select coalesce(sum(spr.count * sp.working_days), 0)
					from `tabProject Equipment Scope Role` spr
					inner join `tabProject Visit Sub Period` sp on sp.name = spr.parent
					inner join `tabProject Visits` v on v.name = sp.parent
					where v.project_planning = %s and sp.equipment = %s and spr.trade = %s
					""",
					(self.name, scope.equipment, role.trade),
				)[0][0]
				if flt(used_days) > required_days:
					frappe.throw(
						_(
							"Trade '{0}' for equipment '{1}' is over-distributed: {2} "
							"person-days used, but only {3} available in the Estimation."
						).format(role.trade, scope.equipment, used_days, required_days)
					)

	def _has_bypass_role(self):
		bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
		if not bypass_role:
			return False
		return bypass_role in frappe.get_roles(frappe.session.user)
