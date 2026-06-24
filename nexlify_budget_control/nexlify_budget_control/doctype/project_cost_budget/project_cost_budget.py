# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, flt


class ProjectCostBudget(Document):
	def validate(self):
		"""Validate budget document before saving."""
		self._validate_date_range()
		self._validate_conversion_rate()
		self._validate_duplicate_categories()
		self._set_default_currency()

	def _validate_date_range(self):
		"""Ensure from_date is before to_date."""
		if self.from_date and self.to_date:
			if getdate(self.from_date) > getdate(self.to_date):
				frappe.throw(
					_("From Date ({0}) cannot be after To Date ({1})").format(
						frappe.format_date(self.from_date),
						frappe.format_date(self.to_date),
					),
					title=_("Invalid Date Range"),
				)

	def _validate_conversion_rate(self):
		"""Ensure conversion_rate is positive."""
		if flt(self.conversion_rate) <= 0:
			frappe.throw(
				_("Conversion Rate must be greater than 0"),
				title=_("Invalid Conversion Rate"),
			)

	def _validate_duplicate_categories(self):
		"""Ensure no duplicate budget categories in details."""
		if not self.details:
			return

		seen_categories = set()
		for row in self.details:
			if row.budget_category in seen_categories:
				frappe.throw(
					_("Budget Category '{0}' is repeated in the details table. "
					  "Please remove duplicates.").format(row.budget_category),
					title=_("Duplicate Budget Category"),
				)
			seen_categories.add(row.budget_category)

	def _set_default_currency(self):
		"""Set currency from company default if not specified."""
		if not self.currency and self.company:
			self.currency = frappe.get_cached_value(
				"Company", self.company, "default_currency"
			)
