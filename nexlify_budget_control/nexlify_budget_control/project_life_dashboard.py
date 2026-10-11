"""Project Life numbers for the workspaces, the CEO Dashboard and Pipeline Status: counts and averages over the stages
of the Project Lives the user may see (User Permissions, such as Company, apply through frappe.get_list). What only
time changes is worked out here, never stored: a stage is overdue once its due_on has passed, and an open stage's days
run to now."""

import frappe
from frappe.utils import flt, get_datetime, get_first_day, now_datetime, time_diff_in_hours, today

from nexlify_budget_control.nexlify_budget_control.project_life import LIFE, STAGE

OPEN_FIELDS = ["name", "is_open", "is_scheduled", "due_on", "waiting_on", "reference_doctype"]


def lives(filters=None):
	"""The Project Lives the user may see, narrowed by filters on the Project Life (company, project, customer)."""
	if not frappe.has_permission(LIFE, "read"):
		return []
	return frappe.get_list(LIFE, filters=filters or {}, pluck="name", limit_page_length=0)


def stages(life_names, filters=None, fields=None, order_by="entered_on asc"):
	"""Stages of the given Project Lives."""
	if not life_names:
		return []
	return frappe.get_all(STAGE, filters={"parenttype": LIFE, "parent": ["in", list(life_names)], **(filters or {})},
		fields=fields or ["name"], order_by=order_by, limit_page_length=0)


def is_overdue(row, now=None):
	return bool(row.get("is_open") and row.get("due_on") and get_datetime(row.due_on) < (now or now_datetime()))


def is_waiting(row, now=None):
	"""An open stage waits on someone, except one due on a date (a pending invoice) before that date comes."""
	return bool(row.get("is_open")) and (not row.get("is_scheduled") or is_overdue(row, now))


def days_so_far(row, now=None):
	"""An open stage's days to now; a closed stage's stored duration."""
	if row.get("is_open"):
		return flt(time_diff_in_hours(now or now_datetime(), row.entered_on) / 24, 2)
	return flt(row.get("duration_days"))


def team(roles):
	"""A team's name from the roles a stage waits on: Planning Manager -> Planning."""
	out = []
	for role in (roles or "").split(", "):
		for suffix in (" Manager", " User"):
			if role.endswith(suffix):
				role = role[: -len(suffix)]
				break
		if role:
			out.append(role)
	return ", ".join(out)


def revisions(life_names):
	"""Estimations back at the first state of their Workflow, coming from another stage, this month."""
	from frappe.model.workflow import get_workflow_name

	workflow = get_workflow_name("Project Estimation")
	states = frappe.get_cached_doc("Workflow", workflow).states if workflow else []
	if not states:
		return 0
	return len(stages(life_names, {"reference_doctype": "Project Estimation", "stage": states[0].state,
		"previous_stage": ["is", "set"], "entered_on": [">=", get_first_day(today())]}))


def _open(extra=None):
	now = now_datetime()
	return [r for r in stages(lives(), {"is_open": 1, **(extra or {})}, fields=OPEN_FIELDS) if is_waiting(r, now)]


def _overdue(extra=None):
	now = now_datetime()
	return {"value": sum(1 for r in _open(extra) if is_overdue(r, now)), "fieldtype": "Int"}


def _average(extra):
	rows = stages(lives(), {"is_open": 0, "is_backfilled": 0, **extra}, fields=["duration_days"])
	return {"value": flt(sum(flt(r.duration_days) for r in rows) / len(rows), 2) if rows else 0, "fieldtype": "Float"}


@frappe.whitelist()
def overdue_stages(filters=None):
	"""Number Card Overdue Stages."""
	return _overdue()


@frappe.whitelist()
def overdue_in_estimation(filters=None):
	"""Number Card Overdue in Estimation."""
	return _overdue({"waiting_on": ["like", "%Estimation Manager%"]})


@frappe.whitelist()
def overdue_in_planning(filters=None):
	"""Number Card Overdue in Planning."""
	return _overdue({"waiting_on": ["like", "%Planning Manager%"]})


@frappe.whitelist()
def overdue_supply_requests(filters=None):
	"""Number Card Overdue Supply Requests."""
	return _overdue({"reference_doctype": "Supply Request"})


@frappe.whitelist()
def waiting_on_sales(filters=None):
	"""Number Card Waiting on Sales: Estimations waiting on Sales now."""
	return {"value": len(_open({"reference_doctype": "Project Estimation", "waiting_on": ["like", "%Sales User%"]})), "fieldtype": "Int"}


@frappe.whitelist()
def revisions_this_month(filters=None):
	"""Number Card Revisions This Month."""
	return {"value": revisions(lives()), "fieldtype": "Int"}


@frappe.whitelist()
def average_days_to_price(filters=None):
	"""Number Card Average Days to Price: finished Supply Request stages it waited in for its price."""
	from nexlify_budget_control.nexlify_budget_control.supply_chain import PENDING

	return _average({"reference_doctype": "Supply Request", "stage": PENDING})


@frappe.whitelist()
def average_days_for_coo_approval(filters=None):
	"""Number Card Average Days for COO Approval: finished Overview stages that waited on the COO."""
	return _average({"reference_doctype": "Project Overview", "waiting_on": "COO"})


@frappe.whitelist()
def average_days_for_ceo_approval(filters=None):
	"""Number Card Average Days for CEO Approval: finished Overview stages that waited on the CEO."""
	return _average({"reference_doctype": "Project Overview", "waiting_on": "CEO"})


def by_team(measure="waiting"):
	"""Per team: stages waiting now, overdue now, or the average days of the finished stages."""
	now, values = now_datetime(), {}
	if measure == "average":
		totals = {}
		for r in stages(lives(), {"is_open": 0, "is_backfilled": 0, "waiting_on": ["is", "set"]}, fields=["waiting_on", "duration_days"]):
			t = totals.setdefault(team(r.waiting_on), [0.0, 0])
			t[0] += flt(r.duration_days)
			t[1] += 1
		values = {k: flt(s / n, 2) for k, (s, n) in totals.items()}
	else:
		for r in _open({"waiting_on": ["is", "set"]}):
			if measure == "overdue" and not is_overdue(r, now):
				continue
			values[team(r.waiting_on)] = values.get(team(r.waiting_on), 0) + 1
	labels = sorted(values, key=lambda k: -values[k])
	name = {"waiting": "Waiting Now", "overdue": "Overdue Now", "average": "Average Days"}.get(measure, measure)
	return {"labels": labels, "datasets": [{"name": name, "values": [values[k] for k in labels]}]}


def _estimation(states):
	"""Stage filter: Project Estimation stages in the given workflow states (read from the Workflow, see estimation_flow)."""
	return {"reference_doctype": "Project Estimation", "stage": ["in", sorted(states) or [""]]}


@frappe.whitelist()
def waiting_for_price_approval(filters=None):
	"""Number Card Waiting for Price Approval: Estimations with the COO or the CEO now."""
	from nexlify_budget_control.nexlify_budget_control.estimation_flow import pending

	return {"value": len(_open(_estimation(pending()))), "fieldtype": "Int"}


@frappe.whitelist()
def average_days_for_coo_price_approval(filters=None):
	"""Number Card Average Days for COO Price Approval: finished Estimation stages that waited on the COO."""
	return _average({"reference_doctype": "Project Estimation", "waiting_on": "COO"})


@frappe.whitelist()
def average_days_for_ceo_price_approval(filters=None):
	"""Number Card Average Days for CEO Price Approval: finished Estimation stages that waited on the CEO."""
	return _average({"reference_doctype": "Project Estimation", "waiting_on": "CEO"})


@frappe.whitelist()
def contracts_in_negotiation(filters=None):
	"""Number Card Contracts in Negotiation: Estimations in contract review or waiting on Sales for the changes, now."""
	from nexlify_budget_control.nexlify_budget_control.estimation_flow import changes_requested, contract_review

	return {"value": len(_open(_estimation(contract_review() | changes_requested()))), "fieldtype": "Int"}


@frappe.whitelist()
def contract_rounds_this_month(filters=None):
	"""Number Card Contract Rounds This Month: each time Sales sent a contract to Estimation this month."""
	from nexlify_budget_control.nexlify_budget_control.estimation_flow import contract_review

	return {"value": len(stages(lives(), {**_estimation(contract_review()), "entered_on": [">=", get_first_day(today())]})),
		"fieldtype": "Int"}


@frappe.whitelist()
def average_days_from_agreed_to_won(filters=None):
	"""Number Card Average Days from Agreed to Won: from the contract agreed to the Closed Won with the signed contract."""
	from nexlify_budget_control.nexlify_budget_control.estimation_flow import agreed

	return _average(_estimation(agreed()))
