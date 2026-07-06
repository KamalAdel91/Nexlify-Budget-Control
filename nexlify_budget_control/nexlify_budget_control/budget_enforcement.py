"""
budget_enforcement.py
---------------------
Core cost-budget enforcement logic for Nexlify Budget Control.
Triggered from doc_events hooks on Material Request, Purchase Order,
Purchase Invoice, Journal Entry, and Expense Claim submit.

Master on/off switch: Projects Settings > Enable Nexlify Budget Control.
Role bypass: Projects Settings > Role Allowed to Bypass Budget.
Date range enforcement: a document is blocked for date-range reasons
ONLY if there is no other Project Cost Budget Detail row for the same
(project, budget_category) whose effective period DOES include the
document's date.

Strict category restriction: if a project's Submitted Project Cost
Budget has "Restrict to Budget Categories Only" enabled, ANY document
touching an account not covered by one of that budget's Budget
Categories is blocked entirely (unless the submitter has the budget
bypass role) - checked before any other enforcement.

CLIENT-SIDE PREVIEW NOTE: get_budget_check_preview runs during
before_submit, BEFORE the document is actually saved/submitted (it is
still Draft/docstatus=0 in the DB at that point). This means the
stored cumulative_expense_amount on each Project Cost Budget Detail
row does NOT yet include this document's own pending amount - unlike
the real backend enforcement (check_cost_budget), which runs in
on_submit AFTER docstatus has already flipped to 1 in the DB (even
before any later rollback). To compensate, the client sends
amounts_by_account (this document's own pending amount per account),
which the preview adds on top of the stored cumulative before
comparing against the estimate - otherwise the preview would always
under-report and never show a violation for a brand-new document.

The Python-side frappe.throw messages are intentionally kept brief
(estimated/actual/deviation only, no document tables) - the rich,
detailed preview lives in the client-side budget_check.js dialog.

PROJECT SYNC NOTE: Project Cost Budget is itself submittable.
on_project_cost_budget_submit / on_project_cost_budget_cancel keep
Project.custom_budget_cost and Project.is_active in step with the
lifecycle of whichever Project Cost Budget is currently linked to
the project (see those two functions below for the exact rules).

IMPROVEMENTS IMPLEMENTED:
- Batch loading: _load_rows_batch replaces N+1 get_doc calls for rows/parents.
- Request-scoped caching: _get_cached_amount prevents repeated SQL queries
  for the same (company, project, accounts) tuple.
- Bulk update: all row updates are collected and flushed in one DB call.
- Violation aggregation: violations are collected during enforcement and
  finalized together in a single _finalize_violations call (one throw).
- On-cancel hooks: doc_events now include on_cancel for all 5 doctypes
  to keep budget figures current when documents are cancelled.
- Violation Log: every violation is persisted to the new Budget Violation Log
  doctype before any throw/msgprint.
"""

import calendar
import json

import frappe
from frappe.utils import flt, getdate, get_traceback
from nexlify_budget_control.nexlify_budget_control.budget_utils import (
    convert_to_doc_currency,
    get_accounts_for_category,
    get_actual_expense,
    get_categories_for_account,
    get_cumulative_amount,
    get_material_request_amount,
    get_purchase_order_amount,
)
from nexlify_budget_control.nexlify_budget_control.constants import (
    ACTION_NONE,
    ACTION_STOP,
    ACTION_WARN,
    APPLICABLE_FIELD_MAP,
    DEFAULT_PAGE_SIZE,
    DEFAULT_WARNING_THRESHOLD_PERCENT,
    MONTHLY_ACTION_MAP,
    MONTH_ORDER,
)
from nexlify_budget_control.nexlify_budget_control.notifications import (
    notify_project_stakeholders,
)

# ---------------------------------------------------------------------------
# Request-scoped caching helpers
# ---------------------------------------------------------------------------

_cached_amounts = {}


def _clear_cached_amounts():
    """Clear the request-scoped amount cache. Called automatically at the
    start of each enforcement entry-point to prevent stale data."""
    _cached_amounts.clear()


def _get_cached_amount(company, project, accounts, fn, fn_name, **extra_kwargs):
    """Calls `fn(company, project, accounts, **extra_kwargs)` and caches
    the result in a request-scoped dict keyed by
    (fn_name, company, project, frozenset(accounts))."""
    key = (fn_name, company, project, frozenset(accounts), frozenset(sorted(extra_kwargs.items())))
    if key not in _cached_amounts:
        _cached_amounts[key] = fn(company, project, accounts, **extra_kwargs)
    return _cached_amounts[key]


# ---------------------------------------------------------------------------
# Batch loading helpers
# ---------------------------------------------------------------------------

def _load_rows_batch(row_names):
    """
    Given a list of (row_name, parent_name) tuples, returns a dict:
        { row_name: {"row": <dict of all row fields>, "parent": <dict of all parent fields>} }
    Uses a single JOINed query instead of N individual frappe.get_doc calls.
    Returns an empty dict if row_names is empty.
    """
    if not row_names:
        return {}

    unique_rows = list(set(r[0] for r in row_names))
    unique_parents = list(set(r[1] for r in row_names))

    # Fetch all detail rows in one query
    rows_data = frappe.db.sql(
        """
        SELECT *
        FROM `tabProject Cost Budget Detail`
        WHERE name IN %(names)s
        """,
        {"names": unique_rows},
        as_dict=True,
    )
    row_map = {r["name"]: r for r in rows_data}

    # Fetch all parent docs in one query
    parents_data = frappe.db.sql(
        """
        SELECT *
        FROM `tabProject Cost Budget`
        WHERE name IN %(names)s
        """,
        {"names": unique_parents},
        as_dict=True,
    )
    parent_map = {p["name"]: p for p in parents_data}

    result = {}
    for row_name, parent_name in row_names:
        r = row_map.get(row_name)
        p = parent_map.get(parent_name)
        if r and p:
            result[row_name] = {"row": r, "parent": p}
    return result


# ---------------------------------------------------------------------------
# Violation collection
# ---------------------------------------------------------------------------

def _log_violation(project, budget_category, violation_type, action_taken,
                   reference_doctype=None, reference_name=None,
                   company=None, message=None, source_rows=None,
                   via_import_mode=False):
    """Insert a Budget Violation Log record. Uses ignore_permissions so it
    always succeeds regardless of the current user's role."""
    try:
        log = frappe.get_doc({
            "doctype": "Budget Violation Log",
            "project": project,
            "budget_category": budget_category,
            "violation_type": violation_type,
            "action_taken": action_taken,
            "reference_doctype": reference_doctype,
            "reference_name": reference_name,
            "company": company,
            "message": message,
            "source_rows": ", ".join(str(i) for i in (source_rows or [])),
            "via_import_mode": 1 if via_import_mode else 0,
        })
        log.insert(ignore_permissions=True)
    except Exception:
        # Logging must never interfere with the enforcement itself
        pass


def _finalize_violations(violations):
    """
    Takes a list of violation dicts. Logs every violation to Budget
    Violation Log regardless of action, then:
      - If "Import Mode" is enabled in Project Budget Settings: every
        violation is logged (with the action it WOULD have taken, plus
        via_import_mode=1) but NOTHING blocks or warns - the document
        proceeds unconditionally. Meant to be switched on temporarily
        for a large bulk import, then switched off again afterward.
      - Otherwise, normal behaviour:
          "Ignore": logged only, nothing shown to the user.
          "Warn" (or "Stop" while bypassed): msgprint, submission proceeds.
          "Stop" (not bypassed): all such violations combined into one
            frappe.throw, grouped by project.
    """
    stop_violations = []
    warn_violations = []
    bypassed = _can_bypass_budget()
    import_mode = bool(frappe.db.get_single_value("Project Budget Settings", "import_mode"))

    for v in violations:
        action = v.get("action", "Warn")
        project = v.get("project")
        budget_category = v.get("budget_category")
        violation_type = v.get("violation_type", "Annual Exceeded")
        ref_doctype = v.get("reference_doctype")
        ref_name = v.get("reference_name")
        company = v.get("company")
        msg_body = v.get("message", "")
        source_rows = v.get("source_rows") or []

        action_taken = "Bypassed" if (action == "Stop" and bypassed) else action

        _log_violation(
            project=project,
            budget_category=budget_category,
            violation_type=violation_type,
            action_taken=action_taken,
            reference_doctype=ref_doctype,
            reference_name=ref_name,
            company=company,
            message=msg_body,
            source_rows=source_rows,
            via_import_mode=import_mode,
        )

        if import_mode:
            continue

        if action == "Ignore":
            continue
        elif action == "Stop" and not bypassed:
            stop_violations.append(v)
        elif action == "Warn" or (action == "Stop" and bypassed):
            warn_violations.append(v)

    if import_mode:
        return

    for v in warn_violations:
        title_suffix = " (Bypassed)" if bypassed and v.get("action") == "Stop" else ""
        frappe.msgprint(
            v["message"],
            title=f"Budget Exceeded{title_suffix}",
            alert=True,
            indicator="orange",
        )

    if stop_violations:
        projects = sorted(set(v.get("project", "Unknown") for v in stop_violations))
        parts = []
        for proj in projects:
            proj_violations = [v for v in stop_violations if v.get("project") == proj]
            parts.append(f"<h4>Project <b>{proj}</b></h4>")
            parts.append("<ul>")
            for v in proj_violations:
                parts.append(f"<li>{v['message']}</li>")
            parts.append("</ul>")

        combined = (
            "<p><b>Budget violations found. The following issues must be resolved:</b></p>"
            + "".join(parts)
            + "<p>Please adjust the document or contact a user with the budget bypass role.</p>"
        )
        frappe.throw(combined, title="Budget Violations")


# ---------------------------------------------------------------------------
# Public hook entry-points
# ---------------------------------------------------------------------------

def on_material_request_submit(doc, method=None):
    check_cost_budget(doc, "material_request")


def on_material_request_cancel(doc, method=None):
    _recalc_on_cancel(doc, "material_request")


def on_purchase_order_submit(doc, method=None):
    check_cost_budget(doc, "purchase_order")


def on_purchase_order_cancel(doc, method=None):
    _recalc_on_cancel(doc, "purchase_order")


def on_purchase_invoice_submit(doc, method=None):
    check_cost_budget(doc, "actual")


def on_purchase_invoice_cancel(doc, method=None):
    _recalc_on_cancel(doc, "actual")


def on_journal_entry_submit(doc, method=None):
    violations = _collect_journal_entry_violations(doc)
    _finalize_violations(violations)
    if not violations:
        _recalc_journal_entry_rows(doc)


def on_journal_entry_cancel(doc, method=None):
    _recalc_journal_entry_rows(doc)


def on_expense_claim_submit(doc, method=None):
    violations = _collect_expense_claim_violations(doc)
    _finalize_violations(violations)
    if not violations:
        _recalc_expense_claim_rows(doc)


def on_expense_claim_cancel(doc, method=None):
    _recalc_expense_claim_rows(doc)


# ---------------------------------------------------------------------------
# Project Cost Budget lifecycle sync (submittable doc itself)
# ---------------------------------------------------------------------------

def on_project_cost_budget_submit(doc, method=None):
    """
    When a Project Cost Budget is submitted, it becomes the active
    budget for its project: Project.custom_budget_cost is pointed at
    this document, and the project is marked active.
    """
    if not doc.project:
        return
    frappe.db.set_value(
        "Project",
        doc.project,
        {
            "custom_budget_cost": doc.name,
            "is_active": "Yes",
        },
    )


def on_project_cost_budget_cancel(doc, method=None):
    """
    When a Project Cost Budget is cancelled, the project is marked
    inactive - but ONLY if this cancelled document is still the one
    currently linked on the project. custom_budget_cost itself is left
    untouched (it still points at this now-cancelled document) until a
    new Project Cost Budget is submitted for the same project, which
    will overwrite it via on_project_cost_budget_submit above.
    """
    if not doc.project:
        return
    current_linked = frappe.db.get_value("Project", doc.project, "custom_budget_cost")
    if current_linked == doc.name:
        frappe.db.set_value("Project", doc.project, "is_active", "No")


# ---------------------------------------------------------------------------
# Core enforcement
# ---------------------------------------------------------------------------

def check_cost_budget(doc, trigger_stage):
    if not _is_budget_control_enabled(doc.doctype):
        return
    _clear_cached_amounts()

    doc_date = getdate(
        doc.get("posting_date")
        or doc.get("transaction_date")
        or doc.get("schedule_date")
    )
    company = doc.get("company")

    projects_touched = {}
    account_idx_map = {}
    for item in doc.get("items") or []:
        project = item.get("project")
        account = item.get("expense_account")
        if not project or not account:
            continue
        projects_touched.setdefault(project, set()).add(account)
        account_idx_map.setdefault(project, {}).setdefault(account, []).append(item.get("idx"))

    violations = []
    for project, accounts in projects_touched.items():
        v = _check_category_restriction(
            company, project, list(accounts), doc.doctype, doc.name,
            account_idx_map=account_idx_map.get(project, {}),
        )
        if v:
            violations.append(v)

    budget_names = {p: _get_active_budget_name(p) for p in projects_touched}

    all_in_range_rows = set()
    all_out_of_range_rows = set()

    for item in doc.get("items") or []:
        project = item.get("project")
        account = item.get("expense_account")
        if not project or not account:
            continue

        budget_name = budget_names.get(project)
        if not budget_name:
            continue

        categories = get_categories_for_account(company, account)
        if not categories:
            continue

        in_range_rows, out_of_range_rows = _get_affected_detail_rows(
            budget_name, categories, doc_date
        )
        all_in_range_rows.update(in_range_rows)
        all_out_of_range_rows.update(out_of_range_rows)

    date_violations = _collect_date_range_violations(
        all_in_range_rows, all_out_of_range_rows, trigger_stage, doc.doctype, doc.name
    )
    violations.extend(date_violations)

    all_rows_list = list(all_in_range_rows)
    if not all_rows_list:
        _finalize_violations(violations)
        return

    rows_batch = _load_rows_batch(all_rows_list)
    bulk_updates = []

    for row_name, parent_name in all_rows_list:
        entry = rows_batch.get(row_name)
        if not entry:
            continue

        row = entry["row"]
        parent = entry["parent"]

        row_accounts = get_accounts_for_category(row.get("budget_category"))
        amount_details = _get_current_doc_amount_details(
            row_name, doc, trigger_stage, accounts=set(row_accounts)
        )

        _recalculate_row_from_dict(row, parent, doc_date)

        row_violations = _evaluate_budget_row(
            row, parent, trigger_stage, doc_date,
            current_doc_amount=amount_details["new_spending"],
            current_doctype=doc.doctype,
            current_docname=doc.name,
            amount_details=amount_details,
            source_rows=amount_details["source_rows"],
        )
        violations.extend(row_violations)

        bulk_updates.append({
            "name": row_name,
            "actual_expense_amount": row.get("actual_expense_amount"),
            "material_request_amount": row.get("material_request_amount"),
            "purchase_order_amount": row.get("purchase_order_amount"),
            "cumulative_expense_amount": row.get("cumulative_expense_amount"),
            "actual_amount_till_month": row.get("actual_amount_till_month"),
            "cumulative_amount_till_month": row.get("cumulative_amount_till_month"),
            "variance": row.get("variance"),
            "variance_percentage": row.get("variance_percentage"),
        })

    _bulk_update_rows(bulk_updates)
    _finalize_violations(violations)


# ---------------------------------------------------------------------------
# Separated collection functions (return violations instead of throwing)
# ---------------------------------------------------------------------------

def _check_category_restriction(company, project, item_accounts, doctype_name, docname, account_idx_map=None):
    account_idx_map = account_idx_map or {}
    if not item_accounts:
        return None

    active_budget_name = _get_active_budget_name(project)
    if not active_budget_name:
        return None

    restricted_budgets = frappe.db.sql(
        """
        SELECT name FROM `tabProject Cost Budget`
        WHERE name = %(budget_name)s
            AND docstatus = 1 AND restrict_to_budget_categories = 1
        """,
        {"budget_name": active_budget_name},
        as_dict=True,
    )

    if not restricted_budgets:
        return None

    _, action = _get_doctype_rule(doctype_name)

    for budget in restricted_budgets:
        allowed_accounts = frappe.db.sql(
            """
            SELECT DISTINCT bca.account
            FROM `tabProject Cost Budget Detail` d
            INNER JOIN `tabBudget Category Account` bca ON bca.parent = d.budget_category
            WHERE d.parent = %(parent)s
            """,
            {"parent": budget.name},
            as_dict=False,
        )
        allowed_accounts = {a[0] for a in allowed_accounts}

        disallowed = [a for a in item_accounts if a not in allowed_accounts]
        if not disallowed:
            continue

        source_rows = sorted({
            idx for a in disallowed for idx in account_idx_map.get(a, []) if idx is not None
        })
        source_rows_html = (
            f"<br>Source row(s) in document: <b>{', '.join(map(str, source_rows))}</b>"
            if source_rows else ""
        )

        bypassed = _can_bypass_budget()
        if bypassed:
            msg = (
                f"Project <b>{project}</b> is restricted to its Budget Category accounts only. "
                f"The following account(s) on <b>{doctype_name} {docname}</b> are outside that list: "
                f"<b>{', '.join(disallowed)}</b>.{source_rows_html}"
            )
        else:
            msg = (
                f"Project <b>{project}</b> is restricted to its Budget Category accounts only. "
                f"The following account(s) are not part of any Budget Category for this project: "
                f"<b>{', '.join(disallowed)}</b>. Please use an account included in one of the "
                f"project's Budget Categories, or contact someone authorized to bypass this restriction."
                f"{source_rows_html}"
            )

        return {
            "action": action,
            "message": msg,
            "project": project,
            "budget_category": None,
            "violation_type": "Category Restriction",
            "reference_doctype": doctype_name,
            "reference_name": docname,
            "company": company,
            "source_rows": source_rows,
        }

    return None


def _collect_date_range_violations(in_range_rows, out_of_range_rows, trigger_stage,
                                   current_doctype=None, current_docname=None):
    violations = []

    if not out_of_range_rows:
        return violations

    all_row_names = list(
        {row_name for row_name, _ in in_range_rows}
        | {row_name for row_name, _ in out_of_range_rows}
    )
    if not all_row_names:
        return violations

    detail_rows = frappe.db.sql(
        """
        SELECT name, parent, budget_category,
               applicable_on_material_request,
               applicable_on_purchase_order,
               applicable_on_booking_actual_expenses,
               from_date, to_date
        FROM `tabProject Cost Budget Detail`
        WHERE name IN %(names)s
        """,
        {"names": all_row_names},
        as_dict=True,
    )
    row_map = {r.name: r for r in detail_rows}

    all_parent_names = list(
        {p for _, p in in_range_rows} | {p for _, p in out_of_range_rows}
    )
    parent_rows = frappe.db.sql(
        """
        SELECT name, project, from_date, to_date
        FROM `tabProject Cost Budget`
        WHERE name IN %(names)s
        """,
        {"names": all_parent_names},
        as_dict=True,
    )
    parent_map = {p.name: p for p in parent_rows}

    covered_categories = set()
    for row_name, parent_name in in_range_rows:
        row = row_map.get(row_name)
        if row:
            covered_categories.add((parent_name, row.budget_category))

    _, action = _get_doctype_rule(current_doctype)

    for row_name, parent_name in out_of_range_rows:
        row = row_map.get(row_name)
        if not row:
            continue

        if (parent_name, row.budget_category) in covered_categories:
            continue

        parent = parent_map.get(parent_name)
        if not parent:
            continue

        applicable_field = {
            "material_request": "applicable_on_material_request",
            "purchase_order": "applicable_on_purchase_order",
            "actual": "applicable_on_booking_actual_expenses",
        }[trigger_stage]
        if not row.get(applicable_field):
            continue

        eff_from = row.from_date or parent.from_date
        eff_to = row.to_date or parent.to_date
        msg = (
            f"Project <b>{parent.project}</b>: Budget Category <b>{row.budget_category}</b> "
            f"is only active from <b>{frappe.utils.formatdate(eff_from)}</b> to "
            f"<b>{frappe.utils.formatdate(eff_to)}</b>. This document's date falls "
            f"outside that period."
        )

        violations.append({
            "action": action,
            "message": msg,
            "project": parent.project,
            "budget_category": row.budget_category,
            "violation_type": "Date Range",
            "reference_doctype": current_doctype,
            "reference_name": current_docname,
            "company": None,
        })

    return violations


def _evaluate_budget_row(row, parent, trigger_stage, doc_date,
                         current_doc_amount=0.0, current_doctype=None,
                         current_docname=None, amount_details=None,
                         source_rows=None):
    violations = []
    source_rows = source_rows or []
    currency = parent.get("currency")

    applicable_field = {
        "material_request": "applicable_on_material_request",
        "purchase_order": "applicable_on_purchase_order",
        "actual": "applicable_on_booking_actual_expenses",
    }[trigger_stage]
    if not row.get(applicable_field):
        return violations

    threshold = flt(row.get("warning_threshold_percentage")) or DEFAULT_WARNING_THRESHOLD_PERCENT
    estimated = flt(row.get("estimated_amount"))
    cumulative = flt(row.get("cumulative_expense_amount"))
    if estimated and cumulative >= (estimated * threshold / 100) and cumulative < estimated:
        pct = round(cumulative / estimated * 100, 1)
        warn_msg = (
            f"Budget Category <b>{row.get('budget_category')}</b> has reached "
            f"<b>{pct}%</b> of its estimated budget "
            f"({frappe.format_value(cumulative, {'fieldtype': 'Currency'})} / "
            f"{frappe.format_value(estimated, {'fieldtype': 'Currency'})})."
        )
        if source_rows:
            warn_msg += f"<br>Source row(s) in document: <b>{', '.join(map(str, source_rows))}</b>"
        violations.append({
            "action": "Warn",
            "message": warn_msg,
            "project": parent.get("project"),
            "budget_category": row.get("budget_category"),
            "violation_type": "Warning Threshold",
            "reference_doctype": current_doctype,
            "reference_name": current_docname,
            "company": parent.get("company"),
            "source_rows": source_rows,
            "estimated_amount": estimated,
            "cumulative_before": cumulative - current_doc_amount,
            "cumulative_after": cumulative,
            "deviation": cumulative - estimated,
            "current_doc_amount": current_doc_amount,
            "currency": currency,
            "percentage_used": pct,
        })

    _, action = _get_doctype_rule(current_doctype)
    if cumulative > estimated:
        msg = _build_message_from_dict(row, "total", parent, current_doc_amount, amount_details, source_rows)
        violations.append({
            "action": action,
            "message": msg,
            "project": parent.get("project"),
            "budget_category": row.get("budget_category"),
            "violation_type": "Annual Exceeded",
            "reference_doctype": current_doctype,
            "reference_name": current_docname,
            "company": parent.get("company"),
            "source_rows": source_rows,
            "estimated_amount": estimated,
            "cumulative_before": cumulative - current_doc_amount,
            "cumulative_after": cumulative,
            "deviation": cumulative - estimated,
            "current_doc_amount": current_doc_amount,
            "currency": currency,
        })
        notify_project_stakeholders(
            parent.get("project"), msg, "Project Cost Budget", parent.get("name")
        )

    return violations


# ---------------------------------------------------------------------------
# Recalculation helpers (dict-based, no get_doc)
# ---------------------------------------------------------------------------

def _recalculate_row_from_dict(row, parent, doc_date):
    accounts = get_accounts_for_category(row.get("budget_category"))
    eff_from = getdate(row.get("from_date") or parent.get("from_date"))
    eff_to = getdate(row.get("to_date") or parent.get("to_date"))
    cr = flt(parent.get("conversion_rate")) or 1.0

    mr_base = _get_cached_amount(
        parent.get("company"), parent.get("project"), accounts,
        get_material_request_amount, "mr"
    )
    po_base = _get_cached_amount(
        parent.get("company"), parent.get("project"), accounts,
        get_purchase_order_amount, "po"
    )
    actual_base = _get_cached_amount(
        parent.get("company"), parent.get("project"), accounts,
        get_actual_expense, "actual", from_date=eff_from, to_date=eff_to
    )
    cumulative_base = get_cumulative_amount(actual_base, mr_base, po_base)

    row["actual_expense_amount"] = convert_to_doc_currency(
        actual_base, parent.get("company"), parent.get("currency"), cr
    )
    row["material_request_amount"] = convert_to_doc_currency(
        mr_base, parent.get("company"), parent.get("currency"), cr
    )
    row["purchase_order_amount"] = convert_to_doc_currency(
        po_base, parent.get("company"), parent.get("currency"), cr
    )
    row["cumulative_expense_amount"] = convert_to_doc_currency(
        cumulative_base, parent.get("company"), parent.get("currency"), cr
    )

    estimated = flt(row.get("estimated_amount"))
    cumulative_val = flt(row.get("cumulative_expense_amount"))
    row["variance"] = estimated - cumulative_val
    row["variance_percentage"] = (row["variance"] / estimated * 100) if estimated else 0.0


def _end_of_month_for(doc_date, max_date):
    last_day = calendar.monthrange(doc_date.year, doc_date.month)[1]
    end_of_month = doc_date.replace(day=last_day)
    return min(end_of_month, getdate(max_date))


# _get_monthly_budget_till_date_from_dict removed - Monthly budget checks are no longer supported (Stage 8 simplification).


# ---------------------------------------------------------------------------
# Bulk update
# ---------------------------------------------------------------------------

def _bulk_update_rows(updates):
    if not updates:
        return

    field_names = [
        "actual_expense_amount",
        "material_request_amount",
        "purchase_order_amount",
        "cumulative_expense_amount",
        "variance",
        "variance_percentage",
    ]

    names = [u["name"] for u in updates]
    name_params = {f"name_{i}": n for i, n in enumerate(names)}

    cases = {}
    for field in field_names:
        case_parts = []
        for i, u in enumerate(updates):
            param_key = f"{field}_{i}"
            case_parts.append(f"WHEN %(name_{i})s THEN %({param_key})s")
            name_params[param_key] = u.get(field)

        cases[field] = f"`{field}` = CASE `name` " + " ".join(case_parts) + " END"

    set_clause = ",\n        ".join(cases.values())
    name_list = ", ".join(f"%(name_{i})s" for i in range(len(names)))

    sql = f"""
        UPDATE `tabProject Cost Budget Detail`
        SET {set_clause}
        WHERE `name` IN ({name_list})
    """

    frappe.db.sql(sql, name_params)


# ---------------------------------------------------------------------------
# Journal Entry / Expense Claim recalc (no violations)
# ---------------------------------------------------------------------------

def _recalc_journal_entry_rows(doc):
    """Recalculate budget rows affected by a Journal Entry without enforcing.
    Used for both submit (after _finalize_violations) and cancel."""
    if not _is_budget_control_enabled(doc.doctype):
        return
    _clear_cached_amounts()

    _recalc_generic(doc, "actual", is_je_or_ec=True)


def _recalc_expense_claim_rows(doc):
    """Recalculate budget rows affected by an Expense Claim without enforcing.
    Used for both submit (after _finalize_violations) and cancel."""
    if not _is_budget_control_enabled(doc.doctype):
        return
    _clear_cached_amounts()

    _recalc_generic(doc, "actual", is_je_or_ec=True)


def _recalc_on_cancel(doc, trigger_stage):
    """Recalculate budget rows when a document is cancelled, without any
    enforcement or throw. This keeps cumulative figures current."""
    if not _is_budget_control_enabled(doc.doctype):
        return
    _clear_cached_amounts()

    _recalc_generic(doc, trigger_stage)


def _recalc_generic(doc, trigger_stage, is_je_or_ec=False):
    """Common recalculation logic for all doctypes. Collects affected rows
    and recalculates them without enforcement."""
    doc_date = getdate(
        doc.get("posting_date")
        or doc.get("transaction_date")
        or frappe.utils.today()
    )
    company = doc.get("company")

    projects_touched = {}
    if is_je_or_ec:
        items = doc.get("accounts") if doc.get("accounts") else doc.get("expenses")
        for item in items or []:
            if doc.get("accounts"):
                # Journal Entry
                project = item.get("project")
                account = item.get("account")
            else:
                # Expense Claim
                project = item.get("project") or doc.get("project")
                account = item.get("default_account")
            if not project or not account:
                continue
            projects_touched.setdefault(project, set()).add(account)
    else:
        for item in doc.get("items") or []:
            project = item.get("project")
            account = item.get("expense_account")
            if not project or not account:
                continue
            projects_touched.setdefault(project, set()).add(account)

    budget_names = {p: _get_active_budget_name(p) for p in projects_touched}

    all_in_range_rows = set()
    for item in (doc.get("items") if not is_je_or_ec else []):
        project = item.get("project")
        account = item.get("expense_account")
        if not project or not account:
            continue
        budget_name = budget_names.get(project)
        if not budget_name:
            continue
        categories = get_categories_for_account(company, account)
        if not categories:
            continue
        in_range_rows, _ = _get_affected_detail_rows(budget_name, categories, doc_date)
        all_in_range_rows.update(in_range_rows)

    if is_je_or_ec:
        items_source = doc.get("accounts") if doc.get("accounts") else doc.get("expenses")
        for item in items_source or []:
            project = item.get("project")
            account = item.get("account") if doc.get("accounts") else item.get("default_account")
            if doc.get("expenses"):
                project = project or doc.get("project")
            if not project or not account:
                continue
            budget_name = budget_names.get(project)
            if not budget_name:
                continue
            categories = get_categories_for_account(company, account)
            if not categories:
                continue
            in_range_rows, _ = _get_affected_detail_rows(budget_name, categories, doc_date)
            all_in_range_rows.update(in_range_rows)

    if not all_in_range_rows:
        return

    rows_batch = _load_rows_batch(list(all_in_range_rows))
    bulk_updates = []

    for row_name, parent_name in all_in_range_rows:
        entry = rows_batch.get(row_name)
        if not entry:
            continue
        row = entry["row"]
        parent = entry["parent"]
        _recalculate_row_from_dict(row, parent, doc_date)
        bulk_updates.append({
            "name": row_name,
            "actual_expense_amount": row.get("actual_expense_amount"),
            "material_request_amount": row.get("material_request_amount"),
            "purchase_order_amount": row.get("purchase_order_amount"),
            "cumulative_expense_amount": row.get("cumulative_expense_amount"),
            "actual_amount_till_month": row.get("actual_amount_till_month"),
            "cumulative_amount_till_month": row.get("cumulative_amount_till_month"),
            "variance": row.get("variance"),
            "variance_percentage": row.get("variance_percentage"),
        })

    _bulk_update_rows(bulk_updates)


# ---------------------------------------------------------------------------
# Journal Entry / Expense Claim submit with violation collection
# ---------------------------------------------------------------------------

def _collect_journal_entry_violations(doc):
    """Collect all violations for a Journal Entry submission. Returns a list
    of violation dicts, then performs recalc separately."""
    if not _is_budget_control_enabled(doc.doctype):
        return []
    _clear_cached_amounts()

    doc_date = getdate(doc.get("posting_date"))
    company = doc.get("company")

    projects_touched = {}
    account_idx_map = {}
    for account_row in doc.get("accounts") or []:
        project = account_row.get("project")
        account = account_row.get("account")
        if not project or not account:
            continue
        projects_touched.setdefault(project, set()).add(account)
        account_idx_map.setdefault(project, {}).setdefault(account, []).append(account_row.get("idx"))

    violations = []
    for project, accounts in projects_touched.items():
        v = _check_category_restriction(
            company, project, list(accounts), doc.doctype, doc.name,
            account_idx_map=account_idx_map.get(project, {}),
        )
        if v:
            violations.append(v)

    budget_names = {p: _get_active_budget_name(p) for p in projects_touched}

    net_by_project_account = {}
    idx_by_project_account = {}
    for account_row in doc.get("accounts") or []:
        project = account_row.get("project")
        account = account_row.get("account")
        if not project or not account:
            continue
        debit_amt = flt(account_row.get("debit_in_account_currency"))
        credit_amt = flt(account_row.get("credit_in_account_currency"))
        key = (project, account)
        net_by_project_account[key] = net_by_project_account.get(key, 0.0) + (debit_amt - credit_amt)
        if debit_amt > 0 and account_row.get("idx") is not None:
            idx_by_project_account.setdefault(key, []).append(account_row.get("idx"))

    all_in_range_rows = set()
    all_out_of_range_rows = set()
    net_amounts_by_row = {}
    source_rows_by_row = {}

    for (project, account), net_amt in net_by_project_account.items():
        if net_amt <= 0:
            continue

        budget_name = budget_names.get(project)
        if not budget_name:
            continue

        categories = get_categories_for_account(company, account)
        if not categories:
            continue

        in_range_rows, out_of_range_rows = _get_affected_detail_rows(
            budget_name, categories, doc_date
        )
        all_in_range_rows.update(in_range_rows)
        all_out_of_range_rows.update(out_of_range_rows)

        for r in in_range_rows:
            net_amounts_by_row[r] = net_amounts_by_row.get(r, 0.0) + net_amt
            source_rows_by_row.setdefault(r, set()).update(
                idx_by_project_account.get((project, account), [])
            )

    date_violations = _collect_date_range_violations(
        all_in_range_rows, all_out_of_range_rows, "actual", doc.doctype, doc.name
    )
    violations.extend(date_violations)

    if not all_in_range_rows:
        return violations

    rows_batch = _load_rows_batch(list(all_in_range_rows))
    bulk_updates = []

    for row_name, parent_name in all_in_range_rows:
        entry = rows_batch.get(row_name)
        if not entry:
            continue

        row = entry["row"]
        parent = entry["parent"]
        current_amt = net_amounts_by_row.get((row_name, parent_name), 0.0)
        source_rows = sorted(source_rows_by_row.get((row_name, parent_name), set()))

        _recalculate_row_from_dict(row, parent, doc_date)
        row_violations = _evaluate_budget_row(
            row, parent, "actual", doc_date,
            current_doc_amount=current_amt,
            current_doctype=doc.doctype,
            current_docname=doc.name,
            source_rows=source_rows,
        )
        violations.extend(row_violations)

        bulk_updates.append({
            "name": row_name,
            "actual_expense_amount": row.get("actual_expense_amount"),
            "material_request_amount": row.get("material_request_amount"),
            "purchase_order_amount": row.get("purchase_order_amount"),
            "cumulative_expense_amount": row.get("cumulative_expense_amount"),
            "actual_amount_till_month": row.get("actual_amount_till_month"),
            "cumulative_amount_till_month": row.get("cumulative_amount_till_month"),
            "variance": row.get("variance"),
            "variance_percentage": row.get("variance_percentage"),
        })

    _bulk_update_rows(bulk_updates)

    return violations


def _collect_expense_claim_violations(doc):
    """Collect all violations for an Expense Claim submission. Returns a list
    of violation dicts, then performs recalc separately."""
    if not _is_budget_control_enabled(doc.doctype):
        return []
    _clear_cached_amounts()

    doc_date = getdate(doc.get("posting_date") or frappe.utils.today())
    company = doc.get("company")

    projects_touched = {}
    account_idx_map = {}
    for expense_row in doc.get("expenses") or []:
        project = expense_row.get("project") or doc.get("project")
        account = expense_row.get("default_account")
        if not project or not account:
            continue
        projects_touched.setdefault(project, set()).add(account)
        account_idx_map.setdefault(project, {}).setdefault(account, []).append(expense_row.get("idx"))

    violations = []
    for project, accounts in projects_touched.items():
        v = _check_category_restriction(
            company, project, list(accounts), doc.doctype, doc.name,
            account_idx_map=account_idx_map.get(project, {}),
        )
        if v:
            violations.append(v)

    budget_names = {p: _get_active_budget_name(p) for p in projects_touched}

    all_in_range_rows = set()
    all_out_of_range_rows = set()

    for expense_row in doc.get("expenses") or []:
        project = expense_row.get("project") or doc.get("project")
        account = expense_row.get("default_account")
        if not project or not account:
            continue
        sanctioned = flt(expense_row.get("sanctioned_amount"))
        if sanctioned <= 0:
            continue

        budget_name = budget_names.get(project)
        if not budget_name:
            continue

        categories = get_categories_for_account(company, account)
        if not categories:
            continue

        in_range_rows, out_of_range_rows = _get_affected_detail_rows(
            budget_name, categories, doc_date
        )
        all_in_range_rows.update(in_range_rows)
        all_out_of_range_rows.update(out_of_range_rows)

    date_violations = _collect_date_range_violations(
        all_in_range_rows, all_out_of_range_rows, "actual", doc.doctype, doc.name
    )
    violations.extend(date_violations)

    if not all_in_range_rows:
        return violations

    rows_batch = _load_rows_batch(list(all_in_range_rows))
    bulk_updates = []

    for row_name, parent_name in all_in_range_rows:
        entry = rows_batch.get(row_name)
        if not entry:
            continue

        row = entry["row"]
        parent = entry["parent"]
        row_accounts_ec = get_accounts_for_category(row.get("budget_category"))
        amount_details = _get_current_doc_amount_details(
            row_name, doc, "actual", accounts=set(row_accounts_ec), source_field="expenses"
        )

        _recalculate_row_from_dict(row, parent, doc_date)
        row_violations = _evaluate_budget_row(
            row, parent, "actual", doc_date,
            current_doc_amount=amount_details["new_spending"],
            current_doctype=doc.doctype,
            current_docname=doc.name,
            amount_details=amount_details,
            source_rows=amount_details["source_rows"],
        )
        violations.extend(row_violations)

        bulk_updates.append({
            "name": row_name,
            "actual_expense_amount": row.get("actual_expense_amount"),
            "material_request_amount": row.get("material_request_amount"),
            "purchase_order_amount": row.get("purchase_order_amount"),
            "cumulative_expense_amount": row.get("cumulative_expense_amount"),
            "actual_amount_till_month": row.get("actual_amount_till_month"),
            "cumulative_amount_till_month": row.get("cumulative_amount_till_month"),
            "variance": row.get("variance"),
            "variance_percentage": row.get("variance_percentage"),
        })

    _bulk_update_rows(bulk_updates)

    return violations


# ---------------------------------------------------------------------------
# Existing helper functions (adapted for dict-based rows where needed)
# ---------------------------------------------------------------------------

def _get_active_budget_name(project):
    budget_name = frappe.db.get_value("Project", project, "custom_budget_cost")
    if not budget_name:
        return None

    docstatus = frappe.db.get_value("Project Cost Budget", budget_name, "docstatus")
    if docstatus != 1:
        return None

    return budget_name


def _get_affected_detail_rows(budget_name, categories, doc_date):
    if not budget_name:
        return set(), set()

    rows = frappe.db.sql(
        """
        SELECT d.name AS row_name, d.parent AS parent_name,
            d.from_date, d.to_date, p.from_date AS p_from_date, p.to_date AS p_to_date
        FROM `tabProject Cost Budget Detail` d
        INNER JOIN `tabProject Cost Budget` p ON d.parent = p.name
        WHERE p.name = %(budget_name)s
            AND p.docstatus = 1
            AND d.budget_category IN %(categories)s
        """,
        {"budget_name": budget_name, "categories": categories},
        as_dict=True,
    )

    in_range = set()
    out_of_range = set()
    for r in rows:
        eff_from = getdate(r.from_date or r.p_from_date)
        eff_to = getdate(r.to_date or r.p_to_date)
        if eff_from <= doc_date <= eff_to:
            in_range.add((r.row_name, r.parent_name))
        else:
            out_of_range.add((r.row_name, r.parent_name))
    return in_range, out_of_range


def _get_current_doc_amount_details(row_name, doc, trigger_stage, accounts=None, source_field="items"):
    """
    Returns the document's own contribution to a given budget row, plus
    the list of document row numbers (idx) that contributed to it
    ("source_rows"). If `accounts` is provided (as a set), it is used
    directly instead of fetching via frappe.get_doc (avoids N+1).
    `source_field` controls which child table to read from the document
    (default "items" for MR/PO/PI, "expenses" for Expense Claim). For
    Expense Claim the amount field is "sanctioned_amount" and the account
    field is "default_account" instead of "amount"/"expense_account".
    """
    if accounts is None:
        row = frappe.get_doc("Project Cost Budget Detail", row_name)
        accounts = set(get_accounts_for_category(row.budget_category))

    total_amount = 0.0
    already_counted = 0.0
    source_rows = []
    amount_field = "sanctioned_amount" if source_field == "expenses" else "amount"

    for item in doc.get(source_field) or []:
        account = item.get("expense_account") or item.get("account") or item.get("default_account")
        if account not in accounts:
            continue

        item_amount = flt(item.get(amount_field))
        total_amount += item_amount
        if item.get("idx") is not None:
            source_rows.append(item.get("idx"))

        if trigger_stage == "purchase_order" and item.get("material_request"):
            prior_amount = flt(
                frappe.db.get_value(
                    "Material Request Item",
                    {"parent": item.get("material_request"), "expense_account": account},
                    "amount",
                )
            )
            already_counted += min(prior_amount, item_amount)
        elif trigger_stage == "actual" and item.get("purchase_order"):
            prior_amount = flt(
                frappe.db.get_value(
                    "Purchase Order Item",
                    {"parent": item.get("purchase_order"), "expense_account": account},
                    "amount",
                )
            )
            already_counted += min(prior_amount, item_amount)

    new_spending = max(0.0, total_amount - already_counted)

    return {
        "total_amount": total_amount,
        "already_counted": already_counted,
        "new_spending": new_spending,
        "source_rows": sorted(set(source_rows)),
    }


def _get_action_from_row(row, check_type, trigger_stage):
    field_map = {
        ("annual", "actual"): "action_if_annual_exceeded",
        ("annual", "material_request"): "action_if_annual_exceeded_on_mr",
        ("annual", "purchase_order"): "action_if_annual_exceeded_on_po",
        ("monthly", "actual"): "action_if_monthly_exceeded",
        ("monthly", "material_request"): "action_if_monthly_exceeded_on_mr",
        ("monthly", "purchase_order"): "action_if_monthly_exceeded_on_po",
    }
    field = field_map[(check_type, trigger_stage)]
    val = row.get(field)
    if not val or val == "None":
        val = (
            row.get("action_if_annual_exceeded")
            if check_type == "annual"
            else row.get("action_if_monthly_exceeded")
        )
    return val or "None"


def _can_bypass_budget():
    bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
    if not bypass_role:
        return False
    return bypass_role in frappe.get_roles(frappe.session.user)


@frappe.request_cache
def _get_doctype_rule(doctype_name):
    """
    Returns (enabled: bool, action: str) for the given real document type
    name, read from the Document Type Rule child table on the Project
    Budget Settings singleton. If no explicit row exists yet for this
    doctype, defaults to (enabled=True, action="Stop") - the safest
    behaviour until someone configures it otherwise.
    """
    rows = frappe.get_all(
        "Document Type Rule",
        filters={
            "parenttype": "Project Budget Settings",
            "parent": "Project Budget Settings",
            "document_type": doctype_name,
        },
        fields=["enabled", "action"],
        limit=1,
    )
    if not rows:
        return True, "Stop"
    return bool(rows[0].enabled), (rows[0].action or "Stop")


def _is_budget_control_enabled(doctype_name):
    enabled, _ = _get_doctype_rule(doctype_name)
    return enabled


# ---------------------------------------------------------------------------
# Related documents (used by the client-side dialog and pagination API)
# ---------------------------------------------------------------------------

def _get_related_documents(
    company, project, exclude_doctype=None, exclude_name=None, pages=None
):
    """
    Returns all submitted financial documents (MR, PO, PI, JE, Expense
    Claim) linked to this project. Supports per-doctype pagination via
    `pages` (5 rows per page). Expense Claim is skipped entirely if the
    hrms app isn't installed on this site (its table won't exist).
    """
    PAGE_SIZE = 5
    pages = pages or {}

    docs = {
        "mr": [],
        "po": [],
        "pi": [],
        "je": [],
        "ec": [],
        "mr_total": 0,
        "po_total": 0,
        "pi_total": 0,
        "je_total": 0,
        "ec_total": 0,
    }

    # Shared exclude conditions (safe SQL fragments, controlled by fixed check)
    mr_exclude = "AND mr.name != %(exclude_name)s" if exclude_doctype == "Material Request" else ""
    po_exclude = "AND po.name != %(exclude_name)s" if exclude_doctype == "Purchase Order" else ""
    pi_exclude = "AND pi.name != %(exclude_name)s" if exclude_doctype == "Purchase Invoice" else ""
    je_exclude = "AND je.name != %(exclude_name)s" if exclude_doctype == "Journal Entry" else ""
    ec_exclude = "AND ec.name != %(exclude_name)s" if exclude_doctype == "Expense Claim" else ""

    base_params = {"company": company, "project": project, "exclude_name": exclude_name}

    mr_offset = pages.get("mr", 0) * PAGE_SIZE
    mr_rows = frappe.db.sql(
        f"""
        SELECT DISTINCT mr.name, mr.transaction_date, mr.status,
            SUM(mri.amount) AS amount,
            COUNT(*) OVER() AS total_count
        FROM `tabMaterial Request` mr
        INNER JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
        WHERE mr.docstatus = 1 AND mr.company = %(company)s AND mri.project = %(project)s
            {mr_exclude}
        GROUP BY mr.name
        ORDER BY mr.transaction_date DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        {**base_params, "limit": PAGE_SIZE, "offset": mr_offset},
        as_dict=True,
    )
    docs["mr"] = mr_rows
    docs["mr_total"] = mr_rows[0]["total_count"] if mr_rows else 0

    po_offset = pages.get("po", 0) * PAGE_SIZE
    po_rows = frappe.db.sql(
        f"""
        SELECT DISTINCT po.name, po.transaction_date, po.status,
            SUM(poi.amount) AS amount, SUM(poi.billed_amt) AS billed_amt,
            COUNT(*) OVER() AS total_count
        FROM `tabPurchase Order` po
        INNER JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
        WHERE po.docstatus = 1 AND po.company = %(company)s AND poi.project = %(project)s
            {po_exclude}
        GROUP BY po.name
        ORDER BY po.transaction_date DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        {**base_params, "limit": PAGE_SIZE, "offset": po_offset},
        as_dict=True,
    )
    docs["po"] = po_rows
    docs["po_total"] = po_rows[0]["total_count"] if po_rows else 0

    pi_offset = pages.get("pi", 0) * PAGE_SIZE
    pi_rows = frappe.db.sql(
        f"""
        SELECT DISTINCT pi.name, pi.posting_date, pi.status,
            SUM(pii.amount) AS amount,
            COUNT(*) OVER() AS total_count
        FROM `tabPurchase Invoice` pi
        INNER JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
        WHERE pi.docstatus = 1 AND pi.company = %(company)s AND pii.project = %(project)s
            {pi_exclude}
        GROUP BY pi.name
        ORDER BY pi.posting_date DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        {**base_params, "limit": PAGE_SIZE, "offset": pi_offset},
        as_dict=True,
    )
    docs["pi"] = pi_rows
    docs["pi_total"] = pi_rows[0]["total_count"] if pi_rows else 0

    je_offset = pages.get("je", 0) * PAGE_SIZE
    je_rows = frappe.db.sql(
        f"""
        SELECT DISTINCT je.name, je.posting_date,
            SUM(jea.debit_in_account_currency) - SUM(jea.credit_in_account_currency) AS amount,
            COUNT(*) OVER() AS total_count
        FROM `tabJournal Entry` je
        INNER JOIN `tabJournal Entry Account` jea ON jea.parent = je.name
        WHERE je.docstatus = 1 AND je.company = %(company)s AND jea.project = %(project)s
            {je_exclude}
        GROUP BY je.name
        ORDER BY je.posting_date DESC
        LIMIT %(limit)s OFFSET %(offset)s
        """,
        {**base_params, "limit": PAGE_SIZE, "offset": je_offset},
        as_dict=True,
    )
    docs["je"] = je_rows
    docs["je_total"] = je_rows[0]["total_count"] if je_rows else 0

    if "hrms" in frappe.get_installed_apps():
        ec_offset = pages.get("ec", 0) * PAGE_SIZE
        ec_rows = frappe.db.sql(
            f"""
            SELECT DISTINCT ec.name, ec.posting_date, ec.status,
                SUM(ecd.sanctioned_amount) AS amount,
                COUNT(*) OVER() AS total_count
            FROM `tabExpense Claim` ec
            INNER JOIN `tabExpense Claim Detail` ecd ON ecd.parent = ec.name
            WHERE ec.docstatus = 1 AND ec.company = %(company)s
                AND (ecd.project = %(project)s OR ec.project = %(project)s)
                {ec_exclude}
            GROUP BY ec.name
            ORDER BY ec.posting_date DESC
            LIMIT %(limit)s OFFSET %(offset)s
            """,
            {**base_params, "limit": PAGE_SIZE, "offset": ec_offset},
            as_dict=True,
        )
        docs["ec"] = ec_rows
        docs["ec_total"] = ec_rows[0]["total_count"] if ec_rows else 0

    return docs


def _build_message_from_dict(row, check_type, parent, current_doc_amount=0.0, amount_details=None, source_rows=None):
    estimated = flt(row.get("estimated_amount"))
    cumulative_after = flt(row.get("cumulative_expense_amount"))
    cumulative_before = cumulative_after - flt(current_doc_amount)
    variance_before = estimated - cumulative_before
    deviation = cumulative_after - estimated

    is_monthly = check_type != "total"
    header_text = (
        "has exceeded its monthly cumulative budget"
        if is_monthly
        else "has exceeded its total estimated budget"
    )

    currency_opts = {"fieldtype": "Currency"}

    breakdown_rows = ""
    if amount_details and flt(amount_details.get("already_counted")) > 0:
        breakdown_rows = f"""
                <tr><td>This document's total amount</td><td><b>{frappe.format_value(amount_details["total_amount"], currency_opts)}</b></td></tr>
                <tr><td>Already counted at an earlier stage</td><td><b>{frappe.format_value(amount_details["already_counted"], currency_opts)}</b></td></tr>
                <tr><td>New spending (this document)</td><td><b>{frappe.format_value(amount_details["new_spending"], currency_opts)}</b></td></tr>"""
    else:
        breakdown_rows = f"""
                <tr><td>This document's amount</td><td><b>{frappe.format_value(current_doc_amount, currency_opts)}</b></td></tr>"""

    source_rows_row = ""
    if source_rows:
        source_rows_row = f"""
                <tr><td>Source row(s) in document</td><td><b>{', '.join(map(str, source_rows))}</b></td></tr>"""

    return f"""
        <p><b>Budget exceeded</b> &nbsp; Project <b>{parent.get('project')}</b></p>
        <p>Budget category <b>{row.get('budget_category')}</b> {header_text}.</p>
        <table border="1" cellpadding="6" cellspacing="0">
            <tbody>
                <tr><td>Estimated budget</td><td><b>{frappe.format_value(estimated, currency_opts)}</b></td></tr>
                <tr><td>Actual before this document</td><td><b>{frappe.format_value(cumulative_before, currency_opts)}</b></td></tr>
                <tr><td>Remaining before this document</td><td><b>{frappe.format_value(variance_before, currency_opts)}</b></td></tr>{breakdown_rows}{source_rows_row}
                <tr><td>Deviation over budget</td><td><b>{frappe.format_value(deviation, currency_opts)}</b></td></tr>
            </tbody>
        </table>
    """


# ---------------------------------------------------------------------------
# Whitelisted API for client-side preview (used by the JS dialog)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_budget_check_preview(
    company, accounts, trigger_stage, items=None,
    current_doctype=None, current_docname=None, doc_date=None,
):
    """
    Evaluates ALL projects touched by the document's items (each item must
    carry its own "project" field), not just a single project - matching
    the real on_submit enforcement which always checks every project in the
    document together and returns one combined violations list.

    Permission check: a project is only processed if the current user has
    read access to it. Any project the user is not permitted to view is
    silently skipped (no budget data leaked for it), rather than raising -
    since this is a best-effort preview and the real on_submit enforcement
    still applies its own checks regardless of this preview.
    """
    import json

    if isinstance(accounts, str):
        accounts = json.loads(accounts)
    if isinstance(items, str):
        items = json.loads(items)
    items = items or []

    if not isinstance(accounts, list):
        return {"error": "accounts must be a list"}

    can_bypass = _can_bypass_budget()
    doc_date = getdate(doc_date) if doc_date else getdate(frappe.utils.today())

    items_by_project = {}
    account_idx_map_by_project = {}
    for item in items:
        proj = item.get("project")
        acc = item.get("account")
        if not proj or not acc:
            continue
        items_by_project.setdefault(proj, []).append(item)
        if item.get("idx") is not None:
            account_idx_map_by_project.setdefault(proj, {}).setdefault(acc, []).append(item.get("idx"))

    class _PreviewDoc:
        def __init__(self, items):
            self._items = items

        def get(self, key):
            if key == "items":
                return self._items
            return None

    violations = []

    for project, proj_items in items_by_project.items():
        if not frappe.has_permission("Project", ptype="read", doc=project):
            continue

        proj_accounts = list({i.get("account") for i in proj_items if i.get("account")})

        active_budget_name = _get_active_budget_name(project)

        v = _check_category_restriction(
            company, project, proj_accounts, current_doctype, current_docname,
            account_idx_map=account_idx_map_by_project.get(project, {}),
        )
        if v:
            v["can_bypass"] = can_bypass
            violations.append(v)

        all_categories = []
        seen = set()
        for account in proj_accounts:
            for c in get_categories_for_account(company, account):
                if c not in seen:
                    seen.add(c)
                    all_categories.append(c)

        if not all_categories:
            continue

        in_range_rows, out_of_range_rows = _get_affected_detail_rows(
            active_budget_name, all_categories, doc_date
        )

        date_violations = _collect_date_range_violations(
            in_range_rows, out_of_range_rows, trigger_stage, current_doctype, current_docname
        )
        for dv in date_violations:
            dv["can_bypass"] = can_bypass
        violations.extend(date_violations)

        if not in_range_rows:
            continue

        rows_batch = _load_rows_batch(list(in_range_rows))
        preview_doc = _PreviewDoc(proj_items)

        for row_name, parent_name in in_range_rows:
            entry = rows_batch.get(row_name)
            if not entry:
                continue
            row = entry["row"]
            parent = entry["parent"]

            applicable_field = {
                "material_request": "applicable_on_material_request",
                "purchase_order": "applicable_on_purchase_order",
                "actual": "applicable_on_booking_actual_expenses",
            }[trigger_stage]
            if not row.get(applicable_field):
                continue

            _recalculate_row_from_dict(row, parent, doc_date)

            row_accounts = get_accounts_for_category(row.get("budget_category"))
            amount_details = _get_current_doc_amount_details(
                row_name, preview_doc, trigger_stage, accounts=set(row_accounts)
            )

            row["cumulative_expense_amount"] = flt(row.get("cumulative_expense_amount")) + amount_details["new_spending"]
            row["actual_amount_till_month"] = flt(row.get("actual_amount_till_month")) + amount_details["new_spending"]

            row_violations = _evaluate_budget_row(
                row, parent, trigger_stage, doc_date,
                current_doc_amount=amount_details["new_spending"],
                current_doctype=current_doctype,
                current_docname=current_docname,
                amount_details=amount_details,
                source_rows=amount_details["source_rows"],
            )
            for rv in row_violations:
                rv["can_bypass"] = can_bypass
                rv["documents"] = _get_related_documents(
                    parent.get("company"), parent.get("project"), current_doctype, current_docname, {}
                )
            violations.extend(row_violations)

    return {"violations": violations}


@frappe.whitelist()
def get_related_documents_page(
    company, project, pages, exclude_doctype=None, exclude_name=None
):
    import json

    if isinstance(pages, str):
        pages = json.loads(pages)
    return _get_related_documents(
        company, project, exclude_doctype, exclude_name, pages
    )


@frappe.whitelist()
def get_project_budget_dashboard(project):
    """
    Returns a live snapshot of the project's active (submitted) Project
    Cost Budget: each Budget Category row with its estimated amount,
    live actual/cumulative spend, remaining balance, and percentage used.
    Numbers are recalculated live (not read from the stored cache) so the
    dashboard always reflects the current state.
    """
    budget_name = frappe.db.get_value("Project", project, "custom_budget_cost")
    if not budget_name:
        return {"has_budget": False}

    parent = frappe.get_doc("Project Cost Budget", budget_name)
    if parent.docstatus != 1:
        return {
            "has_budget": True,
            "budget_name": budget_name,
            "is_submitted": False,
            "docstatus": parent.docstatus,
        }

    rows = []
    total_estimated = 0.0
    total_cumulative = 0.0

    for row in parent.details:
        # Live recalculation - row is a real document object here (not a
        # dict from batch loading), so recalc into a dict copy then write
        # the results back onto it.
        row_dict = row.as_dict()
        _recalculate_row_from_dict(row_dict, parent.as_dict(), getdate(frappe.utils.today()))
        for _k in (
            "actual_expense_amount", "material_request_amount", "purchase_order_amount",
            "cumulative_expense_amount", "actual_amount_till_month",
            "cumulative_amount_till_month", "variance", "variance_percentage",
        ):
            row.set(_k, row_dict.get(_k))

        estimated = flt(row.estimated_amount)
        cumulative = flt(row.cumulative_expense_amount)
        remaining = estimated - cumulative
        pct_used = (cumulative / estimated * 100) if estimated else 0.0

        rows.append({
            "budget_category": row.budget_category,
            "estimated_amount": estimated,
            "actual_expense_amount": flt(row.actual_expense_amount),
            "material_request_amount": flt(row.material_request_amount),
            "purchase_order_amount": flt(row.purchase_order_amount),
            "cumulative_expense_amount": cumulative,
            "remaining_amount": remaining,
            "percentage_used": pct_used,
        })

        total_estimated += estimated
        total_cumulative += cumulative

    return {
        "has_budget": True,
        "budget_name": budget_name,
        "is_submitted": True,
        "currency": parent.currency,
        "from_date": parent.from_date,
        "to_date": parent.to_date,
        "total_estimated": total_estimated,
        "total_cumulative": total_cumulative,
        "total_remaining": total_estimated - total_cumulative,
        "total_percentage_used": (total_cumulative / total_estimated * 100) if total_estimated else 0.0,
        "rows": rows,
    }


# ---------------------------------------------------------------------------
# Dashboard: summary of estimated vs actual across ALL projects
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_all_projects_budget_summary(company=None, project=None, extra_filters=None):
    """
    Returns one row per (project, budget category) combination, across
    every project with an active submitted Project Cost Budget. Uses a
    single JOINed SQL query (no N+1) - joins Project Cost Budget with
    Project itself, so dynamically-configured filters can target fields
    living on either doctype (e.g. "customer" lives on Project, not on
    Project Cost Budget).

    extra_filters: optional JSON list of
        [{"target_field": ..., "source_doctype": "Project Cost Budget" | "Project", "value": ...}, ...]
    Each (source_doctype, target_field) pair is validated against that
    doctype's real fields before being used in the query, to prevent
    building SQL with an arbitrary/unsafe column name.
    """
    import json

    _clear_cached_amounts()

    if isinstance(extra_filters, str):
        try:
            extra_filters = json.loads(extra_filters)
        except Exception:
            extra_filters = []
    extra_filters = extra_filters or []

    valid_fields_by_doctype = {
        "Project Cost Budget": {f.fieldname for f in frappe.get_meta("Project Cost Budget").fields}
        | {"name", "company", "project", "docstatus"},
        "Project": {f.fieldname for f in frappe.get_meta("Project").fields}
        | {"name", "company"},
    }
    alias_by_doctype = {"Project Cost Budget": "p", "Project": "proj"}

    conditions = ["p.docstatus = 1"]
    params = {}
    if company:
        conditions.append("p.company = %(company)s")
        params["company"] = company
    if project:
        conditions.append("p.project = %(project)s")
        params["project"] = project

    for idx, f in enumerate(extra_filters):
        fieldname = f.get("target_field")
        source = f.get("source_doctype") or "Project Cost Budget"
        value = f.get("value")
        if not value or not fieldname:
            continue
        valid_fields = valid_fields_by_doctype.get(source)
        if not valid_fields or fieldname not in valid_fields:
            # Unknown/unsafe (doctype, fieldname) pair - skip rather than
            # error, so one misconfigured filter row doesn't break the
            # whole dashboard.
            continue
        alias = alias_by_doctype.get(source, "p")
        param_key = f"extra_{idx}"
        conditions.append(f"{alias}.`{fieldname}` = %({param_key})s")
        params[param_key] = value

    where_clause = " AND ".join(conditions)

    rows = frappe.db.sql(
        f"""
        SELECT
            d.name AS row_name, d.parent AS budget_name, d.budget_category,
            d.estimated_amount, d.from_date AS row_from_date, d.to_date AS row_to_date,
            p.project, p.company, p.currency, p.conversion_rate,
            p.from_date AS parent_from_date, p.to_date AS parent_to_date
        FROM `tabProject Cost Budget Detail` d
        INNER JOIN `tabProject Cost Budget` p ON d.parent = p.name
        INNER JOIN `tabProject` proj ON p.project = proj.name
        WHERE {where_clause}
        ORDER BY p.project ASC
        """,
        params,
        as_dict=True,
    )

    rows_out = []
    for r in rows:
        row_dict = {
            "budget_category": r.budget_category,
            "estimated_amount": r.estimated_amount,
            "from_date": r.row_from_date,
            "to_date": r.row_to_date,
        }
        parent_dict = {
            "project": r.project,
            "company": r.company,
            "currency": r.currency,
            "conversion_rate": r.conversion_rate,
            "from_date": r.parent_from_date,
            "to_date": r.parent_to_date,
        }

        _recalculate_row_from_dict(row_dict, parent_dict, getdate(frappe.utils.today()))

        estimated = flt(row_dict.get("estimated_amount"))
        cumulative = flt(row_dict.get("cumulative_expense_amount"))
        remaining = estimated - cumulative
        pct_used = (cumulative / estimated * 100) if estimated else 0.0

        rows_out.append({
            "project": r.project,
            "company": r.company,
            "budget_name": r.budget_name,
            "currency": r.currency,
            "budget_category": r.budget_category,
            "estimated": estimated,
            "actual": cumulative,
            "remaining": remaining,
            "percentage_used": pct_used,
        })

    return {"rows": rows_out}


# ---------------------------------------------------------------------------
# Configurable Dashboard Filters (managed from Project Budget Settings)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_dashboard_filter_fields():
    """
    Returns the list of enabled custom dashboard filters configured in
    Project Budget Settings, so the dashboard page can render one dropdown
    per row without any code changes when a new filter is added/removed.
    """
    settings = frappe.get_single("Project Budget Settings")
    return [
        {
            "label": row.label,
            "target_field": row.target_field,
            "source_doctype": row.source_doctype or "Project Cost Budget",
            "link_doctype": row.link_doctype,
        }
        for row in settings.dashboard_filters
        if row.enabled
    ]
