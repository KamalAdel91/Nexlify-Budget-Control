# Copyright (c) 2026, Kamal Adel and contributors
"""Data for the CEO dashboard (projexlify-dashboard page): one call returns every section."""

import json
from collections import Counter

import frappe
from frappe import _
from frappe.model.workflow import get_workflow_name
from frappe.utils import cint, date_diff, flt, getdate, today

OV = "Project Overview"
OPEN_VIOLATIONS_CARD = "Open Budget Violations"


@frappe.whitelist()
def get_ceo_dashboard_data(company=None, project=None, extra_filters=None):
    frappe.has_permission(OV, "read", throw=True)
    can_see_price = 1 in (frappe.get_meta(OV).get_permlevel_access("read") or [])
    s = frappe.get_single("Project Budget Settings")
    target, low, aging = flt(s.target_margin_pct), flt(s.low_margin_threshold), cint(s.approval_aging_warning_days)

    only = _filtered_projects(company, project, extra_filters)

    def in_only(field):
        return {field: ["in", list(only) or [""]]} if only is not None else {}

    pending, mine, approved_state = _workflow_states()

    projects = frappe.get_all("Project", filters=in_only("name"),
        fields=["name", "project_name", "custom_budget_cost", "custom_project_planning"])
    titles = {p.name: p.project_name or p.name for p in projects}

    ov_by_project = {}
    for o in frappe.get_all(OV, filters={"docstatus": ["!=", 2], **in_only("project")},
            fields=["name", "project", "customer", "workflow_state", "docstatus", "revenue_budget", "contract_value",
                    "planned_cost", "expected_profit", "margin_pct", "pending_since", "return_count"],
            order_by="modified desc"):
        ov_by_project.setdefault(o.project, o)
    active = list(ov_by_project.values())

    plans = [o.revenue_budget for o in active if o.revenue_budget]
    plan_start = dict(frappe.get_all("Project Planning", filters={"name": ["in", plans or [""]]},
        fields=["name", "from_date"], as_list=True))
    for o in active:
        o.project_name = titles.get(o.project, o.project)
        o.from_date = plan_start.get(o.revenue_budget)
        o.waiting_days = date_diff(today(), getdate(o.pending_since)) if o.pending_since and o.docstatus == 0 else None

    # ---------- KPIs ----------
    revenue = sum(flt(o.contract_value) for o in active)
    cost = sum(flt(o.planned_cost) for o in active)
    queue = sorted((o for o in active if o.docstatus == 0 and o.workflow_state in mine),
        key=lambda o: -(o.waiting_days or 0))
    kpis = {
        "contract_value": revenue,
        "planned_cost": cost,
        "expected_profit": revenue - cost,
        "margin_pct": flt((revenue - cost) / revenue * 100, 2) if revenue else 0,
        "projects": len(active),
        "waiting_for_me": len(queue),
        "oldest_wait_days": max((o.waiting_days or 0 for o in queue), default=0),
        "pending_total": sum(1 for o in active if o.docstatus == 0 and o.workflow_state in pending),
    }

    # ---------- pipeline by stage ----------
    order = ["Estimation", "Planning", *pending, approved_state]
    counts = Counter()
    for p in projects:
        o = ov_by_project.get(p.name)
        if o and o.docstatus == 1:
            counts[approved_state] += 1
        elif o and o.workflow_state in pending:
            counts[o.workflow_state] += 1
        elif p.custom_project_planning:
            counts["Planning"] += 1
        elif p.custom_budget_cost:
            counts["Estimation"] += 1
    stages = [{"stage": st, "count": counts[st]} for st in order]

    # ---------- revenue vs cost by plan start month ----------
    months = {}
    for o in active:
        if not o.from_date:
            continue
        key = getdate(o.from_date).strftime("%Y-%m")
        m = months.setdefault(key, {"month": key, "revenue": 0, "cost": 0})
        m["revenue"] += flt(o.contract_value)
        m["cost"] += flt(o.planned_cost)
    monthly = [months[k] for k in sorted(months)]

    # ---------- budget health (same numbers as the current page) ----------
    from nexlify_budget_control.nexlify_budget_control.budget_enforcement import get_all_projects_budget_summary
    rows = (get_all_projects_budget_summary(company=company, project=project, extra_filters=extra_filters) or {}).get("rows", [])
    cats, worst = {}, {}
    for r in rows:
        name = r["budget_category"] or _("(No Category)")
        c = cats.setdefault(name, {"category": name, "estimated": 0, "actual": 0})
        c["estimated"] += flt(r["estimated"])
        c["actual"] += flt(r["actual"])
        if flt(r["estimated"]) and flt(r["actual"]) > flt(r["estimated"]):
            pct = flt(r["actual"]) / flt(r["estimated"]) * 100
            if pct > worst.get(r["project"], (None, 0))[1]:
                worst[r["project"]] = (name, pct)
    for c in cats.values():
        c["pct"] = flt(c["actual"] / c["estimated"] * 100, 1) if c["estimated"] else 0
    est_total, act_total = sum(c["estimated"] for c in cats.values()), sum(c["actual"] for c in cats.values())
    budget = {
        "categories": sorted(cats.values(), key=lambda c: -c["pct"]),
        "totals": {"estimated": est_total, "actual": act_total,
                   "pct": flt(act_total / est_total * 100, 1) if est_total else 0},
    }

    # ---------- violations ----------
    vfilters = []
    raw = frappe.db.get_value("Number Card", OPEN_VIOLATIONS_CARD, "filters_json")
    try:
        vfilters = json.loads(raw or "[]")
    except ValueError:
        vfilters = []
    if isinstance(vfilters, dict):
        vfilters = [["Budget Violation Log", k, "=", v] for k, v in vfilters.items()]
    if only is not None:
        vfilters.append(["Budget Violation Log", "project", "in", list(only) or [""]])
    by_type = Counter(v.violation_type or _("Other") for v in
        frappe.get_all("Budget Violation Log", filters=vfilters, fields=["violation_type"]))
    violations = {"open": sum(by_type.values()),
                  "by_type": [{"type": t, "count": n} for t, n in by_type.most_common()]}

    # ---------- needs attention ----------
    attention = []
    for proj, (cat, pct) in worst.items():
        attention.append(_item("over_budget", "danger", proj, titles.get(proj, proj), None,
            _("Over budget on {0}").format(cat), f"{round(pct)}%"))
    for o in active:
        if o.waiting_days is not None and o.workflow_state in pending and o.waiting_days > aging:
            attention.append(_item("overdue", "danger", o.project, o.project_name, o.name,
                _("Waiting in {0}").format(_(o.workflow_state)), _("{0} days").format(o.waiting_days)))
        if o.docstatus == 0 and o.workflow_state in pending and cint(o.return_count):
            attention.append(_item("returned", "warning", o.project, o.project_name, o.name,
                _("Returned before approval"), f"{cint(o.return_count)}x"))
        if can_see_price and flt(o.contract_value) and flt(o.margin_pct) < low:
            attention.append(_item("low_margin", "warning", o.project, o.project_name, o.name,
                _("Margin below {0}%").format(f"{low:g}"), f"{flt(o.margin_pct, 1):g}%"))
    attention.sort(key=lambda a: a["severity"] != "danger")

    queue_out = [{
        "name": o.name, "project": o.project, "project_name": o.project_name, "customer": o.customer,
        "state": o.workflow_state, "contract_value": o.contract_value, "margin_pct": o.margin_pct,
        "waiting_days": o.waiting_days, "overdue": (o.waiting_days or 0) > aging,
        "return_count": cint(o.return_count),
    } for o in queue]

    if not can_see_price:
        for k in ("contract_value", "expected_profit", "margin_pct"):
            kpis[k] = None
        for q in queue_out:
            q["contract_value"] = q["margin_pct"] = None
        for m in monthly:
            m["revenue"] = None

    return {
        "can_see_price": can_see_price,
        "currency": frappe.db.get_default("currency") or (rows[0]["currency"] if rows else None),
        "settings": {"target_margin_pct": target, "low_margin_threshold": low, "approval_aging_warning_days": aging},
        "kpis": kpis,
        "queue": queue_out,
        "stages": stages,
        "monthly": monthly,
        "budget": budget,
        "violations": violations,
        "attention": attention,
    }


def _item(kind, severity, project, project_name, overview, label, value):
    return {"kind": kind, "severity": severity, "project": project, "project_name": project_name,
            "overview": overview, "label": label, "value": value}


def _workflow_states():
    """(pending states in order, states the current user can act on, final approved state) from the active Workflow."""
    name = get_workflow_name(OV)
    if not name:
        return [], set(), "Approved"
    wf = frappe.get_cached_doc("Workflow", name)
    pending = [st.state for st in wf.states[1:] if str(st.doc_status) == "0"]
    roles = set(frappe.get_roles())
    mine = {t.state for t in wf.transitions if t.state in pending and t.allowed in roles}
    approved = next((st.state for st in wf.states if str(st.doc_status) == "1"), "Approved")
    return pending, mine, approved


def _filtered_projects(company, project, extra_filters):
    """Set of project names matching the dashboard filters, or None when nothing is filtered."""
    if isinstance(extra_filters, str):
        try:
            extra_filters = json.loads(extra_filters)
        except ValueError:
            extra_filters = []
    proj_filters, cb_filters = {}, {}
    if company:
        proj_filters["company"] = company
    if project:
        proj_filters["name"] = project
    valid = {
        "Project": {f.fieldname for f in frappe.get_meta("Project").fields} | {"name", "company"},
        "Project Cost Budget": {f.fieldname for f in frappe.get_meta("Project Cost Budget").fields} | {"company", "project"},
    }
    for f in extra_filters or []:
        field, value = f.get("target_field"), f.get("value")
        source = f.get("source_doctype") or "Project Cost Budget"
        if not field or not value or field not in valid.get(source, ()):
            continue
        (proj_filters if source == "Project" else cb_filters)[field] = value
    if not proj_filters and not cb_filters:
        return None
    names = set(frappe.get_all("Project", filters=proj_filters, pluck="name"))
    if cb_filters:
        names &= set(frappe.get_all("Project Cost Budget", filters={**cb_filters, "docstatus": 1}, pluck="project"))
    return names
