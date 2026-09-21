// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on("Project Invoicing", {
	refresh: function(frm) {
		apply_visits_filter(frm);
	},
	project_planning: function(frm) {
		apply_visits_filter(frm);
	}
});

function apply_visits_filter(frm) {
	if (!frm.fields_dict.visits) return;

	frm.set_query('visits', function() {
		return {
			filters: {
				project_planning: frm.doc.project_planning || ''
			}
		};
	});
}
