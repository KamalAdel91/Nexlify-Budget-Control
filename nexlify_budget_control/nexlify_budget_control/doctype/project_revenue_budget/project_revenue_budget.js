// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

frappe.ui.form.on("Project Revenue Budget", {
	setup: function(frm) {
		// Set default naming series based on company
		frm.set_query("naming_series", function() {
			return {
				filters: {
					"name": ["in", [".ABBR.-RB-.YYYY.-.####"]]
				}
			};
		});
	},

	company: function(frm) {
		if (frm.doc.company && !frm.doc.__islocal) {
			return;
		}
		// Set naming series when company selected (only for new docs)
		if (frm.doc.company && frm.doc.__islocal) {
			frm.set_value("naming_series", ".ABBR.-RB-.YYYY.-.####");
		}
	}
});
