import re

import frappe
from frappe import _

YEAR = re.compile(r"^([A-Z]+)-([A-Z]+)-(20\d\d)-")
TAIL = re.compile(r"^(.*?)(\d+)(-\d+)?$")
# Operational documents only. Invoices and payments keep their names (their ledger entries use them).
DOCTYPES = ["Project", "Opportunity", "Project Cost Budget", "Project Planning", "Project Overview",
            "Project Equipment Scope", "Project Planning Scope", "Project Visits", "Project Invoicing"]


def _plan():
	plan, clashes = [], []
	for dt in DOCTYPES:
		if not frappe.db.table_exists(dt):
			continue
		existing = set(frappe.get_all(dt, pluck="name"))
		for name in frappe.get_all(dt, pluck="name", order_by="creation asc"):
			new = YEAR.sub(r"\1-\2-", name)
			if new == name:
				continue
			if new in existing:
				clashes.append([dt, name, new])
				continue
			existing.add(new)
			plan.append([dt, name, new])
	return plan, clashes


@frappe.whitelist()
def preview_drop_year():
	frappe.only_for("System Manager")
	plan, clashes = _plan()
	summary = {}
	for dt, old, new in plan:
		summary.setdefault(dt, []).append([old, new])
	return {"total": len(plan), "clashes": clashes,
			"summary": {dt: {"count": len(v), "examples": v[:3]} for dt, v in summary.items()}}


@frappe.whitelist()
def apply_drop_year():
	frappe.only_for("System Manager")
	frappe.enqueue(_apply, queue="long", timeout=3600, user=frappe.session.user)
	return "queued"


def _apply(user=None):
	plan, clashes = _plan()
	maxes, done = {}, 0
	for dt, old, new in plan:
		frappe.rename_doc(dt, old, new, force=True)
		frappe.db.commit()
		m = TAIL.match(new)
		if m:
			maxes[m.group(1)] = max(maxes.get(m.group(1), 0), int(m.group(2)))
		done += 1
	for prefix, current in maxes.items():
		frappe.db.sql("""insert into `tabSeries` (name, current) values (%s, %s)
			on duplicate key update current = greatest(current, values(current))""", (prefix, current))
	frappe.db.commit()
	msg = _("Removed the year from {0} document names.").format(done)
	if clashes:
		msg += " " + _("{0} skipped because the new name is already taken.").format(len(clashes))
	frappe.get_doc("Project Budget Settings").add_comment("Info", msg)
	frappe.db.commit()
	if user:
		frappe.publish_realtime("msgprint", msg, user=user)
