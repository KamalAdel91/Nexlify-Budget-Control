let _visit_visible_columns = null;
let _invoice_visible_columns = null;
// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on("Project Planning", {
	setup: function(frm) {
		frm.set_query("naming_series", function() {
			return { filters: { "name": ["in", [".ABBR.-PP-.YYYY.-.####"]] } };
		});
	},

	refresh: function(frm) {
		frm.ignore_doctypes_on_cancel_all = ['Project Planning Scope'];
		inject_visits_invoices_styles();
		render_add_visits_button(frm);
		render_add_invoice_button(frm);
		render_visits_table(frm);
		render_invoices_table(frm);
		render_estimation_overview(frm);
		render_planning_scope(frm);
	},

	on_submit: function(frm) {
		frappe.msgprint({
			title: __('Budget Activated'),
			message: __('This budget has been successfully linked to project {0}.', [frm.doc.project]),
			primary_action: {
				label: __('Go to Project'),
				action: function() { frappe.set_route('Form', 'Project', frm.doc.project); }
			}
		});
	}
});

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

function render_add_visits_button(frm) {
	if (frm.is_new()) return;
	frm.add_custom_button(__('Add Visits'), () => open_add_visits_dialog(frm), __('Visits'));
	frm.add_custom_button(__('Edit Visits'), () => open_edit_visits_dialog(frm), __('Visits'));
}

function open_edit_visits_dialog(frm) {
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_visits',
		args: { project_planning: frm.doc.name },
		callback: function(r) {
			let visits = r.message || [];
			if (!visits.length) {
				frappe.msgprint(__('No visits to edit yet.'));
				return;
			}

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_visits_editable_fields',
				callback: function(r2) {
					let field_defs = (r2.message || []).filter(f => !['Table', 'Table MultiSelect'].includes(f.fieldtype));
					if (!_visit_visible_columns) {
						_visit_visible_columns = field_defs.map(f => f.fieldname);
					}
					build_edit_visits_dialog(frm, visits, field_defs);
				}
			});
		}
	});
}

function build_edit_visits_dialog(frm, visits, field_defs) {
	let initial_rows = visits.map(v => {
		let row = { visit_name: v.name, label: v.visit_label };
		field_defs.forEach(f => { row[f.fieldname] = v[f.fieldname]; });
		return row;
	});

	let grid_fields = [
		{ fieldname: 'visit_name', fieldtype: 'Data', hidden: 1 },
		{ fieldname: 'label', fieldtype: 'Data', in_list_view: 1, label: __('Visit'), read_only: 1 }
	];
	field_defs.forEach(f => {
		grid_fields.push({
			fieldname: f.fieldname,
			fieldtype: f.fieldtype,
			label: f.label,
			options: f.options,
			reqd: f.reqd,
			read_only: f.read_only,
			in_list_view: _visit_visible_columns.includes(f.fieldname) ? 1 : 0
		});
	});

	let original_names = visits.map(v => v.name);

	let d = new frappe.ui.Dialog({
		title: __('Edit Visits'),
		size: 'extra-large',
		fields: [
			{
				fieldname: 'columns_btn',
				fieldtype: 'Button',
				label: __('Columns'),
				click: function() {
					open_column_picker(field_defs, _visit_visible_columns, function(selected) {
						_visit_visible_columns = selected;
						d.hide();
						build_edit_visits_dialog(frm, visits, field_defs);
					});
				}
			},
			{
				fieldname: 'visits',
				fieldtype: 'Table',
				label: __('Visits'),
				cannot_add_rows: false,
				in_place_edit: false,
				data: initial_rows,
				get_data: function() { return initial_rows; },
				fields: grid_fields
			}
		],
		primary_action_label: __('OK'),
		primary_action: function() {
			let rows = d.get_value('visits') || [];
			let remaining_names = rows.map(r => r.visit_name).filter(Boolean);
			let deleted_names = original_names.filter(n => !remaining_names.includes(n));

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_update_project_visits',
				args: { rows: rows, deleted: deleted_names },
				freeze: true,
				freeze_message: __('Saving visits...'),
				callback: function() {
					d.hide();
					frappe.show_alert({ message: __('Visits updated.'), indicator: 'green' });
					render_visits_table(frm);
				}
			});
		}
	});

	

	d.show();
}

function open_column_picker(field_defs, current_visible, on_confirm) {
	frappe.prompt(
		[
			{
				fieldname: 'columns',
				fieldtype: 'MultiCheck',
				label: __('Show Columns'),
				options: field_defs.map(f => ({
					label: f.label || f.fieldname,
					value: f.fieldname,
					checked: current_visible.includes(f.fieldname)
				})),
				columns: 2
			}
		],
		function(values) {
			on_confirm(values.columns || []);
		},
		__('Choose Columns')
	);
}

function open_add_visits_dialog(frm) {
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_visit_count',
		args: { project_planning: frm.doc.name },
		callback: function(r) {
			let existing_count = r.message || 0;
			frappe.prompt(
				[
					{
						fieldname: 'visit_count',
						fieldtype: 'Int',
						label: __('How many visits?'),
						reqd: 1
					}
				],
				function(values) {
					build_add_visits_dialog(frm, values.visit_count, existing_count);
				},
				__('Add Visits')
			);
		}
	});
}

function build_add_visits_dialog(frm, visit_count, existing_count) {
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_visits_editable_fields',
		callback: function(r) {
			let field_defs = (r.message || []).filter(f => !['Table', 'Table MultiSelect'].includes(f.fieldtype) && f.fieldname !== 'visit_label');
			if (!_visit_visible_columns) {
				_visit_visible_columns = field_defs.map(f => f.fieldname);
			}
			render_add_visits_dialog(frm, visit_count, existing_count, field_defs);
		}
	});
}

function render_add_visits_dialog(frm, visit_count, existing_count, field_defs) {
	let initial_rows = [];
	for (let i = 1; i <= visit_count; i++) {
		let row = { label: __('Visit {0}', [existing_count + i]) };
		field_defs.forEach(f => { row[f.fieldname] = f.default_value; });
		initial_rows.push(row);
	}

	let grid_fields = [
		{ fieldname: 'label', fieldtype: 'Data', in_list_view: 1, label: __('Visit'), read_only: 1 }
	];
	field_defs.forEach(f => {
		grid_fields.push({
			fieldname: f.fieldname,
			fieldtype: f.fieldtype,
			label: f.label,
			options: f.options,
			reqd: f.reqd,
			read_only: f.read_only,
			in_list_view: _visit_visible_columns.includes(f.fieldname) ? 1 : 0
		});
	});


	let d = new frappe.ui.Dialog({
		title: __('Add Visits'),
		size: 'extra-large',
		fields: [
			{
				fieldname: 'columns_btn',
				fieldtype: 'Button',
				label: __('Columns'),
				click: function() {
					open_column_picker(field_defs, _visit_visible_columns, function(selected) {
						_visit_visible_columns = selected;
						d.hide();
						render_add_visits_dialog(frm, visit_count, existing_count, field_defs);
					});
				}
			},
			{
				fieldname: 'visits',
				fieldtype: 'Table',
				label: __('Visits'),
				cannot_add_rows: false,
				in_place_edit: false,
				data: initial_rows,
				get_data: function() { return initial_rows; },
				fields: grid_fields
			}
		],
		primary_action_label: __('OK'),
		primary_action: function() {
			let rows = d.get_value('visits') || [];
			if (!rows.length) {
				frappe.msgprint(__('Add at least one visit row.'));
				return;
			}

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_create_project_visits',
				args: { project_planning: frm.doc.name, rows: rows },
				freeze: true,
				freeze_message: __('Creating visits...'),
				callback: function(r) {
					d.hide();
					frappe.show_alert({ message: __('{0} visits created.', [(r.message || []).length]), indicator: 'green' });
					render_visits_table(frm);
				}
			});
		}
	});
	d.show();

	

	
}

let _project_planning_frm = null;
let _cached_visits = [];

function render_visits_table(frm) {
	_project_planning_frm = frm;

	if (frm.is_new()) {
		frm.set_df_property('visits_html', 'options', `<div class="text-muted">${__('Save the budget first to manage visits.')}</div>`);
		frm.refresh_field('visits_html');
		return;
	}

	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_visits',
		args: { project_planning: frm.doc.name },
		callback: function(r) {
			_cached_visits = r.message || [];
			frm.set_df_property('visits_html', 'options', build_visits_table_html(_cached_visits));
			frm.refresh_field('visits_html');
		}
	});
}

function fmt_matrix_value(n) {
	return n ? n : '<span class="nrb-muted">-</span>';
}

// Arrange the visit Edit dialog fields side by side (known fields), keep everything else below
function vd_layout_visit_fields(fields) {
	fields.forEach(f => {
		if (f.fieldname === 'allocations' && f.fields) {
			f.fields = f.fields.filter(cf => !cf.read_only);
			f.fields.forEach(cf => {
				if (cf.fieldname === 'planning_scope') { cf.label = __('Equipment'); cf.only_select = 1; }
			});
		}
		if (f.fieldname === 'team' && f.fields) {
			f.label = '';
			f.fields.forEach(cf => { if (cf.fieldname === 'trade') cf.only_select = 1; });
		}
	});
	let team_idx = fields.findIndex(f => f.fieldname === 'team');
	if (team_idx !== -1 && !fields.some(f => f.fieldname === 'team_suggest_html')) {
		fields.splice(team_idx, 0, { fieldname: 'team_suggest_html', fieldtype: 'HTML' });
	}
	let by = {};
	fields.forEach(f => { by[f.fieldname] = f; });
	let used = new Set();
	let out = [];

	function row(names, section_name) {
		let present = names.filter(n => by[n]);
		if (!present.length) return;
		if (out.length) out.push({ fieldtype: 'Section Break', fieldname: section_name });
		present.forEach((n, i) => {
			if (i > 0) out.push({ fieldtype: 'Column Break', fieldname: 'cb_' + n });
			out.push(by[n]);
			used.add(n);
		});
	}

	row(['company', 'customer'], 'sb_parties');
	row(['start_date', 'end_date', 'working_days', 'visit_duration'], 'sb_dates');

	let rest = fields.filter(f => !used.has(f.fieldname));
	if (rest.length) {
		out.push({ fieldtype: 'Section Break', fieldname: 'sb_rest' });
		out = out.concat(rest);
	}
	return out;
}

window.open_visit_quick_edit = function(visit_name) {
	let visit = _cached_visits.find(v => v.name === visit_name);
	if (!visit) return;

	let plan_name = _revenue_budget_frm.doc.name;

	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_visit_full',
		args: { visit_name: visit_name },
		callback: function(full_r) {
			let full_doc = full_r.message || {};

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_equipment_scope_rows_for_planning',
				args: { project_planning: plan_name },
				callback: function(scope_r) {
					let scope_data = scope_r.message || {};
					let allowed_equipment = (scope_data.rows || []).map(row => row.equipment);

					frappe.call({
						method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_visits_editable_fields',
						callback: function(r) {
							let field_defs = r.message || [];

							let dialog_fields = [];
							field_defs.forEach(f => {
								if (f.fieldtype === 'Table') {
									dialog_fields.push({
										fieldname: f.fieldname,
										fieldtype: 'Table',
										label: f.label,
										cannot_add_rows: false,
										in_place_edit: false,
										data: full_doc[f.fieldname] || [],
										get_data: function() { return full_doc[f.fieldname] || []; },
										fields: (f.child_fields || []).map(cf => {
											let field_def = {
												fieldname: cf.fieldname,
												fieldtype: cf.fieldtype,
												label: cf.label,
												options: cf.options,
												reqd: cf.reqd,
												read_only: cf.read_only,
												in_list_view: 1
											};
											if (f.fieldname === 'allocations' && cf.fieldname === 'planning_scope') {
												field_def.get_query = function() {
													return { filters: { project_planning: plan_name, docstatus: ['<', 2] } };
												};
											}
											return field_def;
										})
									});
									dialog_fields.push({
										fieldname: f.fieldname + '_remaining_html',
										fieldtype: 'HTML'
									});
								} else {
									dialog_fields.push({
										fieldname: f.fieldname,
										fieldtype: f.fieldtype,
										label: f.label,
										options: f.options,
										reqd: f.reqd,
										read_only: f.fieldtype === 'Percent' ? 1 : f.read_only,
										default: full_doc[f.fieldname]
									});
									if (f.fieldname === 'working_days') {
										
									}
								}
							});

							let d = new frappe.ui.Dialog({
								title: visit.visit_label || visit.name,
								size: 'large',
								fields: vd_layout_visit_fields(dialog_fields),
								primary_action_label: __('Save'),
								primary_action: function(values) {
									let row = Object.assign({ visit_name: visit.name }, values);
									if (d.fields_dict.allocations) row.allocations = (d.get_value('allocations') || []).filter(x => x.planning_scope).map(x => ({ planning_scope: x.planning_scope, quantity: flt(x.quantity) }));
									if (d.fields_dict.team) row.team = (d.get_value('team') || []).filter(x => x.trade).map(x => ({ trade: x.trade, headcount: cint(x.headcount) }));
									Object.keys(row).forEach(k => { if (k.endsWith('_remaining_html')) delete row[k]; });
									frappe.call({
										method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_update_project_visits',
										args: { rows: [row] },
										freeze: true,
										callback: function() {
											d.hide();
											frappe.show_alert({ message: __('Visit updated.'), indicator: 'green' });
											render_visits_table(_revenue_budget_frm);
											render_estimation_overview(_revenue_budget_frm);
										}
									});
								},
								secondary_action_label: __('Delete'),
								secondary_action: function() {
									frappe.confirm(__('Delete this visit?'), function() {
										frappe.call({
											method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_update_project_visits',
											args: { rows: [], deleted: [visit.name] },
											freeze: true,
											callback: function() {
												d.hide();
												frappe.show_alert({ message: __('Visit deleted.'), indicator: 'green' });
												render_visits_table(_revenue_budget_frm);
												render_estimation_overview(_revenue_budget_frm);
											}
										});
									});
								}
							});
							d.show();
							vd_wire_allocations(d, plan_name, visit.name);

							let set_working_days_promise = Promise.resolve();
							if (full_doc.working_days !== undefined && full_doc.working_days !== null) {
								set_working_days_promise = d.set_value('working_days', full_doc.working_days);
							}

							set_working_days_promise.then(function() {
							});
						}
					});
				}
			});
		}
	});
}

let _has_budget_bypass_role = false;
frappe.call({
	method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_budget_bypass_role',
	callback: function(role_r) {
		let bypass_role = role_r.message;
		_has_budget_bypass_role = bypass_role ? (frappe.user_roles || []).includes(bypass_role) : false;
	}
});

function build_visits_table_html(visits) {
	if (!visits.length) {
		return `
			<div class="nrb-empty">
				${__('No visits yet.')}<br><br>
				<button class="btn btn-primary btn-sm" onclick="window.open_add_visits_dialog_trigger(); return false;">${__('Add Visits')}</button>
			</div>
		`;
	}

	let rows_html = visits.map(v => `
		<tr>
			<td>${frappe.utils.escape_html(v.visit_label || v.name)}</td>
			<td>${frappe.datetime.str_to_user(v.start_date)}</td>
			<td>${frappe.datetime.str_to_user(v.end_date)}</td>
			<td>${fmt_matrix_value(v.working_days || 0)}</td>
			<td>${v.crew_summary ? frappe.utils.escape_html(v.crew_summary).replace(/, /g, '<br>') : '<span class="nrb-muted">-</span>'}</td>
			<td>${v.equipment_summary ? frappe.utils.escape_html(v.equipment_summary).replace(/, /g, '<br>') : '<span class="nrb-muted">-</span>'}</td>
			<td>
				<a href="#" class="nrb-link" onclick="open_visit_quick_edit('${v.name}'); return false;">${__('Edit')}</a>
				&nbsp;|&nbsp;
				<a href="#" class="nrb-link" onclick="window.open('/app/project-visits/${v.name}', '_blank'); return false;">${__('Details')}</a>
			</td>
		</tr>
	`).join('');

	let total_working_days = visits.reduce((sum, v) => sum + (v.working_days || 0), 0);

	return `
		<div class="nrb-table-wrapper">
			<table class="nrb-table nrb-table-visits">
				<thead><tr><th>${__('Visit')}</th><th>${__('Start Date')}</th><th>${__('End Date')}</th><th>${__('Working Days')}</th><th>${__('Crew')}</th><th>${__('Equipment')}</th><th>${__('Actions')}</th></tr></thead>
				<tbody>${rows_html}</tbody>
				<tfoot><tr><td colspan="3" style="text-align:right;"><b>${__('Total')}</b></td><td><b>${total_working_days}</b></td><td colspan="3"></td></tr></tfoot>
			</table>
		</div>
		<div id="nrb-execution-matrix"></div>
	`;
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

function render_add_invoice_button(frm) {
	if (frm.is_new()) return;
	frm.add_custom_button(__('Add Invoice'), () => open_add_invoice_dialog(frm), __('Invoicing'));
	frm.add_custom_button(__('Edit Invoices'), () => open_edit_invoices_dialog(frm), __('Invoicing'));
}

function open_add_invoice_dialog(frm) {
	frappe.prompt(
		[
			{
				fieldname: 'invoice_count',
				fieldtype: 'Int',
				label: __('How many invoices?'),
				reqd: 1
			}
		],
		function(values) {
			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_invoicing_editable_fields',
				callback: function(r) {
					let field_defs = (r.message || []).filter(f => !['Table', 'Table MultiSelect'].includes(f.fieldtype) && f.fieldname !== 'invoice_label');
					if (!_invoice_visible_columns) {
						_invoice_visible_columns = field_defs.map(f => f.fieldname);
					}

					frappe.call({
						method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_invoicings',
						args: { project_planning: frm.doc.name },
						callback: function(r2) {
							let percent_field = field_defs.find(f => f.fieldtype === 'Percent');
							let existing_total = 0;
							if (percent_field) {
								(r2.message || []).forEach(inv => {
									existing_total += flt(inv[percent_field.fieldname]);
								});
							}
							render_add_invoice_dialog(frm, values.invoice_count, field_defs, existing_total);
						}
					});
				}
			});
		},
		__('Add Invoices')
	);
}

function render_add_invoice_dialog(frm, invoice_count, field_defs, existing_total) {
	let initial_rows = [];
	for (let i = 0; i < invoice_count; i++) {
		let row = {};
		field_defs.forEach(f => { row[f.fieldname] = f.default_value; });
		initial_rows.push(row);
	}

	let grid_fields = field_defs.map(f => ({
		fieldname: f.fieldname,
		fieldtype: f.fieldtype,
		label: f.label,
		options: f.options,
		reqd: f.reqd,
		read_only: f.read_only,
		in_list_view: _invoice_visible_columns.includes(f.fieldname) ? 1 : 0
	}));

	let percent_field = field_defs.find(f => f.fieldtype === 'Percent');

	let d = new frappe.ui.Dialog({
		title: __('Add Invoices'),
		size: 'extra-large',
		fields: [
			{
				fieldname: 'columns_btn',
				fieldtype: 'Button',
				label: __('Columns'),
				click: function() {
					open_column_picker(field_defs, _invoice_visible_columns, function(selected) {
						_invoice_visible_columns = selected;
						d.hide();
						render_add_invoice_dialog(frm, invoice_count, field_defs);
					});
				}
			},
			{
				fieldname: 'invoices',
				fieldtype: 'Table',
				label: __('Invoices'),
				cannot_add_rows: false,
				in_place_edit: false,
				data: initial_rows,
				get_data: function() { return initial_rows; },
				fields: grid_fields
			},
			{
				fieldname: 'percentage_indicator',
				fieldtype: 'HTML'
			}
		],
		primary_action_label: __('OK'),
		primary_action: function() {
			let rows = d.get_value('invoices') || [];
			if (!rows.length) {
				frappe.msgprint(__('Add at least one invoice row.'));
				return;
			}

			if (percent_field) {
				let total = existing_total || 0;
				rows.forEach(row => { total += flt(row[percent_field.fieldname]); });
				if (total > 100.01) {
					frappe.msgprint({
						title: __('Total Exceeds 100%'),
						message: __('Total invoice percentage (including existing invoices) would be {0}%, which is more than 100%.', [total.toFixed(2)]),
						indicator: 'red'
					});
					return;
				}
			}

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_create_project_invoicing',
				args: { project_planning: frm.doc.name, rows: rows },
				freeze: true,
				freeze_message: __('Creating invoices...'),
				callback: function(r) {
					d.hide();
					frappe.show_alert({ message: __('{0} invoices created.', [(r.message || []).length]), indicator: 'green' });
					render_invoices_table(frm);
				}
			});
		}
	});

	if (percent_field) {
		let update_indicator = function() {
			let rows = d.get_value('invoices') || [];
			let total = existing_total || 0;
			rows.forEach(row => { total += flt(row[percent_field.fieldname]); });
			let color = Math.abs(total - 100) <= 0.01 ? 'green' : (total > 100 ? 'red' : 'orange');
			d.fields_dict.percentage_indicator.$wrapper.html(
				`<div style="padding: 6px 0;">${__('Total (including existing invoices)')}: <b style="color: ${color};">${total.toFixed(2)}%</b></div>`
			);
		};

		d.fields_dict.invoices.grid.wrapper.on('change awesomplete-selectcomplete', 'input, select, textarea', update_indicator);
		d.fields_dict.invoices.grid.wrapper.on('click', '.grid-delete-row, .grid-insert-row, .grid-append-row', function() {
			setTimeout(update_indicator, 100);
		});
		update_indicator();
	}

	d.show();
}

function open_edit_invoices_dialog(frm) {
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_invoicings',
		args: { project_planning: frm.doc.name },
		callback: function(r) {
			let invoices = r.message || [];
			if (!invoices.length) {
				frappe.msgprint(__('No invoices to edit yet.'));
				return;
			}

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_invoicing_editable_fields',
				callback: function(r2) {
					let field_defs = (r2.message || []).filter(f => !['Table', 'Table MultiSelect'].includes(f.fieldtype));
					if (!_invoice_visible_columns) {
						_invoice_visible_columns = field_defs.map(f => f.fieldname);
					}
					build_edit_invoices_dialog(frm, invoices, field_defs);
				}
			});
		}
	});
}

function build_edit_invoices_dialog(frm, invoices, field_defs) {
	let initial_rows = invoices.map(inv => {
		let row = { invoice_name: inv.name };
		field_defs.forEach(f => { row[f.fieldname] = inv[f.fieldname]; });
		return row;
	});

	let grid_fields = [
		{ fieldname: 'invoice_name', fieldtype: 'Data', hidden: 1 }
	];
	field_defs.forEach(f => {
		grid_fields.push({
			fieldname: f.fieldname,
			fieldtype: f.fieldtype,
			label: f.label,
			options: f.options,
			reqd: f.reqd,
			read_only: f.read_only,
			in_list_view: _invoice_visible_columns.includes(f.fieldname) ? 1 : 0
		});
	});

	let original_names = invoices.map(inv => inv.name);

	let d = new frappe.ui.Dialog({
		title: __('Edit Invoices'),
		size: 'extra-large',
		fields: [
			{
				fieldname: 'columns_btn',
				fieldtype: 'Button',
				label: __('Columns'),
				click: function() {
					open_column_picker(field_defs, _invoice_visible_columns, function(selected) {
						_invoice_visible_columns = selected;
						d.hide();
						build_edit_invoices_dialog(frm, invoices, field_defs);
					});
				}
			},
			{
				fieldname: 'invoices',
				fieldtype: 'Table',
				label: __('Invoices'),
				cannot_add_rows: true,
				in_place_edit: false,
				data: initial_rows,
				get_data: function() { return initial_rows; },
				fields: grid_fields
			},
			{
				fieldname: 'invoice_percentage_total_html',
				fieldtype: 'HTML'
			}
		],
		primary_action_label: __('OK'),
		primary_action: function() {
			let rows = d.get_value('invoices') || [];
			let remaining_names = rows.map(r => r.invoice_name).filter(Boolean);
			let deleted_names = original_names.filter(n => !remaining_names.includes(n));

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_update_project_invoicing',
				args: { rows: rows, deleted: deleted_names },
				freeze: true,
				freeze_message: __('Saving invoices...'),
				callback: function() {
					d.hide();
					frappe.show_alert({ message: __('Invoices updated.'), indicator: 'green' });
					render_invoices_table(frm);
				}
			});
		}
	});
	d.show();

	function update_percentage_total() {
		let rows = d.get_value('invoices') || [];
		let sum = 0;
		rows.forEach(row => { sum += flt(row.invoice_percentage); });
		let color = Math.abs(sum - 100) <= 0.01 ? 'var(--green-500, #2b8a3e)' : (sum > 100 ? 'var(--red-500, #e03131)' : 'var(--orange-500, #e8590c)');
		d.fields_dict.invoice_percentage_total_html.$wrapper.html(
			`<div style="padding: 6px 0;">${__('Total')}: <b style="color: ${color};">${sum.toFixed(2)}%</b></div>`
		);
	}
	d.fields_dict.invoices.grid.wrapper.on('change input', 'input, select', update_percentage_total);
	d.fields_dict.invoices.grid.wrapper.on('click', '.grid-delete-row, .grid-append-row', function() { setTimeout(update_percentage_total, 100); });
	update_percentage_total();
}

let _cached_invoices = [];

function render_invoices_table(frm) {
	_revenue_budget_frm = frm;

	if (frm.is_new()) {
		frm.set_df_property('invoices_html', 'options', `<div class="nrb-empty">${__('Save the budget first to manage invoices.')}</div>`);
		frm.refresh_field('invoices_html');
		return;
	}

	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_invoicings',
		args: { project_planning: frm.doc.name },
		callback: function(r) {
			_cached_invoices = r.message || [];
			frm.set_df_property('invoices_html', 'options', build_invoices_table_html(_cached_invoices));
			frm.refresh_field('invoices_html');
		}
	});
}

window.open_invoicing_quick_edit = function(invoice_name) {
	let invoice = _cached_invoices.find(i => i.name === invoice_name);
	if (!invoice) return;

	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_invoicing_full',
		args: { invoice_name: invoice_name },
		callback: function(full_r) {
			let full_doc = full_r.message || {};

			frappe.call({
				method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_invoicing_editable_fields',
				callback: function(r) {
					let field_defs = r.message || [];

					let multiselect_doctypes = field_defs
						.filter(f => f.fieldtype === 'Table MultiSelect' && f.options)
						.map(f => f.options);

					function build_invoicing_edit_dialog() {
					let dialog_fields = field_defs.map(f => {
						if (f.fieldtype === 'Table' || f.fieldtype === 'Table MultiSelect') {
							return {
								fieldname: f.fieldname,
								fieldtype: f.fieldtype,
								label: f.label,
								options: f.options,
								cannot_add_rows: false,
								in_place_edit: false,
								data: full_doc[f.fieldname] || [],
								get_data: function() { return full_doc[f.fieldname] || []; },
								get_query: function() {
									if (f.fieldname === 'visits') {
										return { filters: { project_planning: full_doc.project_planning || '' } };
									}
									return {};
								},
																fields: (f.child_fields || []).map(cf => {
									let child_def = {
										fieldname: cf.fieldname,
										fieldtype: cf.fieldtype,
										label: cf.label,
										options: cf.options,
										reqd: cf.reqd,
										read_only: cf.read_only,
										in_list_view: 1
									};
									if (f.fieldname === 'visits' && cf.fieldname === 'project_visit') {
										child_def.get_query = function() {
											return { filters: { project_planning: full_doc.project_planning || '' } };
										};
									}
									return child_def;
								})
							};
						}
						return {
							fieldname: f.fieldname,
							fieldtype: f.fieldtype,
							label: f.label,
							options: f.options,
							reqd: f.reqd,
							read_only: f.fieldtype === 'Percent' ? 1 : f.read_only,
							default: full_doc[f.fieldname]
						};
					});

					let d = new frappe.ui.Dialog({
						title: invoice.name,
						size: 'large',
						fields: dialog_fields,
						primary_action_label: __('Save'),
						primary_action: function(values) {
							let row = Object.assign({ invoice_name: invoice.name }, values);
							frappe.call({
								method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_update_project_invoicing',
								args: { rows: [row] },
								freeze: true,
								callback: function() {
									d.hide();
									frappe.show_alert({ message: __('Invoice updated.'), indicator: 'green' });
									render_invoices_table(_revenue_budget_frm);
								}
							});
						},
						secondary_action_label: __('Delete'),
						secondary_action: function() {
							frappe.confirm(__('Delete this invoice?'), function() {
								frappe.call({
									method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.bulk_update_project_invoicing',
									args: { rows: [], deleted: [invoice.name] },
									freeze: true,
									callback: function() {
										d.hide();
										frappe.show_alert({ message: __('Invoice deleted.'), indicator: 'green' });
										render_invoices_table(_revenue_budget_frm);
									}
								});
							});
						}
					});
					d.show();
				}

				function load_next_doctype(remaining) {
					if (!remaining.length) {
						build_invoicing_edit_dialog();
						return;
					}
					let next = remaining.shift();
					frappe.model.with_doctype(next, function() {
						load_next_doctype(remaining);
					});
				}

				load_next_doctype(multiselect_doctypes.slice());
			}
		});
	}
});
}

function build_invoices_table_html(invoices) {
	if (!invoices.length) {
		return `
			<div class="nrb-empty">
				${__('No invoices yet.')}<br><br>
				<button class="btn btn-primary btn-sm" onclick="window.open_add_invoice_dialog_trigger(); return false;">${__('Add Invoice')}</button>
			</div>
		`;
	}

	let total = 0;
	let rows_html = invoices.map(inv => {
		total += flt(inv.invoice_percentage);
		let so_html = inv.sales_order
			? `<a href="/app/sales-order/${inv.sales_order}" class="nrb-link">${inv.sales_order}</a>`
			: `<span class="nrb-muted">-</span>`;
		let status_class = inv.status === 'Invoiced' ? 'nrb-badge nrb-badge-invoiced' : 'nrb-badge';

		return `
			<tr>
				<td>${frappe.utils.escape_html(inv.invoice_label || inv.name)}</td>
				<td>${inv.expected_invoice_date ? frappe.datetime.str_to_user(inv.expected_invoice_date) : '<span class="nrb-muted">-</span>'}</td>
				<td class="nrb-text-right">${flt(inv.invoice_percentage).toFixed(2)}%</td>
				<td>${inv.invoice_description ? frappe.utils.escape_html(inv.invoice_description) : '<span class="nrb-muted">-</span>'}</td>
				<td>${inv.status ? `<span class="${status_class}">${inv.status}</span>` : '<span class="nrb-muted">-</span>'}</td>
				<td>${so_html}</td>
				<td>
					<a href="#" class="nrb-link" onclick="open_invoicing_quick_edit('${inv.name}'); return false;">${__('Edit')}</a>
					&nbsp;|&nbsp;
					<a href="#" class="nrb-link" onclick="window.open('/app/project-invoicing/${inv.name}', '_blank'); return false;">${__('Details')}</a>
				</td>
			</tr>
		`;
	}).join('');

	return `
		<div class="nrb-table-wrapper">
			<table class="nrb-table">
				<thead>
					<tr>
						<th>${__('Invoice')}</th><th>${__('Expected Date')}</th>
						<th class="nrb-text-right">${__('Percentage')}</th><th>${__('Description')}</th>
						<th>${__('Status')}</th><th>${__('Sales Order')}</th><th>${__('Actions')}</th>
					</tr>
				</thead>
				<tbody>${rows_html}</tbody>
				<tfoot>
					<tr>
						<td colspan="2" class="nrb-text-right"><b>${__('Total')}</b></td>
						<td class="nrb-text-right"><b>${total.toFixed(2)}%</b></td>
						<td colspan="4"></td>
					</tr>
				</tfoot>
			</table>
		</div>
	`;
}

function inject_visits_invoices_styles() {
	if (document.getElementById('nrb-styles')) return;

	let style = document.createElement('style');
	style.id = 'nrb-styles';
	style.innerHTML = `
		.nrb-table-wrapper {
			border: 1px solid var(--border-color, #e9ecef);
			border-radius: 10px;
			overflow-x: auto;
			overflow-y: hidden;
			margin-top: 6px;
			-webkit-overflow-scrolling: touch;
		}
		.nrb-table-visits { min-width: 700px; }
		.nrb-table {
			width: 100%;
			border-collapse: collapse;
			font-size: 12.5px;
		}
		.nrb-table-visits {
			table-layout: fixed;
		}
		.nrb-table-visits th:nth-child(1),
		.nrb-table-visits td:nth-child(1) { width: 10%; }
		.nrb-table-visits th:nth-child(2),
		.nrb-table-visits td:nth-child(2) { width: 11%; }
		.nrb-table-visits th:nth-child(3),
		.nrb-table-visits td:nth-child(3) { width: 11%; }
		.nrb-table-visits th:nth-child(4),
		.nrb-table-visits td:nth-child(4) { width: 10%; }
		.nrb-table-visits th:nth-child(5),
		.nrb-table-visits td:nth-child(5) { width: 25%; }
		.nrb-table-visits th:nth-child(6),
		.nrb-table-visits td:nth-child(6) { width: 23%; }
		.nrb-table-visits th:nth-child(7),
		.nrb-table-visits td:nth-child(7) { width: 10%; }
		.nrb-table-visits th:nth-child(1), .nrb-table-visits td:nth-child(1),
		.nrb-table-visits th:nth-child(2), .nrb-table-visits td:nth-child(2),
		.nrb-table-visits th:nth-child(3), .nrb-table-visits td:nth-child(3),
		.nrb-table-visits th:nth-child(4), .nrb-table-visits td:nth-child(4),
		.nrb-table-visits th:nth-child(7), .nrb-table-visits td:nth-child(7) {
			white-space: nowrap;
			word-break: normal;
			overflow-wrap: normal;
		}
		.nrb-matrix-table,
		.nrb-table:not(.nrb-table-visits) {
			table-layout: fixed;
		}
		.nrb-matrix-table th:first-child,
		.nrb-matrix-table td:first-child,
		.nrb-table:not(.nrb-table-visits) th:first-child,
		.nrb-table:not(.nrb-table-visits) td:first-child {
			width: 140px;
			white-space: nowrap;
		}
		.nrb-table tfoot tr.nrb-estimated-row td {
			color: #40c057 !important;
			font-style: italic !important;
			font-weight: 600 !important;
			background: var(--control-bg, #f8f9fb) !important;
		}
		.nrb-table thead tr {
			background: var(--control-bg, #f8f9fb);
			border-bottom: 1px solid var(--border-color, #e9ecef);
		}
		.nrb-table th {
			padding: 10px 12px;
			text-align: center;
			font-size: 10.5px;
			font-weight: 600;
			color: var(--text-muted, #6c757d);
			text-transform: uppercase;
			letter-spacing: 0.3px;
			white-space: normal;
			word-wrap: break-word;
		}
		.nrb-table th:first-child { text-align: left; }
		.nrb-table td {
			padding: 9px 12px;
			border-bottom: 1px solid var(--border-color, #e9ecef);
			color: var(--text-color, inherit);
			vertical-align: middle;
			text-align: center;
			white-space: normal;
			word-wrap: break-word;
			overflow-wrap: break-word;
		}
		.nrb-table td:first-child { text-align: left; }
		.nrb-table tbody tr:last-child td { border-bottom: none; }
		.nrb-table tbody tr:hover { background: var(--control-bg, #f8f9fb); }
		.nrb-table tfoot tr { background: var(--control-bg, #f8f9fb); }
		.nrb-text-right { text-align: right; }
		.nrb-link {
			color: var(--link-color, #2b6cb0);
			font-weight: 600;
			text-decoration: none;
			cursor: pointer;
		}
		.nrb-link:hover { text-decoration: underline; }
		.nrb-badge {
			display: inline-block;
			font-size: 10.5px;
			font-weight: 600;
			padding: 2px 9px;
			border-radius: 10px;
			background: var(--control-bg, #f1f3f5);
			color: var(--text-muted, #6c757d);
		}
		.nrb-badge-invoiced {
			background: var(--green-100, #ebfbee);
			color: var(--green-600, #2b8a3e);
		}
		.nrb-muted { color: var(--text-muted, #6c757d); }
		.form-section:not(:last-child) {
			padding-bottom: 20px;
			margin-bottom: 20px;
			border-bottom: 1px solid transparent;
		}
		.form-section:not(:last-child) {
			padding-bottom: 20px;
			margin-bottom: 20px;
			border-bottom: 1px solid var(--border-color, #e9ecef);
		}
		.form-section:not(:last-child) {
			padding-bottom: 20px;
			margin-bottom: 20px;
			border-bottom: 1px solid var(--border-color, #e9ecef);
		}
		.nrb-empty {
			padding: 26px 14px;
			text-align: center;
			color: var(--text-muted, #6c757d);
			font-size: 13px;
			border: 1px dashed var(--border-color, #e9ecef);
			border-radius: 10px;
		}
	`;
	document.head.appendChild(style);
}

function render_estimation_overview(frm) {
	if (frm.is_new()) {
		frm.set_df_property('estimation_overview_html', 'options', '');
		frm.refresh_field('estimation_overview_html');
		return;
	}

	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_equipment_scope_rows_for_planning',
		args: { project_planning: frm.doc.name },
		callback: function(r) {
			let data = r.message || {};
			let rows = data.rows || [];
			let trade_columns = data.trade_columns || [];

			if (!rows.length) {
				frm.set_df_property('estimation_overview_html', 'options', `<div class="text-muted" style="padding:16px; text-align:center; border:1px dashed var(--border-color, #e9ecef); border-radius:10px;">${(data.estimation_status === 2 ? __('The Estimation ({0}) is cancelled. The plan will follow its amended version once it is submitted.', [data.cost_budget]) : __('No Costing (Estimation) submitted yet for this project.'))}</div>`);
				frm.refresh_field('estimation_overview_html');
				return;
			}

			let trade_headers = trade_columns.map(t => `<th>${frappe.utils.escape_html(t)}</th>`).join('');

			let total_days_sum = 0;
			let rows_html = rows.map(row => {
				total_days_sum += flt(row.total_days);
				let trade_cells = trade_columns.map(t => {
					let val = (row.role_counts || {})[t];
					return `<td>${val ? val : '<span class="text-muted">-</span>'}</td>`;
				}).join('');
				return `
					<tr>
						<td>${frappe.utils.escape_html(row.equipment || '')}</td>
						<td>${flt(row.quantity)}</td>
						<td>${flt(row.days_per_equipment)}</td>
						${trade_cells}
						<td>${flt(row.total_days)}</td>
					</tr>
				`;
			}).join('');

			total_days_sum = Math.round(total_days_sum * 100) / 100;

			let html = `
				<style>
					.pes-summary-table { width:100%; border-collapse:collapse; font-size:12.5px; }
					.pes-summary-table th { background:var(--control-bg, #f8f9fb); text-align:left; padding:8px 10px; font-size:10.5px; text-transform:uppercase; letter-spacing:0.3px; color:var(--text-muted, #6c757d); border-bottom:1px solid var(--border-color, #e9ecef); }
					.pes-summary-table td { padding:8px 10px; border-bottom:1px solid var(--border-color, #e9ecef); vertical-align:middle; }
					.pes-summary-table tbody tr:hover { background:var(--control-bg, #f8f9fb); }
					.pes-summary-table tfoot td { background:var(--control-bg, #f8f9fb); font-weight:600; }
				</style>
				<div style="border:1px solid var(--border-color, #e9ecef); border-radius:10px; overflow-x:auto; margin-top:8px;">
					<table class="pes-summary-table">
						<thead>
							<tr>
								<th>${__('Equipment')}</th>
								<th>${__('Qty')}</th>
								<th>${__('Days/Unit')}</th>
								${trade_headers}
								<th>${__('Total Days')}</th>
							</tr>
						</thead>
						<tbody>${rows_html}</tbody>
						<tfoot>
							<tr>
								<td colspan="${3 + trade_columns.length}" style="text-align:right;">${__('Total Work Days')}</td>
								<td>${total_days_sum}</td>
							</tr>
						</tfoot>
					</table>
				</div>
			`;

			frm.set_df_property('estimation_overview_html', 'options', html);
			frm.refresh_field('estimation_overview_html');
		}
	});
}


window.open_add_visits_dialog_trigger = function() {
	open_add_visits_dialog(_revenue_budget_frm);
};


window.open_add_invoice_dialog_trigger = function() {
	open_add_invoice_dialog(_revenue_budget_frm);
};

// ---------------------------------------------------------------------------
// Planning Scope: planned scope copied from the Estimation (can only go down)
// ---------------------------------------------------------------------------

const PS_METHOD = 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.';
let _ps_frm = null;

function ps_can_edit(frm) {
	return !frm.is_new() && frm.doc.docstatus === 0 && !!(frm.perm && frm.perm[0] && frm.perm[0].write);
}

function ps_cell(plan, est) {
	let r = n => Math.round(flt(n) * 100) / 100;
	plan = r(plan);
	est = r(est);
	if (plan > est) {
		return `<span style="color: var(--red-500, #e03131); font-weight:700;">${plan}</span>
			<div style="font-size:11px; color: var(--red-500, #e03131);">${__('Est.')} ${est}</div>`;
	}
	if (plan < est) {
		return `<span style="font-weight:600;">${plan}</span>
			<div style="font-size:11px; color: var(--text-muted, #6c757d);">${__('Est.')} ${est}</div>`;
	}
	return `<span>${plan}</span>`;
}

function render_planning_scope(frm) {
	_ps_frm = frm;
	let field = frm.fields_dict.planning_scope_html;
	if (!field) return;
	if (frm.is_new()) {
		field.$wrapper.html('');
		return;
	}
	frappe.call({
		method: PS_METHOD + 'get_planning_scope_rows',
		args: { project_planning: frm.doc.name },
		callback: function(r) {
			frm.__ps = r.message || {};
			field.$wrapper.html(ps_build_html(frm, frm.__ps));
		}
	});
}

function ps_build_html(frm, data) {
	let rows = data.rows || [];
	let trades = data.trade_columns || [];
	let missing = data.missing || [];
	let editable = ps_can_edit(frm);
	let esc = v => frappe.utils.escape_html(v || '');

	let buttons = '';
	if (editable) {
		if (!rows.length) {
			buttons = `<button class="btn btn-xs btn-primary" onclick="ps_copy(0); return false;">${__('Copy from Estimation')}</button>`;
		} else {
			if (missing.length) {
				buttons += `<button class="btn btn-xs btn-default" onclick="ps_copy(0); return false;">${__('Add missing ({0})', [missing.length])}</button> `;
			}
			buttons += `<button class="btn btn-xs btn-default" onclick="ps_copy(1); return false;">${__('Reset from Estimation')}</button>`;
		}
	} else if (frm.doc.docstatus === 1) {
		buttons = `<span class="nrb-muted" style="font-size:12px;">${__('Plan is submitted. Cancel and Amend it to change the scope.')}</span>`;
	}

	let header = `<div style="display:flex; justify-content:space-between; align-items:center; margin:4px 0 8px; gap:8px; flex-wrap:wrap;">
		<span class="nrb-muted" style="font-size:12px;">${__('Copied from the Estimation. Values can be reduced, never increased.')}</span>
		<div>${buttons}</div>
	</div>`;

	if (data.estimation_status !== undefined && data.estimation_status !== null && data.estimation_status !== 1) {
		header = `<div style="margin-bottom:8px; padding:8px 10px; border-radius:8px; background: var(--orange-50, #fff4e6); color: var(--orange-700, #d9480f); font-weight:600;">${__('The Estimation is not submitted (cancelled or draft). The plan cannot be submitted until it is submitted again.')}</div>` + header;
	}
	if (!rows.length) {
		return header + `<div class="nrb-empty">${__('No planning scope yet.')}</div>`;
	}

	let over = 0, sum_plan = 0, sum_est = 0;
	let body = rows.map(row => {
		let e = row.est || {};
		if (flt(row.quantity) > flt(e.quantity)) over++;
		if (flt(row.days_per_equipment) > flt(e.days_per_equipment)) over++;
		sum_plan += flt(row.total_days);
		sum_est += flt(e.total_days);

		let trade_cells = trades.map(t => {
			let p = flt((row.role_counts || {})[t]);
			let ec = flt((e.role_counts || {})[t]);
			if (!p && !ec) return `<td><span class="nrb-muted">-</span></td>`;
			if (p > ec) over++;
			return `<td>${ps_cell(p, ec)}</td>`;
		}).join('');

		let status = row.docstatus === 1
			? `<span style="color: var(--green-600, #2b8a3e); font-weight:600;">${__('Submitted')}</span>`
			: `<span class="nrb-muted">${__('Draft')}</span>`;
		let edit = (editable && row.docstatus === 0)
			? `<a href="#" class="nrb-link" onclick="ps_edit('${row.name}'); return false;">${__('Edit')}</a> | `
			: '';
		return `<tr>
			<td>${esc(row.equipment)}</td>
			<td>${ps_cell(row.quantity, e.quantity)}</td>
			<td>${ps_cell(row.days_per_equipment, e.days_per_equipment)}</td>
			${trade_cells}
			<td>${ps_cell(row.total_days, e.total_days)}</td>
			<td>${status}</td>
			<td>${edit}<a href="/app/project-planning-scope/${row.name}" class="nrb-link" target="_blank">${__('Details')}</a></td>
		</tr>`;
	}).join('');

	let box = (bg, fg, text) => `<div style="margin-bottom:8px; padding:8px 10px; border-radius:8px; background:${bg}; color:${fg}; font-weight:600;">${text}</div>`;
	let banner = over
		? box('var(--red-50, #fff5f5)', 'var(--red-600, #c92a2a)', __('{0} value(s) are above the Estimation. Submitting the plan is blocked until they are reduced.', [over]))
		: box('var(--green-50, #ebfbee)', 'var(--green-700, #2b8a3e)', __('The planning scope is within the Estimation.'));
	let removed = missing.length
		? `<div class="nrb-muted" style="margin-top:6px; font-size:12px;">${__('Removed from the plan')}: ${missing.map(esc).join(', ')}</div>`
		: '';

	let min_width = (6 + trades.length) * 110;
	return header + banner + `
		<div class="nrb-table-wrapper">
			<table class="nrb-table" style="min-width:${min_width}px;">
				<thead><tr>
					<th>${__('Equipment')}</th><th>${__('Qty')}</th><th>${__('Days/Unit')}</th>
					${trades.map(t => `<th>${esc(t)}</th>`).join('')}
					<th>${__('Total Days')}</th><th>${__('Status')}</th><th>${__('Actions')}</th>
				</tr></thead>
				<tbody>${body}</tbody>
				<tfoot><tr style="font-weight:600;">
					<td colspan="${3 + trades.length}" style="text-align:right;">${__('Total')}</td>
					<td>${ps_cell(sum_plan, sum_est)}</td>
					<td colspan="2"></td>
				</tr></tfoot>
			</table>
		</div>` + removed;
}

window.ps_copy = function(reset) {
	let frm = _ps_frm;
	if (!frm) return;
	let go = () => frappe.call({
		method: PS_METHOD + 'copy_estimation_to_planning_scope',
		args: { project_planning: frm.doc.name, reset: reset },
		freeze: true,
		callback: function(r) {
			frappe.show_alert({ message: __('{0} equipment copied from the Estimation.', [r.message || 0]), indicator: 'green' });
			render_planning_scope(frm);
		}
	});
	if (reset) {
		frappe.confirm(__('Reset the planning scope to the Estimation? All changes to draft rows will be lost.'), go);
	} else {
		go();
	}
};

window.ps_edit = function(name) {
	let frm = _ps_frm;
	let row = (((frm && frm.__ps) || {}).rows || []).find(x => x.name === name);
	if (!row) return;
	let e = row.est || {};
	let est_roles = e.role_counts || {};
	let est_trades = Object.keys(est_roles);
	let initial = Object.keys(row.role_counts || {}).map(t => ({ trade: t, count: row.role_counts[t] }));
	var d;
	let ready = false;

	function current_roles() {
		return (d.get_value('roles') || []).filter(x => x.trade).map(x => ({ trade: x.trade, count: cint(x.count) }));
	}

	function render_check() {
		if (!ready) return;
		let q = flt(d.get_value('quantity'));
		let dpu = flt(d.get_value('days_per_equipment'));
		let line = (label, plan, est) => {
			let is_over = flt(plan) > flt(est);
			let diff = flt(flt(plan) - flt(est), 2);
			return `<tr>
				<td>${frappe.utils.escape_html(label)}</td>
				<td>${flt(est)}</td>
				<td style="font-weight:600; color:${is_over ? 'var(--red-500, #e03131)' : 'inherit'};">
					${flt(plan)}${is_over ? ` (${__('over by {0}', [diff])})` : ''}
				</td>
			</tr>`;
		};
		let lines = [
			line(__('Quantity'), q, e.quantity),
			line(__('Days per Equipment'), dpu, e.days_per_equipment),
			line(__('Total Days'), flt(q * dpu, 2), e.total_days),
		];
		let roles = current_roles();
		est_trades.forEach(t => {
			let count = roles.filter(x => x.trade === t).reduce((s, x) => s + x.count, 0);
			lines.push(line(t, count, est_roles[t]));
		});
		let warn = roles.filter(x => !est_trades.includes(x.trade))
			.map(x => __('{0} is not a role of this equipment in the Estimation.', [frappe.utils.escape_html(x.trade)]));
		d.fields_dict.check_html.$wrapper.html(`
			<div class="nrb-table-wrapper">
				<table class="nrb-table">
					<thead><tr><th>${__('Item')}</th><th>${__('Estimation')}</th><th>${__('Plan')}</th></tr></thead>
					<tbody>${lines.join('')}</tbody>
				</table>
			</div>
			${warn.length ? `<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background: var(--red-50, #fff5f5); color: var(--red-600, #c92a2a);">${warn.map(w => '&bull; ' + w).join('<br>')}</div>` : ''}
			<div class="nrb-muted" style="margin-top:6px; font-size:11px;">${__('Values above the Estimation are allowed while drafting, but block submitting the plan.')}</div>
		`);
	}

	d = new frappe.ui.Dialog({
		title: __('Planning Scope: {0}', [row.equipment]),
		size: 'large',
		fields: [
			{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, default: row.quantity, onchange: () => render_check() },
			{ fieldname: 'cb_1', fieldtype: 'Column Break' },
			{ fieldname: 'days_per_equipment', fieldtype: 'Float', label: __('Days per Equipment'), reqd: 1, default: row.days_per_equipment, onchange: () => render_check() },
			{ fieldname: 'sb_crew', fieldtype: 'Section Break', label: __('Crew') },
			{
				fieldname: 'roles', fieldtype: 'Table', label: __('Crew'),
				cannot_add_rows: false, in_place_edit: false,
				data: initial, get_data: () => initial,
				fields: [
					{ fieldname: 'trade', fieldtype: 'Link', options: 'Designation', label: __('Trade'), reqd: 1, in_list_view: 1,
					  get_query: () => ({ filters: { name: ['in', est_trades] } }) },
					{ fieldname: 'count', fieldtype: 'Int', label: __('Count'), reqd: 1, default: 1, in_list_view: 1 }
				]
			},
			{ fieldname: 'sb_check', fieldtype: 'Section Break', label: __('Plan vs Estimation') },
			{ fieldname: 'check_html', fieldtype: 'HTML' }
		],
		primary_action_label: __('Save'),
		primary_action: function(values) {
			frappe.call({
				method: PS_METHOD + 'update_planning_scope',
				args: { name: name, values: { quantity: values.quantity, days_per_equipment: values.days_per_equipment, roles: current_roles() } },
				freeze: true,
				callback: function() {
					d.hide();
					frappe.show_alert({ message: __('Planning scope updated.'), indicator: 'green' });
					render_planning_scope(frm);
				}
			});
		},
		secondary_action_label: __('Remove from Plan'),
		secondary_action: function() {
			frappe.confirm(__('Remove {0} from the plan?', [frappe.utils.escape_html(row.equipment)]), () => frappe.call({
				method: PS_METHOD + 'delete_planning_scope',
				args: { name: name },
				freeze: true,
				callback: function() {
					d.hide();
					frappe.show_alert({ message: __('Removed from the plan.'), indicator: 'green' });
					render_planning_scope(frm);
				}
			}));
		}
	});
	d.show();
	ready = true;

	let wrap = d.fields_dict.roles.grid.wrapper;
	wrap.on('change awesomplete-selectcomplete', 'input', () => setTimeout(render_check, 200));
	wrap.on('click', '.grid-add-row, .grid-append-row, .grid-insert-row, .grid-delete-row, .grid-remove-rows', () => setTimeout(render_check, 200));
	render_check();
};

// ---------------------------------------------------------------------------
// Visit Edit dialog: live remaining per equipment + suggested Visit Team
// ---------------------------------------------------------------------------

function vd_wire_allocations(d, plan_name, visit_name) {
	if (!d.fields_dict.allocations) return;
	let ctx = null;
	let r2 = n => Math.round(flt(n) * 100) / 100;
	let esc = v => frappe.utils.escape_html(v || '');

	function current_alloc() {
		return (d.get_value('allocations') || []).filter(x => x.planning_scope);
	}
	function current_team() {
		return (d.get_value('team') || []).filter(x => x.trade);
	}
	function suggested_team(alloc, scope_map) {
		let team = {};
		alloc.forEach(a => {
			let s = scope_map[a.planning_scope];
			Object.keys((s && s.roles) || {}).forEach(t => { team[t] = Math.max(team[t] || 0, cint(s.roles[t])); });
		});
		return team;
	}

	function render() {
		let $a = d.fields_dict.allocations_remaining_html ? d.fields_dict.allocations_remaining_html.$wrapper : null;
		let $t = d.fields_dict.team_remaining_html ? d.fields_dict.team_remaining_html.$wrapper : null;
		if (!ctx) {
			if ($a) $a.html(`<div class="nrb-muted">${__('Loading...')}</div>`);
			return;
		}
		let scope_map = {};
		(ctx.scope || []).forEach(s => { scope_map[s.name] = s; });
		let alloc = current_alloc();

		// ---- remaining per equipment ----
		let warnings = [];
		let seen = {};
		alloc.forEach(a => {
			if (seen[a.planning_scope]) warnings.push(__('{0} is listed more than once.', [esc((scope_map[a.planning_scope] || {}).equipment || a.planning_scope)]));
			seen[a.planning_scope] = true;
		});
		let visit_days = 0;
		let rows = (ctx.scope || []).map(s => {
			let here = alloc.filter(x => x.planning_scope === s.name).reduce((t, x) => t + flt(x.quantity), 0);
			visit_days += here * flt(s.days_per_equipment);
			let remaining = r2(flt(s.quantity) - flt(s.allocated_elsewhere) - here);
			let color = remaining < 0 ? 'var(--red-500, #e03131)' : (remaining === 0 ? 'var(--green-500, #2b8a3e)' : 'var(--orange-500, #e8590c)');
			let text = remaining < 0 ? `${remaining} (${__('over by {0}', [Math.abs(remaining)])})` : remaining;
			return `<tr${here ? ' style="background: var(--control-bg, #f8f9fb);"' : ''}>
				<td>${esc(s.equipment)}</td>
				<td>${r2(s.quantity)}</td>
				<td>${r2(s.allocated_elsewhere)}</td>
				<td>${here ? `<b>${r2(here)}</b>` : '<span class="nrb-muted">-</span>'}</td>
				<td style="color:${color}; font-weight:600;">${text}</td>
			</tr>`;
		}).join('');
		if ($a) {
			$a.html(`
				<div class="nrb-table-wrapper" style="margin-top:6px;">
					<table class="nrb-table">
						<thead><tr>
							<th>${__('Equipment')}</th><th>${__('Planned')}</th><th>${__('Other Visits')}</th>
							<th>${__('This Visit')}</th><th>${__('Remaining')}</th>
						</tr></thead>
						<tbody>${rows}</tbody>
					</table>
				</div>
				<div class="nrb-muted" style="margin-top:6px; font-size:12px;">${__('Work days in this visit')}: <b>${r2(visit_days)}</b></div>
				${warnings.length ? `<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background: var(--red-50, #fff5f5); color: var(--red-600, #c92a2a);">${warnings.map(w => '&bull; ' + w).join('<br>')}</div>` : ''}
			`);
		}

		// ---- Visit Team: suggestion above the table, control table below ----
		let suggested = suggested_team(alloc, scope_map);
		let trades = Object.keys(suggested);
		let team = current_team();
		let team_map = {};
		team.forEach(x => { team_map[x.trade] = (team_map[x.trade] || 0) + cint(x.headcount); });

		let $s = d.fields_dict.team_suggest_html ? d.fields_dict.team_suggest_html.$wrapper : null;
		if ($s) {
			let suggestion = trades.length
				? trades.map(t => `${esc(t)} &times; ${suggested[t]}`).join(', ')
				: `<span class="nrb-muted">${__('Add equipment first.')}</span>`;
			$s.html(`
				<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; margin:14px 0 6px;">
					<div>
						<b>${__('Visit Team')}</b>
						<span class="nrb-muted" style="font-size:12px; margin-left:8px;">${__('Suggested')}: ${suggestion}</span>
					</div>
					${trades.length ? `<button class="btn btn-xs btn-default vd-use-suggested">${__('Use suggested team')}</button>` : ''}
				</div>
			`);
			$s.find('.vd-use-suggested').on('click', function() {
				d.fields_dict.team.df.data = trades.map(t => ({ trade: t, headcount: suggested[t] }));
				d.fields_dict.team.grid.refresh();
				render();
			});
		}

		if ($t) {
			let needed = {};
			alloc.forEach(a => {
				let s = scope_map[a.planning_scope];
				if (!s) return;
				let wd = flt(a.quantity) * flt(s.days_per_equipment);
				Object.keys(s.roles || {}).forEach(t => { needed[t] = (needed[t] || 0) + wd * cint(s.roles[t]); });
			});
			let effective = team.length ? team_map : suggested;
			let roles = trades.slice();
			Object.keys(team_map).forEach(t => { if (!roles.includes(t)) roles.push(t); });

			let days_by_role = {};
			let duration = 0, missing = [];
			roles.forEach(t => {
				if (!needed[t]) return;
				let hc = cint(effective[t]);
				if (!hc) { missing.push(t); return; }
				days_by_role[t] = needed[t] / hc;
				duration = Math.max(duration, days_by_role[t]);
			});
			if (d.fields_dict.visit_duration) d.set_value('visit_duration', missing.length ? 0 : r2(duration));

			let start_date = d.get_value('start_date'), end_date = d.get_value('end_date');
			let calendar = (start_date && end_date) ? frappe.datetime.get_diff(end_date, start_date) + 1 : 0;

			let rows = Object.keys(needed).map(t => {
				let sug = cint(suggested[t]);
				let hc = cint(effective[t]);
				let diff = hc - sug;
				let diff_color = diff === 0 ? 'var(--green-500, #2b8a3e)' : (diff > 0 ? 'var(--orange-500, #e8590c)' : 'var(--red-500, #e03131)');
				let diff_text = diff > 0 ? `+${diff}` : `${diff}`;
				let days = days_by_role[t];
				let days_cell;
				if (!needed[t]) {
					days_cell = '<span class="nrb-muted">-</span>';
				} else if (days === undefined) {
					days_cell = `<span style="color: var(--red-500, #e03131); font-weight:600;">${__('No one')}</span>`;
				} else {
					let decides = r2(days) === r2(duration);
					let over = calendar && days > calendar;
					let color = over ? 'var(--orange-600, #e8590c)' : 'inherit';
					days_cell = `<span style="color:${color}; font-weight:${decides ? 700 : 400};">${r2(days)}</span>`;
				}
				return `<tr style="background: var(--control-bg, #f8f9fb);">
					<td>${esc(t)}</td>
					<td>${r2(needed[t])}</td>
					<td>${hc || '-'}</td>
					<td>${days_by_role[t] === undefined ? `<span style="color: var(--red-500, #e03131); font-weight:600;">${__('No one')}</span>` : r2(days_by_role[t])}</td>
				</tr>`;
			}).join('');

			let notes = [];
			if (!team.length && trades.length) {
				notes.push(`<div class="nrb-muted" style="margin-top:6px; font-size:12px;">${__('The Visit Team is empty: the suggested team will be used when you save.')}</div>`);
			}
			if (roles.length && !missing.length) {
				notes.push(`<div style="margin-top:6px; font-size:12px;">${__('Visit duration with this team')}: <b>${r2(duration)}</b> ${__('days')}${calendar ? ` &middot; ${__('Visit period')}: ${calendar} ${__('calendar days')}` : ''}</div>`);
				if (calendar && duration > calendar) {
					notes.push(`<div style="margin-top:6px; padding:8px 10px; border-radius:8px; background: var(--orange-50, #fff4e6); color: var(--orange-700, #d9480f);">${__('This team needs {0} days, but the visit period is {1} days. Add people or extend the visit.', [r2(duration), calendar])}</div>`);
				}
			}
			if (missing.length && team.length) {
				notes.push(`<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background: var(--red-50, #fff5f5); color: var(--red-600, #c92a2a);">${missing.map(t => '&bull; ' + __('{0} is needed for the selected equipment but has no one in the Visit Team.', [esc(t)])).join('<br>')}</div>`);
			}

			$t.html(roles.length ? `
				<div class="nrb-table-wrapper" style="margin-top:6px;">
					<table class="nrb-table">
						<thead><tr>
							<th>${__('Role')}</th><th>${__('Person-days needed')}</th><th>${__('Headcount')}</th><th>${__('Days needed')}</th>
						</tr></thead>
						<tbody>${rows}</tbody>
					</table>
				</div>
				${notes.join('')}
			` : notes.join(''));
		}
	}

	function bind(field) {
		if (!field || !field.grid) return;
		let wrap = field.grid.wrapper;
		wrap.on('change awesomplete-selectcomplete', 'input', function() { setTimeout(render, 200); });
		wrap.on('click', '.grid-add-row, .grid-append-row, .grid-insert-row, .grid-delete-row, .grid-remove-rows', function() { setTimeout(render, 200); });
	}
	bind(d.fields_dict.allocations);
	bind(d.fields_dict.team);
	['start_date', 'end_date'].forEach(fn => {
		if (d.fields_dict[fn] && d.fields_dict[fn].$input) d.fields_dict[fn].$input.on('change', () => setTimeout(render, 100));
	});

	// Visit Team: only the roles of the selected equipment (or of the whole plan if none selected yet)
	function allowed_trades() {
		let scope = (ctx && ctx.scope) || [];
		let picked = current_alloc().map(a => a.planning_scope);
		let source = picked.length ? scope.filter(s => picked.includes(s.name)) : scope;
		let trades = [];
		source.forEach(s => Object.keys(s.roles || {}).forEach(t => { if (!trades.includes(t)) trades.push(t); }));
		return trades.length ? trades : ['__none__'];
	}
	let team_grid = d.fields_dict.team && d.fields_dict.team.grid;
	let trade_df = ((team_grid && team_grid.docfields) || (d.fields_dict.team && d.fields_dict.team.df.fields) || [])
		.find(x => x.fieldname === 'trade');
	if (trade_df) {
		trade_df.get_query = () => ({ filters: { name: ['in', allowed_trades()] } });
	}

	frappe.xcall('nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_visit_allocation_context',
		{ project_planning: plan_name, visit: visit_name })
		.then(r => { ctx = r || {}; render(); });
}
