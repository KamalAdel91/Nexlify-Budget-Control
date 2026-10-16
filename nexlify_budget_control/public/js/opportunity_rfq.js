// ERPNext asks the server for open activities on every refresh, even before the
// Opportunity is saved. For non-admin users the server then looks for the temporary
// "new-opportunity-..." name and answers "not found". A new document has no
// activities yet, so skip the call until it is saved.
if (window.erpnext && erpnext.utils && erpnext.utils.CRMActivities && !erpnext.utils.CRMActivities.__nx_skip_new) {
	const nx_orig_refresh = erpnext.utils.CRMActivities.prototype.refresh;
	erpnext.utils.CRMActivities.prototype.refresh = function() {
		if (this.frm && this.frm.is_new()) return;
		return nx_orig_refresh.apply(this, arguments);
	};
	erpnext.utils.CRMActivities.__nx_skip_new = true;
}

// RFQ tab: Send To Estimation, shown above the RFQ Items while the RFQ is not sent yet
frappe.ui.form.on('Opportunity', {
	refresh(frm) { nexlify_render_rfq_actions(frm); nexlify_render_estimation_view(frm); nexlify_lock_closed(frm); },
	custom_estimation_status(frm) { nexlify_render_rfq_actions(frm); },
});

function nexlify_render_rfq_actions(frm) {
	const field = frm.get_field('custom_rfq_actions_html');
	if (!field) return;
	if (frm.is_new() || (frm.doc.custom_estimation_status || 'Not Sent') !== 'Not Sent') {
		field.$wrapper.html('');
		return;
	}
	field.$wrapper.html(`<div style="display:flex; justify-content:flex-end; margin-bottom:8px;">
		<button class="btn btn-sm btn-primary nexlify-send-estimation">${__('Send To Estimation')}</button></div>`);
	field.$wrapper.find('.nexlify-send-estimation').on('click', () => {
		if (frm.is_dirty()) {
			frappe.msgprint(__('Save the Opportunity first.'));
			return;
		}
		frappe.xcall('nexlify_budget_control.nexlify_budget_control.opportunity_rfq.check_send_to_estimation',
			{ opportunity: frm.doc.name }).then((missing) => {
			if ((missing || []).length) {
				frappe.msgprint({ title: __('Missing information'), indicator: 'red',
					message: '<b>' + __('Complete these before sending to Estimation:') + '</b><br>'
						+ missing.map(m => '&bull; ' + frappe.utils.escape_html(m)).join('<br>') });
				return;
			}
			nexlify_confirm_send_estimation(frm);
		});
	});
}

function nexlify_confirm_send_estimation(frm) {
	frappe.confirm(__('Send this RFQ to Estimation? The RFQ Items cannot be changed after sending.'), () => {
		frappe.call({
			method: 'nexlify_budget_control.nexlify_budget_control.opportunity_rfq.send_to_estimation',
			args: { opportunity: frm.doc.name },
			freeze: true,
			freeze_message: __('Creating the Estimation...'),
			callback(r) {
				if (!r.message) return;
				frappe.show_alert({ message: __('Estimation {0} created', [r.message]), indicator: 'green' });
				frm.reload_doc();
			},
		});
	});
}

function nexlify_render_estimation_view(frm) {
	const field = frm.get_field('custom_estimation_html');
	if (!field || frm.is_new()) return;
	nexlify_rfq_styles();
	const esc = frappe.utils.escape_html;
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.opportunity_rfq.get_estimation_for_opportunity',
		args: { opportunity: frm.doc.name },
		callback(r) { nexlify_est_states().then((g) => {
			const d = r.message || {};
			const pill = !d.status ? 'gray' : [...g.with_sales, ...g.agreed, ...g.won, ...g.handed_over].includes(d.status) ? 'green' : g.lost.includes(d.status) ? 'gray' : 'orange';
			const money = v => format_currency(v, d.currency);
			const sub = d.estimation ? __('Estimation {0}', [esc(d.estimation)]) : __('No Estimation yet');
			const head = (right) => `<div class="nx-rfq-head">
				<div><div class="nx-rfq-title">${__('Selling Prices')}</div><div class="nx-rfq-sub">${sub}</div></div>
				<div class="nx-rfq-right"><span class="nx-pill ${pill}">${__(d.status || 'Not Sent')}</span>${right || ''}</div></div>`;

			if (!d.submitted) {
				const msg = !d.estimation
					? [__('Not sent to Estimation yet'), __('Add the RFQ Items above and use Send To Estimation.')]
					: [__('The Estimation team is preparing the prices'), __('The prices appear here once the Estimation is sent to Sales.')];
				field.$wrapper.html(`<div class="nx-rfq-card">${head()}<div class="nx-empty"><b>${msg[0]}</b>${msg[1]}</div></div>`);
				return;
			}
			const revise = (g.with_sales.includes(d.status) && !['Closed Won', 'Closed Lost'].includes(frm.doc.sales_stage))
				? `<button class="btn btn-xs btn-default nx-request-revision" style="margin-left:8px">${__('Request Revision')}</button>` : '';
			const can_send = [...g.with_sales, ...g.changes_requested].includes(d.status)
				&& !['Closed Won', 'Closed Lost', 'Closed Lost to Competition'].includes(frm.doc.sales_stage);
			const send = can_send ? `<button class="btn btn-xs btn-default nx-make-quotation" style="margin-left:8px">${__('Make Quotation')}</button>`
				+ `<button class="btn btn-xs btn-primary nx-send-contract" style="margin-left:8px">${__('Send Contract')}</button>` : '';
			const notes = d.notes ? `<div style="margin:12px 0 0;padding:10px 12px;border-radius:8px;background:var(--subtle-fg, #f8f8f8);font-size:13px"><div class="nx-rfq-sub">${__('Notes from Estimation')}</div>${esc(d.notes)}</div>` : '';
			const rounds = (d.rounds || []).length ? `<div style="margin:12px 0 0"><div class="nx-rfq-sub">${__('Contract rounds')}</div>`
				+ d.rounds.map(r => `<div style="font-size:12.5px;padding:4px 0;border-bottom:1px solid var(--border-color, #ededed)"><b>${__('Round {0}', [r.round_no])}</b> · ${esc(__(r.event || ''))} · ${esc(r.by_name || '')} · ${frappe.datetime.str_to_user(r.sent_on)}${r.comment ? `<div class="text-muted">${esc(r.comment)}</div>` : ''}</div>`).join('') + '</div>' : '';
			const body = (d.rows || []).map(x => `<tr>
				<td>${esc(x.equipment || '')}</td>
				<td class="nx-num">${format_number(x.quantity)}</td>
				<td class="nx-num">${money(x.unit_price)}</td>
				<td class="nx-num">${money(x.total_price)}</td></tr>`).join('');
			field.$wrapper.html(`<div class="nx-rfq-card">
				${head(`<span class="nx-total">${money(d.total)}</span>${revise}${send}`)}
				<div class="nx-rfq-scroll"><table class="nx-rfq-table">
					<thead><tr><th>${__('Equipment Scope')}</th><th class="nx-num">${__('Qty')}</th>
						<th class="nx-num">${__('Unit Price')}</th><th class="nx-num">${__('Total Price')}</th></tr></thead>
					<tbody>${body}</tbody>
					<tfoot><tr><td colspan="3" class="nx-num">${__('Total')}</td><td class="nx-num">${money(d.total)}</td></tr></tfoot>
				</table></div>${notes}${rounds}</div>`);
			field.$wrapper.find('.nx-request-revision').on('click', () => nexlify_request_revision(frm));
			field.$wrapper.find('.nx-send-contract').on('click', () => nexlify_send_contract(frm));
			field.$wrapper.find('.nx-make-quotation').on('click', () => frappe.model.open_mapped_doc({
				method: 'erpnext.crm.doctype.opportunity.opportunity.make_quotation', frm }));
		});
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

function nexlify_request_revision(frm) {
	frappe.prompt({ fieldname: 'reason', fieldtype: 'Small Text', label: __('What should the Estimation team revise?'), reqd: 1 }, (v) => {
		frappe.call({
			method: 'nexlify_budget_control.nexlify_budget_control.opportunity_rfq.request_estimation_revision',
			args: { opportunity: frm.doc.name, reason: v.reason },
			freeze: true,
			callback() {
				frappe.show_alert({ message: __('Sent back to Estimation'), indicator: 'orange' });
				frm.reload_doc();
			},
		});
	}, __('Request Revision'), __('Send Back'));
}

// A closed Opportunity (won or lost) is read only. The Signed Contract stays open while the Estimation is Won (before the Handover).
function nexlify_lock_closed(frm) {
	nexlify_est_states().then((g) => nexlify_lock_closed_with(frm, g));
}

function nexlify_lock_closed_with(frm, g) {
	const closed = ['Closed Won', 'Closed Lost', 'Closed Lost to Competition'].includes(frm.doc.sales_stage);
	if (frm.is_new() || !closed || frappe.user.has_role('System Manager')) return;
	const contract_open = g.won.includes(frm.doc.custom_estimation_status);
	(frm.meta.fields || []).forEach(df => {
		if (frappe.model.no_value_type.includes(df.fieldtype) && !frappe.model.table_fields.includes(df.fieldtype)) return;
		if (contract_open && df.fieldname === 'custom_signed_contract') return;
		frm.set_df_property(df.fieldname, 'read_only', 1);
	});
	if (!contract_open) frm.disable_save();
	frm.dashboard.set_headline_alert(__('This Opportunity is {0} and cannot be changed.', [__(frm.doc.sales_stage)]), 'gray');
}

// The Estimation Workflow states by group, read from the Workflow on the server, loaded once per page.
function nexlify_est_states() {
	if (!window.__nx_est_states) {
		window.__nx_est_states = frappe.xcall('nexlify_budget_control.nexlify_budget_control.estimation_flow.get_state_groups')
			.then((g) => (window.__nx_est_groups = g));
	}
	return window.__nx_est_states;
}

// Sales sends the customer's contract and our submitted Quotation to the Estimation team.
function nexlify_send_contract(frm) {
	frappe.db.get_list('Quotation', { filters: { opportunity: frm.doc.name, docstatus: 1 }, fields: ['name'], order_by: 'creation desc', limit: 1 }).then((q) => {
		if (!q.length) {
			frappe.msgprint(__('Make the Quotation first: Make Quotation in the price card, then Submit it.'));
			return;
		}
		if (!frm.doc.custom_signed_quotation) {
			frappe.msgprint(__('Attach the Quotation signed by the customer (Signed Quotation) first.'));
			return;
		}
		const d = new frappe.ui.Dialog({
			title: __('Send Contract to Estimation'),
			fields: [
				{ fieldname: 'contract', fieldtype: 'Attach', label: __('Contract'), reqd: 1 },
				{ fieldname: 'quotation', fieldtype: 'Link', options: 'Quotation', label: __('Quotation'), reqd: 1,
					default: q.length ? q[0].name : null,
					get_query: () => ({ filters: { opportunity: frm.doc.name, docstatus: 1 } }) },
				{ fieldname: 'comment', fieldtype: 'Small Text', label: __('Comment') },
			],
			primary_action_label: __('Send'),
			primary_action(v) {
				frappe.call({
					method: 'nexlify_budget_control.nexlify_budget_control.opportunity_rfq.send_contract',
					args: { opportunity: frm.doc.name, contract: v.contract, quotation: v.quotation, comment: v.comment },
					freeze: true,
					callback() {
						d.hide();
						frappe.show_alert({ message: __('Contract sent to Estimation'), indicator: 'green' });
						frm.reload_doc();
					},
				});
			},
		});
		d.show();
	});
}

// The Opportunity's Items, value and currency come from the approved Estimation: Sales may only rename and describe the lines
frappe.ui.form.on('Opportunity', {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.custom_estimation || !(frm.doc.items || []).length) return;
		['opportunity_amount', 'currency', 'conversion_rate'].forEach((f) => frm.set_df_property(f, 'read_only', 1));
		frm.set_df_property('opportunity_amount', 'description', __('From the approved Estimation: a price changes through Request Revision.'));
		frm.toggle_display('items', true);
		const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
		if (!grid) return;
		['item_code', 'qty', 'uom', 'rate', 'amount'].forEach((f) => grid.update_docfield_property(f, 'read_only', 1));
		frm.set_df_property('items', 'cannot_add_rows', true);
		frm.set_df_property('items', 'cannot_delete_rows', true);
		grid.refresh();
	},
});
