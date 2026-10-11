# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr, flt


class ProjectInvoicing(Document):
	def before_insert(self):
		# project before naming: the name starts with the project
		if self.project_planning and not self.project:
			self.project = frappe.db.get_value("Project Planning", self.project_planning, "project")
		if not self.invoice_label and self.project_planning:
			count = frappe.db.count("Project Invoicing", {"project_planning": self.project_planning})
			self.invoice_label = f"{_ordinal(count + 1)} Invoice"

	def validate(self):
		# label follows the name: INV-01, INV-02...
		if self.name and "-INV-" in self.name:
			self.invoice_label = "-".join(self.name.split("-")[-2:])
		self._validate_plan_lock()
		self._validate_invoice_type()

	def _validate_plan_lock(self):
		"""A Plan that is approved or waiting for approval keeps its invoices: only the system's fields
		(status, Job Completion, amount, Sales Invoice) change then, and the Invoice Type while Pending. Same lock as the Edit dialogs."""
		if not self.project_planning:
			return
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import (
			EXCLUDED_INVOICING_EDIT_FIELDS,
			NON_VALUE_FIELDTYPES,
			_assert_plan_editable,
		)

		before = None if self.is_new() else self.get_doc_before_save()
		if before:
			fields = [f for f in self.meta.fields if f.fieldname not in EXCLUDED_INVOICING_EDIT_FIELDS and f.fieldname != "invoice_type"
				and (f.fieldtype in ("Table", "Table MultiSelect") or f.fieldtype not in NON_VALUE_FIELDTYPES) and not f.read_only]
			if not any(_value(self, f) != _value(before, f) for f in fields):
				return
		_assert_plan_editable(self.project_planning)

	def _validate_invoice_type(self):
		"""The Invoice Type changes only while Pending. A Down Payment on an approved Plan is ready to invoice at once."""
		from nexlify_budget_control.nexlify_budget_control.job_completion import DOWN_PAYMENT, PENDING, make_ready

		before = None if self.is_new() else self.get_doc_before_save()
		if not before or before.get("invoice_type") == self.invoice_type:
			return
		if before.get("status") != PENDING:
			frappe.throw(_("The Invoice Type changes only while the invoice is Pending."))
		if (self.invoice_type == DOWN_PAYMENT and self.status == PENDING and self.project_planning
				and frappe.db.get_value("Project Planning", self.project_planning, "docstatus") == 1):
			make_ready(self, save=False)


def _ordinal(n):
	if 10 <= n % 100 <= 20:
		suffix = "th"
	else:
		suffix = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
	return f"{n}{suffix}"


def _value(doc, df):
	"""A field's value, comparable before and after a save (child tables by their links)."""
	value = doc.get(df.fieldname)
	if df.fieldtype in ("Table", "Table MultiSelect"):
		links = [f.fieldname for f in frappe.get_meta(df.options).fields if f.fieldtype == "Link"]
		return sorted(cstr(r.get(links[0])) for r in value or []) if links else len(value or [])
	if df.fieldtype in ("Currency", "Float", "Percent", "Int", "Check"):
		return flt(value)
	return cstr(value)
