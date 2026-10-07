import frappe
from frappe import _
from frappe.model.document import Document


class ProjectBudgetSettings(Document):
	def validate(self):
		self.validate_alsa_landing_rules()

	def validate_alsa_landing_rules(self):
		seen = set()
		for row in self.get("alsa_landing_rules") or []:
			row.landing_route = (row.landing_route or "").strip()
			if not row.landing_route.startswith("/"):
				frappe.throw(_("Row {0}: Landing Route must start with /").format(row.idx))
			if row.role in seen:
				frappe.throw(_("Row {0}: Role {1} is listed more than once").format(row.idx, row.role))
			seen.add(row.role)
