"""The Project Estimation Workflow in one place: the actions the code applies, and the states grouped by the action
that reaches or leaves them, read from the Workflow, so no state name is written in code."""
import frappe

WORKFLOW = "Project Estimation Workflow"

SEND_TO_SALES = "Send to Sales"
SEND_FOR_APPROVAL = "Send for Approval"
APPROVE = "Approve"
RETURN = "Return to Estimation"
REQUEST_REVISION = "Request Revision"
SEND_CONTRACT = "Send Contract"
REQUEST_CHANGES = "Request Changes"
REPRICE = "Reprice"
ACCEPT_CONTRACT = "Accept Contract"
RECEIVE_SIGNED_CONTRACT = "Receive Signed Contract"
HANDOVER = "Handover to Planning"
MARK_LOST = "Mark Lost"
CANCEL = "Cancel"


def _wf():
	return frappe.get_cached_doc("Workflow", WORKFLOW)


def reached_by(action):
	"""The states an action leads to."""
	return {t.next_state for t in _wf().transitions if t.action == action}


def left_by(action):
	"""The states an action can be taken from."""
	return {t.state for t in _wf().transitions if t.action == action}


def draft():
	return left_by(SEND_TO_SALES)


def pending():
	"""Waiting for the COO or the CEO to approve the selling price."""
	return left_by(APPROVE)


def with_sales():
	return left_by(REQUEST_REVISION)


def contract_review():
	return reached_by(SEND_CONTRACT)


def changes_requested():
	return reached_by(REQUEST_CHANGES)


def agreed():
	"""The contract is agreed: Sales may now set Closed Won with the signed contract."""
	return reached_by(ACCEPT_CONTRACT)


def won():
	return reached_by(RECEIVE_SIGNED_CONTRACT)


def handed_over():
	return reached_by(HANDOVER)


def lost():
	return reached_by(MARK_LOST)


def price_locked():
	"""From the approval until the contract is agreed the prices cannot change; Reprice or a Return brings back Draft."""
	return pending() | with_sales() | contract_review() | changes_requested() | agreed()


def sales_visible():
	"""Sales sees the prices once they are approved."""
	return with_sales() | contract_review() | changes_requested() | agreed() | won() | handed_over()


def all_states():
	return {s.state for s in _wf().states}


def rfq_locked():
	"""Every state that keeps the RFQ with Estimation: all but a Draft cancelled back to Sales."""
	open_again = {s.state for s in _wf().states if s.state in reached_by(CANCEL) and str(s.doc_status) == "0"}
	return all_states() - open_again


GROUPS = {"draft": draft, "pending": pending, "with_sales": with_sales, "contract_review": contract_review,
	"changes_requested": changes_requested, "agreed": agreed, "won": won, "handed_over": handed_over, "lost": lost}


@frappe.whitelist()
def get_state_groups():
	"""For the forms: the state names in each group."""
	return {name: sorted(fn()) for name, fn in GROUPS.items()}
