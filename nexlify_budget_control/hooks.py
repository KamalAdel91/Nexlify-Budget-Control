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
	{
		"dt": "Role",
		"filters": [
			[
				"name",
				"in",
				[
					"Estimation User",
					"Estimation Manager",
					"Planning User",
					"Planning Manager",
					"O&M Manager",
					"COO",
					"CEO"
				]
			]
		]
	},
	{
		"dt": "Custom Field",
		"or_filters": [
			[
				"module",
				"=",
				"Nexlify Budget Control"
			],
			[
				"name",
				"in",
				[
					"Project-custom_budget_cost",
					"Project-custom_planned_revenue",
					"Project-custom_opportunity",
					"Project-custom_project_planning",
					"Project-custom_project_overview",
					"Project-custom_region",
					"Project-custom_maintenance_nature",
					"Project-custom_section_break_muryd",
					"Project-custom_column_break_59yog",
					"Project-custom_column_break_dyzps",
					"Project-custom_column_break_vbwaw",
					"Opportunity-custom_region",
					"Opportunity-custom_maintenance_nature",
					"Opportunity-custom_maintenance_type",
					"Opportunity-custom_project_type",
					"Opportunity-custom_location",
					"Project-custom_location",
					"Opportunity-custom_project_location",
					"Project-custom_project_location"
				]
			]
		]
	},
	{
		"dt": "Property Setter",
		"filters": [
			[
				"module",
				"=",
				"Nexlify Budget Control"
			]
		]
	},
	{
		"dt": "Workflow State",
		"filters": [
			[
				"name",
				"in",
				[
					"Draft",
					"Pending Approval",
					"In Planning",
					"Pending COO Approval",
					"Pending CEO Approval",
					"Approved"
				]
			]
		]
	},
	{
		"dt": "Workflow Action Master",
		"filters": [
			[
				"name",
				"in",
				[
					"Send for Approval",
					"Approve",
					"Return to Planning",
					"Return to COO"
				]
			]
		]
	},
	{
		"dt": "Workflow",
		"filters": [
			[
				"name",
				"in",
				[
					"Project Overview Approval",
					"Project Planning Approval"
				]
			]
		]
	}
]

after_migrate = [
	"nexlify_budget_control.nexlify_budget_control.setup_permissions.ensure_app_role_permissions",
	"nexlify_budget_control.nexlify_budget_control.setup_permissions.grant_link_select_permissions",
	"nexlify_budget_control.nexlify_budget_control.setup_permissions.merge_standard_into_custom_perms",
	"nexlify_budget_control.nexlify_budget_control.setup.seed.seed_master_data",
	"nexlify_budget_control.nexlify_budget_control.setup.seed.update_scripts_once",
	"nexlify_budget_control.nexlify_budget_control.setup.seed.drop_year_from_naming_rules_once",
	"nexlify_budget_control.nexlify_budget_control.setup.seed.seed_locations_from_data_once",
	"nexlify_budget_control.nexlify_budget_control.setup.seed.copy_location_to_link_once",
]

auto_cancel_exempted_doctypes = [
	"Project Planning",
	"Project Planning Scope",
	"Project Equipment Scope",
]

after_install = [
	"nexlify_budget_control.nexlify_budget_control.setup_permissions.grant_link_select_permissions",
	"nexlify_budget_control.nexlify_budget_control.setup.seed.seed_master_data",
]
