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
    if (!frm.doc.custom_maintenance_nature) return true;
    if (!frm.doc.custom_region) return true;
    if (!frm.doc.custom_project_type) return true;
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

    // 3. Mandatory Maintenance Nature field assignment (mirrors the actual
    //    fieldtype/options from the real field, so it stays in sync
    //    automatically if that field is ever reconfigured)
    let nature_docfield = frm.get_docfield('custom_maintenance_nature');
    dialog_fields.push({
        label: nature_docfield?.label || __('Maintenance Nature'),
        fieldname: 'custom_maintenance_nature',
        fieldtype: nature_docfield?.fieldtype || 'Link',
        options: nature_docfield?.options,
        reqd: 1,
        default: frm.doc.custom_maintenance_nature
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

    // 5. Mandatory Project Type field assignment
    let type_docfield = frm.get_docfield('custom_project_type');
    dialog_fields.push({
        label: type_docfield?.label || __('Project Type'),
        fieldname: 'custom_project_type',
        fieldtype: type_docfield?.fieldtype || 'Link',
        options: type_docfield?.options,
        reqd: 1,
        default: frm.doc.custom_project_type
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
            frm.set_value('custom_maintenance_nature', values.custom_maintenance_nature);
            frm.set_value('custom_region', values.custom_region);
            frm.set_value('custom_project_type', values.custom_project_type);

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
            frm.__bypass_validation = false;
            frm.reload_doc();
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
            frm.__bypass_validation = false;
            frm.reload_doc();
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

        let formatted_amount = format_currency(frm.doc.opportunity_amount, frm.doc.currency);
        let opportunity_name = frm.doc.custom_opportunity_name || '';
        let customer_name = frm.doc.customer_name || frm.doc.customer || __('Not Specified');

        let html = `
            <div class="pipeline-main-wrapper" style="width: 100%; margin: 15px 0; padding: 0 5px;">
                <div class="opportunity-mini-dash" style="
                    display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; margin-bottom: 15px; padding: 12px 15px; background-color: var(--card-bg, #ffffff); border: 1px solid var(--border-color, #e2e8f0); border-radius: 8px; gap: 15px;
                ">
                    <div class="dash-left-side" style="display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 250px; white-space: normal; word-break: break-word;">
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="font-size: 11px; color: var(--text-muted, #718096); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Opportunity Reference</span>
                            <span style="font-size: 15px; font-weight: 700; color: var(--text-color-important, #2b6cb0);">${frm.doc.name}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="font-size: 11px; color: var(--text-muted, #718096); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Opportunity Name</span>
                            <span style="font-size: 16px; font-weight: 600; color: var(--text-color-important, #2b6cb0); line-height: 1.4;">${opportunity_name}</span>
                        </div>
                    </div>
                    
                    <div class="dash-right-side" style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex-shrink: 0; text-align: right; margin-left: auto; min-width: 200px;">
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px; margin-bottom: 4px;">
                            <span style="font-size: 11px; color: var(--text-muted, #718096); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Customer Name</span>
                            <span style="font-size: 14px; font-weight: 600; color: var(--text-color-important, #2b6cb0);">${customer_name}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 2px;">
                            <span style="font-size: 11px; color: var(--text-muted, #718096); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Opportunity Amount</span>
                            <span style="font-size: 20px; font-weight: 800; color: var(--text-color-success, #28a745); white-space: nowrap;">${formatted_amount}</span>
                        </div>
                    </div>
                </div>
                <div class="modern-pipeline" style="
                    display: flex; width: 100%; background-color: var(--bg-light-gray, #f8f9fa); border-radius: 8px; overflow-x: auto; overflow-y: hidden; border: 1px solid var(--border-color, #e2e8f0); box-shadow: var(--shadow-inset, inset 0 1px 3px rgba(0,0,0,0.05)); scroll-behavior: smooth; -webkit-overflow-scrolling: touch;
                ">
        `;

        stages.forEach((stage, index) => {
            let bg, text_color, font_weight, is_active = (index === current_index);
            if (is_active) {
                bg = "var(--text-color-important, #2b6cb0)"; text_color = "var(--bg-white, #ffffff)"; font_weight = "600";
            } else if (index < current_index) {
                bg = "var(--bg-gray, #edf2f7)"; text_color = "var(--text-muted, #4a5568)"; font_weight = "500";
            } else {
                bg = "transparent"; text_color = "var(--text-light, #718096)"; font_weight = "400";
            }

            let is_first = (index === 0);
            let is_last = (index === stages.length - 1);
            let clip_path = "polygon(0% 0%, 97% 0%, 100% 50%, 97% 100%, 0% 100%, 3% 50%)";
            if (is_first) clip_path = "polygon(0% 0%, 97% 0%, 100% 50%, 97% 100%, 0% 100%)";
            if (is_last) clip_path = "polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%, 3% 50%)";

            html += `
                <div class="pipeline-step" data-stage="${stage}" style="
                    flex: 1 0 auto; width: max-content; text-align: center; padding: 12px 25px 12px 30px; background: ${bg}; color: ${text_color}; font-weight: ${font_weight}; font-size: 13px; cursor: pointer; white-space: nowrap; clip-path: ${clip_path}; margin-right: -6px; transition: all 0.2s ease-in-out; border-right: 1px solid var(--border-color, #edf2f7);
                " onmouseover="if(${!is_active}){this.style.background='var(--bg-gray-dark, #cbd5e0)'; this.style.color='var(--text-color, #000)';}" onmouseout="if(${!is_active}){this.style.background='${bg}'; this.style.color='${text_color}';}">
                    ${stage}
                </div>
            `;
        });

        html += `</div></div>`;

        if (frm.get_field('custom_stage_bar_html')) {
            frm.get_field('custom_stage_bar_html').$wrapper.html(html);

            frm.get_field('custom_stage_bar_html').$wrapper.find('.pipeline-step').on('click', function() {
                let selected_stage = $(this).data('stage');
                if (selected_stage !== current_stage) {
                    frm.set_value('sales_stage', selected_stage).then(() => {
                        if (selected_stage !== "Closed Won" && selected_stage !== "Closed Lost") {
                            frm.save();
                        }
                    });
                }
            });

            setTimeout(() => {
                let active_node = frm.get_field('custom_stage_bar_html').$wrapper.find('.pipeline-step[data-stage="'+current_stage+'"]');
                if (active_node.length) {
                    active_node[0].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
            }, 300);
        }
    });
}
