window.nexlify = window.nexlify || {}; nexlify.sort_trades = nexlify.sort_trades || ((l) => (l || []).slice()); nexlify.trade_cmp = nexlify.trade_cmp || (() => 0); nexlify.trade_color = nexlify.trade_color || (() => "#64748B");
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
	const put = (key, html) => {
		if (!frm.fields_dict[key + '_html']) return;
		frm.set_df_property(key + '_html', 'options', html);
		frm.refresh_field(key + '_html');
	};
	if (frm.is_new() || !frm.doc.project) {
		put('banner', `<div class="pop-empty">${__('Save with a Project linked to see the overview.')}</div>`);
		return;
	}
	const base = 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.';
	Promise.all([
		frappe.call({ method: base + 'get_overview_page', args: { overview: frm.doc.name } }),
		frappe.call({ method: base + 'get_overview_scope', args: { overview: frm.doc.name } }),
	]).then(([a, b]) => {
		const scope = (b && b.message) || {};
		const parts = pop_page_html(frm, (a && a.message) || {}, scope);
		['banner', 'deal', 'cost', 'schedule', 'invoicing', 'history'].forEach(k => put(k, parts[k] || ''));
		pov_put_scope(frm, scope);
		const f = frm.fields_dict.banner_html;
		if (!f) return;
		f.$wrapper.off('click.pop keydown.pop').on('click.pop keydown.pop', '.pop-chk[data-sec]', function(e) {
			if (e.type === 'keydown' && e.key !== 'Enter') return;
			const sec = frm.fields_dict[$(this).data('sec')];
			if (!sec) return;
			if (sec.collapse) sec.collapse(false);
			setTimeout(() => { const el = sec.wrapper && sec.wrapper[0]; if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
		});
	});
}

function pov_put_scope(frm, data) {
	if (!frm.fields_dict.scope_html) return;
	pov_inject_styles();
	const $w = frm.fields_dict.scope_html.$wrapper;
	$w.html(pov_scope_html(data));
	$w.find('.pov-tab').on('click', function() {
		const key = $(this).data('tab');
		$w.find('.pov-tab').removeClass('active');
		$(this).addClass('active');
		$w.find('.pov-panel').removeClass('active');
		$w.find(`.pov-panel[data-panel="${key}"]`).addClass('active');
	});
}

function pov_scope_differ(data) {
	const trades = nexlify.sort_trades(data.trades || []);
	return (data.comparison || []).filter(r => {
		if (r.not_planned || r.not_in_estimation) return true;
		const e = r.est || {}, p = r.plan || {};
		if (flt(p.quantity) !== flt(e.quantity) || flt(p.days_per_equipment) !== flt(e.days_per_equipment)) return true;
		return trades.some(t => cint((p.roles || {})[t]) !== cint((e.roles || {})[t]));
	}).length;
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
				<span class="npo-status-label">${data.cost_name ? `<a href="/app/project-estimation/${data.cost_name}" class="npo-link">${__('Estimation')}</a>` : __('Estimation')}</span>
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
		const team = (v.team || []).filter(t => cint(t.headcount) > 0).sort((a, b) => nexlify.trade_cmp(a.trade, b.trade));
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
		let si = inv.sales_invoice ? `<a href="/app/sales-invoice/${inv.sales_invoice}" class="npo-link">${inv.sales_invoice}</a>` : '-';
		return `
			<tr>
				<td><a href="/app/project-invoicing/${inv.name}" class="npo-link">${frappe.utils.escape_html(inv.invoice_label || inv.name)}</a></td>
				<td>${inv.expected_invoice_date ? frappe.datetime.str_to_user(inv.expected_invoice_date) : '-'}</td>
				<td class="npo-text-right">${flt(inv.invoice_percentage).toFixed(2)}%</td>
				<td>${frappe.utils.escape_html(inv.invoice_description || '')}</td>
				<td>${inv.status || ''}</td>
				<td>${si}</td>
			</tr>
		`;
	}).join('');
	return title + `
		<div class="npo-table-wrapper">
			<table class="npo-table">
				<thead><tr><th>${__('Invoice')}</th><th>${__('Expected Date')}</th><th class="npo-text-right">${__('%')}</th><th>${__('Description')}</th><th>${__('Status')}</th><th>${__('Sales Invoice')}</th></tr></thead>
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
	pop_inject_styles();
	const esc = frappe.utils.escape_html;
	const trades = nexlify.sort_trades(data.trades || []);
	const rows = data.comparison || [];
	const num = v => flt(v, 2);
	if (!rows.length) return `<div class="pop-empty">${__('The Estimation and the Plan have no equipment yet.')}</div>`;

	const pick = (r, k) => (k === 'est' ? (r.not_in_estimation ? null : (r.est || {})) : (r.not_planned ? null : (r.plan || {})));
	const days_of = x => x ? (x.total_days != null ? flt(x.total_days) : flt(x.quantity) * flt(x.days_per_equipment)) : 0;
	const role = (x, t) => x ? cint((x.roles || {})[t]) : 0;
	const sum = (k, fn) => rows.reduce((s, r) => { const x = pick(r, k); return s + (x ? flt(fn(x)) : 0); }, 0);
	const same = (a, b) => flt(a, 2) === flt(b, 2);
	const arrow = (p, e) => (flt(p, 2) > flt(e, 2) ? ' ↑' : flt(p, 2) < flt(e, 2) ? ' ↓' : '');
	const diff = (p, e, pct) => {
		const d = flt(p - e, 2);
		if (!d) return `<span class="psc-same">${__('no change')}</span>`;
		const sg = d > 0 ? '+' : '−';
		return `<span class="psc-d">${sg}${num(Math.abs(d))}${pct && e ? ` (${sg}${Math.abs(Math.round(d / e * 100))}%)` : ''}</span>`;
	};
	const status = r => {
		if (r.not_planned) return [__('Not planned')];
		if (r.not_in_estimation) return [__('Not in the Estimation')];
		const e = r.est || {}, p = r.plan || {}, out = [];
		const move = (pv, ev, less, more) => {
			if (flt(pv) < flt(ev)) out.push(less);
			else if (flt(pv) > flt(ev)) out.push(more);
		};
		move(p.quantity, e.quantity, __('Fewer units'), __('More units'));
		move(p.days_per_equipment, e.days_per_equipment, __('Fewer days per unit'), __('More days per unit'));
		trades.forEach(t => {
			const pc = role(p, t), ec = role(e, t);
			if (ec && !pc) out.push(__('{0} removed', [esc(t)]));
			else if (!ec && pc) out.push(__('{0} added', [esc(t)]));
		});
		return out;
	};
	const pair = (r, f) => {
		const e = pick(r, 'est'), p = pick(r, 'plan');
		const ev = e ? (f === 'total_days' ? days_of(e) : flt(e[f])) : null;
		const pv = p ? (f === 'total_days' ? days_of(p) : flt(p[f])) : null;
		const est = `<td class="e">${ev === null ? '—' : num(ev)}</td>`;
		if (pv === null) return est + `<td class="x">—</td>`;
		if (ev === null || !same(ev, pv)) return est + `<td class="x">${num(pv)}${ev === null ? '' : arrow(pv, ev)}</td>`;
		return est + `<td class="p">${num(pv)}</td>`;
	};
	const crew = r => {
		const e = pick(r, 'est'), p = pick(r, 'plan');
		const items = trades.map(t => {
			const ec = role(e, t), pc = role(p, t);
			if (!ec && !pc) return '';
			const dot = `<i style="background:${nexlify.trade_color(t)}"></i>`;
			return ec === pc ? `<span>${dot}${pc} ${esc(t)}</span>` : `<span class="ch">${dot}${esc(t)} ${ec} → ${pc}</span>`;
		}).filter(Boolean);
		return items.length ? `<div class="psc-crew">${items.join('')}</div>` : `<span class="e">${__('No crew')}</span>`;
	};

	const body = rows.map(r => {
		const st = status(r);
		return `<tr>
			<td class="l"><div class="nm">${esc(r.equipment || '')}</div>${st.length ? `<div class="tag">${st.join(' · ')}</div>` : ''}</td>
			${pair(r, 'quantity')}${pair(r, 'days_per_equipment')}${pair(r, 'total_days')}
			<td class="l">${crew(r)}</td>
		</tr>`;
	}).join('');
	const eu = sum('est', x => x.quantity), pu = sum('plan', x => x.quantity);
	const ed = sum('est', days_of), pdays = sum('plan', days_of);
	const foot = `<tr class="t"><td class="l">${__('Total')}</td>
		<td class="e">${num(eu)}</td><td class="${same(eu, pu) ? '' : 'x'}">${num(pu)}</td><td></td><td></td>
		<td class="e">${num(ed)}</td><td class="${same(ed, pdays) ? '' : 'x'}">${num(pdays)}</td><td></td></tr>`;

	const pd = trades.map(t => ({ t, e: sum('est', x => days_of(x) * role(x, t)), p: sum('plan', x => days_of(x) * role(x, t)) }))
		.filter(x => x.e || x.p);
	const pe = pd.reduce((s, x) => s + x.e, 0), pp = pd.reduce((s, x) => s + x.p, 0);
	const differ = pov_scope_differ(data);
	const cell = (l, v, of, sub, extra) => `<div><div class="l">${l}</div><div class="v">${v}<span>${of}</span></div>${sub ? `<div class="s">${sub}</div>` : ''}${extra || ''}</div>`;
	const trend = (p, e) => {
		const d = flt(p - e, 2);
		if (!d) return `<span class="psc-same">${__('Same as the Estimation')}</span>`;
		return `<span class="psc-d">${d < 0 ? '↓' : '↑'} ${num(Math.abs(d))} ${d < 0 ? __('less') : __('more')}${e ? ` · ${Math.abs(Math.round(d / e * 100))}%` : ''}</span>`;
	};
	const meter = (p, e) => `<div class="m"><span style="width:${e ? Math.min(100, p / e * 100) : 0}%"></span></div>`;
	const dots = `<div class="dots">${rows.map(r => `<i class="${status(r).length ? 'c' : ''}" title="${esc(r.equipment || '')}"></i>`).join('')}</div>`;
	const matching = rows.length - differ;
	const summary = `<div class="psc-box"><div class="psc-sum">
		${cell(__('Total work days'), num(pdays), __('of {0}', [num(ed)]), trend(pdays, ed), meter(pdays, ed))}
		${pd.length ? cell(__('Person-days'), num(pp), __('of {0}', [num(pe)]), trend(pp, pe), meter(pp, pe)) : ''}
		${cell(__('Equipment changed'), differ, __('of {0}', [rows.length]),
			differ ? `<span class="psc-d">${matching === 1 ? __('1 matches the Estimation') : __('{0} match the Estimation', [matching])}</span>`
				: `<span class="psc-same">${__('All match the Estimation')}</span>`, dots)}
	</div></div>`;
	const pd_line = pd.length ? `<div class="psc-pd"><span class="lb">${__('Person-days')}</span>${pd.map(x => `
		<span><i style="background:${nexlify.trade_color(x.t)}"></i>${esc(x.t)} <b class="${same(x.p, x.e) ? '' : 'x'}">${num(x.p)}</b> <span class="e">${__('of {0}', [num(x.e)])}</span></span>`).join('')}</div>` : '';
	const head = `<thead>
		<tr class="grp"><th></th><th colspan="2">${__('Units')}</th><th colspan="2">${__('Days per unit')}</th><th colspan="2">${__('Total days')}</th><th></th></tr>
		<tr><th class="l">${__('Equipment')}</th><th>${__('Est.')}</th><th>${__('Plan')}</th><th>${__('Est.')}</th><th>${__('Plan')}</th>
			<th>${__('Est.')}</th><th>${__('Plan')}</th><th class="l">${__('Crew')}</th></tr>
	</thead>`;
	return `<div class="psc">${summary}
		<div class="psc-box"><div class="psc-tw"><table class="psc-table">${head}<tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>${pd_line}</div>
	</div>`;
}

// ---------------------------------------------------------------------------
// Overview page for the COO / CEO
// ---------------------------------------------------------------------------

function pop_inject_styles() {
	$('#pop-styles').remove();
	const css = `
	.pop-hero { display: flex; gap: 22px; align-items: center; padding: 4px 0 16px; }
	.pop-ring { flex: none; }
	.pop-ring .bg { fill: none; stroke: var(--border-color); stroke-width: 9; }
	.pop-ring .fg { fill: none; stroke: var(--green-500, #40c057); stroke-width: 9; stroke-linecap: round; }
	.pop-ring .v { font-size: 20px; font-weight: 600; fill: var(--text-color); }
	.pop-ring.neg .v { fill: var(--red-600, #e03131); }
	.pop-ring .l { font-size: 11px; fill: var(--text-muted); }
	.pop-hero .lbl { font-size: 12.5px; color: var(--text-muted); }
	.pop-hero .hl { font-family: Georgia, 'Times New Roman', serif; font-size: 24px; line-height: 1.3; color: var(--text-color); margin: 4px 0 6px; }
	.pop-hero .sub { font-size: 13px; color: var(--text-muted); }

	.pop-chks { border-top: 1px solid var(--border-color); }
	.pop-chk { display: grid; grid-template-columns: 24px 110px minmax(0, 1fr) auto 14px; gap: 12px; align-items: center;
		padding: 12px 10px; border-bottom: 1px solid var(--border-color); cursor: pointer; transition: background .15s ease; }
	.pop-chk:hover { background: var(--subtle-fg); }
	.pop-chk:focus-visible { outline: 2px solid var(--primary, #2490ef); outline-offset: -2px; }
	.pop-chk .ic { width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
	.pop-chk.ok .ic { background: var(--green-50, #ebfbee); color: var(--green-700, #2b8a3e); }
	.pop-chk.warn .ic { background: var(--card-bg, #fff); color: var(--orange-700, #d9480f); border: 1px solid var(--orange-200, #ffd8a8); }
	.pop-chk.bad .ic { background: var(--card-bg, #fff); color: var(--red-700, #c92a2a); border: 1px solid var(--red-200, #ffc9c9); }
	.pop-chk.warn { background: var(--orange-50, #fff4e6); }
	.pop-chk.warn:hover { background: var(--orange-100, #ffe8cc); }
	.pop-chk.bad { background: var(--red-50, #fff5f5); }
	.pop-chk.bad:hover { background: var(--red-100, #ffe3e3); }
	.pop-chk .nm { font-weight: 600; color: var(--text-color); }
	.pop-chk .tx { font-size: 12.5px; color: var(--text-muted); }
	.pop-chk .fg { font-weight: 600; color: var(--text-color); font-variant-numeric: tabular-nums; white-space: nowrap; }
	.pop-chk .go { color: var(--text-muted); font-size: 16px; line-height: 1; }
	.pop-chk.warn .nm, .pop-chk.warn .tx, .pop-chk.warn .fg { color: var(--orange-800, #a33f00); }
	.pop-chk.bad .nm, .pop-chk.bad .tx, .pop-chk.bad .fg { color: var(--red-800, #a61e1e); }

	.pop-wf { display: grid; grid-template-columns: 110px minmax(0, 1fr) 130px; gap: 10px 14px; align-items: center; }
	.pop-wf .lb { font-size: 12.5px; color: var(--text-muted); }
	.pop-wf .tr { position: relative; height: 24px; }
	.pop-wf .bar { position: absolute; top: 0; bottom: 0; border-radius: 4px; }
	.pop-wf .bar.c { background: var(--gray-300, #dee2e6); }
	.pop-wf .bar.k { background: var(--gray-500, #adb5bd); }
	.pop-wf .bar.p { background: var(--green-500, #40c057); }
	.pop-wf .bar.n { background: var(--red-500, #fa5252); }
	.pop-wf .mk { position: absolute; top: -5px; bottom: -5px; border-inline-start: 1.5px dashed var(--text-color); z-index: 1; }
	.pop-wf .val { text-align: end; font-weight: 600; color: var(--text-color); font-variant-numeric: tabular-nums; }
	.pop-wf .val.pos { color: var(--green-600, #2f9e44); }
	.pop-wf .val.neg { color: var(--red-600, #e03131); }
	.pop-wf .tr.ax { height: 16px; }
	.pop-wf .ax span { position: absolute; top: 0; transform: translateX(-50%); font-size: 12px; color: var(--text-muted); white-space: nowrap; }
	.pop-wf .ax span.r { transform: translateX(-100%); }
	.pop-wf-foot { margin-top: 14px; font-size: 12.5px; color: var(--text-muted); }
	.pop-meta-line { font-size: 12.5px; color: var(--text-muted); margin-bottom: 12px; font-variant-numeric: tabular-nums; }

	.pop-gantt { display: grid; grid-template-columns: 90px minmax(0, 1fr) 64px; gap: 8px 12px; align-items: center; margin-bottom: 18px; }
	.pop-gantt .axis { position: relative; height: 16px; font-size: 11px; color: var(--text-muted); }
	.pop-gantt .axis span { position: absolute; top: 0; white-space: nowrap; }
	.pop-gantt .lane { position: relative; height: 22px; background: var(--subtle-fg); border-radius: 5px; }
	.pop-gantt .bar { position: absolute; top: 4px; bottom: 4px; min-width: 4px; border-radius: 3px; background: var(--primary, #2490ef); }
	.pop-gantt .name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.pop-gantt .days { text-align: end; font-size: 12.5px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
	.pop-gantt .lane.bill { background: transparent; border: 1px dashed var(--border-color); }
	.pop-gantt .lane.bill.warn { border-color: var(--orange-300, #ffc078); }
	.pop-gantt .im { position: absolute; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; transform: rotate(45deg); border-radius: 2px; background: var(--text-color); }
	.pop-gantt .im.done { background: var(--green-500, #40c057); }
	.pop-gantt .un { position: absolute; inset: 0; display: flex; align-items: center; padding: 0 10px; font-size: 12px; color: var(--orange-700, #d9480f);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pop-gantt .un.end { justify-content: flex-end; }

	.pop-pill { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 999px; white-space: nowrap;
		background: var(--subtle-fg); color: var(--text-color); border: 1px solid var(--border-color); }
	.pop-pill::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--gray-500, #adb5bd); }
	.pop-pill.ok::before { background: var(--green-500, #40c057); }
	.pop-pill.warn::before { background: var(--orange-500, #fd7e14); }
	.pop-pill.bad { background: var(--red-50, #fff5f5); color: var(--red-700, #c92a2a); border-color: transparent; }
	.pop-pill.bad::before { background: currentColor; }
	.pov-bar .pop-pill { margin-inline-start: auto; }

	.pop-tw { overflow-x: auto; border: 1px solid var(--border-color); border-radius: 12px; background: var(--card-bg, var(--fg-color)); }
	.pop-table { width: 100%; border-collapse: collapse; font-size: 13px; color: var(--text-color); }
	.pop-table th { background: var(--subtle-fg); font-size: 12px; font-weight: 500; color: var(--text-muted); text-align: start; padding: 9px 14px; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
	.pop-table td { padding: 11px 14px; border-bottom: 1px solid var(--border-color); vertical-align: top; }
	.pop-table tbody tr:last-child td { border-bottom: 0; }
	.pop-table .num { text-align: end; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.pop-table .nowrap { white-space: nowrap; }
	.pop-table .b, .pop-table a { font-weight: 600; color: var(--text-color); }
	.pop-table a:hover { color: var(--primary, #2490ef); text-decoration: none; }
	.pop-table .sub { font-size: 12.5px; color: var(--text-muted); }
	.pop-table td.diff { background: var(--orange-50, #fff4e6); }
	.pop-table tr.tot td { background: var(--subtle-fg); font-weight: 600; border-top: 1px solid var(--border-color); }
	.pop-table tr.tot td.sub { font-weight: 400; }
	.pop-chips { margin-top: 6px; display: flex; gap: 4px; flex-wrap: wrap; }
	.pop-strike { text-decoration: line-through; }

	.pop-segs { display: flex; gap: 4px; margin-bottom: 14px; }
	.pop-segs div { height: 8px; min-width: 6px; border-radius: 4px; background: var(--subtle-fg); border: 1px solid var(--border-color); }
	.pop-segs div.done { background: var(--green-500, #40c057); border-color: var(--green-500, #40c057); }
	.pop-empty { font-size: 13px; color: var(--text-muted); }

	[data-fieldname="scope_html"] .pov-card { border: none; border-radius: 0; background: transparent; overflow: visible; }
	[data-fieldname="scope_html"] .pov-bar { border: none; border-radius: 10px; margin-bottom: 14px; }

	[data-theme="dark"] .pop-chk.warn { background: rgba(253,126,20,.1); }
	[data-theme="dark"] .pop-chk.warn:hover { background: rgba(253,126,20,.16); }
	[data-theme="dark"] .pop-chk.bad { background: rgba(250,82,82,.1); }
	[data-theme="dark"] .pop-chk.bad:hover { background: rgba(250,82,82,.16); }
	[data-theme="dark"] .pop-chk.warn .nm, [data-theme="dark"] .pop-chk.warn .tx, [data-theme="dark"] .pop-chk.warn .fg { color: #ffc078; }
	[data-theme="dark"] .pop-chk.bad .nm, [data-theme="dark"] .pop-chk.bad .tx, [data-theme="dark"] .pop-chk.bad .fg { color: #ffa8a8; }
	[data-theme="dark"] .pop-chk.ok .ic { background: rgba(64,192,87,.15); color: #8ce99a; }
	[data-theme="dark"] .pop-pill.bad { background: rgba(250,82,82,.15); color: #ffa8a8; }
	[data-theme="dark"] .pop-table td.diff { background: rgba(253,126,20,.12); }

	@media (max-width: 720px) {
		.pop-hero { flex-direction: column; align-items: flex-start; }
		.pop-chk { grid-template-columns: 24px minmax(0, 1fr) auto; }
		.pop-chk .tx { grid-column: 2 / -1; }
		.pop-chk .go { display: none; }
		.pop-wf { grid-template-columns: 80px minmax(0, 1fr) 96px; }
		.pop-gantt { grid-template-columns: 64px minmax(0, 1fr) 44px; }
	}

	/* scope-wide */
	[data-fieldname="scope_html"] .pov-card, [data-fieldname="scope_html"] .pov-panel,
	[data-fieldname="scope_html"] .pop-tw, [data-fieldname="scope_html"] .pov-bar { display: block; width: 100%; max-width: none; }
	[data-fieldname="scope_html"] .pov-bar { display: flex; }
	[data-fieldname="scope_html"] .pov-panel:not(.active) { display: none; }
	[data-fieldname="scope_html"] .pop-table { table-layout: fixed; }
	[data-fieldname="scope_html"] .pop-table th:nth-child(1) { width: 26%; }
	[data-fieldname="scope_html"] .pop-table th:nth-child(2), [data-fieldname="scope_html"] .pop-table th:nth-child(3),
	[data-fieldname="scope_html"] .pop-table th:nth-child(4) { width: 12%; }
	[data-fieldname="scope_html"] .pop-table th, [data-fieldname="scope_html"] .pop-table td { padding: 12px 16px; }
	[data-fieldname="scope_html"] .pop-table td { vertical-align: middle; }
	[data-fieldname="scope_html"] .pop-table td.num { font-size: 14px; font-weight: 500; }
	.pop-c { display: inline-block; padding: 2px 8px; margin: 2px 4px 2px 0; border-radius: 6px; font-size: 12px; white-space: nowrap;
		background: var(--subtle-fg); border: 1px solid var(--border-color); color: var(--text-color); }

	/* color-theme */
	.pop-hero { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 6px 20px; align-items: center; padding: 20px 22px 0;
		border-radius: 14px; overflow: hidden; color: #fff; background: linear-gradient(135deg, #4f46e5 0%, #1e1b4b 100%); }
	.pop-hero.pending { background: radial-gradient(circle at 12% 15%, rgba(255,255,255,.18), transparent 45%), linear-gradient(135deg, #f0913d 0%, #d8652a 100%); }
	.pop-hero.approved { background: linear-gradient(135deg, #059669 0%, #064e3b 100%); }
	.pop-hero.returned { background: linear-gradient(135deg, #e11d48 0%, #881337 100%); }
	.pop-hero.cancelled { background: linear-gradient(135deg, #64748b 0%, #334155 100%); }
	.pop-hero .pop-ring .bg { stroke: rgba(255,255,255,.22); }
	.pop-hero .pop-ring .fg { stroke: #fff; }
	.pop-hero .pop-ring .v { fill: #fff; }
	.pop-hero .pop-ring .l { fill: rgba(255,255,255,.75); }
	.pop-hero .lbl { font-size: 12.5px; color: rgba(255,255,255,.8); }
	.pop-hero .hl { font-family: Georgia, 'Times New Roman', serif; font-size: 26px; line-height: 1.25; color: #fff; margin: 4px 0 6px; }
	.pop-hero .sub { font-size: 13px; color: rgba(255,255,255,.85); }
	.pop-hero .stats { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 16px -22px 0; background: rgba(0,0,0,.18); }
	.pop-hero .st { padding: 14px 22px; min-width: 0; border-inline-start: 1px solid rgba(255,255,255,.14); }
	.pop-hero .st:first-child { border-inline-start: 0; }
	.pop-hero .st .l { font-size: 12px; color: rgba(255,255,255,.75); }
	.pop-hero .st .v { font-size: 19px; font-weight: 600; color: #fff; margin-top: 2px; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pop-hero .st .v.neg { color: #fecdd3; }
	.pop-hero .st .s { font-size: 11.5px; color: rgba(255,255,255,.7); margin-top: 2px; }

	.pop-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
	.pop-tiles .pop-chk { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border: 1px solid var(--border-color); border-top: 3px solid #10b981;
		border-radius: 10px; background: var(--card-bg, var(--fg-color)); cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; }
	.pop-tiles .pop-chk:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(15,23,42,.08); background: var(--card-bg, var(--fg-color)); }
	.pop-tiles .pop-chk.warn { border-top-color: #f59e0b; background: #fffbeb; }
	.pop-tiles .pop-chk.bad { border-top-color: #f43f5e; background: #fff1f2; }
	.pop-tiles .hd { display: flex; justify-content: space-between; align-items: center; }
	.pop-tiles .pop-chk .nm { font-weight: 600; color: var(--text-color); }
	.pop-tiles .pop-chk .ic { width: 20px; height: 20px; border: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center;
		font-size: 11px; font-weight: 700; color: #fff; background: #10b981; }
	.pop-tiles .pop-chk.warn .ic { background: #f59e0b; }
	.pop-tiles .pop-chk.bad .ic { background: #f43f5e; }
	.pop-tiles .pop-chk .tx { font-size: 12.5px; line-height: 1.4; color: var(--text-muted); }
	.pop-tiles .pop-chk .fg { margin-top: auto; font-size: 15px; font-weight: 600; color: var(--text-color); font-variant-numeric: tabular-nums; }
	.pop-tiles .pop-chk.warn .nm, .pop-tiles .pop-chk.warn .tx, .pop-tiles .pop-chk.warn .fg { color: #92400e; }
	.pop-tiles .pop-chk.bad .nm, .pop-tiles .pop-chk.bad .tx, .pop-tiles .pop-chk.bad .fg { color: #9f1239; }

	.pop-wf .bar.c { background: #cbd5e1; }
	.pop-wf .bar.k { background: #64748b; }
	.pop-wf .bar.p { background: linear-gradient(90deg, #34d399, #059669); }
	.pop-wf .bar.n { background: linear-gradient(90deg, #fb7185, #e11d48); }
	.pop-wf .mk { border-inline-start-color: #4f46e5; }
	.pop-wf .ax span { color: #4f46e5; font-weight: 500; }
	.pop-wf .val.pos { color: #059669; }
	.pop-wf .val.neg { color: #e11d48; }

	.pop-gantt .bar { background: linear-gradient(90deg, #6366f1, #4338ca); }
	.pop-gantt .lane.bill { border-color: #c7d2fe; }
	.pop-gantt .im { background: #f59e0b; }
	.pop-gantt .im.done { background: #10b981; }
	.pop-gantt .iml { position: absolute; top: 50%; transform: translateY(-50%); font-size: 11.5px; color: var(--text-muted); white-space: nowrap; }
	.pop-segs div.done { background: #10b981; border-color: #10b981; }
	.pop-pill.ok::before { background: #10b981; }
	.pop-pill.warn::before { background: #f59e0b; }

	[data-theme="dark"] .pop-tiles .pop-chk.warn { background: rgba(245,158,11,.1); }
	[data-theme="dark"] .pop-tiles .pop-chk.bad { background: rgba(244,63,94,.1); }
	[data-theme="dark"] .pop-tiles .pop-chk.warn .nm, [data-theme="dark"] .pop-tiles .pop-chk.warn .tx, [data-theme="dark"] .pop-tiles .pop-chk.warn .fg { color: #fcd34d; }
	[data-theme="dark"] .pop-tiles .pop-chk.bad .nm, [data-theme="dark"] .pop-tiles .pop-chk.bad .tx, [data-theme="dark"] .pop-tiles .pop-chk.bad .fg { color: #fda4af; }
	[data-theme="dark"] .pop-wf .mk { border-inline-start-color: #a5b4fc; }
	[data-theme="dark"] .pop-wf .ax span { color: #a5b4fc; }

	@media (max-width: 720px) {
		.pop-hero { grid-template-columns: 1fr; }
		.pop-hero .stats, .pop-tiles { grid-template-columns: 1fr 1fr; }
	}

	/* theme-tune */
	.pop-hero { background: linear-gradient(135deg, #6b70c4 0%, #464b98 100%); }
	.pop-hero.pending { background: radial-gradient(circle at 12% 15%, rgba(255,255,255,.18), transparent 45%), linear-gradient(135deg, #f0913d 0%, #d8652a 100%); }
	.pop-hero.approved { background: linear-gradient(135deg, #52a17c 0%, #327356 100%); }
	.pop-hero.returned { background: linear-gradient(135deg, #c4677d 0%, #924055 100%); }
	.pop-hero.cancelled { background: linear-gradient(135deg, #8b919c 0%, #5b616d 100%); }
	.pop-hero .stats { background: rgba(0,0,0,.12); }
	.pop-tiles .pop-chk { align-items: stretch; text-align: start; }
	.pop-tiles .pop-chk:focus { outline: none; }
	.pop-tiles .pop-chk:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; }
	.pop-tiles .hd { gap: 10px; }
	@media (max-width: 720px) {
		.pop-hero { padding: 16px 16px 0; }
		.pop-hero .hl { font-size: 22px; }
		.pop-hero .stats { margin: 14px -16px 0; }
		.pop-hero .st { padding: 12px 16px; }
		.pop-hero .st .v { font-size: 16px; white-space: normal; overflow: visible; }
	}

	/* scope-mobile */
	[data-fieldname="scope_html"] .pop-table th { white-space: normal; line-height: 1.3; vertical-align: bottom; }
	[data-fieldname="scope_html"] .pop-tw { -webkit-overflow-scrolling: touch; }
	@media (max-width: 720px) {
		[data-fieldname="scope_html"] .pop-table { table-layout: auto; min-width: 580px; }
		[data-fieldname="scope_html"] .pop-table th, [data-fieldname="scope_html"] .pop-table td { padding: 10px 12px; }
		[data-fieldname="scope_html"] .pop-table th:nth-child(n) { width: auto; }
		[data-fieldname="scope_html"] .pov-bar { flex-wrap: wrap; gap: 8px; }
	}

	/* section-spacing */
	.page-container[data-page-route="Project Overview"] .frappe-control[data-fieldtype="HTML"] { padding-bottom: 24px; }
	.page-container[data-page-route="Project Overview"] .frappe-control[data-fieldname="banner_html"],
	.page-container[data-page-route="Project Overview"] .frappe-control[data-fieldname="deal_html"],
	.page-container[data-page-route="Project Overview"] .frappe-control[data-fieldname="scope_html"],
	.page-container[data-page-route="Project Overview"] .frappe-control[data-fieldname="schedule_html"],
	.page-container[data-page-route="Project Overview"] .frappe-control[data-fieldname="invoicing_html"],
	.page-container[data-page-route="Project Overview"] .frappe-control[data-fieldname="history_html"] { padding-bottom: 24px; }
	.page-container[data-page-route="Project Overview"] .section-head:focus { outline: none; box-shadow: none; }

	/* tiles-state */
	.page-container[data-page-route="Project Overview"] .form-section { scroll-margin-top: 90px; }
	.pop-tiles.pending .pop-chk.ok { border-top-color: #e4783a; }
	.pop-tiles.pending .pop-chk.ok .ic { background: #e4783a; }
	.pop-tiles.approved .pop-chk.ok { border-top-color: #3f8a68; }
	.pop-tiles.approved .pop-chk.ok .ic { background: #3f8a68; }
	.pop-tiles.returned .pop-chk.ok { border-top-color: #ab5468; }
	.pop-tiles.returned .pop-chk.ok .ic { background: #ab5468; }
	.pop-tiles.draft .pop-chk.ok { border-top-color: #5a5fae; }
	.pop-tiles.draft .pop-chk.ok .ic { background: #5a5fae; }
	.pop-tiles.cancelled .pop-chk.ok { border-top-color: #737985; }
	.pop-tiles.cancelled .pop-chk.ok .ic { background: #737985; }

	/* access-restrict */
	.pop-hero.noring { grid-template-columns: minmax(0, 1fr); }
	.pop-hero .stats { grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); }
	.pop-tiles { grid-template-columns: repeat(var(--t, 4), minmax(0, 1fr)); }
	@media (max-width: 720px) { .pop-hero .stats, .pop-tiles { grid-template-columns: 1fr 1fr; } }

	/* team-chips */
	.pop-tm { display: inline-flex; align-items: center; gap: 5px; margin: 2px 12px 2px 0; font-size: 12.5px; white-space: nowrap; color: var(--text-color); }
	.pop-tm i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
	.pop-tm b { font-weight: 600; }
	.pop-tm-total { display: inline-block; font-size: 12.5px; font-weight: 600; margin-right: 12px; color: var(--text-color); }
	/* visit-days */
	.pop-table .pop-wd { font-weight: 600; color: var(--text-color); }
	.pop-table td.sub > div + div { margin-top: 3px; }

	/* scope-v2 */
	.psc, .psc span, .psc b, .psc div { font-family: inherit; }
	.psc-box { border: 1px solid var(--border-color); border-radius: 12px; background: var(--card-bg, var(--fg-color)); overflow: hidden; }
	.psc-box + .psc-box { margin-top: 12px; }
	.psc-sum { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
	.psc-sum > div { padding: 12px 16px; border-left: 1px solid var(--border-color); }
	.psc-sum > div:first-child { border-left: 0; }
	.psc-sum .l { font-size: 12px; color: var(--text-muted); }
	.psc-sum .v { font-size: 18px; font-weight: 600; color: var(--text-color); margin-top: 2px; font-variant-numeric: tabular-nums; }
	.psc-sum .v > span { font-size: 13px; font-weight: 400; color: var(--text-muted); }
	.psc-sum .v > span.psc-d { font-size: 12px; font-weight: 500; color: #9a5b0b; margin-left: 6px; }
	.psc-sum .v > span.psc-same { font-size: 12px; margin-left: 6px; }
	.psc-tw { overflow-x: auto; -webkit-overflow-scrolling: touch; }
	.psc-table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 13px; color: var(--text-color); }
	.psc-table th { font-size: 12px; font-weight: 400; color: var(--text-muted); padding: 8px 14px; text-align: right; border-bottom: 1px solid var(--border-color); white-space: nowrap; background: none; }
	.psc-table thead th { background: color-mix(in srgb, var(--subtle-fg) 65%, var(--card-bg, var(--fg-color))); }
	.psc-table tr.grp th { text-align: center; color: var(--text-color); font-weight: 500; padding: 10px 14px 0; border-bottom: 0; }
	.psc-table td { padding: 11px 14px; border-bottom: 1px solid var(--border-color); text-align: right; font-variant-numeric: tabular-nums; vertical-align: middle; }
	.psc-table .l { text-align: left; }
	.psc-table .e { color: var(--text-muted); }
	.psc-table .p { font-weight: 500; }
	.psc-table .x { color: #9a5b0b; font-weight: 600; }
	.psc-table .nm { font-weight: 600; }
	.psc-table .tag { font-size: 11.5px; color: #9a5b0b; margin-top: 3px; }
	.psc-table tr.t td { border-bottom: 0; font-weight: 600; }
	.psc-table tr.t td.e { font-weight: 400; }
	.psc-crew { font-size: 12px; color: var(--text-muted); }
	.psc-crew span { display: inline-flex; align-items: center; margin: 2px 12px 2px 0; white-space: nowrap; }
	.psc-crew span.ch { color: #9a5b0b; font-weight: 600; }
	.psc i { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; flex: none; }
	.psc-pd { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 22px; padding: 11px 16px; border-top: 1px solid var(--border-color);
		background: var(--subtle-fg); font-size: 12.5px; color: var(--text-color); }
	.psc-pd .lb, .psc-pd .e { color: var(--text-muted); }
	.psc-pd b { font-weight: 600; }
	.psc-pd b.x { color: #9a5b0b; }
	.psc-table tr.t td { background: color-mix(in srgb, var(--subtle-fg) 65%, var(--card-bg, var(--fg-color))); font-weight: 700; }
	.psc-table tr.t td.e { font-weight: 600; }
	.psc-table thead th, .psc-table thead tr.grp th { font-weight: 600; }
	[data-theme="dark"] .psc-sum .v > span.psc-d, [data-theme="dark"] .psc-table .x, [data-theme="dark"] .psc-table .tag,
	[data-theme="dark"] .psc-crew span.ch, [data-theme="dark"] .psc-pd b.x { color: #fcd34d; }

	/* cost-breakdown */
	.pcb { border: 1px solid var(--border-color); border-radius: 12px; background: var(--card-bg, var(--fg-color)); overflow-x: auto; }
	.pcb-table { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 13px; color: var(--text-color); }
	.pcb-table th { font-size: 12px; font-weight: 600; color: var(--text-muted); padding: 10px 16px; text-align: right; border-bottom: 1px solid var(--border-color);
		background: color-mix(in srgb, var(--subtle-fg) 65%, var(--card-bg, var(--fg-color))); white-space: nowrap; }
	.pcb-table td { padding: 11px 16px; border-bottom: 1px solid var(--border-color); text-align: right; font-variant-numeric: tabular-nums; vertical-align: middle; }
	.pcb-table .l { text-align: left; }
	.pcb-table .nm { font-weight: 600; }
	.pcb-table td.sh { width: 42%; }
	.pcb-table .sh .w { display: flex; align-items: center; gap: 12px; }
	.pcb-table .bar { flex: 1; height: 6px; border-radius: 3px; background: var(--subtle-fg); overflow: hidden; }
	.pcb-table .bar span { display: block; height: 100%; border-radius: 3px; background: #2490EF; }
	.pcb-table .sh b { min-width: 48px; font-weight: 600; }
	.pcb-table tr.t td { border-bottom: 0; font-weight: 700; background: color-mix(in srgb, var(--subtle-fg) 65%, var(--card-bg, var(--fg-color))); }
	.pcb-table .warn { font-size: 12px; font-weight: 600; color: #9a5b0b; }
	[data-theme="dark"] .pcb-table .warn { color: #fcd34d; }
	/* scope-cards */
	.psc-sum > div { padding: 14px 18px 16px; }
	.psc-sum .l { font-size: 12px; font-weight: 500; color: var(--text-muted); }
	.psc-sum .v { font-size: 22px; font-weight: 700; margin-top: 4px; line-height: 1.2; color: var(--text-color); font-variant-numeric: tabular-nums; }
	.psc-sum .v > span { font-size: 13px; font-weight: 400; color: var(--text-muted); margin-left: 6px; }
	.psc-sum .s { margin-top: 4px; font-size: 12px; }
	.psc-sum .s .psc-d { color: #9a5b0b; font-weight: 600; }
	.psc-sum .s .psc-same { color: #2f7d4a; font-weight: 500; }
	.psc-sum .m { height: 4px; border-radius: 2px; background: var(--subtle-fg); margin-top: 12px; overflow: hidden; }
	.psc-sum .m span { display: block; height: 100%; border-radius: 2px; background: #2490EF; }
	.psc-sum .dots { display: flex; gap: 4px; margin-top: 12px; }
	.psc-sum .dots i { display: block; flex: 1; max-width: 28px; height: 4px; margin: 0; border-radius: 2px; background: var(--subtle-fg); }
	.psc-sum .dots i.c { background: #F59E0B; }
	.psc-box:has(> .psc-sum) { border: 0; background: none; border-radius: 0; overflow: visible; }
	.psc-sum { gap: 12px; }
	.psc-sum > div, .psc-sum > div:first-child { border: 1px solid var(--border-color); border-radius: 12px; background: var(--card-bg, var(--fg-color)); }
	[data-theme="dark"] .psc-sum .s .psc-d { color: #fcd34d; }
	[data-theme="dark"] .psc-sum .s .psc-same { color: #8ce99a; }
	/* invoice-desc */
	.pop-table td.pop-desc { white-space: normal; min-width: 180px; max-width: 420px; line-height: 1.45; }
	`;
	$('<style id="pop-styles">').text(css).appendTo('head');
}

function pop_table(heads, body) {
	const th = heads.map(h => Array.isArray(h) ? `<th class="${h[1]}">${h[0]}</th>` : `<th>${h}</th>`).join('');
	return `<div class="pop-tw"><table class="pop-table"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function pop_page_html(frm, d, scope) {
	pop_inject_styles();
	pov_inject_styles();
	scope = scope || {};
	const acc = Object.assign({ contract: 1, profit: 1 }, d.access || {});
	const esc = frappe.utils.escape_html;
	const ov = d.overview || {}, est = d.estimation || {}, plan = d.plan || {};
	const money = v => format_currency(flt(v), d.currency, 0);
	const date = v => v ? frappe.datetime.str_to_user(String(v).slice(0, 10)) : '-';
	const pct = (a, b) => b ? flt(a / b * 100, 1) : 0;
	const sign = v => (v >= 0 ? '+' : '−') + format_number(Math.abs(v), null, 0);
	const pill = (text, tone) => `<span class="pop-pill ${tone}">${text}</span>`;
	const empty = t => `<div class="pop-empty">${t}</div>`;
	const contract = flt(ov.contract_value), cost = flt(est.total_cost), price = flt(est.total_price);
	const profit = contract - cost;
	const history = d.history || [];
	const visits = d.visits || [];
	const invoices = d.invoices || [];
	const comparison = scope.comparison || [];

	const work_days = visits.reduce((s, v) => s + flt(v.working_days), 0);
	const est_days = comparison.filter(r => !r.not_in_estimation).reduce((s, r) => s + flt((r.est || {}).total_days), 0);
	const plan_units = comparison.filter(r => !r.not_planned).reduce((s, r) => s + flt((r.plan || {}).quantity), 0);
	const differ = pov_scope_differ(scope);
	const pct_total = invoices.reduce((s, i) => s + flt(i.invoice_percentage), 0);
	const is_done = i => (i.status || '') === 'Invoiced';
	const done_amt = invoices.filter(is_done).reduce((s, i) => s + contract * flt(i.invoice_percentage) / 100, 0);
	const inv_name = (i, n) => i.invoice_label || i.title || i.invoice_title || __('Invoice {0}', [n]);
	const inv_date = i => i.expected_date || i.expected_invoice_date || i.invoice_date || i.due_date;
	const unlinked = invoices.filter(i => !(i.after_visits || []).length && !i.invoice_date && !i.due_date).length;

	// ---- status ----
	const state = ov.workflow_state || '';
	const pending = ov.docstatus === 0 && (state === 'Pending COO Approval' || state === 'Pending CEO Approval');
	const sent = history.slice().reverse().find(h => /^Sent for approval/i.test(h.text || ''));
	let title, sub;
	if (ov.docstatus === 1) {
		title = __('Approved'); sub = __('The plan is submitted and the project is active.');
	} else if (state === 'Pending COO Approval') {
		title = frappe.user.has_role('COO') ? __('Pending your approval') : __('Pending the COO');
		sub = __('Approve it, or return it to Planning, from Actions.');
	} else if (state === 'Pending CEO Approval') {
		title = frappe.user.has_role('CEO') ? __('Pending your approval') : __('Pending the CEO');
		sub = __('Approve it, or return it to the COO, from Actions.');
	} else {
		title = __('With Planning');
		sub = ov.return_reason ? __('Last return reason: {0}', [esc(ov.return_reason)]) : __('The plan has not been sent for approval yet.');
	}

	// ---- checks: [tone, section, name, finding, figure] ----
	const vs_price = !price ? ''
		: contract > price * 1.005 ? __('{0}% above the Estimation price', [flt((contract / price - 1) * 100, 0)])
		: contract < price * 0.995 ? __('{0}% below the Estimation price', [flt((1 - contract / price) * 100, 0)])
		: __('in line with the Estimation price');
	const checks = [];
	const profit_txt = profit < 0 ? __('{0} loss', [money(-profit)]) : __('{0} profit', [money(profit)]);
	if (!contract) checks.push(['bad', 'deal_section', __('Deal'), __('The contract value is zero. Set the Planned Revenue on the project.'), '']);
	else if (!cost) checks.push(['warn', 'deal_section', __('Deal'), __('The Estimation has no cost yet.'), money(contract)]);
	else if (profit < 0) checks.push(['bad', 'deal_section', __('Deal'), __("The contract doesn't cover the estimated cost."), profit_txt]);
	else if (price && contract < price * 0.9) checks.push(['warn', 'deal_section', __('Deal'), __('The contract covers the cost but is {0}.', [vs_price]), profit_txt]);
	else checks.push(['ok', 'deal_section', __('Deal'), vs_price ? __('The contract covers the cost and is {0}.', [vs_price]) : __('The contract covers the cost.'), profit_txt]);

	const units_txt = __('{0} units', [flt(plan_units, 2)]);
	if (!comparison.length) checks.push(['warn', 'scope_section', __('Scope'), __('The Estimation and the Plan have no equipment yet.'), '']);
	else if (differ) checks.push(['warn', 'scope_section', __('Scope'), __('{0} of {1} equipment differ from the Estimation.', [differ, comparison.length]), units_txt]);
	else checks.push(['ok', 'scope_section', __('Scope'), (comparison.length === 1 ? __('The plan matches the Estimation on the equipment and its crew.') : __('The plan matches the Estimation on all {0} equipment and crews.', [comparison.length])), units_txt]);

	const days_txt = __('{0} days', [flt(work_days, 2)]);
	if (!visits.length) checks.push(['bad', 'schedule_section', __('Schedule'), __('No visits are planned yet.'), '']);
	else if (est_days && flt(work_days, 2) !== flt(est_days, 2)) checks.push(['warn', 'schedule_section', __('Schedule'), __('{0} visits plan {1} working days; the Estimation has {2}.', [visits.length, flt(work_days, 2), flt(est_days, 2)]), days_txt]);
	else checks.push(['ok', 'schedule_section', __('Schedule'), (visits.length === 1 ? __('1 visit covers all {0} working days.', [flt(work_days, 2)]) : __('{0} visits cover all {1} working days.', [visits.length, flt(work_days, 2)])), days_txt]);

	if (!invoices.length) checks.push(['warn', 'invoicing_section', __('Invoicing'), __('No invoices are planned yet.'), '']);
	else if (flt(pct_total, 2) !== 100) checks.push(['bad', 'invoicing_section', __('Invoicing'), __('The invoices add up to {0}%, not 100%.', [flt(pct_total, 2)]), `${flt(pct_total, 2)}%`]);
	else checks.push(['ok', 'invoicing_section', __('Invoicing'), (invoices.length === 1 ? __('1 invoice covers 100% of the contract.') : __('{0} invoices cover 100% of the contract.', [invoices.length])), __('{0}% invoiced', [flt(pct(done_amt, contract), 0)])]);

	if (!(acc.profit && acc.contract)) for (let i = checks.length - 1; i >= 0; i--) if (checks[i][1] === 'deal_section') checks.splice(i, 1);
	// ---- hero ----
	const bad = checks.filter(c => c[0] === 'bad'), warn = checks.filter(c => c[0] === 'warn');
	const passed = checks.length - bad.length - warn.length;
	const names = list => list.map(c => c[2]).join(', ');
	const headline = bad.length ? __('Needs fixing: {0}', [names(bad)])
		: warn.length ? __('Nearly ready, check {0}', [names(warn)])
		: __('Everything checks out');
	const m = contract && cost ? flt(profit / contract * 100, 1) : null;
	const C = 251.33;
	const hero_state = ov.docstatus === 2 ? 'cancelled' : ov.docstatus === 1 ? 'approved' : pending ? 'pending'
		: (cint(ov.return_count) > 0 || ov.return_reason) ? 'returned' : 'draft';
	if (hero_state === 'returned') title = __('Returned to Planning');
	if (hero_state === 'cancelled') title = __('Cancelled');
	const ring = `<svg class="pop-ring" viewBox="0 0 96 96" width="96" height="96">
		<circle cx="48" cy="48" r="40" class="bg"/>
		${m !== null && m > 0 ? `<circle cx="48" cy="48" r="40" class="fg" stroke-dasharray="${C * Math.min(m, 100) / 100} ${C}" transform="rotate(-90 48 48)"/>` : ''}
		<text x="48" y="51" text-anchor="middle" class="v">${m !== null ? m + '%' : '-'}</text>
		<text x="48" y="67" text-anchor="middle" class="l">${__('margin')}</text>
	</svg>`;
	const lbl = [title, (pending && sent) ? __('sent by {0} on {1}', [esc(sent.by || ''), date(sent.date)]) : ''].filter(Boolean).join(' · ');
	const stat = (l, v, s, cls) => `<div class="st"><div class="l">${l}</div><div class="v ${cls || ''}">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
	const stat_list = [
		acc.contract ? stat(__('Contract value'), money(contract), (acc.profit && vs_price) || __('From the Opportunity')) : '',
		acc.profit ? stat(__('Estimated cost'), cost ? money(cost) : '-', contract && cost ? __('{0}% of the contract', [pct(cost, contract)]) : '') : '',
		acc.profit ? stat(__('Margin'), cost ? money(profit) : '-', m !== null ? __('{0}% of the contract', [m]) : '', profit < 0 ? 'neg' : '') : '',
		acc.profit ? stat(__('Estimation price'), price ? money(price) : '-', price ? __('Cost + {0}% margin', [flt(est.margin_percentage, 0)]) : '') : '',
		acc.profit ? '' : stat(__('Working days'), flt(work_days, 2), visits.length === 1 ? __('1 visit') : __('{0} visits', [visits.length])),
	].filter(Boolean);
	const stat_n = stat_list.length;
	const stats = stat_list.join('');
	const icon = { ok: '✓', warn: '!', bad: '✕' };
	const banner = `<div class="pop-hero ${hero_state}${acc.profit ? '' : ' noring'}">
		${acc.profit ? ring : ''}
		<div class="main">
			<div class="lbl">${lbl}</div>
			<div class="hl">${esc(headline)}</div>
			<div class="sub">${__('{0} of {1} checks pass.', [passed, checks.length])} ${sub}</div>
		</div>
		<div class="stats" style="--n:${stat_n}">${stats}</div>
	</div>
	<div class="pop-tiles ${hero_state}" style="--t:${checks.length}">${checks.map(c => `<div class="pop-chk ${c[0]}" data-sec="${c[1]}" role="button" tabindex="0">
		<div class="hd"><span class="nm">${c[2]}</span><span class="ic">${icon[c[0]]}</span></div>
		<div class="tx">${c[3]}</div>
		${c[4] ? `<div class="fg">${c[4]}</div>` : ''}
	</div>`).join('')}</div>`;

	// ---- deal: where the money goes ----
	let deal;
	if (!contract && !cost) {
		deal = empty(__('No contract value or estimated cost yet.'));
	} else {
		const scale = Math.max(contract, cost, price) || 1;
		const w = v => flt(Math.max(v, 0) / scale * 100, 3);
		const mk = price ? `<div class="mk" style="left:${w(price)}%"></div>` : '';
		const row = (label, left, width, cls, val, vcls) => `<div class="lb">${label}</div>
			<div class="tr">${mk}<div class="bar ${cls}" style="left:${left}%; width:${Math.max(width, 0.5)}%"></div></div>
			<div class="val ${vcls || ''}">${val}</div>`;
		const foot = [
			contract && cost ? __('Cost is {0}% of the contract', [pct(cost, contract)]) : '',
			contract && cost ? __('{0}% margin', [flt(profit / contract * 100, 1)]) : '',
			price ? __('The Estimation used a {0}% margin', [flt(est.margin_percentage, 0)]) : '',
		].filter(Boolean).join(' · ');
		deal = `<div class="pop-wf">
			${row(__('Contract'), 0, w(contract), 'c', money(contract))}
			${row(__('Estimated cost'), 0, w(cost), 'k', money(cost))}
			${profit < 0
				? row(__('Loss'), w(contract), w(cost - contract), 'n', money(profit), 'neg')
				: row(__('Profit'), w(cost), w(profit), 'p', money(profit), 'pos')}
			${price ? `<div></div><div class="tr ax"><span class="${w(price) > 80 ? 'r' : ''}" style="left:${w(price)}%">${__('Estimation price {0}', [money(price)])}</span></div><div></div>` : ''}
		</div>${foot ? `<div class="pop-wf-foot">${foot}</div>` : ''}`;
	}

	// ---- schedule: one timeline for work and billing ----
	const to_ms = v => v ? frappe.datetime.str_to_obj(String(v).slice(0, 10)).getTime() : null;
	const starts = visits.map(v => to_ms(v.start_date)).filter(Boolean);
	const ends = visits.map(v => to_ms(v.end_date)).filter(Boolean);
	const t0 = to_ms(plan.from_date) || (starts.length ? Math.min(...starts) : null);
	const t1 = to_ms(plan.to_date) || (ends.length ? Math.max(...ends) : null);
	const DAY = 86400000;
	const mon = (ms, yr) => new Date(ms).toLocaleString('en', yr ? { month: 'short', year: 'numeric' } : { month: 'short' });
	const sched_meta = [
		(visits.length === 1 ? __('1 visit') : __('{0} visits', [visits.length])), __('{0} working days', [flt(work_days, 2)]),
		t0 && t1 ? `${mon(t0, 1)} → ${mon(t1, 1)}` : '',
	].filter(Boolean).join(' · ');
	let gantt = '';
	if (t0 && t1 && t1 >= t0 && visits.length) {
		const span = (t1 - t0) + DAY;
		const pos = ms => Math.max(0, Math.min(100, (ms - t0) / span * 100));
		const months = [];
		const first = new Date(t0);
		for (let mm = new Date(first.getFullYear(), first.getMonth(), 1); mm.getTime() <= t1; mm = new Date(mm.getFullYear(), mm.getMonth() + 1, 1)) months.push(mm);
		const step = months.length > 18 ? 3 : 1;
		const axis = months.filter((_, i) => i % step === 0).map(mm => {
			const left = pos(Math.max(mm.getTime(), t0));
			return left > 95 ? '' : `<span style="left:${left}%">${mon(mm.getTime(), months.length > 12 && mm.getMonth() === 0)}</span>`;
		}).join('');
		const lanes = visits.map(v => {
			const a = to_ms(v.start_date), b = to_ms(v.end_date);
			const bar = a && b
				? `<div class="bar" style="left:${pos(a)}%; width:${Math.min(Math.max(0.8, (b - a + DAY) / span * 100), 100 - pos(a))}%" title="${date(v.start_date)} → ${date(v.end_date)}"></div>`
				: '';
			return `<div class="name">${esc(v.visit_label || v.name)}</div><div class="lane">${bar}</div><div class="days">${__('{0} days', [flt(v.working_days, 2)])}</div>`;
		}).join('');
		let billing = '';
		if (invoices.length) {
			const vend = {};
			visits.forEach(v => { const e = to_ms(v.end_date); if (e) { vend[v.name] = e; if (v.visit_label) vend[v.visit_label] = e; } });
			const placed = [], unplaced = [];
			invoices.forEach((i, k) => {
				let at = to_ms(inv_date(i));
				if (!at && (i.after_visits || []).length) at = Math.max(0, ...i.after_visits.map(x => vend[x] || 0)) || null;
				(at ? placed : unplaced).push([i, k, at]);
			});
			const marks = placed.map(([i, k, at]) => `<span class="im ${is_done(i) ? 'done' : ''}" style="left:${pos(at)}%"
				title="${esc(inv_name(i, k + 1))} · ${flt(i.invoice_percentage, 2)}% · ${frappe.datetime.obj_to_user(new Date(at))}"></span><span class="iml" style="${pos(at) > 75 ? `right:calc(${100 - pos(at)}% + 10px)` : `left:calc(${pos(at)}% + 10px)`}">${esc(inv_name(i, k + 1))} · ${flt(i.invoice_percentage, 2)}%</span>`).join('');
			const un = unplaced.length
				? `<span class="un ${placed.length ? 'end' : ''}">${__('No expected date: {0}', [unplaced.map(([i, k]) => `${esc(inv_name(i, k + 1))} · ${flt(i.invoice_percentage, 2)}%`).join(', ')])}</span>`
				: '';
			billing = `<div class="name">${__('Billing')}</div><div class="lane bill ${unplaced.length ? 'warn' : ''}">${marks}${un}</div>
				<div class="days">${__('{0} of {1}', [placed.length, invoices.length])}</div>`;
		}
		gantt = `<div class="pop-gantt"><div></div><div class="axis">${axis}</div><div></div>${lanes}${billing}</div>`;
	}
	const torder = nexlify.sort_trades(scope.trades || []);
	const trank = t => { const i = torder.indexOf(t); return i < 0 ? 999 : i; };
	const tpal = ['#2490EF', '#20A39E', '#F59E0B', '#8B5CF6', '#EC4899', '#64748B'];
	const tcolor = t => nexlify.trade_color(t);
	const vrows = visits.map(v => {
		const eq = (v.equipment || []).map(a => `<div>${esc(a.equipment || '')} × ${flt(a.quantity, 2)}${a.work_days != null ? ` · <b class="pop-wd">${flt(a.work_days, 2)} ${__('days')}</b>` : ''}</div>`);
		const cal = to_ms(v.start_date) && to_ms(v.end_date) ? Math.round((to_ms(v.end_date) - to_ms(v.start_date)) / DAY) + 1 : null;
		const team = (v.team || []).filter(t => cint(t.headcount) > 0).sort((a, b) => trank(a.trade) - trank(b.trade));
		const people = team.reduce((n, t) => n + cint(t.headcount), 0);
		return `<tr>
			<td class="nowrap"><a href="/app/project-visits/${v.name}">${esc(v.visit_label || v.name)}</a></td>
			<td class="nowrap">${date(v.start_date)} → ${date(v.end_date)}</td>
			<td class="num"><b>${flt(v.working_days, 2)}</b>${cal ? `<div class="sub">${__('over {0} calendar days', [cal])}</div>` : ''}</td>
			<td class="sub">${eq.length ? eq.join('') : __('No equipment')}</td>
			<td>${team.length ? `<span class="pop-tm-total">${people === 1 ? __('1 person') : __('{0} people', [people])}</span>` + team.map(t => `<span class="pop-tm"><i style="background:${tcolor(t.trade)}"></i><b>${cint(t.headcount)}</b> ${esc(t.trade || '')}</span>`).join('') : `<span class="sub">${__('No team')}</span>`}</td>
		</tr>`;
	}).join('');
	const schedule = visits.length
		? `<div class="pop-meta-line">${sched_meta}</div>${gantt}${pop_table([__('Visit'), __('Dates'), [__('Work days'), 'num'], __('Equipment'), __('Team')], vrows)}`
		: empty(__('No visits yet.'));

	// ---- invoicing ----
	const segs = invoices.map((i, k) => `<div class="${is_done(i) ? 'done' : ''}" style="flex:${flt(i.invoice_percentage) || 0.5} 1 0"
		title="${esc(inv_name(i, k + 1))}: ${flt(i.invoice_percentage, 2)}%"></div>`).join('');
	const irows = invoices.map((i, k) => {
		const when = inv_date(i) ? date(inv_date(i)) : '-';
		return `<tr>
			<td class="nowrap"><a href="/app/project-invoicing/${i.name}">${esc(inv_name(i, k + 1))}</a></td>
			<td class="sub pop-desc">${i.description ? esc(i.invoice_description || i.description) : '—'}</td>
			<td class="num">${flt(i.invoice_percentage, 2)}%</td>
			<td class="num">${acc.contract ? money(contract * flt(i.invoice_percentage) / 100) : '-'}</td>
			<td>${when}</td>
			<td>${is_done(i) ? pill(__('Invoiced'), 'ok') : pill(esc(i.status || __('Pending')), 'neutral')}</td>
		</tr>`;
	}).join('');
	const invoicing = invoices.length
		? `<div class="pop-meta-line">${(acc.contract ? __('{0} of {1} invoiced', [money(done_amt), money(contract)]) : __('{0}% invoiced', [flt(invoices.filter(is_done).reduce((t, i) => t + flt(i.invoice_percentage), 0), 2)]))}</div><div class="pop-segs">${segs}</div>`
			+ pop_table([__('Invoice'), __('Description'), [__('Share'), 'num'], [__('Amount'), 'num'], __('Expected date'), __('Status')], irows)
		: empty(__('No invoices planned yet.'));

	// ---- history ----
	const hrows = history.slice().reverse().map(h => `<tr>
		<td class="nowrap sub">${date(h.date)}</td>
		<td>${esc(h.text || '')}</td>
		<td class="nowrap sub">${esc(h.by || '')}</td>
	</tr>`).join('');
	const history_sec = history.length ? pop_table([__('Date'), __('Event'), __('By')], hrows) : empty(__('No history yet.'));

	const cb = d.cost_breakdown || [];
	const cb_total = cb.reduce((n, r) => n + flt(r.estimated_amount), 0);
	const cb_max = Math.max(1, ...cb.map(r => flt(r.estimated_amount)));
	const cost_html = !cb.length ? empty(__('The Estimation has no budget details yet.')) : `<div class="pcb"><table class="pcb-table">
		<thead><tr><th class="l">${__('Budget category')}</th><th>${__('Amount')}</th><th class="l">${__('Share of cost')}</th></tr></thead>
		<tbody>${cb.map(r => {
			const a = flt(r.estimated_amount), sh = cb_total ? a / cb_total * 100 : 0;
			return `<tr><td class="l nm">${esc(r.budget_category || __('(No Category)'))}</td><td>${money(a)}</td>
				<td class="sh"><div class="w"><div class="bar"><span style="width:${a / cb_max * 100}%"></span></div><b>${flt(sh, 1)}%</b></div></td></tr>`;
		}).join('')}</tbody>
		<tfoot><tr class="t"><td class="l">${__('Total')}</td><td>${money(cb_total)}</td>
			<td class="l">${cost && flt(cb_total, 0) !== flt(cost, 0) ? `<span class="warn">${__('Estimated cost is {0}', [money(cost)])}</span>` : '100%'}</td></tr></tfoot>
	</table></div>`;
	frm.toggle_display('cost_section', !!acc.profit);
	frm.toggle_display('deal_section', !!(acc.profit && acc.contract));
	return { banner, deal, cost: cost_html, schedule, invoicing, history: history_sec };
}
