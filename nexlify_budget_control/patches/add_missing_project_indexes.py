import frappe


def execute():
    """
    Adds missing database indexes on the `project` column for tables
    that are frequently queried in budget enforcement queries but lack
    an index. `tabPurchase Invoice Item` already has one and is skipped.
    Uses the raw database cursor to avoid API differences across Frappe versions.
    """
    # (doctype, table_name) pairs
    indexes = [
        ("Material Request Item", "tabMaterial Request Item"),
        ("Purchase Order Item", "tabPurchase Order Item"),
        ("Journal Entry Account", "tabJournal Entry Account"),
        ("Expense Claim Detail", "tabExpense Claim Detail"),
    ]

    for doctype, table in indexes:
        try:
            escaped_table = table.replace("`", "``")
            frappe.db.sql(
                f"ALTER TABLE `{escaped_table}` ADD INDEX `idx_{doctype.lower().replace(' ', '_')}_project` (`project`)",
            )
        except Exception:
            # Index may already exist - use a more careful approach
            try:
                frappe.db.add_index(doctype, ["project"], f"idx_{doctype.lower().replace(' ', '_')}_project")
            except Exception:
                pass  # Index already exists or cannot be created
