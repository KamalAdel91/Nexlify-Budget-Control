"""One-time cleanup after moving a v15 site to v16. Remove in final Cleanup.

Run once as System Manager, dry run first:
    frappe.call("nexlify_budget_control.nexlify_budget_control.v16_cleanup.run", {dry_run: 1})
"""

import frappe
from frappe.utils import cint

ROLE_MAP = {"Estimation User": "Estimation Manager", "Planning User": "Planning Manager"}
LEFTOVER_MODULES = ["Projexlify", "Raven (Custom)", "Drive (Custom)", "Frappe CRM"]
OLD_WORKSPACE_SIDEBARS = ["Projexlify", "CEO", "COO", "Estimation", "Planning"]


@frappe.whitelist()
def run(dry_run=1):
	frappe.only_for("System Manager")
	dry = bool(cint(dry_run))
	log = []

	def act(msg, fn):
		log.append(("WOULD " if dry else "") + msg)
		if not dry:
			fn()

	# 1. site-level dock edits that only add leftover module sidebars
	for d in frappe.get_all("Dock", filters=[["standard", "=", 0], ["user", "is", "not set"]], pluck="name"):
		links = frappe.get_all("Dock Item", filters={"parent": d}, pluck="link_to")
		if links and all(l in LEFTOVER_MODULES for l in links):
			act(f"delete Dock {d} {links}", lambda d=d: frappe.delete_doc("Dock", d, force=True))

	# 2. leftover custom modules and their sidebars
	for m in LEFTOVER_MODULES:
		if frappe.db.exists("Sidebar", m) and not frappe.db.get_value("Sidebar", m, "standard"):
			act(f"delete Sidebar {m}", lambda m=m: frappe.delete_doc("Sidebar", m, force=True))
		if frappe.db.get_value("Module Def", m, "custom"):
			ws = frappe.get_all("Workspace", filters={"module": m}, pluck="name")
			if ws:
				log.append(f"SKIP Module Def {m}: still has workspaces {ws}")
			else:
				act(f"delete Module Def {m}", lambda m=m: frappe.delete_doc("Module Def", m, force=True))

	# 3. this app's old-format Workspace Sidebar records
	for w in OLD_WORKSPACE_SIDEBARS:
		if frappe.db.get_value("Workspace Sidebar", w, "module") == "Nexlify Budget Control":
			act(f"delete Workspace Sidebar {w}", lambda w=w: frappe.delete_doc("Workspace Sidebar", w, force=True))

	# 4. merge User roles into Manager (nobody loses access)
	for old, new in ROLE_MAP.items():
		if not frappe.db.exists("Role", old):
			continue
		for dt, field in (("Has Role", "role"), ("Notification Recipient", "receiver_by_role")):
			for r in frappe.get_all(dt, filters={field: old}, fields=["name", "parent", "parenttype"]):
				if frappe.db.exists(dt, {"parent": r.parent, "parenttype": r.parenttype, field: new}):
					act(f"{dt} {r.parenttype} '{r.parent}': drop {old} (has {new})",
						lambda n=r.name, dt=dt: frappe.db.delete(dt, {"name": n}))
				else:
					act(f"{dt} {r.parenttype} '{r.parent}': {old} -> {new}",
						lambda n=r.name, dt=dt, field=field: frappe.db.set_value(dt, n, field, new, update_modified=False))
		n = frappe.db.count("Custom DocPerm", {"role": old})
		if n:
			act(f"delete {n} Custom DocPerm rows of {old}", lambda old=old: frappe.db.delete("Custom DocPerm", {"role": old}))
		still = {
			"DocPerm": frappe.db.count("DocPerm", {"role": old}),
			"workflow states": frappe.db.count("Workflow Document State", {"allow_edit": old}),
			"transitions": frappe.db.count("Workflow Transition", {"allowed": old}),
		}
		if any(still.values()):
			log.append(f"SKIP deleting Role {old}: still referenced {still} (run migrate first)")
		else:
			act(f"delete Role {old}", lambda old=old: frappe.delete_doc("Role", old, force=True))

	if not dry:
		frappe.db.commit()
		frappe.clear_cache()
	return log or ["nothing to clean"]
