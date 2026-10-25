"""Committed amounts (budget_utils): what is still pending on Material Requests and Purchase Orders, in company currency.

The orders are bare rows written inside the test's transaction (rolled back after every test, see RolledBack), so
only the columns the calculation reads matter and no master data is needed.
"""
import frappe
from frappe.tests import IntegrationTestCase

from nexlify_budget_control.nexlify_budget_control.budget_utils import (
	get_material_request_amount,
	get_purchase_order_amount,
)

COMPANY, PROJECT, ACCOUNT = "_NBC Test Company", "_NBC-TEST-PROJ", "_NBC Test Expense"


def _uniq():
	return frappe.generate_hash(length=8)


def make_po(amount, billed, rate=1.0, currency="SAR", status="To Receive and Bill"):
	po = frappe.get_doc({"doctype": "Purchase Order", "name": "_NBC-PO-" + _uniq(), "company": COMPANY,
		"docstatus": 1, "status": status, "currency": currency, "conversion_rate": rate})
	po.db_insert()
	frappe.get_doc({"doctype": "Purchase Order Item", "name": _uniq(), "parent": po.name, "parenttype": "Purchase Order",
		"parentfield": "items", "project": PROJECT, "expense_account": ACCOUNT, "qty": 1, "rate": amount,
		"amount": amount, "base_amount": amount * rate, "billed_amt": billed}).db_insert()


def make_mr(amount, qty, ordered, status="Pending"):
	mr = frappe.get_doc({"doctype": "Material Request", "name": "_NBC-MR-" + _uniq(), "company": COMPANY,
		"docstatus": 1, "status": status})
	mr.db_insert()
	frappe.get_doc({"doctype": "Material Request Item", "name": _uniq(), "parent": mr.name,
		"parenttype": "Material Request", "parentfield": "items", "project": PROJECT, "expense_account": ACCOUNT,
		"qty": qty, "ordered_qty": ordered, "amount": amount}).db_insert()


class RolledBack(IntegrationTestCase):
	"""Each test starts clean: its rows are rolled back after it (commits are off while the tests run)."""

	def setUp(self):
		self.addCleanup(frappe.db.rollback)


def po_pending():
	return get_purchase_order_amount(COMPANY, PROJECT, (ACCOUNT,))


def mr_pending():
	return get_material_request_amount(COMPANY, PROJECT, (ACCOUNT,))


class TestPurchaseOrderPending(RolledBack):
	def test_company_currency_partly_billed(self):
		make_po(1000, billed=400)
		self.assertAlmostEqual(po_pending(), 600)

	def test_foreign_currency_fully_billed_is_not_pending(self):
		# billed_amt is in USD like amount: 1,000 USD billed of 1,000 USD leaves nothing (it was 2,750 SAR before)
		make_po(1000, billed=1000, rate=3.75, currency="USD")
		self.assertAlmostEqual(po_pending(), 0)

	def test_foreign_currency_partly_billed_in_company_currency(self):
		make_po(1000, billed=400, rate=3.75, currency="USD")
		self.assertAlmostEqual(po_pending(), 600 * 3.75)

	def test_over_billed_is_not_negative(self):
		make_po(1000, billed=1100)
		self.assertAlmostEqual(po_pending(), 0)

	def test_closed_order_is_not_pending(self):
		make_po(1000, billed=400, status="Closed")
		self.assertAlmostEqual(po_pending(), 0)

	def test_orders_add_up(self):
		make_po(1000, billed=0)
		make_po(200, billed=100, rate=3.75, currency="USD")
		self.assertAlmostEqual(po_pending(), 1000 + 100 * 3.75)


class TestMaterialRequestPending(RolledBack):
	def test_partly_ordered(self):
		make_mr(1000, qty=10, ordered=4)
		self.assertAlmostEqual(mr_pending(), 600)

	def test_fully_ordered_is_not_pending(self):
		make_mr(1000, qty=10, ordered=10)
		self.assertAlmostEqual(mr_pending(), 0)

	def test_stopped_request_is_not_pending(self):
		make_mr(1000, qty=10, ordered=4, status="Stopped")
		self.assertAlmostEqual(mr_pending(), 0)
