import frappe

from nexlify_budget_control.nexlify_budget_control.project_sync import sync_linked_documents


def execute():
	changed = sync_linked_documents()
	if changed:
		print(f"synced company/customer from Project on {len(changed)} document(s)")
