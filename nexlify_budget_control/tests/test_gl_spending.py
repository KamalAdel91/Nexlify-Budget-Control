"""Actual spending from the General Ledger: any document that posts there is checked against the budget rows of the
projects on its ledger rows (budget_enforcement.before/on_gl_document_submit, on_gl_document_cancel). End to end on
the site's own data (a project with a submitted Estimation), rolled back."""
import frappe
from frappe.utils import flt, today

from nexlify_budget_control.nexlify_budget_control import budget_enforcement as be
from nexlify_budget_control.nexlify_budget_control.constants import GL_DOCTYPES
from nexlify_budget_control.tests.test_committed import RolledBack

BE = "nexlify_budget_control.nexlify_budget_control.budget_enforcement."


class BudgetRow(RolledBack):
	"""A budget row of a real project: its expense account, the company's bank account and cost center."""

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		self.addCleanup(frappe.set_user, "Administrator")
		r = frappe.db.sql("""select p.name project, p.company, e.name est, e.currency, e.conversion_rate,
				d.name row_name, d.budget_category, bca.account
			from tabProject p
			join `tabProject Estimation` e on e.name = p.custom_budget_cost and e.docstatus = 1
			join `tabProject Estimation Detail` d on d.parent = e.name
			join `tabBudget Category Account` bca on bca.parent = d.budget_category and bca.company = p.company
			join tabAccount a on a.name = bca.account and a.root_type = 'Expense' and a.is_group = 0
			join tabCompany c on c.name = p.company and c.default_currency = e.currency
			limit 1""", as_dict=True)
		if not r:
			self.skipTest("the site has no project with a submitted Estimation whose category has an expense account")
		self.__dict__.update(r[0])
		self.bank = frappe.db.get_value("Account", {"company": self.company, "is_group": 0,
			"account_type": ["in", ["Bank", "Cash"]]}, "name")
		self.cost_center = frappe.db.get_value("Cost Center", {"company": self.company, "is_group": 0}, "name")
		if not (self.bank and self.cost_center):
			self.skipTest(f"{self.company} has no bank account or cost center")
		# the project's planned period covers today; no bypass, no import mode; Journal Entries are stopped
		frappe.db.set_value("Project", self.project, {"expected_start_date": "2000-01-01", "expected_end_date": "2099-12-31"})
		frappe.db.set_single_value("Project Budget Settings", "import_mode", 0)
		frappe.db.set_single_value("Project Budget Settings", "budget_bypass_role", None)
		frappe.db.delete("Document Type Rule", {"parent": "Project Budget Settings", "document_type": "Journal Entry"})
		frappe.get_doc({"doctype": "Document Type Rule", "parent": "Project Budget Settings",
			"parenttype": "Project Budget Settings", "parentfield": "document_rules", "idx": 99,
			"document_type": "Journal Entry", "enabled": 1, "action": "Stop"}).db_insert()
		frappe.clear_cache()
		frappe.flags.pop("nexlify_project_windows", None)

	def live(self):
		"""The row's cumulative as the ledgers stand now (stored too)."""
		be._clear_cached_amounts()
		be._recalc_rows({(self.row_name, self.est)}, today())
		return flt(frappe.db.get_value("Project Estimation Detail", self.row_name, "cumulative_expense_amount"))

	def budget(self, estimated):
		frappe.db.set_value("Project Estimation Detail", self.row_name, "estimated_amount", estimated)

	def journal(self, amount, credit_expense=False):
		"""A Journal Entry that spends `amount` on the project (or takes it back, with credit_expense)."""
		expense = {"account": self.account, "project": self.project, "cost_center": self.cost_center}
		bank = {"account": self.bank, "cost_center": self.cost_center}
		if credit_expense:
			expense["credit_in_account_currency"], bank["debit_in_account_currency"] = amount, amount
		else:
			expense["debit_in_account_currency"], bank["credit_in_account_currency"] = amount, amount
		je = frappe.get_doc({"doctype": "Journal Entry", "voucher_type": "Journal Entry", "company": self.company,
			"posting_date": today(), "user_remark": "nexlify_budget_control test", "accounts": [expense, bank]})
		je.flags.ignore_permissions = True
		return je.insert()


class TestSpendingIsChecked(BudgetRow):
	def test_within_the_budget_posts_and_the_row_takes_it(self):
		before = self.live()
		self.budget(before + 5000)
		je = self.journal(1000).submit()
		self.assertEqual(je.docstatus, 1)
		self.assertAlmostEqual(self.live(), before + 1000, places=2)
		self.assertAlmostEqual(flt(frappe.db.get_value("Project Estimation Detail", self.row_name,
			"cumulative_expense_amount")), before + 1000, places=2)

	def test_over_the_budget_is_stopped(self):
		self.budget(self.live() + 500)
		with self.assertRaises(frappe.ValidationError) as caught:
			self.journal(1000).submit()
		self.assertIn("Budget violations found", str(caught.exception))
		self.assertIn("This document's amount</td><td><b>SAR 1,000.00", str(caught.exception))

	def test_taking_spending_back_on_an_over_budget_row_passes(self):
		before = self.live()
		self.budget(before - 1)  # already over budget
		self.journal(300, credit_expense=True).submit()
		self.assertAlmostEqual(self.live(), before - 300, places=2)

	def test_cancel_refreshes_the_row(self):
		before = self.live()
		self.budget(before + 5000)
		je = self.journal(1000).submit()
		self.assertAlmostEqual(self.live(), before + 1000, places=2)
		je.cancel()
		self.assertAlmostEqual(flt(frappe.db.get_value("Project Estimation Detail", self.row_name,
			"cumulative_expense_amount")), before, places=2)

	def test_an_invoice_of_its_order_adds_nothing(self):
		"""The order committed the amount; its invoice moves it from committed to actual, on an over-budget row too."""
		from erpnext.buying.doctype.purchase_order.purchase_order import make_purchase_invoice

		supplier = frappe.db.get_value("Supplier", {"disabled": 0}, "name")
		item = frappe.db.get_value("Item", {"disabled": 0, "is_stock_item": 0, "is_purchase_item": 1, "has_variants": 0}, "name")
		if not (supplier and item):
			self.skipTest("the site has no supplier or non-stock purchase item")
		before = self.live()
		self.budget(before + 5000)
		po = frappe.get_doc({"doctype": "Purchase Order", "supplier": supplier, "company": self.company,
			"currency": self.currency, "conversion_rate": 1, "transaction_date": today(), "schedule_date": today(),
			"items": [{"item_code": item, "qty": 1, "rate": 1000, "schedule_date": today(), "project": self.project,
				"expense_account": self.account, "cost_center": self.cost_center,
				"custom_item_group": frappe.db.get_value("Item", item, "item_group")}]})  # the site's own mandatory field
		po.flags.ignore_permissions = True
		try:
			po.insert().submit()
		except frappe.ValidationError as e:
			if "Budget" in str(e):
				raise
			self.skipTest(f"a Purchase Order cannot be made on this site: {str(e)[:100]}")
		self.assertAlmostEqual(self.live(), before + 1000, places=2)
		self.budget(before + 1000 - 1)  # over budget now
		pi = make_purchase_invoice(po.name)
		pi.credit_to = pi.credit_to or frappe.db.get_value("Account", {"company": self.company, "account_type": "Payable",
			"is_group": 0}, "name")  # the company may have no default payable account
		pi.flags.ignore_permissions = True
		pi.insert().submit()  # must not be stopped: it adds nothing
		self.assertAlmostEqual(self.live(), before + 1000, places=2)


class TestWhatIsChecked(RolledBack):
	def test_every_gl_doctype_is_wired(self):
		events = frappe.get_hooks("doc_events")
		for doctype in GL_DOCTYPES:
			with self.subTest(doctype=doctype):
				hooks = events.get(doctype, {})
				self.assertIn(BE + "before_gl_document_submit", hooks.get("before_submit", []))
				self.assertIn(BE + "on_gl_document_submit", hooks.get("on_submit", []))
				self.assertIn(BE + "on_gl_document_cancel", hooks.get("on_cancel", []))

	def test_a_doctype_without_a_rule_row(self):
		frappe.db.delete("Document Type Rule", {"parent": "Project Budget Settings",
			"document_type": ["in", ["Sales Invoice", "Purchase Invoice"]]})
		frappe.local.request_cache = None
		self.assertEqual(be._get_doctype_rule("Purchase Invoice"), (True, "Stop"))  # always checked
		self.assertEqual(be._get_doctype_rule("Sales Invoice"), (False, "Stop"))  # only once a row says so

	def test_settings_refuse_a_document_the_budget_is_not_checked_on(self):
		settings = frappe.get_single("Project Budget Settings")
		settings.append("document_rules", {"document_type": "Landed Cost Voucher", "enabled": 1, "action": "Stop"})
		with self.assertRaises(frappe.ValidationError):
			settings.save()

	def test_patch_drops_rows_of_unchecked_documents_and_keeps_the_rest(self):
		from nexlify_budget_control.patches import document_type_rules_checked_only as patch

		for doctype in ("Asset Depreciation", "Landed Cost Voucher"):
			frappe.get_doc({"doctype": "Document Type Rule", "parent": "Project Budget Settings",
				"parenttype": "Project Budget Settings", "parentfield": "document_rules", "idx": 98,
				"document_type": doctype, "enabled": 1, "action": "Stop"}).db_insert()
		kept = frappe.db.count("Document Type Rule", {"parent": "Project Budget Settings",
			"document_type": ["in", list(GL_DOCTYPES) + ["Material Request", "Purchase Order"]]})
		patch.execute()
		patch.execute()
		rows = frappe.get_all("Document Type Rule", filters={"parent": "Project Budget Settings"}, pluck="document_type")
		self.assertNotIn("Asset Depreciation", rows)
		self.assertNotIn("Landed Cost Voucher", rows)
		self.assertEqual(len(rows), kept)
