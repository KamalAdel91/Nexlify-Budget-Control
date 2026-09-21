# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class ProjectEquipmentScope(Document):
	def validate(self):
		self.total_days = (self.quantity or 0) * (self.days_per_equipment or 0)
