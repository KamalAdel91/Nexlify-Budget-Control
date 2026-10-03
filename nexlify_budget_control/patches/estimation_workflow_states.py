import frappe


def _reopen(doctype, name):
    """Back to draft without the submit side effects: the document and its child rows."""
    frappe.db.set_value(doctype, name, "docstatus", 0, update_modified=False)
    for tf in frappe.get_meta(doctype).get_table_fields():
        frappe.db.sql(f"update `tab{tf.options}` set docstatus = 0 where parent = %s and parenttype = %s", (name, doctype))


def execute():
    """ONE-TIME, remove in the final Cleanup. Existing Estimations get their Workflow state. Priced ones whose
    Opportunity is not won yet go back to Sent to Sales (draft again, with their Equipment Scope rows)."""
    for name, docstatus, opp in frappe.db.sql("select name, docstatus, opportunity from `tabProject Estimation`"):
        won = bool(opp) and frappe.db.get_value("Opportunity", opp, "sales_stage") == "Closed Won"
        if docstatus == 2:
            state = "Cancelled"
        elif docstatus == 0:
            state = "Draft"
        elif opp and not won:
            state = "Sent to Sales"
            _reopen("Project Estimation", name)
            for scope in frappe.get_all("Project Equipment Scope", filters={"cost_budget": name, "docstatus": 1}, pluck="name"):
                _reopen("Project Equipment Scope", scope)
        else:
            state = "Handed Over"
        frappe.db.set_value("Project Estimation", name, "workflow_state", state, update_modified=False)

    for opp, est in frappe.db.sql("select name, custom_estimation from `tabOpportunity` where ifnull(custom_estimation, '') != ''"):
        frappe.db.set_value("Opportunity", opp, "custom_estimation_status",
                            frappe.db.get_value("Project Estimation", est, "workflow_state"), update_modified=False)
    frappe.db.sql("update `tabOpportunity` set custom_estimation_status = null where ifnull(custom_estimation, '') = ''")
