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
    "Opportunity": {
        "validate": [
            "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.set_locations_summary",
            "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.claim_signed_contract",
            "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.validate_project_type",
            "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.validate_rfq_lock",
            "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.validate_closed_lock",
        ],
        "on_update": ["nexlify_budget_control.nexlify_budget_control.opportunity_rfq.refresh_fetches", "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.on_opportunity_won"],
    },
    "Designation": {
        "validate": "nexlify_budget_control.nexlify_budget_control.designation_manpower.validate_designation",
    },
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
	"Project Estimation": {
		"on_submit": ["nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_estimation_submit", "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.on_estimation_submit"],
		"on_cancel": ["nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_estimation_cancel", "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.on_estimation_cancel"],
		"on_update": ["nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_estimation_update", "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.refresh_fetches", "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.share_signed_contract"],
		"on_update_after_submit": ["nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_estimation_update", "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.refresh_fetches", "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.share_signed_contract"]
	},
	"Project Planning": {
		"on_submit": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_planning_submit",
		"on_cancel": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.on_project_planning_cancel"
	},
	"Project": {
		"after_insert": "nexlify_budget_control.nexlify_budget_control.opportunity_rfq.link_estimation_to_new_project",
		"validate": "nexlify_budget_control.nexlify_budget_control.budget_enforcement.validate_project_dates",
		"on_update": "nexlify_budget_control.nexlify_budget_control.project_sync.on_project_update"
	}
}

app_include_css = ["/assets/nexlify_budget_control/css/nexlify_budget_control.css"]

app_include_js = [
	"/assets/nexlify_budget_control/js/manpower_order.js",
	"/assets/nexlify_budget_control/js/global_project_filter.js",
	"/assets/nexlify_budget_control/js/disable_project_cost_center_autofetch.js"]

doctype_js = {
        "Opportunity": "public/js/opportunity_rfq.js",
        "Material Request": "public/js/budget_check.js",
        "Purchase Order": "public/js/budget_check.js",
        "Purchase Invoice": "public/js/budget_check.js",
        "Journal Entry": "public/js/budget_check.js",
        "Expense Claim": "public/js/budget_check.js",
        "Project": "public/js/project.js",
        "Project Estimation": "public/js/project_estimation.js",
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
					"Project-custom_section_break_muryd",
					"Project-custom_column_break_59yog",
					"Project-custom_column_break_dyzps",
					"Project-custom_column_break_vbwaw",
					"Opportunity-custom_region",
					"Opportunity-custom_maintenance_type",
					"Opportunity-custom_project_type",
					"Project-custom_maintenance_type",
					"Project-custom_section_break_7pnjy",
					"Opportunity-custom_signed_contract",
					"Opportunity-custom_project_locations",
					"Opportunity-custom_locations_summary",
					"Project-custom_project_locations",
					"Project-custom_customer_name",
					"Opportunity-custom_section_break_4inur",
					"Opportunity-custom_project_details_section",
					"Opportunity-custom_project_details_cb1",
					"Opportunity-custom_project_details_cb2",
            "Designation-is_project_site_designation",
            "Designation-manpower_category",
            "Opportunity-custom_rfq_tab",
            "Opportunity-custom_estimation_status",
            "Opportunity-custom_estimation",
            "Opportunity-custom_rfq_actions_html",
            "Opportunity-custom_rfq_items",
            "Opportunity-custom_estimation_section",
            "Opportunity-custom_estimation_html",
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
					"Approved", "Sent to Sales", "Contract Review", "Handed Over", "Cancelled"
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
					"Return to COO", "Send to Sales", "Request Revision", "Receive Contract", "Resume Contract Review", "Handover to Planning", "Cancel"
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
					"Project Planning Approval", "Project Estimation Workflow"
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
    "nexlify_budget_control.nexlify_budget_control.designation_manpower.seed_manpower_categories",
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

boot_session = "nexlify_budget_control.nexlify_budget_control.manpower.boot_session"

override_doctype_dashboards = {
    "Opportunity": "nexlify_budget_control.nexlify_budget_control.dashboards.opportunity_dashboard",
    "Project": "nexlify_budget_control.nexlify_budget_control.dashboards.project_dashboard",
}
