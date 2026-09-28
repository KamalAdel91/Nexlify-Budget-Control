import frappe


def execute():
	"""New setting: on by default. Set once, only if the site never saved a value for it."""
	saved = frappe.db.sql("""select 1 from tabSingles where doctype = 'Project Budget Settings'
		and field = 'show_create_estimation_on_project'""")
	if not saved:
		frappe.db.set_single_value("Project Budget Settings", "show_create_estimation_on_project", 1)
