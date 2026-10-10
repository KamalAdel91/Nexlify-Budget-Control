"""Business Process Map: the Custom HTML Block on the ALSA Projects workspace.

The block's HTML, CSS and JS live in this folder and are copied into the Custom HTML Block on every
migrate. The steps live in steps.json. Every status the map shows is read from the Workflow
definitions or from our status constants, never typed into the map.
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
