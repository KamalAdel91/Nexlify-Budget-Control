// ---------------------------------------------------------------------------
// Some ERPNext doctypes (via BuyingController) register an auto-fetch that
// pulls "cost_center" from the linked Project the moment a user picks a
// project on any form: frm.add_fetch("project", "cost_center", "cost_center").
// That fetch is stored under frm.fetch_dict["*"]["project"] (confirmed by
// direct inspection - NOT under frm.fetch_dict["project"]). At runtime it
// calls frappe.client.validate_link_and_fetch, which requires "read"
// permission on Project - meaning any user who just needs to select a
// project, with no other reason to see Project data, is forced to have
// Project read access.
//
// The server already fills cost_center from the project independently and
// safely (a direct DB read that bypasses permissions) at save/submit time,
// so removing this client-side auto-fetch does not break functionality -
// cost_center still ends up correct, it just is not shown live while
// editing.
// ---------------------------------------------------------------------------

frappe.ui.form.on("*", {
    onload: function (frm) {
        if (frm.fields_dict && frm.fields_dict.project) {
            frm.fields_dict.project.df.fetch_from = "";
        }
        if (frm.fetch_dict && frm.fetch_dict["*"] && frm.fetch_dict["*"]["project"]) {
            delete frm.fetch_dict["*"]["project"];
        }
    },
});
