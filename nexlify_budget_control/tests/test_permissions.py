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
