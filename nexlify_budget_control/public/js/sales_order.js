// A Sales Order made for a Plan's invoice is put on hold when Planning undoes the Job Completion.
frappe.ui.form.on('Sales Order', {
	refresh(frm) {
		if (frm.doc.docstatus === 0 && frm.doc.custom_on_hold_by_planning) {
			frm.set_intro(__("On hold: Planning undid the Job Completion of this order's invoice. It can be submitted after Planning completes it again."), 'red');
		}
	},
});
