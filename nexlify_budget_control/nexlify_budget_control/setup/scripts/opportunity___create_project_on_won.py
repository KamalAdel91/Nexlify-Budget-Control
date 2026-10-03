# Check if the stage is updated to 'Closed Won'
if doc.sales_stage == "Closed Won":

    # Closed Won needs the Estimation sent to Sales (checked only when the stage changes to Closed Won)
    if doc.has_value_changed("sales_stage") and doc.custom_estimation_status != "Sent to Sales":
        frappe.throw("The Opportunity can be Closed Won only after its Estimation is sent to Sales.")
    
    # 1. Backend Validation: Secure database against empty values
    if not doc.custom_closing_date:
        frappe.throw("Please enter the <b>Closing Date</b> before setting the stage to Closed Won.")

    if not doc.custom_signed_contract:
        frappe.throw("Please attach the <b>Signed Contract</b> before setting the stage to Closed Won.")

    if not doc.custom_region:
        frappe.throw("Please select the <b>Region</b> before setting the stage to Closed Won.")

    if not doc.custom_project_type:
        frappe.throw("Please select the <b>Project Type</b> before setting the stage to Closed Won.")

    if doc.custom_project_type == "Maintenance" and not doc.custom_maintenance_type:
        frappe.throw("Please select the <b>Maintenance Type</b> before setting the stage to Closed Won.")

    if not doc.opportunity_amount or doc.opportunity_amount <= 0:
        frappe.throw("Please enter an <b>Opportunity Amount</b> greater than zero before setting the stage to Closed Won.")
        
    # 2. Safety Check: Verify a project hasn't been linked yet to prevent duplication
    if not doc.custom_project:
        
        # 3. Formulate and structure the new Project payload
        project = frappe.get_doc({
            "doctype": "Project",
            "is_active": "No",
            "custom_opportunity": doc.name,
        })
        
        # 4. Push and commit the project into the database
        project.insert(ignore_permissions=True)
        
        # 5. Lock execution: Link the newly created project back to the custom_project field
        # Using db_set since this runs in After Save - doc.custom_project alone
        # only updates the in-memory object, it does NOT persist to the database.
        frappe.db.set_value(doc.doctype, doc.name, "custom_project", project.name)
        doc.custom_project = project.name  # keep in-memory doc in sync too

        # 6. The Plan opens when the Estimation team hands the project over to Planning.
        frappe.msgprint(f"Success: A new project has been created: <b>{project.project_name}</b>. The Estimation is back with the Estimation team for the Contract Review.")
