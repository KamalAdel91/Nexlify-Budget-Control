# Copyright (c) 2026, Kamal Adel and contributors
"""Keeps company and customer on a project's Estimation, Plan and Overview equal to the Project."""

import frappe

LINKED = ("Project Cost Budget", "Project Planning", "Project Overview")


def sync_linked_documents(project=None):
    """Copies company and customer from the Project, including submitted documents: both fields are
    fetched from the Project and never edited on the documents, but fetch_from does not refresh after submit.
    Budget actuals are filtered by the Estimation's company, so a stale company hides real expenses."""
    changed = []
    cond = "and d.project = %(project)s" if project else ""
    for dt in LINKED:
        rows = frappe.db.sql(f"""
            select d.name, p.company, p.customer
            from `tab{dt}` d join `tabProject` p on p.name = d.project
            where d.docstatus != 2 {cond}
              and (ifnull(d.company, '') != ifnull(p.company, '') or ifnull(d.customer, '') != ifnull(p.customer, ''))
        """, {"project": project}, as_dict=True)
        for r in rows:
            frappe.db.set_value(dt, r.name, {"company": r.company, "customer": r.customer}, update_modified=False)
            changed.append((dt, r.name))
    return changed


def on_project_update(doc, method=None):
    if doc.has_value_changed("company") or doc.has_value_changed("customer"):
        sync_linked_documents(doc.name)
