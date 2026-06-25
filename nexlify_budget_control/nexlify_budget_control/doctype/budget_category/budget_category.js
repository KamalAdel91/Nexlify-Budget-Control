// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on("Budget Category Account", {
	company: function(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.company) {
			// Reset the account when company changes
			frappe.model.set_value(cdt, cdn, "account", "");
			// Set dynamic filter on account field based on company
			frappe.meta.get_docfield("Budget Category Account", "account", frm.doc.name).options =
				`Account`; // Keep it as Account link by default
		}
	}
});

frappe.ui.form.on("Budget Category", {
	setup: function(frm) {
		// Apply filters on child table account fields when row is edited
		frm.set_query("account", "accounts", function(doc, cdt, cdn) {
			const row = locals[cdt][cdn];
			if (row.company) {
				return {
					filters: {
						"company": row.company,
						"is_group": 0
					}
				};
			}
		});
	}
});
