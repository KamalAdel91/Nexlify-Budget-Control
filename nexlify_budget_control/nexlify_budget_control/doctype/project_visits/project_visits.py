# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate


class ProjectVisits(Document):
	def before_insert(self):
		# project before naming: the name starts with the project
		if self.project_planning and not self.project:
			self.project = frappe.db.get_value("Project Planning", self.project_planning, "project")
		if not self.visit_label and self.project_planning:
			count = frappe.db.count("Project Visits", {"project_planning": self.project_planning})
			self.visit_label = f"{_ordinal(count + 1)} Visit"

	def validate(self):
		# label follows the name: VST-01, VST-02...
		if self.name and "-VST-" in self.name:
			self.visit_label = "-".join(self.name.split("-")[-2:])
		self.validate_cost_budget_submitted()
		self.validate_no_overlap()
		self.calculate_working_days()

	def calculate_working_days(self):
		self._check_planning_still_draft()
		self._validate_allocations()
		self._validate_team()
		self.working_days = flt(sum(flt(a.work_days) for a in (self.allocations or [])), 2)
		self.visit_duration = self._compute_duration()

	def _compute_duration(self):
		"""Person-days needed per role / headcount; the longest role decides. 0 if a needed role has nobody."""
		needed = {}
		for a in self.allocations or []:
			for r in frappe.get_all(
				"Project Equipment Scope Role",
				filters={"parent": a.planning_scope, "parenttype": "Project Planning Scope"},
				fields=["trade", "count"],
			):
				needed[r.trade] = needed.get(r.trade, 0) + flt(a.work_days) * cint(r.count)
		team = {}
		for t in self.team or []:
			team[t.trade] = team.get(t.trade, 0) + cint(t.headcount)
		durations = []
		for trade, person_days in needed.items():
			if team.get(trade, 0) <= 0:
				return 0
			durations.append(person_days / team[trade])
		return flt(max(durations), 2) if durations else 0

	def _check_planning_still_draft(self):
		if self.flags.ignore_planning_lock_check or not self.project_planning:
			return
		if frappe.db.get_value("Project Planning", self.project_planning, "docstatus") == 1:
			frappe.throw(_("Cannot modify this visit: its Project Planning ({0}) is already submitted.").format(
				self.project_planning))

	def _validate_allocations(self):
		seen = set()
		for a in self.allocations or []:
			scope = frappe.db.get_value(
				"Project Planning Scope", a.planning_scope,
				["project_planning", "equipment", "days_per_equipment", "docstatus"], as_dict=True,
			)
			if not scope or scope.project_planning != self.project_planning or scope.docstatus == 2:
				frappe.throw(_("Equipment row {0}: not part of this plan's Planning Scope.").format(a.idx))
			if a.planning_scope in seen:
				frappe.throw(_("{0} is listed more than once in this visit.").format(scope.equipment))
			seen.add(a.planning_scope)
			if flt(a.quantity) <= 0:
				frappe.throw(_("Equipment row {0}: quantity must be greater than zero.").format(a.idx))
			a.equipment = scope.equipment
			a.days_per_equipment = scope.days_per_equipment
			a.work_days = flt(flt(a.quantity) * flt(scope.days_per_equipment), 4)

	def _validate_team(self):
		if not self.team and self.allocations:
			for trade, count in suggested_visit_team([a.planning_scope for a in self.allocations]).items():
				self.append("team", {"trade": trade, "headcount": count})
		allowed = set(suggested_visit_team([a.planning_scope for a in self.allocations]).keys()) if self.allocations else None
		seen = set()
		for t in self.team or []:
			if cint(t.headcount) <= 0:
				frappe.throw(_("Visit Team: headcount for {0} must be greater than zero.").format(t.trade))
			if t.trade in seen:
				frappe.throw(_("Visit Team: {0} is listed more than once.").format(t.trade))
			seen.add(t.trade)
			if allowed is not None and t.trade not in allowed:
				frappe.throw(_("Visit Team: {0} is not a role of the equipment in this visit.").format(t.trade))

	def validate_cost_budget_submitted(self):
		project = frappe.db.get_value("Project Planning", self.project_planning, "project")
		cost_budget = frappe.db.get_value("Project", project, "custom_budget_cost")
		if not cost_budget:
			frappe.throw(_("Cannot add visits: no Costing (Estimation) has been created for this project yet."))
		if frappe.db.get_value("Project Cost Budget", cost_budget, "docstatus") != 1:
			frappe.throw(_("Cannot add visits: the project's Costing (Estimation) must be submitted first."))

	def validate_no_overlap(self):
		if not (self.start_date and self.end_date):
			return

		if getdate(self.start_date) > getdate(self.end_date):
			frappe.throw(_("End Date cannot be before Start Date"))

		siblings = frappe.get_all(
			"Project Visits",
			filters={"project_planning": self.project_planning, "name": ["!=", self.name or ""]},
			fields=["name", "start_date", "end_date"],
		)

		for sibling in siblings:
			if not (sibling.start_date and sibling.end_date):
				continue
			overlaps = getdate(self.start_date) < getdate(sibling.end_date) and getdate(self.end_date) > getdate(sibling.start_date)
			if overlaps:
				frappe.throw(
					_("This visit ({0} to {1}) overlaps with another visit ({2} to {3})").format(
						frappe.format(self.start_date, "Date"), frappe.format(self.end_date, "Date"),
						frappe.format(sibling.start_date, "Date"), frappe.format(sibling.end_date, "Date"),
					)
				)


def _ordinal(n):
	if 10 <= n % 100 <= 20:
		suffix = "th"
	else:
		suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
	return f"{n}{suffix}"


def suggested_visit_team(planning_scopes):
	"""One team working on the equipment one after the other: the largest crew needed per role."""
	team = {}
	for scope in planning_scopes or []:
		for r in frappe.get_all(
			"Project Equipment Scope Role",
			filters={"parent": scope, "parenttype": "Project Planning Scope"},
			fields=["trade", "count"],
		):
			team[r.trade] = max(team.get(r.trade, 0), cint(r.count))
	return team
