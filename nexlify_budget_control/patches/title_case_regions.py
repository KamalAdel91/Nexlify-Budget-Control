import frappe

REGIONS = {"CENTRAL": "Central", "EASTERN": "Eastern", "WESTERN": "Western", "NORTHERN": "Northern", "SOUTHERN": "Southern"}


def execute():
    """ONE-TIME, remove in the final Cleanup. Region names in Title Case, links updated by rename_doc."""
    for old, new in REGIONS.items():
        current = frappe.db.get_value("Region", old, "name")
        if not current or current == new:
            continue
        tmp = f"{new}__tmp"
        frappe.rename_doc("Region", current, tmp, force=True, show_alert=False)
        frappe.rename_doc("Region", tmp, new, force=True, show_alert=False)
