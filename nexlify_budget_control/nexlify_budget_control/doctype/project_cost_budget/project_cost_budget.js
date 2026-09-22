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
	frm.add_custom_button(__('Add Equipment'), () => open_add_equipment_scope_dialog(frm), __('Equipment Scope'));
	frm.add_custom_button(__('Edit Equipment'), () => open_edit_equipment_scope_dialog(frm), __('Equipment Scope'));
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
			_cached_equipment_scope = data.rows || [];
			let trade_columns = data.trade_columns || [];

			if (!_cached_equipment_scope.length) {
				frm.set_df_property('equipment_scope_summary_html', 'options', `<div class="text-muted" style="padding:16px; text-align:center; border:1px dashed var(--border-color, #e9ecef); border-radius:10px;">${__('No equipment added yet. Use "Add Equipment" above.')}</div>`);
				frm.refresh_field('equipment_scope_summary_html');
				return;
			}

			let trade_headers = trade_columns.map(t => `<th>${frappe.utils.escape_html(t)}</th>`).join('');

			let total_days_sum = 0;
			let rows_html = _cached_equipment_scope.map(row => {
				total_days_sum += flt(row.total_days);
				let status_badge = row.docstatus === 1
					? `<span style="color: var(--green-600, #2b8a3e); font-weight:600;">${__('Submitted')}</span>`
					: `<span class="text-muted">${__('Draft')}</span>`;
				let edit_link = row.docstatus === 0
					? `<a href="#" onclick="open_equipment_scope_edit_single('${row.name}'); return false;">${__('Edit')}</a>`
					: '';
				let details_link = `<a href="/app/project-equipment-scope/${row.name}" target="_blank">${__('Details')}</a>`;

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
						<td>${status_badge}</td>
						<td>${edit_link}${edit_link ? ' | ' : ''}${details_link}</td>
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
								<th>${__('Status')}</th>
								<th>${__('Actions')}</th>
							</tr>
						</thead>
						<tbody>${rows_html}</tbody>
						<tfoot>
							<tr>
								<td colspan="${3 + trade_columns.length}" style="text-align:right;">${__('Total Work Days')}</td>
								<td>${total_days_sum}</td>
								<td colspan="2"></td>
							</tr>
						</tfoot>
					</table>
				</div>
			`;

			frm.set_df_property('equipment_scope_summary_html', 'options', html);
			frm.refresh_field('equipment_scope_summary_html');
		}
	});
}
