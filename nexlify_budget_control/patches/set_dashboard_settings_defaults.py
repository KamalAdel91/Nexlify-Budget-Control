import frappe

DT = "Project Budget Settings"
DEFAULTS = {
	"target_margin_pct": 30,
	"low_margin_threshold": 25,
	"approval_aging_warning_days": 3,
}


def execute():
	frappe.reload_doc("nexlify_budget_control", "doctype", "project_budget_settings")
	for field, value in DEFAULTS.items():
		# only fill fields never saved before; never overwrite a value set from the UI
		if not frappe.db.exists("Singles", {"doctype": DT, "field": field}):
			frappe.db.set_single_value(DT, field, value)
