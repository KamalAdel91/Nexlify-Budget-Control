# Check if the stage is updated to 'Closed Won'
if doc.sales_stage == "Closed Won":

    # Closed Won needs a submitted Estimation (checked only when the stage changes to Closed Won)
    if doc.has_value_changed("sales_stage") and doc.custom_estimation_status != "Estimated":
        frappe.throw("The Opportunity can be Closed Won only after its Estimation is submitted.")
    
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
            "custom_opportunity": doc.name,
            "custom_project_location": doc.custom_project_location,
            "project_type": doc.custom_project_type,
        })
        
        # 4. Push and commit the project into the database
        project.insert(ignore_permissions=True)
        
        # 5. Lock execution: Link the newly created project back to the custom_project field
        # Using db_set since this runs in After Save - doc.custom_project alone
        # only updates the in-memory object, it does NOT persist to the database.
        frappe.db.set_value(doc.doctype, doc.name, "custom_project", project.name)
        doc.custom_project = project.name  # keep in-memory doc in sync too

        # 6. Open the Plan for the Planning team, as the Create Plan button would.
        # Only when the project took the Opportunity's Estimation and has no plan yet.
        # The dates stay empty: the planner sets them when saving the plan.
        plan_name = None
        if frappe.db.get_value("Project", project.name, "custom_budget_cost") and not frappe.db.exists(
                "Project Planning", {"project": project.name, "docstatus": ["<", 2]}):
            plan = frappe.get_doc({"doctype": "Project Planning", "project": project.name, "company": doc.company})
            plan.insert(ignore_permissions=True, ignore_mandatory=True)
            plan_name = plan.name
        
        # 7. Inform user of execution completion
        if plan_name:
            frappe.msgprint(f"Success: A new project has been created: <b>{project.project_name}</b>, with its Plan <b>{plan_name}</b> for the Planning team.")
        else:
            frappe.msgprint(f"Success: A new project has been created: <b>{project.project_name}</b>")
