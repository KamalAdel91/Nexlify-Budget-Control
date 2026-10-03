from frappe import _


def opportunity_dashboard(data):
    """Connections of the Opportunity: its Estimation (the Project link is already there)."""
    data["transactions"].append({"label": _("Estimation"), "items": ["Project Estimation"]})
    return data


def project_dashboard(data):
    """Connections of the Project: everything Nexlify builds on it (the Opportunity link is already there)."""
    data["transactions"].append({"label": _("Nexlify"), "items": [
        "Project Estimation", "Project Planning", "Project Overview", "Project Visits", "Project Invoicing"]})
    return data
