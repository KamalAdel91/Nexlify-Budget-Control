# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

"""Supply Chain hand-off: the Estimation sends its unpriced Supply lines in a Supply Request."""

import frappe
from frappe import _
from frappe.utils import flt

PENDING = "Pending"  # Supply Request.status, set by its Workflow (Update Field)
SUPPLY_CHAIN = "Supply Chain"  # Project Estimation Supply.price_source
MANUAL = "Manual"  # Project Estimation Supply.price_source: typed by the estimator, never sent


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
	return [r for r in est.get("supply") or [] if not r.is_cancelled and r.price_source != MANUAL and not r.supplier_quotation and r.supply_request not in pending]


@frappe.whitelist()
def send_to_supply_chain(estimation, rows=None):
	est = frappe.get_doc("Project Estimation", estimation)
	est.check_permission("write")
	if not in_first_state(est):
		frappe.throw(_("The Supply can be sent only while the Estimation is in {0}.").format(_(first_state())))
	only = set(frappe.parse_json(rows) or []) if rows else None
	rows = [r for r in rows_to_send(est) if only is None or r.name in only]
	if not rows:
		frappe.throw(_("Every Supply line is already priced or waiting at the Supply Chain."))
	req = frappe.get_doc({"doctype": "Supply Request", "estimation": est.name}).insert()
	for r in rows:
		frappe.db.set_value("Project Estimation Supply", r.name, "supply_request", req.name, update_modified=False)
	sync_supply_status(est.name)
	return req.name


PRICED = "Priced"  # Supply Request.status


@frappe.whitelist()
def make_supplier_quotation(supply_request):
	"""Create > Supplier Quotation on a pending Supply Request: its items, each line linked to the request."""
	req = frappe.get_doc("Supply Request", supply_request)
	req.check_permission("read")
	if req.status != PENDING:
		frappe.throw(_("{0} is {1}: quotations are made while it is {2}.").format(req.name, _(req.status), _(PENDING)))
	sq = frappe.new_doc("Supplier Quotation")
	sq.company = req.company
	for row in supply_request_lines([req.name], req.company):
		sq.append("items", row)
	out = sq.as_dict()
	out["__islocal"] = 1
	for row in out.get("items") or []:
		row["__islocal"] = 1
	return out


def validate_supplier_quotation(doc, method=None):
	"""Lines taken from Supply Requests: each request is pending, of the quotation's company, and has the item."""
	reqs = {i.custom_supply_request for i in doc.items if i.get("custom_supply_request")}
	if not reqs:
		return
	info = {r.name: r for r in frappe.get_all("Supply Request", filters={"name": ["in", list(reqs)]},
		fields=["name", "status", "company"])}
	checking = doc.is_new() or getattr(doc, "_action", None) == "submit"
	for name in sorted(reqs):
		r = info.get(name)
		if not r:
			frappe.throw(_("Supply Request {0} not found.").format(name))
		if r.company != doc.company:
			frappe.throw(_("{0} belongs to {1}; this quotation is for {2}.").format(name, r.company, doc.company))
		if checking and r.status != PENDING:
			frappe.throw(_("{0} is {1}: it takes no more quotations.").format(name, _(r.status)))
	allowed = {(x.supply_request, x.item_code) for x in frappe.get_all("Project Estimation Supply",
		filters={"supply_request": ["in", list(reqs)]}, fields=["supply_request", "item_code"])}
	extra = sorted({f"{i.item_code} ({i.custom_supply_request})" for i in doc.items
		if i.get("custom_supply_request") and (i.custom_supply_request, i.item_code) not in allowed})
	if extra:
		frappe.throw(_("These items are not in their Supply Request: {0}").format(", ".join(extra)))
	for i in doc.items:
		if i.get("custom_supply_request") and not i.get("custom_supply_status"):
			i.custom_supply_status = PENDING


def estimation_rate(item, est):
	"""Supplier price per stock UOM, after discount and before taxes, in the Estimation's currency."""
	return flt(flt(item.base_net_rate) / flt(item.conversion_factor or 1) / flt(est.conversion_rate or 1), 6)


def quotation_offers(req, est):
	"""{item_code: [offer, ...]}, cheapest first: every submitted quotation line of the request, priced in the
	Estimation's currency. One quotation can price several requests; only this request's lines count here."""
	lines = frappe.get_all("Supplier Quotation Item",
		filters={"custom_supply_request": req.name, "docstatus": 1, "parenttype": "Supplier Quotation"},
		fields=["parent", "item_code", "base_net_rate", "conversion_factor"])
	heads = {q.name: q for q in frappe.get_all("Supplier Quotation", filters={"name": ["in", list({l.parent for l in lines}) or [""]]},
		fields=["name", "supplier", "supplier_name", "valid_till"])}
	offers = {}
	for l in lines:
		q = heads[l.parent]
		offers.setdefault(l.item_code, []).append(frappe._dict(quotation=q.name, supplier=q.supplier,
			supplier_name=q.supplier_name, valid_till=q.valid_till, rate=estimation_rate(l, est)))
	for options in offers.values():
		options.sort(key=lambda o: o.rate)
	return offers


def apply_quotations(req):
	"""Send Prices: every line of the request takes the quotation chosen for it (Choose and Send Prices), or the cheapest; the Estimation recalculates."""
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator

	est = frappe.get_doc("Project Estimation", req.estimation)
	offers = quotation_offers(req, est)
	chosen = frappe.flags.supply_choices or {}
	rows = [r for r in est.supply or [] if r.supply_request == req.name and not r.is_cancelled]
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
	"""Supply Status of each Supplier Quotation line, worked out from the data every time (never typed):
	Pending and Cancelled follow its Supply Request; Selected when the Estimation's line of that request and item
	uses the quotation (Won or Lost once the Opportunity is closed); Not selected otherwise.
	The quotation's own Supply Status sums up its lines."""
	from nexlify_budget_control.nexlify_budget_control.opportunity_rfq import CLOSED_STAGES

	if not estimation:
		return
	reqs = dict(frappe.get_all("Supply Request", filters={"estimation": estimation}, fields=["name", "status"], as_list=True))
	if not reqs:
		return
	used = {(r.supply_request, r.item_code, r.supplier_quotation) for r in frappe.get_all("Project Estimation Supply",
		filters={"parent": estimation, "parenttype": "Project Estimation", "supplier_quotation": ["is", "set"], "is_cancelled": 0},
		fields=["supply_request", "item_code", "supplier_quotation"])}
	opportunity = frappe.db.get_value("Project Estimation", estimation, "opportunity")
	stage = opportunity and frappe.db.get_value("Opportunity", opportunity, "sales_stage")
	touched = set()
	for l in frappe.get_all("Supplier Quotation Item",
			filters={"custom_supply_request": ["in", list(reqs)], "parenttype": "Supplier Quotation"},
			fields=["name", "parent", "item_code", "docstatus", "custom_supply_request", "custom_supply_status"]):
		req_status = reqs.get(l.custom_supply_request)
		if l.docstatus == 2 or req_status == CANCELLED:
			status = "Cancelled"
		elif req_status == PENDING:
			status = "Pending"
		elif (l.custom_supply_request, l.item_code, l.parent) in used:
			status = "Won" if stage == "Closed Won" else "Lost" if stage in CLOSED_STAGES else "Selected"
		else:
			status = "Not selected"
		if status != l.custom_supply_status:
			frappe.db.set_value("Supplier Quotation Item", l.name, "custom_supply_status", status, update_modified=False)
		touched.add(l.parent)
	for quotation in touched:
		refresh_quotation_header(quotation)


def before_quotation_cancel(doc, method=None):
	"""A quotation that prices Supply lines can't be cancelled under them."""
	used_in = sorted(set(frappe.get_all("Project Estimation Supply",
		filters={"supplier_quotation": doc.name, "parenttype": "Project Estimation", "is_cancelled": 0}, pluck="parent")))
	if used_in:
		frappe.throw(_("{0} prices the Supply of {1}. Change those lines first.").format(doc.name, ", ".join(used_in)))


def on_quotation_change(doc, method=None):
	reqs = list({i.custom_supply_request for i in doc.items if i.get("custom_supply_request")})
	for estimation in set(frappe.get_all("Supply Request", filters={"name": ["in", reqs]}, pluck="estimation")) if reqs else []:
		refresh_quotation_status(estimation)


def on_estimation_update(doc, method=None):
	refresh_quotation_status(doc.name)


def on_opportunity_update(doc, method=None):
	if doc.get("custom_estimation") and doc.has_value_changed("sales_stage"):
		refresh_quotation_status(doc.custom_estimation)


def before_quotation_update(doc, method=None):
	"""Update Items after submit can't change a quotation whose price an Estimation already took."""
	used_in = sorted(set(frappe.get_all("Project Estimation Supply",
		filters={"supplier_quotation": doc.name, "parenttype": "Project Estimation", "is_cancelled": 0}, pluck="parent")))
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
	sync_supply_status(estimation)


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
	seed_notification_rules(NOTIFICATIONS)


def seed_notification_rules(rules):
	applied = set(frappe.parse_json(frappe.db.get_default("nexlify_seeded_notifications") or "[]"))
	changed = False
	for rule in rules:
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
		if r.supply_request != req.name or r.is_cancelled:
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


NOT_SENT, WAITING = "Not Sent", "Waiting"  # Project Estimation Supply.supply_status (with PRICED)


def row_supply_status(row, request_status):
	"""Where a Supply line stands: Manual lines have no status."""
	if row.is_cancelled:
		return CANCELLED
	if row.price_source == MANUAL:
		return ""
	if row.supplier_quotation:
		return PRICED
	if row.supply_request and request_status == PENDING:
		return WAITING
	return NOT_SENT


def sync_supply_status(estimation):
	"""Keeps the Supply Status column right when a Supply Request moves without the Estimation being saved."""
	reqs = dict(frappe.get_all("Supply Request", filters={"estimation": estimation}, fields=["name", "status"], as_list=True))
	for r in frappe.get_all("Project Estimation Supply", filters={"parent": estimation, "parenttype": "Project Estimation"},
			fields=["name", "price_source", "supplier_quotation", "supply_request", "supply_status", "is_cancelled"]):
		status = row_supply_status(r, reqs.get(r.supply_request))
		if status != (r.supply_status or ""):
			frappe.db.set_value("Project Estimation Supply", r.name, "supply_status", status, update_modified=False)


def _editable_estimation(estimation):
	est = frappe.get_doc("Project Estimation", estimation)
	est.check_permission("write")
	if not in_first_state(est):
		frappe.throw(_("The Supply can change only while the Estimation is in {0}.").format(_(first_state())))
	return est


@frappe.whitelist()
def supply_line_action(estimation, row, action):
	"""The Actions menu of a Supply line."""
	est = _editable_estimation(estimation)
	line = next((r for r in est.supply or [] if r.name == row), None)
	if not line:
		frappe.throw(_("This Supply line is not in {0} any more. Reload the Estimation.").format(estimation))
	waiting = not line.supplier_quotation and line.supply_request in set(pending_requests(est.name))
	if action == "cancel":
		line.is_cancelled = 1
	elif action == "restore":
		line.is_cancelled = 0
	elif action in ("quote_again", "to_manual", "to_supply_chain"):
		if line.is_cancelled:
			frappe.throw(_("Restore the line first."))
		if waiting:
			frappe.throw(_("This line is waiting at the Supply Chain ({0}).").format(line.supply_request))
		if action == "quote_again" and (line.price_source == MANUAL or not line.supplier_quotation):
			frappe.throw(_("Only a priced Supply Chain line can be quoted again."))
		if action == "to_manual" and line.price_source == MANUAL:
			frappe.throw(_("This line is already Manual."))
		if action == "to_supply_chain" and line.price_source != MANUAL:
			frappe.throw(_("This line is already priced by the Supply Chain."))
		if action == "to_manual":
			line.price_source = MANUAL
		elif action == "to_supply_chain":
			line.price_source = SUPPLY_CHAIN
		line.rate, line.supplier_quotation, line.supplier, line.supply_request = 0, None, None, None
	else:
		frappe.throw(_("Unknown action {0}").format(action))
	est.flags.from_supply_chain = True
	est.save()


STATUS_RANK = ("Won", "Selected", "Pending", "Lost", "Not selected", "Cancelled")  # the quotation's summary, first found wins


def refresh_quotation_header(quotation):
	statuses = set(frappe.get_all("Supplier Quotation Item",
		filters={"parent": quotation, "parenttype": "Supplier Quotation", "custom_supply_request": ["is", "set"]},
		pluck="custom_supply_status"))
	status = next((s for s in STATUS_RANK if s in statuses), "")
	if status != (frappe.db.get_value("Supplier Quotation", quotation, "custom_supply_status") or ""):
		frappe.db.set_value("Supplier Quotation", quotation, "custom_supply_status", status, update_modified=False)


def supply_request_lines(names, company):
	"""The lines a Supplier Quotation takes from pending Supply Requests of one company."""
	out = []
	for req in frappe.get_all("Supply Request", filters={"name": ["in", list(names) or [""]], "status": PENDING, "company": company},
			fields=["name", "estimation"], order_by="creation asc"):
		for r in frappe.get_all("Project Estimation Supply",
				filters={"parent": req.estimation, "parenttype": "Project Estimation", "supply_request": req.name, "is_cancelled": 0},
				fields=["item_code", "description", "qty", "uom"], order_by="idx asc"):
			name = frappe.db.get_value("Item", r.item_code, "item_name")
			out.append({"item_code": r.item_code, "item_name": name, "description": r.description or name, "qty": r.qty,
				"uom": r.uom, "stock_uom": r.uom, "conversion_factor": 1, "custom_supply_request": req.name})
	return out


@frappe.whitelist()
def get_supply_request_items(supply_requests, company):
	"""Get Items From > Supply Request on a Supplier Quotation."""
	frappe.has_permission("Supplier Quotation", "create", throw=True)
	return supply_request_lines(frappe.parse_json(supply_requests) or [], company)
