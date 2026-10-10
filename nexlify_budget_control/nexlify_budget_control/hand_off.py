"""Hand-off Log: each time a tracked document enters a stage, who it then waits on, and for how long.

Recorded on every save (doc_events "*" on_change), right after the places that change a stage with frappe.db.set_value,
and by sync() every 15 minutes, which catches anything else, opens the first row of a document that has none (from the
time its Version shows it entered its current stage) and refreshes the days of the open rows."""

import frappe
from frappe.utils import flt, get_datetime, now_datetime, time_diff_in_hours

LOG = "Hand-off Log"
RULE = "Hand-off Waiting Rule"
SETTINGS = "Project Budget Settings"
TRACKED = ("Project Estimation", "Supply Request", "Project Planning", "Project Overview", "Project Invoicing")
CONTEXT = ("project", "opportunity", "customer", "company")
# Who may take a step out of a stage waits on it; these never count as waiting
IGNORED_ROLES = ("System Manager", "Administrator", "All", "Guest")
IGNORED_ACTIONS = ("Cancel",)
SEEDED = "nexlify_hand_off_rules_seeded"
DEFAULT_RULES = (
	("Project Overview", "In Planning", "Planning Manager"),
	("Project Invoicing", "Pending", "Planning Manager"),
	("Project Invoicing", "Ready to Invoice", "Accounts User"),
	("Project Invoicing", "Ordered", "Accounts User"),
)


def _workflow(doctype):
	from frappe.model.workflow import get_workflow_name

	return get_workflow_name(doctype)


def _stage_field(doctype):
	name = _workflow(doctype)
	return (name and frappe.get_cached_value("Workflow", name, "workflow_state_field")) or "status"


def waiting_on(doctype, stage):
	"""A Waiting Rule (Project Budget Settings, Hand-offs) wins; else the roles allowed a step out of the stage."""
	rules = frappe.get_all(RULE, filters={"parent": SETTINGS, "document_type": doctype, "stage": stage}, pluck="waiting_on")
	if rules:
		return ", ".join(sorted({r for r in rules if r}))
	name = _workflow(doctype)
	if not name:
		return ""
	return ", ".join(sorted({t.allowed for t in frappe.get_cached_doc("Workflow", name).transitions
		if t.state == stage and t.action not in IGNORED_ACTIONS and t.allowed not in IGNORED_ROLES}))


def _last(doctype, name):
	rows = frappe.get_all(LOG, filters={"reference_doctype": doctype, "reference_name": name},
		fields=["name", "stage", "entered_on", "is_open"], order_by="entered_on desc, creation desc", limit=1)
	return rows[0] if rows else None


def _enter(doctype, name, stage, at, by, last=None, backfilled=False):
	"""Close the open row (if any) and open the row of the new stage; a stage nobody waits on is closed at once."""
	at = get_datetime(at)
	if last and last.is_open:
		frappe.db.set_value(LOG, last.name, {"is_open": 0, "left_on": at, "left_by": by, "next_stage": stage,
			"duration_days": flt(time_diff_in_hours(at, last.entered_on) / 24, 2)}, update_modified=False)
	if not stage:
		return
	meta = frappe.get_meta(doctype)
	context = frappe.db.get_value(doctype, name, [f for f in CONTEXT if meta.has_field(f)], as_dict=True) or {}
	who = waiting_on(doctype, stage)
	frappe.get_doc({"doctype": LOG, "reference_doctype": doctype, "reference_name": name, "stage": stage,
		"waiting_on": who, "is_open": 1 if who else 0, "entered_on": at, "entered_by": by,
		"left_on": None if who else at, "duration_days": 0, "is_backfilled": 1 if backfilled else 0,
		**context}).insert(ignore_permissions=True)


def record(doctype, name):
	"""Right after a stage may have changed: on save, or after a frappe.db.set_value on the stage."""
	if doctype not in TRACKED or not name:
		return
	stage = frappe.db.get_value(doctype, name, _stage_field(doctype))
	last = _last(doctype, name)
	if last and last.stage == stage:
		return
	_enter(doctype, name, stage, now_datetime(), frappe.session.user, last)


def on_change(doc, method=None):
	"""doc_events "*": cheap for the others, one read for the tracked ones."""
	if doc.doctype in TRACKED:
		record(doc.doctype, doc.name)


def _entered(doctype, name, field, stage, after=None):
	"""When the document entered stage: the latest Version that changed field to stage (none older than after)."""
	for v in frappe.get_all("Version", filters={"ref_doctype": doctype, "docname": name},
							fields=["data", "creation", "owner"], order_by="creation desc", limit=100):
		if after and get_datetime(v.creation) <= get_datetime(after):
			return None
		try:
			changed = (frappe.parse_json(v.data) or {}).get("changed") or []
		except Exception:
			continue
		if any(len(c) == 3 and c[0] == field and c[2] == stage for c in changed):
			return v.creation, v.owner
	return None


def sync():
	"""Every 15 minutes (scheduler), and once by hand when the log starts on a site."""
	for doctype in TRACKED:
		field = _stage_field(doctype)
		for d in frappe.get_all(doctype, fields=["name", field, "creation", "owner", "modified", "modified_by"]):
			stage = d.get(field)
			last = _last(doctype, d.name)
			if last and last.stage == stage:
				continue
			if not last:
				at, by = _entered(doctype, d.name, field, stage) or (d.creation, d.owner)
				_enter(doctype, d.name, stage, at, by, backfilled=True)
			else:
				at, by = _entered(doctype, d.name, field, stage, after=last.entered_on) or (d.modified, d.modified_by)
				_enter(doctype, d.name, stage, at, by, last)
	frappe.db.sql(f"""update `tab{LOG}` set duration_days = round(timestampdiff(minute, entered_on, %s) / 1440, 2)
		where is_open = 1""", now_datetime())
	frappe.db.commit()


def seed_rules():
	"""Once per site (after_install / after_migrate): the default Waiting Rules. Edited or removed later from the UI,
	they never come back."""
	if frappe.db.get_default(SEEDED):
		return
	have = {(r.document_type, r.stage) for r in frappe.get_all(RULE, filters={"parent": SETTINGS}, fields=["document_type", "stage"])}
	idx = len(have)
	for doctype, stage, role in DEFAULT_RULES:
		if (doctype, stage) in have or not frappe.db.exists("Role", role):
			continue
		idx += 1
		frappe.get_doc({"doctype": RULE, "parent": SETTINGS, "parenttype": SETTINGS, "parentfield": "hand_off_rules",
			"idx": idx, "document_type": doctype, "stage": stage, "waiting_on": role}).db_insert()
	frappe.db.set_default(SEEDED, 1)


@frappe.whitelist()
def get_hand_off(doctype, name):
	"""The document's latest row, for the note at the top of its form."""
	if doctype not in TRACKED:
		return None
	frappe.has_permission(doctype, "read", doc=name, throw=True)
	rows = frappe.get_all(LOG, filters={"reference_doctype": doctype, "reference_name": name},
		fields=["stage", "waiting_on", "entered_on", "duration_days", "is_open"], order_by="entered_on desc, creation desc", limit=1)
	return rows[0] if rows else None
