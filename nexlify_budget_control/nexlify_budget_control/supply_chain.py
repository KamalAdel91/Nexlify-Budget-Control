# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

"""Supply Chain hand-off: the Estimation sends its unpriced Supply lines in a Supply Request."""

import frappe
from frappe import _
from frappe.utils import flt

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


RETURNED = "Returned"  # Supply Request.status


@frappe.whitelist()
def make_supplier_quotation(supply_request):
	"""Create > Supplier Quotation on a pending Supply Request: its items and quantities, linked to it."""
	req = frappe.get_doc("Supply Request", supply_request)
	req.check_permission("read")
	if req.status != PENDING:
		frappe.throw(_("{0} is {1}: quotations are made while it is {2}.").format(req.name, _(req.status), _(PENDING)))
	sq = frappe.new_doc("Supplier Quotation")
	sq.company = req.company
	sq.custom_supply_request = req.name
	for r in req.items:
		name = frappe.db.get_value("Item", r.item_code, "item_name")
		sq.append("items", {"item_code": r.item_code, "item_name": name, "description": r.description or name,
			"qty": r.qty, "uom": r.uom, "stock_uom": r.uom, "conversion_factor": 1})
	out = sq.as_dict()
	out["__islocal"] = 1
	for row in out.get("items") or []:
		row["__islocal"] = 1
	return out


def validate_supplier_quotation(doc, method=None):
	"""A quotation for a Supply Request is made while the request is pending, and only for its items."""
	if not doc.get("custom_supply_request"):
		return
	if doc.is_new() or getattr(doc, "_action", None) == "submit":
		status = frappe.db.get_value("Supply Request", doc.custom_supply_request, "status")
		if status != PENDING:
			frappe.throw(_("{0} is {1}: it takes no more quotations.").format(doc.custom_supply_request, _(status)))
	allowed = set(frappe.get_all("Project Estimation Supply", filters={"supply_request": doc.custom_supply_request},
		pluck="item_code"))
	extra = sorted({i.item_code for i in doc.items if i.item_code not in allowed})
	if extra:
		frappe.throw(_("These items are not in {0}: {1}").format(doc.custom_supply_request, ", ".join(extra)))


def estimation_rate(item, est):
	"""Supplier price per stock UOM, after discount and before taxes, in the Estimation's currency."""
	return flt(flt(item.base_net_rate) / flt(item.conversion_factor or 1) / flt(est.conversion_rate or 1), 6)


def lowest_offers(req, est):
	"""{item_code: (supplier_quotation, rate)}: the cheapest submitted quotation for each item."""
	offers = {}
	for name in frappe.get_all("Supplier Quotation", filters={"custom_supply_request": req.name, "docstatus": 1}, pluck="name"):
		for it in frappe.get_doc("Supplier Quotation", name).items:
			rate = estimation_rate(it, est)
			if it.item_code not in offers or rate < offers[it.item_code][1]:
				offers[it.item_code] = (name, rate)
	return offers


def apply_quotations(req):
	"""Return: every line of the request takes its cheapest quotation, and the Estimation recalculates."""
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator

	est = frappe.get_doc("Project Estimation", req.estimation)
	offers = lowest_offers(req, est)
	rows = [r for r in est.supply or [] if r.supply_request == req.name]
	missing = sorted({r.item_code for r in rows if r.item_code not in offers})
	if missing:
		frappe.throw(_("No submitted Supplier Quotation for: {0}").format(", ".join(missing)), title=_("Quotations missing"))
	for r in rows:
		r.supplier_quotation, r.rate = offers[r.item_code]
	est.flags.from_supply_chain = True
	_run_as_administrator(est.save)
