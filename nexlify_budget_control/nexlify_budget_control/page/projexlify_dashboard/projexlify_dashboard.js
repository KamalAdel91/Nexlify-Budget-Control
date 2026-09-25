frappe.pages["projexlify-dashboard"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Dashboard"), single_column: true });
	wrapper.nx_dashboard = new NexlifyCeoDashboard(page);
};

frappe.pages["projexlify-dashboard"].on_page_show = function (wrapper) {
	if (wrapper.nx_dashboard && wrapper.nx_dashboard.data) wrapper.nx_dashboard.refresh();
};

(function inject_nx_ceo_styles() {
	if (document.getElementById("nx-ceo-styles")) return;
	const style = document.createElement("style");
	style.id = "nx-ceo-styles";
	style.textContent = `
		.nx-ceo { max-width: 1240px; margin: 0 auto; padding: 4px 4px 40px; }
		.nx-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
		.nx-kpi { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 12px); padding: 14px 16px; min-width: 0; }
		.nx-kpi.nx-accent { border-color: var(--primary); }
		.nx-kpi-label { font-size: var(--text-sm); color: var(--text-muted); margin-bottom: 6px; }
		.nx-kpi-value { font-size: 22px; font-weight: 600; color: var(--heading-color); word-break: break-word; }
		.nx-kpi-sub { font-size: var(--text-xs); margin-top: 4px; color: var(--text-muted); }
		.nx-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
		.nx-sec-title { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: var(--text-md); font-weight: 600; color: var(--heading-color); margin: 22px 0 10px; }
		.nx-sec-title small { font-weight: 400; color: var(--text-muted); font-size: var(--text-xs); }
		.nx-box { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: var(--border-radius-lg, 12px); padding: 8px 16px; }
		.nx-row { display: grid; align-items: center; gap: 10px; padding: 9px 4px; border-bottom: 1px solid var(--border-color); font-size: var(--text-sm); color: var(--text-color); }
		.nx-row:last-child { border-bottom: none; }
		.nx-queue-row { grid-template-columns: minmax(0, 2.2fr) minmax(0, 1fr) 80px 100px; }
		.nx-attn-row { grid-template-columns: minmax(0, 1fr) auto; }
		.nx-head { color: var(--text-muted); font-size: var(--text-xs); }
		.nx-bar-row { display: grid; grid-template-columns: 150px 1fr 60px; gap: 10px; align-items: center; padding: 7px 4px; font-size: var(--text-sm); color: var(--text-color); border-radius: var(--border-radius); }
		.nx-track { height: 8px; border-radius: 4px; background: var(--control-bg); overflow: hidden; }
		.nx-fill { height: 100%; border-radius: 4px; }
		.nx-empty { color: var(--text-muted); font-size: var(--text-sm); padding: 14px 4px; }
		.nx-foot { font-size: var(--text-xs); color: var(--text-muted); padding: 8px 4px 4px; border-top: 1px solid var(--border-color); margin-top: 4px; }
		[data-open] { cursor: pointer; }
		[data-open]:hover { background: var(--subtle-fg, var(--control-bg)); }
		.nx-muted { color: var(--text-muted); } .nx-right { text-align: right; }
		.nx-ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		@media (max-width: 640px) {
			.nx-kpis { grid-template-columns: 1fr 1fr; }
			.nx-queue-row { grid-template-columns: minmax(0, 1fr) 100px; }
			.nx-hide-sm { display: none; }
			.nx-bar-row { grid-template-columns: 110px 1fr 50px; }
		}
	`;
	document.head.appendChild(style);
})();

class NexlifyCeoDashboard {
	constructor(page) {
		this.page = page;
		this.dynamic = [];
		this.$body = $(`<div class="nx-ceo"></div>`).appendTo(page.body);
		this.$body.on("click", "[data-open]", (e) => this.open($(e.currentTarget)));
		page.set_secondary_action(__("Refresh"), () => this.refresh(), "refresh");
		this.make_filters();
		this.refresh();
	}

	make_filters() {
		const change = () => this.refresh_soon();
		this.company = this.page.add_field({ fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", change });
		this.project = this.page.add_field({ fieldtype: "Link", fieldname: "project", label: __("Project"), options: "Project", change });
		frappe.call({ method: "nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_dashboard_filter_fields" })
			.then((r) => (r.message || []).forEach((f) => {
				const ctrl = this.page.add_field({
					fieldtype: f.link_doctype ? "Link" : "Data", options: f.link_doctype,
					fieldname: `nx_${f.target_field}`, label: __(f.label), change,
				});
				this.dynamic.push({ ctrl, target_field: f.target_field, source_doctype: f.source_doctype });
			}));
	}

	refresh_soon() {
		clearTimeout(this._timer);
		this._timer = setTimeout(() => this.refresh(), 300);
	}

	async refresh() {
		const token = (this._token = (this._token || 0) + 1);
		if (!this.data) this.$body.html(`<div class="nx-empty">${__("Loading…")}</div>`);
		const extra = this.dynamic.filter((d) => d.ctrl.get_value()).map((d) => ({
			target_field: d.target_field, source_doctype: d.source_doctype, value: d.ctrl.get_value(),
		}));
		try {
			const r = await frappe.call({
				method: "nexlify_budget_control.nexlify_budget_control.ceo_dashboard.get_ceo_dashboard_data",
				args: { company: this.company.get_value() || null, project: this.project.get_value() || null, extra_filters: JSON.stringify(extra) },
			});
			if (token !== this._token) return;
			this.data = r.message;
			this.render();
		} catch (e) {
			if (token === this._token) this.$body.html(`<div class="nx-empty">${__("Couldn't load the dashboard. Refresh to try again.")}</div>`);
		}
	}

	// ---------- helpers ----------
	esc(v) { return frappe.utils.escape_html(v == null ? "" : String(v)); }
	money(v) { return v == null ? "—" : format_currency(v, this.data.currency, 0); }
	pct(v) { return v == null ? "—" : `${(Math.round(v * 10) / 10).toLocaleString()}%`; }
	pct_color(p) { return p >= 100 ? "var(--red-500)" : p >= 80 ? "var(--orange-500)" : "var(--green-500)"; }
	margin_color(m) {
		const s = this.data.settings;
		if (m == null) return "var(--text-muted)";
		return m < s.low_margin_threshold ? "var(--red-500)" : m < s.target_margin_pct ? "var(--orange-500)" : "var(--green-500)";
	}
	link_attrs(doctype, name, filters) {
		return `data-open="1" data-doctype="${this.esc(doctype)}"` + (name ? ` data-name="${this.esc(name)}"` : "")
			+ (filters ? ` data-filters="${this.esc(JSON.stringify(filters))}"` : "");
	}
	open($el) {
		const t = $el.data();
		if (t.name) frappe.set_route("Form", t.doctype, t.name);
		else frappe.set_route("List", t.doctype, t.filters || {});
	}
	section(title, note, body) {
		return `<div class="nx-sec-title"><span>${title}</span>${note ? `<small>${note}</small>` : ""}</div>${body}`;
	}

	// ---------- render ----------
	render() {
		this.$body.html(`
			${this.render_kpis()}
			${this.render_queue()}
			<div class="nx-grid-2">
				<div>${this.render_stages()}</div>
				<div>${this.section(__("Revenue vs cost by month"), __("by plan start month"), `<div class="nx-box"><div class="nx-month-chart"></div></div>`)}</div>
			</div>
			<div class="nx-grid-2">
				<div>${this.render_budget()}</div>
				<div>${this.render_attention()}</div>
			</div>
		`);
		this.render_chart();
	}

	render_kpis() {
		const k = this.data.kpis, s = this.data.settings;
		const card = (label, value, sub, extra = "", value_style = "") => `
			<div class="nx-kpi ${extra}">
				<div class="nx-kpi-label">${label}</div>
				<div class="nx-kpi-value" style="${value_style}">${value}</div>
				<div class="nx-kpi-sub">${sub || "&nbsp;"}</div>
			</div>`;
		return `<div class="nx-kpis">
			${card(__("Contract value"), this.money(k.contract_value), __("{0} project(s)", [k.projects]))}
			${card(__("Planned cost"), this.money(k.planned_cost), __("from approved estimations"))}
			${card(__("Expected profit"), this.money(k.expected_profit), "", "", k.expected_profit < 0 ? "color: var(--red-500)" : "")}
			${card(__("Avg margin"), this.pct(k.margin_pct),
				`<span style="color:${this.margin_color(k.margin_pct)}">${__("Target {0}%", [s.target_margin_pct])}</span>`)}
			${card(__("Waiting for you"), k.waiting_for_me,
				k.waiting_for_me ? __("Oldest {0} day(s)", [k.oldest_wait_days]) : __("All clear"), "nx-accent",
				k.waiting_for_me ? "color: var(--primary)" : "")}
		</div>`;
	}

	render_queue() {
		const q = this.data.queue;
		const pill = (r) => {
			const color = r.overdue ? "red" : r.waiting_days > 0 ? "orange" : "gray";
			const text = r.waiting_days ? __("{0} day(s)", [r.waiting_days]) : __("Today");
			return `<span class="indicator-pill ${color}">${text}</span>`;
		};
		const body = !q.length
			? `<div class="nx-empty">${__("Nothing is waiting for your approval.")}</div>`
			: `<div class="nx-row nx-queue-row nx-head">
					<span>${__("Project")}</span><span class="nx-right nx-hide-sm">${__("Contract")}</span>
					<span class="nx-right nx-hide-sm">${__("Margin")}</span><span class="nx-right">${__("Waiting")}</span>
				</div>` + q.map((r) => `
				<div class="nx-row nx-queue-row" ${this.link_attrs("Project Overview", r.name)}>
					<span class="nx-ellipsis"><b>${this.esc(r.project)}</b> · ${this.esc(r.project_name)}
						<div class="nx-muted nx-ellipsis">${this.esc(r.customer || "")}${r.return_count ? ` · ${__("returned {0}x", [r.return_count])}` : ""}</div></span>
					<span class="nx-right nx-hide-sm">${this.money(r.contract_value)}</span>
					<span class="nx-right nx-hide-sm" style="color:${this.margin_color(r.margin_pct)}">${this.pct(r.margin_pct)}</span>
					<span class="nx-right">${pill(r)}</span>
				</div>`).join("");
		return this.section(__("Waiting for your approval"),
			__("{0} pending in total", [this.data.kpis.pending_total]), `<div class="nx-box">${body}</div>`);
	}

	render_stages() {
		const st = this.data.stages;
		const max = Math.max(1, ...st.map((s) => s.count));
		const last = st.length - 1;
		const rows = st.map((s, i) => {
			const color = i === 0 ? "var(--gray-500)" : i === 1 ? "var(--blue-500)" : i === last ? "var(--green-500)" : "var(--orange-500)";
			const attrs = i === 0 ? this.link_attrs("Project Cost Budget")
				: i === 1 ? this.link_attrs("Project Planning", null, { docstatus: 0 })
				: this.link_attrs("Project Overview", null, { workflow_state: s.stage });
			return `<div class="nx-bar-row" ${attrs}>
				<span class="nx-ellipsis">${this.esc(__(s.stage))}</span>
				<div class="nx-track" style="height: 14px;"><div class="nx-fill" style="width:${(s.count / max) * 100}%; background:${color};"></div></div>
				<span class="nx-right"><b>${s.count}</b></span>
			</div>`;
		}).join("");
		return this.section(__("Pipeline by stage"), "", `<div class="nx-box">${rows}</div>`);
	}

	render_chart() {
		const d = this.data, el = this.$body.find(".nx-month-chart")[0];
		const months = d.monthly.slice(-12);
		if (!months.length) {
			$(el).html(`<div class="nx-empty">${__("No approved or pending plans yet.")}</div>`);
			return;
		}
		const labels = months.map((m) => {
			const [y, mo] = m.month.split("-");
			return `${new Date(+y, +mo - 1, 1).toLocaleString(undefined, { month: "short" })} ${y.slice(2)}`;
		});
		const datasets = [];
		if (d.can_see_price) datasets.push({ name: __("Revenue"), values: months.map((m) => m.revenue || 0) });
		datasets.push({ name: __("Cost"), values: months.map((m) => m.cost || 0) });
		new frappe.Chart(el, {
			data: { labels, datasets }, type: "bar", height: 220,
			colors: d.can_see_price ? ["blue", "light-grey"] : ["light-grey"],
			barOptions: { spaceRatio: 0.4 },
			tooltipOptions: { formatTooltipY: (v) => format_currency(v, d.currency, 0) },
		});
	}

	render_budget() {
		const b = this.data.budget, v = this.data.violations;
		const rows = !b.categories.length
			? `<div class="nx-empty">${__("No submitted estimations for this filter.")}</div>`
			: b.categories.map((c) => `
				<div class="nx-bar-row" title="${this.esc(this.money(c.actual))} / ${this.esc(this.money(c.estimated))}">
					<span class="nx-ellipsis">${this.esc(c.category)}</span>
					<div class="nx-track"><div class="nx-fill" style="width:${Math.min(c.pct, 100)}%; background:${this.pct_color(c.pct)};"></div></div>
					<span class="nx-right" style="color:${this.pct_color(c.pct)}">${this.pct(c.pct)}</span>
				</div>`).join("");
		const types = v.by_type.map((t) => `${this.esc(__(t.type))}: <b>${t.count}</b>`).join(" · ");
		const foot = `<div class="nx-foot">
			${__("Actual {0} of {1} estimated", [this.money(b.totals.actual), this.money(b.totals.estimated)])}
			<div ${this.link_attrs("Budget Violation Log")} style="margin-top:4px;">${__("{0} open violation(s)", [v.open])}${types ? ` — ${types}` : ""}</div>
		</div>`;
		return this.section(__("Budget health"), __("{0}% used", [b.totals.pct]), `<div class="nx-box">${rows}${foot}</div>`);
	}

	render_attention() {
		const a = this.data.attention;
		const body = !a.length
			? `<div class="nx-empty">${__("Nothing needs attention right now.")}</div>`
			: a.map((x) => `
				<div class="nx-row nx-attn-row" ${x.overview ? this.link_attrs("Project Overview", x.overview) : this.link_attrs("Project", x.project)}>
					<span class="nx-ellipsis"><b>${this.esc(x.project)}</b> · ${this.esc(x.label)}
						<div class="nx-muted nx-ellipsis">${this.esc(x.project_name)}</div></span>
					<span class="indicator-pill ${x.severity === "danger" ? "red" : "orange"}">${this.esc(x.value)}</span>
				</div>`).join("");
		return this.section(__("Needs attention"), a.length ? __("{0} item(s)", [a.length]) : "", `<div class="nx-box">${body}</div>`);
	}
}
