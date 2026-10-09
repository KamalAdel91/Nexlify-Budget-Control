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

	def _validate_plan_lock(self):
		"""A Plan that is approved or waiting for approval keeps its invoices: only the system's fields
		(status, Job Completion, amount, Sales Invoice) change then. Same lock as the Edit dialogs."""
		if not self.project_planning:
			return
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import (
			EXCLUDED_INVOICING_EDIT_FIELDS,
			NON_VALUE_FIELDTYPES,
			_assert_plan_editable,
		)

		before = None if self.is_new() else self.get_doc_before_save()
		if before:
			fields = [f for f in self.meta.fields if f.fieldname not in EXCLUDED_INVOICING_EDIT_FIELDS
				and (f.fieldtype in ("Table", "Table MultiSelect") or f.fieldtype not in NON_VALUE_FIELDTYPES) and not f.read_only]
			if not any(_value(self, f) != _value(before, f) for f in fields):
				return
		_assert_plan_editable(self.project_planning)


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
