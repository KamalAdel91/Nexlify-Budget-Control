import frappe
from frappe import _
from frappe.model.document import Document


class ProjectBudgetSettings(Document):
	def validate(self):
		self.validate_alsa_landing_rules()
		self.validate_project_invoice_items()

	def validate_alsa_landing_rules(self):
		seen = set()
		for row in self.get("alsa_landing_rules") or []:
			row.landing_route = (row.landing_route or "").strip()
			if not row.landing_route.startswith("/"):
				frappe.throw(_("Row {0}: Landing Route must start with /").format(row.idx))
			if row.role in seen:
				frappe.throw(_("Row {0}: Role {1} is listed more than once").format(row.idx, row.role))
			seen.add(row.role)


	def validate_project_invoice_items(self):
		"""One default row (no Project Type), each Project Type once, and service Items only."""
		seen, defaults = set(), 0
		for row in self.get("project_invoice_items") or []:
			if not row.project_type:
				defaults += 1
			elif row.project_type in seen:
				frappe.throw(_("Row {0}: Project Type {1} is listed more than once").format(row.idx, row.project_type))
			else:
				seen.add(row.project_type)
			if frappe.db.get_value("Item", row.item_code, "is_stock_item"):
				frappe.throw(_("Row {0}: {1} is a stock Item. Project invoices take a service Item (Maintain Stock off).").format(
					row.idx, row.item_code))
		if defaults > 1:
			frappe.throw(_("Only one row can leave Project Type empty: it is the default Item."))
