import frappe


def execute():
    """ONE-TIME, remove in the final Cleanup. Projects take the newly fetched fields (Maintenance Type, Customer Name, Estimated Cost)
    from their Opportunity. The fixtures sync after the patches, so they are synced here first."""
    from frappe.utils.fixtures import sync_fixtures
    sync_fixtures("nexlify_budget_control")
    frappe.clear_cache(doctype="Project")
    from nexlify_budget_control.nexlify_budget_control.opportunity_rfq import refresh_fetches
    for opp in frappe.get_all("Project", filters={"custom_opportunity": ["is", "set"]}, pluck="custom_opportunity", distinct=True):
        refresh_fetches(frappe.get_doc("Opportunity", opp))
    for est in frappe.get_all("Project Estimation", filters={"docstatus": ["<", 2], "project": ["is", "set"]}, pluck="name"):
        refresh_fetches(frappe.get_doc("Project Estimation", est))
