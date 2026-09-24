// System Manager tool: remove the year from old document names (operational documents only)
frappe.ui.form.on('Project Budget Settings', {
	refresh(frm) {
		if (!frappe.user.has_role('System Manager')) return;
		const M = 'nexlify_budget_control.nexlify_budget_control.setup.rename_tools.';
		const group = __('Remove the year from old names');
		frm.add_custom_button(__('Preview'), () => frappe.call({
			method: M + 'preview_drop_year',
			freeze: true,
			callback(r) {
				const d = r.message || {};
				const esc = frappe.utils.escape_html;
				const rows = Object.entries(d.summary || {}).map(([dt, s]) =>
					`<tr><td>${esc(dt)}</td><td style="text-align:right;">${s.count}</td><td>${s.examples.map(e => `${esc(e[0])} &rarr; ${esc(e[1])}`).join('<br>')}</td></tr>`).join('');
				frappe.msgprint({
					title: __('{0} documents will be renamed', [d.total || 0]),
					message: (rows ? `<table class="table table-bordered table-sm"><thead><tr><th>${__('Document')}</th><th>${__('Count')}</th><th>${__('Examples')}</th></tr></thead><tbody>${rows}</tbody></table>` : __('Nothing to rename.'))
						+ ((d.clashes || []).length ? `<p class="text-danger">${__('{0} will be skipped: the new name is already taken.', [d.clashes.length])}</p>` : ''),
					wide: true,
				});
			}
		}), group);
		frm.add_custom_button(__('Rename now'), () => frappe.confirm(
			__('Remove the year from the names of the old operational documents? This runs in the background and cannot be undone from here.'),
			() => frappe.call({
				method: M + 'apply_drop_year',
				callback() { frappe.show_alert({ message: __('Started. You will get a message when it finishes.'), indicator: 'blue' }); }
			})
		), group);
	}
});

