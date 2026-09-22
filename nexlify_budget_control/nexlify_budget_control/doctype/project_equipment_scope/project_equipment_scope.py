# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProjectEquipmentScope(Document):
	def validate(self):
		self.total_days = flt(self.quantity) * flt(self.days_per_equipment)

	def before_submit(self):
		self._check_cost_budget_still_draft()

	def before_cancel(self):
		self._check_cost_budget_still_draft()

	def _check_cost_budget_still_draft(self):
		if self.flags.ignore_cost_budget_lock_check:
			return
		cost_budget_status = frappe.db.get_value("Project Cost Budget", self.cost_budget, "docstatus")
		if cost_budget_status == 1:
			frappe.throw(
				_(
					"Cannot modify this Equipment Scope because its Project Cost Budget "
					"({0}) is already submitted. Cancel the Cost Budget first if changes are needed."
				).format(self.cost_budget)
			)
