"""Pipeline Status: everything that waits on someone now, from the Hand-off Log."""

import frappe
from frappe import _

FIELDS = ["reference_doctype", "reference_name", "project", "customer", "stage", "previous_stage", "waiting_on",
		  "entered_on", "duration_days", "target_days", "is_overdue"]


def execute(filters=None):
	f = frappe._dict(filters or {})
	conditions = {"is_open": 1}
	if f.waiting_on:
		conditions["waiting_on"] = ["like", f"%{f.waiting_on}%"]
	for key in ("reference_doctype", "customer", "project", "company"):
		if f.get(key):
			conditions[key] = f.get(key)
	if f.overdue_only:
		conditions["is_overdue"] = 1
	rows = frappe.get_list("Hand-off Log", filters=conditions, fields=FIELDS, order_by="duration_days desc")
	return columns(), rows


def columns():
	return [
		{"fieldname": "reference_name", "label": _("Document"), "fieldtype": "Dynamic Link", "options": "reference_doctype", "width": 190},
		{"fieldname": "reference_doctype", "label": _("Type"), "fieldtype": "Link", "options": "DocType", "width": 140},
		{"fieldname": "project", "label": _("Project"), "fieldtype": "Link", "options": "Project", "width": 150},
		{"fieldname": "customer", "label": _("Customer"), "fieldtype": "Link", "options": "Customer", "width": 160},
		{"fieldname": "stage", "label": _("Stage"), "fieldtype": "Data", "width": 150},
		{"fieldname": "waiting_on", "label": _("Waiting On"), "fieldtype": "Data", "width": 150},
		{"fieldname": "entered_on", "label": _("Since"), "fieldtype": "Datetime", "width": 150},
		{"fieldname": "duration_days", "label": _("Days"), "fieldtype": "Float", "precision": 2, "width": 80},
		{"fieldname": "target_days", "label": _("Target"), "fieldtype": "Int", "width": 80},
		{"fieldname": "is_overdue", "label": _("Overdue"), "fieldtype": "Check", "width": 80},
		{"fieldname": "previous_stage", "label": _("Came From"), "fieldtype": "Data", "width": 140},
	]
