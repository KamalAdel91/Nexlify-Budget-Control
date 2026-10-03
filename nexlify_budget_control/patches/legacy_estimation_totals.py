import frappe
from frappe.utils import flt


def execute():
    """ONE-TIME, remove in the final Cleanup. Estimations submitted before the stored totals existed: Budget Details
    Total and Total Cost from their Budget Details rows (the same sum validate makes), then their Projects take the
    Estimated Cost."""
    from nexlify_budget_control.nexlify_budget_control.opportunity_rfq import refresh_fetches
    for e in frappe.get_all("Project Estimation", filters={"docstatus": 1}, fields=["name", "total_cost"]):
        if flt(e.total_cost):
            continue
        total = flt(frappe.db.sql("""select sum(estimated_amount) from `tabProject Estimation Detail`
            where parent = %s and parenttype = 'Project Estimation'""", e.name)[0][0], 2)
        if not total:
            continue
        frappe.db.set_value("Project Estimation", e.name,
                            {"budget_details_total": total, "total_cost": total, "budget_difference": 0}, update_modified=False)
        refresh_fetches(frappe.get_doc("Project Estimation", e.name))
