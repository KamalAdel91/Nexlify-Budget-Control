import frappe
from frappe import _
from frappe.utils import flt, nowdate

LOCKED_STATUSES = ('Draft', 'Sent to Sales', 'Contract Review', 'Handed Over', 'Cancelled')


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
	if not before or (before.get("custom_estimation_status") or "Not Sent") not in LOCKED_STATUSES:
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
	if not before or (before.get("custom_estimation_status") or "Not Sent") not in LOCKED_STATUSES:
		return
	if _rfq_rows(doc) != _rfq_rows(before):
		frappe.throw(_("The RFQ Items were sent to Estimation {0} and cannot be changed.").format(before.custom_estimation))


@frappe.whitelist()
def send_to_estimation(opportunity):
	opp = frappe.get_doc("Opportunity", opportunity)
	opp.check_permission("write")

	if opp.opportunity_from != "Customer" or not opp.party_name:
		frappe.throw(_("Only an Opportunity for a Customer can be sent to Estimation."))
	if (opp.custom_estimation_status or "Not Sent") != "Not Sent" or opp.custom_estimation:
		frappe.throw(_("This Opportunity was already sent to Estimation ({0}).").format(opp.custom_estimation))
	rows = opp.get("custom_rfq_items") or []
	if not rows:
		frappe.throw(_("Add at least one RFQ Item before sending to Estimation."))
	for r in rows:
		if not r.equipment or flt(r.quantity) <= 0:
			frappe.throw(_("Row {0}: Equipment Scope and a Quantity above zero are required.").format(r.idx))

	if not opp.get("custom_region"):
		frappe.throw(_("Select the Region before sending to Estimation."))
	if not opp.get("custom_project_type"):
		frappe.throw(_("Select the Project Type before sending to Estimation."))
	if opp.custom_project_type == MAINTENANCE_PROJECT_TYPE and not opp.get("custom_maintenance_type"):
		frappe.throw(_("Select the Maintenance Type before sending to Estimation."))

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
	"""Selling information only (equipment, quantity, unit and total price), once the Estimation is sent to Sales."""
	frappe.has_permission("Opportunity", "read", doc=opportunity, throw=True)
	est, status = frappe.db.get_value("Opportunity", opportunity, ["custom_estimation", "custom_estimation_status"])
	status = status or "Not Sent"
	if not est or frappe.db.get_value("Project Estimation", est, "workflow_state") not in SALES_VISIBLE:
		return {"estimation": est, "status": status, "submitted": False, "rows": [], "total": 0, "currency": None}
	e = frappe.db.get_value("Project Estimation", est, ["total_price", "currency"], as_dict=True)
	rows = frappe.get_all("Project Equipment Scope", filters={"cost_budget": est, "docstatus": ["<", 2]},
			fields=["equipment", "quantity", "unit_price", "total_price"], order_by="creation")
	return {"estimation": est, "status": status, "submitted": True, "rows": rows,
			"total": flt(e.total_price), "currency": e.currency}

def release_opportunity(estimation, withdrawn=False):
	"""A deleted Estimation gives the RFQ back to its Opportunity: link removed, status Not Sent, a note on the timeline."""
	opp = estimation.get("opportunity")
	if not opp or frappe.db.get_value("Opportunity", opp, "custom_estimation") != estimation.name:
		return
	frappe.db.set_value("Opportunity", opp, {"custom_estimation": None, "custom_estimation_status": None},
			update_modified=False)
	frappe.get_doc("Opportunity", opp).add_comment("Info", (_("Estimation {0} was withdrawn by {1}. The RFQ is open again.") if withdrawn else _("Estimation {0} was deleted by {1}. The RFQ is open again.")).format(
			estimation.name, frappe.utils.get_fullname()))


def on_estimation_submit(doc, method=None):
	"""Handed Over: the Opportunity shows it, and the Plan opens for Planning with the contract without prices."""
	refresh_fetches(doc)
	if not doc.project or frappe.db.exists("Project Planning", {"project": doc.project, "docstatus": ["<", 2]}):
		return
	plan = frappe.get_doc({"doctype": "Project Planning", "project": doc.project, "company": doc.company})
	plan.insert(ignore_permissions=True, ignore_mandatory=True)
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _copy_contract_to_plan
	_copy_contract_to_plan(plan.name, doc.contract_no_prices)
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


SALES_VISIBLE = ("Sent to Sales", "Contract Review", "Handed Over")

# Source doctype -> (doctype that fetches from it, its link field). The fetched fields come from the meta.
FETCH_LINKS = {
	"Opportunity": (("Project", "custom_opportunity"), ("Project Estimation", "opportunity")),
	"Project Estimation": (("Opportunity", "custom_estimation"), ("Project", "custom_budget_cost")),
}


def share_signed_contract(doc, method=None):
	"""The Estimation team cannot read the Opportunity, so the signed contract gets its own File on the Estimation."""
	if doc.get("signed_contract"):
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import attach_file_copy
		attach_file_copy(doc.signed_contract, doc.doctype, doc.name, "signed_contract")


def on_opportunity_won(doc, method=None):
	"""Closed Won with the signed contract: the Estimation goes back to the Estimation team for the Contract Review."""
	if doc.sales_stage != "Closed Won" or not doc.has_value_changed("sales_stage") or not doc.get("custom_estimation"):
		return
	if frappe.db.get_value("Project Estimation", doc.custom_estimation, "workflow_state") != "Sent to Sales":
		return
	from frappe.model.workflow import apply_workflow
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator
	est = frappe.get_doc("Project Estimation", doc.custom_estimation).as_dict()
	_run_as_administrator(apply_workflow, est, "Receive Contract")


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
	if not est or frappe.db.get_value("Project Estimation", est, "workflow_state") != "Sent to Sales":
		frappe.throw(_("The Estimation is not with Sales."))
	from frappe.model.workflow import apply_workflow
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator
	_run_as_administrator(apply_workflow, frappe.get_doc("Project Estimation", est).as_dict(), "Request Revision")
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
	"""A closed Opportunity (won or lost) cannot change. Only the Signed Contract may be replaced while the Estimation is in Contract Review."""
	if doc.is_new() or "System Manager" in frappe.get_roles():
		return
	before = doc.get_doc_before_save()
	if not before or before.get("sales_stage") not in CLOSED_STAGES:
		return
	from frappe.model import no_value_fields, table_fields
	allowed = set()
	if doc.get("custom_estimation") and frappe.db.get_value("Project Estimation", doc.custom_estimation, "workflow_state") == "Contract Review":
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


def on_estimation_withdrawn(doc, method=None):
	"""Withdraw: the RFQ goes back to Sales and the pending Supply Requests are cancelled; the Estimation stays as history."""
	if not doc.get("is_withdrawn") or not doc.has_value_changed("is_withdrawn"):
		return
	from nexlify_budget_control.nexlify_budget_control.supply_chain import cancel_pending_requests

	release_opportunity(doc, withdrawn=True)
	cancel_pending_requests(doc.name)
