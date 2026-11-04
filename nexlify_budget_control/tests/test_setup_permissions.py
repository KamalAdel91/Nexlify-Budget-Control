"""The app's permissions on other apps' doctypes are applied once per site, then left to Role Permissions Manager,
and the O&M Manager patch takes that role off users and permissions. Runs on the site's data (rolled back)."""
from collections import defaultdict
from unittest.mock import patch

import frappe
from frappe.permissions import add_permission

from nexlify_budget_control.nexlify_budget_control import setup_permissions as sp
from nexlify_budget_control.patches import remove_om_manager_role as om
from nexlify_budget_control.tests.test_committed import RolledBack
from nexlify_budget_control.tests.test_permissions import make_user

TEST_ROLE = "NBC Test Role"


class CacheSafe(RolledBack):
	"""Clears the caches after the rollback, so no rolled-back default or role stays cached on the site."""

	def setUp(self):
		frappe.local.request_cache = defaultdict(dict)  # a fresh request: an earlier test leaves None here
		self.addCleanup(frappe.clear_cache)  # registered first, so it runs after RolledBack's rollback
		super().setUp()


class TestAppPermissionsAppliedOnce(CacheSafe):
	def setUp(self):
		super().setUp()
		make_role(TEST_ROLE)
		self.use_entries([("Supplier", [TEST_ROLE], ["read", "report"])])

	def use_entries(self, entries):
		for name, value in (("APP_ROLE_PERMISSIONS", entries), ("SENSITIVE_READ", {})):
			patcher = patch.object(sp, name, value)
			patcher.start()
			self.addCleanup(patcher.stop)

	def test_a_new_entry_is_applied_and_remembered(self):
		sp.ensure_app_role_permissions()
		self.assertTrue(custom_perm("Supplier", TEST_ROLE).read)
		self.assertIn(f"Supplier|{TEST_ROLE}|0", applied_keys())

	def test_a_permission_removed_in_the_ui_is_not_added_back(self):
		sp.ensure_app_role_permissions()
		frappe.db.delete("Custom DocPerm", {"parent": "Supplier", "role": TEST_ROLE})
		sp.ensure_app_role_permissions()
		self.assertIsNone(custom_perm("Supplier", TEST_ROLE))

	def test_an_entry_whose_role_is_missing_waits_for_the_next_migrate(self):
		self.use_entries([("Supplier", ["NBC Missing Role"], ["read"])])
		sp.ensure_app_role_permissions()
		self.assertNotIn("Supplier|NBC Missing Role|0", applied_keys())


class TestRemoveOmManagerRole(CacheSafe):
	def setUp(self):
		super().setUp()
		make_role(om.ROLE)
		self.user = make_user(om.ROLE)
		add_permission("Project", om.ROLE, 0, "read")

	def test_the_role_leaves_users_and_permissions(self):
		om.execute()
		self.assertFalse(frappe.db.exists("Has Role", {"role": om.ROLE}))
		self.assertFalse(frappe.db.exists("Custom DocPerm", {"role": om.ROLE}))
		self.assertNotIn(om.ROLE, frappe.get_roles(self.user))

	def test_the_role_is_deleted_once_model_sync_dropped_its_doctype_permissions(self):
		frappe.db.delete("DocPerm", {"role": om.ROLE})  # what syncing the edited DocType JSONs does
		om.execute()
		self.assertFalse(frappe.db.exists("Role", om.ROLE))

	def test_a_site_without_the_role_is_left_alone(self):
		with patch.object(om, "ROLE", "NBC No Such Role"):
			om.execute()
		self.assertTrue(frappe.db.exists("Role", "O&M Manager"))


def make_role(name):
	if not frappe.db.exists("Role", name):
		frappe.get_doc({"doctype": "Role", "role_name": name, "desk_access": 1}).insert(ignore_permissions=True)


def custom_perm(doctype, role):
	return frappe.db.get_value("Custom DocPerm", {"parent": doctype, "role": role, "permlevel": 0},
		["name", "read"], as_dict=True)


def applied_keys():
	return frappe.parse_json(frappe.db.get_default(sp.APPLIED_APP_ROLE_PERMS) or "[]")
