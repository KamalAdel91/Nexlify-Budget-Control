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


# Roles that only need to pick a record in a Link field (and see its name), not open it.
# Add a line here, update the app and migrate: each entry is applied once per site,
# then Role Permissions Manager owns it.
LINK_SELECT = {
    "Customer": ["Estimation User", "Estimation Manager", "Planning User", "Planning Manager"],
    "Company": ["Estimation User", "Estimation Manager", "Planning User", "Planning Manager"],
}


# Roles that may open the linked record too (managers who review the whole project).
LINK_READ = {
    "Customer": ["COO", "CEO"],
    "Company": ["COO", "CEO"],
}


def grant_link_select_permissions():
    """Applies each LINK_SELECT / LINK_READ entry once per site, then leaves it to the UI.
    A role that already has any permission on the doctype is never touched."""
    from frappe.permissions import add_permission, update_permission_property

    applied = set(frappe.parse_json(frappe.db.get_default("nexlify_applied_link_select") or "[]"))
    changed = False
    for rules, ptype in ((LINK_SELECT, "select"), (LINK_READ, "read")):
        for doctype, roles in rules.items():
            if not frappe.db.exists("DocType", doctype):
                continue
            for role in roles:
                key = f"{doctype}|{role}" if ptype == "select" else f"{doctype}|{role}|read"
                if key in applied or not frappe.db.exists("Role", role):
                    continue
                has_standard = frappe.db.exists("DocPerm", {"parent": doctype, "role": role, "permlevel": 0})
                row = frappe.db.get_value(
                    "Custom DocPerm", {"parent": doctype, "role": role, "permlevel": 0, "if_owner": 0},
                    ["name", "read", "select"], as_dict=True)
                if row:
                    if not row.read and not row.select:
                        update_permission_property(doctype, role, 0, ptype, 1)
                elif not has_standard:
                    # add_permission copies the doctype's standard permissions first, so other roles keep theirs
                    add_permission(doctype, role, 0, ptype)
                    if ptype == "select":
                        update_permission_property(doctype, role, 0, "read", 0)
                applied.add(key)
                changed = True
    if changed:
        frappe.db.set_default("nexlify_applied_link_select", frappe.as_json(sorted(applied)))
        frappe.clear_cache()
