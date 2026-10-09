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
	if doc.is_new():
		doc.custom_supply_status = PENDING
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


CANCELLED = "Cancelled"  # Supply Request.status


def refresh_quotation_status(estimation):
	"""Supplier Quotation.custom_supply_status, worked out from the data every time (never typed):
	Pending and Cancelled follow the Supply Request; Selected when a Supply line of the Estimation uses
	the quotation (Won or Lost once the Opportunity is closed); Not selected otherwise."""
	from nexlify_budget_control.nexlify_budget_control.opportunity_rfq import CLOSED_STAGES

	if not estimation:
		return
	reqs = dict(frappe.get_all("Supply Request", filters={"estimation": estimation}, fields=["name", "status"], as_list=True))
	if not reqs:
		return
	used = set(frappe.get_all("Project Estimation Supply",
		filters={"parent": estimation, "parenttype": "Project Estimation", "supplier_quotation": ["is", "set"]},
		pluck="supplier_quotation"))
	opportunity = frappe.db.get_value("Project Estimation", estimation, "opportunity")
	stage = opportunity and frappe.db.get_value("Opportunity", opportunity, "sales_stage")
	for sq in frappe.get_all("Supplier Quotation", filters={"custom_supply_request": ["in", list(reqs)]},
			fields=["name", "docstatus", "custom_supply_request", "custom_supply_status"]):
		req_status = reqs.get(sq.custom_supply_request)
		if sq.docstatus == 2 or req_status == CANCELLED:
			status = "Cancelled"
		elif req_status == PENDING:
			status = "Pending"
		elif sq.name in used:
			status = "Won" if stage == "Closed Won" else "Lost" if stage in CLOSED_STAGES else "Selected"
		else:
			status = "Not selected"
		if status != sq.custom_supply_status:
			frappe.db.set_value("Supplier Quotation", sq.name, "custom_supply_status", status, update_modified=False)


def before_quotation_cancel(doc, method=None):
	"""A quotation that prices Supply lines can't be cancelled under them."""
	used_in = sorted(set(frappe.get_all("Project Estimation Supply",
		filters={"supplier_quotation": doc.name, "parenttype": "Project Estimation"}, pluck="parent")))
	if used_in:
		frappe.throw(_("{0} prices the Supply of {1}. Change those lines first.").format(doc.name, ", ".join(used_in)))


def on_quotation_change(doc, method=None):
	if doc.get("custom_supply_request"):
		refresh_quotation_status(frappe.db.get_value("Supply Request", doc.custom_supply_request, "estimation"))


def on_estimation_update(doc, method=None):
	refresh_quotation_status(doc.name)


def on_opportunity_update(doc, method=None):
	if doc.get("custom_estimation") and doc.has_value_changed("sales_stage"):
		refresh_quotation_status(doc.custom_estimation)


def before_quotation_update(doc, method=None):
	"""Update Items after submit can't change a quotation whose price an Estimation already took."""
	used_in = sorted(set(frappe.get_all("Project Estimation Supply",
		filters={"supplier_quotation": doc.name, "parenttype": "Project Estimation"}, pluck="parent")))
	if used_in:
		frappe.throw(_("{0} prices the Supply of {1}, so its items and rates can't change.").format(doc.name, ", ".join(used_in)),
			title=_("Quotation in use"))


def _status_state(status):
	"""The Supply Request Workflow state that sets this status (read from the Workflow, not named here)."""
	from frappe.model.workflow import get_workflow_name

	name = get_workflow_name("Supply Request")
	states = (name and frappe.get_cached_doc("Workflow", name).states) or []
	return next((s.state for s in states if s.update_field == "status" and s.update_value == status), None)


def cancel_pending_requests(estimation):
	"""The Estimation was withdrawn: its pending Supply Requests are cancelled, and their quotations follow."""
	state = _status_state(CANCELLED)
	for name in pending_requests(estimation):
		values = {"status": CANCELLED}
		if state:
			values["workflow_state"] = state
		frappe.db.set_value("Supply Request", name, values)
		frappe.get_doc("Supply Request", name).add_comment("Info", _("Cancelled: the Estimation {0} was withdrawn.").format(estimation))
	refresh_quotation_status(estimation)


def block_delete_with_supply_requests(estimation):
	"""An Estimation that went to the Supply Chain is withdrawn, not deleted: its requests and quotations stay."""
	reqs = frappe.get_all("Supply Request", filters={"estimation": estimation}, pluck="name")
	if reqs:
		frappe.throw(_("{0} has Supply Requests ({1}). Use Withdraw instead of deleting it.").format(estimation, ", ".join(reqs)),
			title=_("Withdraw instead"))
