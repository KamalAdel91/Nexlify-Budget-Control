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
        "Material Request": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_material_request_submit"
        },
        "Purchase Order": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_purchase_order_submit"
        },
        "Purchase Invoice": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_purchase_invoice_submit"
        },
    "Journal Entry": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_journal_entry_submit"
        },
        "Expense Claim": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_expense_claim_submit"
        },
        "Project Cost Budget": {
                "on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_cost_budget_submit",
                "on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_cost_budget_cancel"
        },
}

doctype_js = {
        "Material Request": "public/js/budget_check.js",
        "Purchase Order": "public/js/budget_check.js",
        "Purchase Invoice": "public/js/budget_check.js",
        "Journal Entry": "public/js/budget_check.js",
        "Expense Claim": "public/js/budget_check.js",
        "Project": ["public/js/budget_check.js", "public/js/project.js"],
}

fixtures = [
        {
                "doctype": "Custom Field",
                "filters": [
                        ["name", "in", [
                                "Projects Settings-enable_nexlify_budget_control",
                                "Projects Settings-budget_bypass_role",
                                "Project-custom_budget",
                                "Project-custom_budget_revenue",
                                "Project-custom_column_break_vy9se",
                                "Project-custom_budget_cost",
                                "Project-custom_section_break_rfux2",
                                "Project-custom_dashboard",
                        ]]
                ]
        }
]