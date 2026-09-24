# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProjectInvoicing(Document):
	def before_insert(self):
		# project before naming: the name starts with the project
		if self.project_planning and not self.project:
			self.project = frappe.db.get_value("Project Planning", self.project_planning, "project")
		if not self.invoice_label and self.project_planning:
			count = frappe.db.count("Project Invoicing", {"project_planning": self.project_planning})
			self.invoice_label = f"{_ordinal(count + 1)} Invoice"

	def validate(self):
		# label follows the name: INV-01, INV-02...
		if self.name and "-INV-" in self.name:
			self.invoice_label = "-".join(self.name.split("-")[-2:])
		if frappe.flags.get("bulk_invoicing_operation"):
			return
		self.validate_total_percentage()

	def validate_total_percentage(self):
		if not self.project_planning:
			return

		siblings = frappe.get_all(
			"Project Invoicing",
			filters={"project_planning": self.project_planning, "name": ["!=", self.name or ""]},
			fields=["invoice_percentage"],
		)

		total = flt(self.invoice_percentage) + sum(flt(i.invoice_percentage) for i in siblings)

		if total == 0:
			return

		if abs(total - 100) > 0.01:
			frappe.throw(
				_(
					"Total Invoice Percentage for this Plan must equal exactly 100%. "
					"Currently: {0}%"
				).format(total)
			)


def _ordinal(n):
	if 10 <= n % 100 <= 20:
		suffix = "th"
	else:
		suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
	return f"{n}{suffix}"
