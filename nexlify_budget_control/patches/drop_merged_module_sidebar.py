import frappe


def execute():
    # Frappe v16.50 merged CEO / COO / Estimation / Planning into one non-standard
    # "Nexlify Budget Control" sidebar. The app now ships them as separate Sidebars.
    if not frappe.db.exists("DocType", "Sidebar"):
        return

    name = "Nexlify Budget Control"
    if frappe.db.exists("Sidebar", {"name": name, "standard": 0}):
        frappe.delete_doc("Sidebar", name, ignore_permissions=True, force=True)
