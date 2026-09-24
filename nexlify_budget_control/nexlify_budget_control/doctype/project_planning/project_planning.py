# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProjectPlanning(Document):
	def on_trash(self):
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import cascade_delete_planning
		cascade_delete_planning(self)

	def after_insert(self):
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import link_project_document
		link_project_document(self.project, "custom_project_planning", self.name)
		if self.amended_from:
			from nexlify_budget_control.nexlify_budget_control.budget_enforcement import carry_over_amended_planning
			carry_over_amended_planning(self.amended_from, self.name)
		else:
			from nexlify_budget_control.nexlify_budget_control.budget_enforcement import auto_copy_planning_scope
			auto_copy_planning_scope(self.name)

	def validate(self):
		if self.docstatus == 0:
			self.estimation = _active_estimation(self.project)
		other = frappe.db.get_value(
			"Project Planning",
			{"project": self.project, "docstatus": ["<", 2], "name": ["!=", self.name or ""]},
			"name",
		)
		if other:
			frappe.throw(_("This project already has a Project Planning ({0}). Open it instead of creating a new one.").format(other))

	def before_submit(self):
		self.validate_invoice_percentage_total()
		self.validate_execution_distribution()

	def validate_invoice_percentage_total(self):
		invoices = frappe.get_all(
			"Project Invoicing",
			filters={"project_planning": self.name},
			fields=["invoice_percentage"],
		)
		total = sum(flt(i.invoice_percentage) for i in invoices)
		if abs(total - 100) > 0.01:
			frappe.throw(
				_("Total Invoice Percentage across all Invoices must equal 100%. Currently: {0}%").format(total)
			)

	def validate_execution_distribution(self):
		# Rebuilt on the Planning Scope (distribution of the planned scope across visits).
		return

	def _has_bypass_role(self):
		bypass_role = frappe.db.get_single_value("Project Budget Settings", "budget_bypass_role")
		if not bypass_role:
			return False
		return bypass_role in frappe.get_roles(frappe.session.user)


def _active_estimation(project):
	if not project:
		return None
	return (frappe.db.get_value("Project Cost Budget", {"project": project, "docstatus": 1}, "name")
		or frappe.db.get_value("Project", project, "custom_budget_cost"))
