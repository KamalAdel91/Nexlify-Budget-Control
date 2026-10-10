from frappe import _


def opportunity_dashboard(data):
    """Connections of the Opportunity: its Estimation (the Project link is already there)."""
    data["transactions"].append({"label": _("Estimation"), "items": ["Project Estimation"]})
    return data


def project_dashboard(data):
    """Connections of the Project: everything Nexlify builds on it (the Opportunity link is already there)."""
    data["transactions"].append({"label": _("Nexlify"), "items": [
        "Project Estimation", "Project Planning", "Project Overview", "Project Visits", "Project Invoicing"]})
    return data


# Connections of the cycle's documents
import frappe


def _add(data, label, links, near=None):
    """Connections: add links {doctype: its field that points here; a child-table field is found by Frappe}
    into the group holding `near`, else the group named label (made if missing). Only adds, never removes."""
    data.setdefault("transactions", [])
    data.setdefault("non_standard_fieldnames", {})
    shown = {d for g in data["transactions"] for d in g.get("items", [])}
    new = {dt: f for dt, f in links.items() if dt not in shown}
    if not new:
        return data
    group = next((g for g in data["transactions"] if near and near in g.get("items", [])), None) or next(
        (g for g in data["transactions"] if g.get("label") in (label, frappe._(label))), None)
    if not group:
        group = {"label": frappe._(label), "items": []}
        data["transactions"].append(group)
    for doctype, fieldname in new.items():
        group["items"].append(doctype)
        if not data.get("fieldname"):
            data["fieldname"] = fieldname
        elif fieldname != data["fieldname"]:
            data["non_standard_fieldnames"][doctype] = fieldname
    return data


def opportunity_connections(data):
    """Opportunity"""
    return _add(data, "ALSA", {'Supply Request': 'opportunity'}, near="Project Estimation")


def project_connections(data):
    """Project"""
    return _add(data, "ALSA", {'Supply Request': 'project', 'Project Planning Scope': 'project', 'Budget Violation Log': 'project'}, near="Project Estimation")


def project_estimation_connections(data):
    """Project Estimation"""
    return _add(data, "Supply Chain", {'Supply Request': 'estimation'})


def supply_request_connections(data):
    """Supply Request"""
    return _add(data, "Supply Chain", {'Supplier Quotation': 'custom_supply_request'})


def project_planning_scope_connections(data):
    """Project Planning Scope"""
    return _add(data, "Planning", {'Project Visits': 'planning_scope'})


def project_visits_connections(data):
    """Project Visits"""
    return _add(data, "Accounts", {'Project Invoicing': 'project_visit'})


def project_invoicing_connections(data):
    """Project Invoicing"""
    return _add(data, "Accounts", {'Sales Order': 'custom_project_invoicing', 'Sales Invoice': 'custom_project_invoicing'})


def sales_order_connections(data):
    """Sales Order"""
    return _add(data, "ALSA", {'Project Invoicing': 'sales_order'})


def sales_invoice_connections(data):
    """Sales Invoice"""
    return _add(data, "ALSA", {'Project Invoicing': 'sales_invoice'})


def supplier_quotation_connections(data):
    """Supplier Quotation"""
    return _add(data, "ALSA", {'Supply Request': 'supplier_quotation', 'Project Estimation': 'supplier_quotation'})
