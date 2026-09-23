// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on("Project Cost Budget", {
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
		frm.ignore_doctypes_on_cancel_all = ['Project Equipment Scope'];
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
		{ fieldname: 'trade', fieldtype: 'Link', options: 'Designation', label: __('Trade'), reqd: 1, in_list_view: 1 },
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
					{ fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1, in_list_view: 1 },
					{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, in_list_view: 1 },
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
				cannot_add_rows: true,
				in_place_edit: false,
				data: initial_rows,
				get_data: function() { return initial_rows; },
				fields: [
					{ fieldname: 'name', fieldtype: 'Data', hidden: 1 },
					{ fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1, in_list_view: 1 },
					{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, in_list_view: 1 },
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
					{ fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1, default: full_doc.equipment },
					{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, default: full_doc.quantity },
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
			<button class="btn btn-xs btn-default" onclick="pes_open_edit(); return false;">${__('Edit Equipment')}</button>
			<button class="btn btn-xs btn-primary" style="margin-left:6px;" onclick="pes_open_add(); return false;">${__('Add Equipment')}</button>
		</div>`
		: `<span class="text-muted" style="font-size:12px;">${__('Estimation is submitted. Cancel and Amend it to change equipment.')}</span>`;
	return `<div style="display:flex; justify-content:space-between; align-items:center; margin:4px 0 8px;">
		<b>${__('Equipment Scope')}</b>
		${right}
	</div>`;
}

function pes_empty_html(frm) {
	let btn = pes_can_edit(frm)
		? `<div style="margin-top:10px;"><button class="btn btn-sm btn-primary" onclick="pes_open_add(); return false;">${__('Add Equipment')}</button></div>`
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
				pes_recalculate(frm);
			} else {
				pes_render_table(frm);
			}
		}
	});
}

// ---------------------------------------------------------------------------
// Live estimation: same formulas and rounding as the server (project_cost_budget.py)
// ---------------------------------------------------------------------------

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
		pes_set_doc(frm, 'duration_months', months, 4);

		let manpower = 0;
		(frm.__pes_rows || []).forEach(s => { manpower += flt(s.total_days) * pes_crew_day_cost(s, rates); });
		manpower = flt(manpower, 2);
		pes_set_doc(frm, 'manpower_cost', manpower);

		let acc = 0;
		(d.accommodation || []).forEach(a => {
			let cost = flt(cint(a.persons) * flt(a.monthly_cost_per_person) * months, 2);
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

		let oc = 0;
		(d.other_costs || []).forEach(o => { oc += flt(o.cost, 2); });

		pes_set_doc(frm, 'accommodation_total', flt(acc, 2));
		pes_set_doc(frm, 'test_equipment_total', flt(te, 2));
		pes_set_doc(frm, 'transportation_total', flt(tr + flt(d.fuel_maintenance_total), 2));
		pes_set_doc(frm, 'other_costs_table_total', flt(oc, 2));

		let other = flt(acc + te + tr + flt(d.fuel_maintenance_total) + oc, 2);
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
		let missing = Object.keys(rc).filter(t => !(t in rates));
		let cost = flt(row.total_days) * pes_crew_day_cost(row, rates);
		let row_price = manpower ? total_price * cost / manpower : 0;
		let unit = flt(row.quantity) ? row_price / flt(row.quantity) : 0;
		sum_days += flt(row.total_days);
		sum_cost += cost;
		sum_price += row_price;

		let trade_cells = trades.map(t => `<td>${rc[t] ? rc[t] : '<span class="text-muted">-</span>'}</td>`).join('');
		let cost_cell = missing.length
			? `<span style="color: var(--red-500, #e03131); font-weight:600;" title="${esc(missing.join(', '))}">${__('No rate')}</span>`
			: money(cost);
		let status = row.docstatus === 1
			? `<span style="color: var(--green-600, #2b8a3e); font-weight:600;">${__('Submitted')}</span>`
			: `<span class="text-muted">${__('Draft')}</span>`;
		let edit_link = row.docstatus === 0
			? `<a href="#" onclick="open_equipment_scope_edit_single('${row.name}'); return false;">${__('Edit')}</a> | `
			: '';

		return `<tr>
			<td>${esc(row.equipment)}</td>
			<td>${flt(row.quantity)}</td>
			<td>${flt(row.days_per_equipment)}</td>
			${trade_cells}
			<td>${flt(row.total_days, 2)}</td>
			<td>${cost_cell}</td>
			${show_price ? `<td>${money(unit)}</td><td>${money(row_price)}</td>` : ''}
			<td>${status}</td>
			<td>${edit_link}<a href="/app/project-equipment-scope/${row.name}" target="_blank">${__('Details')}</a></td>
		</tr>`;
	}).join('');

	let price_heads = show_price ? `<th>${__('Unit Price')}</th><th>${__('Total Price')}</th>` : '';
	let price_foot = show_price ? `<td></td><td>${money(sum_price)}</td>` : '';

	let html = `
		<style>
			.pes-summary-table { width:100%; border-collapse:collapse; font-size:12.5px; }
			.pes-summary-table th { background:var(--control-bg, #f8f9fb); text-align:left; padding:8px 10px; font-size:10.5px; text-transform:uppercase; letter-spacing:0.3px; color:var(--text-muted, #6c757d); border-bottom:1px solid var(--border-color, #e9ecef); white-space:nowrap; }
			.pes-summary-table td { padding:8px 10px; border-bottom:1px solid var(--border-color, #e9ecef); vertical-align:middle; white-space:nowrap; }
			.pes-summary-table tbody tr:hover { background:var(--control-bg, #f8f9fb); }
			.pes-summary-table tfoot td { background:var(--control-bg, #f8f9fb); font-weight:600; }
		</style>
		<div style="border:1px solid var(--border-color, #e9ecef); border-radius:10px; overflow-x:auto; margin-top:8px;">
			<table class="pes-summary-table">
				<thead><tr>
					<th>${__('Equipment')}</th><th>${__('Qty')}</th><th>${__('Days/Unit')}</th>
					${trades.map(t => `<th>${esc(t)}</th>`).join('')}
					<th>${__('Total Days')}</th><th>${__('Total Cost')}</th>
					${price_heads}
					<th>${__('Status')}</th><th>${__('Actions')}</th>
				</tr></thead>
				<tbody>${rows_html}</tbody>
				<tfoot><tr>
					<td colspan="${3 + trades.length}" style="text-align:right;">${__('Total')}</td>
					<td>${flt(sum_days, 2)}</td>
					<td>${money(sum_cost)}</td>
					${price_foot}
					<td colspan="2"></td>
				</tr></tfoot>
			</table>
		</div>
	`;

	frm.set_df_property('equipment_scope_summary_html', 'options', pes_toolbar_html(frm) + html + spacer);
	frm.refresh_field('equipment_scope_summary_html');
	pes_render_summary(frm);
}

// Live triggers
frappe.ui.form.on('Project Cost Budget', {
	working_days_per_month: function(frm) { pes_recalculate(frm); },
	margin_percentage: function(frm) { pes_recalculate(frm); },
	fuel_maintenance_total: function(frm) { pes_recalculate(frm); },
	team_rates_remove: function(frm) { pes_recalculate(frm); },
	accommodation_remove: function(frm) { pes_recalculate(frm); },
	test_equipment_remove: function(frm) { pes_recalculate(frm); },
	transportation_remove: function(frm) { pes_recalculate(frm); },
	other_costs_remove: function(frm) { pes_recalculate(frm); }
});

function pes_row_changed(frm) { pes_recalculate(frm); }

frappe.ui.form.on('Project Cost Budget Rate', {
	designation: pes_row_changed, basic_salary: pes_row_changed, factor: pes_row_changed
});
frappe.ui.form.on('Project Cost Budget Accommodation', {
	persons: pes_row_changed, monthly_cost_per_person: pes_row_changed
});
frappe.ui.form.on('Project Cost Budget Test Equipment', {
	ownership: pes_row_changed, asset_value: pes_row_changed, depreciation_months: pes_row_changed, monthly_rent: pes_row_changed
});
frappe.ui.form.on('Project Cost Budget Transportation', {
	ownership: pes_row_changed, asset_value: pes_row_changed, depreciation_months: pes_row_changed,
	monthly_rent: pes_row_changed
});
frappe.ui.form.on('Project Cost Budget Other Cost', {
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
	let muted = 'var(--text-muted, #6c757d)';

	// ---- KPI cards (left) ----
	let card = (label, value, sub, color) => `
		<div style="flex:1 1 calc(50% - 8px); min-width:150px; border:1px solid var(--border-color, #e9ecef); border-radius:10px; padding:10px 12px;">
			<div style="font-size:10.5px; text-transform:uppercase; letter-spacing:0.3px; color:${muted};">${label}</div>
			<div style="font-size:17px; font-weight:700; color:${color}; margin-top:3px;">${value}</div>
			${sub ? `<div style="font-size:11.5px; color:${muted}; margin-top:2px;">${sub}</div>` : ''}
		</div>`;

	let cards = [
		card(__('Total Cost'), money(total), days ? `${money(total / days)} ${__('per team day')}` : '', 'var(--orange-600, #e8590c)')
	];
	if (show_price) {
		cards.push(card(__('Margin'), money(d.margin_amount), `${flt(d.margin_percentage, 2)}% ${__('of cost')}`, 'var(--blue-600, #1c7ed6)'));
		cards.push(card(__('Total Price'), money(d.total_price), `${money(d.price_per_day)} ${__('per team day')}`, 'var(--green-600, #2b8a3e)'));
	}
	cards.push(card(__('Duration'), `${flt(days, 2)} ${__('days')}`, `${flt(d.duration_months, 2)} ${__('months')}`, 'var(--text-color, #1f272e)'));

	kpi.$wrapper.html(`<div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:12px;">${cards.join('')}</div>`);

	// ---- Cost breakdown (right) ----
	let pct_cell = v => {
		if (!total) return '';
		let p = flt(flt(v) / total * 100, 1);
		return `<div style="display:flex; align-items:center; gap:8px; justify-content:flex-end;">
			<span style="min-width:40px; text-align:right;">${p}%</span>
			<div style="width:70px; height:6px; border-radius:3px; background:var(--control-bg, #f1f3f5); overflow:hidden;">
				<div style="width:${Math.min(100, Math.max(0, p))}%; height:100%; background:var(--blue-400, #4dabf7);"></div>
			</div>
		</div>`;
	};
	let td = 'padding:8px 12px; border-top:1px solid var(--border-color, #e9ecef);';
	let line = (label, value, opts) => {
		opts = opts || {};
		let w = opts.bold ? 'font-weight:700;' : '';
		let bg = opts.bg ? `background:${opts.bg};` : '';
		let pad = opts.indent ? 'padding-left:28px;' : '';
		let lbl = opts.indent ? `<span style="color:${muted};">${label}</span>` : label;
		return `<tr style="${bg}">
			<td style="${td}${w}${pad}">${lbl}</td>
			<td style="${td}${w} text-align:right;">${money(value)}</td>
			<td style="${td} font-size:11.5px; color:${muted};">${pct_cell(value)}</td>
		</tr>`;
	};

	let items = [
		[__('Accommodation'), d.accommodation_total],
		[__('Test Equipment'), d.test_equipment_total],
		[__('Car & Fuels'), d.transportation_total],
	];
	let by_cat = {};
	let cat_order = [];
	(d.other_costs || []).forEach(o => {
		let key = o.budget_category || __('Uncategorized');
		if (!(key in by_cat)) { by_cat[key] = 0; cat_order.push(key); }
		by_cat[key] += flt(o.cost);
	});
	cat_order.forEach(k => items.push([esc(k), by_cat[k]]));

	let rows = [];
	rows.push(line(__('Manpower Cost'), d.manpower_cost, { bold: 1 }));
	rows.push(line(__('Other Costs'), d.other_cost_total, { bold: 1 }));
	items.filter(x => flt(x[1])).forEach(x => rows.push(line(x[0], x[1], { indent: 1 })));
	rows.push(line(__('Total Cost'), total, { bold: 1, bg: 'var(--control-bg, #f8f9fb)' }));

	let th = `padding:8px 12px; font-size:10.5px; text-transform:uppercase; letter-spacing:0.3px; color:${muted};`;
	box.$wrapper.html(`
		<div style="border:1px solid var(--border-color, #e9ecef); border-radius:10px; overflow:hidden; margin-top:12px;">
			<table style="width:100%; border-collapse:collapse; font-size:13px;">
				<thead><tr style="background:var(--control-bg, #f8f9fb);">
					<th style="${th} text-align:left;">${__('Cost Breakdown')}</th>
					<th style="${th} text-align:right;">${__('Amount')}</th>
					<th style="${th} text-align:right;">${__('% of Cost')}</th>
				</tr></thead>
				<tbody>${rows.join('')}</tbody>
			</table>
		</div>
	`);
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
			.frappe-control[data-fieldname="other_costs_table_total"] {
				width: 100%;
			}
		}
	`;
	document.head.appendChild(style);
}

frappe.ui.form.on('Project Cost Budget', {
	refresh: function() { pes_inject_total_styles(); }
});
