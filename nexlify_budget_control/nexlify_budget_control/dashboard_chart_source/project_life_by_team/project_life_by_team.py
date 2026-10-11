import frappe

from nexlify_budget_control.nexlify_budget_control.project_life_dashboard import by_team


@frappe.whitelist()
def get(chart_name=None, chart=None, no_cache=None, filters=None, from_date=None, to_date=None, timespan=None,
		time_interval=None, heatmap_year=None):
	"""Dashboard Chart Source Project Life by Team: the chart's filter "measure" is waiting, overdue or average."""
	f = frappe.parse_json(filters) or {}
	return by_team((f.get("measure") if isinstance(f, dict) else None) or "waiting")
