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


PRICED = "Priced"  # Supply Request.status


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


def quotation_offers(req, est):
	"""{item_code: [offer, ...]}, cheapest first: every submitted quotation of the request that prices the item,
	with its rate in the Estimation's currency."""
	offers = {}
	for q in frappe.get_all("Supplier Quotation", filters={"custom_supply_request": req.name, "docstatus": 1},
			fields=["name", "supplier", "supplier_name", "valid_till"]):
		for it in frappe.get_doc("Supplier Quotation", q.name).items:
			offers.setdefault(it.item_code, []).append(frappe._dict(
				quotation=q.name, supplier=q.supplier, supplier_name=q.supplier_name, valid_till=q.valid_till, rate=estimation_rate(it, est)))
	for options in offers.values():
		options.sort(key=lambda o: o.rate)
	return offers


def apply_quotations(req):
	"""Send Prices: every line of the request takes the quotation chosen for it (Choose and Send Prices), or the cheapest; the Estimation recalculates."""
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator

	est = frappe.get_doc("Project Estimation", req.estimation)
	offers = quotation_offers(req, est)
	chosen = frappe.flags.supply_choices or {}
	rows = [r for r in est.supply or [] if r.supply_request == req.name]
	missing = sorted({r.item_code for r in rows if r.item_code not in offers})
	if missing:
		frappe.throw(_("No submitted Supplier Quotation for: {0}").format(", ".join(missing)), title=_("Quotations missing"))
	for r in rows:
		options = offers[r.item_code]
		want = chosen.get(r.name)
		pick = next((o for o in options if o.quotation == want), None) if want else options[0]
		if not pick:
			frappe.throw(_("{0} has no submitted offer for {1}.").format(want, r.item_code))
		r.supplier_quotation, r.rate = pick.quotation, pick.rate
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
	"""The Estimation was cancelled: its pending Supply Requests are cancelled, and their quotations follow."""
	state = _status_state(CANCELLED)
	for name in pending_requests(estimation):
		values = {"status": CANCELLED}
		if state:
			values["workflow_state"] = state
		frappe.db.set_value("Supply Request", name, values)
		frappe.get_doc("Supply Request", name).add_comment("Info", _("Cancelled: the Estimation {0} was cancelled.").format(estimation))
	refresh_quotation_status(estimation)


def block_delete_with_supply_requests(estimation):
	"""An Estimation that went to the Supply Chain is cancelled, not deleted: its requests and quotations stay."""
	reqs = frappe.get_all("Supply Request", filters={"estimation": estimation}, pluck="name")
	if reqs:
		frappe.throw(_("{0} has Supply Requests ({1}). Cancel it instead of deleting it.").format(estimation, ", ".join(reqs)),
			title=_("Cancel instead"))


NOTIFICATIONS = [
	{
		"name": "Supply Request: New",
		"document_type": "Supply Request", "event": "New",
		"channel": "Email", "send_system_notification": 1,
		"subject": "New Supply Request {{ doc.name }} for {{ doc.customer or doc.estimation }}",
		"message": """<p>A new Supply Request <b>{{ doc.name }}</b> for <b>{{ doc.customer or "" }}</b> is waiting for prices.</p>
<p><a href='{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}'>Open {{ doc.name }}</a></p>""",
		"recipients": [{"receiver_by_role": "Supply Chain Manager"}],
	},
	{
		"name": "Supply Request: Priced",
		"document_type": "Supply Request", "event": "Value Change", "value_changed": "status",
		"condition": 'doc.status == "Priced"',
		"channel": "Email", "send_system_notification": 1,
		"subject": "Supply priced: {{ doc.name }} is back in {{ doc.estimation }}",
		"message": """<p>The Supply Chain priced <b>{{ doc.name }}</b>. The prices are now in the Estimation <b>{{ doc.estimation }}</b>.</p>
<p><a href='{{ frappe.utils.get_url_to_form("Project Estimation", doc.estimation) }}'>Open {{ doc.estimation }}</a></p>""",
		"recipients": [{"receiver_by_document_field": "owner"}],
	},
]


def seed_notifications():
	"""Each Notification is created once per site, then the UI owns it: edit or disable it there."""
	applied = set(frappe.parse_json(frappe.db.get_default("nexlify_seeded_notifications") or "[]"))
	changed = False
	for rule in NOTIFICATIONS:
		if rule["name"] in applied:
			continue
		if not frappe.db.exists("Notification", rule["name"]):
			frappe.get_doc({"doctype": "Notification", "enabled": 1, "is_standard": 0, "message_type": "HTML", **rule}).insert(
				ignore_permissions=True)
		applied.add(rule["name"])
		changed = True
	if changed:
		frappe.db.set_default("nexlify_seeded_notifications", frappe.as_json(sorted(applied)))


@frappe.whitelist()
def get_quotation_choices(supply_request):
	"""Choose and Send Prices: every line of the request with its offers, cheapest first and preselected."""
	req = frappe.get_doc("Supply Request", supply_request)
	req.check_permission("read")
	est = frappe.get_doc("Project Estimation", req.estimation)
	offers = quotation_offers(req, est)
	rows = []
	for r in est.supply or []:
		if r.supply_request != req.name:
			continue
		options = offers.get(r.item_code, [])
		rows.append({"row": r.name, "item_code": r.item_code, "qty": r.qty, "uom": r.uom,
			"chosen": options[0].quotation if options else None, "options": options})
	return {"currency": est.currency, "rows": rows}


@frappe.whitelist()
def send_prices_with_choices(supply_request, choices):
	"""The Send Prices action of the Workflow, with the quotation chosen for each line."""
	from frappe.model.workflow import apply_workflow, get_transitions

	req = frappe.get_doc("Supply Request", supply_request)
	req.check_permission("write")
	target = _status_state(PRICED)
	action = next((t.action for t in get_transitions(req) if t.next_state == target), None)
	if not action:
		frappe.throw(_("{0} can't be priced from {1}.").format(req.name, _(req.workflow_state)))
	frappe.flags.supply_choices = frappe.parse_json(choices) or {}
	try:
		apply_workflow(req.as_dict(), action)
	finally:
		frappe.flags.supply_choices = None
