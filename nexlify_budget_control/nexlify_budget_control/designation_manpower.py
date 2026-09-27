import frappe
from frappe import _

DEFAULT_DESIGNATION_MAP = {"Engineer": "Engineers", "Technician": "Technicians", "Driver": "Driver"}

MANPOWER_CATEGORIES = ["Engineers", "Technicians", "Safety", "Driver", "Supervisor", "Labor"]


def seed_manpower_categories():
    """Adds missing categories only; edits made from the UI are kept."""
    if not frappe.db.table_exists("Manpower Category"):
        return
    for name in MANPOWER_CATEGORIES:
        if not frappe.db.exists("Manpower Category", name):
            frappe.get_doc({
                "doctype": "Manpower Category",
                "category_name": name,
                "enabled": 1,
            }).insert(ignore_permissions=True)


def validate_designation(doc, method=None):
    if not doc.get("is_project_site_designation"):
        doc.manpower_category = None
        return
    if not doc.get("manpower_category"):
        frappe.throw(
            _("Manpower Category is required for Project / Site designations."),
            title=_("Missing Manpower Category"),
        )


def backfill_designation_categories():
    """ONE-TIME (remove in Cleanup deploy): fills the category on known Designations, empty fields only."""
    if not frappe.db.has_column("Designation", "manpower_category"):
        return
    for designation, category in DEFAULT_DESIGNATION_MAP.items():
        if not frappe.db.exists("Designation", designation) or not frappe.db.exists("Manpower Category", category):
            continue
        if frappe.db.get_value("Designation", designation, "manpower_category"):
            continue
        frappe.db.set_value("Designation", designation,
                            {"is_project_site_designation": 1, "manpower_category": category})

