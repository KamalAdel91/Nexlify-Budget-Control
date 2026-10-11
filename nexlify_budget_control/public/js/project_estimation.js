frappe.ui.form.on('Project Estimation', {
    on_submit: function(frm) {
        if (!frm.doc.project && frm.doc.opportunity) {
            frappe.msgprint({
                title: __('Sent to Sales'),
                indicator: 'green',
                message: __('The Estimation is submitted. Opportunity {0} now shows the prices to the Sales team.', ['<b>' + frm.doc.opportunity + '</b>']),
                primary_action: {
                    label: __('Go to Opportunity'),
                    action: function() { frappe.set_route('Form', 'Opportunity', frm.doc.opportunity); }
                }
            });
            return;
        }
        frappe.msgprint({
            title: 'Budget Activated',
            message: `This budget has been successfully linked to project <b>${frm.doc.project}</b>.`,
            primary_action: {
                label: 'Go to Project',
                action: function() {
                    frappe.set_route('Form', 'Project', frm.doc.project);
                }
            }
        });
    }
});

// Return to Estimation (COO / CEO), Request Changes and Reprice need a reason
frappe.ui.form.on('Project Estimation', {
	before_workflow_action(frm) {
		const action = frm.selected_workflow_action || '';
		if (!action.startsWith('Return') && !['Request Changes', 'Reprice'].includes(action)) return;
		return new Promise((resolve, reject) => {
			frappe.dom.unfreeze();
			let done = false;
			const d = new frappe.ui.Dialog({
				title: __(action),
				fields: [{ fieldname: 'reason', fieldtype: 'Small Text', label: __('Reason'), reqd: 1 }],
				primary_action_label: __(action),
				primary_action(v) {
					done = true;
					d.hide();
					frappe.call({
						method: 'nexlify_budget_control.nexlify_budget_control.doctype.project_estimation.project_estimation.set_return_reason',
						args: { name: frm.doc.name, reason: v.reason },
						freeze: true
					}).then(() => { frappe.dom.freeze(); resolve(); }, () => reject());
				}
			});
			d.onhide = () => { if (!done) reject(); };
			d.show();
		});
	}
});
