# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe

TARGET_DOCTYPE = "Project Equipment Scope"
BASE_ANCHOR_FIELD = "total_days"


import re


def _fieldname_for(designation_name):
	clean = re.sub(r"[^a-zA-Z0-9_]+", "_", designation_name.strip().lower())
	clean = re.sub(r"_+", "_", clean).strip("_")
	return "role_" + clean


def _last_dynamic_fieldname():
	last = frappe.db.get_value(
		"Custom Field",
		{"dt": TARGET_DOCTYPE, "fieldname": ["like", "role_%"]},
		"fieldname",
		order_by="idx desc",
	)
	return last or BASE_ANCHOR_FIELD


def sync_new_designation(doc, method=None):
	fieldname = _fieldname_for(doc.name)

	if frappe.db.exists("Custom Field", {"dt": TARGET_DOCTYPE, "fieldname": fieldname}):
		return

	frappe.get_doc({
		"doctype": "Custom Field",
		"dt": TARGET_DOCTYPE,
		"fieldname": fieldname,
		"label": doc.name,
		"fieldtype": "Int",
		"insert_after": _last_dynamic_fieldname(),
		"in_list_view": 1,
	}).insert(ignore_permissions=True)

	frappe.clear_cache(doctype=TARGET_DOCTYPE)


def sync_renamed_designation(doc, method=None, old=None, new=None, merge=False):
	fieldname = _fieldname_for(old)
	custom_field_name = frappe.db.get_value("Custom Field", {"dt": TARGET_DOCTYPE, "fieldname": fieldname}, "name")
	if custom_field_name:
		frappe.db.set_value("Custom Field", custom_field_name, "label", new)
		frappe.clear_cache(doctype=TARGET_DOCTYPE)


def sync_deleted_designation(doc, method=None):
	fieldname = _fieldname_for(doc.name)
	custom_field_name = frappe.db.get_value("Custom Field", {"dt": TARGET_DOCTYPE, "fieldname": fieldname}, "name")
	if custom_field_name:
		frappe.delete_doc("Custom Field", custom_field_name, ignore_permissions=True, force=True)
		frappe.clear_cache(doctype=TARGET_DOCTYPE)


@frappe.whitelist()
def backfill_all_designations():
	designations = frappe.get_all("Designation", pluck="name")
	for d in designations:
		sync_new_designation(frappe.get_doc("Designation", d))
	return f"Synced {len(designations)} designations."
