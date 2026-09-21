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

		visits = frappe.get_all("Project Visits", filters={"project_planning": self.name}, pluck="name")

		# --- Total Work Days ---
		total_work_days = frappe.db.get_value("Project Cost Budget", cost_budget, "total_work_days") or 0
		distributed_days = 0
		for v in visits:
			distributed_days += frappe.db.get_value("Project Visits", v, "working_days") or 0
		if total_work_days and distributed_days != total_work_days:
			frappe.throw(
				_(
					"Total Work Days distributed across visits ({0}) does not match the "
					"Estimation total ({1})."
				).format(distributed_days, total_work_days)
			)

		# --- Crew (per trade) ---
		crew_totals = frappe.get_all(
			"Project Crew Requirement",
			filters={"parent": cost_budget, "parenttype": "Project Cost Budget"},
			fields=["trade", "total_count"],
		)
		for row in crew_totals:
			distributed = frappe.db.sql(
				"""
				select coalesce(sum(vc.count * v.working_days), 0)
				from `tabProject Visit Crew` vc
				inner join `tabProject Visits` v on v.name = vc.parent
				where v.project_planning = %s and vc.trade = %s
				""",
				(self.name, row.trade),
			)[0][0]
			required_days = flt(row.total_count) * flt(total_work_days)
			if flt(distributed) != required_days:
				frappe.throw(
					_(
						"Crew distribution mismatch for trade '{0}': distributed {1} person-days, "
						"but Estimation requires exactly {2} person-days ({3} x {4} days)."
					).format(row.trade, distributed, required_days, row.total_count, total_work_days)
				)

		# --- Equipment (per type) ---
		equipment_totals = frappe.get_all(
			"Project Equipment Requirement",
			filters={"parent": cost_budget, "parenttype": "Project Cost Budget"},
			fields=["equipment", "quantity"],
		)
		for row in equipment_totals:
			distributed = frappe.db.sql(
				"""
				select coalesce(sum(ve.quantity), 0)
				from `tabProject Visit Equipment` ve
				inner join `tabProject Visits` v on v.name = ve.parent
				where v.project_planning = %s and ve.equipment = %s
				""",
				(self.name, row.equipment),
			)[0][0]
			if flt(distributed) != flt(row.quantity):
				frappe.throw(
					_(
						"Equipment distribution mismatch for '{0}': distributed {1}, "
						"but Estimation requires exactly {2}."
					).format(row.equipment, distributed, row.quantity)
				)

	def _has_bypass_role(self):
		bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
		if not bypass_role:
			return False
		return bypass_role in frappe.get_roles(frappe.session.user)
