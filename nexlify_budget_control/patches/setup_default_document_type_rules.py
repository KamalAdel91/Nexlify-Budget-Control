import frappe

DOCUMENT_TYPES = [
    "Material Request", "Purchase Order", "Purchase Invoice", "Journal Entry",
    "Expense Claim", "Payment Entry", "Landed Cost Voucher", "Stock Entry",
    "Asset Depreciation",
]


def execute():
    """
    Populates the Project Budget Settings singleton with one row per
    supported document type, defaulting to enabled=1, action=Stop
    (maximum protection until someone reconfigures it). Idempotent -
    only adds rows that don't already exist, safe to re-run.
    """
    settings = frappe.get_single("Project Budget Settings")
    existing = {r.document_type for r in settings.document_rules}
    changed = False
    for dt in DOCUMENT_TYPES:
        if dt not in existing:
            settings.append("document_rules", {
                "document_type": dt,
                "enabled": 1,
                "action": "Stop",
            })
            changed = True
    if changed:
        settings.save(ignore_permissions=True)
