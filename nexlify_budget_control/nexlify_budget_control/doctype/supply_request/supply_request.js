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
