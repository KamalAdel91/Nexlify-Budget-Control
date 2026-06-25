import frappe


def execute():
    """
    Migrates the company field from Budget Category (parent) to
    Budget Category Account (child table rows), since company was
    moved from the parent doctype to the child table.
    Only updates rows where company is NULL or empty.
    """
    categories = frappe.db.sql("""
        SELECT name, company FROM `tabBudget Category`
    """, as_dict=True)

    for cat in categories:
        if not cat.company:
            continue

        frappe.db.sql("""
            UPDATE `tabBudget Category Account`
            SET company = %(company)s
            WHERE parent = %(parent)s
                AND (company IS NULL OR company = '')
        """, {"company": cat.company, "parent": cat.name})

    frappe.db.commit()