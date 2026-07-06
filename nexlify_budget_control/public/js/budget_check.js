// ---------------------------------------------------------------------------
// Generic before_submit budget-check dialog for Nexlify Budget Control.
// ---------------------------------------------------------------------------

const NEXLIFY_DOCTYPE_CONFIG = {
    "Material Request": {
        trigger_stage: "material_request",
        get_items: (frm) =>
            (frm.doc.items || [])
                .filter((i) => i.project && i.expense_account)
                .map((i) => ({ account: i.expense_account, amount: i.amount || 0, idx: i.idx, project: i.project })),
        get_projects: (frm) => [...new Set((frm.doc.items || []).map((i) => i.project).filter((p) => p))],
    },
    "Purchase Order": {
        trigger_stage: "purchase_order",
        get_items: (frm) =>
            (frm.doc.items || [])
                .filter((i) => i.project && i.expense_account)
                .map((i) => ({
                    account: i.expense_account,
                    amount: i.amount || 0,
                    material_request: i.material_request || null,
                    idx: i.idx,
                    project: i.project,
                })),
        get_projects: (frm) => [...new Set((frm.doc.items || []).map((i) => i.project).filter((p) => p))],
    },
    "Purchase Invoice": {
        trigger_stage: "actual",
        get_items: (frm) =>
            (frm.doc.items || [])
                .filter((i) => i.project && i.expense_account)
                .map((i) => ({
                    account: i.expense_account,
                    amount: i.amount || 0,
                    purchase_order: i.purchase_order || null,
                    idx: i.idx,
                    project: i.project,
                })),
        get_projects: (frm) => [...new Set((frm.doc.items || []).map((i) => i.project).filter((p) => p))],
    },
    "Journal Entry": {
        trigger_stage: "actual",
        get_items: (frm) => {
            const netByKey = {};
            (frm.doc.accounts || []).forEach((a) => {
                if (!a.project || !a.account) return;
                const key = a.project + "::" + a.account;
                const debit = a.debit_in_account_currency || 0;
                const credit = a.credit_in_account_currency || 0;
                netByKey[key] = netByKey[key] || { project: a.project, account: a.account, amount: 0, idx: null };
                netByKey[key].amount += debit - credit;
                if (debit > 0) netByKey[key].idx = a.idx;
            });
            return Object.values(netByKey)
                .filter((r) => r.amount > 0)
                .map((r) => ({ account: r.account, amount: r.amount, idx: r.idx, project: r.project }));
        },
        get_projects: (frm) => [...new Set((frm.doc.accounts || []).map((a) => a.project).filter((p) => p))],
    },
    "Expense Claim": {
        trigger_stage: "actual",
        get_items: (frm) =>
            (frm.doc.expenses || [])
                .filter((e) => (e.project || frm.doc.project) && e.default_account)
                .map((e) => ({ account: e.default_account, amount: e.sanctioned_amount || 0, idx: e.idx, project: e.project || frm.doc.project })),
        get_projects: (frm) => {
            const rowProjects = (frm.doc.expenses || []).map((e) => e.project).filter((p) => p);
            if (rowProjects.length) return [...new Set(rowProjects)];
            return frm.doc.project ? [frm.doc.project] : [];
        },
    },
};

Object.keys(NEXLIFY_DOCTYPE_CONFIG).forEach((doctype) => {
    frappe.ui.form.on(doctype, {
        before_submit: function (frm) {
            return nexlify_check_budget_before_submit(frm, doctype);
        },
    });
});

function nexlify_check_budget_before_submit(frm, doctype) {
    return new Promise((resolve, reject) => {
        const config = NEXLIFY_DOCTYPE_CONFIG[doctype];
        const items = config.get_items(frm);
        const projects = config.get_projects(frm);

        if (!items.length || !projects.length) {
            resolve();
            return;
        }

        const accounts = [...new Set(items.map((i) => i.account))];
        const doc_date = frm.doc.posting_date || frm.doc.transaction_date || frm.doc.schedule_date;

        frappe.call({
            method: "nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_budget_check_preview",
            args: {
                company: frm.doc.company,
                accounts: accounts,
                items: items,
                trigger_stage: config.trigger_stage,
                current_doctype: frm.doc.doctype,
                current_docname: frm.doc.name,
                doc_date: doc_date,
            },
            callback: function (r) {
                if (!r || !r.message) {
                    resolve();
                    return;
                }
                const result = r.message;
                if (result.error) {
                    frappe.msgprint({
                        title: "Budget Check Error",
                        message: "Could not verify budget before submit: " + result.error,
                        indicator: "orange",
                    });
                    resolve();
                    return;
                }
                const violations = result.violations || [];
                if (!violations.length) {
                    resolve();
                    return;
                }
                nexlify_show_combined_violations_dialog(violations, resolve, reject);
            },
            error: function () {
                frappe.msgprint({
                    title: "Budget Check Error",
                    message: "Could not verify budget before submit. Submission was allowed to proceed without a budget check.",
                    indicator: "orange",
                });
                resolve();
            },
        });
    });
}

// ---------------------------------------------------------------------------
// Theme + formatting helpers
// ---------------------------------------------------------------------------

function nexlify_is_dark_mode() {
    return document.documentElement.getAttribute("data-theme") === "dark" || document.body.classList.contains("dark");
}

function nexlify_colors() {
    const dark = nexlify_is_dark_mode();
    return {
        danger_bg: dark ? "#3D1717" : "#FEF2F2", danger_border: dark ? "#6B2020" : "#FECACA",
        danger_strong: dark ? "#EF4444" : "#DC2626", danger_gradient: "linear-gradient(135deg,#DC2626,#B91C1C)",
        warning_bg: dark ? "#3D2E0A" : "#FFFBEB", warning_border: dark ? "#6B5210" : "#FDE68A",
        warning_strong: dark ? "#F59E0B" : "#D97706", warning_gradient: "linear-gradient(135deg,#D97706,#B45309)",
        success_strong: dark ? "#4ADE80" : "#16A34A",
        info_text: dark ? "#60A5FA" : "#1D4ED8",
        card_bg: dark ? "#1F1F1E" : "#FFFFFF", page_bg: dark ? "#171716" : "#F8F9FA",
        page_text: dark ? "#F5F5F4" : "#1C1917", heading_text: dark ? "#FAFAF9" : "#0C0A09",
        muted_text: dark ? "#A8A29E" : "#78716C", tertiary_text: dark ? "#78716C" : "#A8A29E",
        border: dark ? "#2E2E2C" : "#E7E5E4", border_subtle: dark ? "#252523" : "#F5F5F4",
        btn_secondary: dark ? "#2A2A28" : "#F5F5F4", btn_secondary_text: dark ? "#D6D3D1" : "#44403C",
    };
}

function nexlify_icon(name) {
    const icons = {
        warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
        chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    };
    return icons[name] || "";
}

function nexlify_format_currency(amount, currency) {
    const formatted = (amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency ? currency + " " + formatted : formatted;
}

function nexlify_bypass_notice(c) {
    return '<div style="display:flex;align-items:center;gap:8px;background:' + c.page_bg +
        ';border:1px solid ' + c.border + ';border-left:3px solid ' + c.info_text +
        ';border-radius:8px;padding:10px 14px;margin-top:10px;">' +
        '<span style="color:' + c.info_text + ';flex-shrink:0;">' + nexlify_icon("shield") + '</span>' +
        '<span style="font-size:12px;color:' + c.muted_text + ';line-height:1.4;">' +
            'At least one violation above can be <strong style="color:' + c.page_text + ';">bypassed</strong> by your role' +
        '</span>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Metric grid + progress bar (used when a violation has structured numbers)
// ---------------------------------------------------------------------------

function nexlify_metric_card(label, value, c, opts) {
    opts = opts || {};
    return '<div style="background:' + c.page_bg + ';border:1px solid ' + (opts.border_color || c.border) +
        ';border-radius:8px;padding:8px 10px;">' +
        '<div style="font-size:9.5px;font-weight:600;color:' + c.muted_text +
            ';text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px;">' + label + '</div>' +
        '<div style="font-size:13px;font-weight:700;color:' + (opts.value_color || c.heading_text) + ';">' + value + '</div>' +
    '</div>';
}

function nexlify_progress_bar(pct, c, palette) {
    const w = Math.min(Math.max(pct, 0), 100);
    return '<div style="margin-top:10px;">' +
        '<div style="height:7px;background:' + c.page_bg + ';border-radius:4px;overflow:hidden;border:1px solid ' + c.border + ';">' +
            '<div style="height:100%;width:' + w + '%;background:' + palette.gradient + ';border-radius:4px;"></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:4px;">' +
            '<span style="font-size:11px;font-weight:600;color:' + palette.strong + ';">' + Math.round(pct) + '%</span>' +
        '</div>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Related documents (static, already fetched from server - no pagination)
// ---------------------------------------------------------------------------

function nexlify_status_badge(status, c) {
    const s = (status || "Submitted").toLowerCase();
    const negative = s.includes("overdue") || s.includes("cancelled") || s.includes("rejected");
    const bg = negative ? c.danger_bg : "rgba(22,163,74,0.12)";
    const fg = negative ? c.danger_strong : c.success_strong;
    return '<span style="display:inline-flex;align-items:center;gap:4px;font-size:9.5px;font-weight:600;' +
        'background:' + bg + ';color:' + fg + ';padding:2px 8px;border-radius:20px;white-space:nowrap;">' +
        '<span style="width:5px;height:5px;border-radius:50%;background:' + fg + ';flex-shrink:0;"></span>' +
        frappe.utils.escape_html(status || "Submitted") + '</span>';
}

const NEXLIFY_DOC_ICONS = {
    mr: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>',
    po: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>',
    pi: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    je: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
    ec: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 010-4h14v4"/><path d="M3 5v14a2 2 0 002 2h16v-5"/><path d="M18 12a2 2 0 000 4h4v-4z"/></svg>',
};

function nexlify_build_docs_section(key, label, route, rows, total, dateField, c) {
    if (!total) return "";
    const rowsHtml = rows.map((r, i) => {
        const dateVal = r[dateField] ? frappe.datetime.str_to_user(r[dateField]) : "";
        const rowBg = i % 2 === 1 ? c.page_bg : "transparent";
        return '<tr style="background:' + rowBg + ';">' +
            '<td style="padding:7px 12px;border-bottom:1px solid ' + c.border_subtle + ';">' +
                '<a href="/app/' + route + '/' + encodeURIComponent(r.name) +
                '" target="_blank" style="color:' + c.info_text + ';font-size:11.5px;text-decoration:none;font-weight:600;">' +
                frappe.utils.escape_html(r.name) + '</a></td>' +
            '<td style="padding:7px 12px;border-bottom:1px solid ' + c.border_subtle + ';color:' + c.muted_text + ';font-size:11px;white-space:nowrap;">' + dateVal + '</td>' +
            '<td style="padding:7px 12px;border-bottom:1px solid ' + c.border_subtle + ';text-align:right;font-size:11.5px;font-weight:600;color:' + c.page_text + ';font-variant-numeric:tabular-nums;white-space:nowrap;">' +
                (r.amount != null ? nexlify_format_currency(r.amount, "") : "") + '</td>' +
            '<td style="padding:7px 12px;border-bottom:1px solid ' + c.border_subtle + ';text-align:right;">' + nexlify_status_badge(r.status, c) + '</td>' +
        '</tr>';
    }).join("");

    return '<div style="margin-bottom:12px;">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">' +
            '<span style="color:' + c.muted_text + ';display:inline-flex;">' + (NEXLIFY_DOC_ICONS[key] || "") + '</span>' +
            '<span style="font-size:10.5px;font-weight:700;color:' + c.muted_text +
                ';text-transform:uppercase;letter-spacing:.05em;">' + label + '</span>' +
            '<span style="font-size:9.5px;color:' + c.tertiary_text + ';background:' + c.border_subtle +
                ';padding:1px 7px;border-radius:10px;">' + total + '</span>' +
        '</div>' +
        '<div style="background:' + c.card_bg + ';border:1px solid ' + c.border + ';border-radius:8px;overflow:hidden;">' +
            '<table style="width:100%;border-collapse:collapse;">' +
                '<thead><tr style="background:' + c.page_bg + ';">' +
                    '<th style="text-align:left;padding:6px 12px;font-size:9.5px;font-weight:600;color:' + c.tertiary_text + ';text-transform:uppercase;letter-spacing:.04em;">Document</th>' +
                    '<th style="text-align:left;padding:6px 12px;font-size:9.5px;font-weight:600;color:' + c.tertiary_text + ';text-transform:uppercase;letter-spacing:.04em;">Date</th>' +
                    '<th style="text-align:right;padding:6px 12px;font-size:9.5px;font-weight:600;color:' + c.tertiary_text + ';text-transform:uppercase;letter-spacing:.04em;">Amount</th>' +
                    '<th style="text-align:right;padding:6px 12px;font-size:9.5px;font-weight:600;color:' + c.tertiary_text + ';text-transform:uppercase;letter-spacing:.04em;">Status</th>' +
                '</tr></thead>' +
                '<tbody>' + rowsHtml + '</tbody>' +
            '</table>' +
        '</div>' +
    '</div>';
}

function nexlify_build_related_documents_html(docs, c) {
    if (!docs) return '<p style="font-size:11.5px;color:' + c.muted_text + ';margin:0;">No related documents found.</p>';
    const sections = [
        nexlify_build_docs_section("mr", "Material Requests", "material-request", docs.mr || [], docs.mr_total || 0, "transaction_date", c),
        nexlify_build_docs_section("po", "Purchase Orders", "purchase-order", docs.po || [], docs.po_total || 0, "transaction_date", c),
        nexlify_build_docs_section("pi", "Purchase Invoices", "purchase-invoice", docs.pi || [], docs.pi_total || 0, "posting_date", c),
        nexlify_build_docs_section("je", "Journal Entries", "journal-entry", docs.je || [], docs.je_total || 0, "posting_date", c),
        nexlify_build_docs_section("ec", "Expense Claims", "expense-claim", docs.ec || [], docs.ec_total || 0, "posting_date", c),
    ].join("");
    return sections || ('<p style="font-size:11.5px;color:' + c.muted_text + ';margin:0;">No related documents found.</p>');
}

// ---------------------------------------------------------------------------
// Violation card (uses structured numbers when available, falls back to message)
// ---------------------------------------------------------------------------

function nexlify_build_violation_card(v, c, cardIndex) {
    const isStop = v.action === "Stop";
    const palette = isStop
        ? { bg: c.danger_bg, border: c.danger_border, strong: c.danger_strong, gradient: c.danger_gradient }
        : { bg: c.warning_bg, border: c.warning_border, strong: c.warning_strong, gradient: c.warning_gradient };

    const hasStructuredData = v.estimated_amount !== undefined;
    let bodyHtml;

    if (hasStructuredData) {
        const pct = v.estimated_amount ? Math.round((v.cumulative_after / v.estimated_amount) * 100) : 0;
        bodyHtml =
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px;">' +
                nexlify_metric_card("Estimated", nexlify_format_currency(v.estimated_amount, v.currency), c) +
                nexlify_metric_card("Before This Doc", nexlify_format_currency(v.cumulative_before, v.currency), c) +
                nexlify_metric_card("This Document", nexlify_format_currency(v.current_doc_amount, v.currency), c, { value_color: palette.strong }) +
            '</div>' +
            nexlify_progress_bar(pct, c, palette) +
            (v.deviation > 0
                ? '<div style="margin-top:8px;font-size:11.5px;color:' + palette.strong + ';font-weight:600;">' +
                    '⬆ Exceeds by ' + nexlify_format_currency(v.deviation, v.currency) + '</div>'
                : '') +
            (v.source_rows && v.source_rows.length
                ? '<div style="margin-top:6px;font-size:11px;color:' + c.muted_text + ';">Source row(s): <b style="color:' + c.page_text + ';">' +
                    v.source_rows.join(", ") + '</b></div>'
                : '');
    } else {
        bodyHtml = '<div style="font-size:12.5px;color:' + c.page_text + ';line-height:1.6;margin-top:6px;">' + v.message + '</div>';
    }

    const hasDocs = v.documents && (
        (v.documents.mr_total || 0) + (v.documents.po_total || 0) + (v.documents.pi_total || 0) +
        (v.documents.je_total || 0) + (v.documents.ec_total || 0) > 0
    );

    const docsToggleId = "nexlify-docs-toggle-" + cardIndex;
    const docsBodyId = "nexlify-docs-body-" + cardIndex;

    const docsSection = hasDocs
        ? '<div style="margin-top:10px;">' +
            '<div id="' + docsToggleId + '" style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11.5px;font-weight:600;color:' + c.info_text + ';user-select:none;">' +
                '<span class="nexlify-chev" style="display:inline-flex;transition:transform .15s;">' + nexlify_icon("chevron") + '</span>' +
                'Related documents' +
            '</div>' +
            '<div id="' + docsBodyId + '" style="display:none;margin-top:8px;">' +
                nexlify_build_related_documents_html(v.documents, c) +
            '</div>' +
        '</div>'
        : "";

    return {
        html:
            '<div style="background:' + palette.bg + ';border:1px solid ' + palette.border +
                ';border-radius:10px;padding:14px;margin-bottom:10px;">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<span style="color:' + palette.strong + ';">' + nexlify_icon("warning") + '</span>' +
                    '<span style="font-size:11.5px;font-weight:700;color:' + palette.strong +
                        ';text-transform:uppercase;letter-spacing:.04em;">' +
                        frappe.utils.escape_html(v.violation_type || "") + ' — ' + frappe.utils.escape_html(v.action || "") +
                    '</span>' +
                    (v.budget_category
                        ? '<span style="margin-inline-start:auto;font-size:10.5px;color:' + c.muted_text + ';">' +
                            frappe.utils.escape_html(v.budget_category) + '</span>'
                        : '') +
                '</div>' +
                bodyHtml +
                docsSection +
            '</div>',
        docsToggleId, docsBodyId, hasDocs,
    };
}

// ---------------------------------------------------------------------------
// Combined multi-project / multi-violation dialog
// ---------------------------------------------------------------------------

function nexlify_show_combined_violations_dialog(violations, resolve, reject) {
    const c = nexlify_colors();

    const byProject = {};
    violations.forEach((v) => {
        const key = v.project || "Unknown";
        byProject[key] = byProject[key] || [];
        byProject[key].push(v);
    });

    const stopViolations = violations.filter((v) => v.action === "Stop");
    const allStopsBypassable = stopViolations.length === 0 || stopViolations.every((v) => v.can_bypass);
    const anyBypassable = violations.some((v) => v.can_bypass);

    let cardIndex = 0;
    const toggleIds = [];

    const projectSections = Object.keys(byProject).map((project) => {
        const projViolations = byProject[project];
        const cardsHtml = projViolations.map((v) => {
            const card = nexlify_build_violation_card(v, c, cardIndex++);
            if (card.hasDocs) toggleIds.push({ toggle: card.docsToggleId, body: card.docsBodyId });
            return card.html;
        }).join("");

        return '<div style="margin-bottom:18px;">' +
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
                '<span style="font-size:11px;font-weight:600;color:' + c.muted_text + ';background:' + c.border_subtle +
                    ';padding:2px 10px;border-radius:6px;">Project</span>' +
                '<span style="font-size:14px;font-weight:700;color:' + c.heading_text + ';">' +
                    frappe.utils.escape_html(project) + '</span>' +
                '<span style="font-size:10px;background:' + c.danger_strong +
                    ';color:#fff;padding:1px 8px;border-radius:10px;margin-inline-start:auto;">' +
                    projViolations.length + '</span>' +
            '</div>' +
            cardsHtml +
        '</div>';
    }).join("");

    const summaryText = Object.keys(byProject).length > 1
        ? Object.keys(byProject).length + " projects have budget violations that must be resolved before this document can be submitted."
        : "This document has budget violations that must be resolved before it can be submitted.";

    const body =
        '<div>' +
            '<div style="display:flex;align-items:center;gap:8px;background:' + c.danger_bg + ';border:1px solid ' + c.danger_border +
                ';border-radius:8px;padding:10px 14px;margin-bottom:18px;">' +
                '<span style="color:' + c.danger_strong + ';">' + nexlify_icon("warning") + '</span>' +
                '<span style="font-size:12.5px;color:' + c.page_text + ';">' + summaryText + '</span>' +
            '</div>' +
            projectSections +
            (anyBypassable ? nexlify_bypass_notice(c) : "") +
        '</div>';

    const dialog = new frappe.ui.Dialog({
        title: "Budget Violations",
        size: "large",
        fields: [{ fieldtype: "HTML", fieldname: "body_html", options: body }],
        primary_action_label: allStopsBypassable ? "Submit anyway" : "Close",
        primary_action: function () {
            dialog.hide();
            if (allStopsBypassable) { resolve(); } else { reject(); }
        },
    });

    if (allStopsBypassable) {
        dialog.set_secondary_action_label("Cancel");
        dialog.set_secondary_action(function () { dialog.hide(); reject(); });
    }

    const $footer = dialog.$wrapper.find(".modal-footer");
    const $exportBtn = $('<button class="btn btn-default btn-sm">📊 Export to Excel</button>');
    $exportBtn.css({ "margin-inline-end": "auto" });
    $footer.prepend($exportBtn);
    $exportBtn.on("click", function () {
        nexlify_export_violations_to_excel(violations);
    });

    dialog.$wrapper.find(".modal-dialog").css({
        "border-radius": "14px", "max-width": "min(90vw, 780px)", "max-height": "85vh",
        "display": "flex", "flex-direction": "column",
    });
    dialog.$wrapper.find(".modal-content").css({
        "max-height": "85vh", "display": "flex", "flex-direction": "column",
    });
    dialog.$wrapper.find(".modal-body").css({
        "padding": "16px 20px 20px", "overflow-y": "auto", "flex": "1 1 auto",
    });

    dialog.show();

    // Wire up collapsible "Related documents" toggles
    toggleIds.forEach(({ toggle, body }) => {
        const $toggle = dialog.$wrapper.find("#" + toggle);
        const $body = dialog.$wrapper.find("#" + body);
        $toggle.on("click", function () {
            const isOpen = $body.is(":visible");
            $body.slideToggle(120);
            $toggle.find(".nexlify-chev").css("transform", isOpen ? "rotate(0deg)" : "rotate(180deg)");
        });
    });
}

// ---------------------------------------------------------------------------
// Excel export (client-side, SheetJS via CDN)
// ---------------------------------------------------------------------------

function nexlify_export_violations_to_excel(violations) {
    function buildAndDownload() {
        const rows = violations.map((v) => ({
            "Project": v.project || "",
            "Budget Category": v.budget_category || "",
            "Violation Type": v.violation_type || "",
            "Source Row(s)": (v.source_rows || []).join(", "),
            "Action": v.action || "",
            "Estimated": v.estimated_amount != null ? v.estimated_amount : "",
            "Before This Document": v.cumulative_before != null ? v.cumulative_before : "",
            "This Document's Amount": v.current_doc_amount != null ? v.current_doc_amount : "",
            "After This Document": v.cumulative_after != null ? v.cumulative_after : "",
            "Deviation": v.deviation != null ? v.deviation : "",
            "Currency": v.currency || "",
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        ws["!cols"] = [
            { wch: 24 }, { wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 10 },
            { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 10 },
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Budget Violations");
        XLSX.writeFile(wb, "budget_violations_" + frappe.datetime.now_date() + ".xlsx");
    }

    if (typeof XLSX === "undefined") {
        frappe.require("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js", buildAndDownload);
    } else {
        buildAndDownload();
    }
}
