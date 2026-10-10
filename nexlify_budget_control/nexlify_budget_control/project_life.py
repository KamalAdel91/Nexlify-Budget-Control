"""Project Life: one document per project, from its Opportunity to its last invoice, with every stage it went through.

A stage row opens when a tracked document enters a stage and closes when it leaves it, at the moment it happens: on every
save (doc_events "*" on_change) and right after the places that change a stage with frappe.db.set_value. Nothing runs on
a schedule. What only time changes is never stored: a row keeps when it is due (due_on) and, once closed, how long it
took and whether it was late; the time so far and overdue are worked out when shown. A stage is due some days after it
starts, or, when its Stage Target names a Due Date Field, on that date of the document (a pending invoice on its
Expected Invoice Date). Saving Project Budget Settings brings the open stages up to date with the Waiting Rules and
Stage Targets. rebuild() fills, once by hand, the lives of documents made before, from their Version history."""

import frappe
from frappe.utils import add_to_date, cint, flt, get_datetime, now_datetime, time_diff_in_hours

LIFE = "Project Life"
STAGE = "Project Life Stage"
RULE = "Project Life Waiting Rule"
TARGET = "Project Life Stage Target"
SETTINGS = "Project Budget Settings"
TRACKED = ("Project Estimation", "Supply Request", "Project Planning", "Project Overview", "Project Invoicing")
# How a tracked document leads to its Opportunity and Project: directly, or through its Estimation or its Plan
LINKS = ("opportunity", "estimation", "cost_budget", "project_planning", "project", "customer", "company")
CONTEXT = ("opportunity", "project", "customer", "company")
# Who may take a step out of a stage waits on it; these never count as waiting
IGNORED_ROLES = ("System Manager", "Administrator", "All", "Guest")
IGNORED_ACTIONS = ("Cancel",)
DEFAULT_TARGET_DAYS = 3
NEVER = "9999-12-31 00:00:00"
# Put in once per site each; edited or removed later from the UI, they never come back
SEEDS = (
	("nexlify_project_life_rules_seeded", "rules", (
		("Project Overview", "In Planning", "Planning Manager"),
		("Project Invoicing", "Pending", "Planning Manager"),
		("Project Invoicing", "Ready to Invoice", "Accounts User"),
		("Project Invoicing", "Ordered", "Accounts User"),
	)),
	# The approval waits on the Overview: the Plan's own Pending Approval would count the COO / CEO twice
	("nexlify_project_life_plan_approval_seeded", "rules", (("Project Planning", "Pending Approval", None),)),
	# A pending invoice waits on the work, not on a person
	("nexlify_project_life_targets_seeded", "targets", (("Project Invoicing", "Pending", 0),)),
	# ... and is due on its Expected Invoice Date
	("nexlify_project_life_invoice_due_seeded", "due", (("Project Invoicing", "Pending", "expected_invoice_date"),)),
)


def _workflow(doctype):
	from frappe.model.workflow import get_workflow_name

	return get_workflow_name(doctype)


def _stage_field(doctype):
	name = _workflow(doctype)
	return (name and frappe.get_cached_value("Workflow", name, "workflow_state_field")) or "status"


def waiting_on(doctype, stage):
	"""A Waiting Rule (Project Budget Settings, Project Life) wins; else the roles allowed a step out of the stage."""
	rules = frappe.get_all(RULE, filters={"parent": SETTINGS, "document_type": doctype, "stage": stage}, pluck="waiting_on")
	if rules:
		return ", ".join(sorted({r for r in rules if r}))
	name = _workflow(doctype)
	if not name:
		return ""
	return ", ".join(sorted({t.allowed for t in frappe.get_cached_doc("Workflow", name).transitions
		if t.state == stage and t.action not in IGNORED_ACTIONS and t.allowed not in IGNORED_ROLES}))


def due(doctype, name, stage, at, who):
	"""(target_days, due_on, is_scheduled) of a stage. A Stage Target with a Due Date Field: due at the end of that date
	of the document. Else the Stage Target's days, or the default target; 0 days: never due. Nobody waits: never due."""
	if not who:
		return 0, None, 0
	rows = frappe.get_all(TARGET, filters={"parent": SETTINGS, "document_type": doctype, "stage": stage},
		fields=["target_days", "due_date_field"], limit=1)
	t = rows[0] if rows else None
	if t and t.due_date_field and frappe.get_meta(doctype).has_field(t.due_date_field):
		date = frappe.db.get_value(doctype, name, t.due_date_field)
		return 0, (get_datetime(f"{str(date)[:10]} 23:59:59") if date else None), 1
	days = cint(t.target_days) if t else cint(frappe.db.get_single_value(SETTINGS, "default_target_days"))
	return days, (add_to_date(at, days=days) if days else None), 0


def _same(a, b):
	return (get_datetime(a) if a else None) == (get_datetime(b) if b else None)


def _context(doctype, name):
	"""The Opportunity, Project, Customer and Company of a tracked document, through its Estimation when not its own."""
	meta = frappe.get_meta(doctype)
	v = frappe.db.get_value(doctype, name, [f for f in LINKS if meta.has_field(f)], as_dict=True) or frappe._dict()
	estimation = name if doctype == "Project Estimation" else (v.get("estimation") or v.get("cost_budget"))
	if not estimation and v.get("project_planning"):
		estimation = frappe.db.get_value("Project Planning", v.project_planning, "estimation")
	est = (estimation and frappe.db.get_value("Project Estimation", estimation, list(CONTEXT), as_dict=True)) or frappe._dict()
	return frappe._dict({c: v.get(c) or est.get(c) for c in CONTEXT})


def _title(ctx):
	"""The customer's name and the Opportunity (or the Project)."""
	customer = ctx.get("customer") and (frappe.db.get_value("Customer", ctx["customer"], "customer_name") or ctx["customer"])
	return " · ".join(filter(None, [customer, ctx.get("opportunity") or ctx.get("project")]))


def _life(doctype, name, at):
	"""The Project Life of a tracked document, made with its first stage, and given its Project once there is one.
	None for a document tied to neither an Opportunity nor a Project."""
	ctx = _context(doctype, name)
	if not (ctx.opportunity or ctx.project):
		return None
	life = (ctx.opportunity and frappe.db.get_value(LIFE, {"opportunity": ctx.opportunity})) or (
		ctx.project and frappe.db.get_value(LIFE, {"project": ctx.project}))
	if life:
		have = frappe.db.get_value(LIFE, life, list(CONTEXT), as_dict=True)
		missing = {c: ctx[c] for c in CONTEXT if ctx[c] and not have.get(c)}
		if missing:
			frappe.db.set_value(LIFE, life, missing, update_modified=False)
		return life
	user, now = frappe.session.user, now_datetime()
	doc = frappe.get_doc({"doctype": LIFE, "started_on": at, "last_event_on": at, "owner": user, "modified_by": user,
		"creation": now, "modified": now, "title": _title(ctx), **{c: ctx[c] for c in CONTEXT if ctx[c]}})
	doc.db_insert()
	return doc.name


def _last(doctype, name):
	rows = frappe.get_all(STAGE, filters={"parenttype": LIFE, "reference_doctype": doctype, "reference_name": name},
		fields=["name", "parent", "stage", "waiting_on", "entered_on", "is_open", "due_on", "is_scheduled", "next_stage"],
		order_by="entered_on desc, creation desc", limit=1)
	return rows[0] if rows else None


def _add_stage(life, values):
	idx = cint(frappe.db.sql(f"select max(idx) from `tab{STAGE}` where parent = %s and parenttype = %s", (life, LIFE))[0][0]) + 1
	user, now = frappe.session.user, now_datetime()
	frappe.get_doc({"doctype": STAGE, "parent": life, "parenttype": LIFE, "parentfield": "stages", "idx": idx,
		"owner": user, "modified_by": user, "creation": now, "modified": now, **values}).db_insert()


def _enter(life, doctype, name, stage, at, by, last=None, backfilled=False):
	"""Close the open stage of the document (if any) and open its new one; a stage nobody waits on is closed at once."""
	at = get_datetime(at)
	if last and last.is_open:
		frappe.db.set_value(STAGE, last.name, {"is_open": 0, "left_on": at, "left_by": by, "next_stage": stage,
			"is_late": 1 if last.due_on and at > get_datetime(last.due_on) else 0,
			"duration_days": flt(time_diff_in_hours(at, last.entered_on) / 24, 2)}, update_modified=False)
	elif last and not last.next_stage:
		frappe.db.set_value(STAGE, last.name, "next_stage", stage, update_modified=False)
	if stage:
		who = waiting_on(doctype, stage)
		target, due_on, scheduled = due(doctype, name, stage, at, who)
		_add_stage(life, {"reference_doctype": doctype, "reference_name": name, "stage": stage,
			"previous_stage": last.stage if last else None, "waiting_on": who, "is_open": 1 if who else 0,
			"target_days": target, "due_on": due_on, "is_scheduled": scheduled,
			"entered_on": at, "entered_by": by, "left_on": None if who else at, "duration_days": 0,
			"is_backfilled": 1 if backfilled else 0})
	_refresh(life)


def _refresh(life):
	"""The summary at the top of the Project Life, from its stages. Where it is now: the latest stage someone is
	working on; when all that is open waits on a date (pending invoices), the one due first."""
	rows = frappe.get_all(STAGE, filters={"parent": life, "parenttype": LIFE},
		fields=["reference_doctype", "reference_name", "stage", "waiting_on", "is_open", "entered_on", "left_on",
			"is_late", "is_scheduled", "due_on"], order_by="entered_on asc, idx asc")
	if not rows:
		return
	open_rows = [r for r in rows if r.is_open]
	working = [r for r in open_rows if not r.is_scheduled]
	if working:
		cur = working[-1]
	elif open_rows:
		cur = min(open_rows, key=lambda r: get_datetime(r.due_on or NEVER))
	else:
		cur = rows[-1]
	frappe.db.set_value(LIFE, life, {
		"started_on": rows[0].entered_on,
		"last_event_on": max(get_datetime(r.left_on or r.entered_on) for r in rows),
		"current_stage": cur.stage, "current_doctype": cur.reference_doctype, "current_name": cur.reference_name,
		"waiting_on": cur.waiting_on if cur.is_open else "", "waiting_since": cur.entered_on if cur.is_open else None,
		"open_stages": len(open_rows), "late_stages": sum(1 for r in rows if r.is_late),
		"title": _title(frappe.db.get_value(LIFE, life, list(CONTEXT), as_dict=True)),
	}, update_modified=False)


def record(doctype, name):
	"""Right after a stage may have changed: on save, or after a frappe.db.set_value on the stage. A save that keeps
	the stage brings a date-driven due date up to date (an Expected Invoice Date moved)."""
	if doctype not in TRACKED or not name:
		return
	stage = frappe.db.get_value(doctype, name, _stage_field(doctype))
	last = _last(doctype, name)
	if last and last.stage == stage:
		if last.is_open and last.is_scheduled:
			_target, due_on, _scheduled = due(doctype, name, stage, last.entered_on, last.waiting_on)
			if not _same(due_on, last.due_on):
				frappe.db.set_value(STAGE, last.name, "due_on", due_on, update_modified=False)
				_refresh(last.parent)
		return
	at = now_datetime()
	life = _life(doctype, name, at) if not last else last.parent
	if not life:
		return
	if last:
		_life(doctype, name, at)  # a Project that came since
	_enter(life, doctype, name, stage, at, frappe.session.user, last)


def on_change(doc, method=None):
	"""doc_events "*": cheap for the others, one read for the tracked ones."""
	if doc.doctype in TRACKED:
		record(doc.doctype, doc.name)


def refresh_open_stages(doc=None, method=None):
	"""Project Budget Settings saved: the open stages take the Waiting Rules and Stage Targets as they are now."""
	touched, now = set(), now_datetime()
	for r in frappe.get_all(STAGE, filters={"parenttype": LIFE, "is_open": 1},
			fields=["name", "parent", "reference_doctype", "reference_name", "stage", "waiting_on", "target_days",
				"due_on", "is_scheduled", "entered_on"]):
		who = waiting_on(r.reference_doctype, r.stage)
		target, due_on, scheduled = due(r.reference_doctype, r.reference_name, r.stage, r.entered_on, who)
		if (who == (r.waiting_on or "") and target == cint(r.target_days) and scheduled == cint(r.is_scheduled)
				and _same(due_on, r.due_on)):
			continue
		values = {"waiting_on": who, "target_days": target, "due_on": due_on, "is_scheduled": scheduled}
		if not who:
			values.update({"is_open": 0, "left_on": now, "duration_days": flt(time_diff_in_hours(now, r.entered_on) / 24, 2)})
		frappe.db.set_value(STAGE, r.name, values, update_modified=False)
		touched.add(r.parent)
	for life in touched:
		_refresh(life)


def _history(doctype, name, field, d):
	"""(stage, when, by) for each stage the document went through, oldest first, from its Version history."""
	current, changes = d.get(field), []
	for v in frappe.get_all("Version", filters={"ref_doctype": doctype, "docname": name},
			fields=["data", "creation", "owner"], order_by="creation asc", limit=500):
		try:
			changed = (frappe.parse_json(v.data) or {}).get("changed") or []
		except Exception:
			continue
		changes += [(c[1], c[2], v.creation, v.owner) for c in changed if len(c) == 3 and c[0] == field and c[1] != c[2]]
	first = changes[0][0] if changes else current
	steps = [(first, d.creation, d.owner)] if first else []
	steps += [(new, at, by) for _old, new, at, by in changes if new]
	if current and (not steps or steps[-1][0] != current):  # moved by a direct write the history does not show
		steps.append((current, d.modified, d.modified_by))
	return steps


def _reorder(life):
	names = frappe.get_all(STAGE, filters={"parent": life, "parenttype": LIFE}, pluck="name", order_by="entered_on asc, creation asc")
	for idx, name in enumerate(names, 1):
		frappe.db.set_value(STAGE, name, "idx", idx, update_modified=False)


@frappe.whitelist()
def rebuild(dry_run=1):
	"""Once by hand on a site: the life of every tracked document that has none yet, from its Version history, then
	the summary of every life. dry_run=1 only counts the documents it would write."""
	frappe.only_for("System Manager")
	dry, counts, touched = cint(dry_run), {}, set()
	for doctype in TRACKED:
		field = _stage_field(doctype)
		for d in frappe.get_all(doctype, fields=["name", field, "creation", "owner", "modified", "modified_by"], order_by="creation asc"):
			if frappe.db.exists(STAGE, {"parenttype": LIFE, "reference_doctype": doctype, "reference_name": d.name}):
				continue
			steps = _history(doctype, d.name, field, d)
			if not steps:
				continue
			if not dry:
				life = _life(doctype, d.name, steps[0][1])
				if not life:
					continue
				last = None
				for stage, at, by in steps:
					_enter(life, doctype, d.name, stage, at, by, last, backfilled=True)
					last = _last(doctype, d.name)
				touched.add(life)
			counts[doctype] = counts.get(doctype, 0) + 1
	for life in touched:
		_reorder(life)
	for life in ([] if dry else frappe.get_all(LIFE, pluck="name")):
		_refresh(life)
	if not dry:
		frappe.db.commit()
	return {"documents": counts, "lives": None if dry else len(touched)}


def seed_rules():
	"""Once per site each (after_install / after_migrate): the default Waiting Rules, Stage Targets and default target."""
	for marker, kind, rows in SEEDS:
		if frappe.db.get_default(marker):
			continue
		if kind == "due":
			for dt, stage, field in rows:
				if not frappe.get_meta(dt).has_field(field):
					continue
				row = frappe.db.get_value(TARGET, {"parent": SETTINGS, "document_type": dt, "stage": stage}, ["name", "due_date_field"], as_dict=True)
				if row and not row.due_date_field:
					frappe.db.set_value(TARGET, row.name, "due_date_field", field, update_modified=False)
				elif not row:
					idx = cint(frappe.db.sql(f"select max(idx) from `tab{TARGET}` where parent = %s", SETTINGS)[0][0]) + 1
					frappe.get_doc({"doctype": TARGET, "parent": SETTINGS, "parenttype": SETTINGS, "parentfield": "project_life_targets",
						"idx": idx, "document_type": dt, "stage": stage, "target_days": 0, "due_date_field": field}).db_insert()
			frappe.db.set_default(marker, 1)
			continue
		doctype, parentfield, valuefield = ((RULE, "project_life_rules", "waiting_on") if kind == "rules"
			else (TARGET, "project_life_targets", "target_days"))
		have = frappe.get_all(doctype, filters={"parent": SETTINGS}, fields=["document_type", "stage", "idx"])
		keys = {(r.document_type, r.stage) for r in have}
		idx = max([r.idx for r in have] or [0])
		for dt, stage, value in rows:
			if (dt, stage) in keys or (kind == "rules" and value and not frappe.db.exists("Role", value)):
				continue
			idx += 1
			frappe.get_doc({"doctype": doctype, "parent": SETTINGS, "parenttype": SETTINGS, "parentfield": parentfield,
				"idx": idx, "document_type": dt, "stage": stage, valuefield: value}).db_insert()
		if kind == "targets" and not frappe.db.sql(
				"select 1 from `tabSingles` where doctype = %s and field = 'default_target_days'", SETTINGS):
			frappe.db.set_single_value(SETTINGS, "default_target_days", DEFAULT_TARGET_DAYS)
		frappe.db.set_default(marker, 1)


@frappe.whitelist()
def get_project_life(doctype, name):
	"""The document's latest stage and its Project Life, for the note and the button on its form."""
	if doctype not in TRACKED:
		return None
	frappe.has_permission(doctype, "read", doc=name, throw=True)
	row = _last(doctype, name)
	if not row:
		return None
	return {"life": row.parent, "stage": row.stage, "waiting_on": row.waiting_on, "entered_on": row.entered_on,
		"is_open": row.is_open, "due_on": row.due_on, "is_scheduled": row.is_scheduled}


@frappe.whitelist()
def get_life_for(doctype, name):
	"""The Project Life of an Opportunity or a Project, for the button on its form."""
	field = {"Opportunity": "opportunity", "Project": "project"}.get(doctype)
	if not field:
		return None
	frappe.has_permission(doctype, "read", doc=name, throw=True)
	return frappe.db.get_value(LIFE, {field: name})
