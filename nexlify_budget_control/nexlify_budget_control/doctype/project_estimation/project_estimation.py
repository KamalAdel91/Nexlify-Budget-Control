# Copyright (c) 2026, Kamal Adel and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate



def _manpower_order():
	"""Manpower Category name -> position, by the Sort set on the category."""
	return {name: i for i, name in enumerate(frappe.get_all("Manpower Category", pluck="name", order_by="sort_order asc, creation asc"))}


class ProjectEstimation(Document):
	def on_trash(self):
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import cascade_delete_estimation
		from nexlify_budget_control.nexlify_budget_control.opportunity_rfq import release_opportunity
		frappe.flags.nexlify_rfq_scope_sync = True
		try:
			release_opportunity(self)
			cascade_delete_estimation(self)
		finally:
			frappe.flags.nexlify_rfq_scope_sync = False

	def after_insert(self):
		from nexlify_budget_control.nexlify_budget_control.budget_enforcement import link_project_document
		link_project_document(self.project, "custom_budget_cost", self.name)
		if self.amended_from:
			from nexlify_budget_control.nexlify_budget_control.budget_enforcement import carry_over_amended_cost_budget
			frappe.flags.nexlify_rfq_scope_sync = True
			try:
				carry_over_amended_cost_budget(self.amended_from, self.name)
			finally:
				frappe.flags.nexlify_rfq_scope_sync = False

		from nexlify_budget_control.nexlify_budget_control.opportunity_rfq import on_estimation_amended
		on_estimation_amended(self)

	def validate(self):
		"""Validate budget document before saving."""
		self._validate_single_active_estimation()
		self._validate_conversion_rate()
		self._validate_duplicate_categories()
		self._set_default_currency()
		self._calculate_equipment_scope_totals()
		self._reset_changed_supply_prices()
		self._set_supply_status()
		self._calculate_estimation()
		self._set_approval_level()
		self._validate_workflow_step()

	def before_submit(self):
		if not self.contract_no_prices:
			frappe.throw(_("Attach the Contract (No Prices) before handing over to Planning."))
		self._validate_ready()

	def _validate_ready(self):
		"""Checked when the prices go to Sales, and again at the Handover."""
		self._validate_equipment_ready()
		self._validate_supply_ready()
		missing = self._missing_rate_trades()
		if missing:
			frappe.throw(
				_("Enter the Basic Salary in Team Daily Rates for: {0}").format(", ".join(sorted(missing))),
				title=_("Missing Team Rates"),
			)
		if flt(self.manpower_cost) and not self._estimation_categories().get("manpower"):
			frappe.throw(_("Set the Manpower Budget Category in Project Budget Settings."))
		if flt(self.fuel_maintenance_total) and not self._estimation_categories().get("transportation"):
			frappe.throw(_("Set the Car & Fuels Budget Category in Project Budget Settings."))
		for category, rows, label in self._table_categories(with_labels=True):
			if not category and sum(flt(x.cost) for x in (rows or [])):
				frappe.throw(_("Set the {0} Budget Category in Project Budget Settings.").format(label))
		if abs(flt(self.budget_difference)) > 0.01:
			fmt = lambda v: frappe.utils.fmt_money(v, currency=self.currency)
			frappe.throw(
				_("Budget Details total ({0}) does not match the Execution Estimation Total Cost ({1}). Difference: {2}.").format(
					fmt(self.budget_details_total), fmt(self.total_cost), fmt(self.budget_difference)),
				title=_("Budget does not match the Estimation"),
			)
		if not self.details:
			frappe.throw(_("Budget Details cannot be empty. Add Team Daily Rates / Other Costs, or a manual budget row."))

	def _set_approval_level(self):
		"""Who approves the selling price before Sales gets it: limits in Project Budget Settings, in company currency."""
		settings = frappe.get_cached_doc("Project Budget Settings")
		price = flt(self.total_price) * flt(self.conversion_rate or 1)
		coo, ceo = flt(settings.coo_approval_limit), flt(settings.ceo_approval_limit)
		self.approval_level = "CEO" if ceo and price > ceo else "COO" if coo and price > coo else ""

	def _validate_workflow_step(self):
		"""The prices are checked when they leave Draft (for approval or to Sales), then locked until the Estimation is
		back in Draft (Reprice, Request Revision or a Return). A Return, Request Changes or Reprice needs its reason.
		Each step of the contract negotiation adds a Contract Round."""
		from nexlify_budget_control.nexlify_budget_control import estimation_flow as flow

		before = None if self.is_new() else self.get_doc_before_save()
		prev = before.get("workflow_state") if before else None
		state = self.workflow_state
		locked = flow.price_locked()
		if state in locked and prev not in locked:
			settings = frappe.get_cached_doc("Project Budget Settings")
			if not (flt(settings.coo_approval_limit) and flt(settings.ceo_approval_limit)):
				frappe.throw(_("Set the COO and CEO approval limits in Project Budget Settings."))
			self._validate_ready()
			self.return_reason = None
		elif (state in locked and prev == state
				and not frappe.flags.nexlify_rfq_scope_sync and not self.flags.nexlify_flow_save):
			frappe.throw(_("The prices are locked while the Estimation is {0}.").format(_(state)))
		if prev == state:
			return
		reason = (self.return_reason or "").strip()
		review = flow.contract_review()
		needs_reason = ((prev in flow.pending() and state in flow.draft())
			or (prev in review and state in (flow.changes_requested() | flow.draft())))
		if needs_reason and not reason:
			frappe.throw(_("Enter the reason."))
		if state in review:
			sent = frappe.flags.nexlify_contract_round
			if not sent:
				frappe.throw(_("Sales sends the contract from the Opportunity."))
			self._add_round("From Sales", "Contract Sent", **sent)
			self.return_reason = None
		elif prev in review and state not in flow.lost():
			event = ("Changes Requested" if state in flow.changes_requested()
				else "Accepted" if state in flow.agreed() else "Repriced")
			self._add_round("From Estimation", event, comment=reason or None)

	def _add_round(self, direction, event, **values):
		"""One step of the contract negotiation: a new round starts each time Sales sends the contract."""
		sent = sum(1 for r in self.get("contract_rounds") or [] if r.direction == "From Sales")
		self.append("contract_rounds", {
			"round_no": sent + 1 if direction == "From Sales" else max(sent, 1),
			"direction": direction, "event": event,
			"by_user": values.pop("by_user", None) or frappe.session.user,
			"sent_on": frappe.utils.now_datetime(), **values})

	def on_update(self):
		"""A Return or a contract decision goes on the timeline (the Opportunity's too, for Sales), with its reason."""
		from nexlify_budget_control.nexlify_budget_control import estimation_flow as flow

		before = self.get_doc_before_save()
		prev = before.get("workflow_state") if before else None
		state = self.workflow_state
		if prev == state:
			return
		who = frappe.utils.get_fullname(frappe.session.user)
		reason = frappe.utils.escape_html(self.return_reason or "")
		if prev in flow.pending() and state in flow.draft():
			self.add_comment("Comment", _("Returned to Estimation by {0}: {1}").format(who, reason))
		elif prev in flow.contract_review() and state in flow.changes_requested():
			msg = _("Contract changes requested by {0}: {1}").format(who, reason)
			self.add_comment("Comment", msg)
			if self.opportunity:
				frappe.get_doc("Opportunity", self.opportunity).add_comment("Comment", msg)
		elif prev in flow.contract_review() and state in flow.agreed() and self.opportunity:
			frappe.get_doc("Opportunity", self.opportunity).add_comment("Comment",
				_("Contract accepted by {0}. The Opportunity can be Closed Won with the signed contract.").format(who))

	def _scope_rows_with_roles(self):
		if self.is_new():
			return []
		rows = frappe.get_all(
			"Project Equipment Scope",
			filters={"cost_budget": self.name, "docstatus": ["in", [0, 1]]},
			fields=["name", "equipment", "quantity", "total_days"],
		)
		for r in rows:
			r["roles"] = frappe.get_all(
				"Project Equipment Scope Role",
				filters={"parent": r.name, "parenttype": "Project Equipment Scope"},
				fields=["trade", "count"],
			)
		return rows

	def _sync_team_rate_rows(self):
		"""One rate row per role used in the Equipment Scope; keeps entered salaries."""
		if self.is_new():
			return
		trades = []
		for s in self._scope_rows_with_roles():
			for role in s.roles:
				if role.trade not in trades:
					trades.append(role.trade)
		existing = {r.designation: r for r in (self.team_rates or [])}
		keep = [existing[t] for t in trades if t in existing]
		self.set("team_rates", keep)
		for t in trades:
			if t not in existing:
				self.append("team_rates", {"designation": t, "factor": 2})
		order = _manpower_order()
		self.team_rates.sort(key=lambda r: (order.get(r.designation, 999), r.designation or ''))
		for i, row in enumerate(self.team_rates, 1):
			row.idx = i
		for i, r in enumerate(self.team_rates, 1):
			r.idx = i

	def _sync_accommodation_rows(self):
		"""One row per Team Daily Rates role; monthly cost from the basic salary unless Custom."""
		trades = [r.designation for r in (self.team_rates or [])]
		existing = {a.designation: a for a in (self.accommodation or [])}
		self.set("accommodation", [existing[t] for t in trades if t in existing])
		for t in trades:
			if t not in existing:
				self.append("accommodation", {"designation": t, "persons": 1})
		order = _manpower_order()
		self.accommodation.sort(key=lambda a: (order.get(a.designation, 999), a.designation or ''))
		for i, row in enumerate(self.accommodation, 1):
			row.idx = i
		for i, a in enumerate(self.accommodation, 1):
			a.idx = i

		months_of_salary = {"Main City": 4, "Outside Main City": 5}.get(self.accommodation_basis)
		if months_of_salary:
			salary = {r.designation: flt(r.basic_salary) for r in (self.team_rates or [])}
			for a in self.accommodation:
				a.monthly_cost_per_person = flt(salary.get(a.designation, 0) * months_of_salary / 12, 2)

	def _day_rates(self):
		return {r.designation: flt(r.day_rate) for r in (self.team_rates or [])}

	def _missing_rate_trades(self):
		rates = self._day_rates()
		missing = set()
		for s in self._scope_rows_with_roles():
			for role in s.roles:
				if flt(rates.get(role.trade)) <= 0:
					missing.add(role.trade)
		return missing

	def _calculate_estimation(self):
		"""Team rates -> manpower cost; other costs; totals, margin and price; auto budget rows."""
		self._sync_team_rate_rows()
		wdm = cint(self.working_days_per_month) or 26

		seen = set()
		for r in self.team_rates or []:
			if r.designation in seen:
				frappe.throw(_("Manpower Category {0} is listed more than once in Team Daily Rates.").format(r.designation))
			seen.add(r.designation)
			r.complete_salary = flt(flt(r.basic_salary) * flt(r.factor), 2)
			r.day_rate = flt(r.complete_salary / wdm, 2)

		self.duration_months = flt(flt(self.total_work_days) / wdm, 4)

		rates = self._day_rates()
		manpower = 0
		for s in self._scope_rows_with_roles():
			crew_day_cost = sum(flt(role.count) * rates.get(role.trade, 0) for role in s.roles)
			manpower += flt(s.total_days) * crew_day_cost
		self.manpower_cost = flt(manpower, 2)

		months = flt(self.duration_months)
		self._sync_accommodation_rows()
		for a in self.accommodation or []:
			a.cost = flt(cint(a.persons) * flt(a.monthly_cost_per_person) * months, 2)
		for t in self.test_equipment or []:
			t.monthly_cost = flt(self._monthly_asset_cost(t, _("Test Equipment")), 2)
			t.cost = flt(t.monthly_cost * months, 2)
		for v in self.transportation or []:
			v.monthly_cost = flt(self._monthly_asset_cost(v, _("Car & Fuels")), 2)
			v.cost = flt(v.monthly_cost * months, 2)
		for s in self.supply or []:
			s.cost = 0 if s.is_cancelled else flt(flt(s.rate) * flt(s.qty), 2)

		other = 0
		for oc in self.other_costs or []:
			oc.cost = flt(oc.cost, 2)
			other += oc.cost
		for rows in (self.accommodation, self.test_equipment, self.transportation, self.supply):
			other += sum(flt(x.cost) for x in (rows or []))
		other += flt(self.fuel_maintenance_total)
		self.other_cost_total = flt(other, 2)

		self.accommodation_total = flt(sum(flt(x.cost) for x in (self.accommodation or [])), 2)
		self.test_equipment_total = flt(sum(flt(x.cost) for x in (self.test_equipment or [])), 2)
		self.transportation_total = flt(sum(flt(x.cost) for x in (self.transportation or [])) + flt(self.fuel_maintenance_total), 2)
		self.supply_total = flt(sum(flt(x.cost) for x in (self.supply or [])), 2)
		self.other_costs_table_total = flt(sum(flt(x.cost) for x in (self.other_costs or [])), 2)
		self.total_cost = flt(self.manpower_cost + self.other_cost_total, 2)
		self.margin_amount = flt(self.total_cost * flt(self.margin_percentage) / 100, 2)
		self.total_price = flt(self.total_cost + self.margin_amount, 2)
		self.price_per_day = flt(self.total_price / flt(self.total_work_days), 2) if flt(self.total_work_days) else 0

		self._store_equipment_scope_prices()
		self._sync_auto_budget_rows()
		self.budget_details_total = flt(sum(flt(r.estimated_amount) for r in (self.details or [])), 2)
		self.budget_difference = flt(self.budget_details_total - flt(self.total_cost), 2)

	def _store_equipment_scope_prices(self, include_submitted=False):
		"""Stores each equipment's crew day cost, manpower cost and its share of the price (same formulas as the form).
		The line price is the rounded unit price times the quantity, and the Estimation price is the sum of the lines
		(the rounding goes to the margin), so the approval, the Sales view and the Quotation show the same number."""
		if self.is_new():
			return
		flt = frappe.utils.flt
		rates = self._day_rates()
		manpower = flt(self.manpower_cost)
		statuses = [0, 1] if include_submitted else [0]
		line_total = 0
		for r in frappe.get_all("Project Equipment Scope",
				filters={"cost_budget": self.name, "docstatus": ["in", statuses]}, fields=["name", "quantity", "total_days"]):
			roles = frappe.get_all("Project Equipment Scope Role",
				filters={"parent": r.name, "parenttype": "Project Equipment Scope"}, fields=["trade", "count"])
			crew = flt(sum(flt(x.count) * flt(rates.get(x.trade, 0)) for x in roles), 2)
			cost = flt(flt(r.total_days) * crew, 2)
			price = flt(flt(self.total_price) * cost / manpower, 2) if manpower else 0
			unit = flt(price / flt(r.quantity), 2) if flt(r.quantity) else 0
			if flt(r.quantity):
				price = flt(unit * flt(r.quantity), 2)
			line_total += price
			frappe.db.set_value("Project Equipment Scope", r.name,
				{"crew_day_cost": crew, "manpower_cost": cost, "total_price": price, "unit_price": unit}, update_modified=False)
		if line_total and abs(line_total - flt(self.total_price)) >= 0.005:
			self.total_price = flt(line_total, 2)
			self.margin_amount = flt(self.total_price - flt(self.total_cost), 2)
			self.price_per_day = flt(self.total_price / flt(self.total_work_days), 2) if flt(self.total_work_days) else 0

	def _reset_changed_supply_prices(self):
		"""A Supply price comes from the Supply Chain, or is typed for a Manual line: a new line, or a changed item, quantity or source, is priced again."""
		if self.flags.from_supply_chain or (self.is_new() and self.amended_from):
			return
		before = None if self.is_new() else self.get_doc_before_save()
		from nexlify_budget_control.nexlify_budget_control.supply_chain import MANUAL, pending_requests

		old = {r.name: r for r in ((before.get("supply") if before else None) or [])}
		pending = set(pending_requests(self.name)) if before else set()
		kept = {r.name for r in self.supply or []}
		gone = [r.item_code for n, r in old.items() if n not in kept and r.supply_request]
		if gone:
			frappe.throw(_("These Supply items went to the Supply Chain, so they stay: use Actions > Cancel Line instead of removing them: {0}").format(
				", ".join(gone)), title=_("Cancel instead"))
		for row in self.supply or []:
			prev = old.get(row.name)
			row.is_cancelled = prev.is_cancelled if prev else 0
			changed = (not prev or prev.item_code != row.item_code or flt(prev.qty) != flt(row.qty)
				or (prev.price_source == MANUAL) != (row.price_source == MANUAL))
			if changed and prev and prev.supply_request in pending:
				frappe.throw(_("Row {0}: {1} is waiting at the Supply Chain ({2}), so it can't change until its prices are sent or the request is cancelled.").format(
					row.idx, prev.item_code, prev.supply_request))
			if row.price_source == MANUAL:
				row.supplier_quotation, row.supplier, row.supply_request = None, None, None
			elif changed:
				row.rate, row.supplier_quotation, row.supplier, row.supply_request = 0, None, None, None
			else:
				row.rate, row.supplier_quotation, row.supply_request = prev.rate, prev.supplier_quotation, prev.supply_request

	def _validate_supply_ready(self):
		"""The Supply goes out only after the Supply Chain priced every line."""
		from nexlify_budget_control.nexlify_budget_control.supply_chain import MANUAL, pending_requests

		pending = [] if self.is_new() else pending_requests(self.name)
		if pending:
			frappe.throw(_("The Supply is still at the Supply Chain: {0}.").format(", ".join(pending)),
				title=_("Waiting for Supply Chain"))
		unpriced = [r.item_code for r in self.supply or [] if not r.is_cancelled and r.price_source != MANUAL and not r.supplier_quotation]
		no_rate = [r.item_code for r in self.supply or [] if not r.is_cancelled and r.price_source == MANUAL and flt(r.rate) <= 0]
		if no_rate:
			frappe.throw(_("Enter a rate for these Manual Supply items: {0}").format(", ".join(no_rate)),
				title=_("Supply not priced"))
		if unpriced:
			frappe.throw(_("Send these Supply items to the Supply Chain first: {0}").format(", ".join(unpriced)),
				title=_("Supply not priced"))

	def _set_supply_status(self):
		"""The Supply Status column: where each Supply Chain line stands."""
		from nexlify_budget_control.nexlify_budget_control.supply_chain import row_supply_status

		reqs = {} if self.is_new() else dict(frappe.get_all("Supply Request", filters={"estimation": self.name},
			fields=["name", "status"], as_list=True))
		for row in self.supply or []:
			row.supply_status = row_supply_status(row, reqs.get(row.supply_request))

	def _estimation_categories(self):
		fields = {
			"manpower": "manpower_budget_category",
			"accommodation": "accommodation_budget_category",
			"test_equipment": "test_equipment_budget_category",
			"transportation": "transportation_budget_category",
			"supply": "supply_budget_category",
		}
		return {k: frappe.db.get_single_value("Project Budget Settings", v) for k, v in fields.items()}

	def _table_categories(self, with_labels=False):
		cats = self._estimation_categories()
		items = [
			(cats.get("accommodation"), self.accommodation, _("Accommodation")),
			(cats.get("test_equipment"), self.test_equipment, _("Test Equipment")),
			(cats.get("transportation"), self.transportation, _("Car & Fuels")),
			(cats.get("supply"), self.supply, _("Supply")),
		]
		return items if with_labels else [(c, r) for c, r, _l in items]

	def _monthly_asset_cost(self, row, label):
		if row.ownership == "Rented":
			return flt(row.monthly_rent)
		if cint(row.depreciation_months) <= 0:
			frappe.throw(_("{0} row {1}: Depreciation Months must be greater than zero.").format(label, row.idx))
		return flt(row.asset_value) / cint(row.depreciation_months)

	def _sync_auto_budget_rows(self):
		amounts = {}
		cats = self._estimation_categories()
		if cats.get("manpower") and flt(self.manpower_cost):
			amounts[cats["manpower"]] = flt(self.manpower_cost)
		for oc in self.other_costs or []:
			if oc.budget_category and flt(oc.cost):
				amounts[oc.budget_category] = amounts.get(oc.budget_category, 0) + flt(oc.cost)
		for category, rows in self._table_categories():
			total = sum(flt(x.cost) for x in (rows or []))
			if category and total:
				amounts[category] = amounts.get(category, 0) + total
		if cats.get("transportation") and flt(self.fuel_maintenance_total):
			amounts[cats["transportation"]] = amounts.get(cats["transportation"], 0) + flt(self.fuel_maintenance_total)

		keep, handled, taken_over = [], set(), []
		for row in self.details or []:
			if row.budget_category in amounts and row.budget_category not in handled:
				if not row.is_auto:
					taken_over.append(row.budget_category)
				row.is_auto = 1
				row.estimated_amount = flt(amounts[row.budget_category], 2)
				handled.add(row.budget_category)
				keep.append(row)
			elif row.is_auto:
				continue  # category no longer calculated -> drop the auto row
			else:
				keep.append(row)

		self.set("details", keep)
		for category, amount in amounts.items():
			if category not in handled:
				self.append("details", {
					"budget_category": category,
					"estimated_amount": flt(amount, 2),
					"is_auto": 1,
				})

		for i, row in enumerate(self.details or [], 1):
			row.idx = i

		if taken_over:
			frappe.msgprint(
				_("These budget rows are now calculated automatically from the Execution Estimation: {0}").format(
					", ".join(taken_over)),
				indicator="blue",
			)

	def _calculate_equipment_scope_totals(self):
		"""Roll up total_work_days from the standalone Project Equipment Scope documents."""
		if self.is_new():
			return
		self.total_work_days = frappe.db.sql(
			"""select coalesce(sum(total_days), 0) from `tabProject Equipment Scope`
			where cost_budget = %s and docstatus in (0, 1)""",
			(self.name,),
		)[0][0]

	def before_cancel(self):
		plan = self.project and frappe.db.get_value("Project Planning", {"project": self.project, "docstatus": 1}, "name")
		if plan:
			frappe.throw(_("Cancel the Project Planning ({0}) first: it is built on this Estimation.").format(plan))

	def _validate_single_active_estimation(self):
		if not self.project and not self.get("opportunity"):
			frappe.throw(_("An Estimation needs a Project or an Opportunity."))
		key = "project" if self.project else "opportunity"
		other = frappe.db.get_value(
			"Project Estimation",
			{key: self.get(key), "docstatus": ["<", 2], "is_cancelled_draft": 0, "name": ["!=", self.name or ""]},
			"name",
		)
		if other:
			frappe.throw(_("This {0} already has an Estimation ({1}). Open it instead of creating a new one.").format(
				_("project") if key == "project" else _("opportunity"), other))

	def _validate_equipment_ready(self):
		"""Every equipment needs days and at least one role before the Estimation is submitted."""
		missing = []
		for s in frappe.get_all("Project Equipment Scope", filters={"cost_budget": self.name, "docstatus": ["<", 2]},
				fields=["name", "equipment", "days_per_equipment"], order_by="creation"):
			problems = []
			if flt(s.days_per_equipment) <= 0:
				problems.append(_("days"))
			if not frappe.db.exists("Project Equipment Scope Role", {"parent": s.name, "count": [">", 0]}):
				problems.append(_("manpower"))
			if problems:
				missing.append(f"{s.equipment}: {', '.join(problems)}")
		if missing:
			frappe.throw(_("Complete the Equipment Scope before submitting:") + "<br>" + "<br>".join(missing),
				title=_("Equipment Scope incomplete"))

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


@frappe.whitelist()
def set_return_reason(name, reason):
	"""Saves the reason before a Return action (apply_workflow reloads the doc from the database)."""
	from nexlify_budget_control.nexlify_budget_control import estimation_flow as flow

	frappe.has_permission("Project Estimation", "write", doc=name, throw=True)
	reason = (reason or "").strip()
	if not reason:
		frappe.throw(_("Enter the reason for returning it."))
	if frappe.db.get_value("Project Estimation", name, "workflow_state") not in flow.pending() | flow.contract_review():
		frappe.throw(_("The Estimation is not waiting for this decision."))
	frappe.db.set_value("Project Estimation", name, "return_reason", reason, update_modified=False)
