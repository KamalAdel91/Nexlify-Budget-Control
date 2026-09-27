import frappe

OLD, NEW = "Project " + "Cost Budget", "Project Estimation"

# Places where the DocType name is stored as text, which rename_doc does not update
PLACES = [
    ("Number Card", "filters_json"),
    ("Number Card", "dynamic_filters_json"),
    ("Dashboard Chart", "filters_json"),
    ("Dashboard Chart", "dynamic_filters_json"),
    ("Workspace Sidebar Item", "filters"),
    ("Workspace Link", "label"),
    ("Project Crew Requirement", "parenttype"),
    ("Project Equipment Requirement", "parenttype"),
]


def execute():
    for dt, col in PLACES:
        if not frappe.db.table_exists(dt) or not frappe.db.has_column(dt, col):
            continue
        frappe.db.sql(f"update `tab{dt}` set `{col}` = replace(`{col}`, %s, %s) where `{col}` like %s",
                      (OLD, NEW, f"%{OLD}%"))
    frappe.clear_cache()
