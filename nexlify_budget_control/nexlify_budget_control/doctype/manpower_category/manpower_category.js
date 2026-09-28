frappe.ui.form.on('Manpower Category', {
	refresh(frm) {
		const f = frm.get_field('sort_order');
		if (f && f.$input) f.$input.attr({ type: 'number', min: 1, step: 1 });
		if (frm.is_new() && !cint(frm.doc.sort_order)) {
			frappe.db.get_list('Manpower Category', { fields: ['sort_order'], order_by: 'sort_order desc', limit: 1 })
				.then(r => frm.set_value('sort_order', cint((r[0] || {}).sort_order) + 1));
		}
	},
});
