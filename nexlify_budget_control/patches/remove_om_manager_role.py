import frappe

ROLE = "O&M Manager"


def execute():
	"""The app no longer ships O&M Manager: it only gave read access that Planning Manager already has."""
	if not frappe.db.exists("Role", ROLE):
		return
	frappe.db.delete("Custom DocPerm", {"role": ROLE})
	role = frappe.get_doc("Role", ROLE)
	role.disabled = 1  # Frappe then takes the role off every user, role profile, page, report and workspace
	role.save(ignore_permissions=True)
	frappe.db.savepoint("remove_om_manager_role")
	try:
		frappe.delete_doc("Role", ROLE, ignore_permissions=True)
	except frappe.LinkExistsError:
		# still named in site data (e.g. a workflow): leave it disabled, which grants nothing
		frappe.db.rollback(save_point="remove_om_manager_role")
	frappe.clear_cache()
