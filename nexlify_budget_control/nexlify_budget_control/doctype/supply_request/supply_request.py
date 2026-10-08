# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class SupplyRequest(Document):
	@property
	def items(self):
		"""The Supply lines of the Estimation sent in this request. Read from the Estimation, never copied;
		no selling price or margin is shown to the Supply Chain."""
		if self.is_new() or not self.estimation:
			return []
		return frappe.get_all(
			"Project Estimation Supply",
			filters={"parent": self.estimation, "parenttype": "Project Estimation", "supply_request": self.name},
			fields=["item_code", "description", "qty", "uom", "supplier_quotation", "supplier"],
			order_by="idx asc",
		)
