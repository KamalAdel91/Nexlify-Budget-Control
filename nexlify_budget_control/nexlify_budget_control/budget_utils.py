"""
budget_utils.py
----------------
Helper functions for Nexlify Budget Control - Cost side.

Handles commitment-aware amount calculations across the
Material Request -> Purchase Order -> Purchase Invoice chain,
without double-counting amounts that have progressed from one
stage to the next.
"""

import frappe
from frappe.utils import flt, getdate


# ---------------------------------------------------------------------------
# Category / Account resolution
# ---------------------------------------------------------------------------

def get_categories_for_account(company, account):
	"""
	Returns a list of Budget Category names (budget_type = Cost) that
	include the given account, scoped to the given company.
	"""
	if not account:
		return []

	rows = frappe.db.sql("""
		SELECT DISTINCT bc.name
		FROM `tabBudget Category` bc
		INNER JOIN `tabBudget Category Account` bca ON bca.parent = bc.name
		WHERE bc.company = %(company)s
			AND bc.budget_type = 'Cost'
			AND bca.account = %(account)s
	""", {"company": company, "account": account}, as_dict=True)

	return [r.name for r in rows]


def get_accounts_for_category(budget_category):
	"""
	Returns the list of accounts attached to a given Budget Category.
	"""
	rows = frappe.db.sql("""
		SELECT account
		FROM `tabBudget Category Account`
		WHERE parent = %(category)s
	""", {"category": budget_category}, as_dict=True)

	return [r.account for r in rows]


# ---------------------------------------------------------------------------
# Commitment-aware amount calculations (the core fix)
# ---------------------------------------------------------------------------

def get_material_request_amount(company, project, accounts):
	"""
	Returns the PENDING (not-yet-ordered) amount from submitted
	Material Request items for this project/accounts/company.

	Any quantity already converted to a Purchase Order (ordered_qty)
	is excluded - that portion is represented at the PO stage instead.
	"""
	if not accounts:
		return 0.0

	rows = frappe.db.sql("""
		SELECT
			mri.qty,
			mri.ordered_qty,
			mri.amount
		FROM `tabMaterial Request Item` mri
		INNER JOIN `tabMaterial Request` mr ON mri.parent = mr.name
		WHERE mr.docstatus = 1
			AND mr.company = %(company)s
			AND mri.project = %(project)s
			AND mri.expense_account IN %(accounts)s
	""", {"company": company, "project": project, "accounts": accounts}, as_dict=True)

	total = 0.0
	for r in rows:
		qty = flt(r.qty)
		ordered = flt(r.ordered_qty)
		row_amount = flt(r.amount)

		if qty <= 0:
			continue

		pending_qty = max(0.0, qty - ordered)
		if pending_qty <= 0:
			continue

		pending_fraction = pending_qty / qty
		total += row_amount * pending_fraction

	return total


def get_purchase_order_amount(company, project, accounts):
	"""
	Returns the PENDING (not-yet-invoiced) amount from submitted
	Purchase Order items for this project/accounts/company.

	Any amount already billed (billed_amt) is excluded - that portion
	is represented at the Actual/Purchase Invoice stage instead.
	"""
	if not accounts:
		return 0.0

	rows = frappe.db.sql("""
		SELECT
			poi.amount,
			poi.billed_amt
		FROM `tabPurchase Order Item` poi
		INNER JOIN `tabPurchase Order` po ON poi.parent = po.name
		WHERE po.docstatus = 1
			AND po.company = %(company)s
			AND poi.project = %(project)s
			AND poi.expense_account IN %(accounts)s
	""", {"company": company, "project": project, "accounts": accounts}, as_dict=True)

	total = 0.0
	for r in rows:
		pending_amount = max(0.0, flt(r.amount) - flt(r.billed_amt))
		total += pending_amount

	return total


def get_actual_expense(company, project, accounts, from_date=None, to_date=None):
	"""
	Returns the NET actual booked expense (debit - credit) from GL Entry
	for this project/accounts/company, scoped to a date range.

	Using GL Entry (rather than Purchase Invoice Item alone) ensures this
	correctly nets out Journal Entries, Purchase Returns, Debit/Credit
	Notes, and any other document type that posts to these accounts -
	since all of them ultimately produce GL Entry rows. Cancelled entries
	are automatically excluded via is_cancelled.
	"""
	if not accounts:
		return 0.0

	conditions = [
		"gle.is_cancelled = 0",
		"gle.company = %(company)s",
		"gle.project = %(project)s",
		"gle.account IN %(accounts)s",
	]
	params = {"company": company, "project": project, "accounts": accounts}

	if from_date:
		conditions.append("gle.posting_date >= %(from_date)s")
		params["from_date"] = getdate(from_date)
	if to_date:
		conditions.append("gle.posting_date <= %(to_date)s")
		params["to_date"] = getdate(to_date)

	query = f"""
		SELECT SUM(gle.debit) - SUM(gle.credit) AS net_amount
		FROM `tabGL Entry` gle
		WHERE {" AND ".join(conditions)}
	"""

	result = frappe.db.sql(query, params, as_dict=True)
	return flt(result[0].net_amount) if result and result[0].net_amount else 0.0


# ---------------------------------------------------------------------------
# Aggregation / currency helpers
# ---------------------------------------------------------------------------

def get_cumulative_amount(actual, material_request, purchase_order):
	"""
	Combines the three commitment stages into a single cumulative figure.
	Since each stage now represents only its own PENDING portion
	(MR and PO amounts are already net of what progressed forward),
	a simple sum is correct and does not double-count.
	"""
	return flt(actual) + flt(material_request) + flt(purchase_order)


def convert_to_doc_currency(amount, company, target_currency, conversion_rate):
	"""
	Converts an amount from company base currency to the target
	(budget document) currency using the given conversion rate.
	If currencies match, returns the amount unchanged.
	"""
	company_currency = frappe.get_cached_value("Company", company, "default_currency")
	if target_currency == company_currency:
		return flt(amount)
	rate = flt(conversion_rate) or 1.0
	return flt(amount) / rate
