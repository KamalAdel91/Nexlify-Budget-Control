# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class ProjectOverview(Document):
	def validate(self):
		self.sync_from_project()

	def sync_from_project(self):
		if not self.project:
			return
		cost_budget, revenue_budget = frappe.db.get_value(
			"Project", self.project, ["custom_budget_cost", "custom_project_planning"]
		)
		self.cost_budget = cost_budget
		self.revenue_budget = revenue_budget

	def on_update(self):
		if not self.project:
			return
		if frappe.db.get_value("Project", self.project, "custom_project_overview") != self.name:
			frappe.db.set_value("Project", self.project, "custom_project_overview", self.name)

	def before_submit(self):
		if not self.cost_budget:
			frappe.throw(_("Cannot approve: Project Costing has not been created for this project yet."))
		if not self.revenue_budget:
			frappe.throw(_("Cannot approve: Project Plan has not been created for this project yet."))

		cost_status = frappe.db.get_value("Project Cost Budget", self.cost_budget, "docstatus")
		plan_status = frappe.db.get_value("Project Planning", self.revenue_budget, "docstatus")

		if cost_status != 1:
			frappe.throw(_("Cannot approve: Project Costing has not been submitted yet."))
		if plan_status != 1:
			frappe.throw(_("Cannot approve: Project Plan has not been submitted yet."))
