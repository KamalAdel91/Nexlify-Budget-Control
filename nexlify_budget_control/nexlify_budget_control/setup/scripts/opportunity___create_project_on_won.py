# Check if the stage is updated to 'Closed Won'
if doc.sales_stage == "Closed Won":
    
    # 1. Backend Validation: Secure database against empty values
    if not doc.custom_closing_date:
        frappe.throw("Please enter the <b>Closing Date</b> before setting the stage to Closed Won.")

    if not doc.custom_maintenance_nature:
        frappe.throw("Please select the <b>Maintenance Nature</b> before setting the stage to Closed Won.")

    if not doc.custom_region:
        frappe.throw("Please select the <b>Region</b> before setting the stage to Closed Won.")

    if not doc.custom_project_type:
        frappe.throw("Please select the <b>Project Type</b> before setting the stage to Closed Won.")

    if not doc.opportunity_amount or doc.opportunity_amount <= 0:
        frappe.throw("Please enter an <b>Opportunity Amount</b> greater than zero before setting the stage to Closed Won.")
        
    # 2. Safety Check: Verify a project hasn't been linked yet to prevent duplication
    if not doc.custom_project:
        
        # 3. Formulate and structure the new Project payload
        project = frappe.get_doc({
            "doctype": "Project",
            "project_name": doc.custom_opportunity_name or doc.title or doc.name,
            "company": doc.company,
            "is_active": "No",
            "customer": doc.party_name if doc.opportunity_from == "Customer" else None,
            "expected_start_date": doc.custom_closing_date,
            "custom_opportunity": doc.name,
            "custom_location": doc.custom_location,
            "project_type": doc.custom_project_type,
        })
        
        # 4. Push and commit the project into the database
        project.insert(ignore_permissions=True)
        
        # 5. Lock execution: Link the newly created project back to the custom_project field
        # Using db_set since this runs in After Save - doc.custom_project alone
        # only updates the in-memory object, it does NOT persist to the database.
        frappe.db.set_value(doc.doctype, doc.name, "custom_project", project.name)
        doc.custom_project = project.name  # keep in-memory doc in sync too
        
        # 6. Inform user of execution completion
        frappe.msgprint(f"Success: A new project has been created starting on {doc.custom_closing_date}: <b>{project.project_name}</b>")
