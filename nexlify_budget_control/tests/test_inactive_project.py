"""The Not Active project guard (block_inactive_project_reference): nothing is saved or submitted on a project whose
Estimation was cancelled, whether the Project is on the document or on its rows."""
import frappe
from frappe.tests import IntegrationTestCase

from nexlify_budget_control.nexlify_budget_control.budget_enforcement import block_inactive_project_reference
from nexlify_budget_control.tests.test_committed import RolledBack

GUARD = "nexlify_budget_control.nexlify_budget_control.budget_enforcement.block_inactive_project_reference"


def make_project(active, company=None):
	name = frappe.get_doc({"doctype": "Project", "project_name": "_NBC Guard " + frappe.generate_hash(length=6),
		"company": company or frappe.db.get_value("Company", {}, "name"), "is_active": "No"}).insert(ignore_permissions=True).name
	if active:
		frappe.db.set_value("Project", name, "is_active", "Yes")
	return name


def purchase_order(project):
	return frappe.get_doc({"doctype": "Purchase Order", "items": [{"item_code": "x", "qty": 1, "project": project}]})


class TestInactiveProjectGuard(RolledBack):
	def test_project_on_a_row_is_checked(self):
		with self.assertRaises(frappe.ValidationError):
			block_inactive_project_reference(purchase_order(make_project(active=False)))

	def test_active_project_on_a_row_passes(self):
		block_inactive_project_reference(purchase_order(make_project(active=True)))

	def test_project_on_the_document_is_checked(self):
		with self.assertRaises(frappe.ValidationError):
			block_inactive_project_reference(frappe.get_doc({"doctype": "Task", "project": make_project(active=False)}))

	def test_app_doctypes_may_use_a_not_active_project(self):
		block_inactive_project_reference(frappe.get_doc({"doctype": "Project Planning", "project": make_project(active=False)}))

	def test_runs_on_submit_too(self):
		hooks = frappe.get_hooks("doc_events").get("*", {})
		self.assertIn(GUARD, hooks.get("before_save", []))
		self.assertIn(GUARD, hooks.get("before_submit", []))

	def test_draft_saved_while_active_cannot_be_submitted_once_not_active(self):
		source = frappe.db.get_value("Purchase Order Item", {"docstatus": 1, "project": ["is", "set"]}, "parent")
		if not source:
			self.skipTest("the site has no submitted Purchase Order with a project")
		po = frappe.copy_doc(frappe.get_doc("Purchase Order", source))
		po.docstatus = 0  # copy_doc keeps it in test mode
		project = make_project(active=True, company=po.company)
		for row in po.items:
			row.project = project
			row.material_request = row.material_request_item = None
		po.insert(ignore_permissions=True)
		frappe.db.set_value("Project", project, "is_active", "No")  # its Estimation was cancelled
		with self.assertRaises(frappe.ValidationError) as caught:
			po.submit()
		self.assertIn("Not Active", str(caught.exception))
