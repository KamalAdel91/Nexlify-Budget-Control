// ---------------------------------------------------------------------------
// Generic before_submit budget-check dialog for Nexlify Budget Control.
// Registered (via hooks.py doctype_js) on: Material Request, Purchase
// Order, Purchase Invoice, Journal Entry, Expense Claim.
//
// This preview runs BEFORE the document is submitted (still Draft in the
// DB), so the server can't see this document's own pending amount via
// live queries. We send amounts_by_account explicitly so the preview can
// add it on top of the stored cumulative before comparing to the estimate.
//
// Carry-forward: PO linked to MR or PI linked to PO are NOT new spending
// (the budget was already counted at the earlier stage). Their amounts
// are set to 0 in get_items so the preview doesn't double-count them.
// ---------------------------------------------------------------------------

const NEXLIFY_DOCTYPE_CONFIG = {
    "Material Request": {
        trigger_stage: "material_request",
        get_items: (frm) =>
            (frm.doc.items || [])
                .filter((i) => i.project && i.expense_account)
                .map((i) => ({ account: i.expense_account, amount: i.amount || 0 })),
        get_projects: (frm) => [...new Set((frm.doc.items || []).map((i) => i.project).filter((p) => p))],
    },
    "Purchase Order": {
        trigger_stage: "purchase_order",
        get_items: (frm) =>
            (frm.doc.items || [])
                .filter((i) => i.project && i.expense_account)
                .map((i) => ({
                    account: i.expense_account,
                    amount: i.material_request ? 0 : (i.amount || 0),
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
                    amount: i.purchase_order ? 0 : (i.amount || 0),
                })),
        get_projects: (frm) => [...new Set((frm.doc.items || []).map((i) => i.project).filter((p) => p))],
    },
    "Journal Entry": {
        trigger_stage: "actual",
        get_items: (frm) =>
            (frm.doc.accounts || [])
                .filter((a) => a.project && a.account)
                .map((a) => ({ account: a.account, amount: a.debit_in_account_currency || 0 })),
        get_projects: (frm) => [...new Set((frm.doc.accounts || []).map((a) => a.project).filter((p) => p))],
    },
    "Expense Claim": {
        trigger_stage: "actual",
        get_items: (frm) =>
            (frm.doc.expenses || [])
                .filter((e) => (e.project || frm.doc.project) && e.default_account)
                .map((e) => ({ account: e.default_account, amount: e.sanctioned_amount || 0 })),
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
        const amounts_by_account = {};
        items.forEach((i) => {
            amounts_by_account[i.account] = (amounts_by_account[i.account] || 0) + (i.amount || 0);
        });

        const doc_date = frm.doc.posting_date || frm.doc.transaction_date || frm.doc.schedule_date;

        frappe.call({
            method: "nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_budget_check_preview",
            args: {
                company: frm.doc.company,
                project: projects[0],
                accounts: accounts,
                amounts_by_account: amounts_by_account,
                trigger_stage: config.trigger_stage,
                current_doctype: frm.doc.doctype,
                current_docname: frm.doc.name,
                doc_date: doc_date,
            },
            callback: function (r) {
                const result = r.message || {};

                if (result.category_violation) {
                    nexlify_show_category_violation_dialog(result.category_violation, resolve, reject);
                } else if (result.date_violation) {
                    nexlify_show_date_violation_dialog(result.date_violation, resolve, reject);
                } else if (result.exceeded) {
                    nexlify_show_budget_dialog(result.exceeded, true, resolve, reject);
                } else if (result.warning) {
                    nexlify_show_budget_dialog(result.warning, false, resolve, reject);
                } else if (result.monthly_exceeded) {
                    nexlify_show_monthly_dialog(result.monthly_exceeded, resolve, reject);
                } else {
                    resolve();
                }
            },
            error: function (r) {
                console.error("NEXLIFY: get_budget_check_preview FAILED", r);
                frappe.msgprint({
                    title: "Budget Check Error",
                    message: "Could not verify budget before submit. Check the browser console for details. Submission was allowed to proceed without a budget check.",
                    indicator: "orange",
                });
                resolve();
            },
        });
    });
}

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

function nexlify_is_dark_mode() {
    return document.documentElement.getAttribute("data-theme") === "dark" || document.body.classList.contains("dark");
}

function nexlify_colors() {
    const dark = nexlify_is_dark_mode();
    return {
        danger_bg:       dark ? "#3D1717" : "#FEF2F2",
        danger_border:   dark ? "#6B2020" : "#FECACA",
        danger_text:     dark ? "#FCA5A5" : "#991B1B",
        danger_strong:   dark ? "#EF4444" : "#DC2626",
        danger_gradient: dark
            ? "linear-gradient(135deg, #DC2626 0%, #EF4444 100%)"
            : "linear-gradient(135deg, #DC2626 0%, #B91C1C 100%)",
        warning_bg:       dark ? "#3D2E0A" : "#FFFBEB",
        warning_border:   dark ? "#6B5210" : "#FDE68A",
        warning_text:     dark ? "#FCD34D" : "#92400E",
        warning_strong:   dark ? "#F59E0B" : "#D97706",
        warning_gradient: dark
            ? "linear-gradient(135deg, #F59E0B 0%, #FBBF24 100%)"
            : "linear-gradient(135deg, #D97706 0%, #B45309 100%)",
        success_bg:       dark ? "#052E16" : "#F0FDF4",
        success_border:   dark ? "#166534" : "#BBF7D0",
        success_text:     dark ? "#4ADE80" : "#166534",
        success_strong:   dark ? "#22C55E" : "#16A34A",
        info_bg:       dark ? "#0C2D4D" : "#EFF6FF",
        info_border:   dark ? "#1E4D7B" : "#BFDBFE",
        info_text:     dark ? "#60A5FA" : "#1D4ED8",
        card_bg:         dark ? "#1F1F1E" : "#FFFFFF",
        card_hover:      dark ? "#2A2A28" : "#F9FAFB",
        page_bg:         dark ? "#171716" : "#F8F9FA",
        page_text:       dark ? "#F5F5F4" : "#1C1917",
        heading_text:    dark ? "#FAFAF9" : "#0C0A09",
        muted_text:      dark ? "#A8A29E" : "#78716C",
        tertiary_text:   dark ? "#78716C" : "#A8A29E",
        border:          dark ? "#2E2E2C" : "#E7E5E4",
        border_subtle:   dark ? "#252523" : "#F5F5F4",
        shadow_sm:       dark ? "0 1px 2px rgba(0,0,0,0.4)" : "0 1px 2px rgba(0,0,0,0.05)",
        shadow_md:       dark ? "0 4px 12px rgba(0,0,0,0.5)" : "0 4px 12px rgba(0,0,0,0.08)",
        btn_primary:        dark ? "#EF4444" : "#DC2626",
        btn_primary_hover:  dark ? "#F87171" : "#B91C1C",
        btn_secondary:      dark ? "#2A2A28" : "#F5F5F4",
        btn_secondary_text: dark ? "#D6D3D1" : "#44403C",
    };
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function nexlify_icon(name) {
    const icons = {
        warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        calendar: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
        chevron_left: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
        chevron_right: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
        arrow_up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    };
    return icons[name] || "";
}

// ---------------------------------------------------------------------------
// CSS keyframes + utility classes (injected once)
// ---------------------------------------------------------------------------

(function nexlify_inject_styles() {
    if (document.getElementById("nexlify-budget-dialog-styles")) return;
    const style = document.createElement("style");
    style.id = "nexlify-budget-dialog-styles";
    style.textContent = [
        "@keyframes nexlify-slide-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}",
        "@keyframes nexlify-bar-fill{from{width:0%}}",
        ".nexlify-animate-in>div{animation:nexlify-slide-in .25s ease-out both}",
        ".nexlify-animate-in>div:nth-child(2){animation-delay:.04s}",
        ".nexlify-animate-in>div:nth-child(3){animation-delay:.08s}",
        ".nexlify-animate-in>div:nth-child(4){animation-delay:.12s}",
        ".nexlify-bar-animated{animation:nexlify-bar-fill .7s cubic-bezier(.22,1,.36,1) both;animation-delay:.25s}",
        ".nexlify-doc-link{text-decoration:none;font-weight:500;transition:text-decoration .15s}",
        ".nexlify-doc-link:hover{text-decoration:underline}",
        ".nexlify-row-hover{transition:background .15s}",
        ".nexlify-row-hover:hover{background:var(--nexlify-row-hover,#F9FAFB)}",
    ].join("\n");
    document.head.appendChild(style);
})();

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function nexlify_status_badge(status, c) {
    const s = (status || "Submitted").toLowerCase();
    const is_negative = s.includes("overdue") || s.includes("cancelled") || s.includes("rejected");
    const is_positive = s.includes("submitted") || s.includes("paid") || s.includes("completed");

    let dot_color, bg_color, text_color;
    if (is_negative) {
        dot_color = c.danger_strong; bg_color = c.danger_bg; text_color = c.danger_text;
    } else if (is_positive) {
        dot_color = c.success_strong; bg_color = c.success_bg; text_color = c.success_text;
    } else {
        dot_color = c.info_text; bg_color = c.info_bg; text_color = c.info_text;
    }

    return '<span style="display:inline-flex;align-items:center;gap:5px;background:' + bg_color +
        ';color:' + text_color + ';font-size:11px;font-weight:500;padding:3px 10px;border-radius:20px;white-space:nowrap;">' +
        '<span style="width:6px;height:6px;border-radius:50%;background:' + dot_color + ';flex-shrink:0;"></span>' +
        frappe.utils.escape_html(status || "Submitted") + '</span>';
}

// ---------------------------------------------------------------------------
// Reusable: metric card
// ---------------------------------------------------------------------------

function nexlify_metric_card(label, value, c, opts) {
    opts = opts || {};
    const borderColor = opts.border_color || c.border;
    const valColor = opts.value_color || c.heading_text;

    return '<div style="background:' + c.card_bg + ';border:1px solid ' + borderColor +
        ';border-radius:8px;padding:10px 12px;box-shadow:' + c.shadow_sm +
        ';display:flex;flex-direction:column;gap:3px;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:4px;">' +
            (opts.icon_html ? '<span style="color:' + c.muted_text + ';flex-shrink:0;">' + opts.icon_html + '</span>' : '') +
            '<span style="font-size:10px;font-weight:600;color:' + c.muted_text +
                ';text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                label + '</span>' +
        '</div>' +
        '<p style="font-size:15px;font-weight:700;margin:0;color:' + valColor +
            ';letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            value + '</p>' +
        (opts.sub_label ? '<span style="font-size:10px;color:' + c.tertiary_text + ';margin:0;">' + opts.sub_label + '</span>' : '') +
    '</div>';
}

// ---------------------------------------------------------------------------
// Reusable: progress bar
// ---------------------------------------------------------------------------

function nexlify_progress_bar(pct, c, palette) {
    const barWidth = Math.min(Math.max(pct, 0), 100);
    const gradient = palette.gradient || c.danger_gradient;

    return '<div style="margin-bottom:4px;">' +
        '<div style="height:7px;background:' + c.card_bg + ';border-radius:4px;overflow:hidden;border:1px solid ' + c.border + ';">' +
            '<div class="nexlify-bar-animated" style="height:100%;width:' + barWidth + '%;background:' + gradient +
                ';border-radius:4px;position:relative;">' +
                '<div style="position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.15) 0%,transparent 100%);border-radius:4px;"></div>' +
            '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">' +
            '<span style="font-size:10px;color:' + c.tertiary_text + ';">0%</span>' +
            '<span style="font-size:11px;font-weight:600;color:' + (palette.strong || c.danger_strong) + ';">' + pct + '%</span>' +
            '<span style="font-size:10px;color:' + c.tertiary_text + ';">100%</span>' +
        '</div>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Reusable: overage callout
// ---------------------------------------------------------------------------

function nexlify_overage_callout(overage, pct, currency, c, palette) {
    return '<div style="display:flex;align-items:flex-start;gap:8px;background:' + (palette.bg || c.danger_bg) +
        ';border:1px solid ' + (palette.border || c.danger_border) + ';border-radius:8px;padding:10px 12px;margin-top:12px;">' +
        '<span style="color:' + (palette.strong || c.danger_strong) + ';flex-shrink:0;margin-top:1px;">' + nexlify_icon("arrow_up") + '</span>' +
        '<div style="flex:1;">' +
            '<span style="font-size:12px;font-weight:600;color:' + (palette.strong || c.danger_strong) + ';">' +
                'Budget exceeded by ' + nexlify_format_currency(overage, currency) + '</span>' +
            '<p style="font-size:11px;color:' + c.muted_text + ';margin:3px 0 0;line-height:1.5;">' +
                'Total cumulative will reach <strong style="color:' + c.page_text + ';">' + pct + '%</strong> of the estimated budget if this document is submitted.' +
            '</p>' +
        '</div>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Reusable: warning callout
// ---------------------------------------------------------------------------

function nexlify_warning_callout(remaining, current_doc, pct, currency, c, palette) {
    const willExceed = current_doc > remaining;
    const msg = willExceed
        ? "Approaching limit \u2014 this document will exceed by " + nexlify_format_currency(current_doc - remaining, currency)
        : "Approaching budget limit \u2014 " + nexlify_format_currency(remaining, currency) + " will remain after this document";
    const icon = willExceed ? nexlify_icon("arrow_up") : nexlify_icon("warning");

    return '<div style="display:flex;align-items:flex-start;gap:8px;background:' + (palette.bg || c.warning_bg) +
        ';border:1px solid ' + (palette.border || c.warning_border) + ';border-radius:8px;padding:10px 12px;margin-top:12px;">' +
        '<span style="color:' + (palette.strong || c.warning_strong) + ';flex-shrink:0;margin-top:1px;">' + icon + '</span>' +
        '<div style="flex:1;">' +
            '<span style="font-size:12px;font-weight:600;color:' + (palette.strong || c.warning_strong) + ';">' + msg + '</span>' +
            '<p style="font-size:11px;color:' + c.muted_text + ';margin:3px 0 0;line-height:1.5;">' +
                'Current usage is at <strong style="color:' + c.page_text + ';">' + pct + '%</strong> of the estimated budget.' +
            '</p>' +
        '</div>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Reusable: bypass notice
// ---------------------------------------------------------------------------

function nexlify_bypass_notice(c) {
    return '<div style="display:flex;align-items:center;gap:8px;background:' + c.card_bg +
        ';border:1px solid ' + c.border + ';border-left:3px solid ' + c.info_text +
        ';border-radius:8px;padding:10px 14px;margin-bottom:14px;box-shadow:' + c.shadow_sm + ';">' +
        '<span style="color:' + c.info_text + ';flex-shrink:0;">' + nexlify_icon("shield") + '</span>' +
        '<span style="font-size:12px;color:' + c.muted_text + ';line-height:1.4;">' +
            'You have permission to <strong style="color:' + c.page_text + ';">bypass</strong> this restriction' +
        '</span>' +
    '</div>';
}

// ---------------------------------------------------------------------------
// Category violation dialog
// ---------------------------------------------------------------------------

function nexlify_show_category_violation_dialog(data, resolve, reject) {
    const c = nexlify_colors();
    const accountRows = data.accounts.map(function (a) {
        return '<tr style="border-top:1px solid ' + c.border_subtle + ';" class="nexlify-row-hover">' +
            '<td style="padding:8px 12px;color:' + c.page_text + ';font-size:13px;">' + frappe.utils.escape_html(a) + '</td></tr>';
    }).join("");

    const body = '<div class="nexlify-animate-in" style="--nexlify-row-hover:' + c.card_hover + ';">' +
        nexlify_alert_header(c, "danger", "Account not in budget categories", data.project,
            "This project is restricted to its Budget Category accounts only. The account(s) below are not part of any Budget Category configured for this project.") +
        '<div style="margin-bottom:14px;">' +
            '<p style="font-size:11px;font-weight:600;color:' + c.muted_text + ';margin:0 0 6px;text-transform:uppercase;letter-spacing:.05em;">Accounts outside budget categories</p>' +
            nexlify_table_wrap('<table style="width:100%;border-collapse:collapse;">' +
                '<thead><tr style="background:' + c.page_bg + ';border-bottom:1px solid ' + c.border + ';">' +
                    '<th style="text-align:left;padding:8px 12px;font-weight:500;font-size:11px;color:' + c.muted_text + ';text-transform:uppercase;letter-spacing:.04em;">Account</th>' +
                '</tr></thead><tbody>' + accountRows + '</tbody></table>', c) +
        '</div>' +
        (data.can_bypass ? nexlify_bypass_notice(c) : "") +
    '</div>';

    nexlify_show_confirmation_dialog("Account not in budget categories", body, data.can_bypass, resolve, reject);
}

// ---------------------------------------------------------------------------
// Date range violation dialog
// ---------------------------------------------------------------------------

function nexlify_show_date_violation_dialog(data, resolve, reject) {
    const c = nexlify_colors();
    const body = '<div class="nexlify-animate-in">' +
        nexlify_alert_header(c, "danger", "Outside budget period", data.project,
            'Budget category <strong style="color:' + c.heading_text + ';">' + frappe.utils.escape_html(data.budget_category) +
            '</strong> is only active for a specific period. This document\'s date falls outside that period.') +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">' +
            nexlify_date_card(c, "Period starts", data.from_date) +
            nexlify_date_card(c, "Period ends", data.to_date) +
        '</div>' +
        (data.can_bypass ? nexlify_bypass_notice(c) : "") +
    '</div>';

    nexlify_show_confirmation_dialog("Outside budget period", body, data.can_bypass, resolve, reject);
}

// ---------------------------------------------------------------------------
// Monthly exceeded dialog
// ---------------------------------------------------------------------------

function nexlify_show_monthly_dialog(data, resolve, reject) {
    const c = nexlify_colors();
    const palette = { strong: c.danger_strong, gradient: c.danger_gradient, bg: c.danger_bg, border: c.danger_border };

    const monthlyBudget = data.monthly_budget || 0;
    const actualStored = data.actual_till_month_stored || 0;
    const currentDoc = data.current_doc_amount || 0;
    const actualTotal = data.actual_till_month || 0;
    const remaining = monthlyBudget - actualStored;
    const overage = actualTotal - monthlyBudget;
    const pct = monthlyBudget ? Math.round((actualTotal / monthlyBudget) * 100) : 0;

    var docsHtml = data.documents ? nexlify_build_static_documents_html(data.documents, c) : "";

    var body = '<div class="nexlify-animate-in" style="--nexlify-link-color:' + c.info_text + ';--nexlify-row-hover:' + c.card_hover + ';">' +
        '<div style="background:' + palette.bg + ';border:1px solid ' + palette.border + ';border-radius:10px;padding:16px;margin-bottom:14px;box-shadow:' + c.shadow_md + ';">' +
            nexlify_dialog_title(c, palette, "Monthly budget exceeded", data.project) +
            '<p style="font-size:12px;color:' + c.page_text + ';margin:0 0 14px;line-height:1.6;padding-left:28px;">' +
                'Budget category <strong style="color:' + c.heading_text + ';">' + frappe.utils.escape_html(data.budget_category) +
                '</strong> has exceeded its budget allowance for the current month.</p>' +
            nexlify_4card_grid(c, monthlyBudget, actualStored, remaining, currentDoc, data.currency) +
            nexlify_progress_bar(pct, c, palette) +
            (overage > 0 ? nexlify_overage_callout(overage, pct, data.currency, c, palette) : "") +
        '</div>' +
        (data.can_bypass ? nexlify_bypass_notice(c) : "") +
        docsHtml +
    '</div>';

    nexlify_create_styled_dialog("Monthly budget exceeded", "large", body, data.can_bypass, c, resolve, reject);
}

// ---------------------------------------------------------------------------
// Annual exceeded / warning dialog
// ---------------------------------------------------------------------------

function nexlify_show_budget_dialog(data, is_blocking, resolve, reject) {
    const c = nexlify_colors();
    const isWarning = !is_blocking;

    const estimated = data.estimated || 0;
    const cumulative = data.cumulative || 0;
    var cumulativeStored = data.cumulative_stored !== undefined ? data.cumulative_stored : (cumulative - (data.current_doc_amount || 0));
    var currentDoc = data.current_doc_amount || (cumulative - cumulativeStored);
    const remaining = estimated - cumulativeStored;
    const overage = cumulative - estimated;
    const pct = estimated ? Math.round((cumulative / estimated) * 100) : 0;

    var palette = isWarning
        ? { strong: c.warning_strong, gradient: c.warning_gradient, bg: c.warning_bg, border: c.warning_border }
        : { strong: c.danger_strong, gradient: c.danger_gradient, bg: c.danger_bg, border: c.danger_border };

    var state = {
        pages: { mr: 0, po: 0, pi: 0, je: 0, ec: 0 },
        docs: data.documents || { mr: [], po: [], pi: [], je: [], ec: [] },
        company: data.company,
        project_name: data.project,
        exclude_doctype: data.current_doctype,
        exclude_name: data.current_docname,
    };

    var thisDocColor = c.heading_text;
    var thisDocBorder = c.border;
    if (overage > 0 && is_blocking) { thisDocColor = c.danger_strong; thisDocBorder = c.danger_border; }
    else if (isWarning) { thisDocColor = c.warning_strong; thisDocBorder = c.warning_border; }

    var remainingColor = c.success_strong;
    var remainingBorder = c.success_border;
    if (remaining <= 0) { remainingColor = isWarning ? c.warning_strong : c.danger_strong; remainingBorder = palette.border; }

    var body = '<div class="nexlify-animate-in" style="--nexlify-link-color:' + c.info_text + ';--nexlify-row-hover:' + c.card_hover + ';">' +
        '<div style="background:' + palette.bg + ';border:1px solid ' + palette.border + ';border-radius:10px;padding:16px;margin-bottom:14px;box-shadow:' + c.shadow_md + ';">' +
            nexlify_dialog_title(c, palette, is_blocking ? "Budget exceeded" : "Budget warning", data.project) +
            '<p style="font-size:12px;color:' + c.page_text + ';margin:0 0 14px;line-height:1.6;padding-left:28px;">' +
                'Budget category <strong style="color:' + c.heading_text + ';">' + frappe.utils.escape_html(data.budget_category) + '</strong> ' +
                (is_blocking ? "has exceeded its total estimated budget" : "is approaching its estimated budget") + '</p>' +
            nexlify_4card_grid(c, estimated, cumulativeStored, remaining, currentDoc, data.currency, remainingColor, remainingBorder, thisDocColor, thisDocBorder) +
            nexlify_progress_bar(pct, c, palette) +
            (is_blocking && overage > 0 ? nexlify_overage_callout(overage, pct, data.currency, c, palette) : "") +
            (isWarning && !is_blocking ? nexlify_warning_callout(remaining, currentDoc, pct, data.currency, c, palette) : "") +
        '</div>' +
        (data.can_bypass ? nexlify_bypass_notice(c) : "") +
        '<div id="nexlify_docs_wrapper"></div>' +
    '</div>';

    var allowContinue = !is_blocking || data.can_bypass;
    var dialog = nexlify_create_styled_dialog(
        is_blocking ? "Budget exceeded" : "Budget warning", "large", body, allowContinue, c, resolve, reject
    );
    nexlify_render_docs_section(dialog, state, c);
}

// ---------------------------------------------------------------------------
// Shared HTML building blocks
// ---------------------------------------------------------------------------

function nexlify_alert_header(c, type, title, project, description) {
    var p = type === "danger"
        ? { bg: c.danger_bg, border: c.danger_border, strong: c.danger_strong }
        : { bg: c.warning_bg, border: c.warning_border, strong: c.warning_strong };

    return '<div style="background:' + p.bg + ';border:1px solid ' + p.border + ';border-radius:10px;padding:14px 16px;margin-bottom:14px;box-shadow:' + c.shadow_sm + ';">' +
        nexlify_dialog_title(c, p, title, project) +
        '<p style="font-size:13px;color:' + c.page_text + ';margin:0;line-height:1.6;padding-left:28px;">' + description + '</p>' +
    '</div>';
}

function nexlify_dialog_title(c, palette, title, project) {
    return '<div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;">' +
        '<span style="color:' + palette.strong + ';flex-shrink:0;margin-top:1px;">' + nexlify_icon("warning") + '</span>' +
        '<div style="flex:1;">' +
            '<h3 style="font-size:14px;font-weight:600;color:' + palette.strong + ';margin:0 0 3px;">' + title + '</h3>' +
            '<span style="font-size:11px;color:' + c.muted_text + ';background:' + c.border_subtle + ';padding:2px 8px;border-radius:4px;">' +
                frappe.utils.escape_html(project) + '</span>' +
        '</div>' +
    '</div>';
}

function nexlify_date_card(c, label, value) {
    return '<div style="background:' + c.card_bg + ';border:1px solid ' + c.border + ';border-radius:8px;padding:12px;box-shadow:' + c.shadow_sm + ';">' +
        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:6px;">' +
            '<span style="color:' + c.info_text + ';">' + nexlify_icon("calendar") + '</span>' +
            '<span style="font-size:10px;font-weight:500;color:' + c.muted_text + ';text-transform:uppercase;letter-spacing:.05em;">' + label + '</span>' +
        '</div>' +
        '<p style="font-size:17px;font-weight:700;margin:0;color:' + c.heading_text + ';letter-spacing:-.01em;">' + value + '</p>' +
    '</div>';
}

function nexlify_table_wrap(innerHtml, c) {
    return '<div style="background:' + c.card_bg + ';border:1px solid ' + c.border + ';border-radius:8px;overflow:hidden;box-shadow:' + c.shadow_sm + ';">' +
        innerHtml + '</div>';
}

function nexlify_4card_grid(c, estimated, committed, remaining, currentDoc, currency, remColor, remBorder, curColor, curBorder) {
    return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">' +
        nexlify_metric_card("Estimated Budget", nexlify_format_currency(estimated, currency), c) +
        nexlify_metric_card("Previously Committed", nexlify_format_currency(committed, currency), c, { sub_label: "Approved documents" }) +
        nexlify_metric_card("Remaining", nexlify_format_currency(remaining, currency), c, {
            value_color: remColor || (remaining <= 0 ? c.danger_strong : c.success_strong),
            border_color: remBorder || (remaining <= 0 ? c.danger_border : c.success_border),
            sub_label: remaining <= 0 ? "No budget left" : "Before this document",
        }) +
        nexlify_metric_card("This Document", nexlify_format_currency(currentDoc, currency), c, {
            value_color: curColor || c.heading_text,
            border_color: curBorder || c.border,
            sub_label: "Pending approval",
        }) +
    '</div>';
}

// ---------------------------------------------------------------------------
// Shared dialog creators
// ---------------------------------------------------------------------------

function nexlify_show_confirmation_dialog(title, bodyHtml, canBypass, resolve, reject) {
    nexlify_create_styled_dialog(title, "small", bodyHtml, canBypass, nexlify_colors(), resolve, reject);
}

function nexlify_create_styled_dialog(title, size, bodyHtml, canBypass, c, resolve, reject) {
    var dialog = new frappe.ui.Dialog({
        title: title,
        size: size,
        fields: [{ fieldtype: "HTML", fieldname: "body_html", options: bodyHtml }],
        primary_action_label: canBypass ? "Submit anyway" : "Close",
        primary_action: function () {
            dialog.hide();
            if (canBypass) { resolve(); } else { reject(); }
        },
    });

    if (canBypass) {
        dialog.set_secondary_action_label("Cancel");
        dialog.set_secondary_action(function () { dialog.hide(); reject(); });

        var $btn = dialog.$wrapper.find(".btn-primary");
        $btn.css({
            "background-color": c.btn_primary, "border-color": c.btn_primary, "color": "#fff",
            "font-weight": "500", "border-radius": "8px", "padding": "6px 20px",
            "transition": "background-color .15s, box-shadow .15s, transform .1s",
            "box-shadow": "0 1px 3px rgba(220,38,38,.3)",
        });
        $btn.on("mouseenter", function () {
            $(this).css({ "background-color": c.btn_primary_hover, "box-shadow": "0 4px 12px rgba(220,38,38,.4)", "transform": "translateY(-1px)" });
        });
        $btn.on("mouseleave", function () {
            $(this).css({ "background-color": c.btn_primary, "box-shadow": "0 1px 3px rgba(220,38,38,.3)", "transform": "translateY(0)" });
        });

        var $sec = dialog.$wrapper.find(".btn-secondary, .modal-btn-secondary");
        $sec.css({
            "background-color": c.btn_secondary, "border-color": c.border, "color": c.btn_secondary_text,
            "border-radius": "8px", "padding": "6px 20px", "font-weight": "500", "transition": "background-color .15s",
        });
        $sec.on("mouseenter", function () { $(this).css({ "background-color": c.border }); });
        $sec.on("mouseleave", function () { $(this).css({ "background-color": c.btn_secondary }); });
    }

    dialog.$wrapper.find(".modal-dialog").css({
        "border-radius": "14px", "overflow": "hidden", "max-width": "min(90vw, 720px)",
        "width": "auto", "max-height": "85vh", "display": "flex", "flex-direction": "column",
    });
    dialog.$wrapper.find(".modal-content").css({
        "max-height": "85vh", "display": "flex", "flex-direction": "column", "overflow": "hidden",
    });
    dialog.$wrapper.find(".modal-body").css({
        "padding": "16px 20px 20px", "overflow-y": "auto", "flex": "1 1 auto",
    });

    dialog.show();
    return dialog;
}

// ---------------------------------------------------------------------------
// Document tables — paginated
// ---------------------------------------------------------------------------

function nexlify_render_docs_section(dialog, state, c) {
    var sections = [
        { key: "mr", title: "Material Requests", icon: "ti-clipboard-list", route: "material-request", date_field: "transaction_date", has_billed: false },
        { key: "po", title: "Purchase Orders", icon: "ti-shopping-cart", route: "purchase-order", date_field: "transaction_date", has_billed: true },
        { key: "pi", title: "Purchase Invoices", icon: "ti-file-invoice", route: "purchase-invoice", date_field: "posting_date", has_billed: false },
        { key: "je", title: "Journal Entries", icon: "ti-book", route: "journal-entry", date_field: "posting_date", has_billed: false },
        { key: "ec", title: "Expense Claims", icon: "ti-receipt", route: "expense-claim", date_field: "posting_date", has_billed: false },
    ];

    var $w = dialog.fields_dict.body_html.$wrapper.find("#nexlify_docs_wrapper");
    $w.html(sections.map(function (s) { return nexlify_build_section_html(s, state, c); }).join(""));

    sections.forEach(function (s) {
        $w.find('[data-nexlify-prev="' + s.key + '"]').on("click", function () {
            if (state.pages[s.key] > 0) { state.pages[s.key]--; nexlify_refetch_page(dialog, state, c, s.key); }
        });
        $w.find('[data-nexlify-next="' + s.key + '"]').on("click", function () {
            state.pages[s.key]++; nexlify_refetch_page(dialog, state, c, s.key);
        });
    });
}

function nexlify_refetch_page(dialog, state, c, key) {
    frappe.call({
        method: "nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_related_documents_page",
        args: {
            company: state.company, project: state.project_name,
            pages: JSON.stringify(state.pages), exclude_doctype: state.exclude_doctype, exclude_name: state.exclude_name,
        },
        callback: function (r) {
            if (r.message) { state.docs = r.message; nexlify_render_docs_section(dialog, state, c); }
        },
    });
}

function nexlify_build_section_html(section, state, c) {
    var PAGE_SIZE = 5;
    var rows = state.docs[section.key] || [];
    var total = state.docs[section.key + "_total"] || 0;
    var page = state.pages[section.key] || 0;
    var start = page * PAGE_SIZE;
    var end = Math.min(start + rows.length, total);

    var hdr = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">' +
        '<i class="ti ' + section.icon + '" style="font-size:14px;color:' + c.muted_text + ';"></i>' +
        '<span style="font-size:12px;font-weight:600;color:' + c.muted_text + ';text-transform:uppercase;letter-spacing:.04em;">' + section.title + '</span>' +
        (total ? '<span style="font-size:10px;color:' + c.tertiary_text + ';background:' + c.border_subtle + ';padding:1px 6px;border-radius:10px;">' + total + '</span>' : "") +
    '</div>';

    if (!total) return '<div style="margin-bottom:14px;">' + hdr + '<p style="font-size:11px;color:' + c.tertiary_text + ';margin:0;padding:6px 0;">No documents found</p></div>';

    var billedH = section.has_billed
        ? '<th style="text-align:right;padding:8px 12px;font-weight:500;font-size:10px;color:' + c.muted_text + ';text-transform:uppercase;letter-spacing:.04em;">Billed</th>'
        : "";

    var rowsHtml = rows.map(function (r) {
        var billed = section.has_billed
            ? '<td style="padding:8px 12px;text-align:right;color:' + c.muted_text + ';font-size:12px;font-variant-numeric:tabular-nums;">' + nexlify_format_currency(r.billed_amt, "") + '</td>'
            : "";
        return '<tr style="border-top:1px solid ' + c.border_subtle + ';" class="nexlify-row-hover">' +
            '<td style="padding:8px 12px;"><a href="/app/' + section.route + '/' + encodeURIComponent(r.name) + '" target="_blank" class="nexlify-doc-link" style="color:' + c.info_text + ';font-size:12px;">' +
                frappe.utils.escape_html(r.name) + '</a></td>' +
            '<td style="padding:8px 12px;color:' + c.muted_text + ';font-size:12px;white-space:nowrap;">' + frappe.datetime.str_to_user(r[section.date_field]) + '</td>' +
            '<td style="padding:8px 12px;text-align:right;color:' + c.page_text + ';font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;">' + nexlify_format_currency(r.amount, "") + '</td>' +
            billed +
            '<td style="padding:8px 12px;">' + nexlify_status_badge(r.status, c) + '</td></tr>';
    }).join("");

    var pDis = page === 0 ? "opacity:.35;pointer-events:none;cursor:default;" : "cursor:pointer;transition:background .15s;";
    var nDis = end >= total ? "opacity:.35;pointer-events:none;cursor:default;" : "cursor:pointer;transition:background .15s;";

    return '<div style="margin-bottom:14px;">' + hdr +
        nexlify_table_wrap(
            '<table style="width:100%;border-collapse:collapse;">' +
                '<thead><tr style="background:' + c.page_bg + ';border-bottom:1px solid ' + c.border + ';">' +
                    '<th style="text-align:left;padding:8px 12px;font-weight:500;font-size:10px;color:' + c.muted_text + ';text-transform:uppercase;letter-spacing:.04em;">Document</th>' +
                    '<th style="text-align:left;padding:8px 12px;font-weight:500;font-size:10px;color:' + c.muted_text + ';text-transform:uppercase;letter-spacing:.04em;">Date</th>' +
                    '<th style="text-align:right;padding:8px 12px;font-weight:500;font-size:10px;color:' + c.muted_text + ';text-transform:uppercase;letter-spacing:.04em;">Amount</th>' +
                    billedH +
                    '<th style="text-align:left;padding:8px 12px;font-weight:500;font-size:10px;color:' + c.muted_text + ';text-transform:uppercase;letter-spacing:.04em;">Status</th>' +
                '</tr></thead><tbody>' + rowsHtml + '</tbody></table>' +
                '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-top:1px solid ' + c.border + ';background:' + c.page_bg + ';">' +
                    '<span style="font-size:11px;color:' + c.tertiary_text + ';font-variant-numeric:tabular-nums;">' + (total ? start + 1 : 0) + '\u2013' + end + ' of ' + total + '</span>' +
                    '<div style="display:flex;gap:4px;">' +
                        '<span data-nexlify-prev="' + section.key + '" style="' + pDis + 'display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:500;padding:4px 10px;border-radius:6px;background:' + c.btn_secondary + ';color:' + c.btn_secondary_text + ';border:1px solid ' + c.border + ';">' + nexlify_icon("chevron_left") + ' Prev</span>' +
                        '<span data-nexlify-next="' + section.key + '" style="' + nDis + 'display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:500;padding:4px 10px;border-radius:6px;background:' + c.btn_secondary + ';color:' + c.btn_secondary_text + ';border:1px solid ' + c.border + ';">Next ' + nexlify_icon("chevron_right") + '</span>' +
                    '</div>' +
                '</div>',
            c
        ) +
    '</div>';
}

// ---------------------------------------------------------------------------
// Static (non-paginated) documents for monthly dialog
// ---------------------------------------------------------------------------

function nexlify_build_static_documents_html(docs, c) {
    var fakeState = { pages: { mr: 0, po: 0, pi: 0, je: 0, ec: 0 }, docs: docs };
    var sections = [
        { key: "mr", title: "Material Requests", icon: "ti-clipboard-list", route: "material-request", date_field: "transaction_date", has_billed: false },
        { key: "po", title: "Purchase Orders", icon: "ti-shopping-cart", route: "purchase-order", date_field: "transaction_date", has_billed: true },
        { key: "pi", title: "Purchase Invoices", icon: "ti-file-invoice", route: "purchase-invoice", date_field: "posting_date", has_billed: false },
        { key: "je", title: "Journal Entries", icon: "ti-book", route: "journal-entry", date_field: "posting_date", has_billed: false },
        { key: "ec", title: "Expense Claims", icon: "ti-receipt", route: "expense-claim", date_field: "posting_date", has_billed: false },
    ];
    return sections.map(function (s) { return nexlify_build_section_html(s, fakeState, c); }).join("");
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function nexlify_format_currency(amount, currency) {
    var formatted = (amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return currency ? currency + " " + formatted : formatted;
}