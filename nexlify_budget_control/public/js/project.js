frappe.ui.form.on('Project', {
    refresh: function(frm) {
        inject_dashboard_styles();
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
// Injected styles - dark-mode aware (Frappe CSS vars) + fully responsive
// ---------------------------------------------------------------------------

function inject_dashboard_styles() {
    if (document.getElementById('nbc-dashboard-styles')) return;

    let style = document.createElement('style');
    style.id = 'nbc-dashboard-styles';
    style.innerHTML = `
        .nbc-dash { padding: 6px 2px 16px 2px; }

        .nbc-kpi-row {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            margin-bottom: 16px;
        }
        .nbc-kpi-card {
            flex: 1 1 180px;
            min-width: 0;
            background: var(--card-bg, var(--fg-color, #f8f9fb));
            border: 1px solid var(--border-color, #e9ecef);
            border-radius: 10px;
            padding: 12px 14px;
        }
        .nbc-kpi-label {
            font-size: 11px;
            font-weight: 600;
            color: var(--text-muted, #6c757d);
            text-transform: uppercase;
            letter-spacing: 0.4px;
            margin-bottom: 6px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .nbc-kpi-value {
            font-size: clamp(16px, 4vw, 22px);
            font-weight: 700;
            line-height: 1.2;
            word-break: break-word;
        }
        .nbc-kpi-sub {
            font-size: 11px;
            color: var(--text-muted, #6c757d);
            margin-top: 4px;
        }

        .nbc-progress-block {
            margin-bottom: 20px;
            padding: 12px 14px;
            background: var(--card-bg, var(--fg-color, #f8f9fb));
            border: 1px solid var(--border-color, #e9ecef);
            border-radius: 8px;
        }
        .nbc-progress-head {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 6px;
            gap: 8px;
        }
        .nbc-progress-track {
            background: var(--control-bg, #e9ecef);
            border-radius: 6px;
            height: 9px;
            overflow: hidden;
        }
        .nbc-progress-fill { height: 100%; transition: width 0.3s ease; }

        .nbc-section-title-row {
            display: flex;
            justify-content: space-between;
            align-items: baseline;
            gap: 8px;
            margin-bottom: 10px;
            flex-wrap: wrap;
        }
        .nbc-section-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-color, inherit);
        }

        .nbc-table-wrapper {
            border: 1px solid var(--border-color, #e9ecef);
            border-radius: 10px;
            overflow-x: auto;
            margin-bottom: 20px;
            -webkit-overflow-scrolling: touch;
        }
        .nbc-table {
            width: 100%;
            min-width: 480px;
            border-collapse: collapse;
            font-size: 12.5px;
        }
        .nbc-table thead tr {
            background: var(--control-bg, #f8f9fb);
            border-bottom: 1px solid var(--border-color, #e9ecef);
        }
        .nbc-table th {
            padding: 9px 10px;
            text-align: left;
            font-size: 10.5px;
            font-weight: 600;
            color: var(--text-muted, #6c757d);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            white-space: nowrap;
        }
        .nbc-table td {
            padding: 9px 10px;
            border-bottom: 1px solid var(--border-color, #e9ecef);
            color: var(--text-color, inherit);
        }
        .nbc-table tfoot tr { background: var(--control-bg, #f8f9fb); }
        .nbc-text-right { text-align: right; }
        .nbc-bold { font-weight: 700; }
        .nbc-pct-cell { min-width: 130px; }
        .nbc-pct-wrap { display: flex; align-items: center; gap: 6px; }
        .nbc-pct-track {
            flex: 1;
            background: var(--control-bg, #e9ecef);
            border-radius: 5px;
            height: 7px;
            overflow: hidden;
            min-width: 40px;
        }
        .nbc-pct-fill { height: 100%; }
        .nbc-pct-label { font-size: 10.5px; font-weight: 600; min-width: 36px; text-align: right; }

        .nbc-docs-wrapper {
            border: 1px solid var(--border-color, #e9ecef);
            border-radius: 10px;
            overflow: hidden;
        }
        .nbc-docs-toggle {
            padding: 11px 14px;
            background: var(--control-bg, #f8f9fb);
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .nbc-docs-toggle-label {
            font-size: 13px;
            font-weight: 700;
            color: var(--text-color, inherit);
        }
        .nbc-docs-chevron {
            font-size: 11px;
            color: var(--text-muted, #6c757d);
            transition: transform 0.2s ease;
        }
        .nbc-docs-body { display: none; padding: 12px 14px; }
        .nbc-docs-content { font-size: 12.5px; color: var(--text-muted, #6c757d); }

        .nbc-doc-section { margin-bottom: 14px; }
        .nbc-doc-section-title {
            font-size: 10.5px;
            font-weight: 700;
            color: var(--text-muted, #6c757d);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-bottom: 6px;
        }
        .nbc-doc-row {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 8px;
            padding: 7px 0;
            border-bottom: 1px solid var(--border-color, #e9ecef);
            flex-wrap: wrap;
        }
        .nbc-doc-row-main { min-width: 0; flex: 1 1 auto; }
        .nbc-doc-row-amount {
            font-weight: 600;
            white-space: nowrap;
            color: var(--text-color, inherit);
        }
        .nbc-doc-name { font-weight: 600; color: var(--link-color, #2b6cb0); }
        .nbc-doc-status {
            font-size: 10px;
            padding: 2px 7px;
            border-radius: 10px;
            background: var(--control-bg, #f1f3f5);
            color: var(--text-muted, #6c757d);
            margin-left: 6px;
            white-space: nowrap;
        }
        .nbc-doc-date { font-size: 11px; color: var(--text-muted, #6c757d); }

        .nbc-doc-pagination {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 6px;
            gap: 8px;
            flex-wrap: wrap;
        }
        .nbc-doc-pagination-info { font-size: 11px; color: var(--text-muted, #6c757d); }

        .nbc-placeholder {
            padding: 30px 14px;
            text-align: center;
            color: var(--text-muted, #6c757d);
            font-size: 13px;
        }
        .nbc-placeholder-bordered {
            border: 1px dashed var(--border-color, #e9ecef);
            border-radius: 8px;
            margin: 10px 0;
        }

        @container (max-width: 420px) {
            .nbc-table-wrapper { overflow-x: visible; }
        }

        @media (max-width: 420px) {
            .nbc-kpi-card { padding: 10px 12px; }
            .nbc-table { font-size: 11.5px; }
            .nbc-table th, .nbc-table td { padding: 7px 8px; }
            .nbc-doc-row { flex-direction: column; align-items: flex-start; }
            .nbc-doc-row-amount { align-self: flex-end; }
        }
    `;
    document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Budget dashboard (Budget tab)
// ---------------------------------------------------------------------------

function status_class_for_percentage(pct) {
    if (pct >= 100) return { color: 'var(--red-500, #e03131)', track: 'var(--red-100, #fff0f0)' };
    if (pct >= 80) return { color: 'var(--orange-500, #e8590c)', track: 'var(--orange-100, #fff4e6)' };
    return { color: 'var(--green-500, #2b8a3e)', track: 'var(--green-100, #ebfbee)' };
}

function render_budget_dashboard(frm) {
    if (frm.is_new()) {
        frm.set_df_property('custom_dashboard', 'options', dash_placeholder('Save the project first to see the budget dashboard.'));
        frm.refresh_field('custom_dashboard');
        return;
    }

    frm.set_df_property('custom_dashboard', 'options', dash_placeholder('Loading budget dashboard...'));
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
            bind_related_documents_toggle(frm, data);
        }
    });
}

function dash_placeholder(text) {
    return `<div class="nbc-placeholder">${frappe.utils.escape_html(text)}</div>`;
}

function build_dashboard_html(data, frm) {
    if (!data || !data.has_budget) {
        return `<div class="nbc-placeholder nbc-placeholder-bordered">No Cost Budget linked to this project yet.</div>`;
    }

    if (!data.is_submitted) {
        return `
            <div class="nbc-placeholder nbc-placeholder-bordered">
                The linked budget (<b>${data.budget_name}</b>) has not been submitted yet.
                <br><br>
                <a href="/app/project-cost-budget/${data.budget_name}" style="font-weight: 600;">Open Budget &rarr;</a>
            </div>
        `;
    }

    let currency = data.currency || '';

    return `
        <div class="nbc-dash">
            ${build_kpi_section(data, currency)}
            ${build_category_table(data, currency)}
            ${build_related_documents_shell()}
        </div>
    `;
}

// ---------------------------------------------------------------------------
// KPI summary cards
// ---------------------------------------------------------------------------

function build_kpi_section(data, currency) {
    let pct = data.total_percentage_used || 0;
    let status = status_class_for_percentage(pct);
    let remaining_color = data.total_remaining < 0 ? 'var(--red-500, #e03131)' : 'var(--green-500, #2b8a3e)';

    return `
        <div class="nbc-kpi-row">
            ${kpi_card('Total Budget', format_currency(data.total_estimated, currency), 'var(--blue-500, #2b6cb0)', `${frappe.datetime.str_to_user(data.from_date)} &mdash; ${frappe.datetime.str_to_user(data.to_date)}`)}
            ${kpi_card('Spent', format_currency(data.total_cumulative, currency), status.color, `${pct.toFixed(1)}% of total budget`)}
            ${kpi_card('Remaining', format_currency(data.total_remaining, currency), remaining_color, data.total_remaining < 0 ? 'Over budget' : 'Available to spend')}
        </div>
        <div class="nbc-progress-block">
            <div class="nbc-progress-head">
                <span class="nbc-kpi-label" style="margin-bottom: 0;">Overall Budget Usage</span>
                <span style="font-size: 12px; font-weight: 700; color: ${status.color};">${pct.toFixed(1)}%</span>
            </div>
            <div class="nbc-progress-track">
                <div class="nbc-progress-fill" style="background: ${status.color}; width: ${Math.min(pct, 100)}%;"></div>
            </div>
        </div>
    `;
}

function kpi_card(label, value, color, subtext) {
    return `
        <div class="nbc-kpi-card">
            <div class="nbc-kpi-label">${label}</div>
            <div class="nbc-kpi-value" style="color: ${color};">${value}</div>
            <div class="nbc-kpi-sub">${subtext}</div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Category breakdown table
// ---------------------------------------------------------------------------

function build_category_table(data, currency) {
    let rows_html = data.rows.map(row => {
        let pct = row.percentage_used || 0;
        let status = status_class_for_percentage(pct);
        let remaining_color = row.remaining_amount < 0 ? 'var(--red-500, #e03131)' : 'inherit';

        return `
            <tr>
                <td class="nbc-bold">${frappe.utils.escape_html(row.budget_category)}</td>
                <td class="nbc-text-right">${format_currency(row.estimated_amount, currency)}</td>
                <td class="nbc-text-right">${format_currency(row.cumulative_expense_amount, currency)}</td>
                <td class="nbc-text-right nbc-bold" style="color: ${remaining_color};">${format_currency(row.remaining_amount, currency)}</td>
                <td class="nbc-pct-cell">
                    <div class="nbc-pct-wrap">
                        <div class="nbc-pct-track">
                            <div class="nbc-pct-fill" style="background: ${status.color}; width: ${Math.min(pct, 100)}%;"></div>
                        </div>
                        <span class="nbc-pct-label" style="color: ${status.color};">${pct.toFixed(1)}%</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    let total_pct = data.total_percentage_used || 0;
    let total_status = status_class_for_percentage(total_pct);
    let total_remaining_color = data.total_remaining < 0 ? 'var(--red-500, #e03131)' : 'inherit';

    return `
        <div>
            <div class="nbc-section-title-row">
                <span class="nbc-section-title">Budget Breakdown</span>
                <a href="/app/project-cost-budget/${data.budget_name}" style="font-size: 12px; font-weight: 600;">${data.budget_name} &rarr;</a>
            </div>
            <div class="nbc-table-wrapper">
                <table class="nbc-table">
                    <thead>
                        <tr>
                            <th>Category</th>
                            <th class="nbc-text-right">Estimated</th>
                            <th class="nbc-text-right">Spent</th>
                            <th class="nbc-text-right">Remaining</th>
                            <th>% Used</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows_html}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td class="nbc-bold">Total</td>
                            <td class="nbc-text-right nbc-bold">${format_currency(data.total_estimated, currency)}</td>
                            <td class="nbc-text-right nbc-bold">${format_currency(data.total_cumulative, currency)}</td>
                            <td class="nbc-text-right nbc-bold" style="color: ${total_remaining_color};">${format_currency(data.total_remaining, currency)}</td>
                            <td class="nbc-pct-cell">
                                <div class="nbc-pct-wrap">
                                    <div class="nbc-pct-track">
                                        <div class="nbc-pct-fill" style="background: ${total_status.color}; width: ${Math.min(total_pct, 100)}%;"></div>
                                    </div>
                                    <span class="nbc-pct-label" style="color: ${total_status.color};">${total_pct.toFixed(1)}%</span>
                                </div>
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Related documents (collapsible, lazy-loaded)
// ---------------------------------------------------------------------------

const DOC_SECTIONS = [
    { key: 'mr', label: 'Material Requests', doctype: 'Material Request', date_field: 'transaction_date' },
    { key: 'po', label: 'Purchase Orders', doctype: 'Purchase Order', date_field: 'transaction_date' },
    { key: 'pi', label: 'Purchase Invoices', doctype: 'Purchase Invoice', date_field: 'posting_date' },
    { key: 'je', label: 'Journal Entries', doctype: 'Journal Entry', date_field: 'posting_date' },
    { key: 'ec', label: 'Expense Claims', doctype: 'Expense Claim', date_field: 'posting_date' }
];

function build_related_documents_shell() {
    return `
        <div class="nbc-docs-wrapper">
            <div class="nbc-docs-toggle">
                <span class="nbc-docs-toggle-label">Related Documents</span>
                <span class="nbc-docs-chevron">&#9660;</span>
            </div>
            <div class="nbc-docs-body">
                <div class="nbc-docs-content">Click to load related documents...</div>
            </div>
        </div>
    `;
}

function bind_related_documents_toggle(frm, dashboard_data) {
    let $wrapper = frm.get_field('custom_dashboard').$wrapper;
    let $toggle = $wrapper.find('.nbc-docs-toggle');
    let $body = $wrapper.find('.nbc-docs-body');
    let $chevron = $wrapper.find('.nbc-docs-chevron');

    let loaded = false;
    let pages = { mr: 0, po: 0, pi: 0, je: 0, ec: 0 };

    $toggle.off('click').on('click', function() {
        let is_open = $body.is(':visible');
        if (is_open) {
            $body.slideUp(150);
            $chevron.css('transform', 'rotate(0deg)');
            return;
        }

        $body.slideDown(150);
        $chevron.css('transform', 'rotate(-180deg)');

        if (!loaded && dashboard_data && dashboard_data.has_budget && dashboard_data.is_submitted) {
            loaded = true;
            load_related_documents(frm, $body, pages);
        }
    });
}

function load_related_documents(frm, $body, pages) {
    let $content = $body.find('.nbc-docs-content');
    $content.html(dash_placeholder('Loading related documents...'));

    frappe.call({
        method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_related_documents_page',
        args: {
            company: frm.doc.company,
            project: frm.doc.name,
            pages: pages
        },
        callback: function(r) {
            let docs = r.message;
            if (!docs) {
                $content.html(dash_placeholder('No related documents found.'));
                return;
            }
            $content.html(build_related_documents_html(docs, pages));
            bind_related_documents_pagination(frm, $body, pages);
        }
    });
}

function build_related_documents_html(docs, pages) {
    let sections_html = DOC_SECTIONS.map(section => {
        let rows = docs[section.key] || [];
        let total = docs[`${section.key}_total`] || 0;

        if (!rows.length) return '';

        let rows_html = rows.map(d => {
            let date_val = d[section.date_field] ? frappe.datetime.str_to_user(d[section.date_field]) : '';
            let amount_html = d.amount !== undefined && d.amount !== null
                ? `<span class="nbc-doc-row-amount">${format_currency(d.amount)}</span>`
                : '';
            let status_html = d.status
                ? `<span class="nbc-doc-status">${frappe.utils.escape_html(d.status)}</span>`
                : '';

            return `
                <div class="nbc-doc-row">
                    <div class="nbc-doc-row-main">
                        <a href="/app/${frappe.router.slug(section.doctype)}/${d.name}" class="nbc-doc-name">${d.name}</a>
                        ${status_html}
                        <div class="nbc-doc-date">${date_val}</div>
                    </div>
                    ${amount_html}
                </div>
            `;
        }).join('');

        let page_index = pages[section.key] || 0;
        let showing_from = page_index * 5 + 1;
        let showing_to = page_index * 5 + rows.length;

        let pagination_html = total > 5 ? `
            <div class="nbc-doc-pagination">
                <span class="nbc-doc-pagination-info">Showing ${showing_from}-${showing_to} of ${total}</span>
                <div>
                    <button class="btn btn-xs nbc-doc-prev" data-section="${section.key}" ${page_index === 0 ? 'disabled' : ''}>&larr; Prev</button>
                    <button class="btn btn-xs nbc-doc-next" data-section="${section.key}" ${showing_to >= total ? 'disabled' : ''}>Next &rarr;</button>
                </div>
            </div>
        ` : '';

        return `
            <div class="nbc-doc-section" data-section="${section.key}">
                <div class="nbc-doc-section-title">${section.label} (${total})</div>
                ${rows_html}
                ${pagination_html}
            </div>
        `;
    }).join('');

    if (!sections_html.trim()) {
        return `<div class="nbc-placeholder" style="padding: 10px 0;">No related documents found for this project.</div>`;
    }

    return sections_html;
}

function bind_related_documents_pagination(frm, $body, pages) {
    $body.find('.nbc-doc-prev, .nbc-doc-next').off('click').on('click', function() {
        let section_key = $(this).data('section');
        let is_next = $(this).hasClass('nbc-doc-next');
        pages[section_key] = Math.max(0, (pages[section_key] || 0) + (is_next ? 1 : -1));
        load_related_documents(frm, $body, pages);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function format_currency(value, currency) {
    return frappe.format(value, { fieldtype: 'Currency', options: currency });
}