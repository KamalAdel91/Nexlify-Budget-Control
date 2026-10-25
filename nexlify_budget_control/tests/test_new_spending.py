"""What a document adds to a budget row, and that a document adding nothing cannot break the budget
(budget_enforcement._get_current_doc_amount_details and _evaluate_budget_row)."""
from unittest.mock import patch

import frappe

from nexlify_budget_control.nexlify_budget_control import budget_enforcement as be
from nexlify_budget_control.tests.test_committed import ACCOUNT, RolledBack

ACCOUNTS = {ACCOUNT}


def po_row(base_amount):
	"""A bare Purchase Order Item row (rolled back with the test): what an order committed, in company currency."""
	name = frappe.generate_hash(length=10)
	frappe.get_doc({"doctype": "Purchase Order Item", "name": name, "parent": "_NBC-PO-" + name,
		"parenttype": "Purchase Order", "parentfield": "items", "expense_account": ACCOUNT,
		"amount": base_amount, "base_amount": base_amount}).db_insert()
	return name


def invoice(*items):
	return frappe._dict(items=[frappe._dict(idx=i, expense_account=ACCOUNT, **it) for i, it in enumerate(items, 1)])


def added(doc, stage="actual"):
	return be._get_current_doc_amount_details(None, doc, stage, accounts=ACCOUNTS)["new_spending"]


class TestNewSpending(RolledBack):
	def test_return_adds_nothing(self):
		self.assertEqual(added(invoice({"amount": -500, "base_amount": -500})), 0)

	def test_invoice_of_its_order_adds_nothing(self):
		self.assertEqual(added(invoice({"amount": 1000, "base_amount": 1000, "po_detail": po_row(1000)})), 0)

	def test_invoice_above_its_order_adds_the_difference(self):
		self.assertAlmostEqual(added(invoice({"amount": 1100, "base_amount": 1100, "po_detail": po_row(1000)})), 100)

	def test_the_row_it_was_made_from_counts_not_another_on_the_same_account(self):
		# the order has two rows on the account (1,000 and 200); the invoice bills the 1,000 one
		big, _small = po_row(1000), po_row(200)
		self.assertEqual(added(invoice({"amount": 1000, "base_amount": 1000, "po_detail": big})), 0)

	def test_foreign_currency_is_compared_in_company_currency(self):
		# 100 USD at 3.75 against the order row's 375 SAR
		self.assertEqual(added(invoice({"amount": 100, "base_amount": 375, "po_detail": po_row(375)})), 0)

	def test_invoice_without_an_order_adds_it_all(self):
		self.assertAlmostEqual(added(invoice({"amount": 700, "base_amount": 700})), 700)


class TestOverBudgetRow(RolledBack):
	def setUp(self):
		super().setUp()
		company = frappe.db.get_value("Company", {}, ["name", "default_currency"], as_dict=True)
		self.parent = frappe._dict(name="_NBC-EST", project="_NBC-PROJ", company=company.name,
			currency=company.default_currency, conversion_rate=1)
		for target in ("notify_project_stakeholders", "_build_message_from_dict"):
			p = patch.object(be, target, lambda *a, **k: "over budget")
			p.start()
			self.addCleanup(p.stop)

	def evaluate(self, added_amount):
		row = frappe._dict(budget_category="_NBC Cat", estimated_amount=1000, cumulative_expense_amount=1200,
			warning_threshold_percentage=80)
		return be._evaluate_budget_row(row, self.parent, "actual", frappe.utils.today(),
			current_doc_amount=added_amount, current_doctype="Purchase Invoice", current_docname="_NBC-PI")

	def test_document_adding_spending_breaks_an_over_budget_row(self):
		self.assertEqual([v["violation_type"] for v in self.evaluate(200)], ["Annual Exceeded"])

	def test_return_on_an_over_budget_row_passes(self):
		self.assertEqual(self.evaluate(0), [])

	def test_negative_amount_passes(self):
		self.assertEqual(self.evaluate(-300), [])
