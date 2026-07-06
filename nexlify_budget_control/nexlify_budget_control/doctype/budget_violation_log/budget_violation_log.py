"""
budget_violation_log.py
-----------------------
Doctype for recording budget violations during enforcement.
Inserted automatically by _finalize_violations before any
frappe.throw or frappe.msgprint call.
"""

from frappe.model.document import Document


class BudgetViolationLog(Document):
    # Child table / standalone - no special logic needed
    pass