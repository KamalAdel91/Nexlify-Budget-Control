import frappe

from nexlify_budget_control.nexlify_budget_control.landing import get_landing_rules

no_cache = 1


def get_context(context):
	if frappe.session.user == "Guest":
		frappe.local.flags.redirect_location = "/login?redirect-to=/alsa-projects"
		raise frappe.Redirect

	roles = set(frappe.get_roles())
	frappe.local.flags.redirect_location = next(
		(route for role, route in get_landing_rules() if role in roles), "/desk"
	)
	raise frappe.Redirect
