// Project Life: the story of one project. Everything comes from its stages; what only time changes (the time so far
// of an open stage, an open stage past its due date) is worked out here when shown, never saved.
const PL_KIND = { "Project Estimation": "Estimation", "Supply Request": "Supply Request", "Project Planning": "Plan",
	"Project Overview": "Overview", "Project Invoicing": "Invoice" };
const pl_hours = (from, to) => Math.max(0, moment(to || undefined).diff(moment(from), "minutes") / 60);
const pl_span = (h) => {
	if (h < 1) return __("less than an hour");
	if (h < 24) return Math.floor(h) === 1 ? __("1 hour") : __("{0} hours", [Math.floor(h)]);
	return Math.floor(h / 24) === 1 ? __("1 day") : __("{0} days", [Math.floor(h / 24)]);
};
const pl_team = (roles) => (roles || "").split(", ").filter(Boolean).map((r) => r.replace(/ (Manager|User)$/, "")).join(", ");
const pl_day = (dt) => frappe.datetime.str_to_user(String(dt).slice(0, 10));

frappe.ui.form.on("Project Life", {
	refresh(frm) {
		frm.disable_save();
		const rows = frm.doc.stages || [];
		const past = (dt) => dt && moment(dt).isBefore(moment());
		let overdue = 0;
		rows.forEach((r) => {
			if (!r.is_open) return;
			r.duration_days = flt(pl_hours(r.entered_on) / 24, 2);
			if (past(r.due_on)) {
				r.is_late = 1;
				overdue += 1;
			}
		});
		frm.refresh_field("stages");

		const open = cint(frm.doc.open_stages);
		const cur = rows.find((r) => r.is_open && r.reference_doctype === frm.doc.current_doctype && r.reference_name === frm.doc.current_name);
		if (frm.doc.current_stage) {
			const kind = PL_KIND[frm.doc.current_doctype] || frm.doc.current_doctype;
			const dated = cur && cur.is_scheduled && cur.due_on;
			frm.dashboard.add_indicator(__("Now at: {0} · {1}", [__(kind), __(frm.doc.current_stage)]),
				!open ? "gray" : dated && !past(cur.due_on) ? "blue" : "orange");
			if (dated) {
				frm.dashboard.add_indicator(past(cur.due_on)
					? __("Was expected on {0}", [pl_day(cur.due_on)])
					: __("Expected on {0}", [pl_day(cur.due_on)]), past(cur.due_on) ? "red" : "blue");
			} else if (open && frm.doc.waiting_on) {
				frm.dashboard.add_indicator(__("Waiting on {0} for {1}", [pl_team(frm.doc.waiting_on), pl_span(pl_hours(frm.doc.waiting_since))]),
					cur && past(cur.due_on) ? "red" : "orange");
			}
		}
		if (open > 1) frm.dashboard.add_indicator(__("{0} stages open", [open]), "orange");
		if (frm.doc.started_on) {
			frm.dashboard.add_indicator(open
				? __("Started {0} ago", [pl_span(pl_hours(frm.doc.started_on))])
				: __("Took {0}", [pl_span(pl_hours(frm.doc.started_on, frm.doc.last_event_on))]), "blue");
		}
		const late = cint(frm.doc.late_stages) + overdue;
		frm.dashboard.add_indicator(late ? __("{0} late stages", [late]) : __("No late stages"), late ? "red" : "green");

		$(frm.wrapper).find(".pl-map, .pl-team-chart").closest(".form-dashboard-section").remove();
		frm.dashboard.add_section('<div class="pl-map"></div>', __("Where It Is in the Process"));

		const per_team = {};
		rows.forEach((r) => {
			if (r.waiting_on && !r.is_scheduled) {
				const t = pl_team(r.waiting_on);
				per_team[t] = (per_team[t] || 0) + flt(r.duration_days);
			}
		});
		const labels = Object.keys(per_team).sort((a, b) => per_team[b] - per_team[a]);
		if (labels.length) frm.dashboard.add_section('<div class="pl-team-chart"></div>', __("Days With Each Team"));
		frm.dashboard.show();

		const map = $(frm.wrapper).find(".pl-map")[0];
		if (map && window.nexlify_process_map) {
			const name = frm.doc.name;
			frappe.xcall("nexlify_budget_control.nexlify_budget_control.process_map.process_map.get_life_map", { life: name })
				.then((data) => {
					if (frm.doc.name === name) window.nexlify_process_map.render(map, data, {});
				});
		}
		const chart = $(frm.wrapper).find(".pl-team-chart")[0];
		if (chart) {
			new frappe.Chart(chart, {
				type: "bar",
				height: 220,
				data: { labels, datasets: [{ name: __("Days"), values: labels.map((l) => flt(per_team[l], 1)) }] },
				colors: ["#7C3AED"],
				valuesOverPoints: 1,
				barOptions: { spaceRatio: 0.5 },
			});
		}

		if (frm.doc.current_doctype && frm.doc.current_name) {
			frm.add_custom_button(__("Open {0}", [frm.doc.current_name]),
				() => frappe.set_route("Form", frm.doc.current_doctype, frm.doc.current_name));
		}
	},
});
