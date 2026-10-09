# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class SupplyRequest(Document):
	def validate(self):
		from nexlify_budget_control.nexlify_budget_control.supply_chain import PRICED, apply_quotations

		if not self.is_new() and self.has_value_changed("status") and self.status == PRICED:
			apply_quotations(self)

	def on_update(self):
		from nexlify_budget_control.nexlify_budget_control.supply_chain import refresh_quotation_status, sync_supply_status

		refresh_quotation_status(self.estimation)
		sync_supply_status(self.estimation)

	@property
	def items(self):
		"""The Supply lines of the Estimation sent in this request. Read from the Estimation, never copied;
		no selling price or margin is shown to the Supply Chain."""
		if self.is_new() or not self.estimation:
			return []
		return frappe.get_all(
			"Project Estimation Supply",
			filters={"parent": self.estimation, "parenttype": "Project Estimation", "supply_request": self.name},
			fields=["item_code", "description", "qty", "uom", "supplier_quotation", "supplier", "is_cancelled"],
			order_by="idx asc",
		)
