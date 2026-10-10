# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

"""Job Completion: the Planner marks an invoice of an approved Plan as done; Accounts then invoice it.
The Planner never sees an amount: invoice_amount is on permlevel 2 and never sent to the Plan."""

import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate

PENDING, READY, INVOICED = "Pending", "Ready to Invoice", "Invoiced"  # Project Invoicing.status


def _invoice_of_approved_plan(invoicing):
	frappe.has_permission("Project Invoicing", "write", throw=True)
	doc = frappe.get_doc("Project Invoicing", invoicing)
	if frappe.db.get_value("Project Planning", doc.project_planning, "docstatus") != 1:
		frappe.throw(_("Job Completion is marked on an approved Plan."))
	return doc


@frappe.whitelist()
def mark_job_completed(invoicing, job_completion, completion_date=None):
	"""Pending -> Ready to Invoice, with the Job Completion file. The amount is fixed now, and a Draft Sales Order
	is made for it (or the one an Undo put on hold comes back)."""
	doc = _invoice_of_approved_plan(invoicing)
	if doc.status != PENDING:
		frappe.throw(_("{0} is {1}, not {2}.").format(doc.invoice_label or doc.name, _(doc.status), _(PENDING)))
	if not job_completion:
		frappe.throw(_("Attach the Job Completion first."))
	revenue = flt(frappe.db.get_value("Project", doc.project, "custom_planned_revenue"))
	if not revenue:
		frappe.throw(_("The Project {0} has no contract value (Planned Revenue).").format(doc.project))
	doc.update({
		"status": READY,
		"job_completion": job_completion,
		"completion_date": getdate(completion_date or nowdate()),
		"completed_by": frappe.session.user,
		"invoice_amount": flt(revenue * flt(doc.invoice_percentage) / 100, 2),
	})
	doc.sales_order = _prepare_sales_order(doc)
	doc.save(ignore_permissions=True)  # the Planner may mark it; the amount and the order are the system's, unseen
	return doc.status


@frappe.whitelist()
def undo_job_completed(invoicing):
	"""Ready to Invoice -> Pending while its Sales Order is still a draft: the order is put on hold, never deleted."""
	doc = _invoice_of_approved_plan(invoicing)
	if doc.status != READY:
		frappe.throw(_("{0} is {1}: only an invoice Ready to Invoice can go back.").format(doc.invoice_label or doc.name, _(doc.status)))
	if doc.sales_order and frappe.db.get_value("Sales Order", doc.sales_order, "docstatus") == 0:
		_set_hold(doc.sales_order, True)
		frappe.get_doc("Sales Order", doc.sales_order).add_comment(
			"Info", _("On hold: Planning undid the Job Completion of {0}.").format(doc.invoice_label or doc.name))
	if doc.sales_order and doc.job_completion:
		_detach("Sales Order", doc.sales_order, doc.job_completion)
	doc.update({"status": PENDING, "job_completion": None, "completion_date": None, "completed_by": None, "invoice_amount": 0})
	doc.save(ignore_permissions=True)  # the Planner may undo it; the system's fields are reset, unseen
	return doc.status


NOTIFICATIONS = [
	{
		"name": "Project Invoicing: Ready to Invoice",
		"document_type": "Project Invoicing", "event": "Value Change", "value_changed": "status",
		"condition": 'doc.status == "Ready to Invoice"',
		"channel": "Email", "send_system_notification": 1,
		"subject": "Ready to invoice: {{ doc.invoice_label or doc.name }} of {{ doc.project }} (Sales Order {{ doc.sales_order or '' }})",
		"message": """<p>The job of <b>{{ doc.invoice_label or doc.name }}</b> is completed. Its Draft Sales Order is ready for you to review and submit.</p>
<table>
<tr><td>Project</td><td><b>{{ doc.project }}</b></td></tr>
<tr><td>Customer</td><td>{{ doc.customer or "" }}</td></tr>
<tr><td>Invoice</td><td>{{ doc.invoice_percentage }}% &middot; <b>{{ doc.get_formatted("invoice_amount") }}</b></td></tr>
<tr><td>Description</td><td>{{ doc.invoice_description or "" }}</td></tr>
<tr><td>Completed</td><td>{{ doc.get_formatted("completion_date") }} by {{ doc.completed_by }}</td></tr>
</table>
{% set opportunity = frappe.db.get_value("Project", doc.project, "custom_opportunity") %}
{% set contract = opportunity and frappe.db.get_value("Opportunity", opportunity, "custom_signed_contract") %}
<p>{% if doc.sales_order %}<a href='{{ frappe.utils.get_url_to_form("Sales Order", doc.sales_order) }}'>Sales Order {{ doc.sales_order }}</a> &middot; {% endif %}
{% if doc.job_completion %}<a href='{{ frappe.utils.get_url(doc.job_completion) }}'>Job Completion</a> &middot; {% endif %}
{% if contract %}<a href='{{ frappe.utils.get_url(contract) }}'>Signed Contract</a> &middot; {% endif %}
<a href='{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}'>Open {{ doc.invoice_label or doc.name }}</a></p>""",
		"recipients": [{"receiver_by_role": "Accounts User"}, {"receiver_by_role": "Accounts Manager"}],
	},
]


def seed_notifications():
	"""Created once per site, then the UI owns it."""
	from nexlify_budget_control.nexlify_budget_control.supply_chain import seed_notification_rules

	seed_notification_rules(NOTIFICATIONS)


@frappe.whitelist()
def plan_editable(project_planning):
	"""For the invoice form: the same lock as the server (_assert_plan_editable), as True / False."""
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _assert_plan_editable

	try:
		_assert_plan_editable(project_planning)
		return True
	except frappe.ValidationError:
		frappe.clear_last_message()
		return False


ORDERED = "Ordered"  # Project Invoicing.status, once its Sales Order is submitted


def _invoice_item(project):
	"""The Item of a project's invoices: the Project Invoice Items row of its Project Type, else the default row."""
	project_type = frappe.db.get_value("Project", project, "project_type")
	rows = frappe.get_all("Project Invoice Item Rule", filters={"parenttype": "Project Budget Settings"},
		fields=["project_type", "item_code"])
	item = next((r.item_code for r in rows if project_type and r.project_type == project_type), None) or next(
		(r.item_code for r in rows if not r.project_type), None)
	if not item:
		frappe.throw(_("Set the Project Invoice Items in Project Budget Settings (Invoicing)."))
	return item


def _prepare_sales_order(doc):
	"""The Draft Sales Order of a completed invoice: made once, then reused (an Undo puts it on hold)."""
	from nexlify_budget_control.nexlify_budget_control.budget_enforcement import _run_as_administrator

	out = []

	def work():
		live = doc.sales_order if doc.sales_order and frappe.db.get_value("Sales Order", doc.sales_order, "docstatus") == 0 else None
		if live:
			if frappe.db.get_value("Sales Order", live, "custom_on_hold_by_planning"):
				_set_hold(live, False)
			so = frappe.get_doc("Sales Order", live)
		else:
			project = frappe.db.get_value("Project", doc.project, ["customer", "company"], as_dict=True) or frappe._dict()
			if not project.customer:
				frappe.throw(_("The Project {0} has no Customer.").format(doc.project))
			so = frappe.new_doc("Sales Order")
			so.update({"customer": project.customer, "company": doc.company or project.company, "project": doc.project,
				"transaction_date": nowdate(), "delivery_date": nowdate()})
			so.append("items", {"item_code": _invoice_item(doc.project), "qty": 1, "delivery_date": nowdate(),
				"custom_project_invoicing": doc.name})
			so.set_missing_values()
		line = next((i for i in so.items if i.custom_project_invoicing == doc.name), None) or so.append("items", {
			"item_code": _invoice_item(doc.project), "qty": 1, "delivery_date": nowdate(), "custom_project_invoicing": doc.name})
		line.qty = 1
		line.rate = flt(flt(doc.invoice_amount) / flt(so.conversion_rate or 1), 2)
		line.description = doc.invoice_description or doc.invoice_label or doc.name
		so.save()
		out.append(so.name)
		if not _attach_invoicing_files("Sales Order", so.name, doc):
			so.add_comment("Info", _("No signed contract on the Opportunity of {0}: attach it here before submitting.").format(doc.project))

	_run_as_administrator(work)
	return out[0]


def _linked(doc):
	return list(dict.fromkeys(i.custom_project_invoicing for i in doc.items if i.get("custom_project_invoicing")))


def _only_once(doc, item_doctype, what):
	links = [i.custom_project_invoicing for i in doc.items if i.get("custom_project_invoicing")]
	for name in set(links):
		if links.count(name) > 1:
			frappe.throw(_("{0} is twice in this {1}.").format(name, what))
		other = frappe.db.get_value(item_doctype, {"custom_project_invoicing": name, "docstatus": ["<", 2],
			"parent": ["!=", doc.name or ""]}, "parent")
		if other:
			frappe.throw(_("{0} is already on the {1} {2}.").format(name, what, other))


def validate_sales_order(doc, method=None):
	"""One live Sales Order per Project Invoicing; an order on hold by Planning can't be submitted."""
	_only_once(doc, "Sales Order Item", _("Sales Order"))
	if getattr(doc, "_action", None) == "submit" and doc.get("custom_on_hold_by_planning"):
		frappe.throw(_("Planning undid the Job Completion of this order's invoice. It can be submitted after Planning completes it again."),
			title=_("On hold by Planning"))


def on_sales_order_update(doc, method=None):
	"""A Draft order (also one amended after a cancel) becomes the order of its invoices."""
	for name in _linked(doc):
		current = frappe.db.get_value("Project Invoicing", name, "sales_order")
		if current != doc.name and (not current or frappe.db.get_value("Sales Order", current, "docstatus") == 2):
			frappe.db.set_value("Project Invoicing", name, "sales_order", doc.name, update_modified=False)


def on_sales_order_submit(doc, method=None):
	for name in _linked(doc):
		frappe.db.set_value("Project Invoicing", name, {"status": ORDERED, "sales_order": doc.name})


def on_sales_order_cancel(doc, method=None):
	for name in _linked(doc):
		if frappe.db.get_value("Project Invoicing", name, "status") == ORDERED:
			frappe.db.set_value("Project Invoicing", name, "status", READY)


def validate_sales_invoice(doc, method=None):
	"""A Sales Invoice made from the order carries the invoice link of each order line; one live invoice each."""
	for i in doc.items:
		if i.get("so_detail") and not i.get("custom_project_invoicing"):
			i.custom_project_invoicing = frappe.db.get_value("Sales Order Item", i.so_detail, "custom_project_invoicing")
	_only_once(doc, "Sales Invoice Item", _("Sales Invoice"))


def on_sales_invoice_submit(doc, method=None):
	for name in _linked(doc):
		frappe.db.set_value("Project Invoicing", name, {"status": INVOICED, "sales_invoice": doc.name, "actual_date": doc.posting_date})


def on_sales_invoice_cancel(doc, method=None):
	for name in _linked(doc):
		if frappe.db.get_value("Project Invoicing", name, "sales_invoice") == doc.name:
			frappe.db.set_value("Project Invoicing", name, {"status": ORDERED, "sales_invoice": None, "actual_date": None})


def _hold_state(value):
	"""The Sales Order Workflow state that sets custom_on_hold_by_planning to value (read from the Workflow)."""
	from frappe.model.workflow import get_workflow_name

	name = get_workflow_name("Sales Order")
	states = (name and frappe.get_cached_doc("Workflow", name).states) or []
	return next((s.state for s in states if s.update_field == "custom_on_hold_by_planning" and str(s.update_value) == str(value)), None)


def _set_hold(sales_order, on_hold):
	"""Undo puts the Draft Sales Order on hold, Complete takes it off: the flag, and the Workflow state that goes with it."""
	values = {"custom_on_hold_by_planning": 1 if on_hold else 0}
	state = _hold_state(values["custom_on_hold_by_planning"])
	if state:
		values["workflow_state"] = state
	frappe.db.set_value("Sales Order", sales_order, values)


def _contract_of(project):
	"""The signed contract (with prices) of a project: on its Opportunity."""
	opportunity = frappe.db.get_value("Project", project, "custom_opportunity")
	return opportunity and frappe.db.get_value("Opportunity", opportunity, "custom_signed_contract")


def _attach(doctype, name, file_url):
	"""The same file on disk, attached to one more document: a File record, never a copy of the file."""
	if not file_url or frappe.db.exists("File", {"attached_to_doctype": doctype, "attached_to_name": name, "file_url": file_url}):
		return
	frappe.get_doc({"doctype": "File", "file_url": file_url, "attached_to_doctype": doctype, "attached_to_name": name,
		"is_private": 1 if file_url.startswith("/private/") else 0}).insert(ignore_permissions=True)


def _detach(doctype, name, file_url):
	"""Only this document's File record goes; the file stays on disk for the others that hold it."""
	for f in frappe.get_all("File", filters={"attached_to_doctype": doctype, "attached_to_name": name, "file_url": file_url}, pluck="name"):
		frappe.delete_doc("File", f, ignore_permissions=True)


def _attach_invoicing_files(doctype, name, invoicing):
	"""The Job Completion of one invoice and its project's signed contract, on a Sales Order / Sales Invoice.
	False when the project has no signed contract."""
	_attach(doctype, name, invoicing.job_completion)
	contract = _contract_of(invoicing.project)
	_attach(doctype, name, contract)
	return bool(contract)


def attach_invoicing_documents(doc, method=None):
	"""Sales Invoice on_update: the files of the invoices on its lines."""
	for invoicing in _linked(doc):
		row = frappe.db.get_value("Project Invoicing", invoicing, ["job_completion", "project"], as_dict=True)
		if row:
			_attach_invoicing_files(doc.doctype, doc.name, row)
