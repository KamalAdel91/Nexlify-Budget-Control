import frappe


def execute():
	"""Document Type Rule.document_type is a Link now: rows naming a document the budget is never checked on
	(Asset Depreciation, which is not a DocType; Landed Cost Voucher, whose ledger rows carry its receipts' names)
	promised a control that did not exist, and go."""
	from nexlify_budget_control.nexlify_budget_control.constants import COMMITMENT_DOCTYPES, GL_DOCTYPES

	checked = list(COMMITMENT_DOCTYPES) + list(GL_DOCTYPES)
	frappe.db.delete("Document Type Rule", {"parent": "Project Budget Settings", "document_type": ["not in", checked]})
