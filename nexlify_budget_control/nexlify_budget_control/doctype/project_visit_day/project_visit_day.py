# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate


class ProjectVisitDay(Document):
	def validate(self):
		self._fill_from_visit()
		self._check_planning_still_draft()
		self._fill_designations()
		self._validate_date_within_visit()
		self._validate_no_duplicate_employees()
		self._validate_employees_not_double_booked()
		scope = self._get_equipment_scope()
		self._validate_equipment_in_scope(scope)
		self._validate_trades_in_scope(scope)
		self.days_consumed = flt(self.quantity) * flt(scope.days_per_equipment) if scope else 0

	def before_insert(self):
		self._fill_from_visit()

	def on_update(self):
		_refresh_visit_working_days(self.visit)

	def on_cancel(self):
		_refresh_visit_working_days(self.visit)

	def on_trash(self):
		_refresh_visit_working_days(self.visit, exclude=self.name)

	def _fill_from_visit(self):
		vals = frappe.db.get_value(
			"Project Visits", self.visit, ["project_planning", "project", "company", "customer"], as_dict=True
		)
		if vals:
			self.project_planning = vals.project_planning
			self.project = vals.project
			self.company = vals.company
			self.customer = vals.customer

	def before_submit(self):
		self._check_planning_still_draft()

	def before_cancel(self):
		self._check_planning_still_draft()

	def _fill_designations(self):
		for row in self.employees or []:
			if row.employee:
				row.designation = frappe.db.get_value("Employee", row.employee, "designation")
				row.employee_name = frappe.db.get_value("Employee", row.employee, "employee_name")

	def _validate_date_within_visit(self):
		start, end = frappe.db.get_value("Project Visits", self.visit, ["start_date", "end_date"])
		if start and end and not (getdate(start) <= getdate(self.work_date) <= getdate(end)):
			frappe.throw(_("Work Date must be within the visit period ({0} to {1}).").format(
				frappe.format(start, "Date"), frappe.format(end, "Date")))

	def _validate_no_duplicate_employees(self):
		seen = set()
		for row in self.employees or []:
			if row.employee in seen:
				frappe.throw(_("Employee {0} is listed more than once on this day.").format(row.employee))
			seen.add(row.employee)

	def _validate_employees_not_double_booked(self):
		# Physical constraint: no bypass role can override this.
		for row in self.employees or []:
			clash = frappe.db.sql(
				"""
				select d.name, d.project
				from `tabProject Visit Day Employee` e
				inner join `tabProject Visit Day` d on d.name = e.parent
				where e.employee = %s and d.work_date = %s and d.docstatus < 2 and d.name != %s
				limit 1
				""",
				(row.employee, self.work_date, self.name or ""),
				as_dict=True,
			)
			if clash:
				frappe.throw(_("Employee {0} is already booked on {1} in {2} (Project {3}).").format(
					row.employee_name or row.employee, frappe.format(self.work_date, "Date"),
					clash[0].name, clash[0].project))

	def _get_equipment_scope(self):
		project = frappe.db.get_value("Project Visits", self.visit, "project")
		cost_budget = frappe.db.get_value("Project", project, "custom_budget_cost") if project else None
		if not cost_budget or not self.equipment:
			return None
		name = frappe.db.get_value(
			"Project Equipment Scope",
			{"cost_budget": cost_budget, "equipment": self.equipment, "docstatus": 1},
			"name",
		)
		return frappe.get_doc("Project Equipment Scope", name) if name else None

	def _validate_equipment_in_scope(self, scope):
		if not scope and not _has_bypass_role():
			frappe.throw(_("Equipment '{0}' is not part of this project's Estimation.").format(self.equipment))

	def _validate_trades_in_scope(self, scope):
		if not scope or _has_bypass_role():
			return
		allowed = {r.trade for r in scope.roles}
		for row in self.employees or []:
			if not row.designation:
				frappe.throw(_("Employee {0} has no Designation set.").format(row.employee_name or row.employee))
			if row.designation not in allowed:
				frappe.throw(_("Designation '{0}' ({1}) is not required for '{2}' in the Estimation.").format(
					row.designation, row.employee_name or row.employee, self.equipment))

	def _check_planning_still_draft(self):
		if self.flags.ignore_planning_lock_check:
			return
		if frappe.db.get_value("Project Planning", self.project_planning, "docstatus") == 1:
			frappe.throw(_("Cannot modify this Visit Day: its Project Planning ({0}) is already submitted.").format(
				self.project_planning))


def _has_bypass_role():
	bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
	return bool(bypass_role) and bypass_role in frappe.get_roles(frappe.session.user)


def _refresh_visit_working_days(visit, exclude=None):
	days = frappe.db.sql(
		"""select count(distinct work_date) from `tabProject Visit Day`
		where visit = %s and docstatus < 2 and name != %s""",
		(visit, exclude or ""),
	)[0][0]
	frappe.db.set_value("Project Visits", visit, "working_days", days, update_modified=False)
