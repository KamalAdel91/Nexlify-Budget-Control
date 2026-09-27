import re

import frappe

DT = "Project Estimation"


def execute():
    """Old Estimations move from -CB- to -EST- names; every Link follows. The series continues after the highest number."""
    skipped = []
    for old in frappe.get_all(DT, filters={"name": ["like", "%-CB-%"]}, pluck="name", order_by="creation asc"):
        new = old.replace("-CB-", "-EST-")
        if frappe.db.exists(DT, new):
            skipped.append(f"{old} -> {new}")
            continue
        frappe.rename_doc(DT, old, new, force=True, show_alert=False)

    top = 0
    for name in frappe.get_all(DT, pluck="name"):
        m = re.search(r"-EST-(\d+)", name)
        if m:
            top = max(top, int(m.group(1)))
    for r in frappe.get_all("Document Naming Rule", filters={"document_type": DT}, fields=["name", "counter"]):
        if (r.counter or 0) < top:
            frappe.db.set_value("Document Naming Rule", r.name, "counter", top)

    if skipped:
        frappe.log_error(title="Nexlify: Estimations not renamed", message="\n".join(skipped))
