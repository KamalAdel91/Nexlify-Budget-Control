// Copyright (c) 2026, Kamal Adel and contributors
// For license information, please see license.txt

const EXCLUDED_PROJECT_GATE_DOCTYPES = [
	"Project",
	"Project Planning",
	"Project Cost Budget",
	"Project Visits",
	"Project Invoicing",
	"Project Overview"
];

frappe.ui.form.on("*", {
	refresh: function(frm) {
		apply_active_project_filter(frm, frm.doctype, frm.fields_dict);
	}
});

$(document).on("grid-row-render", function(event, row) {
	if (!row || !row.frm) return;
	let child_doctype = row.doc.doctype;
	if (EXCLUDED_PROJECT_GATE_DOCTYPES.includes(child_doctype)) return;

	Object.keys(row.grid_form ? row.grid_form.fields_dict || {} : {}).forEach(function(fieldname) {
		let field = row.grid_form.fields_dict[fieldname];
		if (!field || !field.df) return;
		if (field.df.fieldtype === "Link" && field.df.options === "Project") {
			patch_field_query_to_enforce_active_project(field);
		}
	});
});

function patch_field_query_to_enforce_active_project(field) {
	if (!field || field._active_project_patched) return;
	field._active_project_patched = true;

	let current = field.get_query;

	Object.defineProperty(field, "get_query", {
		configurable: true,
		enumerable: true,
		get: function() {
			return function(...args) {
				let base = field._active_project_original
					? field._active_project_original.apply(this, args)
					: {};
				base = base || {};
				base.filters = Object.assign({}, base.filters, { is_active: "Yes" });
				return base;
			};
		},
		set: function(fn) {
			field._active_project_original = fn;
		}
	});

	field.get_query = current;
}

function apply_active_project_filter(frm, doctype, fields_dict) {
	if (EXCLUDED_PROJECT_GATE_DOCTYPES.includes(doctype)) return;

	Object.keys(fields_dict || {}).forEach(function(fieldname) {
		let field = fields_dict[fieldname];
		if (!field || !field.df) return;

		if (field.df.fieldtype === "Link" && field.df.options === "Project") {
			patch_field_query_to_enforce_active_project(field);
		}

		if (field.df.fieldtype === "Table" && field.grid) {
			let child_doctype = field.df.options;
			if (EXCLUDED_PROJECT_GATE_DOCTYPES.includes(child_doctype)) return;

			let child_meta = frappe.get_meta(child_doctype);
			if (!child_meta) return;

			child_meta.fields.forEach(function(child_field) {
				if (child_field.fieldtype === "Link" && child_field.options === "Project") {
					patch_field_query_to_enforce_active_project(field.grid.get_field(child_field.fieldname));
				}
			});
		}
	});
}
