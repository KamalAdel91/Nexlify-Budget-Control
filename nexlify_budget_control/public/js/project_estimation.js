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
