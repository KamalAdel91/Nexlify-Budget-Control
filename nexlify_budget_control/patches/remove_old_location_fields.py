import frappe

FIELDS = [("Opportunity", "custom_location"), ("Project", "custom_location")]


def execute():
    """Removes the old Select location fields, only after every value is in custom_project_location."""
    for dt, fn in FIELDS:
        name = f"{dt}-{fn}"
        if not frappe.db.exists("Custom Field", name):
            continue
        if frappe.db.has_column(dt, fn) and frappe.db.has_column(dt, "custom_project_location"):
            left = frappe.db.sql(f"""select count(*) from `tab{dt}` where ifnull(`{fn}`, '') != ''
                and ifnull(custom_project_location, '') = ''""")[0][0]
            if left:
                frappe.throw(f"{dt}: {left} rows still have only the old location. Copy them first.")
        frappe.delete_doc("Custom Field", name, ignore_permissions=True, force=True)
