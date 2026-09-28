# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProjectEquipmentScope(Document):
	def validate(self):
		self.total_days = flt(self.quantity) * flt(self.days_per_equipment)
		self._lock_rfq_equipment()

	def before_submit(self):
		self._check_cost_budget_still_draft()

	def before_cancel(self):
		self._check_cost_budget_still_draft()

	def _check_cost_budget_still_draft(self):
		if self.flags.ignore_cost_budget_lock_check:
			return
		cost_budget_status = frappe.db.get_value("Project Estimation", self.cost_budget, "docstatus")
		if cost_budget_status == 1:
			frappe.throw(
				_(
					"Cannot modify this Equipment Scope because its Project Estimation "
					"({0}) is already submitted. Cancel the Cost Budget first if changes are needed."
				).format(self.cost_budget)
			)

	def on_trash(self):
		if self._is_rfq_scope():
			frappe.throw(_("The equipment of this Estimation comes from the Opportunity's RFQ. To change it, delete this draft Estimation: the RFQ goes back to Sales to be corrected and sent again."))

	def _is_rfq_scope(self):
		"""True when the Estimation came from an Opportunity and the change is not made by the system itself."""
		if frappe.flags.nexlify_rfq_scope_sync:
			return False
		return bool(frappe.db.get_value("Project Estimation", self.cost_budget, "opportunity"))

	def _lock_rfq_equipment(self):
		"""Equipment and quantity follow the RFQ; the estimator only sets days and manpower."""
		if not self._is_rfq_scope():
			return
		if self.is_new():
			frappe.throw(_("The equipment of this Estimation comes from the Opportunity's RFQ. To change it, delete this draft Estimation: the RFQ goes back to Sales to be corrected and sent again."))
		before = self.get_doc_before_save()
		if before and (before.equipment != self.equipment or flt(before.quantity) != flt(self.quantity)):
			frappe.throw(_("The equipment of this Estimation comes from the Opportunity's RFQ. To change it, delete this draft Estimation: the RFQ goes back to Sales to be corrected and sent again."))

