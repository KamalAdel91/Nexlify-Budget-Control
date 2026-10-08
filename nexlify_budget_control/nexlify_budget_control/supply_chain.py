# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

"""Supply Chain hand-off: the Estimation sends its unpriced Supply lines in a Supply Request."""

import frappe
from frappe import _

PENDING = "Pending"  # Supply Request.status, set by its Workflow (Update Field)


def first_state():
	"""First state of the Project Estimation Workflow, read from the Workflow itself."""
	from frappe.model.workflow import get_workflow_name

	name = get_workflow_name("Project Estimation")
	states = name and frappe.get_cached_doc("Workflow", name).states
	return states[0].state if states else None


def in_first_state(est):
	first = first_state()
	return est.docstatus == 0 and (not first or not est.workflow_state or est.workflow_state == first)


def pending_requests(estimation):
	return frappe.get_all("Supply Request", filters={"estimation": estimation, "status": PENDING}, pluck="name")


def rows_to_send(est):
	"""Supply lines with no price that are not already waiting in a pending request."""
	pending = set(pending_requests(est.name))
	return [r for r in est.get("supply") or [] if not r.supplier_quotation and r.supply_request not in pending]


@frappe.whitelist()
def send_to_supply_chain(estimation):
	est = frappe.get_doc("Project Estimation", estimation)
	est.check_permission("write")
	if not in_first_state(est):
		frappe.throw(_("The Supply can be sent only while the Estimation is in {0}.").format(_(first_state())))
	rows = rows_to_send(est)
	if not rows:
		frappe.throw(_("Every Supply line is already priced or waiting at the Supply Chain."))
	req = frappe.get_doc({"doctype": "Supply Request", "estimation": est.name}).insert()
	for r in rows:
		frappe.db.set_value("Project Estimation Supply", r.name, "supply_request", req.name, update_modified=False)
	return req.name
