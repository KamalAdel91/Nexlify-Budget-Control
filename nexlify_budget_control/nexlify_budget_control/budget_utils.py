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
from frappe.utils import flt


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
		WHERE bca.company = %(company)s
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
	A Stopped request will not be ordered, so nothing of it is pending.
	"""
	if not accounts:
		return 0.0

	rows = frappe.db.sql("""
		SELECT
			mri.qty,
			mri.stock_qty,
			mri.ordered_qty,
			mri.amount
		FROM `tabMaterial Request Item` mri
		INNER JOIN `tabMaterial Request` mr ON mri.parent = mr.name
		WHERE mr.docstatus = 1
			AND mr.status != 'Stopped'
			AND mr.company = %(company)s
			AND mri.project = %(project)s
			AND mri.expense_account IN %(accounts)s
	""", {"company": company, "project": project, "accounts": accounts}, as_dict=True)

	total = 0.0
	for r in rows:
		# ordered_qty is kept in stock units, like stock_qty (qty is in the purchase unit: 10 boxes of 12 is 120)
		qty = flt(r.stock_qty) or flt(r.qty)
		if qty <= 0:
			continue
		pending_fraction = max(0.0, qty - flt(r.ordered_qty)) / qty
		total += flt(r.amount) * pending_fraction

	return total


def get_purchase_order_amount(company, project, accounts):
	"""
	Returns the PENDING (not-yet-invoiced) amount from submitted
	Purchase Order items for this project/accounts/company.

	Any amount already billed (billed_amt) is excluded - that portion
	is represented at the Actual/Purchase Invoice stage instead.
	billed_amt is in the order's currency, like amount, so the unbilled
	part is taken in that currency and then converted to the company's.
	A Closed order will not be billed further, so nothing of it is pending.
	"""
	if not accounts:
		return 0.0

	rows = frappe.db.sql("""
		SELECT
			poi.amount,
			poi.billed_amt,
			po.conversion_rate
		FROM `tabPurchase Order Item` poi
		INNER JOIN `tabPurchase Order` po ON poi.parent = po.name
		WHERE po.docstatus = 1
			AND po.status != 'Closed'
			AND po.company = %(company)s
			AND poi.project = %(project)s
			AND poi.expense_account IN %(accounts)s
	""", {"company": company, "project": project, "accounts": accounts}, as_dict=True)

	total = 0.0
	for r in rows:
		unbilled = max(0.0, flt(r.amount) - flt(r.billed_amt))
		total += unbilled * (flt(r.conversion_rate) or 1)

	return total


def get_actual_expense(company, project, accounts):
	"""
	Returns the NET actual booked expense (debit - credit) from GL Entry
	for this project/accounts/company: everything ever booked on the
	project, whatever its date.

	Using GL Entry (rather than Purchase Invoice Item alone) ensures this
	correctly nets out Journal Entries, Purchase Returns, Debit/Credit
	Notes, and any other document type that posts to these accounts -
	since all of them ultimately produce GL Entry rows. Cancelled entries
	are automatically excluded via is_cancelled. A Period Closing Voucher
	is not spending: it closes the year's expense accounts (per project,
	in ERPNext 16) against the profit and loss, so it is left out, or the
	project's spending of a closed year would read as zero.
	"""
	if not accounts or not isinstance(accounts, (list, tuple)):
		return 0.0

	result = frappe.db.sql("""
		SELECT COALESCE(SUM(gle.debit), 0) - COALESCE(SUM(gle.credit), 0) AS net_amount
		FROM `tabGL Entry` gle
		WHERE gle.is_cancelled = 0
			AND gle.company = %(company)s
			AND gle.project = %(project)s
			AND gle.account IN %(accounts)s
			AND gle.voucher_type != 'Period Closing Voucher'
	""", {"company": company, "project": project, "accounts": tuple(accounts)}, as_dict=True)
	return flt(result[0].net_amount) if result else 0.0


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
