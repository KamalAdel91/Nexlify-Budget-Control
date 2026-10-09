// Get Items From > Supply Request: one Supplier Quotation can price the items of several pending Supply Requests.
frappe.ui.form.on('Supplier Quotation', {
	refresh(frm) {
		if (frm.doc.docstatus !== 0) return;
		frm.add_custom_button(__('Supply Request'), () => sq_get_supply_requests(frm), __('Get Items From'));
	},
});

function sq_get_supply_requests(frm) {
	if (!frm.doc.company) {
		frappe.msgprint(__('Choose the Company first.'));
		return;
	}
	const d = new frappe.ui.form.MultiSelectDialog({
		doctype: 'Supply Request',
		target: frm,
		setters: { customer: null },
		date_field: 'creation',
		get_query() {
			return { filters: { status: 'Pending', company: frm.doc.company } };
		},
		action(selections) {
			if (!selections.length) return;
			frappe.xcall('nexlify_budget_control.nexlify_budget_control.supply_chain.get_supply_request_items',
				{ supply_requests: selections, company: frm.doc.company }).then(rows => {
				const have = new Set((frm.doc.items || []).map(i => `${i.custom_supply_request}|${i.item_code}`));
				frm.doc.items = (frm.doc.items || []).filter(i => i.item_code);
				let added = 0;
				rows.filter(r => !have.has(`${r.custom_supply_request}|${r.item_code}`)).forEach(r => {
					frm.add_child('items', r);
					added++;
				});
				frm.refresh_field('items');
				d.dialog.hide();
				frappe.show_alert({ message: __('{0} items added', [added]), indicator: 'green' });
			});
		},
	});
	if (d.dialog.get_secondary_btn) d.dialog.get_secondary_btn().addClass('hidden'); // requests are made only from the Estimation
}
