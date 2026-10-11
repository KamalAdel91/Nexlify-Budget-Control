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
def get_process_map(workspace=None):
	"""The steps from steps.json, each with the status it leaves its document in. On a team's own workspace the
	policy text is left out for everyone: that screen is the team's."""
	data = json.loads(_read("steps.json"))
	full = _sees_amounts() and not _team_workspace(data, workspace)
	for step in data["steps"]:
		policy = step.pop("policy", None)
		if policy and full:
			step.update(policy)
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


def _team_workspace(data, workspace):
	norm = lambda v: re.sub(r"[-_\s]+", " ", str(v or "")).strip().lower()
	return bool(workspace) and any(norm(t["workspace"]) == norm(workspace) for t in data["teams"] if t.get("workspace"))


def _sees_amounts():
	"""Whoever may read the contract value sees the company's policy on the map: the CEO limit and the
	policy text of the steps. Decided here, so the policy text never reaches anyone else's browser."""
	meta = frappe.get_meta(CEO_LIMIT_DOCTYPE)
	field = meta.get_field(CEO_LIMIT_FIELD)
	return bool(field) and field.permlevel in meta.get_permlevel_access("read")


def _ceo_limit(wf):
	"""The CEO limit from the Overview workflow condition, only for users who may read the contract value."""
	if not wf or not _sees_amounts():
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
	document ("each": Supply Requests, invoices) is done when every document still going has reached it. A document
	still open counts as open for the step only while it stands in the stage the step works in or leads to, so a
	document that has moved on (or was recorded only from a later stage) does not hold an earlier step open."""
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
	# What happened in the step: entering the stage it works in, leaving it, reaching the stage it leads to
	events = [{"reference_doctype": r.reference_doctype, "reference_name": r.reference_name, "stage": r.stage, "previous_stage": r.previous_stage, "entered_on": r.entered_on,
		"entered_by": r.get("entered_by"), "duration_days": r.get("duration_days"), "is_open": r.is_open}
		for r in mine if r.stage in done_states or r.stage in from_states or (from_states and r.previous_stage in from_states)]
	documents = [{"doctype": doctype, "name": n, "stage": r.stage, "is_open": r.is_open} for n, r in last.items()]
	return {"documents": documents, "events": events, "state": None, "done": done, "started": started, "finished": finished, "reached": count, "total": len(docs),
		"open": [{"reference_name": n, "stage": r.stage, "waiting_on": r.waiting_on, "entered_on": r.entered_on,
			"due_on": r.due_on, "is_scheduled": r.is_scheduled} for n, r in last.items() if r.is_open and (not from_states or r.stage in from_states or r.stage in done_states)]}


def _step_states(raw, progress, life_open, outcome=None):
	"""done; skipped (an optional step, or a once-per-document step with no document, passed by a later one); done
	before the records start (passed by a later step, never reached); now (the first step still to do, while the
	project has an open stage); part done (only a once-per-document step after now); not yet."""
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
		elif (life_open or outcome) and not now_given:
			p["state"], now_given = ("lost" if outcome else "now"), True
		elif now_given and not s.get("each"):
			# after the step the project stands at, a step on the same document is not started yet
			p["state"] = "todo"
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
		fields=["reference_doctype", "reference_name", "stage", "previous_stage", "waiting_on", "is_open", "entered_on", "entered_by",
			"duration_days", "due_on", "is_scheduled"],
		order_by="entered_on asc, idx asc")
	progress = [_step_progress(s, rows, workflows) for s in raw]
	head = frappe.db.get_value(LIFE, life, ["outcome", "ended_on", "opportunity", "project"], as_dict=True) or frappe._dict()
	_step_states(raw, progress, any(r.is_open for r in rows), head.outcome)
	for step, p in zip(data["steps"], progress):
		step["progress"] = p
	users = {e["entered_by"] for p in progress for e in p["events"] if e["entered_by"]}
	names = dict(frappe.get_all("User", filters={"name": ["in", list(users) or [""]]}, fields=["name", "full_name"], as_list=True))
	for p in progress:
		for e in p["events"]:
			e["by"] = names.get(e["entered_by"]) or e["entered_by"]
	# A step's "also": the project's Opportunity or Project shown with its own documents
	for s, p in zip(raw, progress):
		extra = []
		for kind in s.get("also") or []:
			if kind == "opportunity" and head.opportunity:
				o = frappe.db.get_value("Opportunity", head.opportunity, ["sales_stage", "status"], as_dict=True) or frappe._dict()
				extra.append({"doctype": "Opportunity", "name": head.opportunity, "stage": o.sales_stage or o.status})
			elif kind == "project" and head.project:
				extra.append({"doctype": "Project", "name": head.project, "stage": frappe.db.get_value("Project", head.project, "status")})
		p["documents"] = extra + p["documents"]
	data["outcome"], data["ended_on"], data["lost_reasons"] = head.outcome, head.ended_on, []
	if head.outcome and head.opportunity:
		data["lost_reasons"] = frappe.get_all("Opportunity Lost Reason Detail",
			filters={"parent": head.opportunity, "parenttype": "Opportunity"}, pluck="lost_reason")
	return data
