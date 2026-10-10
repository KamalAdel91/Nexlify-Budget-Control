// Project Life: who a tracked document waits on and since when, and a button to its project's life,
// also on the Opportunity and the Project.
(() => {
	const METHOD = "nexlify_budget_control.nexlify_budget_control.project_life.get_project_life";
	const LIFE_FOR = "nexlify_budget_control.nexlify_budget_control.project_life.get_life_for";
	const open_life = (frm, life) => frm.add_custom_button(__("Project Life"), () => frappe.set_route("Form", "Project Life", life));

	["Project Estimation", "Supply Request", "Project Planning", "Project Overview", "Project Invoicing"].forEach((doctype) => {
		frappe.ui.form.on(doctype, {
			refresh(frm) {
				if (frm.is_new()) return;
				const name = frm.doc.name;
				frappe.xcall(METHOD, { doctype: frm.doctype, name }).then((r) => {
					if (!r || frm.doc.name !== name) return;
					if (r.is_open) {
						const days = Math.floor(moment().diff(moment(r.entered_on), "hours") / 24);
						const since = frappe.datetime.str_to_user(r.entered_on);
						frm.dashboard.set_headline_alert(days
							? __("{0}: waiting on {1} for {2} days, since {3}", [__(r.stage), r.waiting_on, days, since])
							: __("{0}: waiting on {1} since {2}", [__(r.stage), r.waiting_on, since]), "blue");
					}
					if (r.life && frappe.model.can_read("Project Life")) open_life(frm, r.life);
				});
			},
		});
	});

	["Opportunity", "Project"].forEach((doctype) => {
		frappe.ui.form.on(doctype, {
			refresh(frm) {
				if (frm.is_new() || !frappe.model.can_read("Project Life")) return;
				const name = frm.doc.name;
				frappe.xcall(LIFE_FOR, { doctype: frm.doctype, name }).then((life) => {
					if (life && frm.doc.name === name) open_life(frm, life);
				});
			},
		});
	});
})();
