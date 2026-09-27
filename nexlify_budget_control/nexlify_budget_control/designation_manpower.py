import frappe
from frappe import _

MANPOWER_CATEGORIES = ["Engineer", "Technician", "Safety", "Driver", "Supervisor", "Labor"]


def seed_manpower_categories():
    """Runs once per site; later renames, deletes and additions from the UI are kept."""
    if not frappe.db.table_exists("Manpower Category"):
        return
    if frappe.db.get_default("nexlify_manpower_categories_seeded") or frappe.db.count("Manpower Category"):
        frappe.db.set_default("nexlify_manpower_categories_seeded", 1)
        return
    for name in MANPOWER_CATEGORIES:
        if not frappe.db.exists("Manpower Category", name):
            frappe.get_doc({
                "doctype": "Manpower Category",
                "category_name": name,
                "enabled": 1,
            }).insert(ignore_permissions=True)
    frappe.db.set_default("nexlify_manpower_categories_seeded", 1)


def validate_designation(doc, method=None):
    if not doc.get("is_project_site_designation"):
        doc.manpower_category = None
        return
    if not doc.get("manpower_category"):
        frappe.throw(
            _("Manpower Category is required for Project / Site designations."),
            title=_("Missing Manpower Category"),
        )
