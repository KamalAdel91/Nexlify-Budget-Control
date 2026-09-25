import json
import os

import frappe


def seed_master_data():
	"""Adds the master data shipped in seed_data.json (regions, maintenance natures and types, project
	types, equipment types) once per site. Existing records are never changed, and a record removed in
	the UI later is not added again: after the first time, the UI owns this data."""
	path = os.path.join(os.path.dirname(__file__), "seed_data.json")
	if not os.path.exists(path):
		return
	applied = set(frappe.parse_json(frappe.db.get_default("nexlify_seeded_master_data") or "[]"))
	changed = False
	for doctype, rows in json.load(open(path)).items():
		if not frappe.db.exists("DocType", doctype):
			continue
		for row in rows:
			key = f"{doctype}|{row['name']}"
			if key in applied:
				continue
			if not frappe.db.exists(doctype, row["name"]):
				doc = frappe.get_doc({**row, "doctype": doctype})
				doc.flags.ignore_links = True
				doc.insert(ignore_permissions=True, ignore_if_duplicate=True)
			applied.add(key)
			changed = True
	if changed:
		frappe.db.set_default("nexlify_seeded_master_data", frappe.as_json(sorted(applied)))


def _hash(text):
	import hashlib
	return hashlib.md5((text or "").strip().encode()).hexdigest()


def update_scripts_once():
	"""Puts the app's version of the Server / Client Scripts listed in script_updates.json on this site,
	only when the site still has the old version (or none). A script edited in the UI is left alone
	and an Error Log explains why. Each version is applied once per site."""
	base = os.path.dirname(__file__)
	path = os.path.join(base, "script_updates.json")
	if not os.path.exists(path):
		return
	applied = set(frappe.parse_json(frappe.db.get_default("nexlify_script_updates") or "[]"))
	changed = False
	for item in json.load(open(path)):
		dt, name = item["doctype"], item["name"]
		new = open(os.path.join(base, item["file"])).read().strip()
		key = f"{dt}|{name}|{_hash(new)}"
		if key in applied:
			continue
		if not frappe.db.exists(dt, name):
			frappe.get_doc({"doctype": dt, "name": name, "__newname": name, **item["fields"], "script": new}).insert(ignore_permissions=True)
		else:
			current = _hash(frappe.db.get_value(dt, name, "script"))
			if current == _hash(new):
				pass
			elif current in item["replace_if_hash"]:
				doc = frappe.get_doc(dt, name)
				doc.script = new
				doc.save(ignore_permissions=True)
			else:
				frappe.log_error(
					title=f"Nexlify: {dt} not updated",
					message=f"{dt} '{name}' was changed on this site, so the app did not replace it. "
					f"The app's version is in nexlify_budget_control/setup/{item['file']}.")
		applied.add(key)
		changed = True
	if changed:
		frappe.db.set_default("nexlify_script_updates", frappe.as_json(sorted(applied)))


# Operational documents lose the year in their name. Financial ones (Sales / Purchase Invoice,
# Payment Entry, Journal Entry) keep it, for the accountants and ZATCA.
NAMING_RULES_WITHOUT_YEAR = ("Project", "Opportunity", "Project Cost Budget", "Sales Order", "Material Request", "Expense Claim", "Payment Entry")


def drop_year_from_naming_rules_once():
	"""Removes .YYYY.- from the Document Naming Rules of operational documents, once per rule and only
	when the rule still has the original prefix. Counters continue; existing documents keep their names."""
	applied = set(frappe.parse_json(frappe.db.get_default("nexlify_naming_rules_without_year") or "[]"))
	changed = False
	for r in frappe.get_all("Document Naming Rule", filters={"document_type": ["in", NAMING_RULES_WITHOUT_YEAR]},
			fields=["name", "document_type", "prefix"]):
		if r.name in applied:
			continue
		if ".YYYY.-" in (r.prefix or ""):
			frappe.db.set_value("Document Naming Rule", r.name, "prefix", r.prefix.replace(".YYYY.-", ""))
		applied.add(r.name)
		changed = True
	if changed:
		frappe.db.set_default("nexlify_naming_rules_without_year", frappe.as_json(sorted(applied)))


def seed_locations_from_data_once():
	"""Every location already used in an Opportunity or a Project gets a Project Location record,
	so the Link fields point to real records after the Select to Link change. Once per site."""
	if frappe.db.get_default("nexlify_locations_from_data") or not frappe.db.exists("DocType", "Project Location"):
		return
	for dt in ("Opportunity", "Project"):
		if not frappe.db.has_column(dt, "custom_location"):
			continue
		for (value,) in frappe.db.sql(f"select distinct custom_location from `tab{dt}` where ifnull(custom_location, '') != ''"):
			if not frappe.db.exists("Project Location", value):
				frappe.get_doc({"doctype": "Project Location", "location_name": value}).insert(ignore_permissions=True)
	frappe.db.set_default("nexlify_locations_from_data", "1")


def copy_location_to_link_once():
	"""The old Select value of custom_location goes to the new Link field custom_project_location. Once per site."""
	if frappe.db.get_default("nexlify_location_copied"):
		return
	for dt in ("Opportunity", "Project"):
		if frappe.db.has_column(dt, "custom_location") and frappe.db.has_column(dt, "custom_project_location"):
			frappe.db.sql(f"""update `tab{dt}` set custom_project_location = custom_location
				where ifnull(custom_project_location, '') = '' and ifnull(custom_location, '') != ''""")
	frappe.db.set_default("nexlify_location_copied", "1")


def project_dates_from_estimation_once():
	"""Projects that became Active before plans existed get their Estimation period as the project's
	Expected Start / End Date, so cost control (which uses the project dates) keeps working. Once per site."""
	if frappe.db.get_default("nexlify_project_dates_from_estimation"):
		return
	missing = []
	for p in frappe.get_all("Project", filters={"is_active": "Yes"}, fields=["name", "expected_start_date", "expected_end_date"]):
		if frappe.db.exists("Project Planning", {"project": p.name, "docstatus": 1}):
			continue
		if p.expected_start_date and p.expected_end_date:
			continue
		cb = frappe.db.sql("""select from_date, to_date from `tabProject Cost Budget`
			where project = %s and docstatus = 1 order by modified desc limit 1""", p.name, as_dict=True)
		cb = cb[0] if cb else None
		if cb and cb.from_date and cb.to_date:
			frappe.db.set_value("Project", p.name, {"expected_start_date": cb.from_date, "expected_end_date": cb.to_date}, update_modified=False)
		else:
			missing.append(p.name)
	if missing:
		frappe.log_error(title="Nexlify: active projects without a period",
			message="These Active projects have no plan and no submitted Estimation dates: " + ", ".join(missing))
	frappe.db.set_default("nexlify_project_dates_from_estimation", "1")
