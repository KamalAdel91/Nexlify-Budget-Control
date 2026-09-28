window.nexlify = window.nexlify || {}; nexlify.sort_trades = nexlify.sort_trades || ((l) => (l || []).slice()); nexlify.trade_cmp = nexlify.trade_cmp || (() => 0); nexlify.trade_color = nexlify.trade_color || (() => "#64748B");
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
		.nx-ceo .nx-filters { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 16px; padding: 0; border: none; background: none; }
		.nx-ceo .nx-filters > .form-group, .nx-ceo .nx-filters > .frappe-control { flex: 1 1 200px; max-width: 280px; width: auto; margin: 0; padding: 0; }
		@media (max-width: 640px) { .nx-ceo .nx-filters > .form-group, .nx-ceo .nx-filters > .frappe-control { max-width: none; } }
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
		/* nx-ops */
		.nx-wd { font-weight: 600; color: var(--text-color); }
		.nx-queue-wrap.has-items .nx-box { background: #fffaf0; border-color: #f5d49a; box-shadow: inset 4px 0 0 #F59E0B; }
		.nx-queue-wrap.has-items .nx-row { border-bottom-color: #f3e2c0; }
		.nx-queue-wrap.has-items [data-open]:hover { background: #fdf1dc; }
		.nx-queue-wrap.has-items .nx-sec-title > span:first-child::before { background: #F59E0B; }
		.nx-queue-wrap.has-items .nx-sec-title > span:first-child::after { content: "!"; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; border-radius: 50%; background: #F59E0B; color: #fff; font-size: 12px; font-weight: 700; }
		.nx-queue-wrap.has-items .nx-sec-title small { background: #fdf1dc; color: #8a4f08; font-weight: 600; }
		[data-theme="dark"] .nx-queue-wrap.has-items .nx-box { background: rgba(245, 158, 11, .08); border-color: rgba(245, 158, 11, .35); }
		[data-theme="dark"] .nx-queue-wrap.has-items .nx-row { border-bottom-color: rgba(245, 158, 11, .2); }
		[data-theme="dark"] .nx-queue-wrap.has-items [data-open]:hover { background: rgba(245, 158, 11, .14); }
		[data-theme="dark"] .nx-queue-wrap.has-items .nx-sec-title small { background: rgba(245, 158, 11, .18); color: #fcd34d; }
		.nx-kpi { position: relative; overflow: hidden; display: flex; flex-direction: column; padding: 16px 18px 14px; border-radius: 12px; box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
		.nx-kpis .nx-kpi::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: var(--kc, #98A2B3); }
		.nx-kpis .nx-kpi:nth-child(1) { --kc: #2490EF; } .nx-kpis .nx-kpi:nth-child(2) { --kc: #98A2B3; }
		.nx-kpis .nx-kpi:nth-child(3) { --kc: #20A39E; } .nx-kpis .nx-kpi:nth-child(4) { --kc: #F59E0B; }
		.nx-kpis .nx-kpi:nth-child(5) { --kc: #8B5CF6; }
		.nx-kpi-label { font-size: 12.5px; font-weight: 500; }
		.nx-kpi-value { font-size: 24px; line-height: 1.2; letter-spacing: -.01em; font-variant-numeric: tabular-nums; margin-bottom: auto; }
		.nx-kpi-sub { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border-color); }
		.nx-kpi.nx-accent { background: color-mix(in srgb, #8B5CF6 6%, var(--card-bg)); border-color: color-mix(in srgb, #8B5CF6 35%, var(--border-color)); }
		.nx-sec-title { align-items: center; flex-wrap: wrap; margin: 28px 0 12px; font-size: 15px; letter-spacing: -.005em; }
		.nx-sec-title > span:first-child { display: inline-flex; align-items: center; gap: 10px; }
		.nx-sec-title > span:first-child::before { content: ""; width: 4px; height: 18px; border-radius: 2px; background: var(--blue-500, #2490EF); flex: none; }
		.nx-sec-title small { background: var(--control-bg); padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
		.nx-bud-bar { display: flex; align-items: center; gap: 10px; min-width: 0; }
		.nx-bud-bar .nx-track { flex: 1; min-width: 40px; }
		.nx-bud-v { font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
		.nx-bud-v.est { color: var(--text-color); font-weight: 500; }
		.nx-bud-v { min-width: 84px; } .nx-bud-v.est { min-width: 92px; text-align: end; }
		.nx-bud-bar { align-items: flex-end; }
		.nx-bud-v { line-height: 12px; margin-bottom: -2px; } .nx-bud-v.zero { min-width: 0; }
		.nx-bud-track { position: relative; flex: 1; min-width: 60px; padding-top: 18px; }
		.nx-bud-track .nx-track { width: 100%; }
		.nx-bud-act { position: absolute; top: 0; transform: translateX(-50%); font-size: var(--text-xs); font-weight: 600; color: var(--heading-color); white-space: nowrap; font-variant-numeric: tabular-nums; }
		.nx-bud-act.s { transform: none; } .nx-bud-act.e { transform: translateX(-100%); }
		@media (max-width: 640px) { .nx-bud-bar { gap: 6px; } }
		.nx-wrap { min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.45; }
		.nx-code { display: inline-block; font-family: var(--font-family-mono, ui-monospace, monospace); font-size: 11.5px; font-weight: 600; padding: 1px 8px; margin-bottom: 3px; border-radius: 6px; background: var(--control-bg); color: var(--heading-color); letter-spacing: .02em; }
		.nx-visit-row { grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1.3fr) 90px minmax(0, 1.7fr); }
		.nx-vgroup { font-size: var(--text-xs); font-weight: 600; color: var(--text-muted); padding: 12px 4px 2px; }
		.nx-vgroup span { font-weight: 400; margin-left: 6px; }
		.nx-tm { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-xs); margin: 2px 12px 2px 0; white-space: nowrap; color: var(--text-color); }
		.nx-tm i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
		.nx-tm-total { font-size: var(--text-xs); font-weight: 600; margin-right: 12px; color: var(--heading-color); }
		.nx-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 1px; }
		.nx-mp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; }
		@media (max-width: 640px) {
			.nx-visit-row { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
			.nx-visit-row.nx-head { display: none; }
			.nx-mp-grid { grid-template-columns: 1fr 1fr; }
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
		this.$body.prepend($(this.page.page_form).addClass("nx-filters"));
		this.$content = $(`<div></div>`).appendTo(this.$body);
		this.refresh();
	}

	make_filters() {
		const change = () => this.refresh_soon();
		const parent_change = () => { this.drop_unmatched_project(); this.refresh_soon(); };
		this.company = this.page.add_field({
			fieldtype: "Link", fieldname: "company", label: __("Company"), options: "Company", change: parent_change,
		});
		this.project = this.page.add_field({
			fieldtype: "Link", fieldname: "project", label: __("Project"), options: "Project", change,
			get_query: () => ({ filters: this.project_filters() }),
		});
		this.hint(this.company, __("All companies"));
		this.hint(this.project, __("All projects"));
		frappe.call({ method: "nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_dashboard_filter_fields" })
			.then((r) => (r.message || []).forEach((f) => {
				const ctrl = this.page.add_field({
					fieldtype: f.link_doctype ? "Link" : "Data", options: f.link_doctype,
					fieldname: `nx_${f.target_field}`, label: __(f.label), change: parent_change,
				});
				this.dynamic.push({ ctrl, target_field: f.target_field, source_doctype: f.source_doctype });
				this.hint(ctrl, __("All {0}", [__(f.label)]));
			}));
	}

	hint(ctrl, text) {
		if (ctrl && ctrl.$input) ctrl.$input.attr("placeholder", text);
	}

	project_filters() {
		// the Project list follows the Company and every dynamic filter that lives on Project
		const filters = {};
		const company = this.company.get_value();
		if (company) filters.company = company;
		this.dynamic.forEach((d) => {
			const v = d.ctrl.get_value();
			if (v && d.source_doctype === "Project") filters[d.target_field] = v;
		});
		return filters;
	}

	async drop_unmatched_project() {
		const project = this.project.get_value();
		const filters = this.project_filters();
		if (!project || !Object.keys(filters).length) return;
		const match = await frappe.db.get_list("Project", { filters: { ...filters, name: project }, limit: 1 });
		if (!match.length) this.project.set_value("");
	}

	refresh_soon() {
		clearTimeout(this._timer);
		this._timer = setTimeout(() => this.refresh(), 300);
	}

	async refresh() {
		const token = (this._token = (this._token || 0) + 1);
		if (!this.data) this.$content.html(`<div class="nx-empty">${__("Loading…")}</div>`);
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
			if (token === this._token) this.$content.html(`<div class="nx-empty">${__("Couldn't load the dashboard. Refresh to try again.")}</div>`);
		}
	}

	// ---------- helpers ----------
	n_(n, one, many) { return __(n === 1 ? one : many, [n]); }
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
		this.$content.html(`
			${this.render_kpis()}
			<div class="nx-queue-wrap${(this.data.queue || []).length ? ' has-items' : ''}">${this.render_queue()}</div>
			<div class="nx-grid-2">
				<div>${this.render_stages()}</div>
				<div>${this.section(__("Revenue vs cost by month"), __("by plan start month"), `<div class="nx-box"><div class="nx-month-chart"></div></div>`)}</div>
			</div>
			<div class="nx-grid-2">
				<div>${this.render_budget()}</div>
				<div>${this.render_attention()}</div>
			</div>
			${this.render_visits()}
			${this.render_manpower()}
		`);
		this.render_chart();
		this.render_manpower_chart();
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
			${card(__("Contract value"), this.money(k.contract_value), this.n_(k.projects, "{0} project", "{0} projects"))}
			${card(__("Planned cost"), this.money(k.planned_cost), __("from approved estimations"))}
			${card(__("Expected profit"), this.money(k.expected_profit), k.contract_value ? __("{0}% of contract value", [Math.round(k.expected_profit / k.contract_value * 1000) / 10]) : "", "", k.expected_profit < 0 ? "color: var(--red-500)" : "")}
			${card(__("Avg margin"), this.pct(k.margin_pct),
				`<span style="color:${this.margin_color(k.margin_pct)}">${__("Target {0}%", [s.target_margin_pct])}</span>`)}
			${card(__("Waiting for you"), k.waiting_for_me,
				k.waiting_for_me ? this.n_(k.oldest_wait_days, "Oldest {0} day", "Oldest {0} days") : __("All clear"), "nx-accent",
				k.waiting_for_me ? "color: var(--primary)" : "")}
		</div>`;
	}

	render_queue() {
		const q = this.data.queue;
		const pill = (r) => {
			const color = r.overdue ? "red" : r.waiting_days > 0 ? "orange" : "gray";
			const text = r.waiting_days ? this.n_(r.waiting_days, "{0} day", "{0} days") : __("Today");
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
						<div class="nx-muted nx-ellipsis">${r.customer ? `<span class="nx-code">${this.esc(r.customer)}</span>` : ""}${r.customer_name && r.customer_name !== r.customer ? ` <span class="nx-muted">${this.esc(r.customer_name)}</span>` : ""}${r.return_count ? ` · ${__("returned {0}x", [r.return_count])}` : ""}</div></span>
					<span class="nx-right nx-hide-sm">${this.money(r.contract_value)}</span>
					<span class="nx-right nx-hide-sm" style="color:${this.margin_color(r.margin_pct)}">${this.pct(r.margin_pct)}</span>
					<span class="nx-right">${pill(r)}</span>
				</div>`).join("");
		return this.section(__("Waiting for your approval"),
			((waiting_elsewhere) => waiting_elsewhere.length ? __("Also {0}", [waiting_elsewhere.map((x) => `${x.n} ${__(x.s)}`).join(", ")]) : __("{0} pending in total", [this.data.kpis.pending_total]))((this.data.stages || []).slice(2, -1).map((x) => ({ s: x.stage, n: x.count - (this.data.queue || []).filter((r) => r.state === x.stage).length })).filter((x) => x.n > 0)), `<div class="nx-box">${body}</div>`);
	}

	render_stages() {
		const st = this.data.stages;
		const max = Math.max(1, ...st.map((s) => s.count));
		const last = st.length - 1;
		const rows = st.map((s, i) => {
			const color = i === 0 ? "var(--gray-500)" : i === 1 ? "var(--blue-500)" : i === last ? "var(--green-500)" : "var(--orange-500)";
			const attrs = i === 0 ? this.link_attrs("Project Estimation")
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
		const d = this.data, el = this.$content.find(".nx-month-chart")[0];
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
			colors: d.can_see_price ? ["#2490EF", "#98A2B3"] : ["#98A2B3"],
			barOptions: { spaceRatio: 0.4 },
			axisOptions: { shortenYAxisNumbers: 1 },
			tooltipOptions: { formatTooltipY: (v) => format_currency(v, d.currency, 0) },
		});
	}

	trade_colors() {
		const pal = ["#2490EF", "#20A39E", "#F59E0B", "#8B5CF6", "#EC4899", "#64748B"];
		const out = {};
		((this.data.manpower || {}).trades || []).forEach((t) => { out[t.name] = nexlify.trade_color(t.name); });
		return out;
	}

	mp_shown() {
		const m = this.data.manpower || {}, now = m.today || {}, weeks = m.weeks || [];
		return (m.trades || []).filter((t) => now[t.name] || weeks.some((w) => (w.by || {})[t.name]));
	}

	render_visits() {
		const v = this.data.visits || {}, cur = v.current || [], up = v.upcoming || [];
		const trades = (this.data.manpower || {}).trades || [], color = this.trade_colors();
		const date = (d) => frappe.datetime.str_to_user(d);
		const team = (x) => {
			const items = trades.filter((t) => x.team[t.name])
				.map((t) => `<span class="nx-tm"><i style="background:${color[t.name]}"></i>${x.team[t.name]} ${this.esc(t.label)}</span>`).join("");
			return items ? `<span class="nx-tm-total">${this.n_(x.people, "{0} person", "{0} people")}</span>${items}` : `<span class="nx-muted">${__("No team")}</span>`;
		};
		const row = (x, now) => `
			<div class="nx-row nx-visit-row" ${this.link_attrs("Project Visits", x.name)}>
				<span class="nx-wrap"><b>${this.esc(x.project)}</b> · ${this.esc(x.label)}<div class="nx-muted">${this.esc(x.project_name)}</div></span>
				<span class="nx-wrap nx-hide-sm">${x.customer ? `<span class="nx-code">${this.esc(x.customer)}</span>` : ""}${x.customer_name && x.customer_name !== x.customer ? `<div class="nx-muted">${this.esc(x.customer_name)}</div>` : ""}</span>
				<span>${now
					? `<div class="nx-muted">${__("Day {0} of {1}", [x.day, x.days])}</div>
						<div class="nx-track" style="margin-top:5px"><div class="nx-fill" style="width:${Math.min(100, x.day / x.days * 100)}%; background: #2490EF"></div></div>`
					: `<span class="indicator-pill blue">${x.starts_in === 1 ? __("Starts tomorrow") : __("Starts in {0} days", [x.starts_in])}</span>`}
					<div class="nx-muted" style="margin-top:4px">${date(x.start_date)} → ${date(x.end_date)}</div></span>
				<span class="nx-right"><b class="nx-wd">${x.working_days ? flt(x.working_days, 2) : "—"}</b></span>
				<span>${team(x)}</span>
			</div>`;
		const people = cur.reduce((s, x) => s + x.people, 0);
		const note = [__("{0} in progress", [cur.length]), __("{0} coming up", [up.length]), this.n_(people, "{0} person on site", "{0} people on site")].join(" · ");
		if (!cur.length && !up.length) {
			return this.section(__("Visits now"), note, `<div class="nx-box"><div class="nx-empty">${__("No visits in progress or coming up.")}</div></div>`);
		}
		const head = `<div class="nx-row nx-visit-row nx-head"><span>${__("Project · Visit")}</span><span class="nx-hide-sm">${__("Customer")}</span><span>${__("Progress")}</span><span class="nx-right">${__("Work days")}</span><span>${__("Team")}</span></div>`;
		const group = (label, list, now) => list.length
			? `<div class="nx-vgroup">${label}<span>${list.length}</span></div>${list.map((x) => row(x, now)).join("")}` : "";
		return this.section(__("Visits now"), note, `<div class="nx-box">${head}
			${group(__("In progress"), cur, true)}
			${group(__("Coming up in the next {0} days", [v.upcoming_days]), up, false)}</div>`);
	}

	render_manpower() {
		const m = this.data.manpower || {}, weeks = m.weeks || [], now = m.today || {};
		const color = this.trade_colors(), shown = this.mp_shown();
		const cur = (this.data.visits || {}).current || [];
		const total = Object.values(now).reduce((s, n) => s + n, 0);
		const peak = weeks.reduce((a, w) => (w.total > (a ? a.total : 0) ? w : a), null);
		const card = (label, value, sub, extra = "") => `
			<div class="nx-kpi ${extra}">
				<div class="nx-kpi-label">${label}</div>
				<div class="nx-kpi-value">${value}</div>
				<div class="nx-kpi-sub">${sub || "&nbsp;"}</div>
			</div>`;
		const cards = !shown.length
			? `<div class="nx-box"><div class="nx-empty">${__("No team is planned in the coming weeks.")}</div></div>`
			: `<div class="nx-mp-grid">${shown.map((t) => {
				const n = cur.filter((x) => x.team[t.name]).length;
				return card(`<span class="nx-dot" style="background:${color[t.name]}"></span>${this.esc(t.label)}`,
					now[t.name] || 0, n ? this.n_(n, "in {0} visit", "in {0} visits") : __("not needed today"));
			}).join("")}</div>`;
		return `<div class="nx-grid-2">
			<div>${this.section(__("Manpower needed today"), __("{0} people · approved projects", [total]), cards)}</div>
			<div>${this.section(__("Manpower forecast"), (peak ? __("Peak {0} people · week of {1}", [peak.total, frappe.datetime.str_to_user(peak.week)]) : __("busiest day of each week")), `<div class="nx-box"><div class="nx-mp-chart"></div></div>`)}</div>
		</div>`;
	}

	render_manpower_chart() {
		const el = this.$content.find(".nx-mp-chart")[0];
		if (!el) return;
		const weeks = (this.data.manpower || {}).weeks || [], shown = this.mp_shown(), color = this.trade_colors();
		if (!shown.length || !weeks.some((w) => w.total)) {
			$(el).html(`<div class="nx-empty">${__("No team is planned in the coming weeks.")}</div>`);
			return;
		}
		new frappe.Chart(el, {
			data: {
				labels: weeks.map((w) => { const d = frappe.datetime.str_to_obj(w.week); return `${d.getDate()}/${d.getMonth() + 1}`; }),
				datasets: shown.map((t) => ({ name: t.label, values: weeks.map((w) => (w.by || {})[t.name] || 0) })),
			},
			type: "bar", height: 220,
			colors: shown.map((t) => color[t.name]),
			barOptions: { stacked: 1, spaceRatio: 0.4 },
			tooltipOptions: { formatTooltipY: (v) => __("{0} people", [v]) },
		});
	}
	render_budget() {
		const b = this.data.budget, v = this.data.violations;
		const rows = !b.categories.length
			? `<div class="nx-empty">${__("No submitted estimations for this filter.")}</div>`
			: b.categories.map((c) => `
				<div class="nx-bar-row nx-bud-row">
					<span class="nx-ellipsis">${this.esc(c.category)}</span>
					<div class="nx-bud-bar"><span class="nx-bud-v zero">0</span><div class="nx-bud-track">${c.actual ? `<span class="nx-bud-act ${c.pct < 15 ? "s" : c.pct > 85 ? "e" : ""}" style="left:${Math.min(c.pct, 100)}%">${this.money(c.actual)}</span>` : ""}<div class="nx-track"><div class="nx-fill" style="width:${Math.min(c.pct, 100)}%; background:${this.pct_color(c.pct)};"></div></div></div><span class="nx-bud-v est">${this.money(c.estimated)}</span></div>
					<span class="nx-right" style="color:${this.pct_color(c.pct)}">${this.pct(c.pct)}</span>
				</div>`).join("");
		const types = v.by_type.map((t) => `${this.esc(__(t.type))}: <b>${t.count}</b>`).join(" · ");
		const foot = `<div class="nx-foot">
			${__("Actual {0} of {1} estimated", [this.money(b.totals.actual), this.money(b.totals.estimated)])}
			<div ${this.link_attrs("Budget Violation Log")} style="margin-top:4px;">${this.n_(v.open, "{0} open violation", "{0} open violations")}${types ? ` — ${types}` : ""}</div>
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
		return this.section(__("Needs attention"), a.length ? this.n_(a.length, "{0} item", "{0} items") : "", `<div class="nx-box">${body}</div>`);
	}
}
