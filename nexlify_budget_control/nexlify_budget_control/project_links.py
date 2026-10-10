"""Project on the documents made before their Project exists.

Once the Project is set on the Estimation, its Supply Requests and Equipment Scopes (project fetch_from the
Estimation) take it, and so do the Hand-off Log rows of every tracked document. fetch_from only fills a field when its
own document is saved, and these are not saved again when the Project comes, so the fetch is refreshed here: the
Estimation stays the only source. Runs after a Project is made or saved, after an Estimation is saved, and in the
Hand-off sync every 15 minutes."""

import frappe

# (document, its link to the Estimation): its project is fetch_from <link>.project
FROM_ESTIMATION = (("Supply Request", "estimation"), ("Project Equipment Scope", "cost_budget"))


def sync_project_links(doc=None, method=None):
	"""doc: a Project or an Estimation narrows the documents refreshed; none (sync, bench execute) does them all."""
	from nexlify_budget_control.nexlify_budget_control.hand_off import LOG, TRACKED

	narrow, values = "", {}
	if doc is not None and doc.doctype == "Project":
		narrow, values = " and e.project = %(project)s", {"project": doc.name}
	elif doc is not None and doc.doctype == "Project Estimation":
		narrow, values = " and e.name = %(estimation)s", {"estimation": doc.name}
	for doctype, link in FROM_ESTIMATION:
		frappe.db.sql(f"""update `tab{doctype}` d join `tabProject Estimation` e on e.name = d.`{link}`
			set d.project = e.project
			where ifnull(e.project, '') != '' and ifnull(d.project, '') != e.project{narrow}""", values)
	# Supplier Quotation: each line takes the Project of its Supply Request; the quotation takes it when all its lines
	# are of one Project (one quotation may cover several Supply Requests, of several Projects)
	frappe.db.sql("""update `tabSupplier Quotation Item` i join `tabSupply Request` sr on sr.name = i.custom_supply_request
		set i.project = sr.project
		where ifnull(sr.project, '') != '' and ifnull(i.project, '') != sr.project""")
	frappe.db.sql("""update `tabSupplier Quotation` sq join (
			select parent, min(project) project, count(distinct project) projects from `tabSupplier Quotation Item`
			where ifnull(project, '') != '' group by parent) x on x.parent = sq.name
		set sq.project = x.project
		where x.projects = 1 and ifnull(sq.project, '') != x.project""")
	for doctype in TRACKED:
		frappe.db.sql(f"""update `tab{LOG}` l join `tab{doctype}` d on d.name = l.reference_name
			set l.project = d.project
			where l.reference_doctype = %(doctype)s and ifnull(d.project, '') != '' and ifnull(l.project, '') != d.project""",
			{"doctype": doctype})


def fill_supplier_quotation(doc, method=None):
	"""Supplier Quotation validate: the Project of each line from its Supply Request, and the quotation's when all its
	lines are of one Project. Lines without a Supply Request keep what was typed."""
	for item in doc.items:
		if item.get("custom_supply_request"):
			project = frappe.db.get_value("Supply Request", item.custom_supply_request, "project")
			if project:
				item.project = project
	projects = {item.project for item in doc.items if item.get("project")}
	if len(projects) == 1:
		doc.project = projects.pop()
