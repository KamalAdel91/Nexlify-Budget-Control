frappe.listview_settings["Project Life"] = {
	add_fields: ["open_stages", "waiting_on", "current_stage", "outcome"],
	get_indicator(doc) {
		if (doc.outcome === "Lost") return [__("Lost"), "red", "outcome,=,Lost"];
		const team = (doc.waiting_on || "").split(", ").map((r) => r.replace(/ (Manager|User)$/, "")).join(", ");
		return cint(doc.open_stages)
			? [__("Waiting on {0}", [team]), "orange", "open_stages,>,0"]
			: [__("No one waiting"), "gray", "open_stages,=,0"];
	},
};
