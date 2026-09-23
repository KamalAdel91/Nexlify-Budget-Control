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
		frm.ignore_doctypes_on_cancel_all = ['Project Visit Day'];
		inject_visits_invoices_styles();
		render_add_visits_button(frm);
		render_add_invoice_button(frm);
		render_visits_table(frm);
		render_invoices_table(frm);
		render_estimation_overview(frm);
		render_plan_control_on_form(frm);
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
	row(['start_date', 'end_date', 'working_days'], 'sb_dates');

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
												in_list_view: 1
											};
											if (f.fieldname === 'sub_periods' && cf.fieldname === 'equipment') {
												field_def.get_query = function() {
													return { filters: { name: ['in', allowed_equipment] } };
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
										dialog_fields.push({ fieldname: 'visit_days_html', fieldtype: 'HTML' });
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
									if (d.fields_dict.crew) row.crew = d.get_value('crew') || [];
									if (d.fields_dict.equipment) row.equipment = d.get_value('equipment') || [];
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

							let set_working_days_promise = Promise.resolve();
							if (full_doc.working_days !== undefined && full_doc.working_days !== null) {
								set_working_days_promise = d.set_value('working_days', full_doc.working_days);
							}

							set_working_days_promise.then(function() {
								render_visit_days_in_dialog(d, visit.name, plan_name);
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
				frm.set_df_property('estimation_overview_html', 'options', `<div class="text-muted" style="padding:16px; text-align:center; border:1px dashed var(--border-color, #e9ecef); border-radius:10px;">${__('No Costing (Estimation) submitted yet for this project.')}</div>`);
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
// Plan vs Estimation - whole-plan control view (planning form + visit dialog)
// ---------------------------------------------------------------------------

function vd_control_cell(planned, est, strict) {
	let r = n => Math.round(flt(n) * 100) / 100;
	let rem = r(est - planned);
	let color = rem < 0 ? 'var(--red-500, #e03131)' : (rem === 0 ? 'var(--green-500, #2b8a3e)' : (strict ? 'var(--orange-500, #e8590c)' : 'var(--text-muted, #6c757d)'));
	let text = rem < 0 ? __('over by {0}', [Math.abs(rem)]) : (rem === 0 ? __('complete') : __('{0} left', [rem]));
	return `<div><b>${r(planned)}</b> / ${r(est)}</div><div style="color:${color}; font-size:11px; font-weight:600;">${text}</div>`;
}

function vd_plan_control_html(ctx) {
	let scope = ctx.scope || {};
	let equipments = Object.keys(scope);
	if (!equipments.length) {
		return `<div class="nrb-empty">${__('No submitted Estimation for this project yet.')}</div>`;
	}

	let trades = [];
	equipments.forEach(eq => Object.keys(scope[eq].roles).forEach(t => { if (!trades.includes(t)) trades.push(t); }));

	let over = 0;
	let under = 0;
	let tot = { days_est: 0, days_plan: 0, trade_est: {}, trade_plan: {} };

	let rows = equipments.map(eq => {
		let s = scope[eq];
		let u = (ctx.used || {})[eq] || { quantity: 0, person_days: {} };
		let days_plan = flt(u.quantity) * s.days_per_equipment;
		tot.days_est += s.total_days;
		tot.days_plan += days_plan;
		if (flt(u.quantity) > s.quantity) over++;
		if (flt(u.quantity) < s.quantity) under++;

		let trade_cells = trades.map(t => {
			if (!(t in s.roles)) return `<td><span class="nrb-muted">-</span></td>`;
			let est = s.roles[t] * s.total_days;
			let plan = flt((u.person_days || {})[t]);
			tot.trade_est[t] = (tot.trade_est[t] || 0) + est;
			tot.trade_plan[t] = (tot.trade_plan[t] || 0) + plan;
			if (plan > est) over++;
			return `<td>${vd_control_cell(plan, est)}</td>`;
		}).join('');

		return `<tr>
			<td>${frappe.utils.escape_html(eq)}</td>
			<td>${vd_control_cell(u.quantity, s.quantity, true)}</td>
			<td>${vd_control_cell(days_plan, s.total_days)}</td>
			${trade_cells}
		</tr>`;
	}).join('');

	let foot = `<tr style="background: var(--control-bg, #f8f9fb); font-weight:600;">
		<td>${__('Total')}</td>
		<td></td>
		<td>${vd_control_cell(tot.days_plan, tot.days_est)}</td>
		${trades.map(t => `<td>${vd_control_cell(tot.trade_plan[t] || 0, tot.trade_est[t] || 0)}</td>`).join('')}
	</tr>`;

	let box = (bg, fg, text) => `<div style="margin-bottom:8px; padding:8px 10px; border-radius:8px; background:${bg}; color:${fg}; font-weight:600;">${text}</div>`;
	let banner = '';
	if (over) {
		banner += box('var(--red-50, #fff5f5)', 'var(--red-600, #c92a2a)', __('{0} item(s) are over the Estimation. Submitting the plan is blocked until they are fixed.', [over]));
	}
	if (under) {
		banner += box('var(--orange-50, #fff4e6)', 'var(--orange-700, #d9480f)', __('{0} equipment not fully planned yet. Submitting the plan is blocked until all quantities are planned.', [under]));
	}
	if (!over && !under) {
		banner = box('var(--green-50, #ebfbee)', 'var(--green-700, #2b8a3e)', __('The plan covers the full Estimation and is within it.'));
	}

	let min_width = (3 + trades.length) * 120;
	return `${banner}
		<div class="nrb-table-wrapper">
			<table class="nrb-table" style="min-width:${min_width}px;">
				<thead><tr>
					<th>${__('Equipment')}</th><th>${__('Quantity')}</th><th>${__('Work Days')}</th>
					${trades.map(t => `<th>${frappe.utils.escape_html(t)} ${__('(person-days)')}</th>`).join('')}
				</tr></thead>
				<tbody>${rows}${foot}</tbody>
			</table>
		</div>`;
}

function vd_render_plan_control($target, plan_name, show_title) {
	if (!$target || !$target.length || !plan_name) return;
	$target.html(`<div class="nrb-muted">${__('Loading plan control...')}</div>`);
	frappe.xcall('nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_visit_day_context', { project_planning: plan_name })
		.then(ctx => {
			let title = show_title
				? `<div style="margin:0 0 6px;"><b>${__('Plan vs Estimation')}</b> <span class="nrb-muted">${__('(whole plan)')}</span></div>`
				: '';
			$target.html(title + vd_plan_control_html(ctx || {}));
		});
}

function render_plan_control_on_form(frm) {
	if (!frm.fields_dict.plan_control_html) return;
	if (frm.is_new()) {
		frm.fields_dict.plan_control_html.$wrapper.html('');
		return;
	}
	vd_render_plan_control(frm.fields_dict.plan_control_html.$wrapper, frm.doc.name, false);
}

// ---------------------------------------------------------------------------
// Visit Days - day-level plan inside each visit (one equipment per entry, crew by role)
// ---------------------------------------------------------------------------

let _visit_day_ctx = null;
const VD_METHOD = 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.';

function vd_r2(n) { return Math.round(flt(n) * 100) / 100; }

function vd_live_row(label, estimated, other, current) {
	let remaining = vd_r2(estimated - other - current);
	let color = remaining < 0 ? 'var(--red-500, #e03131)' : (remaining === 0 ? 'var(--green-500, #2b8a3e)' : 'var(--orange-500, #e8590c)');
	let over = remaining < 0 ? ` (${__('over by {0}', [Math.abs(remaining)])})` : '';
	return `<tr>
		<td>${frappe.utils.escape_html(label)}</td>
		<td>${vd_r2(estimated)}</td>
		<td>${vd_r2(other)}</td>
		<td>${vd_r2(current)}</td>
		<td style="color:${color}; font-weight:600;">${remaining}${over}</td>
	</tr>`;
}

function vd_live_table(rows_html) {
	return `
		<div class="nrb-table-wrapper">
			<table class="nrb-table">
				<thead><tr>
					<th>${__('Item')}</th><th>${__('Estimated')}</th><th>${__('Other Days')}</th>
					<th>${__('This Day')}</th><th>${__('Remaining')}</th>
				</tr></thead>
				<tbody>${rows_html}</tbody>
			</table>
		</div>`;
}

function vd_warnings_html(warnings) {
	return warnings.length
		? `<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background: var(--red-50, #fff5f5); color: var(--red-600, #c92a2a);">${warnings.map(w => '&bull; ' + w).join('<br>')}</div>`
		: '';
}

const VD_NOTE = `<div class="nrb-muted" style="margin-top:6px; font-size:11px;">${__('Over-distribution does not block saving. It is enforced when the Project Planning is submitted.')}</div>`;

// Live check for one equipment entry: quantity, work days and person-days per trade
function vd_live_html(ctx, eq, qty_now, roles) {
	if (!ctx) return `<div class="nrb-muted">${__('Loading...')}</div>`;
	if (!eq) return `<div class="nrb-muted">${__('Select an equipment to see the Estimation check.')}</div>`;
	let scope = (ctx.scope || {})[eq];
	if (!scope) {
		return `<div style="color: var(--red-500, #e03131); font-weight:600;">${__("{0} is not part of this project's Estimation.", [frappe.utils.escape_html(eq)])}</div>`;
	}
	let used = (ctx.used || {})[eq] || { quantity: 0, person_days: {} };
	roles = (roles || []).filter(x => x.trade);

	let rows = [];
	rows.push(vd_live_row(__('Quantity'), scope.quantity, used.quantity, qty_now));
	rows.push(vd_live_row(__('Work Days'), scope.total_days, used.quantity * scope.days_per_equipment, flt(qty_now) * scope.days_per_equipment));
	Object.keys(scope.roles).forEach(trade => {
		let allowed = scope.roles[trade] * scope.total_days;
		let today = roles.filter(x => x.trade === trade).reduce((s, x) => s + cint(x.count), 0);
		rows.push(vd_live_row(__('{0} (person-days)', [trade]), allowed, (used.person_days || {})[trade] || 0, today));
	});

	let warnings = [];
	let seen = {};
	roles.forEach(x => {
		let label = frappe.utils.escape_html(x.trade);
		if (seen[x.trade]) warnings.push(__('{0} is listed more than once.', [label]));
		seen[x.trade] = true;
		if (!(x.trade in scope.roles)) warnings.push(__('{0} is not a required role for {1}.', [label, frappe.utils.escape_html(eq)]));
		if (cint(x.count) <= 0) warnings.push(__('Count for {0} must be greater than zero.', [label]));
	});

	// Productivity: faster than the Estimation rate is allowed, only flagged
	let notices = [];
	let est_trades = Object.keys(scope.roles);
	let factor = est_trades.length
		? Math.min(...est_trades.map(t => {
			let planned = roles.filter(x => x.trade === t).reduce((s, x) => s + cint(x.count), 0);
			return scope.roles[t] ? planned / scope.roles[t] : 0;
		}))
		: 0;
	let needed = flt(qty_now) * scope.days_per_equipment;
	if (needed > 0 && needed > factor + 0.0001) {
		let max_units = scope.days_per_equipment ? vd_r2(factor / scope.days_per_equipment) : 0;
		notices.push(__('At the Estimation rate, this crew completes about {0} unit(s) of {1} per day, and {2} are planned. This is faster than the Estimation.', [max_units, frappe.utils.escape_html(eq), vd_r2(qty_now)]));
	}
	let notices_html = notices.length
		? `<div style="margin-top:8px; padding:8px 10px; border-radius:8px; background: var(--orange-50, #fff4e6); color: var(--orange-700, #d9480f);">${notices.map(w => '&bull; ' + w).join('<br>')}</div>`
		: '';

	return vd_live_table(rows.join('')) + vd_warnings_html(warnings) + notices_html + VD_NOTE;
}

function vd_bind_grid(grid_field, handler) {
	let wrap = grid_field.grid.wrapper;
	wrap.on('change awesomplete-selectcomplete', 'input', function() { setTimeout(handler, 200); });
	wrap.on('click', '.grid-add-row, .grid-append-row, .grid-insert-row, .grid-delete-row, .grid-remove-rows', function() { setTimeout(handler, 200); });
}

// ---------------------------------------------------------------------------
// Days list inside the visit Edit dialog (grouped by date)
// ---------------------------------------------------------------------------

function render_visit_days_in_dialog(d, visit_name, plan_name) {
	let prev = _visit_day_ctx;
	let open_dates = (prev && prev.visit_name === visit_name && prev.open_dates) ? prev.open_dates : new Set();
	_visit_day_ctx = { d: d, visit_name: visit_name, plan_name: plan_name, days: [], open_dates: open_dates };
	if (!d.fields_dict.visit_days_html) return;

	frappe.call({
		method: VD_METHOD + 'get_visit_days',
		args: { visit: visit_name },
		callback: function(r) {
			let data = r.message || {};
			let days = data.days || [];
			_visit_day_ctx.days = days;
			let plan_locked = !!(_revenue_budget_frm && _revenue_budget_frm.doc.docstatus === 1);
			if (d.fields_dict.working_days) {
				d.set_value('working_days', data.working_days || 0);
			}

			let groups = {};
			let order = [];
			days.forEach(day => {
				if (!groups[day.work_date]) { groups[day.work_date] = []; order.push(day.work_date); }
				groups[day.work_date].push(day);
			});

			let body = order.map(date => {
				let entries = groups[date];
				let people = entries.reduce((s, day) => s + (day.roles || []).reduce((t, x) => t + cint(x.count), 0), 0);
				let work_days = vd_r2(entries.reduce((s, day) => s + flt(day.days_consumed), 0));
				let is_open = open_dates.has(date);
				let header = `<tr class="vd-day-header" data-date="${date}" style="background: var(--control-bg, #f8f9fb); cursor:pointer;">
					<td colspan="6">
						<span class="vd-chevron" style="display:inline-block; width:14px;">${is_open ? '&#9662;' : '&#9656;'}</span>
						<b>${frappe.datetime.str_to_user(date)}</b>
						<span class="nrb-muted"> &middot; ${__('{0} equipment', [entries.length])} &middot; ${__('{0} people', [people])} &middot; ${__('{0} work days', [work_days])}</span>
					</td>
				</tr>`;
				let rows = entries.map(day => {
					let crew = (day.roles || []).length
						? day.roles.map(x => `${frappe.utils.escape_html(x.trade || '')} &times; ${cint(x.count)}`).join('<br>')
						: '<span class="nrb-muted">-</span>';
					let status = day.docstatus === 1
						? `<span style="color: var(--green-600, #2b8a3e); font-weight:600;">${__('Submitted')}</span>`
						: `<span class="nrb-muted">${__('Draft')}</span>`;
					let edit_link = (day.docstatus === 0 && !plan_locked)
						? `<a href="#" class="nrb-link" onclick="open_visit_day_from_list('${day.name}'); return false;">${__('Edit')}</a> | `
						: '';
					return `<tr class="vd-day-row" data-date="${date}" style="${is_open ? '' : 'display:none;'}">
						<td>${frappe.utils.escape_html(day.equipment || '')}</td>
						<td>${flt(day.quantity)}</td>
						<td>${flt(day.days_consumed)}</td>
						<td>${crew}</td>
						<td>${status}</td>
						<td>${edit_link}<a href="/app/project-visit-day/${day.name}" class="nrb-link" target="_blank">${__('Details')}</a></td>
					</tr>`;
				}).join('');
				return header + rows;
			}).join('');

			let table_html = days.length
				? `
					<div class="nrb-table-wrapper">
						<table class="nrb-table">
							<thead><tr>
								<th>${__('Equipment')}</th><th>${__('Qty')}</th><th>${__('Days')}</th>
								<th>${__('Crew')}</th><th>${__('Status')}</th><th>${__('Actions')}</th>
							</tr></thead>
							<tbody>${body}</tbody>
						</table>
					</div>
				`
				: `<div class="nrb-empty">${__('No days planned for this visit yet.')}</div>`;

			let action = plan_locked
				? `<span class="nrb-muted">${__('Plan is submitted. Cancel and Amend it to change days.')}</span>`
				: `<button class="btn btn-xs btn-default" onclick="open_plan_day_from_list(); return false;">${__('Plan a Day')}</button>`;

			let toggles = days.length
				? `<a href="#" class="nrb-link vd-expand-all" style="font-size:11px; margin-left:10px;">${__('Expand all')}</a>
				   <span class="nrb-muted" style="font-size:11px;">|</span>
				   <a href="#" class="nrb-link vd-collapse-all" style="font-size:11px;">${__('Collapse all')}</a>`
				: '';

			let $w = d.fields_dict.visit_days_html.$wrapper;
			$w.html(`
				<div style="display:flex; justify-content:space-between; align-items:center; margin:12px 0 6px;">
					<div><b>${__('Visit Days')}</b>${toggles}</div>
					${action}
				</div>
				${table_html}
				<div class="vd-plan-control" style="margin-top:14px;"></div>
			`);

			function set_open(date, open) {
				$w.find(`.vd-day-row[data-date="${date}"]`).toggle(open);
				$w.find(`.vd-day-header[data-date="${date}"] .vd-chevron`).html(open ? '&#9662;' : '&#9656;');
				if (open) open_dates.add(date); else open_dates.delete(date);
			}
			$w.find('.vd-day-header').on('click', function() {
				let date = $(this).attr('data-date');
				set_open(date, !open_dates.has(date));
			});
			$w.find('.vd-expand-all').on('click', function(e) { e.preventDefault(); order.forEach(dt => set_open(dt, true)); });
			$w.find('.vd-collapse-all').on('click', function(e) { e.preventDefault(); order.forEach(dt => set_open(dt, false)); });

			vd_render_plan_control($w.find('.vd-plan-control'), plan_name, true);
		}
	});
}

function vd_refresh_after_save() {
	if (!_visit_day_ctx) return;
	let ctx = _visit_day_ctx;
	render_visit_days_in_dialog(ctx.d, ctx.visit_name, ctx.plan_name);
	if (_revenue_budget_frm) {
		render_visits_table(_revenue_budget_frm);
		render_plan_control_on_form(_revenue_budget_frm);
	}
}

window.open_visit_day_from_list = function(day_name) {
	if (!_visit_day_ctx) return;
	let ctx = _visit_day_ctx;
	open_visit_day_dialog(ctx.visit_name, ctx.plan_name, day_name, vd_refresh_after_save);
};

window.open_plan_day_from_list = function() {
	if (!_visit_day_ctx) return;
	let ctx = _visit_day_ctx;
	open_plan_day_dialog(ctx.visit_name, ctx.plan_name, ctx.days || [], vd_refresh_after_save);
};

// ---------------------------------------------------------------------------
// Plan a Day: date + several equipment, then crew per equipment, saved together
// ---------------------------------------------------------------------------

function open_plan_day_dialog(visit_name, plan_name, existing_days, on_saved) {
	Promise.all([
		frappe.db.get_value('Project Visits', visit_name, ['start_date', 'end_date']),
		frappe.xcall(VD_METHOD + 'get_visit_day_context', { project_planning: plan_name })
	]).then(([visit_r, ctx]) => {
		let visit_vals = (visit_r && visit_r.message) || {};
		ctx = ctx || {};
		let last = (existing_days || []).map(x => x.work_date).sort().pop();
		let default_date = visit_vals.start_date;
		if (last) {
			let next = moment(last).add(1, 'days').format('YYYY-MM-DD');
			default_date = (visit_vals.end_date && next > visit_vals.end_date) ? last : next;
		}
		build_plan_day_step1(visit_name, plan_name, ctx, visit_vals, default_date, existing_days || [], on_saved);
	});
}

function build_plan_day_step1(visit_name, plan_name, ctx, visit_vals, default_date, existing_days, on_saved) {
	var d;
	let ready = false;
	let scope_names = Object.keys(ctx.scope || {});

	function render_step1_live() {
		if (!ready) return;
		let rows = (d.get_value('rows') || []).filter(x => x.equipment);
		if (!rows.length) {
			d.fields_dict.live_html.$wrapper.html(`<div class="nrb-muted">${__('Add the equipment worked on this day.')}</div>`);
			return;
		}
		let html_rows = [];
		let warnings = [];
		let seen = {};
		let date = d.get_value('work_date');
		rows.forEach(x => {
			let eq = x.equipment;
			let label = frappe.utils.escape_html(eq);
			if (seen[eq]) warnings.push(__('{0} is listed more than once. Use one row per equipment.', [label]));
			seen[eq] = true;
			if (existing_days.some(e => e.work_date === date && e.equipment === eq)) {
				warnings.push(__('{0} is already planned on this date. Edit that entry instead.', [label]));
			}
			let scope = (ctx.scope || {})[eq];
			if (!scope) { warnings.push(__("{0} is not part of this project's Estimation.", [label])); return; }
			let used = (ctx.used || {})[eq] || { quantity: 0 };
			html_rows.push(vd_live_row(__('{0} - Quantity', [eq]), scope.quantity, used.quantity, x.quantity));
			html_rows.push(vd_live_row(__('{0} - Work Days', [eq]), scope.total_days, used.quantity * scope.days_per_equipment, flt(x.quantity) * scope.days_per_equipment));
		});
		d.fields_dict.live_html.$wrapper.html(vd_live_table(html_rows.join('')) + vd_warnings_html(warnings) + VD_NOTE);
	}

	d = new frappe.ui.Dialog({
		title: __('Plan a Day'),
		size: 'large',
		fields: [
			{
				fieldname: 'work_date', fieldtype: 'Date', label: __('Work Date'), reqd: 1, default: default_date,
				description: __('Visit period: {0} to {1}', [frappe.datetime.str_to_user(visit_vals.start_date), frappe.datetime.str_to_user(visit_vals.end_date)]),
				onchange: function() { render_step1_live(); }
			},
			{ fieldname: 'sb_eq', fieldtype: 'Section Break', label: __('Equipment worked on this day') },
			{
				fieldname: 'rows', fieldtype: 'Table', label: __('Equipment'),
				cannot_add_rows: false, in_place_edit: false,
				data: [{}], get_data: function() { return [{}]; },
				fields: [
					{
						fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1, in_list_view: 1,
						get_query: function() { return { filters: { name: ['in', scope_names] } }; }
					},
					{ fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1, in_list_view: 1 }
				]
			},
			{ fieldname: 'sb_check', fieldtype: 'Section Break', label: __('Estimation Check') },
			{ fieldname: 'live_html', fieldtype: 'HTML' }
		],
		primary_action_label: __('Next: Crew'),
		primary_action: function(values) {
			let rows = (d.get_value('rows') || []).filter(x => x.equipment);
			if (!rows.length) { frappe.msgprint(__('Add at least one equipment.')); return; }
			let names = rows.map(x => x.equipment);
			let dup = names.find((n, i) => names.indexOf(n) !== i);
			if (dup) { frappe.msgprint(__('{0} is listed more than once. Use one row per equipment.', [dup])); return; }
			let already = existing_days.filter(e => e.work_date === values.work_date && names.includes(e.equipment)).map(e => e.equipment);
			if (already.length) { frappe.msgprint(__('Already planned on this date: {0}. Edit those entries instead.', [already.join(', ')])); return; }

			let entries = rows.map(x => ({ equipment: x.equipment, quantity: flt(x.quantity), roles: null }));
			d.hide();
			collect_plan_day_crew(visit_name, ctx, values.work_date, entries, 0, on_saved);
		}
	});
	d.show();
	ready = true;
	vd_bind_grid(d.fields_dict.rows, render_step1_live);
	render_step1_live();
}

function collect_plan_day_crew(visit_name, ctx, work_date, entries, index, on_saved) {
	if (index >= entries.length) {
		frappe.call({
			method: VD_METHOD + 'bulk_create_visit_days',
			args: { visit: visit_name, work_date: work_date, rows: entries },
			freeze: true,
			freeze_message: __('Saving the day plan...'),
			callback: function(r) {
				frappe.show_alert({ message: __('{0} entries planned for {1}.', [(r.message || []).length, frappe.datetime.str_to_user(work_date)]), indicator: 'green' });
				if (_visit_day_ctx && _visit_day_ctx.open_dates) _visit_day_ctx.open_dates.add(work_date);
				if (on_saved) on_saved();
			}
		});
		return;
	}

	var d;
	let ready = false;
	let entry = entries[index];
	let scope = (ctx.scope || {})[entry.equipment];

	// First visit to this step: pre-fill the crew from the Estimation for this equipment
	let initial_roles = entry.roles
		? entry.roles.map(x => ({ trade: x.trade, count: x.count }))
		: Object.keys((scope && scope.roles) || {}).map(t => ({ trade: t, count: scope.roles[t] }));

	function current_roles() {
		return (d.get_value('roles') || [])
			.filter(x => x.trade)
			.map(x => ({ trade: x.trade, count: cint(x.count) }));
	}

	function render_live() {
		if (!ready) return;
		d.fields_dict.live_html.$wrapper.html(vd_live_html(ctx, entry.equipment, entry.quantity, current_roles()));
	}

	let opts = {
		title: __('Crew for {0} ({1}/{2}) - {3}', [entry.equipment, index + 1, entries.length, frappe.datetime.str_to_user(work_date)]),
		size: 'large',
		fields: [
			{
				fieldname: 'info', fieldtype: 'HTML',
				options: `<div class="nrb-muted" style="margin-bottom:6px;">${__('Quantity on this day')}: <b>${flt(entry.quantity)}</b>. ${__('Crew is pre-filled from the Estimation; adjust as needed.')}</div>`
			},
			{
				fieldname: 'roles', fieldtype: 'Table', label: __('Crew'),
				cannot_add_rows: false, in_place_edit: false,
				data: initial_roles, get_data: function() { return initial_roles; },
				fields: [
					{
						fieldname: 'trade', fieldtype: 'Link', options: 'Designation', label: __('Trade'), reqd: 1, in_list_view: 1,
						get_query: function() {
							return scope ? { filters: { name: ['in', Object.keys(scope.roles)] } } : {};
						}
					},
					{ fieldname: 'count', fieldtype: 'Int', label: __('Count'), reqd: 1, default: 1, in_list_view: 1 }
				]
			},
			{ fieldname: 'sb_check', fieldtype: 'Section Break', label: __('Estimation Check') },
			{ fieldname: 'live_html', fieldtype: 'HTML' }
		],
		primary_action_label: index === entries.length - 1 ? __('Finish & Save') : __('Next'),
		primary_action: function() {
			entry.roles = current_roles();
			d.hide();
			collect_plan_day_crew(visit_name, ctx, work_date, entries, index + 1, on_saved);
		}
	};

	if (index > 0) {
		opts.secondary_action_label = __('Back');
		opts.secondary_action = function() {
			entry.roles = current_roles();
			d.hide();
			collect_plan_day_crew(visit_name, ctx, work_date, entries, index - 1, on_saved);
		};
	}

	d = new frappe.ui.Dialog(opts);
	d.show();
	ready = true;
	vd_bind_grid(d.fields_dict.roles, render_live);
	render_live();
}

// ---------------------------------------------------------------------------
// Edit a single entry (one equipment on one date)
// ---------------------------------------------------------------------------

function open_visit_day_dialog(visit_name, plan_name, day_name, on_saved) {
	frappe.db.get_value('Project Visits', visit_name, ['start_date', 'end_date']).then(visit_r => {
		let visit_vals = (visit_r && visit_r.message) || {};
		if (!day_name) {
			build_visit_day_dialog(visit_name, plan_name, null, visit_vals, on_saved);
			return;
		}
		frappe.call({
			method: VD_METHOD + 'get_visit_days',
			args: { visit: visit_name },
			callback: function(r) {
				let day = (((r.message || {}).days) || []).find(x => x.name === day_name);
				build_visit_day_dialog(visit_name, plan_name, day || null, visit_vals, on_saved);
			}
		});
	});
}

function build_visit_day_dialog(visit_name, plan_name, day, visit_vals, on_saved) {
	var d;
	let ready = false;
	let ctx = null;
	let initial_roles = ((day && day.roles) || []).map(x => ({ trade: x.trade, count: x.count }));

	function scope_for(eq) {
		return eq && ctx && ctx.scope ? ctx.scope[eq] : null;
	}

	function current_roles() {
		return (d.get_value('roles') || []).filter(x => x.trade).map(x => ({ trade: x.trade, count: cint(x.count) }));
	}

	function render_live() {
		if (!ready) return;
		d.fields_dict.live_html.$wrapper.html(vd_live_html(ctx, d.get_value('equipment'), flt(d.get_value('quantity')), current_roles()));
	}

	let opts = {
		title: day ? __('Edit Visit Day') : __('Add Visit Day'),
		size: 'large',
		fields: [
			{
				fieldname: 'work_date', fieldtype: 'Date', label: __('Work Date'), reqd: 1,
				default: day ? day.work_date : visit_vals.start_date,
				description: __('Visit period: {0} to {1}', [frappe.datetime.str_to_user(visit_vals.start_date), frappe.datetime.str_to_user(visit_vals.end_date)])
			},
			{ fieldname: 'cb_1', fieldtype: 'Column Break' },
			{
				fieldname: 'equipment', fieldtype: 'Link', options: 'Equipment Type', label: __('Equipment'), reqd: 1,
				default: day ? day.equipment : null,
				get_query: function() {
					return { filters: { name: ['in', Object.keys((ctx && ctx.scope) || {})] } };
				},
				onchange: function() { render_live(); }
			},
			{
				fieldname: 'quantity', fieldtype: 'Float', label: __('Quantity'), reqd: 1,
				default: day ? day.quantity : null,
				onchange: function() { render_live(); }
			},
			{ fieldname: 'sb_crew', fieldtype: 'Section Break', label: __('Crew') },
			{
				fieldname: 'roles', fieldtype: 'Table', label: __('Crew'),
				cannot_add_rows: false, in_place_edit: false,
				data: initial_roles, get_data: function() { return initial_roles; },
				fields: [
					{
						fieldname: 'trade', fieldtype: 'Link', options: 'Designation', label: __('Trade'), reqd: 1, in_list_view: 1,
						get_query: function() {
							let scope = scope_for(d ? d.get_value('equipment') : null);
							return scope ? { filters: { name: ['in', Object.keys(scope.roles)] } } : {};
						}
					},
					{ fieldname: 'count', fieldtype: 'Int', label: __('Count'), reqd: 1, default: 1, in_list_view: 1 }
				]
			},
			{ fieldname: 'sb_check', fieldtype: 'Section Break', label: __('Estimation Check') },
			{ fieldname: 'live_html', fieldtype: 'HTML' }
		],
		primary_action_label: __('Save'),
		primary_action: function(values) {
			frappe.call({
				method: VD_METHOD + 'save_visit_day',
				args: {
					values: {
						name: day ? day.name : null,
						visit: visit_name,
						work_date: values.work_date,
						equipment: values.equipment,
						quantity: values.quantity,
						roles: current_roles()
					}
				},
				freeze: true,
				callback: function() {
					d.hide();
					frappe.show_alert({ message: __('Visit Day saved.'), indicator: 'green' });
					if (_visit_day_ctx && _visit_day_ctx.open_dates) _visit_day_ctx.open_dates.add(values.work_date);
					if (on_saved) on_saved();
				}
			});
		}
	};

	if (day) {
		opts.secondary_action_label = __('Delete');
		opts.secondary_action = function() {
			frappe.confirm(__('Delete this Visit Day?'), function() {
				frappe.call({
					method: VD_METHOD + 'delete_visit_day',
					args: { name: day.name },
					freeze: true,
					callback: function() {
						d.hide();
						frappe.show_alert({ message: __('Visit Day deleted.'), indicator: 'green' });
						if (on_saved) on_saved();
					}
				});
			});
		};
	}

	d = new frappe.ui.Dialog(opts);
	d.show();
	ready = true;
	vd_bind_grid(d.fields_dict.roles, render_live);

	frappe.call({
		method: VD_METHOD + 'get_visit_day_context',
		args: { project_planning: plan_name, exclude_day: day ? day.name : null },
		callback: function(r) {
			ctx = r.message || {};
			render_live();
		}
	});
}
