import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint


class ManpowerCategory(Document):
	def before_insert(self):
		if cint(self.sort_order) <= 0:
			self.sort_order = cint(frappe.db.sql("select max(sort_order) from `tabManpower Category`")[0][0]) + 1

	def validate(self):
		if cint(self.sort_order) <= 0:
			frappe.throw(_("Sort must be a number above zero."))
		other = frappe.db.get_value("Manpower Category",
			{"sort_order": self.sort_order, "name": ["!=", self.name or ""]}, "name")
		if not other:
			return
		old = None if self.is_new() else cint(frappe.db.get_value("Manpower Category", self.name, "sort_order"))
		if old:
			frappe.db.set_value("Manpower Category", other, "sort_order", old, update_modified=False)
		else:
			frappe.throw(_("Sort {0} is already used by {1}.").format(self.sort_order, other))
