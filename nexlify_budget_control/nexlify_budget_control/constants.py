"""
constants.py
-------------
Centralized constants and default values for Nexlify Budget Control.
Avoids magic numbers/strings scattered across the codebase.
"""

# ---------------------------------------------------------------------------
# Default thresholds
# ---------------------------------------------------------------------------

DEFAULT_WARNING_THRESHOLD_PERCENT = 80.0

# ---------------------------------------------------------------------------
# Action values
# ---------------------------------------------------------------------------

ACTION_NONE = "None"
ACTION_WARN = "Warn"
ACTION_STOP = "Stop"

VALID_ACTIONS = [ACTION_NONE, ACTION_WARN, ACTION_STOP]

# ---------------------------------------------------------------------------
# Budget types
# ---------------------------------------------------------------------------

BUDGET_TYPE_COST = "Cost"
BUDGET_TYPE_REVENUE = "Revenue"

# ---------------------------------------------------------------------------
# Trigger stages
# ---------------------------------------------------------------------------

STAGE_MATERIAL_REQUEST = "material_request"
STAGE_PURCHASE_ORDER = "purchase_order"
STAGE_ACTUAL = "actual"

VALID_STAGES = [STAGE_MATERIAL_REQUEST, STAGE_PURCHASE_ORDER, STAGE_ACTUAL]

# ---------------------------------------------------------------------------
# Applicable fields per stage
# ---------------------------------------------------------------------------

APPLICABLE_FIELD_MAP = {
    STAGE_MATERIAL_REQUEST: "applicable_on_material_request",
    STAGE_PURCHASE_ORDER: "applicable_on_purchase_order",
    STAGE_ACTUAL: "applicable_on_booking_actual_expenses",
}

# ---------------------------------------------------------------------------
# Action field mappings
# ---------------------------------------------------------------------------

ANNUAL_ACTION_MAP = {
    (STAGE_ACTUAL,): "action_if_annual_exceeded",
    (STAGE_MATERIAL_REQUEST,): "action_if_annual_exceeded_on_mr",
    (STAGE_PURCHASE_ORDER,): "action_if_annual_exceeded_on_po",
}

MONTHLY_ACTION_MAP = {
    (STAGE_ACTUAL,): "action_if_monthly_exceeded",
    (STAGE_MATERIAL_REQUEST,): "action_if_monthly_exceeded_on_mr",
    (STAGE_PURCHASE_ORDER,): "action_if_monthly_exceeded_on_po",
}

# ---------------------------------------------------------------------------
# Document pagination
# ---------------------------------------------------------------------------

DEFAULT_PAGE_SIZE = 5

# ---------------------------------------------------------------------------
# Month ordering (for monthly distribution)
# ---------------------------------------------------------------------------

MONTH_ORDER = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]

# ---------------------------------------------------------------------------
# Notification defaults
# ---------------------------------------------------------------------------

NOTIFICATION_MAX_SUBJECT_LENGTH = 140
NOTIFICATION_TYPE_ALERT = "Alert"