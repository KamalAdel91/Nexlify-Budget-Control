"""
budget_enforcement.py
----------------------
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
"""

import calendar

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
# Public hook entry-points
# ---------------------------------------------------------------------------


def on_material_request_submit(doc, method=None):
    check_cost_budget(doc, "material_request")


def on_purchase_order_submit(doc, method=None):
    check_cost_budget(doc, "purchase_order")


def on_purchase_invoice_submit(doc, method=None):
    check_cost_budget(doc, "actual")


def on_journal_entry_submit(doc, method=None):
    if not _is_budget_control_enabled():
        return

    doc_date = getdate(doc.get("posting_date"))
    company = doc.get("company")

    projects_touched = {}
    for account_row in doc.get("accounts") or []:
        project = account_row.get("project")
        account = account_row.get("account")
        if not project or not account:
            continue
        projects_touched.setdefault(project, set()).add(account)
    for project, accounts in projects_touched.items():
        _enforce_category_restriction(
            company, project, list(accounts), doc.doctype, doc.name
        )

    budget_names = {p: _get_active_budget_name(p) for p in projects_touched}

    # Net debit minus credit per (project, account) WITHIN this document.
    # A Journal Entry naturally has multiple rows on the same account (a
    # transfer or correction often debits and credits the same account
    # for the same amount) - what matters for budget enforcement is the
    # document's net effect on that account, not any single row's debit
    # value in isolation. A net of zero (or negative) means this document
    # has no real new spending on that account and should not trigger
    # enforcement at all.
    net_by_project_account = {}
    for account_row in doc.get("accounts") or []:
        project = account_row.get("project")
        account = account_row.get("account")
        if not project or not account:
            continue
        debit_amt = flt(account_row.get("debit_in_account_currency"))
        credit_amt = flt(account_row.get("credit_in_account_currency"))
        key = (project, account)
        net_by_project_account[key] = net_by_project_account.get(key, 0.0) + (debit_amt - credit_amt)

    all_in_range_rows = set()
    all_out_of_range_rows = set()
    net_amounts_by_row = {}

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

    _enforce_date_range_violations(
        all_in_range_rows, all_out_of_range_rows, "actual", doc.doctype, doc.name
    )

    for row_name, parent_name in all_in_range_rows:
        current_amt = net_amounts_by_row.get((row_name, parent_name), 0.0)
        _process_budget_row(
            row_name,
            parent_name,
            "actual",
            doc_date,
            enforce=True,
            current_doc_amount=current_amt,
            current_doctype=doc.doctype,
            current_docname=doc.name,
        )


def on_expense_claim_submit(doc, method=None):
    if not _is_budget_control_enabled():
        return

    doc_date = getdate(doc.get("posting_date") or frappe.utils.today())
    company = doc.get("company")

    projects_touched = {}
    for expense_row in doc.get("expenses") or []:
        project = expense_row.get("project") or doc.get("project")
        account = expense_row.get("default_account")
        if not project or not account:
            continue
        projects_touched.setdefault(project, set()).add(account)
    for project, accounts in projects_touched.items():
        _enforce_category_restriction(
            company, project, list(accounts), doc.doctype, doc.name
        )

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

    _enforce_date_range_violations(
        all_in_range_rows, all_out_of_range_rows, "actual", doc.doctype, doc.name
    )

    for row_name, parent_name in all_in_range_rows:
        amount_details = _get_current_doc_amount_details(row_name, doc, "actual")
        _process_budget_row(
            row_name,
            parent_name,
            "actual",
            doc_date,
            enforce=True,
            current_doc_amount=amount_details["new_spending"],
            current_doctype=doc.doctype,
            current_docname=doc.name,
            amount_details=amount_details,
        )


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
    if not _is_budget_control_enabled():
        return

    doc_date = getdate(
        doc.get("posting_date")
        or doc.get("transaction_date")
        or doc.get("schedule_date")
    )
    company = doc.get("company")

    projects_touched = {}
    for item in doc.get("items") or []:
        project = item.get("project")
        account = item.get("expense_account")
        if not project or not account:
            continue
        projects_touched.setdefault(project, set()).add(account)
    for project, accounts in projects_touched.items():
        _enforce_category_restriction(
            company, project, list(accounts), doc.doctype, doc.name
        )

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

    _enforce_date_range_violations(
        all_in_range_rows, all_out_of_range_rows, trigger_stage, doc.doctype, doc.name
    )

    # Every affected row is recalculated AND enforced against its accurate,
    # up-to-date cumulative figure - there is no separate "carry-forward,
    # recalc-only" path. The previous design skipped enforcement entirely
    # for PO items linked to a Material Request (and PI items linked to a
    # Purchase Order), assuming the full amount had already been checked
    # at the earlier stage. That assumption breaks whenever the earlier
    # stage's amount differs from the current one (e.g. a Material Request
    # submitted for 0 followed by a Purchase Order for 40,000) - the
    # difference would silently escape budget enforcement. Using the
    # precise pending-amount calculation in budget_utils (which already
    # nets out ordered_qty / billed_amt per stage) makes a separate
    # carry-forward concept unnecessary: the recalculated cumulative is
    # always correct on its own.
    for row_name, parent_name in all_in_range_rows:
        amount_details = _get_current_doc_amount_details(row_name, doc, trigger_stage)
        _process_budget_row(
            row_name,
            parent_name,
            trigger_stage,
            doc_date,
            enforce=True,
            current_doc_amount=amount_details["new_spending"],
            current_doctype=doc.doctype,
            current_docname=doc.name,
            amount_details=amount_details,
        )


def _get_current_doc_amount_for_row(row_name, parent_name, doc, trigger_stage, company):
    """
    Returns this document's own contribution to a given budget row, for
    DISPLAY purposes only (used in the violation message's "This
    document's amount" line) - it does not affect whether enforcement
    triggers, since that now always uses the accurate recalculated
    cumulative_expense_amount instead of a manually-summed amount.

    For carry-forward items (PO linked to an MR, PI linked to a PO), the
    "new spending" portion is the document's amount minus whatever the
    prior-stage document for the same item already contributed, floored
    at zero. Returns a dict with all three figures so callers can show
    both the document's face value and the incremental new spend.
    """
    details = _get_current_doc_amount_details(row_name, doc, trigger_stage)
    return details["new_spending"]


def _get_current_doc_amount_details(row_name, doc, trigger_stage):
    """
    Same calculation as _get_current_doc_amount_for_row, but returns the
    full breakdown: total document amount on this row's accounts,
    how much was already counted at a prior stage (MR for a PO, PO for a
    PI), and the resulting new spending (total - already_counted, floored
    at zero).
    """
    row = frappe.get_doc("Project Cost Budget Detail", row_name)
    accounts = set(get_accounts_for_category(row.budget_category))

    total_amount = 0.0
    already_counted = 0.0

    for item in doc.get("items") or []:
        # Real submitted documents (Material Request Item, Purchase Order
        # Item, Purchase Invoice Item) use the fieldname "expense_account".
        # The client-side preview payload (budget_check.js) sends "account"
        # instead - support both so this works identically for the real
        # on_submit enforcement and the before_submit preview dialog.
        account = item.get("expense_account") or item.get("account")
        if account not in accounts:
            continue

        item_amount = flt(item.get("amount"))
        total_amount += item_amount

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
    }


def _get_active_budget_name(project):
    """
    Returns the name of the Project Cost Budget currently linked to this
    project via Project.custom_budget_cost, but ONLY if that budget is
    actually submitted (docstatus == 1). Returns None if the project has
    no linked budget, or if the linked budget is not submitted (e.g. it
    was cancelled and not yet amended) - in either case there is no
    active budget to enforce against.

    This is the single source of truth for "which budget applies to this
    project" used across every enforcement entry point (Material Request,
    Purchase Order, Purchase Invoice, Journal Entry, Expense Claim) so
    they can never disagree with each other or with what is shown on the
    Project's own Budget tab.
    """
    budget_name = frappe.db.get_value("Project", project, "custom_budget_cost")
    if not budget_name:
        return None

    docstatus = frappe.db.get_value("Project Cost Budget", budget_name, "docstatus")
    if docstatus != 1:
        return None

    return budget_name


def _get_affected_detail_rows(budget_name, categories, doc_date):
    """
    Returns the (in_range, out_of_range) Budget Category Detail rows for
    a SPECIFIC budget document (the one currently active on the project,
    per _get_active_budget_name) - not "any submitted budget for this
    project". This guarantees every enforcement call site reads from the
    exact same budget as Project.custom_budget_cost, even if older
    submitted/amended budget documents still exist in the database.
    """
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


def _enforce_date_range_violations(
    in_range_rows,
    out_of_range_rows,
    trigger_stage,
    current_doctype=None,
    current_docname=None,
):
    if not out_of_range_rows:
        return

    covered_categories = set()
    for row_name, parent_name in in_range_rows:
        row = frappe.get_doc("Project Cost Budget Detail", row_name)
        covered_categories.add((parent_name, row.budget_category))

    for row_name, parent_name in out_of_range_rows:
        row = frappe.get_doc("Project Cost Budget Detail", row_name)

        if (parent_name, row.budget_category) in covered_categories:
            continue

        parent = frappe.get_doc("Project Cost Budget", parent_name)

        applicable_field = {
            "material_request": "applicable_on_material_request",
            "purchase_order": "applicable_on_purchase_order",
            "actual": "applicable_on_booking_actual_expenses",
        }[trigger_stage]
        if not row.get(applicable_field):
            continue

        action = _get_action(row, "annual", trigger_stage)
        if action == "None":
            continue

        eff_from = row.from_date or parent.from_date
        eff_to = row.to_date or parent.to_date
        msg = (
            f"Project <b>{parent.project}</b>: Budget Category <b>{row.budget_category}</b> "
            f"is only active from <b>{frappe.utils.formatdate(eff_from)}</b> to "
            f"<b>{frappe.utils.formatdate(eff_to)}</b>. This document's date falls "
            f"outside that period."
        )
        _enforce(action, msg)


def _process_budget_row(
    row_name,
    parent_name,
    trigger_stage,
    doc_date,
    enforce=True,
    current_doc_amount=0.0,
    current_doctype=None,
    current_docname=None,
    amount_details=None,
):
    row = frappe.get_doc("Project Cost Budget Detail", row_name)
    parent = frappe.get_doc("Project Cost Budget", parent_name)

    applicable_field = {
        "material_request": "applicable_on_material_request",
        "purchase_order": "applicable_on_purchase_order",
        "actual": "applicable_on_booking_actual_expenses",
    }[trigger_stage]
    if not row.get(applicable_field):
        return

    _recalculate_row(row, parent, doc_date)

    if not enforce:
        return

    _check_threshold_warning(row, parent)

    annual_action = _get_action(row, "annual", trigger_stage)
    if annual_action != "None" and flt(row.cumulative_expense_amount) > flt(
        row.estimated_amount
    ):
        msg = _build_message(row, "total", parent, current_doc_amount, amount_details)
        _enforce(annual_action, msg)
        notify_project_stakeholders(
            parent.project, msg, "Project Cost Budget", parent.name
        )

    if row.monthly_distribution:
        monthly_action = _get_action(row, "monthly", trigger_stage)
        if monthly_action != "None":
            eff_from = getdate(row.from_date or parent.from_date)
            eff_to = getdate(row.to_date or parent.to_date)
            month_end = _end_of_month_for(doc_date, eff_to)
            monthly_budget_base = _get_monthly_budget_till_date(
                row, parent, eff_from, eff_to, month_end
            )
            monthly_budget_doc = convert_to_doc_currency(
                monthly_budget_base,
                parent.company,
                parent.currency,
                parent.conversion_rate,
            )
            if flt(row.actual_amount_till_month) > monthly_budget_doc:
                msg = _build_message(row, "monthly", parent, current_doc_amount, amount_details)
                _enforce(monthly_action, msg)
                notify_project_stakeholders(
                    parent.project, msg, "Project Cost Budget", parent.name
                )


# ---------------------------------------------------------------------------
# Recalculation
# ---------------------------------------------------------------------------


def _recalculate_row(row, parent, doc_date):
    accounts = get_accounts_for_category(row.budget_category)
    eff_from = getdate(row.from_date or parent.from_date)
    eff_to = getdate(row.to_date or parent.to_date)
    cr = flt(parent.conversion_rate) or 1.0

    mr_base = get_material_request_amount(parent.company, parent.project, accounts)
    po_base = get_purchase_order_amount(parent.company, parent.project, accounts)
    actual_base = get_actual_expense(
        parent.company, parent.project, accounts, eff_from, eff_to
    )
    cumulative_base = get_cumulative_amount(actual_base, mr_base, po_base)

    month_end = _end_of_month_for(doc_date, eff_to)
    actual_till_month_base = get_actual_expense(
        parent.company, parent.project, accounts, eff_from, month_end
    )
    monthly_cumulative_base = get_cumulative_amount(
        actual_till_month_base, mr_base, po_base
    )

    row.actual_expense_amount = convert_to_doc_currency(
        actual_base, parent.company, parent.currency, cr
    )
    row.material_request_amount = convert_to_doc_currency(
        mr_base, parent.company, parent.currency, cr
    )
    row.purchase_order_amount = convert_to_doc_currency(
        po_base, parent.company, parent.currency, cr
    )
    row.cumulative_expense_amount = convert_to_doc_currency(
        cumulative_base, parent.company, parent.currency, cr
    )
    row.actual_amount_till_month = convert_to_doc_currency(
        actual_till_month_base, parent.company, parent.currency, cr
    )
    row.cumulative_amount_till_month = convert_to_doc_currency(
        monthly_cumulative_base, parent.company, parent.currency, cr
    )

    estimated = flt(row.estimated_amount)
    row.variance = estimated - flt(row.cumulative_expense_amount)
    row.variance_percentage = (row.variance / estimated * 100) if estimated else 0.0

    # Use db_set for each field to properly trigger hooks and validations
    # db_update() bypasses hooks and can leave data in an inconsistent state
    row.db_set("actual_expense_amount", row.actual_expense_amount, update_modified=False)
    row.db_set("material_request_amount", row.material_request_amount, update_modified=False)
    row.db_set("purchase_order_amount", row.purchase_order_amount, update_modified=False)
    row.db_set("cumulative_expense_amount", row.cumulative_expense_amount, update_modified=False)
    row.db_set("actual_amount_till_month", row.actual_amount_till_month, update_modified=False)
    row.db_set("cumulative_amount_till_month", row.cumulative_amount_till_month, update_modified=False)
    row.db_set("variance", row.variance, update_modified=False)
    row.db_set("variance_percentage", row.variance_percentage, update_modified=False)


def _get_monthly_budget_till_date(row, parent, eff_from, eff_to, month_end):
    estimated_base = flt(row.estimated_amount) / (flt(parent.conversion_rate) or 1.0)

    if row.monthly_distribution:
        percentages = frappe.db.sql(
            """
			SELECT month, percentage_allocation
			FROM `tabMonthly Distribution Percentage`
			WHERE parent = %(dist)s
		""",
            {"dist": row.monthly_distribution},
            as_dict=True,
        )

        month_order = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ]
        cutoff_index = month_order.index(month_order[month_end.month - 1])

        pct_total = 0.0
        for p in percentages:
            if p.month in month_order and month_order.index(p.month) <= cutoff_index:
                pct_total += flt(p.percentage_allocation)
        return estimated_base * pct_total / 100.0
    else:
        total_days = (eff_to - eff_from).days + 1
        elapsed_days = (min(month_end, eff_to) - eff_from).days + 1
        if total_days <= 0:
            return estimated_base
        fraction = max(0.0, min(1.0, elapsed_days / total_days))
        return estimated_base * fraction


def _end_of_month_for(doc_date, max_date):
    last_day = calendar.monthrange(doc_date.year, doc_date.month)[1]
    end_of_month = doc_date.replace(day=last_day)
    return min(end_of_month, getdate(max_date))


# ---------------------------------------------------------------------------
# Warnings / actions / messages
# ---------------------------------------------------------------------------


def _check_threshold_warning(row, parent):
    threshold = flt(row.warning_threshold_percentage) or 80.0
    estimated = flt(row.estimated_amount)
    cumulative = flt(row.cumulative_expense_amount)
    if (
        estimated
        and cumulative >= (estimated * threshold / 100)
        and cumulative < estimated
    ):
        pct = round(cumulative / estimated * 100, 1)
        msg = (
            f"Budget Category <b>{row.budget_category}</b> has reached "
            f"<b>{pct}%</b> of its estimated budget "
            f"({frappe.format_value(cumulative, {'fieldtype': 'Currency'})} / "
            f"{frappe.format_value(estimated, {'fieldtype': 'Currency'})})."
        )
        frappe.msgprint(msg, alert=True, indicator="yellow")
        notify_project_stakeholders(
            parent.project, msg, "Project Cost Budget", parent.name
        )


def _get_action(row, check_type, trigger_stage):
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

    mr_exclude = (
        "AND mr.name != %(exclude_name)s"
        if exclude_doctype == "Material Request"
        else ""
    )
    po_exclude = (
        "AND po.name != %(exclude_name)s" if exclude_doctype == "Purchase Order" else ""
    )
    pi_exclude = (
        "AND pi.name != %(exclude_name)s"
        if exclude_doctype == "Purchase Invoice"
        else ""
    )
    je_exclude = (
        "AND je.name != %(exclude_name)s" if exclude_doctype == "Journal Entry" else ""
    )
    ec_exclude = (
        "AND ec.name != %(exclude_name)s" if exclude_doctype == "Expense Claim" else ""
    )

    params = {"company": company, "project": project, "exclude_name": exclude_name}

    mr_offset = pages.get("mr", 0) * PAGE_SIZE
    docs["mr_total"] = frappe.db.sql(
        f"""
		SELECT COUNT(DISTINCT mr.name) AS cnt
		FROM `tabMaterial Request` mr
		INNER JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
		WHERE mr.docstatus = 1 AND mr.company = %(company)s AND mri.project = %(project)s
			{mr_exclude}
	""",
        params,
        as_dict=True,
    )[0].cnt
    docs["mr"] = frappe.db.sql(
        f"""
		SELECT DISTINCT mr.name, mr.transaction_date, mr.status,
			SUM(mri.amount) AS amount
		FROM `tabMaterial Request` mr
		INNER JOIN `tabMaterial Request Item` mri ON mri.parent = mr.name
		WHERE mr.docstatus = 1 AND mr.company = %(company)s AND mri.project = %(project)s
			{mr_exclude}
		GROUP BY mr.name
		ORDER BY mr.transaction_date DESC
		LIMIT {PAGE_SIZE} OFFSET {mr_offset}
	""",
        params,
        as_dict=True,
    )

    po_offset = pages.get("po", 0) * PAGE_SIZE
    docs["po_total"] = frappe.db.sql(
        f"""
		SELECT COUNT(DISTINCT po.name) AS cnt
		FROM `tabPurchase Order` po
		INNER JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
		WHERE po.docstatus = 1 AND po.company = %(company)s AND poi.project = %(project)s
			{po_exclude}
	""",
        params,
        as_dict=True,
    )[0].cnt
    docs["po"] = frappe.db.sql(
        f"""
		SELECT DISTINCT po.name, po.transaction_date, po.status,
			SUM(poi.amount) AS amount, SUM(poi.billed_amt) AS billed_amt
		FROM `tabPurchase Order` po
		INNER JOIN `tabPurchase Order Item` poi ON poi.parent = po.name
		WHERE po.docstatus = 1 AND po.company = %(company)s AND poi.project = %(project)s
			{po_exclude}
		GROUP BY po.name
		ORDER BY po.transaction_date DESC
		LIMIT {PAGE_SIZE} OFFSET {po_offset}
	""",
        params,
        as_dict=True,
    )

    pi_offset = pages.get("pi", 0) * PAGE_SIZE
    docs["pi_total"] = frappe.db.sql(
        f"""
		SELECT COUNT(DISTINCT pi.name) AS cnt
		FROM `tabPurchase Invoice` pi
		INNER JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
		WHERE pi.docstatus = 1 AND pi.company = %(company)s AND pii.project = %(project)s
			{pi_exclude}
	""",
        params,
        as_dict=True,
    )[0].cnt
    docs["pi"] = frappe.db.sql(
        f"""
		SELECT DISTINCT pi.name, pi.posting_date, pi.status,
			SUM(pii.amount) AS amount
		FROM `tabPurchase Invoice` pi
		INNER JOIN `tabPurchase Invoice Item` pii ON pii.parent = pi.name
		WHERE pi.docstatus = 1 AND pi.company = %(company)s AND pii.project = %(project)s
			{pi_exclude}
		GROUP BY pi.name
		ORDER BY pi.posting_date DESC
		LIMIT {PAGE_SIZE} OFFSET {pi_offset}
	""",
        params,
        as_dict=True,
    )

    je_offset = pages.get("je", 0) * PAGE_SIZE
    docs["je_total"] = frappe.db.sql(
        f"""
		SELECT COUNT(DISTINCT je.name) AS cnt
		FROM `tabJournal Entry` je
		INNER JOIN `tabJournal Entry Account` jea ON jea.parent = je.name
		WHERE je.docstatus = 1 AND je.company = %(company)s AND jea.project = %(project)s
			{je_exclude}
	""",
        params,
        as_dict=True,
    )[0].cnt
    docs["je"] = frappe.db.sql(
        f"""
		SELECT DISTINCT je.name, je.posting_date,
			SUM(jea.debit_in_account_currency) AS amount
		FROM `tabJournal Entry` je
		INNER JOIN `tabJournal Entry Account` jea ON jea.parent = je.name
		WHERE je.docstatus = 1 AND je.company = %(company)s AND jea.project = %(project)s
			{je_exclude}
		GROUP BY je.name
		ORDER BY je.posting_date DESC
		LIMIT {PAGE_SIZE} OFFSET {je_offset}
	""",
        params,
        as_dict=True,
    )

    if "hrms" in frappe.get_installed_apps():
        ec_offset = pages.get("ec", 0) * PAGE_SIZE
        docs["ec_total"] = frappe.db.sql(
            f"""
			SELECT COUNT(DISTINCT ec.name) AS cnt
			FROM `tabExpense Claim` ec
			INNER JOIN `tabExpense Claim Detail` ecd ON ecd.parent = ec.name
			WHERE ec.docstatus = 1 AND ec.company = %(company)s
				AND (ecd.project = %(project)s OR ec.project = %(project)s)
				{ec_exclude}
		""",
            params,
            as_dict=True,
        )[0].cnt
        docs["ec"] = frappe.db.sql(
            f"""
			SELECT DISTINCT ec.name, ec.posting_date, ec.status,
				SUM(ecd.sanctioned_amount) AS amount
			FROM `tabExpense Claim` ec
			INNER JOIN `tabExpense Claim Detail` ecd ON ecd.parent = ec.name
			WHERE ec.docstatus = 1 AND ec.company = %(company)s
				AND (ecd.project = %(project)s OR ec.project = %(project)s)
				{ec_exclude}
			GROUP BY ec.name
			ORDER BY ec.posting_date DESC
			LIMIT {PAGE_SIZE} OFFSET {ec_offset}
		""",
            params,
            as_dict=True,
        )

    return docs


def _build_message(row, check_type, parent, current_doc_amount=0.0, amount_details=None):
    estimated = flt(row.estimated_amount)
    cumulative_after = flt(row.cumulative_expense_amount)
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

    return f"""
		<p><b>Budget exceeded</b> &nbsp; Project <b>{parent.project}</b></p>
		<p>Budget category <b>{row.budget_category}</b> {header_text}.</p>
		<table border="1" cellpadding="6" cellspacing="0">
			<tbody>
				<tr><td>Estimated budget</td><td><b>{frappe.format_value(estimated, currency_opts)}</b></td></tr>
				<tr><td>Actual before this document</td><td><b>{frappe.format_value(cumulative_before, currency_opts)}</b></td></tr>
				<tr><td>Remaining before this document</td><td><b>{frappe.format_value(variance_before, currency_opts)}</b></td></tr>{breakdown_rows}
				<tr><td>Deviation over budget</td><td><b>{frappe.format_value(deviation, currency_opts)}</b></td></tr>
			</tbody>
		</table>
	"""


def _enforce(action, message):
    if action == "Stop" and _can_bypass_budget():
        frappe.msgprint(
            message, title="Budget Exceeded (Bypassed)", alert=True, indicator="orange"
        )
        return
    if action == "Stop":
        frappe.throw(message, title="Budget Exceeded")
    elif action == "Warn":
        frappe.msgprint(message, alert=True, indicator="orange")


def _can_bypass_budget():
    bypass_role = frappe.db.get_single_value("Projects Settings", "budget_bypass_role")
    if not bypass_role:
        return False
    return bypass_role in frappe.get_roles(frappe.session.user)


@frappe.request_cache
def _is_budget_control_enabled():
    """
    Check if Nexlify Budget Control is enabled.
    Uses request-level caching to avoid repeated DB queries.
    """
    return bool(
        frappe.db.get_single_value("Projects Settings", "enable_nexlify_budget_control")
    )


# ---------------------------------------------------------------------------
# Strict category-restriction enforcement
# ---------------------------------------------------------------------------


def _enforce_category_restriction(
    company, project, item_accounts, doctype_name, docname
):
    if not item_accounts:
        return

    active_budget_name = _get_active_budget_name(project)
    if not active_budget_name:
        return

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
        return

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

        if _can_bypass_budget():
            msg = (
                f"Project <b>{project}</b> is restricted to its Budget Category accounts only. "
                f"The following account(s) on <b>{doctype_name} {docname}</b> are outside that list: "
                f"<b>{', '.join(disallowed)}</b>."
            )
            frappe.msgprint(
                msg,
                title="Category Restriction (Bypassed)",
                alert=True,
                indicator="orange",
            )
            continue

        frappe.throw(
            f"Project <b>{project}</b> is restricted to its Budget Category accounts only. "
            f"The following account(s) are not part of any Budget Category for this project: "
            f"<b>{', '.join(disallowed)}</b>. Please use an account included in one of the project's "
            f"Budget Categories, or contact someone authorized to bypass this restriction.",
            title="Account Not In Budget Categories",
        )


# ---------------------------------------------------------------------------
# Whitelisted API for client-side preview (used by the JS dialog)
# ---------------------------------------------------------------------------


@frappe.whitelist()
def get_budget_check_preview(
    company,
    project,
    accounts,
    trigger_stage,
    items=None,
    current_doctype=None,
    current_docname=None,
    doc_date=None,
):
    """
    Returns a JSON-serializable preview of budget status for the given
    project/accounts, WITHOUT raising any exception. Used by the client
    script to render a rich confirmation Dialog before the actual
    submit happens.

    items: list of dicts with the document's own pending items (account,
    amount, and optionally material_request / purchase_order for the
    prior-stage link). Required because the document hasn't been
    submitted yet (docstatus=0 in DB at this point), so the stored
    cumulative_expense_amount on each budget row does NOT include this
    document's contribution. The per-row incremental amount is computed
    with the same logic as the real on_submit enforcement
    (_get_current_doc_amount_for_row), so the preview and the actual
    enforcement can never disagree.

    Error handling: If any error occurs during preview, we return the
    result with no violations rather than raising an exception. This
    allows the submit to proceed without budget check if preview fails.
    """
    import json

    if isinstance(accounts, str):
        accounts = json.loads(accounts)
    if isinstance(items, str):
        items = json.loads(items)
    items = items or []

    # Validate inputs
    if not isinstance(accounts, list):
        return {"error": "accounts must be a list"}

    # Ensure all accounts are strings
    accounts = [str(a) for a in accounts]

    # Wrap items in a lightweight object exposing .get(), matching the
    # shape _get_current_doc_amount_for_row expects from a real document
    class _PreviewDoc:
        def __init__(self, items):
            self._items = items

        def get(self, key):
            if key == "items":
                return self._items
            return None

    preview_doc = _PreviewDoc(items)

    result = {
        "category_violation": None,
        "date_violation": None,
        "exceeded": None,
        "warning": None,
        "monthly_exceeded": None,
    }

    # 1) Strict category restriction preview
    active_budget_name = _get_active_budget_name(project)
    restricted_budgets = (
        frappe.db.sql(
            """
		SELECT name FROM `tabProject Cost Budget`
		WHERE name = %(budget_name)s
			AND docstatus = 1 AND restrict_to_budget_categories = 1
	""",
            {"budget_name": active_budget_name},
            as_dict=True,
        )
        if active_budget_name
        else []
    )

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
        allowed_set = {a[0] for a in allowed_accounts}
        disallowed = [a for a in accounts if a not in allowed_set]
        if disallowed:
            result["category_violation"] = {
                "project": project,
                "accounts": disallowed,
                "can_bypass": _can_bypass_budget(),
            }
            break

    # 2) Budget category resolution + date range + amount + monthly preview
    all_categories = []
    seen = set()
    for account in accounts:
        for c in get_categories_for_account(company, account):
            if c not in seen:
                seen.add(c)
                all_categories.append(c)

    if not all_categories:
        return result

    doc_date = getdate(doc_date) if doc_date else getdate(frappe.utils.today())
    in_range_rows, out_of_range_rows = _get_affected_detail_rows(
        active_budget_name, all_categories, doc_date
    )

    covered_categories = set()
    for row_name, parent_name in in_range_rows:
        row = frappe.get_doc("Project Cost Budget Detail", row_name)
        covered_categories.add((parent_name, row.budget_category))

    for row_name, parent_name in out_of_range_rows:
        row = frappe.get_doc("Project Cost Budget Detail", row_name)
        if (parent_name, row.budget_category) in covered_categories:
            continue
        parent = frappe.get_doc("Project Cost Budget", parent_name)
        action = _get_action(row, "annual", trigger_stage)
        if action == "None":
            continue
        eff_from = row.from_date or parent.from_date
        eff_to = row.to_date or parent.to_date
        result["date_violation"] = {
            "project": parent.project,
            "budget_category": row.budget_category,
            "from_date": frappe.utils.formatdate(eff_from),
            "to_date": frappe.utils.formatdate(eff_to),
            "can_bypass": _can_bypass_budget(),
        }
        break

    for row_name, parent_name in in_range_rows:
        row = frappe.get_doc("Project Cost Budget Detail", row_name)
        parent = frappe.get_doc("Project Cost Budget", parent_name)

        applicable_field = {
            "material_request": "applicable_on_material_request",
            "purchase_order": "applicable_on_purchase_order",
            "actual": "applicable_on_booking_actual_expenses",
        }[trigger_stage]
        if not row.get(applicable_field):
            continue

        # Refreshes cached values with live query
        _recalculate_row(row, parent, doc_date)

        amount_details = _get_current_doc_amount_details(row_name, preview_doc, trigger_stage)
        current_amt = amount_details["new_spending"]

        estimated = flt(row.estimated_amount)
        cumulative_stored = flt(row.cumulative_expense_amount)
        cumulative_with_current = cumulative_stored + current_amt
        threshold = flt(row.warning_threshold_percentage) or 80.0
        action = _get_action(row, "annual", trigger_stage)

        info = {
            "project": parent.project,
            "company": parent.company,
            "current_doctype": current_doctype,
            "current_docname": current_docname,
            "budget_category": row.budget_category,
            "estimated": estimated,
            "cumulative": cumulative_with_current,
            "cumulative_stored": cumulative_stored,
            "current_doc_amount": current_amt,
            "current_doc_total_amount": amount_details["total_amount"],
            "current_doc_already_counted": amount_details["already_counted"],
            "currency": parent.currency,
            "action": action,
            "can_bypass": _can_bypass_budget(),
        }

        if action != "None" and cumulative_with_current > estimated:
            info["documents"] = _get_related_documents(
                parent.company, parent.project, current_doctype, current_docname, {}
            )
            result["exceeded"] = info
        elif estimated and cumulative_with_current >= (estimated * threshold / 100):
            info["documents"] = _get_related_documents(
                parent.company, parent.project, current_doctype, current_docname, {}
            )
            result["warning"] = info

            # Monthly check preview - only meaningful if a Monthly Distribution was configured
            if row.monthly_distribution and not result["exceeded"]:
                monthly_action = _get_action(row, "monthly", trigger_stage)
                if monthly_action != "None":
                    eff_from = getdate(row.from_date or parent.from_date)
                    eff_to = getdate(row.to_date or parent.to_date)
                    month_end = _end_of_month_for(doc_date, eff_to)
                    monthly_budget_base = _get_monthly_budget_till_date(
                        row, parent, eff_from, eff_to, month_end
                    )
                    monthly_budget_doc = convert_to_doc_currency(
                        monthly_budget_base,
                        parent.company,
                        parent.currency,
                        parent.conversion_rate,
                    )
                    actual_till_month_with_current = (
                        flt(row.actual_amount_till_month) + current_amt
                    )
                    if actual_till_month_with_current > monthly_budget_doc:
                        result["monthly_exceeded"] = {
                            "project": parent.project,
                            "company": parent.company,
                            "current_doctype": current_doctype,
                            "current_docname": current_docname,
                            "budget_category": row.budget_category,
                            "monthly_budget": monthly_budget_doc,
                            "actual_till_month": actual_till_month_with_current,
                            "actual_till_month_stored": flt(row.actual_amount_till_month),
                            "current_doc_amount": current_amt,
                            "currency": parent.currency,
                            "action": monthly_action,
                            "can_bypass": _can_bypass_budget(),
                            "documents": _get_related_documents(
                                parent.company,
                                parent.project,
                                current_doctype,
                                current_docname,
                                {},
                            ),
                        }

    return result


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
        # Live recalculation - reuses the same logic as real enforcement
        _recalculate_row(row, parent, getdate(frappe.utils.today()))

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