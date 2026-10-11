frappe.provide("frappe.dashboards.chart_sources");

frappe.dashboards.chart_sources["Project Life by Team"] = {
	method: "nexlify_budget_control.nexlify_budget_control.dashboard_chart_source.project_life_by_team.project_life_by_team.get",
	filters: [
		{ fieldname: "measure", label: __("Measure"), fieldtype: "Select", options: "waiting\noverdue\naverage", default: "waiting" },
	],
};
