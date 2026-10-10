// Hand-off Log: who a tracked document waits on, and since when, at the top of its form.
(() => {
    const METHOD = 'nexlify_budget_control.nexlify_budget_control.hand_off.get_hand_off';
    ['Project Estimation', 'Supply Request', 'Project Planning', 'Project Overview', 'Project Invoicing'].forEach((doctype) => {
        frappe.ui.form.on(doctype, {
            refresh(frm) {
                if (frm.is_new()) return;
                const name = frm.doc.name;
                frappe.xcall(METHOD, { doctype: frm.doctype, name }).then((r) => {
                    if (!r || !r.is_open || frm.doc.name !== name) return;
                    const days = Math.floor(r.duration_days || 0);
                    const since = frappe.datetime.str_to_user(r.entered_on);
                    frm.dashboard.set_headline_alert(days
                        ? __('{0}: waiting on {1} for {2} days, since {3}', [__(r.stage), r.waiting_on, days, since])
                        : __('{0}: waiting on {1} since {2}', [__(r.stage), r.waiting_on, since]), 'blue');
                });
            },
        });
    });
})();
