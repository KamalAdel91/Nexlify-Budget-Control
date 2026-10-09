// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on('Supply Request', {
	refresh(frm) {
		if (frm.doc.status !== 'Pending' || !frappe.model.can_create('Supplier Quotation')) return;
		frm.add_custom_button(__('Supplier Quotation'), () => {
			frappe.xcall('nexlify_budget_control.nexlify_budget_control.supply_chain.make_supplier_quotation', { supply_request: frm.doc.name })
				.then(doc => {
					frappe.model.sync(doc);
					frappe.set_route('Form', doc.doctype, doc.name);
				});
		}, __('Create'));
	},
});

// Choose and Send Prices: the Send Prices action with a quotation picked for each item (cheapest preselected).
frappe.ui.form.on('Supply Request', {
	refresh(frm) {
		if (frm.doc.status !== 'Pending' || !(frm.perm[0] && frm.perm[0].write)) return;
		frm.add_custom_button(__('Choose and Send Prices'), () => sr_choose_and_send(frm));
	},
});

function sr_choose_and_send(frm) {
	const M = 'nexlify_budget_control.nexlify_budget_control.supply_chain.';
	frappe.xcall(M + 'get_quotation_choices', { supply_request: frm.doc.name }).then(r => {
		const offer = (o, row) => `${o.supplier_name || o.supplier} · ${format_currency(o.rate, r.currency)} / ${row.uom || __('unit')}` + ` · ${__('Total')} ${format_currency(o.rate * row.qty, r.currency)}`
			+ (o.valid_till ? ` · ${__('valid till {0}', [frappe.datetime.str_to_user(o.valid_till)])}` : '');
		const fields = r.rows.map((row, i) => row.options.length
			? { fieldname: `q${i}`, fieldtype: 'Select', reqd: 1, default: row.chosen,
				label: `${row.item_code} (${row.qty} ${row.uom || ''})`,
				options: row.options.map(o => ({ value: o.quotation, label: offer(o, row) })) }
			: { fieldname: `q${i}`, fieldtype: 'HTML',
				options: `<p class="text-danger">${frappe.utils.escape_html(row.item_code)}: ${__('no submitted quotation yet')}</p>` });
		const d = new frappe.ui.Dialog({
			title: __('Choose a quotation for each item'),
			fields,
			primary_action_label: __('Send Prices'),
			primary_action(values) {
				const choices = {};
				r.rows.forEach((row, i) => { if (values[`q${i}`]) choices[row.row] = values[`q${i}`]; });
				frappe.xcall(M + 'send_prices_with_choices', { supply_request: frm.doc.name, choices })
					.then(() => { d.hide(); frm.reload_doc(); });
			},
		});
		d.show();
	});
}
