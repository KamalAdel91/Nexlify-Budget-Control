# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

"""
Permissions that this app's own roles need on doctypes owned by other apps
(ERPNext / HRMS). Applied automatically after every migrate (idempotent).
Permissions for ERPNext's default roles are managed from the UI, not here.
"""

import frappe
from frappe.permissions import add_permission, update_permission_property

ESTIMATION_PLANNING = ["Estimation User", "Estimation Manager", "Planning User", "Planning Manager"]
ALL_APP_ROLES = ESTIMATION_PLANNING + ["O&M Manager", "COO", "CEO"]

# (doctype, roles, permission types)
APP_ROLE_PERMISSIONS = [
    ("Designation", ESTIMATION_PLANNING, ["select"]),
    ("Project", ALL_APP_ROLES, ["read"]),
]


def ensure_app_role_permissions():
    for doctype, roles, ptypes in APP_ROLE_PERMISSIONS:
        if not frappe.db.exists("DocType", doctype):
            continue
        for role in roles:
            if not frappe.db.exists("Role", role):
                continue
            add_permission(doctype, role, 0, ptypes[0])
            for ptype in ptypes:
                update_permission_property(doctype, role, 0, ptype, 1)
            if "read" not in ptypes:
                update_permission_property(doctype, role, 0, "read", 0)
    frappe.db.commit()
