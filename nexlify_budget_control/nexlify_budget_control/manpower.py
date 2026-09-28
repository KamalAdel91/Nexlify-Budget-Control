# Copyright (c) 2026, Kamal Adel and contributors
"""Manpower Category order, shared by every screen that lists roles."""

import frappe


def trade_order():
	"""Manpower Category names in their Sort order (disabled ones included, so old rows still sort)."""
	return frappe.get_all("Manpower Category", order_by="sort_order asc, name asc", pluck="name")


def boot_session(bootinfo):
	try:
		bootinfo.nexlify_manpower_order = trade_order()
	except Exception:
		bootinfo.nexlify_manpower_order = []
