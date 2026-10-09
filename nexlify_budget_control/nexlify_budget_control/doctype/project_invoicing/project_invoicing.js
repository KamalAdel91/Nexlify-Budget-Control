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

// The invoice is read-only while its Plan is approved or waiting for approval (the server keeps the same lock).
frappe.ui.form.on('Project Invoicing', {
	refresh(frm) {
		if (frm.is_new() || !frm.doc.project_planning) return;
		frappe.xcall('nexlify_budget_control.nexlify_budget_control.job_completion.plan_editable',
			{ project_planning: frm.doc.project_planning }).then(editable => {
			if (editable) return;
			frm.disable_form();
			frm.set_intro(__('The Plan is approved or waiting for approval, so this invoice is read-only. Job Completion is done from the Plan.'), 'blue');
		});
	},
});
