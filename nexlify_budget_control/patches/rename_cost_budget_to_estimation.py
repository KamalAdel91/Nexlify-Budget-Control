import frappe

PAIRS = [('Project Cost Budget Rate', 'Project Estimation Rate'), ('Project Cost Budget Other Cost', 'Project Estimation Other Cost'), ('Project Cost Budget Accommodation', 'Project Estimation Accommodation'), ('Project Cost Budget Test Equipment', 'Project Estimation Test Equipment'), ('Project Cost Budget Transportation', 'Project Estimation Transportation'), ('Project Cost Budget Detail', 'Project Estimation Detail'), ('Project Cost Budget', 'Project Estimation')]


def execute():
    """Renames the Estimation DocTypes before the DocType files are synced. Tables and data are kept."""
    for old, new in PAIRS:
        if frappe.db.exists("DocType", old) and not frappe.db.exists("DocType", new):
            frappe.rename_doc("DocType", old, new, force=True)
