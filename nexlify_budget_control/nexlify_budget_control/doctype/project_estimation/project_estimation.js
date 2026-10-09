window.nexlify = window.nexlify || {}; nexlify.sort_trades = nexlify.sort_trades || ((l) => (l || []).slice()); nexlify.trade_cmp = nexlify.trade_cmp || (() => 0); nexlify.trade_color = nexlify.trade_color || (() => "#64748B");
// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on("Project Estimation", {
	setup: function(frm) {
		// Set default naming series based on company
		frm.set_query("naming_series", function() {
			return {
				filters: {
					"name": ["in", [".ABBR.-CB-.YYYY.-.####"]]
				}
			};
		});
	},

	company: function(frm) {
		if (frm.doc.company && !frm.doc.__islocal) {
			return;
		}
		// Set naming series when company selected (only for new docs)
		if (frm.doc.company && frm.doc.__islocal) {
			frm.set_value("naming_series", ".ABBR.-CB-.YYYY.-.####");
		}
	},

	refresh: function(frm) {
		frm.ignore_doctypes_on_cancel_all = ['Project Equipment Scope', 'Project Planning'];
		render_equipment_scope_toolbar(frm);
		render_equipment_scope_summary(frm);
	}
});


// ---------------------------------------------------------------------------
// Equipment Scope - standalone submittable documents, dialog-driven
// ---------------------------------------------------------------------------

let _cost_budget_frm = null;
let _cached_equipment_scope = [];

function render_equipment_scope_toolbar(frm) {
	if (frm.is_new()) return;
	_cost_budget_frm = frm;
}

function build_roles_fields_grid() {
	return [
		{ fieldname: 'trade', fieldtype: 'Link', options: 'Manpower Category', get_query: () => ({ filters: { enabled: 1 } }), label: __('Manpower Category'), reqd: 1, in_list_view: 1 },
		{ fieldname: 'count', fieldtype: 'Int', label: __('Count'), reqd: 1, default: 1, in_list_view: 1 }
	];
}

function open_add_equipment_scope_dialog(frm) {
	frappe.prompt(
		[
			{
				fieldname: 'row_count',
				fieldtype: 'Int',
				label: __('How many equipment types?'),
				reqd: 1
			}
		],
		function(values) {
			build_add_equipment_scope_dialog(frm, values.row_count);
		},
		__('Add Equipment')
	);
}

function build_add_equipment_scope_dialog(frm, row_count) {
	let initial_rows = [];
	for (let i = 0; i < row_count; i++) {
		initial_rows.push({});
	}

	let d = new frappe.ui.Dialog({
		title: __('Add Equipment'),
		size: 'extra-large',
		fields: [
			{
				fieldname: 'rows',
				fieldtype: 'Table',
				label: __('Equipment'),
				cannot_add_rows: false,
				in_place_edit: false,
				data: initial_rows,
				get_data: function() { return initial_rows; },
				fields: [
					{ fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1, read_only: (cur_frm && cur_frm.doc.opportunity) ? 1 : 0, in_list_view: 1 },
					{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, read_only: (cur_frm && cur_frm.doc.opportunity) ? 1 : 0, in_list_view: 1 },
					{ fieldname: 'days_per_equipment', fieldtype: 'Float', label: __('Days per Equipment'), reqd: 1, in_list_view: 1 }
				]
			}
		],
		primary_action_label: __('Next: Add Roles'),
		primary_action: function() {
			let rows = d.get_value('rows') || [];
			if (!rows.length) {
				frappe.msgprint(__('Add at least one equipment row.'));
				return;
			}
			d.hide();
			collect_roles_then_create(frm, rows, 0, []);
		}
	});
	d.show();
}

function collect_roles_then_create(frm, rows, index, accumulated) {
	if (index >= rows.length) {
		frappe.call({
			method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_create_project_equipment_scope',
			args: { cost_budget: frm.doc.name, rows: accumulated },
			freeze: true,
			freeze_message: __('Creating equipment scope...'),
			callback: function(r) {
				frappe.show_alert({ message: __('{0} equipment rows created.', [(r.message || []).length]), indicator: 'green' });
				frm.reload_doc();
			}
		});
		return;
	}

	let current_row = rows[index];
	let d = new frappe.ui.Dialog({
		title: __('Roles for {0} ({1}/{2})', [current_row.equipment, index + 1, rows.length]),
		size: 'large',
		fields: [
			{
				fieldname: 'roles',
				fieldtype: 'Table',
				label: __('Roles'),
				cannot_add_rows: false,
				in_place_edit: false,
				data: [],
				get_data: function() { return []; },
				fields: build_roles_fields_grid()
			}
		],
		primary_action_label: index === rows.length - 1 ? __('Finish') : __('Next'),
		primary_action: function() {
			let roles = d.get_value('roles') || [];
			accumulated.push(Object.assign({}, current_row, { roles: roles }));
			d.hide();
			collect_roles_then_create(frm, rows, index + 1, accumulated);
		}
	});
	d.show();
}

function open_edit_equipment_scope_dialog(frm) {
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_equipment_scope_rows',
		args: { cost_budget: frm.doc.name },
		callback: function(r) {
			let rows = ((r.message || {}).rows || []).filter(row => row.docstatus === 0);
			if (!rows.length) {
				frappe.msgprint(__('No editable (draft) equipment rows to edit.'));
				return;
			}
			build_edit_equipment_scope_dialog(frm, rows);
		}
	});
}

function build_edit_equipment_scope_dialog(frm, rows) {
	let initial_rows = rows.map(row => ({
		name: row.name,
		equipment: row.equipment,
		quantity: row.quantity,
		days_per_equipment: row.days_per_equipment
	}));

	let original_names = rows.map(row => row.name);

	let d = new frappe.ui.Dialog({
		title: __('Edit Equipment'),
		size: 'extra-large',
		fields: [
			{
				fieldname: 'rows',
				fieldtype: 'Table',
				label: __('Equipment'),
				cannot_add_rows: true, cannot_delete_rows: !!(cur_frm && cur_frm.doc.opportunity),
				in_place_edit: false,
				data: initial_rows,
				get_data: function() { return initial_rows; },
				fields: [
					{ fieldname: 'name', fieldtype: 'Data', hidden: 1 },
					{ fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1, read_only: (cur_frm && cur_frm.doc.opportunity) ? 1 : 0, in_list_view: 1 },
					{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, read_only: (cur_frm && cur_frm.doc.opportunity) ? 1 : 0, in_list_view: 1 },
					{ fieldname: 'days_per_equipment', fieldtype: 'Float', label: __('Days per Equipment'), reqd: 1, in_list_view: 1 }
				]
			}
		],
		primary_action_label: __('Save'),
		primary_action: function() {
			let updated_rows = d.get_value('rows') || [];
			let remaining_names = updated_rows.map(r => r.name).filter(Boolean);
			let deleted_names = original_names.filter(n => !remaining_names.includes(n));

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_update_project_equipment_scope',
				args: { rows: updated_rows, deleted: deleted_names },
				freeze: true,
				freeze_message: __('Saving equipment...'),
				callback: function() {
					d.hide();
					frappe.show_alert({ message: __('Equipment updated.'), indicator: 'green' });
					frm.reload_doc();
				}
			});
		}
	});
	d.show();
}

window.open_equipment_scope_edit_single = function(name) {
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_equipment_scope_full',
		args: { name: name },
		callback: function(r) {
			let full_doc = r.message;
			if (!full_doc) return;

			let d = new frappe.ui.Dialog({
				title: __('Edit Equipment'),
				size: 'large',
				fields: [
					{ fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1, read_only: (cur_frm && cur_frm.doc.opportunity) ? 1 : 0, default: full_doc.equipment },
					{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, read_only: (cur_frm && cur_frm.doc.opportunity) ? 1 : 0, default: full_doc.quantity },
					{ fieldname: 'days_per_equipment', fieldtype: 'Float', label: __('Days per Equipment'), reqd: 1, default: full_doc.days_per_equipment },
					{
						fieldname: 'roles',
						fieldtype: 'Table',
						label: __('Roles'),
						cannot_add_rows: false,
						in_place_edit: false,
						data: full_doc.roles || [],
						get_data: function() { return full_doc.roles || []; },
						fields: build_roles_fields_grid()
					}
				],
				primary_action_label: __('Save'),
				primary_action: function(values) {
					frappe.call({
						method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.update_project_equipment_scope',
						args: { name: name, values: values },
						freeze: true,
						callback: function() {
							d.hide();
							frappe.show_alert({ message: __('Equipment updated.'), indicator: 'green' });
							_cost_budget_frm.reload_doc();
						}
					});
				},
				secondary_action_label: __('Delete'),
				secondary_action: function() {
					frappe.confirm(__('Delete this equipment row?'), function() {
						frappe.call({
							method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.delete_project_equipment_scope',
							args: { name: name },
							freeze: true,
							callback: function() {
								d.hide();
								frappe.show_alert({ message: __('Equipment deleted.'), indicator: 'green' });
								_cost_budget_frm.reload_doc();
							}
						});
					});
				}
			});
			d.show();
		}
	});
}

function pes_can_edit(frm) {
	return !frm.is_new() && frm.doc.docstatus === 0;
}

function pes_toolbar_html(frm) {
	let right = pes_can_edit(frm)
		? `<div>
			${frm.doc.opportunity
                                ? `<button class="btn btn-xs btn-primary" onclick="pes_open_days_wizard(); return false;">${__('Edit Days & Manpower')}</button>`
                                : `<button class="btn btn-xs btn-default" onclick="pes_open_edit(); return false;">${__('Edit Equipment')}</button>`}
			${frm.doc.opportunity ? '' : `<button class="btn btn-xs btn-primary" style="margin-left:6px;" onclick="pes_open_add(); return false;">${__('Add Equipment')}</button>`}
		</div>`
		: `<span class="text-muted" style="font-size:12px;">${__('Estimation is submitted. Cancel and Amend it to change equipment.')}</span>`;
	return `<div style="display:flex; justify-content:space-between; align-items:center; margin:4px 0 8px;">
		<span class="nx-section-title">${__('Equipment Scope')}</span>
		${right}
	</div>`;
}

function pes_empty_html(frm) {
	let btn = pes_can_edit(frm)
		? `<div style="margin-top:10px;">${frm.doc.opportunity ? '' : `<button class="btn btn-sm btn-primary" onclick="pes_open_add(); return false;">${__('Add Equipment')}</button>`}</div>`
		: '';
	return `<div class="text-muted" style="padding:16px; text-align:center; border:1px dashed var(--border-color, #e9ecef); border-radius:10px;">${__('No equipment added yet.')}${btn}</div>`;
}

window.pes_open_add = function() {
	if (_cost_budget_frm) open_add_equipment_scope_dialog(_cost_budget_frm);
};

window.pes_open_edit = function() {
	if (_cost_budget_frm) open_edit_equipment_scope_dialog(_cost_budget_frm);
};

function render_equipment_scope_summary(frm) {
	if (frm.is_new()) {
		frm.set_df_property('equipment_scope_summary_html', 'options', '');
		frm.refresh_field('equipment_scope_summary_html');
		return;
	}
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_equipment_scope_rows',
		args: { cost_budget: frm.doc.name },
		callback: function(r) {
			let data = r.message || {};
			frm.__pes_rows = (data.rows || []).filter(x => x.docstatus < 2);
			frm.__pes_trades = data.trade_columns || [];
			if (pes_can_edit(frm) && frm.perm && frm.perm[0] && frm.perm[0].write) {
				pes_sync_team_rates(frm);
				pes_recalculate(frm);
			} else {
				pes_render_table(frm);
			}
		}
	});
}

// ---------------------------------------------------------------------------
// Live estimation: same formulas and rounding as the server (project_estimation.py)
// ---------------------------------------------------------------------------

function pes_sync_team_rates(frm) {
	let trades = [];
	(frm.__pes_rows || []).forEach(s => Object.keys(s.role_counts || {}).forEach(t => { if (!trades.includes(t)) trades.push(t); }));
	let changed = false;
	(frm.doc.team_rates || []).slice().forEach(r => {
		if (!trades.includes(r.designation)) {
			frappe.model.clear_doc(r.doctype, r.name);
			changed = true;
		}
	});
	nexlify.sort_trades(trades).forEach(t => {
		if (!(frm.doc.team_rates || []).some(r => r.designation === t)) {
			frm.add_child('team_rates', { designation: t, factor: 2 });
			changed = true;
		}
	});
	(frm.doc.accommodation || []).slice().forEach(a => {
		if (!trades.includes(a.designation)) {
			frappe.model.clear_doc(a.doctype, a.name);
			changed = true;
		}
	});
	nexlify.sort_trades(trades).forEach(t => {
		if (!(frm.doc.accommodation || []).some(a => a.designation === t)) {
			frm.add_child('accommodation', { designation: t, persons: 1 });
			changed = true;
		}
	});
	if (changed) {
		nx_sort_trade_rows(frm, 'team_rates');
		frm.refresh_field('team_rates');
		nx_sort_trade_rows(frm, 'accommodation');
		frm.refresh_field('accommodation');
		frm.dirty();
	}
}

function pes_can_see_price(frm) {
	return !!(frm.perm && frm.perm[1] && frm.perm[1].read);
}

function pes_set_row(row, field, value) {
	if (flt(row[field], 2) !== flt(value, 2)) {
		frappe.model.set_value(row.doctype, row.name, field, value);
	}
}

function pes_set_doc(frm, field, value, precision) {
	let p = precision || 2;
	if (flt(frm.doc[field], p) !== flt(value, p)) {
		frm.set_value(field, value);
	}
}

function pes_monthly_asset(row) {
	if (row.ownership === 'Rented') return flt(row.monthly_rent);
	return cint(row.depreciation_months) > 0 ? flt(row.asset_value) / cint(row.depreciation_months) : 0;
}

function pes_crew_day_cost(scope_row, rates) {
	let rc = scope_row.role_counts || {};
	return Object.keys(rc).reduce((s, t) => s + flt(rc[t]) * flt(rates[t] || 0), 0);
}

function pes_recalculate(frm) {
	let d = frm.doc;
	if (d.docstatus === 0 && frm.perm && frm.perm[0] && frm.perm[0].write) {
		let wdm = cint(d.working_days_per_month) || 26;

		let rates = {};
		(d.team_rates || []).forEach(r => {
			let complete = flt(flt(r.basic_salary) * flt(r.factor), 2);
			let day = flt(complete / wdm, 2);
			pes_set_row(r, 'complete_salary', complete);
			pes_set_row(r, 'day_rate', day);
			if (r.designation) rates[r.designation] = day;
		});

		let months = flt(flt(d.total_work_days) / wdm, 4);
		pes_set_doc(frm, 'duration_months', months, precision('duration_months', frm.doc));

		let manpower = 0;
		(frm.__pes_rows || []).forEach(s => { manpower += flt(s.total_days) * pes_crew_day_cost(s, rates); });
		manpower = flt(manpower, 2);
		pes_set_doc(frm, 'manpower_cost', manpower);

		let acc_months = { 'Main City': 4, 'Outside Main City': 5 }[d.accommodation_basis] || 0;
		let salary_by = {};
		(d.team_rates || []).forEach(r => { salary_by[r.designation] = flt(r.basic_salary); });
		let acc = 0;
		(d.accommodation || []).forEach(a => {
			let monthly = acc_months ? flt(flt(salary_by[a.designation]) * acc_months / 12, 2) : flt(a.monthly_cost_per_person);
			if (acc_months) pes_set_row(a, 'monthly_cost_per_person', monthly);
			let cost = flt(cint(a.persons) * monthly * months, 2);
			pes_set_row(a, 'cost', cost);
			acc += cost;
		});

		let te = 0;
		(d.test_equipment || []).forEach(t => {
			let monthly = flt(pes_monthly_asset(t), 2);
			let cost = flt(monthly * months, 2);
			pes_set_row(t, 'monthly_cost', monthly);
			pes_set_row(t, 'cost', cost);
			te += cost;
		});

		let tr = 0;
		(d.transportation || []).forEach(v => {
			let monthly = flt(pes_monthly_asset(v), 2);
			let cost = flt(monthly * months, 2);
			pes_set_row(v, 'monthly_cost', monthly);
			pes_set_row(v, 'cost', cost);
			tr += cost;
		});

		let sp = 0;
		(d.supply || []).forEach(s => {
			let cost = s.is_cancelled ? 0 : flt(flt(s.rate) * flt(s.qty), 2);
			pes_set_row(s, 'cost', cost);
			sp += cost;
		});

		let oc = 0;
		(d.other_costs || []).forEach(o => { oc += flt(o.cost, 2); });

		pes_set_doc(frm, 'accommodation_total', flt(acc, 2));
		pes_set_doc(frm, 'test_equipment_total', flt(te, 2));
		pes_set_doc(frm, 'transportation_total', flt(tr + flt(d.fuel_maintenance_total), 2));
		pes_set_doc(frm, 'supply_total', flt(sp, 2));
		pes_set_doc(frm, 'other_costs_table_total', flt(oc, 2));

		let other = flt(acc + te + tr + flt(d.fuel_maintenance_total) + sp + oc, 2);
		pes_set_doc(frm, 'other_cost_total', other);
		let total = flt(manpower + other, 2);
		pes_set_doc(frm, 'total_cost', total);

		if (pes_can_see_price(frm)) {
			let margin = flt(total * flt(d.margin_percentage) / 100, 2);
			let price = flt(total + margin, 2);
			pes_set_doc(frm, 'margin_amount', margin);
			pes_set_doc(frm, 'total_price', price);
			pes_set_doc(frm, 'price_per_day', flt(d.total_work_days) ? flt(price / flt(d.total_work_days), 2) : 0);
		}
	}
	pes_render_table(frm);
}

function pes_render_table(frm) {
	let rows = frm.__pes_rows || [];
	let spacer = '<div style="height:18px;"></div>';
	if (!rows.length) {
		frm.set_df_property('equipment_scope_summary_html', 'options', pes_empty_html(frm) + spacer);
		frm.refresh_field('equipment_scope_summary_html');
		pes_render_summary(frm);
		return;
	}

	let trades = frm.__pes_trades || [];
	let rates = {};
	(frm.doc.team_rates || []).forEach(r => { if (r.designation) rates[r.designation] = flt(r.day_rate); });
	let show_price = pes_can_see_price(frm);
	let manpower = flt(frm.doc.manpower_cost);
	let total_price = flt(frm.doc.total_price);
	let money = v => format_currency(flt(v, 2), frm.doc.currency, 0);
	let esc = v => frappe.utils.escape_html(v || '');

	let sum_days = 0, sum_cost = 0, sum_price = 0;
	let rows_html = rows.map(row => {
		let rc = row.role_counts || {};
		let missing = Object.keys(rc).filter(t => !flt(rates[t]));
		let cost = flt(row.total_days) * pes_crew_day_cost(row, rates);
		let row_price = manpower ? total_price * cost / manpower : 0;
		let unit = flt(row.quantity) ? row_price / flt(row.quantity) : 0;
		sum_days += flt(row.total_days);
		sum_cost += cost;
		sum_price += row_price;

		let trade_cells = nexlify.sort_trades(trades).map(t => `<td class="nx-c">${rc[t] ? `<span class="nx-role">${rc[t]}</span>` : '<span class="nx-dash">—</span>'}</td>`).join('');
		let cost_cell = missing.length
			? `<span class="nx-norate" title="${esc(missing.join(', '))}">${__('No rate')}</span>`
			: money(cost);
		let status = row.docstatus === 1
			? `<span class="nx-status submitted">${__('Submitted')}</span>`
			: `<span class="nx-status draft">${__('Draft')}</span>`;
		let edit_btn = row.docstatus === 0
			? `<button class="btn btn-xs btn-default" onclick="open_equipment_scope_edit_single('${row.name}'); return false;">${__('Edit')}</button>`
			: '';

		return `<tr>
			<td class="nx-eq">${esc(row.equipment)}</td>
			<td class="nx-num">${format_number(row.quantity)}</td>
			<td class="nx-num">${format_number(row.days_per_equipment)}</td>
			${trade_cells}
			<td class="nx-num">${format_number(flt(row.total_days, 2))}</td>
			<td class="nx-num">${cost_cell}</td>
			${show_price ? `<td class="nx-num">${money(unit)}</td><td class="nx-num nx-price">${money(row_price)}</td>` : ''}
			<td class="nx-c">${status}</td>
			<td><div class="nx-actions">${edit_btn}<a class="btn btn-xs btn-default" href="/app/project-equipment-scope/${row.name}" target="_blank">${__('Details')}</a></div></td>
		</tr>`;
	}).join('');

	let price_heads = show_price ? `<th class="nx-num">${__('Unit Price')}</th><th class="nx-num">${__('Total Price')}</th>` : '';
	let price_foot = show_price ? `<td></td><td class="nx-num">${money(sum_price)}</td>` : '';

	let html = `
		<div class="nx-scope-card"><div class="nx-scope-scroll">
			<table class="nx-scope-table">
				<thead><tr>
					<th>${__('Equipment')}</th><th class="nx-num">${__('Qty')}</th><th class="nx-num">${__('Days/Unit')}</th>
					${nexlify.sort_trades(trades).map(t => `<th class="nx-c">${esc(t)}</th>`).join('')}
					<th class="nx-num">${__('Total Days')}</th><th class="nx-num">${__('Total Cost')}</th>
					${price_heads}
					<th class="nx-c">${__('Status')}</th><th></th>
				</tr></thead>
				<tbody>${rows_html}</tbody>
				<tfoot><tr>
					<td colspan="${3 + trades.length}" class="nx-num">${__('Total')}</td>
					<td class="nx-num">${format_number(flt(sum_days, 2))}</td>
					<td class="nx-num">${money(sum_cost)}</td>
					${price_foot}
					<td colspan="2"></td>
				</tr></tfoot>
			</table>
		</div></div>
	`;

	frm.set_df_property('equipment_scope_summary_html', 'options', pes_toolbar_html(frm) + html + spacer);
	frm.refresh_field('equipment_scope_summary_html');
	pes_render_summary(frm);
}

// Live triggers
frappe.ui.form.on('Project Estimation', {
	working_days_per_month: function(frm) { pes_recalculate(frm); },
	margin_percentage: function(frm) { pes_recalculate(frm); },
	fuel_maintenance_total: function(frm) { pes_recalculate(frm); },
	accommodation_basis: function(frm) { frm.refresh_field('accommodation'); pes_recalculate(frm); },
	team_rates_remove: function(frm) { pes_recalculate(frm); },
	accommodation_remove: function(frm) { pes_recalculate(frm); },
	test_equipment_remove: function(frm) { pes_recalculate(frm); },
	transportation_remove: function(frm) { pes_recalculate(frm); },
	supply_remove: function(frm) { pes_recalculate(frm); },
	other_costs_remove: function(frm) { pes_recalculate(frm); }
});

function pes_row_changed(frm) { pes_recalculate(frm); }

frappe.ui.form.on('Project Estimation Rate', {
	designation: pes_row_changed, basic_salary: pes_row_changed, factor: pes_row_changed
});
frappe.ui.form.on('Project Estimation Accommodation', {
	persons: pes_row_changed, monthly_cost_per_person: pes_row_changed
});
frappe.ui.form.on('Project Estimation Test Equipment', {
	ownership: pes_row_changed, asset_value: pes_row_changed, depreciation_months: pes_row_changed, monthly_rent: pes_row_changed
});
frappe.ui.form.on('Project Estimation Transportation', {
	ownership: pes_row_changed, asset_value: pes_row_changed, depreciation_months: pes_row_changed,
	monthly_rent: pes_row_changed
});
frappe.ui.form.on('Project Estimation Other Cost', {
	cost: pes_row_changed, budget_category: pes_row_changed, description: pes_row_changed
});

// ---------------------------------------------------------------------------
// Cost & Price Summary (live, same values as the saved fields)
// ---------------------------------------------------------------------------

function pes_render_summary(frm) {
	let kpi = frm.fields_dict.pricing_kpis_html;
	let box = frm.fields_dict.cost_summary_html;
	if (!kpi || !box) return;
	if (frm.is_new()) {
		kpi.$wrapper.html('');
		box.$wrapper.html('');
		return;
	}

	let d = frm.doc;
	let money = v => format_currency(flt(v, 2), d.currency, 2);
	let esc = v => frappe.utils.escape_html(v || '');
	let total = flt(d.total_cost);
	let days = flt(d.total_work_days);
	let show_price = pes_can_see_price(frm);
	let pct = v => total ? flt(flt(v) / total * 100, 1) : 0;

	// ---- Price and KPIs (right) ----
	let hero = '';
	if (show_price) {
		let price = flt(d.total_price);
		let cost_share = price ? Math.min(100, Math.max(0, total / price * 100)) : 0;
		hero = `<div class="nx-hero">
			<div class="nx-hero-label">${__('Total Price')}</div>
			<div class="nx-hero-value">${money(price)}</div>
			<div class="nx-hero-sub">${money(d.price_per_day)} ${__('per team day')}</div>
			${price ? `<div class="nx-split">
					<div class="nx-split-cost" style="width:${cost_share}%"></div>
					<div class="nx-split-margin" style="width:${100 - cost_share}%"></div>
				</div>
				<div class="nx-split-legend">
					<span><i class="nx-dot cost"></i>${__('Cost')} ${flt(cost_share, 1)}%</span>
					<span><i class="nx-dot margin"></i>${__('Margin')} ${flt(100 - cost_share, 1)}%</span>
				</div>` : ''}
		</div>`;
	}
	let tile = (cls, label, value, sub) => `<div class="nx-kpi ${cls}">
		<div class="nx-kpi-label">${label}</div>
		<div class="nx-kpi-value">${value}</div>
		${sub ? `<div class="nx-kpi-sub">${sub}</div>` : ''}
	</div>`;
	let tiles = [tile('is-cost', __('Total Cost'), money(total), days ? `${money(total / days)} ${__('per team day')}` : '')];
	if (show_price) {
		tiles.push(tile('is-margin', __('Margin'), money(d.margin_amount), `${flt(d.margin_percentage, 2)}% ${__('of cost')}`));
	}
	tiles.push(tile('is-time', __('Duration'), `${flt(days, 2)} ${__('days')}`, `${flt(d.duration_months, 2)} ${__('months')}`));
	kpi.$wrapper.html(`<div class="nx-sum-right">${hero}<div class="nx-kpi-grid">${tiles.join('')}</div></div>`);

	// ---- Cost breakdown (left) ----
	let items = [
		[__('Accommodation'), d.accommodation_total],
		[__('Test Equipment'), d.test_equipment_total],
		[__('Car & Fuels'), d.transportation_total],
		[__('Supply'), d.supply_total],
	];
	let by_cat = {};
	let cat_order = [];
	(d.other_costs || []).forEach(o => {
		let key = o.budget_category || __('Uncategorized');
		if (!(key in by_cat)) { by_cat[key] = 0; cat_order.push(key); }
		by_cat[key] += flt(o.cost);
	});
	cat_order.forEach(k => items.push([esc(k), by_cat[k]]));

	let bar = (v, cls) => `<div class="nx-pct"><span>${pct(v)}%</span>
		<div class="nx-bar"><div class="nx-bar-fill ${cls}" style="width:${Math.min(100, Math.max(0, pct(v)))}%"></div></div></div>`;
	let line = (label, value, dot, row_cls) => `<tr class="${row_cls}">
		<td>${dot ? `<i class="nx-dot ${dot}"></i>` : ''}${label}</td>
		<td class="nx-num">${money(value)}</td>
		<td class="nx-num">${bar(value, dot || 'sub')}</td>
	</tr>`;

	let rows = [];
	rows.push(line(__('Manpower Cost'), d.manpower_cost, 'manpower', 'is-group'));
	rows.push(line(__('Other Costs'), d.other_cost_total, 'other', 'is-group'));
	items.filter(x => flt(x[1])).forEach(x => rows.push(line(x[0], x[1], '', 'is-sub')));

	box.$wrapper.html(`<div class="nx-sum-card">
		<div class="nx-sum-head">
			<div class="nx-sum-title">${__('Cost Breakdown')}</div>
			<div class="nx-sum-total">${money(total)}</div>
		</div>
		<table class="nx-sum-table">
			<thead><tr><th>${__('Item')}</th><th class="nx-num">${__('Amount')}</th><th class="nx-num">${__('% of Cost')}</th></tr></thead>
			<tbody>${rows.join('')}</tbody>
			<tfoot><tr><td>${__('Total Cost')}</td><td class="nx-num">${money(total)}</td><td class="nx-num">100%</td></tr></tfoot>
		</table>
	</div>`);
}

// Totals under each Execution Estimation table: half width, in the second column
function pes_inject_total_styles() {
	if (document.getElementById('pes-total-styles')) return;
	let style = document.createElement('style');
	style.id = 'pes-total-styles';
	style.innerHTML = `
		.frappe-control[data-fieldname="manpower_cost"],
		.frappe-control[data-fieldname="accommodation_total"],
		.frappe-control[data-fieldname="test_equipment_total"],
		.frappe-control[data-fieldname="transportation_total"],
		.frappe-control[data-fieldname="supply_total"],
		.frappe-control[data-fieldname="other_costs_table_total"] {
			width: 50%;
			margin-inline-start: auto;
			margin-top: 8px;
		}
		.frappe-control[data-fieldname="fuel_maintenance_total"] {
			width: 50%;
			margin-top: 8px;
		}
		@media (max-width: 768px) {
			.frappe-control[data-fieldname="manpower_cost"],
			.frappe-control[data-fieldname="accommodation_total"],
			.frappe-control[data-fieldname="test_equipment_total"],
			.frappe-control[data-fieldname="transportation_total"],
			.frappe-control[data-fieldname="supply_total"],
			.frappe-control[data-fieldname="other_costs_table_total"] {
				width: 100%;
			}
		}
	`;
	document.head.appendChild(style);
}

frappe.ui.form.on('Project Estimation', {
	refresh: function() { pes_inject_total_styles(); }
});

// Estimation Date / Currency: take the exchange rate again (draft only)
frappe.ui.form.on('Project Estimation', {
	estimation_date(frm) { nexlify_refresh_estimation_rate(frm); },
	currency(frm) { nexlify_refresh_estimation_rate(frm); },
});

function nexlify_refresh_estimation_rate(frm) {
	if (frm.doc.docstatus !== 0 || !frm.doc.company || !frm.doc.currency) return;
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.opportunity_rfq.get_estimation_rate',
		args: { company: frm.doc.company, currency: frm.doc.currency,
			date: frm.doc.estimation_date, opportunity: frm.doc.opportunity },
		callback(r) { if (r.message) frm.set_value('conversion_rate', r.message); },
	});
}

// RFQ section: the Opportunity's RFQ Items, read from the Opportunity
frappe.ui.form.on('Project Estimation', {
	refresh(frm) { nexlify_render_rfq_view(frm); },
});

function nexlify_render_rfq_view(frm) {
	const field = frm.get_field('rfq_html');
	if (!field || !frm.doc.opportunity || frm.is_new()) return;
	nexlify_rfq_styles();
	const esc = frappe.utils.escape_html;
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.opportunity_rfq.get_rfq_for_estimation',
		args: { estimation: frm.doc.name },
		callback(r) {
			const d = r.message || {};
			const rows = d.rows || [];
			const sub = [d.customer, d.opportunity_name].filter(Boolean).map(esc).join(' · ');
			const items = d.meta || [];
			const meta = items.length ? `<div class="nx-rfq-meta">${items.map(m => `<div>
				<div class="nx-meta-label">${esc(m[0])}</div><div class="nx-meta-value">${m[1] ? esc(m[1]) : '—'}</div></div>`).join('')}</div>` : '';
			const body = rows.map((x, i) => `<tr>
				<td class="nx-idx">${i + 1}</td>
				<td>${esc(x.equipment || '')}</td>
				<td class="nx-num">${format_number(x.quantity)}</td>
				<td class="nx-desc">${esc(x.description || '')}</td></tr>`).join('');
			field.$wrapper.html(`<div class="nx-rfq-card nx-accent">
				<div class="nx-rfq-head">
					<div><div class="nx-rfq-title">${__('RFQ from Opportunity {0}', [esc(d.opportunity || '')])}</div>
						<div class="nx-rfq-sub">${sub}</div></div>
					${meta}
					<div class="nx-rfq-right"><span class="nx-pill blue">${__('{0} items', [rows.length])}</span></div>
				</div>
				${rows.length ? `<div class="nx-rfq-scroll"><table class="nx-rfq-table">
					<thead><tr><th class="nx-idx">#</th><th>${__('Equipment Scope')}</th><th class="nx-num">${__('Qty')}</th><th>${__('Description')}</th></tr></thead>
					<tbody>${body}</tbody></table></div>`
					: `<div class="nx-empty"><b>${__('No RFQ Items')}</b></div>`}
			</div>`);
		},
	});
}

function nexlify_rfq_styles() {
	if (document.getElementById('nx-rfq-styles')) return;
	const s = document.createElement('style');
	s.id = 'nx-rfq-styles';
	s.innerHTML = `
		.nx-rfq-card { border:1px solid var(--border-color); border-radius:10px; overflow:hidden; background:var(--card-bg, var(--fg-color)); margin-top:6px; }
		.nx-rfq-head { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;
			padding:12px 16px; border-bottom:1px solid var(--border-color); background:var(--control-bg); }
		.nx-rfq-title { font-weight:600; font-size:13px; color:var(--text-color); }
		.nx-rfq-sub { font-size:11.5px; color:var(--text-muted); margin-top:2px; }
		.nx-rfq-right { display:flex; align-items:center; gap:12px; }
		.nx-pill { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:600; white-space:nowrap; }
		.nx-pill.green { background:var(--green-100, #e6f4ea); color:var(--green-700, #1e7e34); }
		.nx-pill.orange { background:var(--orange-100, #fff4e5); color:var(--orange-700, #b25e09); }
		.nx-pill.gray { background:var(--gray-100, #f1f3f5); color:var(--gray-700, #495057); }
		.nx-total { font-size:18px; font-weight:700; color:var(--text-color); font-variant-numeric:tabular-nums; }
		.nx-rfq-scroll { overflow-x:auto; }
		.nx-rfq-table { width:100%; border-collapse:collapse; font-size:12.5px; }
		.nx-rfq-table th { text-align:left; padding:8px 16px; font-size:10.5px; text-transform:uppercase; letter-spacing:.3px;
			color:var(--text-muted); border-bottom:1px solid var(--border-color); white-space:nowrap; font-weight:600; }
		.nx-rfq-table td { padding:10px 16px; border-bottom:1px solid var(--border-color); vertical-align:top; color:var(--text-color); }
		.nx-rfq-table tbody tr:last-child td { border-bottom:none; }
		.nx-rfq-table tbody tr:hover td { background:var(--control-bg); }
		.nx-rfq-table tfoot td { background:var(--control-bg); font-weight:700; border-top:1px solid var(--border-color); border-bottom:none; }
		.nx-num { text-align:right !important; white-space:nowrap; font-variant-numeric:tabular-nums; }
		.nx-idx { color:var(--text-muted); width:40px; }
		.nx-desc { color:var(--text-muted); white-space:pre-wrap; min-width:180px; }
		.nx-empty { padding:28px 16px; text-align:center; color:var(--text-muted); font-size:12.5px; }
		.nx-empty b { display:block; color:var(--text-color); font-size:13px; margin-bottom:4px; }
		.nx-rfq-meta { display:flex; gap:32px; flex-wrap:wrap; flex:1; justify-content:center; }
		.nx-meta-label { font-size:10px; text-transform:uppercase; letter-spacing:.3px; color:var(--text-muted); }
		.nx-meta-value { font-size:12.5px; font-weight:600; color:var(--text-color); margin-top:1px; }
		.nx-rfq-card.nx-accent { border-left:3px solid var(--blue-500, #3b82f6); }
		.nx-rfq-card.nx-accent .nx-rfq-head { background:rgba(59, 130, 246, 0.08); border-bottom-color:rgba(59, 130, 246, 0.25); }
		.nx-rfq-card.nx-accent .nx-rfq-title { color:var(--blue-600, #2563eb); }
		.nx-rfq-card.nx-accent .nx-rfq-table th { color:var(--blue-600, #2563eb); opacity:.8; }
		.nx-pill.blue { background:rgba(59, 130, 246, 0.14); color:var(--blue-700, #1d4ed8); }
		[data-theme="dark"] .nx-rfq-card.nx-accent .nx-rfq-head { background:rgba(96, 165, 250, 0.12); }
		[data-theme="dark"] .nx-rfq-card.nx-accent .nx-rfq-title,
		[data-theme="dark"] .nx-rfq-card.nx-accent .nx-rfq-table th,
		[data-theme="dark"] .nx-pill.blue { color:#93c5fd; }
	`;
	document.head.appendChild(s);
}

// Days & Manpower wizard (Estimations from an Opportunity): the Edit Equipment dialog, one equipment after the other
window.pes_open_days_wizard = function() {
	open_days_manpower_wizard(_cost_budget_frm || cur_frm);
};

function open_days_manpower_wizard(frm) {
	const M = 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.';
	frappe.xcall(M + 'get_project_equipment_scope_rows', { cost_budget: frm.doc.name }).then(r => {
		const names = ((r && r.rows) || []).filter(x => x.docstatus === 0).map(x => x.name);
		if (!names.length) {
			frappe.msgprint(__('There is no draft equipment to update.'));
			return;
		}
		Promise.all(names.map(n => frappe.xcall(M + 'get_project_equipment_scope_full', { name: n }))).then(docs => {
			const steps = docs.map((doc, i) => ({
				name: names[i],
				values: {
					equipment: doc.equipment,
					quantity: doc.quantity,
					days_per_equipment: doc.days_per_equipment,
					roles: (doc.roles || []).map(x => ({ trade: x.trade, count: x.count })),
				},
			}));
			wizard_days_screen(frm, steps);
		});
	});
}

function wizard_edit_step(frm, steps, index) {
	const step = steps[index];
	const v = step.values;
	const last = index === steps.length - 1;
	const roles = (v.roles || []).map(x => Object.assign({}, x));
	const read = (dlg) => {
		const vals = dlg.get_values(true) || {};
		return Object.assign({}, v, vals, {
			equipment: v.equipment,
			quantity: v.quantity,
			roles: (dlg.get_value('roles') || []).filter(x => x.trade).map(x => ({ trade: x.trade, count: cint(x.count) })),
		});
	};

	const d = new frappe.ui.Dialog({
		title: __('Edit Equipment') + ` (${index + 1} ${__('of')} ${steps.length})`,
		size: 'large',
		fields: [
			{ fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1, read_only: 1, default: v.equipment },
			{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, read_only: 1, default: v.quantity },
			{ fieldname: 'days_per_equipment', fieldtype: 'Float', label: __('Days per Equipment'), reqd: 1, default: v.days_per_equipment },
			{
				fieldname: 'roles',
				fieldtype: 'Table',
				label: __('Roles'),
				cannot_add_rows: false,
				in_place_edit: false,
				data: roles,
				get_data: function() { return roles; },
				fields: build_roles_fields_grid()
			}
		],
		primary_action_label: last ? __('Save') : __('Next'),
		primary_action: function() {
			const vals = read(d);
			if (!(flt(vals.days_per_equipment) > 0)) {
				frappe.msgprint({ title: __('Days required'), indicator: 'red',
					message: __('Set the Days per Equipment above zero for {0}.', [v.equipment]) });
				return;
			}
			if (!vals.roles.some(x => x.count > 0)) {
				frappe.msgprint({ title: __('Roles required'), indicator: 'red',
					message: __('Add at least one role with a count for {0}.', [v.equipment]) });
				return;
			}
			step.values = vals;
			d.hide();
			if (last) wizard_save(frm, steps);
			else wizard_edit_step(frm, steps, index + 1);
		},
		secondary_action_label: __('Back'),
		secondary_action: function() {
			step.values = read(d);
			d.hide();
			if (index === 0) wizard_days_screen(frm, steps);
			else wizard_edit_step(frm, steps, index - 1);
		}
	});
	d.show();
}

async function wizard_save(frm, steps) {
	frappe.dom.freeze(__('Saving...'));
	try {
		for (const step of steps) {
			await frappe.xcall('nexlify_budget_control.nexlify_budget_control.budget_enforcement.update_project_equipment_scope',
				{ name: step.name, values: step.values });
		}
		frappe.show_alert({ message: __('{0} equipment updated.', [steps.length]), indicator: 'green' });
	} finally {
		frappe.dom.unfreeze();
		frm.reload_doc();
	}
}

function wizard_days_screen(frm, steps) {
	const data = steps.map((s, i) => ({ step: i, equipment: s.values.equipment, quantity: s.values.quantity,
		days_per_equipment: s.values.days_per_equipment }));
	const d = new frappe.ui.Dialog({
		title: __('Days per Equipment'),
		size: 'large',
		fields: [
			{
				fieldname: 'rows', fieldtype: 'Table', label: __('Equipment'),
				cannot_add_rows: true, cannot_delete_rows: true, in_place_edit: true,
				data: data, get_data: () => data,
				fields: [
					{ fieldname: 'step', fieldtype: 'Int', hidden: 1 },
					{ fieldname: 'equipment', fieldtype: 'Data', label: __('Equipment'), read_only: 1, in_list_view: 1, columns: 5 },
					{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), read_only: 1, in_list_view: 1, columns: 2 },
					{ fieldname: 'days_per_equipment', fieldtype: 'Float', label: __('Days per Equipment'), reqd: 1, in_list_view: 1, columns: 3 },
				],
			},
		],
		primary_action_label: __('Next'),
		primary_action: function() {
			const rows = d.get_value('rows') || [];
			const missing = rows.filter(x => !(flt(x.days_per_equipment) > 0)).map(x => x.equipment);
			if (missing.length) {
				frappe.msgprint({ title: __('Days required'), indicator: 'red',
					message: __('Set the Days per Equipment above zero for: {0}', [missing.join(', ')]) });
				return;
			}
			rows.forEach(x => {
				if (steps[x.step]) steps[x.step].values.days_per_equipment = flt(x.days_per_equipment);
			});
			d.hide();
			wizard_edit_step(frm, steps, 0);
		},
	});
	d.show();
}

function nx_sort_trade_rows(frm, table) {
	const rows = frm.doc[table] || [];
	const sorted = nexlify.sort_trades(rows, 'designation');
	sorted.forEach((r, i) => { r.idx = i + 1; });
	frm.doc[table] = sorted;
}

// Supply: a Supply Chain line is priced by its quotation, so a new item or quantity is quoted again;
// a Manual line keeps the rate the estimator typed. Changing the source starts the price over.
frappe.ui.form.on('Project Estimation Supply', {
	item_code: pes_supply_changed,
	qty: pes_supply_changed,
	price_source(frm, cdt, cdn) {
		frappe.model.set_value(cdt, cdn, { rate: 0, supplier_quotation: '' });
		pes_recalculate(frm);
	},
	rate(frm) {
		pes_recalculate(frm);
	},
});

function pes_supply_changed(frm, cdt, cdn) {
	let row = locals[cdt][cdn];
	let manual = row.price_source === 'Manual';
	if (row.supplier_quotation || (!manual && flt(row.rate))) {
		frappe.model.set_value(cdt, cdn, manual ? { supplier_quotation: '' } : { rate: 0, supplier_quotation: '' });
	}
	pes_recalculate(frm);
}

// Supply Chain: a message on top while lines wait or are not sent yet, and the Send button under the Supply table.
frappe.ui.form.on('Project Estimation', {
	refresh(frm) {
		pes_supply_chain(frm);
	},
});

function pes_supply_to_send(frm, pending) {
	return (frm.doc.supply || []).filter(r => !r.is_cancelled && r.price_source !== 'Manual' && !r.supplier_quotation && !pending.includes(r.supply_request));
}

function pes_supply_chain(frm) {
	const grid = frm.fields_dict.supply && frm.fields_dict.supply.grid;
	const label = __('Send to Supply Chain');
	if (grid && grid.custom_buttons && grid.custom_buttons[label]) grid.custom_buttons[label].addClass('hidden');
	if (frm.is_new()) return;
	frappe.db.get_list('Supply Request', { filters: { estimation: frm.doc.name, status: 'Pending' }, fields: ['name'] }).then(rows => {
		const pending = rows.map(r => r.name);
		const to_send = pes_supply_to_send(frm, pending);
		if (pending.length) {
			const links = pending.map(n => `<a href="/app/supply-request/${encodeURIComponent(n)}">${frappe.utils.escape_html(n)}</a>`);
			frm.set_intro(__('Supply: waiting for the Supply Chain to price {0}.', [links.join(', ')]), 'orange');
		} else if (to_send.length) {
			frm.set_intro(__('Supply: {0} items are not sent to the Supply Chain yet.', [to_send.length]), 'blue');
		}
		if (!grid || !to_send.length || frm.doc.docstatus !== 0 || !(frm.perm[0] && frm.perm[0].write)) return;
		grid.add_custom_button(label, () => {
			const items = pes_supply_to_send(frm, pending);
			if (frm.is_dirty()) {
				frappe.msgprint(__('Save the Estimation first.'));
				return;
			}
			frappe.confirm(__('Send {0} Supply items to the Supply Chain for pricing?', [items.length]), () => {
				frappe.xcall('nexlify_budget_control.nexlify_budget_control.supply_chain.send_to_supply_chain', { estimation: frm.doc.name })
					.then(name => {
						frappe.show_alert({ message: __('Sent: {0}', [name]), indicator: 'green' });
						frm.reload_doc();
					});
			});
		});
		pes_place_supply_buttons(frm);
	});
}

// Supply summary, right above the Supply table: how many lines are Priced, Waiting, Not Sent and Manual.
frappe.ui.form.on('Project Estimation', {
	refresh: pes_supply_summary,
	supply_add: pes_supply_summary,
	supply_remove: pes_supply_summary,
});

frappe.ui.form.on('Project Estimation Supply', {
	price_source: frm => pes_supply_summary(frm),
	is_cancelled(frm) {
		pes_recalculate(frm);
		pes_supply_summary(frm);
	},
});

function pes_supply_summary(frm) {
	const grid = frm.fields_dict.supply && frm.fields_dict.supply.grid;
	if (!grid) return;
	grid.wrapper.find('.pes-supply-summary').remove();
	const rows = frm.doc.supply || [];
	if (!rows.length) return;
	const status = r => r.is_cancelled ? 'Cancelled' : (r.price_source === 'Manual' ? 'Manual' : (r.supply_status || 'Not Sent'));
	const by = {};
	rows.forEach(r => (by[status(r)] = by[status(r)] || []).push(r));
	const n = k => (by[k] || []).length;
	const esc = frappe.utils.escape_html;
	let kind, title;
	if (n('Waiting')) {
		const reqs = [...new Set(by['Waiting'].map(r => r.supply_request).filter(Boolean))]
			.map(x => `<a href="/app/supply-request/${encodeURIComponent(x)}">${esc(x)}</a>`).join(', ');
		kind = 'warning';
		title = __('Waiting for the Supply Chain to send the prices of {0} items ({1}).', [n('Waiting'), reqs]);
		if (n('Not Sent')) title += ' ' + __('{0} more items are not sent yet.', [n('Not Sent')]);
	} else if (n('Not Sent')) {
		kind = 'danger';
		title = __('{0} items are not sent to the Supply Chain yet. Use Send to Supply Chain under the table.', [n('Not Sent')]);
	} else {
		kind = 'success';
		title = __('All Supply items are priced.');
	}
	const parts = [['Priced', n('Priced')], ['Waiting', n('Waiting')], ['Not Sent', n('Not Sent')], ['Manual', n('Manual')], ['Cancelled', n('Cancelled')]]
		.filter(p => p[1]).map(p => `${__(p[0])}: <b>${p[1]}</b>`).join(' &nbsp;·&nbsp; ');
	$(`<div class="pes-supply-summary alert alert-${kind}" style="margin:0 0 10px;padding:10px 14px">
		<div style="font-size:14px;font-weight:600">${title}</div>
		<div style="font-size:12px;margin-top:4px">${parts}</div>
	</div>`).prependTo(grid.wrapper);
}

// Supply line Actions: the menu of what can be done on one line.
const PES_SUPPLY = 'nexlify_budget_control.nexlify_budget_control.supply_chain.';

frappe.ui.form.on('Project Estimation Supply', {
	line_actions: pes_supply_line_actions,
});

function pes_supply_call(frm, method, args, dialog) {
	return frappe.xcall(PES_SUPPLY + method, Object.assign({ estimation: frm.doc.name }, args)).then(() => {
		if (dialog) dialog.hide();
		frm.reload_doc();
	});
}

function pes_supply_line_actions(frm, cdt, cdn) {
	const row = locals[cdt][cdn];
	if (frm.is_dirty() || row.__islocal) {
		frappe.msgprint(__('Save the Estimation first.'));
		return;
	}
	const manual = row.price_source === 'Manual';
	const status = row.is_cancelled ? 'Cancelled' : (manual ? 'Manual' : (row.supply_status || 'Not Sent'));
	const editable = frm.doc.docstatus === 0 && frm.perm[0] && frm.perm[0].write;
	const live = !row.is_cancelled;
	const actions = [];
	const add = (value, label, ok) => { if (ok) actions.push({ value, label }); };
	if (editable) {
		add('restore', __('Restore Line'), row.is_cancelled);
		add('send_line', __('Send This Line to the Supply Chain'), live && !manual && status === 'Not Sent');
		add('quote_again', __('Quote Again (clear the price and send it again)'), live && status === 'Priced');
		add('to_manual', __('Switch to Manual (type the rate yourself)'), live && !manual && status !== 'Waiting');
		add('to_supply_chain', __('Switch to Supply Chain (get a quotation)'), live && manual);
		add('cancel', __('Cancel Line (it stays, its cost is 0)'), live);
	}
	add('open_quotation', __('Open Supplier Quotation {0}', [row.supplier_quotation]), !!row.supplier_quotation);
	add('open_request', __('Open Supply Request {0}', [row.supply_request]), !!row.supply_request);
	if (!actions.length) {
		frappe.msgprint(__('Nothing to do on this line.'));
		return;
	}
	const d = new frappe.ui.Dialog({
		title: __('Supply Line {0}: {1}', [row.idx, row.item_code]),
		fields: [
			{ fieldtype: 'Data', label: __('Status'), default: __(status), read_only: 1 },
			{ fieldtype: 'Data', label: __('Rate'), default: format_currency(row.rate, frm.doc.currency), read_only: 1 },
			{ fieldtype: 'Select', fieldname: 'action', label: __('What do you want to do?'), reqd: 1,
				options: actions, default: actions[0].value },
		],
		primary_action_label: __('Go'),
		primary_action(values) {
			if (values.action === 'open_quotation' || values.action === 'open_request') {
				d.hide();
				frappe.set_route('Form', values.action === 'open_quotation' ? 'Supplier Quotation' : 'Supply Request',
					values.action === 'open_quotation' ? row.supplier_quotation : row.supply_request);
				return;
			}
			if (values.action === 'send_line') {
				pes_supply_call(frm, 'send_to_supply_chain', { rows: [row.name] }, d);
				return;
			}
			pes_supply_call(frm, 'supply_line_action', { row: row.name, action: values.action }, d);
		},
	});
	d.show();
}

// Send to Supply Chain sits on the right of the Supply table's button bar (Add row stays left).
function pes_place_supply_buttons(frm) {
	const grid = frm.fields_dict.supply && frm.fields_dict.supply.grid;
	if (!grid || !grid.custom_buttons) return;
	const bar = grid.grid_buttons || grid.wrapper.find('.grid-buttons');
	bar.css({ display: 'flex', flex: '1', 'align-items': 'center', gap: '6px' });
	let right = bar.find('.pes-grid-right');
	if (!right.length) {
		right = $('<div class="pes-grid-right" style="margin-inline-start:auto;display:flex;gap:6px"></div>').appendTo(bar);
	}
	[[__('Send to Supply Chain'), 1]].forEach(([label, order]) => {
		const $btn = grid.custom_buttons[label];
		if ($btn && !$btn.parent().is(right)) $btn.css('order', order).appendTo(right);
	});
}
