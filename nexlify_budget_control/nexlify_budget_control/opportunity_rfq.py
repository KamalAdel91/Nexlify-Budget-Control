import frappe
from frappe import _
from frappe.utils import flt, nowdate

LOCKED_STATUSES = ("With Estimation", "Estimated")


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


def validate_project_type(doc, method=None):
	"""Maintenance Type belongs to Maintenance projects only, and both are fixed once sent to Estimation."""
	if doc.get("custom_project_type") != MAINTENANCE_PROJECT_TYPE and doc.get("custom_maintenance_type"):
		doc.custom_maintenance_type = None
	before = doc.get_doc_before_save()
	if not before or (before.get("custom_estimation_status") or "Not Sent") not in LOCKED_STATUSES:
		return
	for f in ("custom_project_type", "custom_maintenance_type"):
		if (doc.get(f) or "") != (before.get(f) or ""):
			frappe.throw(_("{0} was sent to Estimation {1} and cannot be changed.").format(_(doc.meta.get_label(f)), before.custom_estimation))


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

	opp.db_set({"custom_estimation": est.name, "custom_estimation_status": "With Estimation"})
	return est.name


@frappe.whitelist()
def get_rfq_for_estimation(estimation):
	"""The RFQ Items of the Estimation's Opportunity, for the Estimation form."""
	frappe.has_permission("Project Estimation", "read", doc=estimation, throw=True)
	opp = frappe.db.get_value("Project Estimation", estimation, "opportunity")
	if not opp:
		return {"opportunity": None, "rows": []}
	o = frappe.db.get_value("Opportunity", opp, ["customer_name", "party_name", "custom_opportunity_name", "custom_project_location",
		"custom_project_type", "custom_maintenance_type"], as_dict=True) or {}
	rows = frappe.get_all("Opportunity RFQ Item", filters={"parent": opp, "parenttype": "Opportunity"},
		fields=["equipment", "quantity", "description"], order_by="idx")
	return {"opportunity": opp, "customer": o.get("customer_name") or o.get("party_name"),
		"opportunity_name": o.get("custom_opportunity_name"), "rows": rows,
		"meta": [[_("Location"), o.get("custom_project_location")], [_("Project Type"), o.get("custom_project_type")],
			[_("Maintenance Type"), o.get("custom_maintenance_type")]]}


@frappe.whitelist()
def get_estimation_for_opportunity(opportunity):
	"""Selling information only (equipment, quantity, unit and total price), once the Estimation is submitted."""
	frappe.has_permission("Opportunity", "read", doc=opportunity, throw=True)
	est, status = frappe.db.get_value("Opportunity", opportunity, ["custom_estimation", "custom_estimation_status"])
	status = status or "Not Sent"
	if not est or frappe.db.get_value("Project Estimation", est, "docstatus") != 1:
		return {"estimation": est, "status": status, "submitted": False, "rows": [], "total": 0, "currency": None}
	e = frappe.db.get_value("Project Estimation", est, ["total_price", "currency"], as_dict=True)
	rows = frappe.get_all("Project Equipment Scope", filters={"cost_budget": est, "docstatus": 1},
		fields=["equipment", "quantity", "unit_price", "total_price"], order_by="creation")
	return {"estimation": est, "status": status, "submitted": True, "rows": rows,
		"total": flt(e.total_price), "currency": e.currency}

def release_opportunity(estimation):
	"""A deleted Estimation gives the RFQ back to its Opportunity: link removed, status Not Sent, a note on the timeline."""
	opp = estimation.get("opportunity")
	if not opp or frappe.db.get_value("Opportunity", opp, "custom_estimation") != estimation.name:
		return
	frappe.db.set_value("Opportunity", opp, {"custom_estimation": None, "custom_estimation_status": "Not Sent"},
		update_modified=False)
	frappe.get_doc("Opportunity", opp).add_comment("Info", _("Estimation {0} was deleted by {1}. The RFQ is open again.").format(
		estimation.name, frappe.utils.get_fullname()))


def on_estimation_submit(doc, method=None):
	"""Submitted: the Opportunity shows the prices."""
	if doc.get("opportunity"):
		frappe.db.set_value("Opportunity", doc.opportunity,
			{"custom_estimation": doc.name, "custom_estimation_status": "Estimated"}, update_modified=False)


def on_estimation_cancel(doc, method=None):
	"""Cancelled: back to With Estimation, until the amended one is submitted."""
	if doc.get("opportunity") and frappe.db.get_value("Opportunity", doc.opportunity, "custom_estimation") == doc.name:
		frappe.db.set_value("Opportunity", doc.opportunity, "custom_estimation_status", "With Estimation", update_modified=False)


def on_estimation_amended(doc):
	"""Amended: the Opportunity points at the new Estimation."""
	if doc.get("opportunity") and doc.amended_from:
		frappe.db.set_value("Opportunity", doc.opportunity,
			{"custom_estimation": doc.name, "custom_estimation_status": "With Estimation"}, update_modified=False)


def link_estimation_to_new_project(project, method=None):
	"""A Project made from a won Opportunity takes that Opportunity's submitted Estimation, both ways."""
	if not project.get("custom_opportunity"):
		return
	est = frappe.db.get_value("Opportunity", project.custom_opportunity, "custom_estimation")
	if not est or frappe.db.get_value("Project Estimation", est, "docstatus") != 1:
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

