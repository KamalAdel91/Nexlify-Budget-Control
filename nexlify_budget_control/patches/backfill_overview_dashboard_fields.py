import json

import frappe
from frappe.utils import cint

DT = "Project Overview"
RETURN_STEPS = {("Pending COO Approval", "In Planning"), ("Pending CEO Approval", "Pending COO Approval")}


def execute():
	frappe.reload_doc("nexlify_budget_control", "doctype", "project_overview")
	for name in frappe.get_all(DT, pluck="name"):
		doc = frappe.get_doc(DT, name)
		doc.set_financials()
		pending = doc._pending_states()
		returns, entered, approved_on = 0, None, None
		for v in frappe.get_all("Version", filters={"ref_doctype": DT, "docname": name},
				fields=["creation", "data"], order_by="creation asc"):
			try:
				changed = json.loads(v.data or "{}").get("changed") or []
			except ValueError:
				continue
			for ch in changed:
				if len(ch) != 3:
					continue
				if ch[0] == "workflow_state":
					returns += (ch[1], ch[2]) in RETURN_STEPS
					entered = v.creation if ch[2] in pending else None
				elif ch[0] == "docstatus" and cint(ch[2]) == 1:
					approved_on = v.creation
		frappe.db.set_value(DT, name, {
			"planned_cost": doc.planned_cost,
			"expected_profit": doc.expected_profit,
			"margin_pct": doc.margin_pct,
			"return_count": returns,
			"pending_since": entered if doc.workflow_state in pending else None,
			"approved_on": (approved_on or doc.modified) if doc.docstatus == 1 else None,
		}, update_modified=False)
