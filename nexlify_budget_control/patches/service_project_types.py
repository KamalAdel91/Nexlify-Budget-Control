import frappe

MAINTENANCE = "Maintenance"
PROJECT_TYPES = ("Maintenance", "Installation", "Testing & Commissioning", "O&M / FM", "Power Study")
OLD_TO_MAINTENANCE_TYPE = {
    "MONTHLY": "Monthly",
    "QUARTERLY": "Quarterly",
    "SEMI_ANNUAL": "Semi Annual",
    "ANNUAL": "Annual",
    "ONE_TIME": "One Time",
    "ON_CALL": "On Call",
    "UNIT_PRICE": "Unit Price",
}


def _ensure(doctype, name):
    if frappe.db.exists(doctype, name):
        return
    doc = frappe.new_doc(doctype)
    autoname = frappe.get_meta(doctype).autoname or ""
    if autoname.startswith("field:"):
        doc.set(autoname[6:], name)
    doc.insert(ignore_permissions=True, set_name=name)


def execute():
    """ONE-TIME, remove in the final Cleanup. Project Type becomes the 5 service types, the old
    Project Types move to Maintenance Type, and Maintenance Nature is removed."""
    for name in PROJECT_TYPES:
        _ensure("Project Type", name)
    for name in OLD_TO_MAINTENANCE_TYPE.values():
        _ensure("Maintenance Type", name)

    old = list(OLD_TO_MAINTENANCE_TYPE)
    for name, value in frappe.get_all("Opportunity", filters={"custom_project_type": ["in", old]},
                                      fields=["name", "custom_project_type"], as_list=True):
        frappe.db.set_value("Opportunity", name, {"custom_project_type": MAINTENANCE,
                            "custom_maintenance_type": OLD_TO_MAINTENANCE_TYPE[value]}, update_modified=False)
    for name in frappe.get_all("Project", filters={"project_type": ["in", old]}, pluck="name"):
        frappe.db.set_value("Project", name, "project_type", MAINTENANCE, update_modified=False)

    for name in frappe.get_all("Project Type", filters={"name": ["not in", PROJECT_TYPES]}, pluck="name"):
        try:
            frappe.delete_doc("Project Type", name, ignore_permissions=True)
        except frappe.ValidationError:
            frappe.clear_last_message()
            print(f"   Project Type '{name}' kept: linked or protected by ERPNext")

    for cf in ("Opportunity-custom_maintenance_nature", "Project-custom_maintenance_nature"):
        if frappe.db.exists("Custom Field", cf):
            frappe.delete_doc("Custom Field", cf, ignore_permissions=True)
    frappe.db.delete("Property Setter", {"field_name": "custom_maintenance_nature"})
    frappe.db.delete(frappe.get_meta("Workspace Sidebar").get_field("items").options, {"link_to": "Maintenance Nature"})
    if frappe.db.exists("DocType", "Maintenance Nature"):
        frappe.delete_doc("DocType", "Maintenance Nature", force=True, ignore_permissions=True)
    frappe.clear_cache()
