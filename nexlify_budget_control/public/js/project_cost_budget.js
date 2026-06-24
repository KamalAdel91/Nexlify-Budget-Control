frappe.ui.form.on('Project Cost Budget', {
    on_submit: function(frm) {
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
