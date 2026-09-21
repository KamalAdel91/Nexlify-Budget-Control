# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class ProjectVisitCrew(Document):
	def validate(self):
		self.validate_trade_allowed()

	def validate_trade_allowed(self):
		if _has_budget_bypass_role():
			return

		project_planning = frappe.db.get_value("Project Visits", self.parent, "project_planning")
		if not project_planning:
			return

		project = frappe.db.get_value("Project Planning", project_planning, "project")
		if not project:
			return

		cost_budget = frappe.db.get_value("Project", project, "custom_budget_cost")
		if not cost_budget:
			return

		allowed = frappe.get_all(
			"Project Crew Requirement",
			filters={"parent": cost_budget, "parenttype": "Project Cost Budget"},
			pluck="trade",
		)

		if self.trade not in allowed:
			frappe.throw(
				_("Trade '{0}' is not part of this project's Estimation.").format(self.trade)
			)


def _has_budget_bypass_role():
	bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
	if not bypass_role:
		return False
	return bypass_role in frappe.get_roles(frappe.session.user)
