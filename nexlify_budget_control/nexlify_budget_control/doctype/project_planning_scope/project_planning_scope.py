# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt


class ProjectPlanningScope(Document):
	def before_insert(self):
		self._fill_from_planning()

	def validate(self):
		self._fill_from_planning()
		self._check_planning_still_draft()
		self.total_days = flt(flt(self.quantity) * flt(self.days_per_equipment), 4)
		self._validate_roles()

	def before_submit(self):
		self._check_planning_still_draft()

	def before_cancel(self):
		self._check_planning_still_draft()

	def _fill_from_planning(self):
		vals = frappe.db.get_value("Project Planning", self.project_planning, ["project", "company"], as_dict=True)
		if vals:
			self.project = vals.project
			self.company = vals.company

	def _validate_roles(self):
		allowed = None
		if self.estimation_scope and not _has_bypass_role():
			allowed = set(frappe.get_all(
				"Project Equipment Scope Role",
				filters={"parent": self.estimation_scope, "parenttype": "Project Equipment Scope"},
				pluck="trade",
			))
		seen = set()
		for row in self.roles or []:
			if cint(row.count) <= 0:
				frappe.throw(_("Count for '{0}' must be greater than zero. Remove the row instead.").format(row.trade))
			if row.trade in seen:
				frappe.throw(_("'{0}' is listed more than once.").format(row.trade))
			seen.add(row.trade)
			if allowed is not None and row.trade not in allowed:
				frappe.throw(_("'{0}' is not a role of '{1}' in the Estimation.").format(row.trade, self.equipment))

	def _check_planning_still_draft(self):
		if self.flags.ignore_planning_lock_check:
			return
		if frappe.db.get_value("Project Planning", self.project_planning, "docstatus") == 1:
			frappe.throw(_("Cannot modify: the Project Planning ({0}) is already submitted.").format(self.project_planning))


def _has_bypass_role():
	bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
	return bool(bypass_role) and bypass_role in frappe.get_roles(frappe.session.user)
