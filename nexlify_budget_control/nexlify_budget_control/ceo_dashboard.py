# Copyright (c) 2026, Kamal Adel and contributors
"""Data for the CEO dashboard (projexlify-dashboard page): one call returns every section."""

import json
from collections import Counter

import frappe
from frappe import _
from frappe.model.workflow import get_workflow_name
from frappe.utils import add_days, cint, date_diff, flt, getdate, today

OV = "Project Overview"
OPEN_VIOLATIONS_CARD = "Open Budget Violations"
HAND_OFF_LOG = "Hand-off Log"


@frappe.whitelist()
def get_ceo_dashboard_data(company=None, project=None, extra_filters=None):
    frappe.has_permission(OV, "read", throw=True)
    # The money comes from the Project (Planned Revenue / Estimated Cost sit on permlevel 2 there)
    can_see_price = 2 in (frappe.get_meta("Project").get_permlevel_access("read") or [])
    s = frappe.get_single("Project Budget Settings")
    target, low, aging = flt(s.target_margin_pct), flt(s.low_margin_threshold), cint(s.approval_aging_warning_days)

    only = _filtered_projects(company, project, extra_filters)
    # Only the projects this user may see (role and User Permissions, e.g. one Company)
    allowed = set(_permitted_projects())
    only = allowed if only is None else (only & allowed)

    def in_only(field):
        return {field: ["in", list(only) or [""]]} if only is not None else {}

    pending, mine, approved_state = _workflow_states()

    projects = frappe.get_all("Project", filters=in_only("name"),
        fields=["name", "project_name", "custom_budget_cost", "custom_project_planning",
                "custom_planned_revenue", "estimated_costing"])
    titles = {p.name: p.project_name or p.name for p in projects}
    # Every money figure on this dashboard comes from the Project: Planned Revenue (from the Opportunity) and
    # Estimated Cost (from the Estimation), both by fetch_from. The Overview's own numbers are the copy kept
    # for its approval, so they are not read here.
    money = {p.name: _money(p.custom_planned_revenue, p.estimated_costing) for p in projects}

    def money_of(project):
        return money.get(project) or _money(0, 0)

    ov_by_project = {}
    for o in frappe.get_all(OV, filters={"docstatus": ["!=", 2], **in_only("project")},
            fields=["name", "project", "customer", "workflow_state", "docstatus", "revenue_budget",
                    "pending_since", "return_count"],
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
    # From the Projects whose Estimation is handed over (submitted). Needs attention checks the same projects.
    handed_over = sorted(set(money) & set(frappe.get_all("Project Estimation",
        filters={"docstatus": 1, **in_only("project")}, pluck="project")))
    revenue = sum(money[p].revenue for p in handed_over)
    cost = sum(money[p].cost for p in handed_over)
    queue = sorted((o for o in active if o.docstatus == 0 and o.workflow_state in mine),
        key=lambda o: -(o.waiting_days or 0))
    kpis = {
        "contract_value": revenue,
        "planned_cost": cost,
        "expected_profit": revenue - cost,
        "margin_pct": flt((revenue - cost) / revenue * 100, 2) if revenue else 0,
        "projects": len(handed_over),
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
        m["revenue"] += money_of(o.project).revenue
        m["cost"] += money_of(o.project).cost
    monthly = [months[k] for k in sorted(months)]

    # ---------- budget health (same numbers as the current page) ----------
    from nexlify_budget_control.nexlify_budget_control.budget_enforcement import get_all_projects_budget_summary
    # filter by the same project set as every other section (the Project is the source of truth)
    rows = (get_all_projects_budget_summary() or {}).get("rows", [])
    if only is not None:
        rows = [r for r in rows if r["project"] in only]
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
                _("Waiting in {0}").format(_(o.workflow_state)), (_("{0} day") if o.waiting_days == 1 else _("{0} days")).format(o.waiting_days)))
        if o.docstatus == 0 and o.workflow_state in pending and cint(o.return_count):
            attention.append(_item("returned", "warning", o.project, o.project_name, o.name,
                _("Returned before approval"), f"{cint(o.return_count)}x"))
    if can_see_price:
        for proj in handed_over:
            m, o = money[proj], ov_by_project.get(proj)
            args = (proj, titles.get(proj, proj), o.name if o else None)
            if not m.revenue:
                attention.append(_item("no_contract", "danger", *args, _("No contract value"), _("Missing")))
            elif not m.cost:
                attention.append(_item("no_cost", "warning", *args, _("No estimated cost"), _("Missing")))
            elif m.profit < 0:
                attention.append(_item("loss", "danger", *args, _("Loss-making"), f"{flt(m.margin, 1):g}%"))
            elif m.margin < low:
                attention.append(_item("low_margin", "warning", *args,
                    _("Margin below {0}%").format(f"{low:g}"), f"{flt(m.margin, 1):g}%"))
    attention.sort(key=lambda a: a["severity"] != "danger")

    qcust = dict(frappe.get_all("Customer", filters={"name": ["in", list({o.customer for o in queue if o.customer}) or [""]]},
        fields=["name", "customer_name"], as_list=True))
    queue_out = [{
        "name": o.name, "project": o.project, "project_name": o.project_name, "customer": o.customer,
        "customer_name": qcust.get(o.customer) or o.customer,
        "state": o.workflow_state, "contract_value": money_of(o.project).revenue, "margin_pct": money_of(o.project).margin,
        "waiting_days": o.waiting_days, "overdue": (o.waiting_days or 0) > aging,
        "return_count": cint(o.return_count),
    } for o in queue]

    vm = _visits_and_manpower(active, titles, s)
    inv = _invoicing(active, titles, s, can_see_price, money_of)

    if not can_see_price:
        for k in ("contract_value", "planned_cost", "expected_profit", "margin_pct"):
            kpis[k] = None
        for q in queue_out:
            q["contract_value"] = q["margin_pct"] = None
        for m in monthly:
            m["revenue"] = m["cost"] = None

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
        "visits": vm["visits"],
        "manpower": vm["manpower"],
        "invoicing": inv,
        "hand_offs": _hand_offs(company, project, extra_filters),
    }


def _item(kind, severity, project, project_name, overview, label, value):
    return {"kind": kind, "severity": severity, "project": project, "project_name": project_name,
            "overview": overview, "label": label, "value": value}


def _money(revenue, cost):
    """A project's money as the dashboard shows it: the margin is on the contract value, like the KPIs."""
    revenue, cost = flt(revenue), flt(cost)
    return frappe._dict(revenue=revenue, cost=cost, profit=revenue - cost,
                        margin=flt((revenue - cost) / revenue * 100, 2) if revenue else 0)


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
        "Project Estimation": {f.fieldname for f in frappe.get_meta("Project Estimation").fields} | {"company", "project"},
    }
    for f in extra_filters or []:
        field, value = f.get("target_field"), f.get("value")
        source = f.get("source_doctype") or "Project Estimation"
        if not field or not value or field not in valid.get(source, ()):
            continue
        (proj_filters if source == "Project" else cb_filters)[field] = value
    if not proj_filters and not cb_filters:
        return None
    names = set(frappe.get_all("Project", filters=proj_filters, pluck="name"))
    if cb_filters:
        names &= set(frappe.get_all("Project Estimation", filters={**cb_filters, "docstatus": 1}, pluck="project"))
    return names

def _visits_and_manpower(active, titles, s):
    """Visits in progress / coming up, and the headcount they need (approved projects only)."""
    upcoming_days = cint(s.get("upcoming_visit_days")) or 14
    weeks = cint(s.get("manpower_weeks")) or 8
    t = getdate(today())
    start = getdate(add_days(t, -((t.weekday() + 1) % 7)))  # week starts on Sunday
    end = getdate(add_days(start, weeks * 7 - 1))
    soon = getdate(add_days(t, upcoming_days))

    trades = [{"name": x.name, "label": x.category_name or x.name} for x in frappe.get_all(
        "Manpower Category", filters={"enabled": 1}, fields=["name", "category_name"], order_by="sort_order asc, name asc")]
    plans = [o.revenue_budget for o in active if o.docstatus == 1 and o.revenue_budget]
    visits = frappe.get_all("Project Visits",
        filters=[["project_planning", "in", plans or [""]], ["start_date", "<=", max(end, soon)], ["end_date", ">=", start]],
        fields=["name", "visit_label", "project", "customer", "start_date", "end_date", "working_days"],
        order_by="start_date asc, creation asc")
    team = {}
    for r in frappe.get_all("Project Visit Team",
            filters={"parenttype": "Project Visits", "parent": ["in", [v.name for v in visits] or [""]]},
            fields=["parent", "trade", "headcount"]):
        if r.trade and cint(r.headcount) > 0:
            by = team.setdefault(r.parent, {})
            by[r.trade] = by.get(r.trade, 0) + cint(r.headcount)
    equipment = {}
    for r in frappe.get_all("Project Visit Allocation",
            filters={"parenttype": "Project Visits", "parent": ["in", [v.name for v in visits] or [""]]},
            fields=["parent", "equipment", "quantity", "work_days"], order_by="idx asc"):
        equipment.setdefault(r.parent, []).append(
            {"equipment": r.equipment, "quantity": flt(r.quantity, 2), "work_days": flt(r.work_days, 2)})
    known = {x["name"] for x in trades}
    for by in team.values():
        for tr in by:
            if tr not in known:
                known.add(tr)
                trades.append({"name": tr, "label": tr})
    for v in visits:
        v.start_date, v.end_date = getdate(v.start_date), getdate(v.end_date)

    cust = dict(frappe.get_all("Customer", filters={"name": ["in", list({v.customer for v in visits if v.customer}) or [""]]},
        fields=["name", "customer_name"], as_list=True))

    def row(v):
        by = team.get(v.name, {})
        return {"name": v.name, "label": v.visit_label or v.name, "project": v.project,
                "project_name": titles.get(v.project, v.project), "customer": v.customer, "customer_name": cust.get(v.customer) or v.customer,
                "start_date": str(v.start_date), "end_date": str(v.end_date),
                "day": date_diff(t, v.start_date) + 1, "days": date_diff(v.end_date, v.start_date) + 1,
                "starts_in": date_diff(v.start_date, t), "team": by, "people": sum(by.values()),
                "working_days": flt(v.working_days, 2), "equipment": equipment.get(v.name, [])}

    current = [row(v) for v in visits if v.start_date <= t <= v.end_date]
    upcoming = [row(v) for v in visits if t < v.start_date <= soon]
    now = {}
    for x in current:
        for tr, n in x["team"].items():
            now[tr] = now.get(tr, 0) + n

    out_weeks = []
    for w in range(weeks):
        ws = getdate(add_days(start, w * 7))
        best = {"total": 0, "by": {}, "day": None}
        for d in range(7):
            day = getdate(add_days(ws, d))
            if day < t:
                continue
            by = {}
            for v in visits:
                if v.start_date <= day <= v.end_date:
                    for tr, n in team.get(v.name, {}).items():
                        by[tr] = by.get(tr, 0) + n
            total = sum(by.values())
            if total > best["total"]:
                best = {"total": total, "by": by, "day": str(day)}
        out_weeks.append({"week": str(ws), **best})

    return {
        "visits": {"current": current, "upcoming": upcoming, "upcoming_days": upcoming_days},
        "manpower": {"trades": trades, "today": now, "weeks": out_weeks},
    }

def _invoicing(active, titles, s, can_see_price, money_of):
    """Invoices of approved projects: overdue, due soon, and totals."""
    window = cint(s.get("invoice_due_days")) or 30
    t = getdate(today())
    soon = getdate(add_days(t, window))
    ov = {o.revenue_budget: o for o in active if o.docstatus == 1 and o.revenue_budget}
    meta = frappe.get_meta("Project Invoicing")
    desc = next((f.fieldname for f in meta.fields
        if f.fieldtype in ("Small Text", "Text", "Long Text", "Text Editor", "Data")
        and ("desc" in f.fieldname or "description" in (f.label or "").lower() or f.fieldname in ("notes", "remarks"))), None)
    fields = ["name", "project_planning", "invoice_percentage", "expected_invoice_date", "status"] + ([desc] if desc else [])
    rows = frappe.get_all("Project Invoicing", filters={"project_planning": ["in", list(ov) or [""]]},
        fields=fields, order_by="expected_invoice_date asc, creation asc")
    cust = dict(frappe.get_all("Customer", filters={"name": ["in", list({o.customer for o in ov.values() if o.customer}) or [""]]},
        fields=["name", "customer_name"], as_list=True))
    tt = {"contract": sum(money_of(o.project).revenue for o in ov.values()), "invoiced_amount": 0, "remaining_amount": 0,
          "overdue_count": 0, "overdue_amount": 0, "due_count": 0, "due_amount": 0, "invoiced_count": 0, "total_count": len(rows)}
    overdue, due = [], []
    for r in rows:
        o = ov[r.project_planning]
        amount = money_of(o.project).revenue * flt(r.invoice_percentage) / 100
        if (r.status or "") == "Invoiced":
            tt["invoiced_amount"] += amount
            tt["invoiced_count"] += 1
            continue
        tt["remaining_amount"] += amount
        if not r.expected_invoice_date:
            continue
        d = getdate(r.expected_invoice_date)
        item = {"name": r.name, "project": o.project, "project_name": titles.get(o.project, o.project),
                "customer": o.customer, "customer_name": cust.get(o.customer) or o.customer,
                "description": frappe.utils.strip_html(r.get(desc) or "").strip() if desc else None,
                "expected_date": str(d), "days": date_diff(d, t), "share": flt(r.invoice_percentage, 2),
                "amount": amount, "status": r.status}
        if d < t:
            overdue.append(item); tt["overdue_count"] += 1; tt["overdue_amount"] += amount
        elif d <= soon:
            due.append(item); tt["due_count"] += 1; tt["due_amount"] += amount
    if not can_see_price:
        for k in ("contract", "invoiced_amount", "remaining_amount", "overdue_amount", "due_amount"):
            tt[k] = None
        for x in overdue + due:
            x["amount"] = None
    return {"window": window, "overdue": overdue, "due": due, "totals": tt}


def _permitted_projects():
    """Project names the current user can read, honouring User Permissions."""
    if frappe.has_permission("Project", "read"):
        return frappe.get_list("Project", pluck="name", limit_page_length=0)
    return [p for p in frappe.get_list(OV, pluck="project", limit_page_length=0) if p]


def _hand_offs(company, project, extra_filters):
    """The Hand-offs section, from the Hand-off Log: what waits on whom now, how late, how long each team takes,
    and the longest waits. An Estimation has no project before its Project exists: the company filter keeps its
    rows (the log has the company); a project filter, or an extra filter, does not."""
    from frappe.model.workflow import get_workflow_name
    from frappe.utils import get_first_day, today

    if not frappe.has_permission(HAND_OFF_LOG, "read"):
        return None
    base = {}
    if company:
        base["company"] = company
    names = _filtered_projects(None, project, extra_filters)
    if names is not None:
        base["project"] = ["in", list(names) or [""]]

    open_rows = frappe.get_list(HAND_OFF_LOG, filters={**base, "is_open": 1}, fields=["waiting_on", "is_overdue"], limit_page_length=0)
    closed = frappe.get_list(HAND_OFF_LOG, filters={**base, "is_open": 0, "is_backfilled": 0, "waiting_on": ["is", "set"]},
        fields=["waiting_on", "duration_days"], limit_page_length=0)
    teams = {}

    def team(name):
        return teams.setdefault(name, {"team": name, "waiting": 0, "overdue": 0, "avg_days": None, "sum": 0.0, "n": 0})

    for r in open_rows:
        t = team(r.waiting_on)
        t["waiting"] += 1
        t["overdue"] += cint(r.is_overdue)
    for r in closed:
        t = team(r.waiting_on)
        t["sum"] += flt(r.duration_days)
        t["n"] += 1
    out = []
    for t in teams.values():
        out.append({"team": t["team"], "waiting": t["waiting"], "overdue": t["overdue"],
                    "avg_days": flt(t["sum"] / t["n"], 2) if t["n"] else None})
    out.sort(key=lambda t: (-t["overdue"], -t["waiting"], t["team"] or ""))

    # A revision: an Estimation back at the first state of its Workflow, coming from another stage
    workflow = get_workflow_name("Project Estimation")
    states = frappe.get_cached_doc("Workflow", workflow).states if workflow else []
    revisions = len(frappe.get_list(HAND_OFF_LOG, filters={**base, "reference_doctype": "Project Estimation",
        "stage": states[0].state, "previous_stage": ["is", "set"], "entered_on": [">=", get_first_day(today())]},
        pluck="name", limit_page_length=0)) if states else 0

    oldest = frappe.get_list(HAND_OFF_LOG, filters={**base, "is_open": 1}, fields=["reference_doctype", "reference_name",
        "project", "stage", "waiting_on", "duration_days", "target_days", "is_overdue"], order_by="duration_days desc", limit_page_length=10)
    titles = dict(frappe.get_all("Project", filters={"name": ["in", list({r.project for r in oldest if r.project}) or [""]]},
        fields=["name", "project_name"], as_list=True))
    for r in oldest:
        r["project_name"] = titles.get(r.project)
    return {"total": len(open_rows), "overdue": sum(cint(r.is_overdue) for r in open_rows), "revisions_this_month": revisions,
            "teams": out, "oldest": oldest, "report_filters": {k: v for k, v in (("company", company), ("project", project)) if v}}
