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

// A Quotation of an Opportunity with an Estimation: its lines and prices come from the Estimation, no discount
frappe.ui.form.on('Quotation', {
	refresh(frm) {
		if (!frm.doc.opportunity || frm.doc.docstatus !== 0) return;
		frappe.db.get_value('Opportunity', frm.doc.opportunity, 'custom_estimation').then((r) => {
			if (!(r && r.message && r.message.custom_estimation)) return;
			['items', 'additional_discount_percentage', 'discount_amount'].forEach((f) => frm.set_df_property(f, 'read_only', 1));
		});
	},
});
