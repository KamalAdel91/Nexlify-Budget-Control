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
