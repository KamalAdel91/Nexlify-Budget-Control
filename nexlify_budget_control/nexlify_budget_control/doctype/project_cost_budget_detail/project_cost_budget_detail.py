# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate


class ProjectCostBudgetDetail(Document):
	def validate(self):
		"""Validate budget detail row before saving."""
		self._validate_date_range()
		self._validate_estimated_amount()
		self._validate_warning_threshold()

	def _validate_date_range(self):
		"""Ensure child from_date/to_date is valid if specified."""
		# If dates are specified on detail, validate they exist
		if self.from_date and self.to_date:
			if getdate(self.from_date) > getdate(self.to_date):
				frappe.throw(
					_("Row #{0}: From Date cannot be after To Date for Budget Category '{1}'").format(
						self.idx,
						self.budget_category,
					),
					title=_("Invalid Date Range"),
				)

	def _validate_estimated_amount(self):
		"""Ensure estimated_amount is positive."""
		if flt(self.estimated_amount) < 0:
			frappe.throw(
				_("Row #{0}: Estimated Amount cannot be negative for Budget Category '{1}'").format(
					self.idx,
					self.budget_category,
				),
				title=_("Invalid Estimated Amount"),
			)

	def _validate_warning_threshold(self):
		"""Ensure warning_threshold_percentage is between 0 and 100."""
		threshold = flt(self.warning_threshold_percentage)
		if threshold < 0 or threshold > 100:
			frappe.throw(
				_("Row #{0}: Warning Threshold % must be between 0 and 100 for Budget Category '{1}'").format(
					self.idx,
					self.budget_category,
				),
				title=_("Invalid Warning Threshold"),
			)
