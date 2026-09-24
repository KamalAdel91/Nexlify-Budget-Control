// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on("Project Overview", {
	refresh: function(frm) {
		inject_overview_styles();
		render_overview_summary(frm);
	}
});

function inject_overview_styles() {
	if (document.getElementById('npo-styles')) return;
	let style = document.createElement('style');
	style.id = 'npo-styles';
	style.innerHTML = `
		.npo-kpi-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
		.npo-kpi-card {
			flex: 1 1 180px; min-width: 0;
			background: var(--card-bg, var(--fg-color, #f8f9fb));
			border: 1px solid var(--border-color, #e9ecef);
			border-radius: 10px; padding: 12px 14px;
		}
		.npo-kpi-label {
			font-size: 11px; font-weight: 600; color: var(--text-muted, #6c757d);
			text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 6px;
		}
		.npo-kpi-value { font-size: clamp(16px, 4vw, 22px); font-weight: 700; line-height: 1.2; }
		.npo-status-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
		.npo-status-card {
			flex: 1 1 180px; min-width: 0;
			border: 1px solid var(--border-color, #e9ecef);
			border-radius: 10px; padding: 12px 14px;
			display: flex; justify-content: space-between; align-items: center;
		}
		.npo-status-label { font-size: 12px; font-weight: 600; color: var(--text-color, inherit); }
		.npo-badge {
			font-size: 10.5px; font-weight: 600; padding: 3px 10px; border-radius: 10px;
			background: var(--control-bg, #f1f3f5); color: var(--text-muted, #6c757d);
		}
		.npo-badge-submitted { background: var(--green-100, #ebfbee); color: var(--green-600, #2b8a3e); }
		.npo-badge-draft { background: var(--orange-100, #fff4e6); color: var(--orange-600, #e8590c); }
		.npo-badge-missing { background: var(--red-100, #fff0f0); color: var(--red-600, #e03131); }
		.npo-section-title {
			font-size: 13px; font-weight: 700; color: var(--text-color, inherit);
			margin: 18px 0 10px 0;
		}
		.npo-table-wrapper {
			border: 1px solid var(--border-color, #e9ecef); border-radius: 10px;
			overflow-x: auto; margin-bottom: 18px;
		}
		.npo-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
		.npo-table thead tr { background: var(--control-bg, #f8f9fb); border-bottom: 1px solid var(--border-color, #e9ecef); }
		.npo-table th {
			padding: 9px 10px; text-align: left; font-size: 10.5px; font-weight: 600;
			color: var(--text-muted, #6c757d); text-transform: uppercase; white-space: nowrap;
		}
		.npo-table td { padding: 9px 10px; border-bottom: 1px solid var(--border-color, #e9ecef); }
		.npo-table th:not(:first-child), .npo-table td:not(:first-child) { text-align: center !important; }
		.npo-table tbody tr:last-child td { border-bottom: none; }
		.npo-table tfoot tr { background: var(--control-bg, #f8f9fb); }
		.npo-text-right { text-align: right; }
		.npo-link { color: var(--link-color, #2b6cb0); font-weight: 600; text-decoration: none; }
		.npo-link:hover { text-decoration: underline; }
		.npo-empty {
			padding: 20px 14px; text-align: center; color: var(--text-muted, #6c757d);
			font-size: 12.5px; border: 1px dashed var(--border-color, #e9ecef); border-radius: 8px;
			margin-bottom: 18px;
		}
	`;
	document.head.appendChild(style);
}

function render_overview_summary(frm) {
	if (frm.is_new() || !frm.doc.project) {
		frm.set_df_property('overview_html', 'options', `<div class="npo-empty">${__('Save with a Project linked to see the overview.')}</div>`);
		frm.refresh_field('overview_html');
		return;
	}
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_overview_page',
		args: { overview: frm.doc.name },
		callback: function(r) {
			frm.set_df_property('overview_html', 'options', pop_page_html(frm, r.message || {}));
			frm.refresh_field('overview_html');
			frm.toggle_display('scope_section', false);
			const $slot = frm.fields_dict.overview_html.$wrapper.find('.pop-scope-slot');
			if ($slot.length) {
				frm.__pov_scope_target = $slot;
				pov_render_scope(frm);
			}
		}
	});
}

function status_badge(docstatus, missing_text) {
	if (docstatus === undefined || docstatus === null) {
		return `<span class="npo-badge npo-badge-missing">${missing_text}</span>`;
	}
	if (docstatus === 1) return `<span class="npo-badge npo-badge-submitted">${__('Submitted')}</span>`;
	if (docstatus === 2) return `<span class="npo-badge npo-badge-missing">${__('Cancelled')}</span>`;
	return `<span class="npo-badge npo-badge-draft">${__('Draft')}</span>`;
}

function fmt_currency(value, currency) {
	return frappe.format(value || 0, { fieldtype: 'Currency', options: currency });
}

function build_overview_html(data) {
	let currency = data.currency;
	let profit_color = (data.expected_profit || 0) >= 0 ? 'var(--green-500, #2b8a3e)' : 'var(--red-500, #e03131)';

	let revenue_card = data.can_see_price ? `
			<div class="npo-kpi-card">
				<div class="npo-kpi-label">${__('Planned Revenue')}</div>
				<div class="npo-kpi-value" style="color: var(--blue-500, #2b6cb0);">${fmt_currency(data.planned_revenue, currency)}</div>
			</div>
	` : '';
	let profit_card = data.can_see_price ? `
			<div class="npo-kpi-card">
				<div class="npo-kpi-label">${__('Expected Profit')}</div>
				<div class="npo-kpi-value" style="color: ${profit_color};">${fmt_currency(data.expected_profit, currency)}</div>
			</div>
	` : '';

	let kpi_html = `
		<div class="npo-kpi-row">
			${revenue_card}
			<div class="npo-kpi-card">
				<div class="npo-kpi-label">${__('Planned Cost')}</div>
				<div class="npo-kpi-value" style="color: var(--orange-500, #e8590c);">${fmt_currency(data.planned_cost, currency)}</div>
			</div>
			${profit_card}
		</div>
	`;

	let status_html = `
		<div class="npo-status-row">
			<div class="npo-status-card">
				<span class="npo-status-label">${data.plan_name ? `<a href="/app/project-planning/${data.plan_name}" class="npo-link">${__('Plan')}</a>` : __('Plan')}</span>
				${status_badge(data.plan_status, __('Not Created'))}
			</div>
			<div class="npo-status-card">
				<span class="npo-status-label">${data.cost_name ? `<a href="/app/project-cost-budget/${data.cost_name}" class="npo-link">${__('Estimation')}</a>` : __('Estimation')}</span>
				${status_badge(data.cost_status, __('Not Created'))}
			</div>
		</div>
	`;

	let visits_html = build_visits_section(data.visits || []);
	let invoices_html = build_invoices_section(data.invoices || []);
	let cost_html = build_cost_section(data.cost_dashboard, currency);

	return kpi_html + status_html + visits_html + invoices_html + cost_html;
}

function build_visits_section(visits) {
	pov_inject_styles();
	const esc = frappe.utils.escape_html;
	let title = `<div class="npo-section-title">${__('Visits')}</div>`;
	if (!visits.length) {
		return title + `<div class="npo-empty">${__('No visits added yet.')}</div>`;
	}
	const date = d => d ? frappe.datetime.str_to_user(d) : '-';
	const rows = visits.map(v => {
		const equipment = (v.equipment || []).length
			? (v.equipment || []).map(a => `<div>${esc(a.equipment || '')} <span class="text-muted">× ${flt(a.quantity, 2)}</span></div>`).join('')
			: `<span class="text-muted">${__('No equipment')}</span>`;
		const team = (v.team || []).filter(t => cint(t.headcount) > 0);
		const team_html = team.length
			? `<div class="pov-crew-list">${team.map(t => `<span class="pov-crew"><span class="pov-crew-n">${cint(t.headcount)}</span><span class="pov-crew-t">${esc(t.trade || '')}</span></span>`).join('')}</div>`
			: `<span class="text-muted">${__('No team')}</span>`;
		return `<tr>
			<td>
				<a href="/app/project-visits/${v.name}" class="npo-link">${esc(v.visit_label || v.name)}</a>
				<div class="text-muted" style="font-size:11.5px; margin-top:2px;">${date(v.start_date)} ${__('to')} ${date(v.end_date)}</div>
			</td>
			<td style="text-align:right;">${v.working_days != null ? flt(v.working_days, 2) : '-'}</td>
			<td>${equipment}</td>
			<td>${team_html}</td>
		</tr>`;
	}).join('');
	return title + `
		<div class="npo-table-wrapper">
			<table class="npo-table">
				<thead><tr>
					<th>${__('Visit')}</th>
					<th style="text-align:right;">${__('Working days')}</th>
					<th>${__('Equipment')}</th>
					<th>${__('Team')}</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>
	`;
}

function build_invoices_section(invoices) {
	let title = `<div class="npo-section-title">${__('Invoicing')}</div>`;
	if (!invoices.length) {
		return title + `<div class="npo-empty">${__('No invoices added yet.')}</div>`;
	}
	let total = 0;
	let rows = invoices.map(inv => {
		total += flt(inv.invoice_percentage);
		let so = inv.sales_order ? `<a href="/app/sales-order/${inv.sales_order}" class="npo-link">${inv.sales_order}</a>` : '-';
		return `
			<tr>
				<td><a href="/app/project-invoicing/${inv.name}" class="npo-link">${frappe.utils.escape_html(inv.invoice_label || inv.name)}</a></td>
				<td>${inv.expected_invoice_date ? frappe.datetime.str_to_user(inv.expected_invoice_date) : '-'}</td>
				<td class="npo-text-right">${flt(inv.invoice_percentage).toFixed(2)}%</td>
				<td>${frappe.utils.escape_html(inv.invoice_description || '')}</td>
				<td>${inv.status || ''}</td>
				<td>${so}</td>
			</tr>
		`;
	}).join('');
	return title + `
		<div class="npo-table-wrapper">
			<table class="npo-table">
				<thead><tr><th>${__('Invoice')}</th><th>${__('Expected Date')}</th><th class="npo-text-right">${__('%')}</th><th>${__('Description')}</th><th>${__('Status')}</th><th>${__('Sales Order')}</th></tr></thead>
				<tbody>${rows}</tbody>
				<tfoot><tr><td colspan="2" class="npo-text-right"><b>${__('Total')}</b></td><td class="npo-text-right"><b>${total.toFixed(2)}%</b></td><td colspan="3"></td></tr></tfoot>
			</table>
		</div>
	`;
}

function build_cost_section(cost_dashboard, currency) {
	let title = `<div class="npo-section-title">${__('Cost Breakdown')}</div>`;
	if (!cost_dashboard || !cost_dashboard.has_budget || !cost_dashboard.is_submitted || !cost_dashboard.rows) {
		return title + `<div class="npo-empty">${__('No submitted Costing to break down yet.')}</div>`;
	}
	let rows = cost_dashboard.rows.map(row => `
		<tr>
			<td>${frappe.utils.escape_html(row.budget_category)}</td>
			<td>${fmt_currency(row.estimated_amount, currency)}</td>
			<td>${fmt_currency(row.cumulative_expense_amount, currency)}</td>
			<td>${fmt_currency(row.remaining_amount, currency)}</td>
		</tr>
	`).join('');
	return title + `
		<div class="npo-table-wrapper">
			<table class="npo-table">
				<thead><tr><th>${__('Category')}</th><th class="npo-text-right">${__('Estimated')}</th><th class="npo-text-right">${__('Spent')}</th><th class="npo-text-right">${__('Remaining')}</th></tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>
	`;
}

// Return actions (Return to Planning / Return to COO) need a reason
frappe.ui.form.on('Project Overview', {
	before_workflow_action(frm) {
		let action = frm.selected_workflow_action || '';
		if (!action.startsWith('Return')) return;
		return new Promise((resolve, reject) => {
			frappe.dom.unfreeze();
			let done = false;
			let d = new frappe.ui.Dialog({
				title: __(action),
				fields: [{ fieldname: 'reason', fieldtype: 'Small Text', label: __('Reason'), reqd: 1 }],
				primary_action_label: __(action),
				primary_action(v) {
					done = true;
					d.hide();
					frappe.call({
						method: 'nexlify_budget_control.nexlify_budget_control.doctype.project_overview.project_overview.set_return_reason',
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

// ---------------------------------------------------------------------------
// Scope: Plan vs Estimation (equipment and crew counts only)
// ---------------------------------------------------------------------------

frappe.ui.form.on('Project Overview', {
	refresh(frm) { pov_render_scope(frm); }
});

function pov_inject_styles() {
	$('#pov-styles').remove();
	const css = `
	.pov-card { border: 1px solid var(--border-color); border-radius: 12px; background: var(--card-bg); overflow: hidden; }
	.pov-bar { display: flex; align-items: center; gap: 2px; padding: 6px; background: var(--subtle-fg); border-bottom: 1px solid var(--border-color); flex-wrap: wrap; }
	.pov-card .pov-tab, .pov-card .pov-tab:focus, .pov-card .pov-tab:active { outline: none !important; border: none !important; box-shadow: none !important; }
	.pov-tab { background: transparent; padding: 5px 14px; border-radius: 8px; font-size: 13px; color: var(--text-muted); cursor: pointer; }
	.pov-tab:hover { color: var(--text-color); }
	.pov-card .pov-tab.active { background: var(--card-bg); color: var(--text-color); font-weight: 600; box-shadow: var(--shadow-sm) !important; }
	.pov-card .pov-tab:focus-visible { outline: 2px solid var(--primary, #2490ef) !important; outline-offset: 1px; }
	.pov-status { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; }
	.pov-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
	.pov-status.ok { background: var(--green-50, #ebfbee); color: var(--green-700, #2b8a3e); }
	.pov-status.diff { background: var(--orange-50, #fff4e6); color: var(--orange-700, #d9480f); }
	.pov-panel { display: none; padding-bottom: 10px; }
	.pov-panel.active { display: block; }
	.pov-h { font-size: 13px; font-weight: 600; color: var(--text-color); padding: 16px 18px 6px; }
	.pov-h.sep { border-top: 1px solid var(--border-color); margin-top: 14px; padding-top: 14px; }
	.pov-hint { font-size: 12px; font-weight: 400; color: var(--text-muted); margin-left: 8px; }
	.pov-res { padding: 0 18px; }
	.pov-row { display: grid; grid-template-columns: minmax(120px, 190px) 1fr minmax(130px, auto); align-items: center; gap: 16px; padding: 8px 0; border-bottom: 1px dashed var(--border-color); }
	.pov-row.single { grid-template-columns: minmax(120px, 190px) 1fr; }
	.pov-row:last-child { border-bottom: none; }
	.pov-label { font-size: 13px; color: var(--text-color); }
	.pov-track { position: relative; height: 8px; border-radius: 999px; background: var(--control-bg, #f3f3f3); }
	.pov-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; transform-origin: left center; animation: pov-grow .55s ease-out; }
	.pov-fill.ok { background: var(--green-500, #40c057); }
	.pov-fill.over { background: var(--red-500, #fa5252); }
	.pov-fill.under { background: var(--orange-500, #fd7e14); }
	.pov-mark { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; border-radius: 1px; background: var(--text-color); opacity: .65; }
	.pov-num { font-size: 13px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
	.pov-row.single .pov-num { text-align: left; font-weight: 600; }
	.pov-num b { font-weight: 600; }
	.pov-of { color: var(--text-muted); }
	.pov-legend { font-size: 12px; color: var(--text-muted); padding: 6px 18px 0; }
	.pov-legend .pov-key { display: inline-block; width: 2px; height: 10px; background: var(--text-color); opacity: .65; vertical-align: -1px; margin: 0 4px; }
	@keyframes pov-grow { from { transform: scaleX(0); } }
	@media (prefers-reduced-motion: reduce) { .pov-fill { animation: none; } }
	.pov-delta { display: inline-block; font-size: 11px; font-weight: 600; padding: 0 6px; border-radius: 8px; margin-left: 6px; }
	.pov-delta.over { background: var(--red-50, #fff5f5); color: var(--red-600, #c92a2a); }
	.pov-delta.under { background: var(--orange-50, #fff4e6); color: var(--orange-700, #d9480f); }
	.pov-scroll { overflow-x: auto; padding: 0 18px; }
	.pov-table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
	.pov-table th { font-size: 12px; font-weight: 600; color: var(--text-muted); padding: 8px 10px; text-align: center; white-space: nowrap; border-bottom: 1px solid var(--border-color); }
	.pov-table td { padding: 9px 10px; text-align: center; white-space: nowrap; border-bottom: 1px solid var(--border-color); }
	.pov-table th:first-child, .pov-table td:first-child { text-align: left; }
	.pov-table tbody td:first-child { font-weight: 500; }
	.pov-table tfoot td { font-weight: 600; border-bottom: none; }
	.pov-table .pov-group th { border-bottom: none; padding-bottom: 0; color: var(--text-color); }
	.pov-table .pov-group th[colspan] { border-bottom: 1px solid var(--border-color); padding-bottom: 4px; }
	.pov-table th.n, .pov-table td.n { text-align: right; width: 110px; }
	.pov-table td { vertical-align: middle; }
	.pov-table tfoot td { border-top: 1px solid var(--border-color); }
	.pov-crew-list { display: flex; flex-wrap: wrap; gap: 6px; }
	.pov-crew { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px 2px 3px; border-radius: 999px; background: var(--subtle-fg); border: 1px solid var(--border-color); font-size: 12px; white-space: nowrap; }
	.pov-crew-n { min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: var(--card-bg); display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 11.5px; font-variant-numeric: tabular-nums; }
	.pov-crew .pov-delta { margin-left: 0; }
	.pov-crew.gone { opacity: .6; }
	.pov-crew.gone .pov-crew-t { text-decoration: line-through; }
	.pov-res { max-width: 780px; }
	.pov-frame { display: inline-block; max-width: 100%; border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; }
	.pov-frame .pov-table { width: auto; min-width: 560px; }
	.pov-frame .pov-table thead th { background: var(--subtle-fg); padding: 9px 16px; }
	.pov-frame .pov-table td { padding: 10px 16px; }
	.pov-frame .pov-table tbody tr:last-child td { border-bottom: none; }
	.pov-eq { font-weight: 500; }
	.pov-eq-st { margin-top: 4px; }
	.pov-card { width: fit-content; max-width: 100%; }
	.pov-card .pov-bar { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 12px; }
	.pov-tabs { display: flex; gap: 2px; }
	.pov-card .pov-status { margin-left: 0; justify-self: end; white-space: nowrap; }
	.pov-table th.c, .pov-table td.c { text-align: center; }
	.pov-table td.c .pov-crew-list { justify-content: center; }
	.pov-table th.c, .pov-table td.c { width: 340px; min-width: 340px; white-space: normal; }
	.pov-card .pov-res { max-width: none; }
	.pov-card .pov-row { grid-template-columns: 190px 320px minmax(130px, auto); }
	.pov-card .pov-row.single { grid-template-columns: 190px auto; }
	@media (max-width: 720px) {
		.pov-card { width: 100%; }
		.pov-card .pov-bar { grid-template-columns: 1fr; justify-items: start; }
		.pov-card .pov-status { justify-self: start; }
		.pov-card .pov-row { grid-template-columns: 1fr auto; row-gap: 6px; }
		.pov-card .pov-row .pov-track { grid-column: 1 / -1; grid-row: 2; }
	}
	.pov-left { text-align: left !important; white-space: normal !important; }
	.pov-chip { display: inline-block; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; margin: 1px 2px 1px 0; }
	.pov-chip.ok { background: var(--green-50, #ebfbee); color: var(--green-700, #2b8a3e); }
	.pov-chip.under { background: var(--orange-50, #fff4e6); color: var(--orange-700, #d9480f); }
	.pov-chip.over { background: var(--red-50, #fff5f5); color: var(--red-600, #c92a2a); }
	.pov-empty { padding: 16px 18px; color: var(--text-muted); font-size: 13px; }
	`;
	$('<style id="pov-styles">').text(css).appendTo('head');
}

function pov_render_scope(frm) {
	if (frm.is_new() || !frm.fields_dict.scope_html) return;
	pov_inject_styles();
	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_overview_scope',
		args: { overview: frm.doc.name },
		callback: function(r) {
			const $w = frm.__pov_scope_target || frm.fields_dict.scope_html.$wrapper;
			$w.html(pov_scope_html(r.message || {}));
			$w.find('.pov-tab').on('click', function() {
				const key = $(this).data('tab');
				$w.find('.pov-tab').removeClass('active');
				$(this).addClass('active');
				$w.find('.pov-panel').removeClass('active');
				$w.find(`.pov-panel[data-panel="${key}"]`).addClass('active');
			});
		}
	});
}

function pov_scope_html(data) {
	const esc = frappe.utils.escape_html;
	const trades = data.trades || [];
	const rows = data.comparison || [];
	const num = v => flt(v, 2);
	if (!rows.length) return `<div class="pop-empty">${__('The Estimation and the Plan have no equipment yet.')}</div>`;

	const total = (list, fn) => list.reduce((s, r) => s + flt(fn(r)), 0);
	const all_est = rows.map(r => r.est), all_plan = rows.map(r => r.plan);
	const kind = (p, e) => (flt(p) === flt(e) ? 'ok' : (flt(p) > flt(e) ? 'over' : 'under'));
	const delta = (p, e) => {
		const d = flt(flt(p) - flt(e), 2);
		return d ? `<span class="pov-delta ${d > 0 ? 'over' : 'under'}">${d > 0 ? '+' : '−'}${num(Math.abs(d))}</span>` : '';
	};
	const measures = [
		[__('Equipment units'), r => r.quantity],
		[__('Work days'), r => r.total_days],
	].concat(trades.map(t => [__('{0} person-days', [esc(t)]), r => flt(r.total_days) * flt((r.roles || {})[t])]));

	// ---- Resources: cards ----
	const resources = mode => {
		const cards = measures.map(([label, fn]) => {
			const e = total(all_est, fn), p = total(all_plan, fn);
			if (mode !== 'cmp') {
				return `<div class="pop-kpi"><div class="pop-kpi-l">${label}</div><div class="pop-kpi-v">${num(mode === 'est' ? e : p)}</div></div>`;
			}
			const max = Math.max(e, p) || 1;
			return `<div class="pop-kpi">
				<div class="pop-kpi-l">${label}</div>
				<div class="pop-kpi-v">${num(p)} <span class="pop-of">${__('of {0}', [num(e)])}</span>${delta(p, e)}</div>
				<div class="pov-track" title="${__('Plan {0} / Estimation {1}', [num(p), num(e)])}">
					<div class="pov-fill ${kind(p, e)}" style="width:${(p / max) * 100}%;"></div>
					<div class="pov-mark" style="left:${(e / max) * 100}%;"></div>
				</div>
			</div>`;
		}).join('');
		return `<div class="pop-cards">${cards}</div>`;
	};

	// ---- Status ----
	const chip = (text, k) => `<span class="pov-chip ${k}">${text}</span>`;
	const status = r => {
		if (r.not_planned) return chip(__('Not planned'), 'under');
		if (r.not_in_estimation) return chip(__('Not in the Estimation'), 'over');
		const e = r.est, p = r.plan, out = [];
		const move = (pv, ev, less, more) => {
			if (flt(pv) < flt(ev)) out.push(chip(less, 'under'));
			else if (flt(pv) > flt(ev)) out.push(chip(more, 'over'));
		};
		move(p.quantity, e.quantity, __('Fewer units'), __('More units'));
		move(p.days_per_equipment, e.days_per_equipment, __('Fewer days per unit'), __('More days per unit'));
		trades.forEach(t => {
			const pc = cint((p.roles || {})[t]), ec = cint((e.roles || {})[t]);
			if (ec && !pc) out.push(chip(__('{0} removed', [esc(t)]), 'under'));
			else if (!ec && pc) out.push(chip(__('{0} added', [esc(t)]), 'over'));
			else move(pc, ec, __('Fewer {0}', [esc(t)]), __('More {0}', [esc(t)]));
		});
		return out.join(' ');
	};

	// ---- By Equipment: boxes like the visits ----
	let differ = 0;
	const equipment = mode => {
		const list = mode === 'est' ? rows.filter(r => !r.not_in_estimation) : mode === 'plan' ? rows.filter(r => !r.not_planned) : rows;
		const val = (r, get) => {
			if (mode === 'est') return num(get(r.est));
			if (mode === 'plan') return num(get(r.plan));
			return `${num(get(r.plan))}${delta(get(r.plan), get(r.est))}`;
		};
		const mini = (l, v) => `<div><div class="pop-mini-l">${l}</div><div class="pop-mini-v">${v}</div></div>`;
		const crew = r => {
			const items = trades.map(t => {
				const p = cint((r.plan.roles || {})[t]), e = cint((r.est.roles || {})[t]);
				const v = mode === 'est' ? e : p;
				if (mode === 'cmp' ? (!p && !e) : !v) return '';
				const gone = mode === 'cmp' && !p && e;
				return `<span class="pov-crew${gone ? ' gone' : ''}"><span class="pov-crew-n">${v}</span><span class="pov-crew-t">${esc(t)}</span>${mode === 'cmp' ? delta(p, e) : ''}</span>`;
			}).join('');
			return items ? `<div class="pov-crew-list">${items}</div>` : `<span class="pop-empty">${__('No crew')}</span>`;
		};
		return `<div class="pop-list" style="margin-top:0;">${list.map(r => {
			let st = '';
			if (mode === 'cmp') {
				st = status(r);
				if (st) differ++;
			}
			return `<div class="pop-item eq">
				<div><div class="b">${esc(r.equipment || '')}</div>${st ? `<div style="margin-top:4px;">${st}</div>` : ''}</div>
				<div class="pop-mini">${mini(__('Units'), val(r, x => x.quantity))}${mini(__('Days per unit'), val(r, x => x.days_per_equipment))}${mini(__('Total days'), val(r, x => x.total_days))}</div>
				<div>${crew(r)}</div>
			</div>`;
		}).join('')}</div>`;
	};

	const panel = (mode, active) => `<div class="pov-panel ${active ? 'active' : ''}" data-panel="${mode}">
		<div class="pop-sub-h">${__('Resources')}</div>
		${resources(mode)}
		${mode === 'cmp' ? `<div class="pop-note">${__('The bar is the plan; the line marks the Estimation. Badges show the difference.')}</div>` : ''}
		<div class="pop-sub-h">${__('By Equipment')}</div>
		${equipment(mode)}
	</div>`;

	const panels = panel('cmp', true) + panel('est') + panel('plan');
	const pill = differ
		? `<span class="pov-status diff">${__('{0} equipment differ from the Estimation', [differ])}</span>`
		: `<span class="pov-status ok">${__('Matches the Estimation')}</span>`;

	return `<div class="pov-card">
		<div class="pov-bar">
			<div class="pov-tabs">
				<button class="pov-tab active" data-tab="cmp">${__('Comparison')}</button>
				<button class="pov-tab" data-tab="est">${__('Estimation')}</button>
				<button class="pov-tab" data-tab="plan">${__('Plan')}</button>
			</div>
			${pill}
		</div>
		${panels}
	</div>`;
}

// ---------------------------------------------------------------------------
// Overview page for the COO / CEO
// ---------------------------------------------------------------------------

function pop_inject_styles() {
	$('#pop-styles').remove();
	const css = `
	.pop-page { display: flex; flex-direction: column; gap: 20px; }
	.pop-banner { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border-radius: 12px; border: 1px solid; }
	.pop-banner.warn { background: var(--orange-50, #fff4e6); border-color: var(--orange-200, #ffd8a8); color: var(--orange-800, #a33f00); }
	.pop-banner.ok { background: var(--green-50, #ebfbee); border-color: var(--green-200, #b2f2bb); color: var(--green-800, #216e35); }
	.pop-banner.info { background: var(--blue-50, #e7f5ff); border-color: var(--blue-200, #a5d8ff); color: var(--blue-800, #1c4f82); }
	.pop-dot { width: 10px; height: 10px; border-radius: 50%; background: currentColor; margin-top: 6px; flex: none; }
	.pop-title { font-size: 15px; font-weight: 600; }
	.pop-sub { font-size: 13px; margin-top: 2px; }
	.pop-meta { font-size: 12px; margin-top: 6px; display: flex; gap: 14px; flex-wrap: wrap; }
	.pop-sec { border: 1px solid var(--border-color); border-radius: 12px; background: var(--card-bg); padding: 18px 20px; }
	.pop-h { font-size: 17px; font-weight: 600; color: var(--text-color); margin-bottom: 14px; }
	.pop-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
	.pop-kpi { background: var(--subtle-fg); border-radius: 10px; padding: 10px 12px; }
	.pop-kpi-l { font-size: 12px; color: var(--text-muted); }
	.pop-kpi-v { font-size: 20px; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; color: var(--text-color); }
	.pop-kpi-s { font-size: 11.5px; color: var(--text-muted); margin-top: 1px; }
	.pop-neg { color: var(--red-600, #c92a2a) !important; }
	.pop-alert { margin-top: 10px; font-size: 13px; padding: 8px 12px; border-radius: 8px; }
	.pop-alert.danger { background: var(--red-50, #fff5f5); color: var(--red-700, #a61e1e); }
	.pop-alert.info { background: var(--blue-50, #e7f5ff); color: var(--blue-700, #1864ab); }
	.pop-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
	.pop-item { background: var(--subtle-fg); border-radius: 10px; padding: 10px 12px; font-size: 13px; color: var(--text-color); }
	.pop-item.visit { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(150px, 1fr) minmax(220px, 1.5fr); gap: 16px; align-items: start; }
	.pop-item.inv { display: grid; grid-template-columns: minmax(160px, 1fr) 80px 150px minmax(150px, 1fr); gap: 14px; align-items: center; font-variant-numeric: tabular-nums; }
	.pop-item.hist { display: grid; grid-template-columns: 100px 1fr; gap: 14px; }
	.pop-item .r { text-align: right; }
	.pop-item .b { font-weight: 600; }
	.pop-item .pov-crew { background: var(--card-bg); }
	.pop-muted { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
	.pop-bar { display: flex; gap: 2px; height: 10px; border-radius: 999px; overflow: hidden; background: var(--control-bg, #f3f3f3); margin-top: 12px; }
	.pop-seg { background: var(--primary, #2490ef); }
	.pop-seg:nth-child(even) { background: var(--blue-300, #74c0fc); }
	.pop-empty { font-size: 13px; color: var(--text-muted); }
	.pop-kpi.date .pop-kpi-v { font-variant-numeric: normal; letter-spacing: 0; }
	.pop-ibar { display: flex; gap: 3px; height: 26px; margin-top: 12px; }
	.pop-iseg { border-radius: 6px; background: var(--subtle-fg); border: 1px solid var(--border-color); color: var(--text-muted);
		font-size: 11.5px; font-weight: 600; display: flex; align-items: center; padding: 0 8px; white-space: nowrap; overflow: hidden; min-width: 8px; }
	.pop-iseg.done { background: var(--green-500, #40c057); border-color: var(--green-500, #40c057); color: #fff; }
	.pop-item.inv2 { display: grid; grid-template-columns: minmax(140px, 1fr) 90px 150px minmax(150px, 1.2fr) auto; gap: 16px; align-items: center; font-variant-numeric: tabular-nums; }
	.pov-chip.pend { background: var(--card-bg); color: var(--text-muted); border: 1px solid var(--border-color); }
	@media (max-width: 720px) { .pop-item.inv2 { grid-template-columns: 1fr 1fr; gap: 8px; } }
	.pop-inline { display: flex; gap: 28px; flex-wrap: wrap; margin-bottom: 12px; }
	.pop-inline .l { font-size: 12px; color: var(--text-muted); }
	.pop-inline .v { font-size: 14px; font-weight: 600; color: var(--text-color); font-variant-numeric: tabular-nums; }
	.pop-tl { position: relative; height: 30px; background: var(--subtle-fg); border-radius: 8px; overflow: hidden; }
	.pop-tl-seg { position: absolute; top: 4px; bottom: 4px; border-radius: 6px; background: var(--blue-500, #339af0); color: #fff;
		font-size: 11.5px; font-weight: 600; padding: 0 8px; display: flex; align-items: center; white-space: nowrap; overflow: hidden; min-width: 6px; }
	.pop-tl-seg.alt { background: var(--blue-400, #4dabf7); }
	.pop-tl-axis { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--text-muted); margin: 4px 0 4px; font-variant-numeric: tabular-nums; }
	.pop-vdot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--blue-500, #339af0); margin-right: 6px; vertical-align: 1px; }
	.pop-vdot.alt { background: var(--blue-400, #4dabf7); }
	.pop-col-l { font-size: 11.5px; color: var(--text-muted); margin-bottom: 4px; }
	.pop-kpi .pov-track { height: 6px; margin-top: 10px; }
	.pop-kpi .pov-mark { top: -3px; bottom: -3px; }
	.pop-kpi .pop-of { font-size: 13px; font-weight: 400; color: var(--text-muted); }
	.pop-kpi .pov-delta { font-size: 11px; vertical-align: 3px; }
	.pop-item.eq { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(260px, 1.3fr) minmax(220px, 1.5fr); gap: 16px; align-items: center; }
	.pop-mini { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; font-variant-numeric: tabular-nums; }
	.pop-mini-l { font-size: 11.5px; color: var(--text-muted); }
	.pop-mini-v { font-size: 14px; font-weight: 600; color: var(--text-color); }
	.pop-note { font-size: 12px; color: var(--text-muted); margin-top: 8px; }
	.pop-scope-slot .pop-sub-h { font-size: 13px; font-weight: 600; color: var(--text-color); margin: 14px 0 8px; }
	@media (max-width: 720px) { .pop-item.eq { grid-template-columns: 1fr; gap: 8px; } }
	.pop-scope-slot .pov-card { width: 100%; border: none; border-radius: 0; background: transparent; }
	.pop-scope-slot .pov-bar { border: none; border-radius: 10px; }
	.pop-scope-slot .pov-h, .pop-scope-slot .pov-res, .pop-scope-slot .pov-scroll, .pop-scope-slot .pov-legend { padding-left: 0; padding-right: 0; }
	@media (max-width: 720px) {
		.pop-item.visit, .pop-item.inv, .pop-item.hist { grid-template-columns: 1fr; gap: 4px; }
		.pop-item .r { text-align: left; }
	}
	`;
	$('<style id="pop-styles">').text(css).appendTo('head');
}

function pop_page_html(frm, d) {
	pop_inject_styles();
	pov_inject_styles();
	const esc = frappe.utils.escape_html;
	const ov = d.overview || {}, est = d.estimation || {}, plan = d.plan || {}, prj = d.project || {};
	const money = v => format_currency(flt(v), d.currency, 0);
	const date = v => v ? frappe.datetime.str_to_user(String(v).slice(0, 10)) : '-';
	const contract = flt(ov.contract_value), cost = flt(est.total_cost), price = flt(est.total_price);
	const history = d.history || [];
	const kpi = (label, value, extra, neg) => `<div class="pop-kpi"><div class="pop-kpi-l">${label}</div>
		<div class="pop-kpi-v ${neg ? 'pop-neg' : ''}">${value}</div>${extra ? `<div class="pop-kpi-s">${extra}</div>` : ''}</div>`;
	const sec = (title, body) => `<div class="pop-sec"><div class="pop-h">${title}</div>${body}</div>`;

	// ---- decision banner ----
	const state = ov.workflow_state || '';
	const pending = ov.docstatus === 0 && (state === 'Pending COO Approval' || state === 'Pending CEO Approval');
	const sent = history.slice().reverse().find(h => /^Sent for approval/i.test(h.text || ''));
	let tone = 'info', title, sub;
	if (ov.docstatus === 1) {
		tone = 'ok'; title = __('Approved'); sub = __('The plan is submitted and the project is active.');
	} else if (state === 'Pending COO Approval') {
		tone = 'warn';
		title = frappe.user.has_role('COO') ? __('Waiting for your approval') : __('Waiting for the COO');
		sub = __('Approve it, or return it to Planning, from Actions.');
	} else if (state === 'Pending CEO Approval') {
		tone = 'warn';
		title = frappe.user.has_role('CEO') ? __('Waiting for your approval') : __('Waiting for the CEO');
		sub = __('Approve it, or return it to the COO, from Actions.');
	} else {
		title = __('With Planning');
		sub = ov.return_reason ? __('Last return reason: {0}', [esc(ov.return_reason)]) : __('The plan has not been sent for approval yet.');
	}
	const meta = [
		prj.project_name || ov.project, d.customer_name || ov.customer, prj.custom_region, prj.custom_maintenance_nature,
		(pending && sent) ? __('Sent by {0} on {1}', [sent.by, date(sent.date)]) : null,
	].filter(Boolean).map(x => `<span>${esc(String(x))}</span>`).join('');
	const banner = `<div class="pop-banner ${tone}"><div class="pop-dot"></div><div>
		<div class="pop-title">${title}</div><div class="pop-sub">${sub}</div>
		${meta ? `<div class="pop-meta">${meta}</div>` : ''}
	</div></div>`;

	// ---- the deal ----
	const profit = contract - cost;
	let cards = kpi(__('Contract value'), money(contract), __('From the Opportunity'));
	if (cost || price) {
		cards += kpi(__('Estimated cost'), money(cost), __('From the Estimation'));
		cards += kpi(__('Expected profit'), money(profit), contract ? __('{0}% of the contract', [flt(profit / contract * 100, 1)]) : '', profit < 0);
		cards += kpi(__('Estimation price'), money(price), __('Estimation cost + {0}% margin', [flt(est.margin_percentage, 1)]));
	}
	const alerts = [];
	if (!contract) alerts.push(['danger', __('The contract value is zero. Set the Planned Revenue on the project.')]);
	if (contract && price && contract < price * 0.9) alerts.push(['danger', __('The contract is {0}% below the Estimation price.', [flt((1 - contract / price) * 100, 0)])]);
	if (contract && price && contract > price * 1.1) alerts.push(['info', __('The contract is {0}% above the Estimation price.', [flt((contract / price - 1) * 100, 0)])]);
	if (contract && cost && contract < cost) alerts.push(['danger', __("The contract doesn't cover the estimated cost.")]);
	const deal = sec(__('The deal'), `<div class="pop-cards">${cards}</div>${alerts.map(a => `<div class="pop-alert ${a[0]}">${a[1]}</div>`).join('')}`);

	// ---- scope ----
	const scope = sec(__('Scope: plan vs estimation'), `<div class="pop-scope-slot"></div>`);

	// ---- schedule ----
	const visits = d.visits || [];
	const work_days = visits.reduce((s, v) => s + flt(v.working_days), 0);
	const to_ms = v => v ? frappe.datetime.str_to_obj(String(v).slice(0, 10)).getTime() : null;
	const starts = visits.map(v => to_ms(v.start_date)).filter(Boolean);
	const ends = visits.map(v => to_ms(v.end_date)).filter(Boolean);
	const t0 = to_ms(plan.from_date) || (starts.length ? Math.min(...starts) : null);
	const t1 = to_ms(plan.to_date) || (ends.length ? Math.max(...ends) : null);
	const DAY = 86400000;
	let timeline = '';
	if (t0 && t1 && t1 >= t0 && visits.length) {
		const span = (t1 - t0) + DAY;
		const segs = visits.map((v, i) => {
			const a = to_ms(v.start_date), b = to_ms(v.end_date);
			if (!a || !b) return '';
			const left = Math.max(0, (a - t0) / span * 100);
			const width = Math.max(0.8, ((b - a) + DAY) / span * 100);
			return `<div class="pop-tl-seg ${i % 2 ? 'alt' : ''}" style="left:${left}%; width:${Math.min(width, 100 - left)}%;"
				title="${esc(v.visit_label || v.name)}: ${date(v.start_date)} ${__('to')} ${date(v.end_date)}">${esc(v.visit_label || v.name)}</div>`;
		}).join('');
		timeline = `<div class="pop-tl">${segs}</div><div class="pop-tl-axis"><span>${date(plan.from_date || new Date(t0))}</span><span>${date(plan.to_date || new Date(t1))}</span></div>`;
	}
	const inline = (l, v) => `<div><div class="l">${l}</div><div class="v">${v}</div></div>`;
	const visit_items = visits.map((v, i) => {
		const eq = (v.equipment || []).length
			? v.equipment.map(a => `<div>${esc(a.equipment || '')} <span class="pop-muted" style="display:inline;">× ${flt(a.quantity, 2)}</span></div>`).join('')
			: `<span class="pop-empty">${__('No equipment')}</span>`;
		const team = (v.team || []).filter(t => cint(t.headcount) > 0);
		const team_html = team.length
			? `<div class="pov-crew-list">${team.map(t => `<span class="pov-crew"><span class="pov-crew-n">${cint(t.headcount)}</span><span class="pov-crew-t">${esc(t.trade || '')}</span></span>`).join('')}</div>`
			: `<span class="pop-empty">${__('No team')}</span>`;
		return `<div class="pop-item visit">
			<div><span class="pop-vdot ${i % 2 ? 'alt' : ''}"></span><a class="b" href="/app/project-visits/${v.name}">${esc(v.visit_label || v.name)}</a>
				<div class="pop-muted">${date(v.start_date)} ${__('to')} ${date(v.end_date)}</div>
				<div class="pop-muted">${__('{0} working days', [flt(v.working_days, 2)])}</div></div>
			<div><div class="pop-col-l">${__('Equipment')}</div>${eq}</div>
			<div><div class="pop-col-l">${__('Team')}</div>${team_html}</div>
		</div>`;
	}).join('');
	const schedule = sec(__('Schedule'), `
		<div class="pop-cards" style="margin-bottom:12px;">${kpi(__('From'), date(plan.from_date)).replace('pop-kpi', 'pop-kpi date')}${kpi(__('To'), date(plan.to_date)).replace('pop-kpi', 'pop-kpi date')}${kpi(__('Visits'), visits.length)}${kpi(__('Working days'), flt(work_days, 2))}</div>
		${timeline}
		${visits.length ? `<div class="pop-list">${visit_items}</div>` : `<div class="pop-empty">${__('No visits yet.')}</div>`}`);

	// ---- invoicing ----
	const invoices = d.invoices || [];
	const pct_total = invoices.reduce((s, i) => s + flt(i.invoice_percentage), 0);
	const is_done = i => (i.status || '') === 'Invoiced';
	const done = invoices.filter(is_done);
	const done_amt = done.reduce((s, i) => s + contract * flt(i.invoice_percentage) / 100, 0);
	const inv_name = (i, n) => i.title || i.invoice_title || __('Invoice {0}', [n]);
	const ibar = invoices.map((i, k) => `<div class="pop-iseg ${is_done(i) ? 'done' : ''}" style="flex: 0 0 calc(${flt(i.invoice_percentage)}% - 3px);"
		title="${esc(inv_name(i, k + 1))}: ${flt(i.invoice_percentage, 2)}%">${esc(inv_name(i, k + 1))} (${flt(i.invoice_percentage, 2)}%)</div>`).join('');
	const col = (l, v) => `<div><div class="pop-col-l">${l}</div><div class="b">${v}</div></div>`;
	const inv_items = invoices.map((i, k) => {
		const when = (i.after_visits || []).length
			? __('After {0}', [i.after_visits.map(x => esc(x)).join(', ')])
			: (i.invoice_date || i.due_date ? date(i.invoice_date || i.due_date) : `<span class="pop-muted" style="margin:0;">${__('Not linked to a visit')}</span>`);
		const st = is_done(i) ? `<span class="pov-chip ok">${__('Invoiced')}</span>` : `<span class="pov-chip pend">${esc(i.status || __('Pending'))}</span>`;
		return `<div class="pop-item inv2">
			<div><a class="b" href="/app/project-invoicing/${i.name}">${esc(inv_name(i, k + 1))}</a>${i.description && !i.title ? `<div class="pop-muted">${esc(i.description)}</div>` : ''}</div>
			${col(__('Share'), `${flt(i.invoice_percentage, 2)}%`)}
			${col(__('Amount'), money(contract * flt(i.invoice_percentage) / 100))}
			<div><div class="pop-col-l">${__('When')}</div><div>${when}</div></div>
			<div>${st}</div>
		</div>`;
	}).join('');
	const invoicing = sec(__('Invoicing'), invoices.length ? `
		<div class="pop-cards">
			${kpi(__('Invoices'), invoices.length)}
			${kpi(__('Invoiced'), money(done_amt), __('{0} of {1} invoices', [done.length, invoices.length]))}
			${kpi(__('Remaining'), money(contract - done_amt), __('Of the contract value'))}
		</div>
		<div class="pop-ibar">${ibar}</div>
		<div class="pop-list">${inv_items}</div>
		${flt(pct_total, 2) !== 100 ? `<div class="pop-alert danger">${__('The invoices add up to {0}%, not 100%.', [flt(pct_total, 2)])}</div>` : ''}`
		: `<div class="pop-empty">${__('No invoices planned yet.')}</div>`);

	// ---- history ----
	const hist_items = history.slice().reverse().map(h => `<div class="pop-item hist">
		<div class="pop-muted" style="margin-top:0;">${date(h.date)}</div>
		<div>${esc(h.text || '')}<div class="pop-muted">${esc(h.by || '')}</div></div>
	</div>`).join('');
	const history_sec = sec(__('History'), history.length ? `<div class="pop-list" style="margin-top:0;">${hist_items}</div>` : `<div class="pop-empty">${__('No history yet.')}</div>`);

	return `<div class="pop-page">${banner}${deal}${scope}${schedule}${invoicing}${history_sec}</div>`;
}
