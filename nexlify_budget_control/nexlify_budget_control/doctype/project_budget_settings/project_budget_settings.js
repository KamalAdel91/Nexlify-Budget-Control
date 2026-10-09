// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on('Project Budget Settings', {
	setup(frm) {
		// Project Invoice Items: enabled service Items that are sold
		frm.set_query('item_code', 'project_invoice_items', () => ({
			filters: { is_sales_item: 1, is_stock_item: 0, is_fixed_asset: 0, disabled: 0 },
		}));
	},
});
