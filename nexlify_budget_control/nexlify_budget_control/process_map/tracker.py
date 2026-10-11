"""The Business Process side panel (nexlify_tracker) on our documents: the steps of steps.json that belong to the
document's DocType, with the same progress as its Project Life, instead of one line per Workflow state."""

import frappe
from frappe import _

STATUS = {"done": "done", "now": "current", "lost": "exit", "skipped": "skipped", "todo": "todo", "part": "todo"}


def tracker_stages(doctype, docname):
	"""nexlify_tracker_stages hook. None (the panel's own steps) when there is no Project Life the user may read, or
	when the document was cancelled."""
	if not docname:
		return None
	from nexlify_budget_control.nexlify_budget_control import estimation_flow as flow
	from nexlify_budget_control.nexlify_budget_control.process_map.process_map import get_life_map
	from nexlify_budget_control.nexlify_budget_control.project_life import LIFE, STAGE

	if doctype == "Project Estimation" and frappe.db.get_value(doctype, docname, "workflow_state") in flow.reached_by(flow.CANCEL):
		return None
	life = frappe.db.get_value(STAGE, {"parenttype": LIFE, "reference_doctype": doctype, "reference_name": docname}, "parent")
	if not life or not frappe.has_permission(LIFE, "read", doc=life):
		return None
	data = get_life_map(life)
	rounds = frappe.db.count("Project Estimation Contract Round", {"parent": docname, "parenttype": doctype,
		"direction": "From Sales"}) if doctype == "Project Estimation" else 0

	stages = []
	for step in data["steps"]:
		if step.get("status_doctype") != doctype:
			continue
		p = step["progress"]
		status = STATUS.get(p["state"], "todo")
		user = on = None
		note = step["team"]
		if status == "done" and p.get("finished"):
			on = p["finished"]
			user = next((e.get("entered_by") for e in reversed(p.get("events") or []) if e.get("entered_on") == on), None)
		elif status == "skipped":
			note = _("{0} · Not needed").format(step["team"])
		elif status == "current" and p.get("open"):
			o = p["open"][0]
			note = _("Waiting on {0} · {1}").format(o.get("waiting_on") or step["team"], frappe.utils.pretty_date(o["entered_on"]))
		stages.append({"state": step["title"], "status": status, "user": user, "on": on, "note": note,
			"badge": _("Round {0}").format(rounds) if rounds and step.get("short") == "Contract" and status != "todo" else None})

	users = {s["user"] for s in stages if s["user"]}
	info = {u.name: u for u in frappe.get_all("User", filters={"name": ("in", list(users))},
		fields=["name", "full_name", "user_image"])} if users else {}
	for s in stages:
		u = info.get(s["user"]) or {}
		s["full_name"] = u.get("full_name") or s["user"]
		s["user_image"] = u.get("user_image") or ""

	banner = None
	if any(s["status"] == "exit" for s in stages):
		reasons = ", ".join(_(r) for r in data.get("lost_reasons") or [])
		banner = _("Lost on {0}").format(frappe.format(data.get("ended_on"), "Date")) + (f" · {reasons}" if reasons else "")
	return {"stages": stages, "workflow_field": "workflow_state", "tasks": [], "banner": banner}
