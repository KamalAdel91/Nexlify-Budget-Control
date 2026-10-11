if doc.has_value_changed("sales_stage"):
    # Closed Won needs the contract agreed by the Estimation team: checked in opportunity_rfq.validate_won_ready
    if doc.sales_stage == "Closed Won":
        doc.status = "Closed"
    elif doc.sales_stage == "Closed Lost":
        doc.status = "Lost"
