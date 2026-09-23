// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on("Project Visits", {});


// ---------------------------------------------------------------------------
// Visit Days - read-only list on the visit form (managed from Project Planning)
// ---------------------------------------------------------------------------

frappe.ui.form.on("Project Visits", {
	refresh: function(frm) {
		render_visit_days_on_visit_form(frm);
	}
});

function render_visit_days_on_visit_form(frm) {
	if (!frm.fields_dict.visit_days_html) return;
	if (frm.is_new()) {
		frm.fields_dict.visit_days_html.$wrapper.html('');
		return;
	}

	frappe.call({
		method: 'nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_visit_days',
		args: { visit: frm.doc.name },
		callback: function(r) {
			let days = (r.message || {}).days || [];
			let style = `
				<style>
					.pvd-table { width:100%; border-collapse:collapse; font-size:12.5px; }
					.pvd-table th { background:var(--control-bg, #f8f9fb); text-align:left; padding:8px 10px; font-size:10.5px; text-transform:uppercase; letter-spacing:0.3px; color:var(--text-muted, #6c757d); border-bottom:1px solid var(--border-color, #e9ecef); }
					.pvd-table td { padding:8px 10px; border-bottom:1px solid var(--border-color, #e9ecef); vertical-align:top; }
				</style>`;

			if (!days.length) {
				frm.fields_dict.visit_days_html.$wrapper.html(
					`<div class="text-muted" style="padding:16px; text-align:center; border:1px dashed var(--border-color, #e9ecef); border-radius:10px;">${__('No days planned for this visit yet. Days are managed from the Project Planning.')}</div>`
				);
				return;
			}

			let rows = days.map(day => {
				let crew = (day.roles || []).length
					? day.roles.map(x => `${frappe.utils.escape_html(x.trade || '')} &times; ${cint(x.count)}`).join('<br>')
					: '<span class="text-muted">-</span>';
				let status = day.docstatus === 1
					? `<span style="color: var(--green-600, #2b8a3e); font-weight:600;">${__('Submitted')}</span>`
					: `<span class="text-muted">${__('Draft')}</span>`;
				return `<tr>
					<td>${frappe.datetime.str_to_user(day.work_date)}</td>
					<td>${frappe.utils.escape_html(day.equipment || '')}</td>
					<td>${flt(day.quantity)}</td>
					<td>${flt(day.days_consumed)}</td>
					<td>${crew}</td>
					<td>${status}</td>
					<td><a href="/app/project-visit-day/${day.name}">${__('Details')}</a></td>
				</tr>`;
			}).join('');

			frm.fields_dict.visit_days_html.$wrapper.html(`${style}
				<div style="border:1px solid var(--border-color, #e9ecef); border-radius:10px; overflow-x:auto;">
					<table class="pvd-table">
						<thead><tr>
							<th>${__('Date')}</th><th>${__('Equipment')}</th><th>${__('Qty')}</th>
							<th>${__('Days')}</th><th>${__('Crew')}</th><th>${__('Status')}</th><th>${__('Actions')}</th>
						</tr></thead>
						<tbody>${rows}</tbody>
					</table>
				</div>
				<div class="text-muted" style="margin-top:6px; font-size:11px;">${__('Days are managed from the Project Planning (Edit on the visit).')}</div>`);
		}
	});
}

