import frappe


def execute():
    """New Estimations use EST instead of CB. Only changes names that still use CB; old documents keep their names."""
    for r in frappe.get_all("Document Naming Rule", filters={"document_type": "Project Estimation"}, fields=["name", "prefix"]):
        if "-CB-" in (r.prefix or ""):
            frappe.db.set_value("Document Naming Rule", r.name, {"prefix": r.prefix.replace("-CB-", "-EST-"), "counter": 0})
    for ps in frappe.get_all("Property Setter", filters={"doc_type": "Project Estimation", "field_name": "naming_series",
                                                          "property": "options"}, fields=["name", "value"]):
        if "-CB-" in (ps.value or ""):
            frappe.db.set_value("Property Setter", ps.name, "value", ".ABBR.-EST-.####")
