frappe.ui.form.on('Opportunity', {
    refresh: function(frm) {
        // Initialize the bypass validation flag on form load
        frm.__bypass_validation = false;

        // Render the Chevron Pipeline Stage Bar component natively
        render_dynamic_stage_bar(frm);
    },
    sales_stage: function(frm) {
        // Re-render the visual track layout to reflect any status modification
        render_dynamic_stage_bar(frm);

        // Closed Won needs a submitted Estimation (Estimation Status = Estimated)
        if (frm.doc.sales_stage === "Closed Won" && frm.doc.custom_estimation_status !== "Estimated") {
            // Back to the stage saved in the database; other unsaved changes stay
            if (frm.is_new()) {
                frm.doc.sales_stage = frappe.meta.get_docfield('Opportunity', 'sales_stage').default || null;
                frm.refresh_field('sales_stage');
                render_dynamic_stage_bar(frm);
            } else {
                frappe.db.get_value('Opportunity', frm.doc.name, 'sales_stage').then(r => {
                    frm.doc.sales_stage = (r.message && r.message.sales_stage) || null;
                    frm.refresh_field('sales_stage');
                    render_dynamic_stage_bar(frm);
                });
            }
            frappe.msgprint({
                title: __('Estimation Required'),
                indicator: 'red',
                message: __('The Opportunity can be Closed Won only after its Estimation is submitted. Estimation Status: {0}',
                    [__(frm.doc.custom_estimation_status || 'Not Sent')]),
                primary_action: {
                    label: __('Go to RFQ'),
                    action: function() {
                        frappe.hide_msgprint();
                        frm.scroll_to_field(frm.doc.custom_estimation_status === 'With Estimation'
                            ? 'custom_estimation_status' : 'custom_rfq_items');
                    }
                }
            });
            return;
        }

        // Immediate Intercept: If user changes stage to Closed Won, trigger validation immediately
        if (frm.doc.sales_stage === "Closed Won" && should_show_closing_dialog(frm)) {
            if (!frm.__bypass_validation) {
                // Instantly revert the field state visually to break Frappe's native auto-save loop freeze
                frm.doc.sales_stage = frm.src_doc ? frm.src_doc.sales_stage : "Open";
                frm.refresh_field('sales_stage');

                // Open the dialog interface independently
                show_closing_date_dialog(frm);
            }
            return;
        }

        // Immediate Intercept: If user changes stage to Closed Lost, collect Lost Reason first
        if (frm.doc.sales_stage === "Closed Lost") {
            if (!frm.__bypass_validation) {
                // Instantly revert the field state visually so we don't trip native validation
                // before we've actually collected a Lost Reason
                frm.doc.sales_stage = frm.src_doc ? frm.src_doc.sales_stage : "Open";
                frm.refresh_field('sales_stage');

                show_lost_reason_dialog(frm);
            }
            return;
        }

        // If stage becomes Closed Won, sync status to Closed
        if (frm.doc.sales_stage === "Closed Won") {
            frm.set_value('status', 'Closed');
        }
    }
});

// Evaluate whether the core custom fields require data collection
function should_show_closing_dialog(frm) {
    if (!frm.doc.custom_closing_date) return true;
    if (!frm.doc.opportunity_amount || frm.doc.opportunity_amount <= 0) return true;
    if (!frm.doc.custom_region) return true;
    return false;
}

// Construct and display the centralized modal dialog interface for Closed Won
function show_closing_date_dialog(frm) {
    let dialog_fields = [];

    // 1. Mandatory Closing Date field assignment
    let date_label = frm.get_docfield('custom_closing_date')?.label || __('Closing Date');
    dialog_fields.push({
        label: date_label,
        fieldname: 'custom_closing_date',
        fieldtype: 'Date',
        reqd: 1,
        default: frm.doc.custom_closing_date || frappe.datetime.get_today()
    });

    // 2. Mandatory Opportunity Amount field assignment
    let amount_label = frm.get_docfield('opportunity_amount')?.label || __('Opportunity Amount');
    dialog_fields.push({
        label: amount_label,
        fieldname: 'opportunity_amount',
        fieldtype: 'Currency',
        reqd: 1,
        default: frm.doc.opportunity_amount || 0,
        description: __('The opportunity amount must be strictly greater than zero.')
    });


    // 4. Mandatory Region field assignment
    let region_docfield = frm.get_docfield('custom_region');
    dialog_fields.push({
        label: region_docfield?.label || __('Region'),
        fieldname: 'custom_region',
        fieldtype: region_docfield?.fieldtype || 'Link',
        options: region_docfield?.options,
        reqd: 1,
        default: frm.doc.custom_region
    });


    let d = new frappe.ui.Dialog({
        title: __('Required Information for Closed Won'),
        fields: dialog_fields,
        primary_action_label: __('Confirm & Save'),
        primary_action(values) {
            if (values.hasOwnProperty('opportunity_amount') && values.opportunity_amount <= 0) {
                frappe.msgprint({
                    title: __('Validation Error'),
                    indicator: 'red',
                    message: __('The Opportunity Amount must be strictly greater than zero.')
                });
                return;
            }

            d.hide();

            // Activate the bypass flag to prevent infinite intercept loop
            frm.__bypass_validation = true;

            // Update field values using set_value so triggers and UI stay in sync
            frm.set_value('sales_stage', 'Closed Won');
            frm.set_value('custom_closing_date', values.custom_closing_date);
            frm.set_value('opportunity_amount', values.opportunity_amount);
            frm.set_value('custom_region', values.custom_region);

            // Bypass the 'status' trigger the same way as the Lost flow,
            // purely for consistency/safety - avoids any core script bound
            // to status changes firing unexpectedly here too.
            frm.doc.status = 'Closed';
            frm.refresh_field('status');

            save_once(frm);
        }
    });

    // Reset properties context stably if user exits modal layout manually
    d.onhide = function() {
        if (frm.doc.sales_stage === "Closed Won" && should_show_closing_dialog(frm)) {
            nexlify_discard_stage(frm);
        }
    };

    d.show();
}

// Condition helpers shared between dialog field defs and the manual
// safety-check inside primary_action. Keeping them in one place means the
// "Competition" / "Other" strings only need to be correct once.
// NOTE: 'lost_reason' is the link fieldname inside the child doctype
// "Opportunity Lost Reason Detail" and 'competitor' is the link fieldname
// inside "Competitor Detail". Confirm these match your child doctypes.
function has_lost_reason(rows, reason_value) {
    return !!(rows && rows.some(function(row) { return row.lost_reason === reason_value; }));
}

// Construct and display the centralized modal dialog interface for Closed Lost
function show_lost_reason_dialog(frm) {
    // Tracks whether THIS dialog run ended in a confirmed successful save.
    // We can't reuse frm.__bypass_validation for this check because
    // save_once() legitimately resets it back to false the moment the save
    // resolves - checking that flag inside onhide would then wrongly look
    // like "user cancelled" and trigger an unnecessary frm.reload_doc(),
    // which is what was causing this same dialog to reappear after a save
    // that had already succeeded.
    let save_confirmed = false;

    let d = new frappe.ui.Dialog({
        title: __('Lost Reason Required'),
        fields: [
            {
                label: __('Lost Reasons'),
                fieldname: 'lost_reasons',
                fieldtype: 'Table MultiSelect',
                options: 'Opportunity Lost Reason Detail',
                reqd: 1,
                get_data: function(txt) {
                    return frappe.db.get_link_options('Opportunity Lost Reason', txt);
                },
                // Re-evaluate mandatory_depends_on on the other fields the
                // moment a reason is picked or removed, so the asterisks
                // (and the blocking validation) show up live inside the
                // dialog itself rather than only on the real form.
                onchange: function() {
                    d.refresh_dependency();
                }
            },
            {
                label: __('Competitors'),
                fieldname: 'competitors',
                fieldtype: 'Table MultiSelect',
                options: 'Competitor Detail',
                get_data: function(txt) {
                    return frappe.db.get_link_options('Competitor', txt);
                },
                // Mirrors the Mandatory Depends On set on the Opportunity
                // doctype's "competitors" field via Customize Form.
                mandatory_depends_on: 'eval:doc.lost_reasons && doc.lost_reasons.some(function(row){ return row.lost_reason == "Competition"; })'
            },
            {
                label: __('Order Lost Reason'),
                fieldname: 'order_lost_reason',
                fieldtype: 'Small Text',
                // Mirrors the Mandatory Depends On set on the Opportunity
                // doctype's "order_lost_reason" field via Customize Form.
                mandatory_depends_on: 'eval:doc.lost_reasons && doc.lost_reasons.some(function(row){ return row.lost_reason == "Other"; })'
            }
        ],
        primary_action_label: __('Declare Lost & Save'),
        primary_action(values) {
            // get_values() already blocks on unmet mandatory_depends_on
            // fields before primary_action is even called, but we keep an
            // explicit check here as a second line of defence in case the
            // field/doctype names above don't exactly match your setup.
            if (!values.lost_reasons || !values.lost_reasons.length) {
                frappe.msgprint({
                    title: __('Validation Error'),
                    indicator: 'red',
                    message: __('At least one Lost Reason is required.')
                });
                return;
            }
            if (has_lost_reason(values.lost_reasons, 'Competition') && (!values.competitors || !values.competitors.length)) {
                frappe.msgprint({
                    title: __('Validation Error'),
                    indicator: 'red',
                    message: __('Competitors is required when Lost Reason is Competition.')
                });
                return;
            }
            if (has_lost_reason(values.lost_reasons, 'Other') && !values.order_lost_reason) {
                frappe.msgprint({
                    title: __('Validation Error'),
                    indicator: 'red',
                    message: __('Order Lost Reason is required when Lost Reason is Other.')
                });
                return;
            }

            // Activate the bypass flag to prevent infinite intercept loop
            frm.__bypass_validation = true;

            // Update field values using set_value so triggers and UI stay in sync.
            // status must be set together with lost_reasons so the native
            // "Lost Reasons are required" validation never fires against an
            // empty table.
            frm.set_value('lost_reasons', values.lost_reasons);
            if (values.competitors && values.competitors.length) {
                frm.set_value('competitors', values.competitors);
            }
            if (values.order_lost_reason) {
                frm.set_value('order_lost_reason', values.order_lost_reason);
            }
            frm.set_value('sales_stage', 'Closed Lost');

            // IMPORTANT: do NOT use frm.set_value('status', 'Lost') here.
            // ERPNext core's own bundled Opportunity script listens for the
            // 'status' field trigger and automatically pops open its own
            // native "Set as Lost" dialog whenever status changes to Lost -
            // that is the exact dialog from your screenshot, and it fires
            // completely independently of this custom script. Since we've
            // already collected lost_reasons/competitors/order_lost_reason
            // ourselves, we mutate frm.doc.status directly (bypassing
            // set_value, and therefore bypassing every 'status' trigger,
            // ours and core's) so the native dialog never gets a chance to
            // fire a second time on top of ours.
            frm.doc.status = 'Lost';
            frm.refresh_field('status');

            // Keep the dialog open (with a disabled button) until we know
            // whether the save actually succeeded, so a rejected save is
            // never mistaken for a silent success.
            d.disable_primary_action();
            save_once(frm)
                .then(() => {
                    save_confirmed = true;
                    d.hide();
                })
                .catch(() => {
                    d.enable_primary_action();
                });
        }
    });

    // Only reload (discarding the reverted sales_stage) if the dialog is
    // closed WITHOUT a confirmed successful save - e.g. the user hit Escape
    // or clicked outside the modal. If the save already succeeded, the form
    // already reflects the correct saved state, so reloading again here
    // would be redundant and was the actual cause of this same dialog
    // reappearing right after a successful save.
    d.onhide = function() {
        if (!save_confirmed) {
            nexlify_discard_stage(frm);
        }
    };

    d.show();
}

// Single, guarded save call shared by both dialogs. Prevents the
// duplicate-record issue caused by clicking Save again while a prior
// save is still resolving or while a stale error dialog is on screen.
// Returns the underlying promise so callers can react to success/failure.
function save_once(frm) {
    if (frm.__saving_in_progress) {
        return Promise.reject(new Error('Save already in progress'));
    }
    frm.__saving_in_progress = true;

    return frm.save()
        .then(() => {
            frm.__bypass_validation = false;
            frm.__saving_in_progress = false;
        })
        .catch((err) => {
            // Reset flags even if save fails, so the user isn't stuck in a
            // locked state. Surface the real error to the user instead of
            // only logging it, so "nothing happens" never happens again.
            frm.__bypass_validation = false;
            frm.__saving_in_progress = false;
            console.error('Save failed:', err);
            frappe.msgprint({
                title: __('Save Failed'),
                indicator: 'red',
                message: (err && err.message) ? err.message : __('The document could not be saved. Please check the required fields and try again.')
            });
            throw err;
        });
}

function render_dynamic_stage_bar(frm) {
    frappe.db.get_list('Sales Stage', {
        fields: ['name', 'custom_sort'],
        order_by: 'custom_sort asc'
    }).then(records => {
        if (!records || records.length === 0) return;

        const stages = records.map(r => r.name);
        const current_stage = frm.doc.sales_stage;
        const current_index = stages.indexOf(current_stage);
        const esc = frappe.utils.escape_html;
        const d = frm.doc;

        inject_opportunity_header_styles();

        const formatted_amount = format_currency(d.opportunity_amount, d.currency);
        const opportunity_name = d.custom_opportunity_name || '';
        const customer_name = d.customer_name || d.customer || __('Not Specified');
        const initials = customer_name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const tone = current_stage === 'Closed Won' ? 'is-won' : (current_stage === 'Closed Lost' ? 'is-lost' : '');

        // Estimation status, shown next to the amount
        const est_status = d.custom_estimation_status || 'Not Sent';
        const est_class = { 'Estimated': 'is-green', 'With Estimation': 'is-orange' }[est_status] || 'is-gray';
        const est_sub = d.custom_estimation ? esc(d.custom_estimation) : __('Not linked yet');

        const ICON = {
            pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
            globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
            tool: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.4-.4-2.1z"/></svg>',
            tag: '<svg viewBox="0 0 24 24"><path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
            cal: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'
        };
        const chip = (icon, label, value) => value
            ? `<span class="nx-chip" title="${esc(label)}">${ICON[icon]}<span>${esc(value)}</span></span>` : '';
        const chips = [
            chip('pin', __('Location'), d.custom_project_location),
            chip('globe', __('Region'), d.custom_region),
            chip('tag', __('Project Type'), d.custom_project_type),
            d.custom_maintenance_type ? chip('tool', __('Maintenance Type'), d.custom_maintenance_type) : '',
            chip('cal', __('Closing Date'), d.custom_closing_date ? frappe.datetime.str_to_user(d.custom_closing_date) : '')
        ].join('');

        const steps = stages.map((stage, index) => {
            let state = index === current_index ? 'is-active' : '';
            if (index === current_index && stage === 'Closed Won') state += ' is-won';
            if (index === current_index && stage === 'Closed Lost') state += ' is-lost';
            return `<div class="nx-step ${state}" data-stage="${esc(stage)}">${esc(stage)}</div>`;
        }).join('');

        let html = `
            <div class="nx-opp-header">
                <div class="nx-opp-card ${tone}">
                    <div class="nx-opp-main">
                        <div><span class="nx-opp-ref-badge">${esc(d.name)}</span></div>
                        <div class="nx-opp-name">${opportunity_name ? esc(opportunity_name) : '<span class="text-muted">' + __('No name') + '</span>'}</div>
                        <div class="nx-opp-customer"><span class="nx-avatar">${esc(initials || '?')}</span><span>${esc(customer_name)}</span></div>
                        ${chips ? `<div class="nx-chips">${chips}</div>` : ''}
                    </div>
                    <div class="nx-opp-kpis">
                        <div class="nx-tile">
                            <div class="nx-tile-label">${__('Estimation')}</div>
                            <div class="nx-tile-value"><span class="nx-opp-pill ${est_class}">${__(est_status)}</span></div>
                            <div class="nx-tile-sub">${est_sub}</div>
                        </div>
                        <div class="nx-tile nx-tile-amount">
                            <div class="nx-tile-label">${__('Opportunity Amount')}</div>
                            <div class="nx-opp-amount">${formatted_amount}</div>
                            <div class="nx-tile-sub">${esc(d.currency || '')}</div>
                        </div>
                    </div>
                </div>
                <div class="nx-steps">${steps}</div>
            </div>`;

        if (frm.get_field('custom_stage_bar_html')) {
            frm.get_field('custom_stage_bar_html').$wrapper.html(html);

            frm.get_field('custom_stage_bar_html').$wrapper.find('.nx-step').on('click', function() {
                let selected_stage = $(this).attr('data-stage');
                if (selected_stage !== current_stage) {
                    frm.set_value('sales_stage', selected_stage).then(() => {
                        if (selected_stage !== "Closed Won" && selected_stage !== "Closed Lost") {
                            frm.save();
                        }
                    });
                }
            });

            setTimeout(() => {
                let active_node = frm.get_field('custom_stage_bar_html').$wrapper.find('.nx-step.is-active');
                if (active_node.length) {
                    active_node[0].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            }, 300);
        }
    });
}

// Styles for the header card and the stage steps (light and dark theme)
function inject_opportunity_header_styles() {
    const old = document.getElementById('nx-opp-header-styles');
    if (old && old.dataset.v === '3') return;
    if (old) old.remove();
    const s = document.createElement('style');
    s.id = 'nx-opp-header-styles';
    s.dataset.v = '3';
    s.innerHTML = `
        .nx-opp-header { margin: 12px 0 4px; }
        .nx-opp-card { position:relative; display:flex; justify-content:space-between; align-items:stretch; flex-wrap:wrap; gap:20px;
            padding:20px 22px 20px 26px; border:1px solid var(--border-color); border-radius:14px; overflow:hidden;
            background:linear-gradient(135deg, rgba(37,99,235,.07) 0%, rgba(37,99,235,0) 45%), var(--card-bg, var(--fg-color));
            box-shadow:0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.04); }
        .nx-opp-card::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px; background:var(--primary, #2563eb); }
        .nx-opp-card.is-won { background:linear-gradient(135deg, rgba(22,163,74,.08) 0%, rgba(22,163,74,0) 45%), var(--card-bg, var(--fg-color)); }
        .nx-opp-card.is-won::before { background:#16a34a; }
        .nx-opp-card.is-lost { background:linear-gradient(135deg, rgba(220,38,38,.07) 0%, rgba(220,38,38,0) 45%), var(--card-bg, var(--fg-color)); }
        .nx-opp-card.is-lost::before { background:#dc2626; }
        .nx-opp-main { min-width:260px; flex:1; display:flex; flex-direction:column; gap:7px; }
        .nx-opp-ref-badge { display:inline-block; font-size:11px; font-weight:600; letter-spacing:.3px; padding:3px 9px; border-radius:6px;
            background:var(--control-bg); color:var(--text-muted); font-variant-numeric:tabular-nums; }
        .nx-opp-name { font-size:20px; font-weight:700; color:var(--heading-color, var(--text-color)); line-height:1.3; letter-spacing:-.2px; }
        .nx-opp-customer { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:500; color:var(--text-color); }
        .nx-avatar { width:26px; height:26px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center;
            font-size:10.5px; font-weight:700; color:#fff; background:linear-gradient(135deg, #6366f1, #2563eb); flex-shrink:0; }
        .nx-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; }
        .nx-chip { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; border-radius:999px; font-size:11.5px; font-weight:500;
            color:var(--text-color); background:var(--card-bg, var(--fg-color)); border:1px solid var(--border-color); }
        .nx-chip svg { width:13px; height:13px; fill:none; stroke:var(--text-muted); stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
        .nx-opp-kpis { display:flex; gap:12px; flex-wrap:wrap; align-items:stretch; }
        .nx-tile { min-width:180px; padding:12px 16px; border-radius:12px; background:var(--control-bg); border:1px solid var(--border-color);
            display:flex; flex-direction:column; justify-content:center; gap:6px; text-align:right; }
        .nx-tile-label { font-size:10.5px; text-transform:uppercase; letter-spacing:.5px; color:var(--text-muted); font-weight:600; }
        .nx-tile-value { display:flex; justify-content:flex-end; }
        .nx-tile-sub { font-size:11.5px; color:var(--text-muted); font-variant-numeric:tabular-nums; }
        .nx-tile-amount { background:linear-gradient(135deg, rgba(22,163,74,.10), rgba(22,163,74,.02)); border-color:rgba(22,163,74,.25); }
        .nx-opp-amount { font-size:24px; font-weight:800; color:#15803d; white-space:nowrap; font-variant-numeric:tabular-nums; line-height:1.1; letter-spacing:-.3px; }
        .nx-opp-pill { display:inline-block; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
        .nx-opp-pill.is-green { background:rgba(22,163,74,.12); color:#15803d; }
        .nx-opp-pill.is-orange { background:rgba(234,88,12,.12); color:#c2410c; }
        .nx-opp-pill.is-gray { background:var(--card-bg, var(--fg-color)); color:var(--text-muted); border:1px solid var(--border-color); }
        .nx-steps { display:flex; gap:4px; margin-top:10px; padding:4px; overflow-x:auto; border-radius:12px;
            background:var(--control-bg); border:1px solid var(--border-color); scroll-behavior:smooth; -webkit-overflow-scrolling:touch; }
        .nx-step { flex:1 0 auto; display:flex; align-items:center; justify-content:center; gap:8px; padding:8px 16px; border-radius:9px;
            cursor:pointer; color:var(--text-muted); font-size:12.5px; font-weight:500; white-space:nowrap;
            transition:background .15s, color .15s, box-shadow .15s; }
        .nx-step:hover { color:var(--text-color); background:rgba(0,0,0,.04); }
        .nx-step.is-active { background:var(--card-bg, var(--fg-color)); color:var(--primary, #2563eb); font-weight:600; cursor:default;
            box-shadow:0 1px 3px rgba(0,0,0,.08), 0 0 0 1px var(--border-color); }
        .nx-step.is-active::before { content:''; width:7px; height:7px; border-radius:50%; background:currentColor; flex-shrink:0; }
        .nx-step.is-active.is-won { color:#16a34a; }
        .nx-step.is-active.is-lost { color:#dc2626; }
        [data-theme="dark"] .nx-opp-card { box-shadow:none; }
        [data-theme="dark"] .nx-opp-amount { color:#4ade80; }
        [data-theme="dark"] .nx-tile-amount { background:linear-gradient(135deg, rgba(74,222,128,.10), rgba(74,222,128,.02)); border-color:rgba(74,222,128,.25); }
        [data-theme="dark"] .nx-opp-pill.is-green { color:#4ade80; }
        [data-theme="dark"] .nx-opp-pill.is-orange { color:#fb923c; }
        [data-theme="dark"] .nx-step:hover { background:rgba(255,255,255,.06); }
        [data-theme="dark"] .nx-step.is-active.is-won { color:#4ade80; }
        [data-theme="dark"] .nx-step.is-active.is-lost { color:#f87171; }
        @media (max-width: 768px) {
            .nx-opp-name { font-size:18px; }
            .nx-opp-kpis { width:100%; }
            .nx-tile { flex:1; text-align:left; min-width:140px; }
            .nx-tile-value { justify-content:flex-start; }
        }
    `;
    document.head.appendChild(s);
}

// Undo a stage change the user backed out of. A saved Opportunity is reloaded
// from the server; a new one has nothing to reload, so its stage goes back to
// the default instead (reloading it would show "Opportunity new-... not found").
function nexlify_discard_stage(frm) {
    frm.__bypass_validation = false;
    if (!frm.is_new()) {
        frm.reload_doc();
        return;
    }
    frm.doc.sales_stage = frappe.meta.get_docfield('Opportunity', 'sales_stage').default || null;
    frm.refresh_field('sales_stage');
}
