// A Quotation made from an Opportunity: once submitted, back to the Opportunity for the signed copy and the contract
frappe.ui.form.on('Quotation', {
	on_submit(frm) {
		if (!frm.doc.opportunity) return;
		const d = new frappe.ui.Dialog({
			title: __('Quotation submitted'),
			fields: [{
				fieldname: 'next', fieldtype: 'HTML',
				options: `<p>${__('Print it for the customer. When it comes back signed, attach it to Signed Quotation on the Opportunity, then send the contract.')}</p>`,
			}],
			primary_action_label: __('Back to the Opportunity'),
			primary_action() {
				d.hide();
				frappe.set_route('Form', 'Opportunity', frm.doc.opportunity);
			},
			secondary_action_label: __('Stay here'),
			secondary_action() {
				d.hide();
			},
		});
		d.show();
	},
});

// A Quotation of an Opportunity with an Estimation: its lines and prices come from the Estimation, no discount;
// Sales may rename and describe the lines
frappe.ui.form.on('Quotation', {
	refresh(frm) {
		if (!frm.doc.opportunity || frm.doc.docstatus !== 0) return;
		frappe.db.get_value('Opportunity', frm.doc.opportunity, 'custom_estimation').then((r) => {
			if (!(r && r.message && r.message.custom_estimation)) return;
			['additional_discount_percentage', 'discount_amount'].forEach((f) => frm.set_df_property(f, 'read_only', 1));
			const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
			if (!grid) return;
			['item_code', 'qty', 'uom', 'rate', 'price_list_rate', 'discount_percentage', 'discount_amount',
				'margin_type', 'margin_rate_or_amount', 'amount'].forEach((f) => grid.update_docfield_property(f, 'read_only', 1));
			frm.set_df_property('items', 'cannot_add_rows', true);
			frm.set_df_property('items', 'cannot_delete_rows', true);
			grid.refresh();
		});
	},
});
