"""
notifications.py
------------------
Lightweight in-system notifications for budget stakeholders.
Uses Frappe's built-in Notification Log so alerts appear in the
bell icon for relevant users, without requiring email setup.
"""

import re

import frappe
from frappe.utils import get_traceback
from nexlify_budget_control.nexlify_budget_control.constants import (
    NOTIFICATION_MAX_SUBJECT_LENGTH,
    NOTIFICATION_TYPE_ALERT,
)


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
    current_user = frappe.session.user
    if current_user and current_user != "Administrator":
        recipients.add(current_user)

    # Users assigned to the Project document
    try:
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
    except Exception:
        frappe.log_error(
            get_traceback(),
            "nexlify_budget_control: failed to fetch project assignees",
        )

    if not recipients:
        return

    for user in recipients:
        _create_notification_log(user, message, reference_doctype, reference_name)


def _create_notification_log(user, message, reference_doctype, reference_name):
    """Creates a notification log entry with error handling."""
    try:
        notification = frappe.new_doc("Notification Log")
        notification.subject = _build_notification_subject(
            project_name_from_message(message)
        )
        notification.email_content = message
        notification.for_user = user
        notification.type = NOTIFICATION_TYPE_ALERT
        if reference_doctype:
            notification.document_type = reference_doctype
        if reference_name:
            notification.document_name = reference_name
        notification.insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(
            get_traceback(),
            "nexlify_budget_control: notification creation failed",
        )


def _build_notification_subject(project_name, max_length=NOTIFICATION_MAX_SUBJECT_LENGTH):
    """
    Builds a concise, clear subject line for budget notifications.
    Format: 'Budget Alert: {project_name}'
    """
    subject = f"Budget Alert: {project_name}"
    if len(subject) > max_length:
        subject = subject[: max_length - 3] + "..."
    return subject


def project_name_from_message(message):
    """Extracts the project name from an HTML-formatted budget message."""
    try:
        # Look for "Project <b>name</b>" pattern
        match = re.search(r"Project\s*<b>([^<]+)</b>", message)
        if match:
            return match.group(1).strip()
    except Exception:
        pass

    # Fallback: strip HTML and truncate
    plain = re.sub(r"<[^>]+>", "", message)
    plain = plain.strip()
    if len(plain) > NOTIFICATION_MAX_SUBJECT_LENGTH:
        plain = plain[: NOTIFICATION_MAX_SUBJECT_LENGTH - 3] + "..."
    return plain
