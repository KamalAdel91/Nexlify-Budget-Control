"""Where the ALSA Projects app icon opens, per role.

Editable from Project Budget Settings > Access > ALSA Projects Landing.
The first row matching one of the user's roles wins.
"""

import frappe

SETTINGS = "Project Budget Settings"
FIELD = "alsa_landing_rules"

DEFAULT_LANDING = [
	("System Manager", "/desk/alsa-projects"),
	("CEO", "/desk/alsa-projects"),
	("COO", "/desk/alsa-projects"),
	("Estimation Manager", "/desk/estimation"),
	("Planning Manager", "/desk/planning"),
]


def get_landing_rules():
	rows = frappe.get_all(
		"ALSA Landing Rule",
		filters={"parenttype": SETTINGS, "parentfield": FIELD},
		fields=["role", "landing_route"],
		order_by="idx asc",
	)
	return [(r.role, r.landing_route) for r in rows] or DEFAULT_LANDING


def seed_alsa_landing_rules():
	"""Fill the table with the defaults once. Never touches a table that has rows."""
	if not frappe.db.exists("DocType", "ALSA Landing Rule"):
		return
	if frappe.db.count("ALSA Landing Rule", {"parenttype": SETTINGS, "parentfield": FIELD}):
		return
	if any(not frappe.db.exists("Role", role) for role, _ in DEFAULT_LANDING):
		return  # roles not synced yet (fresh install); the next migrate seeds it

	settings = frappe.get_single(SETTINGS)
	for role, route in DEFAULT_LANDING:
		settings.append(FIELD, {"role": role, "landing_route": route})
	settings.flags.ignore_permissions = True
	settings.flags.ignore_mandatory = True
	settings.save()
