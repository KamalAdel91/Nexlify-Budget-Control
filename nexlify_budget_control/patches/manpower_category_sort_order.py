import frappe


def execute():
	"""Existing categories get 1, 2, 3... in the order they were made. Only categories without a number."""
	used = set(frappe.get_all("Manpower Category", filters={"sort_order": [">", 0]}, pluck="sort_order"))
	n = 0
	for name in frappe.get_all("Manpower Category", filters={"sort_order": ["<=", 0]}, pluck="name", order_by="creation asc"):
		n += 1
		while n in used:
			n += 1
		frappe.db.set_value("Manpower Category", name, "sort_order", n, update_modified=False)
