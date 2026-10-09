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
	"""Pending -> Ready to Invoice, with the Job Completion file; the amount is fixed now."""
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
	doc.save(ignore_permissions=True)  # the Planner may mark it; the amount is written by the system, unseen
	return doc.status


@frappe.whitelist()
def undo_job_completed(invoicing):
	"""Ready to Invoice -> Pending, while no Sales Invoice holds it."""
	doc = _invoice_of_approved_plan(invoicing)
	if doc.status != READY:
		frappe.throw(_("{0} is {1}: only an invoice Ready to Invoice can go back.").format(doc.invoice_label or doc.name, _(doc.status)))
	draft = frappe.db.get_value("Sales Invoice Item", {"custom_project_invoicing": doc.name, "docstatus": 0}, "parent")
	if draft:
		frappe.throw(_("{0} is on the draft Sales Invoice {1}. Remove it there first.").format(doc.invoice_label or doc.name, draft))
	doc.update({"status": PENDING, "job_completion": None, "completion_date": None, "completed_by": None, "invoice_amount": 0})
	doc.save(ignore_permissions=True)  # the Planner may mark it; the amount is written by the system, unseen
	return doc.status


NOTIFICATIONS = [
	{
		"name": "Project Invoicing: Ready to Invoice",
		"document_type": "Project Invoicing", "event": "Value Change", "value_changed": "status",
		"condition": 'doc.status == "Ready to Invoice"',
		"channel": "Email", "send_system_notification": 1,
		"subject": "Ready to invoice: {{ doc.invoice_label or doc.name }} of {{ doc.project }}",
		"message": """<p>The job of <b>{{ doc.invoice_label or doc.name }}</b> is completed and ready to invoice.</p>
<table>
<tr><td>Project</td><td><b>{{ doc.project }}</b></td></tr>
<tr><td>Customer</td><td>{{ doc.customer or "" }}</td></tr>
<tr><td>Invoice</td><td>{{ doc.invoice_percentage }}% &middot; <b>{{ doc.get_formatted("invoice_amount") }}</b></td></tr>
<tr><td>Description</td><td>{{ doc.invoice_description or "" }}</td></tr>
<tr><td>Completed</td><td>{{ doc.get_formatted("completion_date") }} by {{ doc.completed_by }}</td></tr>
</table>
{% set opportunity = frappe.db.get_value("Project", doc.project, "custom_opportunity") %}
{% set contract = opportunity and frappe.db.get_value("Opportunity", opportunity, "custom_signed_contract") %}
<p>{% if doc.job_completion %}<a href='{{ frappe.utils.get_url(doc.job_completion) }}'>Job Completion</a> &middot; {% endif %}
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
