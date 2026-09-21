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

	let kpi_html = `
		<div class="npo-kpi-row">
			<div class="npo-kpi-card">
				<div class="npo-kpi-label">${__('Planned Revenue')}</div>
				<div class="npo-kpi-value" style="color: var(--blue-500, #2b6cb0);">${fmt_currency(data.planned_revenue, currency)}</div>
			</div>
			<div class="npo-kpi-card">
				<div class="npo-kpi-label">${__('Planned Cost')}</div>
				<div class="npo-kpi-value" style="color: var(--orange-500, #e8590c);">${fmt_currency(data.planned_cost, currency)}</div>
			</div>
			<div class="npo-kpi-card">
				<div class="npo-kpi-label">${__('Expected Profit')}</div>
				<div class="npo-kpi-value" style="color: ${profit_color};">${fmt_currency(data.expected_profit, currency)}</div>
			</div>
		</div>
	`;

	let status_html = `
		<div class="npo-status-row">
			<div class="npo-status-card">
				<span class="npo-status-label">${data.plan_name ? `<a href="/app/project-planning/${data.plan_name}" class="npo-link">${__('Project Plan')}</a>` : __('Project Plan')}</span>
				${status_badge(data.plan_status, __('Not Created'))}
			</div>
			<div class="npo-status-card">
				<span class="npo-status-label">${data.cost_name ? `<a href="/app/project-cost-budget/${data.cost_name}" class="npo-link">${__('Project Costing')}</a>` : __('Project Costing')}</span>
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
