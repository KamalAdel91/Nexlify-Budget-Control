import frappe


def execute():
	"""The Project Life's own stage emails gave way to one Notification per stage on the document; turn them off."""
	for name in frappe.get_all("Notification", filters={"document_type": "Project Life", "event": "Method",
			"method": ["in", ["nexlify_stage_entered", "nexlify_stage_overdue"]], "enabled": 1}, pluck="name"):
		frappe.db.set_value("Notification", name, "enabled", 0)
