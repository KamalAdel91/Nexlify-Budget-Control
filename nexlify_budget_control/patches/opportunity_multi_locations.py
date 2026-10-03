import json

import frappe

OLD = "custom_project_location"
NEW_FIELDS = ("Opportunity-custom_project_locations", "Opportunity-custom_locations_summary", "Project-custom_project_locations")


def _ensure_custom_fields():
    """The fixtures sync after the patches, so the new fields are created here for the data to move."""
    for e in json.load(open(frappe.get_app_path("nexlify_budget_control", "fixtures", "custom_field.json"))):
        if e["name"] not in NEW_FIELDS or frappe.db.exists("Custom Field", e["name"]):
            continue
        e = {k: v for k, v in e.items() if k not in ("modified", "creation", "owner", "modified_by")}
        if e.get("insert_after") and not frappe.get_meta(e["dt"]).has_field(e["insert_after"]):
            e["insert_after"] = None
        frappe.get_doc(e).insert(ignore_permissions=True)
    frappe.clear_cache()


def execute():
    """ONE-TIME, remove in the final Cleanup. Opportunity Location becomes a multi-select table (the old value is its
    first row), Project reads the Locations by fetch_from, and the old single Location fields are removed."""
    _ensure_custom_fields()
    if frappe.db.has_column("Opportunity", OLD):
        for name, loc in frappe.db.sql(f"select name, `{OLD}` from `tabOpportunity` where ifnull(`{OLD}`, '') != ''"):
            if not frappe.db.exists("Opportunity Location", {"parent": name, "parenttype": "Opportunity"}):
                frappe.get_doc({"doctype": "Opportunity Location", "parent": name, "parenttype": "Opportunity",
                                "parentfield": "custom_project_locations", "idx": 1, "project_location": loc}).db_insert()
    for name in frappe.get_all("Opportunity", pluck="name"):
        locs = frappe.get_all("Opportunity Location", filters={"parent": name, "parenttype": "Opportunity"},
                              pluck="project_location", order_by="idx")
        frappe.db.set_value("Opportunity", name, "custom_locations_summary", ", ".join(locs), update_modified=False)

    for cf in ("Opportunity-custom_project_location", "Project-custom_project_location"):
        if frappe.db.exists("Custom Field", cf):
            frappe.delete_doc("Custom Field", cf, ignore_permissions=True)
    frappe.db.delete("Property Setter", {"doc_type": ["in", ["Opportunity", "Project"]], "field_name": OLD})
    frappe.clear_cache()

    from nexlify_budget_control.nexlify_budget_control.opportunity_rfq import refresh_project_fetches
    for opp in frappe.get_all("Project", filters={"custom_opportunity": ["is", "set"]}, pluck="custom_opportunity", distinct=True):
        refresh_project_fetches(frappe.get_doc("Opportunity", opp))
