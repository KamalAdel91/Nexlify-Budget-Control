import frappe
from frappe import _

MANPOWER_CATEGORIES = ["Engineer", "Technician", "Safety", "Driver", "Supervisor", "Labor"]


def seed_manpower_categories():
    """Runs once per site; later renames, deletes and additions from the UI are kept."""
    if not frappe.db.table_exists("Manpower Category"):
        return
    if frappe.db.get_default("nexlify_manpower_categories_seeded") or frappe.db.count("Manpower Category"):
        frappe.db.set_default("nexlify_manpower_categories_seeded", 1)
        return
    for name in MANPOWER_CATEGORIES:
        if not frappe.db.exists("Manpower Category", name):
            frappe.get_doc({
                "doctype": "Manpower Category",
                "category_name": name,
                "enabled": 1,
            }).insert(ignore_permissions=True)
    frappe.db.set_default("nexlify_manpower_categories_seeded", 1)


def validate_designation(doc, method=None):
    if doc.get("is_project_site_designation") != "Yes":
        doc.manpower_category = None
        return
    if not doc.get("manpower_category"):
        frappe.throw(
            _("Manpower Category is required for Project / Site designations."),
            title=_("Missing Manpower Category"),
        )


@frappe.whitelist()
def convert_project_site_flag(dry_run=1):
	"""Once per site, after Is Project Site Designation became Yes / No: the old 1 / 0 become Yes / No.
	dry_run=1 only counts. Goes to the Cleanup list once every site has run it."""
	from frappe.utils import cint

	frappe.only_for("System Manager")
	rows = frappe.db.sql("""select is_project_site_designation as v, count(*) as n from `tabDesignation`
		where is_project_site_designation in ('0', '1') group by is_project_site_designation""", as_dict=True)
	if not cint(dry_run):
		frappe.db.sql("""update `tabDesignation` set is_project_site_designation =
			if(is_project_site_designation = '1', 'Yes', 'No') where is_project_site_designation in ('0', '1')""")
		frappe.db.commit()
	return {"1 -> Yes" if r.v == "1" else "0 -> No": r.n for r in rows}
