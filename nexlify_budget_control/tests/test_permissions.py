"""The Plan / Estimation endpoints of budget_enforcement check the document itself, hide what the user's permission level
hides, and take only the fields the forms may set. Uses the site's own plans, visits and invoices (rolled back)."""
from contextlib import contextmanager

import frappe

from nexlify_budget_control.nexlify_budget_control import budget_enforcement as be
from nexlify_budget_control.tests.test_committed import RolledBack


def make_user(*roles):
	email = f"nbc-test-{frappe.generate_hash(length=8).lower()}@example.com"
	frappe.get_doc({"doctype": "User", "email": email, "first_name": "NBC Test", "send_welcome_email": 0,
		"user_type": "System User", "roles": [{"role": r} for r in roles]}).insert(ignore_permissions=True)
	return email


@contextmanager
def as_user(user):
	current = frappe.session.user
	frappe.set_user(user)
	try:
		yield
	finally:
		frappe.set_user(current)


def first(doctype, filters=None, field="name"):
	value = frappe.db.get_value(doctype, filters or {}, field)
	if not value:
		raise AssertionError(f"The site has no {doctype}")
	return value


class PlanData(RolledBack):
	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		self.addCleanup(frappe.set_user, "Administrator")
		self.invoice = first("Project Invoicing", {"invoice_amount": [">", 0]})
		self.plan = frappe.db.get_value("Project Invoicing", self.invoice, "project_planning")
		self.visit = first("Project Visits", {"project_planning": self.plan})
		self.estimation = first("Project Equipment Scope", {}, "cost_budget")
		self.scope = first("Project Equipment Scope")


class TestReadsCheckTheDocument(PlanData):
	def test_a_user_without_access_reads_nothing(self):
		calls = {
			"get_project_visits": (self.plan,), "get_visit_count": (self.plan,), "get_project_invoicings": (self.plan,),
			"get_planning_scope_rows": (self.plan,), "get_visit_allocation_context": (self.plan,),
			"get_project_equipment_scope_rows_for_planning": (self.plan,),
			"get_project_equipment_scope_rows": (self.estimation,), "get_project_equipment_scope_full": (self.scope,),
			"get_project_visit_full": (self.visit,), "get_project_invoicing_full": (self.invoice,),
		}
		outsider = make_user()
		for method, args in calls.items():
			with self.subTest(method=method), as_user(outsider), self.assertRaises(frappe.PermissionError):
				getattr(be, method)(*args)

	def test_a_filter_sent_as_the_name_is_refused(self):
		with self.assertRaises(frappe.ValidationError):
			be.get_project_visits({"name": ["!=", ""]})

	def test_the_planner_does_not_see_the_invoice_amount(self):
		self.assertTrue(be.get_project_invoicing_full(self.invoice).get("invoice_amount"))
		with as_user(make_user("Planning Manager")):
			self.assertFalse(be.get_project_invoicing_full(self.invoice).get("invoice_amount"))


class TestWritesTakeOnlyFormFields(PlanData):
	def setUp(self):
		super().setUp()
		# the plan in Draft for the test, so its invoices and visits may change
		frappe.db.set_value("Project Planning", self.plan, {"docstatus": 0, "status": "Draft"})

	def test_new_invoice_keeps_the_system_fields(self):
		other_plan = first("Project Planning", {"name": ["!=", self.plan]})
		[name] = be.bulk_create_project_invoicing(self.plan, [{
			"invoice_description": "NBC test", "invoice_percentage": 1,
			"status": "Invoiced", "invoice_amount": 999, "sales_invoice": "SINV-FAKE", "project_planning": other_plan}])
		inv = frappe.get_doc("Project Invoicing", name)
		self.assertEqual(inv.project_planning, self.plan)
		self.assertNotEqual(inv.status, "Invoiced")
		self.assertFalse(inv.sales_invoice)
		self.assertNotEqual(frappe.utils.flt(inv.invoice_amount), 999)

	def test_a_visit_is_not_moved_to_another_plan(self):
		locked_plan = first("Project Planning", {"name": ["!=", self.plan]})
		be.bulk_update_project_visits([{"visit_name": self.visit, "project_planning": locked_plan}])
		self.assertEqual(frappe.db.get_value("Project Visits", self.visit, "project_planning"), self.plan)


def restrict(user, doctype, value):
	"""A User Permission: the user sees only this record of the DocType (and what links to it)."""
	frappe.get_doc({"doctype": "User Permission", "user": user, "allow": doctype, "for_value": value,
		"apply_to_all_doctypes": 1}).insert(ignore_permissions=True)
	frappe.clear_cache(user=user)


class TestBudgetFigures(RolledBack):
	"""Cost figures follow read permission on the project's own Estimation."""

	def setUp(self):
		super().setUp()
		frappe.set_user("Administrator")
		self.addCleanup(frappe.set_user, "Administrator")
		rows = frappe.db.sql("""select p.name, p.company, p.custom_budget_cost est from tabProject p
			join `tabProject Estimation` e on e.name = p.custom_budget_cost and e.docstatus = 1
			order by p.company""", as_dict=True)
		if not rows:
			self.skipTest("the site has no project with a submitted Estimation")
		self.project, self.company = rows[0].name, rows[0].company
		self.other_company_projects = {r.name for r in rows if r.company != self.company}

	def test_a_user_without_access_sees_no_figures(self):
		with as_user(make_user()):
			for method, args in {"get_project_budget_dashboard": (self.project,),
					"get_project_overview_summary": (self.project,),
					"get_related_documents_page": (self.company, self.project, "{}")}.items():
				with self.subTest(method=method), self.assertRaises(frappe.PermissionError):
					getattr(be, method)(*args)
			self.assertEqual(be.get_all_projects_budget_summary()["rows"], [])

	def test_the_planner_sees_no_cost_dashboard(self):
		with as_user(make_user("Planning Manager")):
			self.assertTrue(be.get_project_budget_dashboard(self.project).get("restricted"))

	def test_the_summary_keeps_to_the_users_company(self):
		if not self.other_company_projects:
			self.skipTest("the submitted Estimations are all of one company")
		accountant = make_user("Accounts User")
		restrict(accountant, "Company", self.company)
		with as_user(accountant):
			projects = {r["project"] for r in be.get_all_projects_budget_summary()["rows"]}
		self.assertIn(self.project, projects)
		self.assertFalse(projects & self.other_company_projects)

	def test_the_preview_is_only_for_budget_checked_documents_and_notifies_nobody(self):
		r = frappe.db.sql("""select bca.account, d.estimated_amount from `tabProject Estimation Detail` d
			join `tabBudget Category Account` bca on bca.parent = d.budget_category and bca.company = %s
			where d.parent = %s limit 1""", (self.company, frappe.db.get_value("Project", self.project, "custom_budget_cost")),
			as_dict=True)
		if not r:
			self.skipTest("the Estimation has no budget row with an account")
		items = frappe.as_json([{"project": self.project, "account": r[0].account, "amount": frappe.utils.flt(r[0].estimated_amount) * 3 + 1, "idx": 1}])
		accounts = frappe.as_json([r[0].account])
		logs = frappe.db.count("Notification Log")
		self.assertEqual(be.get_budget_check_preview(self.company, accounts, "purchase_order", items, "ToDo", "x")["violations"], [])
		found = be.get_budget_check_preview(self.company, accounts, "purchase_order", items, "Purchase Order", "new-po")["violations"]
		self.assertIn("Annual Exceeded", [v["violation_type"] for v in found])
		self.assertEqual(frappe.db.count("Notification Log"), logs)
		# a buyer who may make the order but not read the project's Estimation gets no figures of it
		with as_user(make_user("Purchase User")):
			self.assertTrue(frappe.has_permission("Purchase Order", "create"))
			self.assertEqual(be.get_budget_check_preview(self.company, accounts, "purchase_order", items, "Purchase Order", "new-po")["violations"], [])
		# a project sent as a filter instead of a name is ignored
		odd = frappe.as_json([{"project": {"name": ["!=", ""]}, "account": r[0].account, "amount": 1, "idx": 1}])
		self.assertEqual(be.get_budget_check_preview(self.company, accounts, "purchase_order", odd, "Purchase Order", "x")["violations"], [])


class TestJobCompletion(RolledBack):
	def test_a_planner_of_another_project_cannot_complete_this_invoice(self):
		from nexlify_budget_control.nexlify_budget_control.job_completion import mark_job_completed

		invoice = first("Project Invoicing")
		project = frappe.db.get_value("Project Invoicing", invoice, "project")
		other = first("Project", {"name": ["!=", project]})
		planner = make_user("Planning Manager")
		restrict(planner, "Project", other)
		with as_user(planner), self.assertRaises(frappe.PermissionError):
			mark_job_completed(invoice, "/private/files/x.pdf")


class TestDashboardPage(RolledBack):
	def test_the_page_opens_only_for_who_may_read_its_figures(self):
		from nexlify_budget_control.nexlify_budget_control.ceo_dashboard import OV, get_ceo_dashboard_data

		page = frappe.get_doc("Page", "projexlify-dashboard")
		with as_user(make_user("Projects User")):
			self.assertFalse(frappe.has_permission(OV, "read"))
			self.assertFalse(page.is_permitted())
		with as_user(make_user("COO")):
			self.assertTrue(page.is_permitted())
			get_ceo_dashboard_data(extra_filters="[]")
