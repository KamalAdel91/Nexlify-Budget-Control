# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, flt


class ProjectVisits(Document):
	def before_insert(self):
		if not self.visit_label and self.project_planning:
			count = frappe.db.count("Project Visits", {"project_planning": self.project_planning})
			self.visit_label = f"{_ordinal(count + 1)} Visit"

	def validate(self):
		self.validate_cost_budget_submitted()
		self.validate_no_overlap()
		self.calculate_working_days()

	def calculate_working_days(self):
		self.working_days = sum(flt(sp.working_days) for sp in (self.sub_periods or []))

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
