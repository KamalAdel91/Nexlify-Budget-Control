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
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_project_overview_summary',
		args: { project: frm.doc.project },
		callback: function(r) {
			frm.set_df_property('overview_html', 'options', build_overview_html(r.message || {}));
			frm.refresh_field('overview_html');
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
	let title = `<div class="npo-section-title">${__('Visits')}</div>`;
	if (!visits.length) {
		return title + `<div class="npo-empty">${__('No visits added yet.')}</div>`;
	}
	let rows = visits.map(v => `
		<tr>
			<td><a href="/app/project-visits/${v.name}" class="npo-link">${frappe.utils.escape_html(v.visit_label || v.name)}</a></td>
			<td>${frappe.datetime.str_to_user(v.start_date)}</td>
			<td>${frappe.datetime.str_to_user(v.end_date)}</td>
		</tr>
	`).join('');
	return title + `
		<div class="npo-table-wrapper">
			<table class="npo-table">
				<thead><tr><th>${__('Visit')}</th><th>${__('Start Date')}</th><th>${__('End Date')}</th></tr></thead>
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
	.pov-card .pov-bar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px; }
	.pov-tabs { display: flex; gap: 2px; }
	.pov-card .pov-status { margin-left: 0; justify-self: end; white-space: nowrap; }
	.pov-table th.c, .pov-table td.c { text-align: center; }
	.pov-table td.c .pov-crew-list { justify-content: center; }
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
			const $w = frm.fields_dict.scope_html.$wrapper;
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
	if (!rows.length) {
		return `<div class="pov-card"><div class="pov-empty">${__('The Estimation and the Plan have no equipment yet.')}</div></div>`;
	}

	const total = (list, fn) => list.reduce((s, r) => s + flt(fn(r)), 0);
	const all_est = rows.map(r => r.est), all_plan = rows.map(r => r.plan);
	const est_list = rows.filter(r => !r.not_in_estimation).map(r => r.est);
	const plan_list = rows.filter(r => !r.not_planned).map(r => r.plan);
	const kind = (p, e) => (flt(p) === flt(e) ? 'ok' : (flt(p) > flt(e) ? 'over' : 'under'));
	const delta = (p, e) => {
		const d = flt(flt(p) - flt(e), 2);
		return d ? `<span class="pov-delta ${d > 0 ? 'over' : 'under'}">${d > 0 ? '+' : '−'}${num(Math.abs(d))}</span>` : '';
	};

	// ---- Resources ----
	const measures = [
		[__('Equipment units'), r => r.quantity],
		[__('Work days'), r => r.total_days],
	].concat(trades.map(t => [__('{0} person-days', [esc(t)]), r => flt(r.total_days) * flt((r.roles || {})[t])]));

	const resources = mode => {
		const body = measures.map(([label, fn]) => {
			const e = total(all_est, fn), p = total(all_plan, fn);
			if (mode !== 'cmp') {
				return `<div class="pov-row single"><div class="pov-label">${label}</div><div class="pov-num">${num(mode === 'est' ? e : p)}</div></div>`;
			}
			const max = Math.max(e, p) || 1;
			return `<div class="pov-row">
				<div class="pov-label">${label}</div>
				<div class="pov-track" title="${__('Plan {0} / Estimation {1}', [num(p), num(e)])}">
					<div class="pov-fill ${kind(p, e)}" style="width:${(p / max) * 100}%;"></div>
					<div class="pov-mark" style="left:${(e / max) * 100}%;"></div>
				</div>
				<div class="pov-num"><b>${num(p)}</b> <span class="pov-of">${__('of {0}', [num(e)])}</span>${delta(p, e)}</div>
			</div>`;
		}).join('');
		return `<div class="pov-res">${body}</div>`;
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
		return out.length ? out.join(' ') : chip(__('Same'), 'ok');
	};

	// ---- By equipment ----
	let differ = 0;
	const grid = mode => {
		const list = mode === 'est' ? rows.filter(r => !r.not_in_estimation) : mode === 'plan' ? rows.filter(r => !r.not_planned) : rows;
		const cell = (r, get) => {
			if (mode === 'est') return num(get(r.est));
			if (mode === 'plan') return num(get(r.plan));
			return `${delta(get(r.plan), get(r.est))} ${num(get(r.plan))}`;
		};
		const crew_cell = r => {
			const items = trades.map(t => {
				const p = cint((r.plan.roles || {})[t]), e = cint((r.est.roles || {})[t]);
				const v = mode === 'est' ? e : p;
				if (mode === 'cmp' ? (!p && !e) : !v) return '';
				const gone = mode === 'cmp' && !p && e;
				return `<span class="pov-crew${gone ? ' gone' : ''}"><span class="pov-crew-n">${v}</span><span class="pov-crew-t">${esc(t)}</span>${mode === 'cmp' ? delta(p, e) : ''}</span>`;
			}).join('');
			return items ? `<div class="pov-crew-list">${items}</div>` : `<span class="text-muted">${__('No crew')}</span>`;
		};
		const head = `<thead><tr>
			<th>${__('Equipment')}</th>
			<th class="n">${__('Units')}</th>
			<th class="n">${__('Days per unit')}</th>
			<th class="n">${__('Total days')}</th>
			<th class="c">${__('Crew')}</th>
		</tr></thead>`;
		const body = list.map(r => {
			let flag = '';
			if (mode === 'cmp') {
				const st = status(r);
				if (!st.includes('pov-chip ok')) {
					differ++;
					flag = `<div class="pov-eq-st">${st}</div>`;
				}
			}
			return `<tr>
				<td><div class="pov-eq">${esc(r.equipment || '')}</div>${flag}</td>
				<td class="n">${cell(r, x => x.quantity)}</td>
				<td class="n">${cell(r, x => x.days_per_equipment)}</td>
				<td class="n">${cell(r, x => x.total_days)}</td>
				<td class="c">${crew_cell(r)}</td>
			</tr>`;
		}).join('');
		const src = mode === 'est' ? est_list : plan_list;
		const foot = `<tfoot><tr>
			<td>${__('Total')}</td>
			<td class="n">${num(total(src, x => x.quantity))}</td>
			<td class="n"></td>
			<td class="n">${num(total(src, x => x.total_days))}</td>
			<td></td>
		</tr></tfoot>`;
		return `<div class="pov-scroll"><div class="pov-frame"><table class="pov-table">${head}<tbody>${body}</tbody>${foot}</table></div></div>`;
	};

	const hints = {
		cmp: [__('Plan against the Estimation'), __('Numbers are the plan; badges show the change from the Estimation')],
		est: [__('Priced in the Estimation'), __('As estimated')],
		plan: [__('Needed by the plan'), __('As planned')],
	};
	const panel = (mode, active) => `<div class="pov-panel ${active ? 'active' : ''}" data-panel="${mode}">
		<div class="pov-h">${__('Resources')}<span class="pov-hint">${hints[mode][0]}</span></div>
		${resources(mode)}
		${mode === 'cmp' ? `<div class="pov-legend">${__('The bar is the plan; the line')}<span class="pov-key"></span>${__('marks the Estimation.')}</div>` : ''}
		<div class="pov-h">${__('By equipment')}<span class="pov-hint">${hints[mode][1]}</span></div>
		${grid(mode)}
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
			<div></div>
		</div>
		${panels}
	</div>`;
}
