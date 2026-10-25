"""The amounts cache (budget_enforcement._get_cached_amount) lives for one request only: a dashboard opened later
reads fresh figures, and nothing is shared between sites."""
from collections import defaultdict

import frappe

from nexlify_budget_control.nexlify_budget_control import budget_enforcement as be
from nexlify_budget_control.nexlify_budget_control.budget_utils import get_purchase_order_amount
from nexlify_budget_control.tests.test_committed import ACCOUNT, COMPANY, PROJECT, RolledBack, make_po


def new_request():
	frappe.local.request_cache = defaultdict(dict)


def po_amount():
	return be._get_cached_amount(COMPANY, PROJECT, [ACCOUNT], get_purchase_order_amount, "po")


class TestAmountCache(RolledBack):
	def setUp(self):
		super().setUp()
		self.addCleanup(new_request)
		new_request()

	def test_read_once_per_request(self):
		calls = []

		def fn(company, project, accounts):
			calls.append(1)
			return 5.0

		be._get_cached_amount(COMPANY, PROJECT, [ACCOUNT], fn, "x")
		be._get_cached_amount(COMPANY, PROJECT, [ACCOUNT], fn, "x")
		self.assertEqual(len(calls), 1)
		be._clear_cached_amounts()
		be._get_cached_amount(COMPANY, PROJECT, [ACCOUNT], fn, "x")
		self.assertEqual(len(calls), 2)

	def test_a_later_request_sees_a_new_order(self):
		make_po(1000, billed=0)
		self.assertAlmostEqual(po_amount(), 1000)
		make_po(500, billed=0)
		new_request()  # e.g. the dashboard opened after another Purchase Order was submitted
		self.assertAlmostEqual(po_amount(), 1500)

	def test_no_cache_kept_in_the_module(self):
		self.assertFalse(hasattr(be, "_cached_amounts"))
