app_name = "nexlify_budget_control"
app_title = "Nexlify Budget Control"
app_publisher = "Kamal Adel"
app_description = "Nexlify Budget Control"
app_email = "Kamal.adel@outlook.com"
app_license = "mit"

# ---------------------------------------------------------------------------
# Document Events - Cost Budget Enforcement
# ---------------------------------------------------------------------------

doc_events = {
        "*": {
                "before_save": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.block_inactive_project_reference"
        },
        "Material Request": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_material_request_submit",
                "on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_material_request_cancel"
        },
        "Purchase Order": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_purchase_order_submit",
                "on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_purchase_order_cancel"
        },
        "Purchase Invoice": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_purchase_invoice_submit",
                "on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_purchase_invoice_cancel"
        },
    "Journal Entry": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_journal_entry_submit",
                "on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_journal_entry_cancel"
        },
        "Expense Claim": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_expense_claim_submit",
                "on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_expense_claim_cancel"
        },
        "Project Cost Budget": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_cost_budget_submit",
                "on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_cost_budget_cancel",
		"on_update": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_cost_budget_update",
		"on_update_after_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_cost_budget_update"
        },
        "Project Planning": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_planning_submit",
                "on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_planning_cancel"
        },
}

app_include_js = [
	"/assets/nexlify_budget_control/js/global_project_filter.js",
	"/assets/nexlify_budget_control/js/disable_project_cost_center_autofetch.js"]

doctype_js = {
        "Material Request": "public/js/budget_check.js",
        "Purchase Order": "public/js/budget_check.js",
        "Purchase Invoice": "public/js/budget_check.js",
        "Journal Entry": "public/js/budget_check.js",
        "Expense Claim": "public/js/budget_check.js",
        "Project": "public/js/project.js",
        "Project Cost Budget": "public/js/project_cost_budget.js",
}

fixtures = [
	{"dt": "Property Setter", "filters": [["module", "=", "Nexlify Budget Control"]]},
        {
                "doctype": "Custom Field",
                "filters": [
                        ["module", "=", "Nexlify Budget Control"]
                ]
        },
        {
                "doctype": "Number Card",
                "filters": [
                        ["module", "=", "Nexlify Budget Control"]
                ]
        },
        {
                "doctype": "Dashboard Chart",
                "filters": [
                        ["module", "=", "Nexlify Budget Control"]
                ]
        },
        {
                "doctype": "Role",
                "filters": [
                        ["name", "in", ["Estimation User", "Estimation Manager", "Planning User", "Planning Manager", "O&M Manager", "COO", "CEO"]]
                ]
        },
        {
                "doctype": "Workspace",
                "filters": [
                        ["name", "=", "Projexlify"]
                ]
        }
]

after_migrate = [
	"nexlify_budget_control.nexlify_budget_control.setup_permissions.ensure_app_role_permissions",
]

auto_cancel_exempted_doctypes = [
	"Project Planning",
	"Project Planning Scope",
	"Project Equipment Scope",
]
