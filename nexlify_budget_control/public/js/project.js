frappe.ui.form.on('Project', {
    refresh: function(frm) {
        render_budget_dashboard(frm);
        render_mark_as_active_button(frm);
    }
});

// ---------------------------------------------------------------------------
// Mark as Active button
// ---------------------------------------------------------------------------

function render_mark_as_active_button(frm) {
    if (frm.doc.is_active === 'No') {
        let btn = frm.add_custom_button('Mark as Active', function() {
            handle_mark_as_active(frm);
        });

        btn.css({
            'background-color': 'black',
            'color': 'white',
            'border-color': 'black'
        });
    }
}

function handle_mark_as_active(frm) {
    if (!frm.doc.custom_budget_cost) {
        frappe.warn(
            'Budget Required',
            'No budget has been set for this project. You need to create a Project Cost Budget first before activating this project.',
            function() {
                frappe.new_doc('Project Cost Budget', {
                    project: frm.doc.name
                });
            },
            'Open New Budget'
        );
        return;
    }

    frappe.db.get_value('Project Cost Budget', frm.doc.custom_budget_cost, 'docstatus')
        .then(r => {
            let docstatus = r.message ? r.message.docstatus : null;

            if (docstatus === 1) {
                frappe.confirm(
                    'Are you sure you want to mark this project as Active?',
                    function() {
                        frm.set_value('is_active', 'Yes');
                        frm.save();
                    }
                );

            } else if (docstatus === 2) {
                frappe.warn(
                    'Linked Budget Was Cancelled',
                    `The budget previously linked to this project (<b>${frm.doc.custom_budget_cost}</b>) has been cancelled. ` +
                    'You need to either amend that budget or create a new one before activating this project.',
                    function() {
                        frappe.set_route('Form', 'Project Cost Budget', frm.doc.custom_budget_cost);
                    },
                    'Open Cancelled Budget'
                );

            } else {
                frappe.warn(
                    'Budget Not Submitted',
                    `The linked budget (<b>${frm.doc.custom_budget_cost}</b>) has not been submitted yet. ` +
                    'Please submit it before activating this project.',
                    function() {
                        frappe.set_route('Form', 'Project Cost Budget', frm.doc.custom_budget_cost);
                    },
                    'Open Budget'
                );
            }
        });
}

// ---------------------------------------------------------------------------
// Budget dashboard (Budget tab)
// ---------------------------------------------------------------------------

function render_budget_dashboard(frm) {
    if (frm.is_new()) {
        frm.set_df_property('custom_dashboard', 'options', '<p class="text-muted">Save the project first to see the budget dashboard.</p>');
        frm.refresh_field('custom_dashboard');
        return;
    }

    frm.set_df_property('custom_dashboard', 'options', '<p class="text-muted">Loading budget dashboard...</p>');
    frm.refresh_field('custom_dashboard');

    frappe.call({
        method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_budget_dashboard',
        args: {
            project: frm.doc.name
        },
        callback: function(r) {
            let data = r.message;
            let html = build_dashboard_html(data, frm);
            frm.set_df_property('custom_dashboard', 'options', html);
            frm.refresh_field('custom_dashboard');
        }
    });
}

function build_dashboard_html(data, frm) {
    if (!data || !data.has_budget) {
        return `
            <div class="text-muted" style="padding: 15px;">
                No Cost Budget linked to this project yet.
            </div>
        `;
    }

    if (!data.is_submitted) {
        return `
            <div class="text-muted" style="padding: 15px;">
                The linked budget (<b>${data.budget_name}</b>) has not been submitted yet.
                <br>
                <a href="/app/project-cost-budget/${data.budget_name}">Open Budget</a>
            </div>
        `;
    }

    let currency = data.currency || '';

    let rows_html = data.rows.map(row => {
        let pct = row.percentage_used.toFixed(1);
        let bar_color = pct >= 100 ? '#dc3545' : (pct >= 80 ? '#ffc107' : '#28a745');

        return `
            <tr>
                <td>${row.budget_category}</td>
                <td class="text-right">${format_currency(row.estimated_amount, currency)}</td>
                <td class="text-right">${format_currency(row.cumulative_expense_amount, currency)}</td>
                <td class="text-right">${format_currency(row.remaining_amount, currency)}</td>
                <td style="min-width: 120px;">
                    <div style="background: #eee; border-radius: 4px; height: 16px; overflow: hidden;">
                        <div style="background: ${bar_color}; height: 100%; width: ${Math.min(pct, 100)}%;"></div>
                    </div>
                    <small>${pct}%</small>
                </td>
            </tr>
        `;
    }).join('');

    let total_pct = data.total_percentage_used.toFixed(1);
    let total_bar_color = total_pct >= 100 ? '#dc3545' : (total_pct >= 80 ? '#ffc107' : '#28a745');

    return `
        <div style="padding: 10px 0;">
            <div style="margin-bottom: 10px;">
                <a href="/app/project-cost-budget/${data.budget_name}"><b>${data.budget_name}</b></a>
                <span class="text-muted"> &middot; ${frappe.datetime.str_to_user(data.from_date)} - ${frappe.datetime.str_to_user(data.to_date)}</span>
            </div>
            <table class="table table-bordered" style="font-size: 13px;">
                <thead>
                    <tr>
                        <th>Budget Category</th>
                        <th class="text-right">Estimated</th>
                        <th class="text-right">Actual / Cumulative</th>
                        <th class="text-right">Remaining</th>
                        <th>% Used</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows_html}
                </tbody>
                <tfoot>
                    <tr style="font-weight: bold;">
                        <td>Total</td>
                        <td class="text-right">${format_currency(data.total_estimated, currency)}</td>
                        <td class="text-right">${format_currency(data.total_cumulative, currency)}</td>
                        <td class="text-right">${format_currency(data.total_remaining, currency)}</td>
                        <td style="min-width: 120px;">
                            <div style="background: #eee; border-radius: 4px; height: 16px; overflow: hidden;">
                                <div style="background: ${total_bar_color}; height: 100%; width: ${Math.min(total_pct, 100)}%;"></div>
                            </div>
                            <small>${total_pct}%</small>
                        </td>
                    </tr>
                </tfoot>
            </table>
        </div>
    `;
}

function format_currency(value, currency) {
    return frappe.format(value, { fieldtype: 'Currency', options: currency });
}