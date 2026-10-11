"""Pipeline Status: every stage that waits on someone now, from Project Life."""

import frappe
from frappe import _
from frappe.utils import now_datetime

from nexlify_budget_control.nexlify_budget_control.project_life import LIFE
from nexlify_budget_control.nexlify_budget_control.project_life_dashboard import days_so_far, is_overdue, is_waiting, lives, stages

FIELDS = ["parent", "reference_doctype", "reference_name", "stage", "previous_stage", "waiting_on", "entered_on", "due_on", "is_open", "is_scheduled"]


def execute(filters=None):
	f = frappe._dict(filters or {})
	names = lives({k: f.get(k) for k in ("customer", "project", "company") if f.get(k)})
	conditions = {"is_open": 1}
	if f.waiting_on:
		conditions["waiting_on"] = ["like", f"%{f.waiting_on}%"]
	if f.reference_doctype:
		conditions["reference_doctype"] = f.reference_doctype
	rows = stages(names, conditions, fields=FIELDS)
	heads = {h.name: h for h in frappe.get_all(LIFE, filters={"name": ["in", list({r.parent for r in rows}) or [""]]},
		fields=["name", "project", "customer"])}
	now, out = now_datetime(), []
	for r in rows:
		if not is_waiting(r, now):
			continue
		r.days = days_so_far(r, now)
		r.is_overdue = 1 if is_overdue(r, now) else 0
		if f.overdue_only and not r.is_overdue:
			continue
		head = heads.get(r.parent) or frappe._dict()
		r.update({"project": head.project, "customer": head.customer, "project_life": r.parent})
		out.append(r)
	out.sort(key=lambda r: -r.days)
	return columns(), out


def columns():
	return [
		{"fieldname": "reference_name", "label": _("Document"), "fieldtype": "Dynamic Link", "options": "reference_doctype", "width": 190},
		{"fieldname": "reference_doctype", "label": _("Type"), "fieldtype": "Link", "options": "DocType", "width": 140},
		{"fieldname": "project", "label": _("Project"), "fieldtype": "Link", "options": "Project", "width": 150},
		{"fieldname": "customer", "label": _("Customer"), "fieldtype": "Link", "options": "Customer", "width": 160},
		{"fieldname": "stage", "label": _("Stage"), "fieldtype": "Data", "width": 150},
		{"fieldname": "waiting_on", "label": _("Waiting On"), "fieldtype": "Data", "width": 150},
		{"fieldname": "entered_on", "label": _("Since"), "fieldtype": "Datetime", "width": 150},
		{"fieldname": "days", "label": _("Days"), "fieldtype": "Float", "precision": 2, "width": 80},
		{"fieldname": "due_on", "label": _("Due"), "fieldtype": "Datetime", "width": 150},
		{"fieldname": "is_overdue", "label": _("Overdue"), "fieldtype": "Check", "width": 80},
		{"fieldname": "previous_stage", "label": _("Came From"), "fieldtype": "Data", "width": 140},
		{"fieldname": "project_life", "label": _("Project Life"), "fieldtype": "Link", "options": "Project Life", "width": 150},
	]
