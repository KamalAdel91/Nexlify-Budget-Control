frappe.pages["projexlify-dashboard"].on_page_load = function (wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Dashboard"),
        single_column: true,
    });
    new NexlifyProjexlifyDashboard(page);
};

(function inject_nexlify_dashboard_styles() {
    if (document.getElementById("nexlify-dashboard-styles")) return;
    const style = document.createElement("style");
    style.id = "nexlify-dashboard-styles";
    style.textContent = `
        .nx-dash-wrap { max-width: 1200px; margin: 0 auto; padding: 12px 4px 40px; width: 100%; box-sizing: border-box; }
        .nx-filter-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
        .nx-filter-bar select { font-size: 12px; padding: 6px 10px; border-radius: 6px; flex: 1 1 140px; min-width: 120px; max-width: 220px; }
        .nx-cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 18px; }
        .nx-card { border-radius: 8px; padding: 12px 14px; min-width: 0; }
        .nx-card-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
        .nx-card-value { font-size: 19px; font-weight: 700; word-break: break-word; }
        .nx-card-sub { font-size: 10.5px; margin-top: 4px; }
        .nx-section-title { font-size: 13px; font-weight: 700; margin: 18px 0 8px; }
        .nx-chart-box { border-radius: 8px; padding: 12px 14px; }
        .nx-table-scroll { overflow-x: auto; border-radius: 8px; -webkit-overflow-scrolling: touch; }
        .nx-project-table { width: 100%; min-width: 640px; border-collapse: collapse; }
        .nx-project-table th { text-align: left; padding: 8px 12px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; white-space: nowrap; }
        .nx-project-table td { padding: 7px 12px; font-size: 12px; white-space: nowrap; }
        .nx-project-header td { font-weight: 700; font-size: 13px; }
        .nx-category-row td { font-size: 11.5px; }
        .nx-progress-track { flex: 1; height: 6px; border-radius: 3px; overflow: hidden; min-width: 50px; }
        .nx-progress-fill { height: 100%; }
        @media (max-width: 640px) {
            .nx-filter-bar select { flex: 1 1 100%; max-width: none; }
            .nx-cards-grid { grid-template-columns: 1fr 1fr; }
            .nx-card-value { font-size: 16px; }
        }
    `;
    document.head.appendChild(style);
})();

class NexlifyProjexlifyDashboard {
    constructor(page) {
        this.page = page;
        this.render();
    }

    colors() {
        const dark = document.documentElement.getAttribute("data-theme") === "dark" || document.body.classList.contains("dark");
        return {
            border: dark ? "#2E2E2C" : "#E7E5E4",
            page_bg: dark ? "#171716" : "#F8F9FA",
            card_bg: dark ? "#1F1F1E" : "#FFFFFF",
            muted: dark ? "#A8A29E" : "#78716C",
            heading: dark ? "#FAFAF9" : "#0C0A09",
            danger: "#DC2626", warning: "#D97706", success: "#16A34A", info: "#2B6CB0",
        };
    }

    async render() {
        const c = this.colors();
        const $body = $(this.page.body);
        $body.empty();

        const $wrap = $(`
            <div class="nx-dash-wrap">
                <div class="nx-filter-bar">
                    <select id="pd-company" style="border:1px solid ${c.border};">
                        <option value="">All Companies</option>
                    </select>
                    <select id="pd-project" style="border:1px solid ${c.border};">
                        <option value="">All Projects</option>
                    </select>
                    <span id="pd-dynamic-filters" style="display:contents;"></span>
                    <button id="pd-apply" class="btn btn-primary btn-sm">Apply Filter</button>
                    <span id="pd-loading" style="font-size:11px; color:${c.muted}; display:none;">Loading…</span>
                </div>
                <div id="pd-cards" class="nx-cards-grid"></div>
                <div id="pd-chart-section"></div>
                <div id="pd-projects-section"></div>
            </div>
        `);
        $body.append($wrap);

        try {
            const companies = await frappe.db.get_list("Company", { limit: 0, fields: ["name"] });
            companies.forEach((c2) => $wrap.find("#pd-company").append(`<option value="${c2.name}">${c2.name}</option>`));
        } catch (e) { console.error("NEXLIFY dashboard - company list failed:", e); }

        try {
            const projects = await frappe.db.get_list("Project", { limit: 0, fields: ["name"] });
            projects.forEach((p) => $wrap.find("#pd-project").append(`<option value="${p.name}">${p.name}</option>`));
        } catch (e) { console.error("NEXLIFY dashboard - project list failed:", e); }

        try {
            const r = await frappe.call({
                method: "nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_dashboard_filter_fields",
            });
            const dynamicFields = r.message || [];
            const $dyn = $wrap.find("#pd-dynamic-filters");
            for (const field of dynamicFields) {
                const $sel = $(`
                    <select class="pd-dynamic-filter" data-field="${field.target_field}" data-source="${field.source_doctype}"
                        style="font-size:12px; padding:6px 10px; border-radius:6px; border:1px solid ${c.border}; flex:1 1 140px; min-width:120px; max-width:220px;">
                        <option value="">All ${frappe.utils.escape_html(field.label)}</option>
                    </select>
                `);
                $dyn.append($sel);
                try {
                    const options = await frappe.db.get_list(field.link_doctype, { limit: 0, fields: ["name"] });
                    options.forEach((o) => $sel.append(`<option value="${o.name}">${o.name}</option>`));
                } catch (e2) {
                    console.error("NEXLIFY dashboard - dynamic filter options failed:", field.label, e2);
                }
            }
        } catch (e) {
            console.error("NEXLIFY dashboard - dynamic filter fields failed:", e);
        }

        $wrap.find("#pd-apply").on("click", () => this.run_query($wrap));
        this.run_query($wrap);
    }

    merge_filters(base_filters_json, doctype, company, project) {
        let filters;
        try { filters = JSON.parse(base_filters_json || "[]"); } catch (e) { filters = []; }
        if (company) filters.push([doctype, "company", "=", company, false]);
        if (project) filters.push([doctype, "project", "=", project, false]);
        return filters;
    }

    fmt_money(val, currency) {
        const n = (val || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return currency ? `${currency} ${n}` : n;
    }

    async run_query($wrap) {
        // Guard against overlapping runs: if the user clicks "Apply Filter"
        // multiple times before the previous run finishes, later clicks are
        // ignored until the in-flight one completes - prevents duplicated
        // cards/rows from multiple concurrent async fetches racing each other.
        if (this._isLoading) return;
        this._isLoading = true;

        const $apply = $wrap.find("#pd-apply");
        $apply.prop("disabled", true);

        const c = this.colors();
        const company = $wrap.find("#pd-company").val();
        const project = $wrap.find("#pd-project").val();
        const $loading = $wrap.find("#pd-loading");
        $loading.show();

        try {

        // ---- Fetch category-level project rows first (drives everything) ----
        let rows = [];
        try {
            const extraFilters = [];
            $wrap.find(".pd-dynamic-filter").each(function () {
                const val = $(this).val();
                if (val) {
                    extraFilters.push({
                        target_field: $(this).data("field"),
                        source_doctype: $(this).data("source"),
                        value: val,
                    });
                }
            });

            const r = await frappe.call({
                method: "nexlify_budget_control.nexlify_budget_control.budget_enforcement.get_all_projects_budget_summary",
                args: {
                    company: company || null,
                    project: project || null,
                    extra_filters: JSON.stringify(extraFilters),
                },
            });
            rows = (r.message && r.message.rows) || [];
        } catch (e) {
            console.error("NEXLIFY dashboard - budget summary fetch failed:", e);
        }

        const totalEstimated = rows.reduce((s, r) => s + (r.estimated || 0), 0);
        const totalActual = rows.reduce((s, r) => s + (r.actual || 0), 0);
        const projectSet = new Set(rows.map((r) => r.project));
        const overallPct = totalEstimated ? Math.round((totalActual / totalEstimated) * 100) : 0;
        const currency = rows.length ? rows[0].currency : "";

        // ---- Cards: Open Violations + Active Budgets (via Number Card API) ----
        const $cards = $wrap.find("#pd-cards");
        $cards.empty();

        const cardNames = ["Open Budget Violations", "Active Project Budgets"];
        for (const name of cardNames) {
            try {
                const cardDoc = await frappe.db.get_doc("Number Card", name);
                const filters = this.merge_filters(cardDoc.filters_json, cardDoc.document_type, company, project);
                const resp = await frappe.call({
                    method: "frappe.desk.doctype.number_card.number_card.get_result",
                    args: { doc: JSON.stringify(cardDoc), filters: filters },
                    error: () => {},
                });
                let value = "-";
                if (resp.message !== undefined && resp.message !== null) {
                    value = (typeof resp.message === "object" && "value" in resp.message) ? resp.message.value : resp.message;
                }
                $cards.append(`
                    <div class="nx-card" style="background:${c.page_bg}; border:1px solid ${c.border};">
                        <div class="nx-card-label" style="color:${c.muted};">${cardDoc.label}</div>
                        <div class="nx-card-value" style="color:${c.heading};">${value}</div>
                    </div>
                `);
            } catch (e) {
                console.error("NEXLIFY dashboard - card fetch failed:", name, e);
            }
        }

        // ---- Rich cards: Estimated Cost / Actual Cost (computed client-side from category rows) ----
        $cards.append(`
            <div class="nx-card" style="background:${c.page_bg}; border:1px solid ${c.info};">
                <div class="nx-card-label" style="color:${c.info};">Estimated Cost</div>
                <div class="nx-card-value" style="color:${c.heading};">${this.fmt_money(totalEstimated, currency)}</div>
                <div class="nx-card-sub" style="color:${c.muted};">across ${projectSet.size} project(s)</div>
            </div>
        `);
        const actualColor = overallPct >= 100 ? c.danger : (overallPct >= 80 ? c.warning : c.success);
        $cards.append(`
            <div class="nx-card" style="background:${c.page_bg}; border:1px solid ${actualColor};">
                <div class="nx-card-label" style="color:${actualColor};">Actual Cost</div>
                <div class="nx-card-value" style="color:${c.heading};">${this.fmt_money(totalActual, currency)}</div>
                <div class="nx-card-sub" style="color:${actualColor};">${overallPct}% of estimated used</div>
            </div>
        `);

        // ---- Chart: Violations by Type ----
        await this.render_chart($wrap, company, project);

        // ---- Detailed table: projects grouped, with category sub-rows ----
        this.render_projects_table($wrap, rows);
        } finally {
            $loading.hide();
            $apply.prop("disabled", false);
            this._isLoading = false;
        }
    }

    async render_chart($wrap, company, project) {
        const c = this.colors();
        const $chartSection = $wrap.find("#pd-chart-section");
        $chartSection.empty();

        try {
            const chartName = "Violations by Type";
            const chartDoc = await frappe.db.get_doc("Dashboard Chart", chartName);
            const filters = this.merge_filters(chartDoc.filters_json, chartDoc.document_type, company, project);
            const r = await frappe.call({
                method: "frappe.desk.doctype.dashboard_chart.dashboard_chart.get",
                args: {
                    chart_name: chartName, filters: filters, refresh: 1,
                    time_interval: chartDoc.time_interval || "", timespan: chartDoc.timespan || "",
                    from_date: chartDoc.from_date || "", to_date: chartDoc.to_date || "",
                },
            });
            const data = r.message;
            let rowsHtml = `<div style="font-size:12px;color:${c.muted};">No data</div>`;
            if (data && data.labels && data.labels.length) {
                rowsHtml = data.labels.map((label, i) => {
                    const val = (data.datasets && data.datasets[0] && data.datasets[0].values[i]) || 0;
                    return `<div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0; border-bottom:1px solid ${c.border};">
                        <span style="color:${c.muted};">${label}</span><span style="font-weight:600; color:${c.heading};">${val}</span>
                    </div>`;
                }).join("");
            }
            $chartSection.append(`
                <div class="nx-section-title" style="color:${c.heading};">Violations by Type</div>
                <div class="nx-chart-box" style="background:${c.page_bg}; border:1px solid ${c.border};">${rowsHtml}</div>
            `);
        } catch (e) {
            console.error("NEXLIFY dashboard - chart fetch failed:", e);
        }
    }

    render_projects_table($wrap, rows) {
        const c = this.colors();
        const $section = $wrap.find("#pd-projects-section");
        $section.empty();

        if (!rows.length) {
            $section.append(`
                <div class="nx-section-title" style="color:${c.heading};">Budget Categories: Estimated vs Actual</div>
                <div style="padding:14px; font-size:12px; color:${c.muted}; background:${c.page_bg}; border:1px solid ${c.border}; border-radius:8px;">
                    No submitted project budgets found for this filter.
                </div>
            `);
            return;
        }

        // Group rows by budget_category and SUM estimated/actual across
        // whatever project(s) match the current filter - one row per
        // category, never repeated per project.
        const byCategory = {};
        rows.forEach((r) => {
            const key = r.budget_category || "(No Category)";
            if (!byCategory[key]) {
                byCategory[key] = { estimated: 0, actual: 0, currency: r.currency };
            }
            byCategory[key].estimated += r.estimated;
            byCategory[key].actual += r.actual;
        });

        const bodyRows = Object.keys(byCategory).map((catName) => {
            const cat = byCategory[catName];
            const remaining = cat.estimated - cat.actual;
            const pct = cat.estimated ? Math.round((cat.actual / cat.estimated) * 100) : 0;
            const barColor = pct >= 100 ? c.danger : (pct >= 80 ? c.warning : c.success);
            const remColor = remaining < 0 ? c.danger : c.heading;
            return `
                <tr class="nx-category-row" style="border-top:1px solid ${c.border};">
                    <td style="color:${c.heading}; font-weight:600;">${frappe.utils.escape_html(catName)}</td>
                    <td style="text-align:right; color:${c.heading};">${this.fmt_money(cat.estimated, cat.currency)}</td>
                    <td style="text-align:right; color:${c.heading};">${this.fmt_money(cat.actual, cat.currency)}</td>
                    <td style="text-align:right; color:${remColor};">${this.fmt_money(remaining, cat.currency)}</td>
                    <td>
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div class="nx-progress-track" style="background:${c.border};">
                                <div class="nx-progress-fill" style="width:${Math.min(pct,100)}%; background:${barColor};"></div>
                            </div>
                            <span style="font-size:11px; font-weight:600; color:${barColor}; min-width:32px;">${pct}%</span>
                        </div>
                    </td>
                </tr>
            `;
        }).join("");

        $section.append(`
            <div class="nx-section-title" style="color:${c.heading};">Budget Categories: Estimated vs Actual</div>
            <div class="nx-table-scroll" style="background:${c.card_bg}; border:1px solid ${c.border};">
                <table class="nx-project-table">
                    <thead>
                        <tr style="background:${c.page_bg};">
                            <th style="color:${c.muted};">Category</th>
                            <th style="text-align:right; color:${c.muted};">Estimated</th>
                            <th style="text-align:right; color:${c.muted};">Actual</th>
                            <th style="text-align:right; color:${c.muted};">Remaining</th>
                            <th style="color:${c.muted};">% Used</th>
                        </tr>
                    </thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>
        `);
    }
}
