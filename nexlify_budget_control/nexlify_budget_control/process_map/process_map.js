// The drawing is public/js/process_map.js, shared with the Project Life form.
const METHOD = "nexlify_budget_control.nexlify_budget_control.process_map.process_map.get_process_map";
const pm_root = root_element.querySelector(".pm");
frappe
	.xcall(METHOD, { workspace: (frappe.get_route() || []).slice(-1)[0] || "" })
	.then((data) => window.nexlify_process_map.render(pm_root, data, { route: frappe.get_route() || [] }))
	.catch(() => {
		pm_root.innerHTML = `<div class="pm-loading">Couldn't load the business process.</div>`;
	});
