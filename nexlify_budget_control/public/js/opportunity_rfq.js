// RFQ tab: Send To Estimation, shown above the RFQ Items while the RFQ is not sent yet
frappe.ui.form.on('Opportunity', {
	refresh(frm) { nexlify_render_rfq_actions(frm); nexlify_render_estimation_view(frm); },
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
		if (!(frm.doc.custom_rfq_items || []).length) {
			frappe.msgprint({ title: __('RFQ Items required'), indicator: 'red',
				message: __('Add at least one RFQ Item before sending to Estimation.') });
			return;
		}
		if (frm.doc.opportunity_from !== 'Customer') {
			frappe.msgprint({ title: __('Customer required'), indicator: 'red',
				message: __('Only an Opportunity for a Customer can be sent to Estimation.') });
			return;
		}
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
		callback(r) {
			const d = r.message || {};
			const pill = { 'Estimated': 'green', 'With Estimation': 'orange' }[d.status] || 'gray';
			const money = v => format_currency(v, d.currency);
			const sub = d.estimation ? __('Estimation {0}', [esc(d.estimation)]) : __('No Estimation yet');
			const head = (right) => `<div class="nx-rfq-head">
				<div><div class="nx-rfq-title">${__('Selling Prices')}</div><div class="nx-rfq-sub">${sub}</div></div>
				<div class="nx-rfq-right"><span class="nx-pill ${pill}">${__(d.status || 'Not Sent')}</span>${right || ''}</div></div>`;

			if (!d.submitted) {
				const msg = !d.estimation
					? [__('Not sent to Estimation yet'), __('Add the RFQ Items above and use Send To Estimation.')]
					: [__('The Estimation team is preparing the prices'), __('The prices appear here once the Estimation is submitted.')];
				field.$wrapper.html(`<div class="nx-rfq-card">${head()}<div class="nx-empty"><b>${msg[0]}</b>${msg[1]}</div></div>`);
				return;
			}
			const body = (d.rows || []).map(x => `<tr>
				<td>${esc(x.equipment || '')}</td>
				<td class="nx-num">${format_number(x.quantity)}</td>
				<td class="nx-num">${money(x.unit_price)}</td>
				<td class="nx-num">${money(x.total_price)}</td></tr>`).join('');
			field.$wrapper.html(`<div class="nx-rfq-card">
				${head(`<span class="nx-total">${money(d.total)}</span>`)}
				<div class="nx-rfq-scroll"><table class="nx-rfq-table">
					<thead><tr><th>${__('Equipment Scope')}</th><th class="nx-num">${__('Qty')}</th>
						<th class="nx-num">${__('Unit Price')}</th><th class="nx-num">${__('Total Price')}</th></tr></thead>
					<tbody>${body}</tbody>
					<tfoot><tr><td colspan="3" class="nx-num">${__('Total')}</td><td class="nx-num">${money(d.total)}</td></tr></tfoot>
				</table></div></div>`);
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
