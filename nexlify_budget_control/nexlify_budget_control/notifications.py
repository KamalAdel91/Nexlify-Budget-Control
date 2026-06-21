"""
notifications.py
------------------
Lightweight in-system notifications for budget stakeholders.
Uses Frappe's built-in Notification Log so alerts appear in the
bell icon for relevant users, without requiring email setup.
"""

import frappe


def notify_project_stakeholders(project, message, reference_doctype=None, reference_name=None):
	"""
	Notifies relevant users about a budget event (threshold warning,
	annual/monthly exceeded, etc).

	Recipients:
	- The Project's assigned users (via ToDo/_assign on the Project doc)
	- The current session user (so they see what triggered it)
	"""
	if not project:
		return

	recipients = set()

	# Current user (who triggered the submit) always gets notified
	if frappe.session.user and frappe.session.user != "Administrator":
		recipients.add(frappe.session.user)

	# Users assigned to the Project document
	assigned = frappe.db.get_all(
		"ToDo",
		filters={
			"reference_type": "Project",
			"reference_name": project,
			"status": "Open",
		},
		fields=["allocated_to"],
	)
	for a in assigned:
		if a.allocated_to:
			recipients.add(a.allocated_to)

	if not recipients:
		return

	for user in recipients:
		_create_notification_log(user, message, reference_doctype, reference_name)


def _create_notification_log(user, message, reference_doctype, reference_name):
	try:
		notification = frappe.new_doc("Notification Log")
		notification.subject = _strip_html_for_subject(message)
		notification.email_content = message
		notification.for_user = user
		notification.type = "Alert"
		if reference_doctype:
			notification.document_type = reference_doctype
		if reference_name:
			notification.document_name = reference_name
		notification.insert(ignore_permissions=True)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "nexlify_budget_control: notification failed")


def _strip_html_for_subject(message, max_length=140):
	"""Produces a plain-text subject line from an HTML-formatted message."""
	import re
	plain = re.sub(r"<[^>]+>", "", message)
	plain = plain.strip()
	if len(plain) > max_length:
		plain = plain[:max_length - 3] + "..."
	return plain