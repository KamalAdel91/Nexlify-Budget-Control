"""Business Process Map: the Custom HTML Block on the ALSA Projects and team workspaces, and the map on the Project
Life form.

The block's HTML, CSS and JS live in this folder and are copied into the Custom HTML Block on every migrate; the
drawing itself is public/js/process_map.js, shared with the Project Life form. The steps live in steps.json. Every
status the map shows is read from the Workflow definitions or from our status constants, never typed into the map.
"""

import json
import os
import re

import frappe

BLOCK_NAME = "Business Process Map"
HERE = os.path.dirname(os.path.abspath(__file__))
CEO_LIMIT_WORKFLOW = "Project Overview Approval"
CEO_LIMIT_DOCTYPE, CEO_LIMIT_FIELD = "Project Overview", "contract_value"
HIDDEN_LIMIT = "the CEO limit"


def _read(filename):
	with open(os.path.join(HERE, filename), encoding="utf-8") as f:
		return f.read()


def seed_process_map():
	"""Creates the Business Process Map block, or refreshes it when its files changed."""
	values = {
		"html": _read("process_map.html"),
		"style": _read("process_map.css"),
		"script": _read("process_map.js"),
		"private": 0,
	}
	if not frappe.db.exists("Custom HTML Block", BLOCK_NAME):
		frappe.get_doc({"doctype": "Custom HTML Block", **values}).insert(ignore_permissions=True, set_name=BLOCK_NAME)
		return
	doc = frappe.get_doc("Custom HTML Block", BLOCK_NAME)
	if any(doc.get(key) != value for key, value in values.items()):
		doc.update(values)
		doc.save(ignore_permissions=True)


@frappe.whitelist()
def get_process_map():
	"""The steps from steps.json, each with the status it leaves its document in."""
	data = json.loads(_read("steps.json"))
	names = {s["status"]["workflow"] for s in data["steps"] if s.get("status", {}).get("workflow")}
	workflows = _workflows(names | {CEO_LIMIT_WORKFLOW})
	for step in data["steps"]:
		step["status_after"], step["status_doctype"] = _resolve(step.pop("status", None) or {}, workflows)
	limit = _ceo_limit(workflows.get(CEO_LIMIT_WORKFLOW))
	return json.loads(json.dumps(data).replace("{ceo_limit}", limit))


def _workflows(names):
	"""Active workflows by name, with their document type and transitions."""
	out = {
		w.name: frappe._dict(doctype=w.document_type, transitions=[])
		for w in frappe.get_all(
			"Workflow", filters={"name": ["in", list(names)], "is_active": 1}, fields=["name", "document_type"]
		)
	}
	if out:
		for row in frappe.get_all(
			"Workflow Transition",
			filters={"parenttype": "Workflow", "parent": ["in", list(out)]},
			fields=["parent", "state", "action", "next_state", "allowed", "condition"],
			order_by="parent asc, idx asc",
		):
			out[row.parent].transitions.append(row)
	return out


def _resolve(ref, workflows):
	"""(status, doctype) for a step: a status constant, a workflow's first state, or where an action leads."""
	if ref.get("constant"):
		try:
			return frappe.get_attr(ref["constant"]), ref.get("doctype", "")
		except (ImportError, AttributeError):
			return "", ref.get("doctype", "")
	wf = workflows.get(ref.get("workflow"))
	if not wf:
		return "", ""
	if ref.get("initial"):
		first = frappe.get_all(
			"Workflow Document State",
			filters={"parenttype": "Workflow", "parent": ref["workflow"]},
			pluck="state",
			order_by="idx asc",
			limit=1,
		)
		return (first[0] if first else ""), wf.doctype
	states = []
	for row in wf.transitions:
		if row.action == ref.get("action") and ref.get("allowed") in (None, row.allowed) and row.next_state not in states:
			states.append(row.next_state)
	return " or ".join(states), wf.doctype


def _ceo_limit(wf):
	"""The CEO limit from the Overview workflow condition, only for users who may read the contract value."""
	meta = frappe.get_meta(CEO_LIMIT_DOCTYPE)
	field = meta.get_field(CEO_LIMIT_FIELD)
	if not wf or not field or field.permlevel not in meta.get_permlevel_access("read"):
		return HIDDEN_LIMIT
	for row in wf.transitions:
		match = re.search(rf"{CEO_LIMIT_FIELD}\s*>\s*([\d_,.]+)", row.condition or "")
		if match:
			return f"{float(match.group(1).replace('_', '').replace(',', '')):,.0f}"
	return HIDDEN_LIMIT


def _from_states(ref, workflows):
	"""The stages a step works in: those its action leaves (from the Workflow), or the status constant given."""
	if ref.get("constant"):
		try:
			return {frappe.get_attr(ref["constant"])}
		except (ImportError, AttributeError):
			return set()
	wf = workflows.get(ref.get("workflow"))
	if not wf or ref.get("initial"):
		return set()
	return {r.state for r in wf.transitions if r.action == ref.get("action") and ref.get("allowed") in (None, r.allowed)}


def _step_progress(step, rows, workflows):
	"""One step for one project: done when its document reaches the stage the step leads to ("done", else "status"),
	started when it entered the stage the step works in ("from", else the one the action leaves). A step done once per
	document ("each": Supply Requests, invoices) is done when every document still going has reached it."""
	done_ref = step.get("done") or step.get("status") or {}
	status, doctype = _resolve(done_ref, workflows)
	done_states = {s for s in status.split(" or ") if s}
	from_states = _from_states(step.get("from") or done_ref, workflows)
	mine = [r for r in rows if r.reference_doctype == doctype]
	reached, last = {}, {}
	for r in mine:
		last[r.reference_name] = r
		if r.stage in done_states and r.reference_name not in reached:
			reached[r.reference_name] = r.entered_on
	# a document that ended elsewhere (cancelled) without reaching the step does not count
	docs = [n for n, r in last.items() if n in reached or r.is_open]
	if from_states:
		started = next((r.entered_on for r in mine if r.stage in from_states), None)
	else:
		started = mine[0].entered_on if mine else None
	if step.get("each"):
		done = bool(docs) and all(n in reached for n in docs)
		finished = max(reached[n] for n in docs) if done else None
		count = sum(1 for n in docs if n in reached)
	else:
		done = bool(reached)
		finished = min(reached.values()) if done else None
		count = len(reached)
	return {"state": None, "done": done, "started": started, "finished": finished, "reached": count, "total": len(docs),
		"open": [{"reference_name": n, "stage": r.stage, "waiting_on": r.waiting_on, "entered_on": r.entered_on,
			"due_on": r.due_on, "is_scheduled": r.is_scheduled} for n, r in last.items() if r.is_open]}


def _step_states(raw, progress, life_open):
	"""done; skipped (an optional step, or a once-per-document step with no document, passed by a later one); done
	before the records start (passed by a later step, never reached); now (the first step still to do, while the
	project has an open stage); part done; not yet."""
	later = [False] * len(progress)
	seen = False
	for i in range(len(progress) - 1, -1, -1):
		later[i] = seen
		seen = seen or progress[i]["done"] or progress[i]["reached"] > 0
	now_given = False
	for s, p, passed in zip(raw, progress, later):
		if p["done"]:
			p["state"] = "done"
		elif passed and (s.get("optional") or (s.get("each") and not p["total"])):
			p["state"] = "skipped"
		elif passed and not p["reached"] and not p["open"]:
			p["state"] = "done"
		elif life_open and not now_given:
			p["state"], now_given = "now", True
		else:
			p["state"] = "part" if (p["reached"] or p["open"]) else "todo"


@frappe.whitelist()
def get_life_map(life):
	"""The map with one project's progress on each step."""
	from nexlify_budget_control.nexlify_budget_control.project_life import LIFE, STAGE

	frappe.has_permission(LIFE, "read", doc=life, throw=True)
	data = get_process_map()
	raw = json.loads(_read("steps.json"))["steps"]
	refs = [r for s in raw for r in (s.get("status"), s.get("done"), s.get("from")) if r]
	workflows = _workflows({r["workflow"] for r in refs if r.get("workflow")})
	rows = frappe.get_all(STAGE, filters={"parent": life, "parenttype": LIFE},
		fields=["reference_doctype", "reference_name", "stage", "waiting_on", "is_open", "entered_on", "due_on", "is_scheduled"],
		order_by="entered_on asc, idx asc")
	progress = [_step_progress(s, rows, workflows) for s in raw]
	_step_states(raw, progress, any(r.is_open for r in rows))
	for step, p in zip(data["steps"], progress):
		step["progress"] = p
	return data
