import frappe
from frappe import _
from frappe.utils import flt, nowdate

from nexlify_budget_control.nexlify_budget_control import estimation_flow as flow



@frappe.whitelist()
def get_estimation_rate(company, currency, date=None, opportunity=None):
	"""Company currency -> 1. Otherwise the exchange rate for the date, then the Opportunity's rate."""
	company_currency = frappe.get_cached_value("Company", company, "default_currency")
	if not currency or currency == company_currency:
		return 1
	from erpnext.setup.utils import get_exchange_rate
	rate = flt(get_exchange_rate(currency, company_currency, date or nowdate()))
	if rate <= 0 and opportunity:
		rate = flt(frappe.db.get_value("Opportunity", opportunity, "conversion_rate"))
	if rate <= 0:
		frappe.throw(_("No exchange rate from {0} to {1} on {2}. Add it in Currency Exchange, then try again.").format(
			currency, company_currency, frappe.format(date or nowdate(), "Date")))
	return rate


def _rfq_rows(doc):
	return [(r.equipment, flt(r.quantity), (r.description or "").strip()) for r in (doc.get("custom_rfq_items") or [])]


MAINTENANCE_PROJECT_TYPE = "Maintenance"


def set_locations_summary(doc, method=None):
	"""Stored, read-only list of the chosen Locations: Project reads it with fetch_from."""
	doc.custom_locations_summary = ", ".join(r.project_location for r in (doc.get("custom_project_locations") or []) if r.project_location)


def validate_project_type(doc, method=None):
	"""Maintenance Type belongs to Maintenance projects only. Project Type, Maintenance Type and Locations are fixed once sent to Estimation."""
	if doc.get("custom_project_type") != MAINTENANCE_PROJECT_TYPE and doc.get("custom_maintenance_type"):
		doc.custom_maintenance_type = None
	before = doc.get_doc_before_save()
	if not before or (before.get("custom_estimation_status") or "Not Sent") not in flow.rfq_locked():
		return
	for f, label_field in (("custom_project_type", "custom_project_type"), ("custom_maintenance_type", "custom_maintenance_type"),
			("custom_locations_summary", "custom_project_locations")):
		if (doc.get(f) or "") != (before.get(f) or ""):
			frappe.throw(_("{0} was sent to Estimation {1} and cannot be changed.").format(_(doc.meta.get_label(label_field)), before.custom_estimation))


def refresh_fetches(doc, method=None):
	"""Fields fetched from this document (fetch_from <link>.<field>) always show its current value in the linked documents."""
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import attach_file_copy
	for target, link in FETCH_LINKS.get(doc.doctype, ()):
		meta = frappe.get_meta(target)
		fields = {df.fieldname: df.fetch_from.split(".", 1)[1] for df in meta.fields
				if (df.fetch_from or "").startswith(link + ".")}
		if not fields:
			continue
		for t in frappe.get_all(target, filters={link: doc.name}, fields=["name", *fields]):
			changes = {f: doc.get(src) for f, src in fields.items() if (t.get(f) or "") != (doc.get(src) or "")}
			if not changes:
				continue
			frappe.db.set_value(target, t.name, changes, update_modified=False)
			for f, value in changes.items():
				if value and meta.get_field(f).fieldtype in ("Attach", "Attach Image"):
					attach_file_copy(value, target, t.name, f)


def validate_rfq_lock(doc, method=None):
	"""Once sent to Estimation, the RFQ Items cannot change."""
	before = doc.get_doc_before_save()
	if not before or (before.get("custom_estimation_status") or "Not Sent") not in flow.rfq_locked():
		return
	if _rfq_rows(doc) != _rfq_rows(before):
		frappe.throw(_("The RFQ Items were sent to Estimation {0} and cannot be changed.").format(before.custom_estimation))


@frappe.whitelist()
def send_to_estimation(opportunity):
	opp = frappe.get_doc("Opportunity", opportunity)
	opp.check_permission("write")

	if (opp.custom_estimation_status or "Not Sent") != "Not Sent" or opp.custom_estimation:
		frappe.throw(_("This Opportunity was already sent to Estimation ({0}).").format(opp.custom_estimation))
	_throw_missing(_missing_for_estimation(opp))
	rows = opp.get("custom_rfq_items") or []

	currency = opp.get("currency") or frappe.get_cached_value("Company", opp.company, "default_currency")
	estimation_date = nowdate()
	rate = get_estimation_rate(opp.company, currency, estimation_date, opp.name)

	est = frappe.get_doc({
		"doctype": "Project Estimation",
		"company": opp.company,
		"customer": opp.party_name,
		"opportunity": opp.name,
		"currency": currency,
		"conversion_rate": rate,
		"estimation_date": estimation_date,
	})
	est.flags.ignore_permissions = True
	est.flags.ignore_mandatory = True
	est.insert()

	frappe.flags.nexlify_rfq_scope_sync = True
	try:
		for r in rows:
			scope = frappe.get_doc({
				"doctype": "Project Equipment Scope",
				"cost_budget": est.name,
				"equipment": r.equipment,
				"quantity": r.quantity,
				"days_per_equipment": 0,
			})
			scope.flags.ignore_permissions = True
			scope.flags.ignore_mandatory = True
			scope.insert()
	finally:
		frappe.flags.nexlify_rfq_scope_sync = False

	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _recalculate_cost_budget_total_work_days
	_recalculate_cost_budget_total_work_days(est.name)

	opp.db_set("custom_estimation", est.name)
	refresh_fetches(est)
	return est.name


@frappe.whitelist()
def get_rfq_for_estimation(estimation):
	"""The RFQ Items of the Estimation's Opportunity, for the Estimation form."""
	frappe.has_permission("Project Estimation", "read", doc=estimation, throw=True)
	opp = frappe.db.get_value("Project Estimation", estimation, "opportunity")
	if not opp:
		return {"opportunity": None, "rows": []}
	o = frappe.db.get_value("Opportunity", opp, ["customer_name", "party_name", "custom_opportunity_name", "custom_locations_summary",
		"custom_project_type", "custom_maintenance_type"], as_dict=True) or {}
	rows = frappe.get_all("Opportunity RFQ Item", filters={"parent": opp, "parenttype": "Opportunity"},
		fields=["equipment", "quantity", "description"], order_by="idx")
	return {"opportunity": opp, "customer": o.get("customer_name") or o.get("party_name"),
		"opportunity_name": o.get("custom_opportunity_name"), "rows": rows,
		"meta": [[_("Locations"), o.get("custom_locations_summary")], [_("Project Type"), o.get("custom_project_type")],
			[_("Maintenance Type"), o.get("custom_maintenance_type")]]}


@frappe.whitelist()
def get_estimation_for_opportunity(opportunity):
	"""Selling information only (equipment, quantity, unit and total price), once the Estimation is sent to Sales,
	with the notes from Estimation and the contract rounds."""
	frappe.has_permission("Opportunity", "read", doc=opportunity, throw=True)
	est, status = frappe.db.get_value("Opportunity", opportunity, ["custom_estimation", "custom_estimation_status"])
	status = status or "Not Sent"
	if not est or frappe.db.get_value("Project Estimation", est, "workflow_state") not in flow.sales_visible():
		return {"estimation": est, "status": status, "submitted": False, "rows": [], "total": 0, "currency": None}
	e = frappe.db.get_value("Project Estimation", est, ["total_price", "currency", "notes_to_sales"], as_dict=True)
	rows = frappe.get_all("Project Equipment Scope", filters={"cost_budget": est, "docstatus": ["<", 2]},
			fields=["equipment", "quantity", "unit_price", "total_price"], order_by="creation")
	return {"estimation": est, "status": status, "submitted": True, "rows": rows,
			"total": flt(e.total_price), "currency": e.currency,
			"notes": e.notes_to_sales, "rounds": _contract_rounds(est)}

def release_opportunity(estimation, cancelled=False):
	"""A deleted Estimation gives the RFQ back to its Opportunity: link removed, status Not Sent, a note on the timeline."""
	opp = estimation.get("opportunity")
	if not opp or frappe.db.get_value("Opportunity", opp, "custom_estimation") != estimation.name:
		return
	frappe.db.set_value("Opportunity", opp, {"custom_estimation": None, "custom_estimation_status": None},
			update_modified=False)
	frappe.get_doc("Opportunity", opp).add_comment("Info", (_("Estimation {0} was cancelled by {1}. The RFQ is open again.") if cancelled else _("Estimation {0} was deleted by {1}. The RFQ is open again.")).format(
			estimation.name, frappe.utils.get_fullname()))


def on_estimation_submit(doc, method=None):
	"""Handed Over: the Opportunity shows it, and the Plan opens for Planning with the contract and the Quotation without prices."""
	refresh_fetches(doc)
	if not doc.project or frappe.db.exists("Project Planning", {"project": doc.project, "docstatus": ["<", 2]}):
		return
	plan = frappe.get_doc({"doctype": "Project Planning", "project": doc.project, "company": doc.company})
	plan.insert(ignore_permissions=True, ignore_mandatory=True)
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _copy_contract_to_plan, _copy_quotation_to_plan
	_copy_contract_to_plan(plan.name, doc.contract_no_prices)
	_copy_quotation_to_plan(plan.name, doc.quotation_no_prices)
	frappe.msgprint(_("Handed over to Planning: Plan {0} is open.").format(plan.name), alert=True)


def on_estimation_cancel(doc, method=None):
	"""Cancelled: the Opportunity shows it, until the amended one goes on."""
	refresh_fetches(doc)


def on_estimation_amended(doc):
	"""Amended: the Opportunity points at the new Estimation."""
	if doc.get("opportunity") and doc.amended_from:
		frappe.db.set_value("Opportunity", doc.opportunity, "custom_estimation", doc.name, update_modified=False)
		refresh_fetches(doc)


def link_estimation_to_new_project(project, method=None):
	"""A Project made from a won Opportunity takes that Opportunity's Estimation, both ways."""
	if not project.get("custom_opportunity"):
		return
	est = frappe.db.get_value("Opportunity", project.custom_opportunity, "custom_estimation")
	if not est or frappe.db.get_value("Project Estimation", est, "docstatus") == 2:
		return
	frappe.db.set_value("Project Estimation", est, "project", project.name, update_modified=False)
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import link_project_document
	link_project_document(project.name, "custom_budget_cost", est)


@frappe.whitelist()
def show_create_estimation_on_project():
	"""For the Project form: may it offer Create Estimation when the project has none."""
	from frappe.utils import cint
	return cint(frappe.db.get_single_value("Project Budget Settings", "show_create_estimation_on_project"))


@frappe.whitelist()
def get_project_estimation_status(project):
	"""For the Project form: the docstatus of the project's Estimation, for users who can read the Project."""
	frappe.has_permission("Project", "read", doc=project, throw=True)
	est = frappe.db.get_value("Project", project, "custom_budget_cost")
	return frappe.db.get_value("Project Estimation", est, "docstatus") if est else None



# Source doctype -> (doctype that fetches from it, its link field). The fetched fields come from the meta.
FETCH_LINKS = {
	"Opportunity": (("Project", "custom_opportunity"), ("Project Estimation", "opportunity")),
	"Project Estimation": (("Opportunity", "custom_estimation"), ("Project", "custom_budget_cost")),
}


def share_signed_contract(doc, method=None):
	"""The Estimation team cannot read the Opportunity, so the files that come from it (the signed contract, the signed
	Quotation and the latest contract draft) get their own File on the Estimation."""
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import attach_file_copy
	for field in ("signed_contract", "quotation_from_sales", "contract_from_sales"):
		if doc.get(field):
			attach_file_copy(doc.get(field), doc.doctype, doc.name, field)


def share_signed_quotation(doc, method=None):
	"""A Signed Quotation attached on the Opportunity is shared with its Estimation at once, as the Estimation team
	cannot read the Opportunity."""
	url, est = doc.get("custom_signed_quotation"), doc.get("custom_estimation")
	if url and est and doc.has_value_changed("custom_signed_quotation"):
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import attach_file_copy
		attach_file_copy(url, "Project Estimation", est, "quotation_from_sales")


def on_opportunity_closed(doc, method=None):
	"""Closed Won (with the signed contract) moves the agreed Estimation to Won, back with the Estimation team for the
	Handover. A lost deal marks the Estimation Lost while it is still before the win."""
	if doc.sales_stage not in CLOSED_STAGES or not doc.has_value_changed("sales_stage") or not doc.get("custom_estimation"):
		return
	state = frappe.db.get_value("Project Estimation", doc.custom_estimation, "workflow_state")
	if doc.sales_stage == "Closed Won":
		action = flow.RECEIVE_SIGNED_CONTRACT if state in flow.agreed() else None
	else:
		action = flow.MARK_LOST if state in flow.left_by(flow.MARK_LOST) else None
	if not action:
		return
	from frappe.model.workflow import apply_workflow
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator
	# only this closing may move the Estimation to Won or Lost (Project Estimation._validate_workflow_step)
	frappe.flags.nexlify_opportunity_closed = True
	try:
		_run_as_administrator(apply_workflow, frappe.get_doc("Project Estimation", doc.custom_estimation).as_dict(), action)
	finally:
		frappe.flags.nexlify_opportunity_closed = False


@frappe.whitelist()
def request_estimation_revision(opportunity, reason):
	"""Sales sends the priced Estimation back to the Estimation team, with the reason, before the deal is closed."""
	opp = frappe.get_doc("Opportunity", opportunity)
	opp.check_permission("write")
	reason = (reason or "").strip()
	if not reason:
		frappe.throw(_("Write what the Estimation team should revise."))
	if opp.sales_stage in ("Closed Won", "Closed Lost"):
		frappe.throw(_("The Opportunity is closed."))
	est = opp.get("custom_estimation")
	if not est or frappe.db.get_value("Project Estimation", est, "workflow_state") not in flow.with_sales():
		frappe.throw(_("The Estimation is not with Sales."))
	from frappe.model.workflow import apply_workflow
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator
	_run_as_administrator(apply_workflow, frappe.get_doc("Project Estimation", est).as_dict(), flow.REQUEST_REVISION)
	note = _("Revision requested by {0}: {1}").format(frappe.utils.get_fullname(), frappe.utils.escape_html(reason))
	frappe.get_doc("Project Estimation", est).add_comment("Comment", note)
	opp.add_comment("Comment", note)


def claim_signed_contract(doc, method=None):
	"""A contract uploaded from the Closed Won dialog is not attached to anything yet: attach it to this Opportunity, private."""
	url = doc.get("custom_signed_contract")
	if not url or doc.is_new() or not doc.has_value_changed("custom_signed_contract"):
		return
	name = frappe.db.get_value("File", {"file_url": url, "attached_to_name": ["is", "not set"]}, "name")
	if not name:
		return
	f = frappe.get_doc("File", name)
	f.update({"attached_to_doctype": doc.doctype, "attached_to_name": doc.name,
			"attached_to_field": "custom_signed_contract", "is_private": 1})
	f.save(ignore_permissions=True)
	doc.custom_signed_contract = f.file_url


CLOSED_STAGES = ("Closed Won", "Closed Lost", "Closed Lost to Competition")


def _norm(df, value):
	from frappe.utils import cstr, flt, get_datetime, getdate
	if not value and value != 0:
		return ""
	if df.fieldtype == "Date":
		return str(getdate(value))
	if df.fieldtype == "Datetime":
		return str(get_datetime(value))
	if df.fieldtype in ("Currency", "Float", "Percent", "Int", "Check"):
		return flt(value)
	return cstr(value).strip()


def _rows(doc, df):
	from frappe.model import no_value_fields
	child = frappe.get_meta(df.options)
	fields = [c for c in child.fields if c.fieldtype not in no_value_fields]
	return [tuple(_norm(c, r.get(c.fieldname)) for c in fields) for r in (doc.get(df.fieldname) or [])]


def validate_closed_lock(doc, method=None):
	"""A closed Opportunity (won or lost) cannot change. Only the Signed Contract may be replaced while the Estimation is Won (before the Handover)."""
	if doc.is_new() or "System Manager" in frappe.get_roles():
		return
	before = doc.get_doc_before_save()
	if not before or before.get("sales_stage") not in CLOSED_STAGES:
		return
	from frappe.model import no_value_fields, table_fields
	allowed = set()
	if doc.get("custom_estimation") and frappe.db.get_value("Project Estimation", doc.custom_estimation, "workflow_state") in flow.won():
		allowed.add("custom_signed_contract")
	changed = []
	for df in doc.meta.fields:
		if (df.fieldtype in no_value_fields and df.fieldtype not in table_fields) or df.read_only or df.hidden or df.fetch_from or df.fieldname in allowed:
			continue
		if df.fieldtype in table_fields:
			if _rows(doc, df) != _rows(before, df):
				changed.append(_(df.label or df.fieldname))
		elif _norm(df, doc.get(df.fieldname)) != _norm(df, before.get(df.fieldname)):
			changed.append(_(df.label or df.fieldname))
	if changed:
		frappe.throw(_("This Opportunity is {0} and cannot be changed. Changed: {1}").format(_(before.sales_stage), ", ".join(changed)),
					title=_("Opportunity Closed"))


def on_estimation_cancelled_draft(doc, method=None):
	"""Cancel (Draft): the RFQ goes back to Sales and the pending Supply Requests are cancelled; the Estimation stays as history."""
	if not doc.get("is_cancelled_draft") or not doc.has_value_changed("is_cancelled_draft"):
		return
	from nexlify_budget_control.nexlify_budget_control.supply_chain import cancel_pending_requests

	release_opportunity(doc, cancelled=True)
	cancel_pending_requests(doc.name)


def validate_won_ready(doc, method=None):
	"""Closed Won only after the Estimation team accepted the contract; the signed contract comes with the Closed Won."""
	if doc.sales_stage != "Closed Won" or not doc.has_value_changed("sales_stage"):
		return
	est = doc.get("custom_estimation")
	state = frappe.db.get_value("Project Estimation", est, "workflow_state") if est else None
	if state not in flow.agreed():
		frappe.throw(_("The Opportunity can be Closed Won only after the Estimation team accepts the contract. Estimation Status: {0}").format(
			_(state or "Not Sent")), title=_("Contract not agreed"))


def _contract_rounds(estimation):
	"""The contract negotiation as Sales may see it: who, when, what and the comment (no Estimation files)."""
	rows = frappe.get_all("Project Estimation Contract Round", filters={"parent": estimation, "parenttype": "Project Estimation"},
		fields=["round_no", "direction", "event", "comment", "by_user", "sent_on"], order_by="idx")
	for r in rows:
		r.by_name = frappe.utils.get_fullname(r.pop("by_user"))
	return rows


def _claim_upload(url, doctype, name):
	"""A file uploaded from a dialog is not attached to anything yet: attach it to the document, private."""
	file = frappe.db.get_value("File", {"file_url": url, "attached_to_name": ["is", "not set"]}, "name")
	if not file:
		return url
	f = frappe.get_doc("File", file)
	f.update({"attached_to_doctype": doctype, "attached_to_name": name, "is_private": 1})
	f.save(ignore_permissions=True)
	return f.file_url


def _quotation_pdf(quotation, estimation):
	"""Our Quotation as Sales sent it, as a PDF on the Estimation (the Estimation team cannot read the Quotation)."""
	f = frappe.get_doc({"doctype": "File", "file_name": f"{quotation}.pdf", "is_private": 1,
		"content": frappe.get_print("Quotation", quotation, as_pdf=True),
		"attached_to_doctype": "Project Estimation", "attached_to_name": estimation, "attached_to_field": "contract_rounds"})
	f.insert(ignore_permissions=True)
	return f.file_url


@frappe.whitelist()
def send_contract(opportunity, contract, quotation=None, comment=None):
	"""Sales sends the customer's contract (a draft until the deal is won) to the Estimation team for the Contract Review.
	The Quotation signed by the customer must be on the Opportunity first (Signed Quotation); it goes with the contract."""
	opp = frappe.get_doc("Opportunity", opportunity)
	opp.check_permission("write")
	if opp.sales_stage in CLOSED_STAGES:
		frappe.throw(_("The Opportunity is closed."))
	est = opp.get("custom_estimation")
	if not est or frappe.db.get_value("Project Estimation", est, "workflow_state") not in flow.left_by(flow.SEND_CONTRACT):
		frappe.throw(_("The Estimation is not waiting for the contract."))
	if not contract:
		frappe.throw(_("Attach the contract."))
	signed_quotation = opp.get("custom_signed_quotation")
	if not signed_quotation:
		frappe.throw(_("Attach the Quotation signed by the customer (Signed Quotation) on the Opportunity first."))
	q = frappe.db.get_value("Quotation", quotation, ["docstatus", "opportunity"], as_dict=True) if quotation else None
	if not q or q.docstatus != 1 or q.opportunity != opp.name:
		frappe.throw(_("Choose the submitted Quotation of this Opportunity: Make Quotation in the price card, then Submit it."))
	if not _quotation_matches(frappe.get_doc("Quotation", quotation), opp):
		frappe.throw(_("Quotation {0} does not carry the current Estimation prices. Make a new Quotation.").format(quotation))
	from frappe.model.workflow import apply_workflow
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator, attach_file_copy

	contract = _claim_upload(contract, "Opportunity", opp.name)
	attach_file_copy(contract, "Project Estimation", est, "contract_rounds")
	attach_file_copy(signed_quotation, "Project Estimation", est, "contract_rounds")
	frappe.flags.nexlify_contract_round = {"contract": contract, "quotation": quotation, "quotation_pdf": signed_quotation,
		"comment": (comment or "").strip() or None, "by_user": frappe.session.user}
	try:
		_run_as_administrator(apply_workflow, frappe.get_doc("Project Estimation", est).as_dict(), flow.SEND_CONTRACT)
	finally:
		frappe.flags.nexlify_contract_round = None
	# the latest draft on the Estimation; every round stays in Contract Rounds
	frappe.db.set_value("Project Estimation", est, "contract_from_sales", contract, update_modified=False)
	note = _("Contract, Quotation {0} and its signed copy sent to Estimation by {1}").format(quotation, frappe.utils.get_fullname())
	if (comment or "").strip():
		note += ": " + frappe.utils.escape_html(comment.strip())
	opp.add_comment("Comment", note)


@frappe.whitelist()
def make_quotation(source_name, target_doc=None):
	"""Create > Quotation on an Opportunity: ERPNext's mapping (party, company, default taxes), with the Opportunity's
	Items as its lines: the approved Estimation's lines and prices, which Sales cannot change."""
	from erpnext.crm.doctype.opportunity.opportunity import make_quotation as erpnext_make_quotation

	opp = frappe.get_doc("Opportunity", source_name)
	est = opp.get("custom_estimation")
	if not est or frappe.db.get_value("Project Estimation", est, "workflow_state") not in flow.left_by(flow.SEND_CONTRACT):
		frappe.throw(_("The Quotation is made once the Estimation prices are with Sales."), title=_("No prices yet"))
	if not opp.get("items"):
		frappe.throw(_("The Opportunity has no priced Items yet."), title=_("No prices yet"))
	e = frappe.db.get_value("Project Estimation", est, ["currency", "conversion_rate"], as_dict=True)

	_throw_other_quotation(opp.name)
	q = erpnext_make_quotation(source_name, target_doc)
	q.opportunity = opp.name
	q.ignore_pricing_rule = 1
	q.currency = e.currency
	q.conversion_rate = flt(e.conversion_rate) or 1
	q.set("items", [])
	for r in opp.items:
		q.append("items", {"item_code": r.item_code, "item_name": r.item_name, "description": r.description or r.item_name,
			"qty": flt(r.qty), "uom": r.uom, "stock_uom": r.uom, "conversion_factor": 1,
			"price_list_rate": flt(r.rate), "rate": flt(r.rate), "discount_percentage": 0})
	q.run_method("set_missing_values")
	q.run_method("calculate_taxes_and_totals")
	return q




def validate_prices_from_estimation(doc, method=None):
	"""Once the Estimation's prices are approved, the Opportunity's Items, value and currency come only from it: a price
	changes through Request Revision on the Estimation, never by hand."""
	if doc.is_new() or doc.flags.nexlify_prices_from_estimation or frappe.flags.in_import or frappe.flags.in_patch:
		return
	before = doc.get_doc_before_save()
	if not before:
		return
	if (flt(doc.opportunity_amount, 2) == flt(before.opportunity_amount, 2) and doc.currency == before.currency
			and _price_lines(doc) == _price_lines(before)):
		return
	est = doc.get("custom_estimation")
	if est and frappe.db.get_value("Project Estimation", est, "workflow_state") in flow.sales_visible():
		frappe.throw(_("The Items, the prices and the value come from the Estimation. To change a price, use Request Revision."),
			title=_("Prices from the Estimation"))


def _price_lines(doc):
	"""The priced part of each line (the Item, the quantity, the price); its name and description stay free for Sales."""
	return [(r.item_code, flt(r.qty, 4), flt(r.rate, 2)) for r in doc.get("items") or []]


def _estimation_lines(opp):
	"""The approved Estimation's priced lines as the Opportunity takes them: the Item from the settings (by Project Type),
	the customer's item as its name, the quantity and the unit price."""
	from nexlify_budget_control.nexlify_budget_control.job_completion import item_for_project_type
	item = item_for_project_type(opp.get("custom_project_type"))
	uom = frappe.db.get_value("Item", item, "stock_uom")
	described = {r.equipment: (r.description or "").strip() for r in opp.get("custom_rfq_items") or []}
	return [frappe._dict(item_code=item, item_name=r.equipment, description=described.get(r.equipment) or r.equipment,
			qty=flt(r.quantity), uom=uom, rate=flt(r.unit_price))
		for r in frappe.get_all("Project Equipment Scope", filters={"cost_budget": opp.custom_estimation, "docstatus": ["<", 2]},
			fields=["equipment", "quantity", "unit_price"], order_by="creation")]


def _fill_opportunity_from_estimation(opportunity):
	"""The Estimation's lines become the Opportunity's Items and its total the Opportunity's value (same currency and rate).
	The names and descriptions Sales wrote stay when the same lines come back (as many lines as before)."""
	opp = frappe.get_doc("Opportunity", opportunity)
	if opp.sales_stage in CLOSED_STAGES or not opp.get("custom_estimation"):
		return False
	e = frappe.db.get_value("Project Estimation", opp.custom_estimation, ["currency", "conversion_rate", "total_price"], as_dict=True)
	old = [(r.item_name, r.description) for r in opp.get("items") or []]
	new = _estimation_lines(opp)
	keep = len(old) == len(new)
	opp.set("items", [])
	for k, line in enumerate(new):
		name, description = old[k] if keep else (line.item_name, line.description)
		opp.append("items", {"item_code": line.item_code, "item_name": name or line.item_name,
			"description": description or line.description, "qty": line.qty, "uom": line.uom, "rate": line.rate})
	opp.currency = e.currency
	opp.conversion_rate = flt(e.conversion_rate) or 1
	opp.opportunity_amount = flt(e.total_price)
	opp.flags.nexlify_prices_from_estimation = True
	opp.flags.ignore_permissions = True
	opp.save()
	return True


def sync_opportunity_items(doc, method=None):
	"""When the Estimation's approved prices reach Sales, its lines become the Opportunity's Items and its total the
	Opportunity's value. Both stay locked: the prices come only from the Estimation."""
	if doc.get("opportunity") and doc.has_value_changed("workflow_state") and doc.workflow_state in flow.with_sales():
		_fill_opportunity_from_estimation(doc.opportunity)


def _quotation_matches(q, opp):
	"""The Quotation carries exactly the Opportunity's Items (lines, quantities, prices), with no discount."""
	no_discount = (not flt(q.get("additional_discount_percentage")) and not flt(q.get("discount_amount"))
		and all(not flt(r.get("discount_percentage")) and not flt(r.get("discount_amount")) for r in q.get("items") or []))
	return bool(opp.get("items")) and sorted(_price_lines(q)) == sorted(_price_lines(opp)) and no_discount


def validate_quotation_prices(doc, method=None):
	"""A Quotation of an Opportunity whose Estimation prices are approved carries exactly its Items, with no discount.
	A price changes through Request Revision on the Estimation."""
	if not doc.get("opportunity") or doc.docstatus == 2:
		return
	opp = frappe.get_doc("Opportunity", doc.opportunity)
	est = opp.get("custom_estimation")
	if not est or frappe.db.get_value("Project Estimation", est, "workflow_state") not in flow.sales_visible():
		return
	if not _quotation_matches(doc, opp):
		frappe.throw(_("The Quotation's lines and prices come from the Estimation (the Opportunity's Items), with no discount. "
			"To change a price, use Request Revision."), title=_("Prices from the Estimation"))


def fill_opportunity_items(dry_run=1):
	"""Once per site: the open Opportunities whose Estimation prices are with Sales get its lines as their Items and its
	total as their value. dry_run=1 only lists them.
	bench --site <site> execute nexlify_budget_control.nexlify_budget_control.opportunity_rfq.fill_opportunity_items --kwargs "{'dry_run': 0}"
	"""
	out = []
	for o in frappe.get_all("Opportunity", filters={"custom_estimation": ["is", "set"]}, fields=["name", "custom_estimation", "sales_stage"]):
		if o.sales_stage in CLOSED_STAGES:
			continue
		if frappe.db.get_value("Project Estimation", o.custom_estimation, "workflow_state") not in flow.sales_visible():
			continue
		out.append(o.name)
		if not frappe.utils.cint(dry_run):
			_fill_opportunity_from_estimation(o.name)
	return out


def validate_one_quotation(doc, method=None):
	"""One Quotation at a time for an Opportunity, Draft or Submitted: for a new one, delete the Draft or cancel the
	submitted one, then Make Quotation (it takes the current prices; Amend would copy the old ones)."""
	if not doc.get("opportunity"):
		return
	_throw_other_quotation(doc.opportunity, doc.name)


def _throw_other_quotation(opportunity, name=None):
	filters = {"opportunity": opportunity, "docstatus": ["<", 2]}
	if name and not name.startswith("new-"):
		filters["name"] = ["!=", name]
	other = frappe.db.get_value("Quotation", filters, ["name", "docstatus"], as_dict=True)
	if other:
		frappe.throw(_("Quotation {0} ({1}) already exists for this Opportunity. Open it, or {2} it first, then use Make Quotation.").format(
			frappe.utils.get_link_to_form("Quotation", other.name), _("Draft") if other.docstatus == 0 else _("Submitted"),
			_("delete") if other.docstatus == 0 else _("cancel")), title=_("One Quotation at a time"))


def _missing_for_estimation(opp):
	"""Everything the Opportunity still needs before it goes to Estimation, all at once."""
	missing = []
	if opp.opportunity_from != "Customer" or not opp.party_name:
		missing.append(_("A Customer (Opportunity From = Customer)"))
	if not opp.get("custom_region"):
		missing.append(_("Region"))
	if not opp.get("custom_project_type"):
		missing.append(_("Project Type"))
	elif opp.custom_project_type == MAINTENANCE_PROJECT_TYPE and not opp.get("custom_maintenance_type"):
		missing.append(_("Maintenance Type"))
	rows = opp.get("custom_rfq_items") or []
	if not rows:
		missing.append(_("At least one RFQ Item"))
	for r in rows:
		if not r.equipment or flt(r.quantity) <= 0:
			missing.append(_("RFQ Items row {0}: Equipment Scope and a Quantity above zero").format(r.idx))
	return missing


def _throw_missing(missing):
	if missing:
		frappe.throw("<br>".join(["<b>" + _("Complete these before sending to Estimation:") + "</b>"]
								 + ["&bull; " + frappe.utils.escape_html(m) for m in missing]),
					 title=_("Missing information"))


@frappe.whitelist()
def check_send_to_estimation(opportunity):
	"""What is missing before Send To Estimation, checked before the confirmation."""
	opp = frappe.get_doc("Opportunity", opportunity)
	opp.check_permission("write")
	return _missing_for_estimation(opp)


@frappe.whitelist()
def check_closed_won(opportunity):
	"""Everything the Opportunity still needs before Closed Won, all at once (the same rules the save checks)."""
	opp = frappe.get_doc("Opportunity", opportunity)
	opp.check_permission("write")
	missing = []
	if not frappe.db.exists("Quotation", {"opportunity": opp.name, "docstatus": 1}):
		missing.append(_("A submitted Quotation (Estimation > Make Quotation)"))
	if not opp.get("custom_signed_quotation"):
		missing.append(_("Signed Quotation"))
	est = opp.get("custom_estimation")
	state = frappe.db.get_value("Project Estimation", est, "workflow_state") if est else None
	if state not in flow.agreed():
		missing.append(_("The Estimation team accepts the contract (Estimation Status: {0})").format(_(state or "Not Sent")))
	if not opp.get("custom_signed_contract"):
		missing.append(_("Signed Contract"))
	if not opp.get("custom_closing_date"):
		missing.append(_("Closing Date"))
	if not opp.get("custom_region"):
		missing.append(_("Region"))
	if not opp.get("custom_project_type"):
		missing.append(_("Project Type"))
	elif opp.custom_project_type == MAINTENANCE_PROJECT_TYPE and not opp.get("custom_maintenance_type"):
		missing.append(_("Maintenance Type"))
	if flt(opp.get("opportunity_amount")) <= 0:
		missing.append(_("Opportunity Amount above zero"))
	return missing
