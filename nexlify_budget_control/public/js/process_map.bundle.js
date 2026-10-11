// Business Process Map: draws steps.json as one lane per team. The workspace block (process_map/process_map.js) and
// the Project Life form both call nexlify_process_map.render(root, data, opts). When every step carries a progress
// (get_life_map), each step is drawn as done, now, not yet, skipped or lost for that one project; a step done once per document
// shows a count (2/5), and a Now line and a legend sit under the map.
window.nexlify_process_map = (() => {
	const CSS = `
.pm { color: var(--text-color, #1f272e); padding: 4px 0 8px; }
.pm-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.pm-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-color, #ededed); background: var(--card-bg, #fff); color: var(--text-muted, #6c7680); border-radius: 999px; padding: 4px 12px; font-size: 12px; cursor: pointer; transition: border-color .15s, color .15s; }
.pm-chip:hover { color: var(--text-color, #1f272e); }
.pm-chip.on { color: var(--text-color, #1f272e); border-color: var(--text-color, #1f272e); }
.pm-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.pm-map { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #ededed); border-radius: 14px; padding: 8px 8px 4px; overflow-x: auto; }
.pm-svg { display: block; width: 100%; min-width: 640px; }
.pm-svg .st { cursor: pointer; }
.pm-svg .st, .pm-svg .lane, .pm-svg .cn { transition: opacity .25s; }
.pm-svg .dim { opacity: .15; }
.pm-svg .halo, .pm-svg .sel { opacity: 0; transition: opacity .2s; }
.pm-svg .st.now .halo, .pm-svg .st.on .sel { opacity: 1; }
.pm-svg .st:hover .core { stroke-width: 3.5; }
.pm-svg .lb { font-size: 10px; fill: var(--text-muted, #6c7680); }
.pm-svg .st.todo .lb, .pm-svg .st.skipped .lb { opacity: .7; }
.pm-svg .ph { font-size: 10px; letter-spacing: .08em; fill: var(--text-muted, #6c7680); }
.pm-svg .ph-div { stroke: var(--border-color, #d1d8dd); stroke-width: .8; stroke-dasharray: 2 4; }
@media (prefers-reduced-motion: no-preference) { .pm-svg .st.now .halo { animation: pm-pulse 1.6s ease-in-out infinite; } }
@keyframes pm-pulse { 0%, 100% { opacity: .85; } 50% { opacity: .25; } }
.pm-now { display: flex; align-items: center; gap: 8px; margin: 10px 2px 0; padding: 8px 12px; border-radius: 10px; background: var(--subtle-fg, #f8f8f8); font-size: 13px; cursor: pointer; }
.pm-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 8px 2px 0; font-size: 12px; color: var(--text-muted, #6c7680); }
.pm-lg { display: inline-flex; align-items: center; gap: 6px; }
.pm-lg svg { width: 22px; height: 22px; flex: none; }
.pm-lg .halo, .pm-lg .sel { opacity: 0; }
.pm-lg .st.now .halo { opacity: 1; }
.pm-lg-count { background: #687178; color: #fff; border-radius: 7px; font-size: 9.5px; font-weight: 600; padding: 0 5px; line-height: 14px; }
.pm-prog { display: flex; gap: 3px; margin: 10px 2px; }
.pm-seg { flex: 1; height: 4px; border-radius: 2px; cursor: pointer; transition: opacity .25s; }
.pm-card { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #ededed); border-radius: 14px; overflow: hidden; }
.pm-loading { padding: 14px 16px; color: var(--text-muted, #6c7680); font-size: 13px; }
.pm-hd { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border-color, #ededed); }
.pm-num { width: 32px; height: 32px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex: none; }
.pm-hd h4 { margin: 2px 0 0; font-size: 15px; font-weight: 600; color: var(--text-color, #1f272e); }
.pm-sub { font-size: 12px; color: var(--text-muted, #6c7680); }
.pm-hd-end { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.pm-pill { font-size: 12px; font-weight: 500; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
.pm-bd { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); }
.pm-col { padding: 12px 16px; }
.pm-side { border-left: 1px solid var(--border-color, #ededed); background: var(--subtle-fg, #f8f8f8); }
@media (max-width: 760px) { .pm-bd { grid-template-columns: 1fr; } .pm-side { border-left: 0; border-top: 1px solid var(--border-color, #ededed); } }
.pm-lbl { font-size: 10.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted, #6c7680); margin-bottom: 7px; }
.pm-todo { list-style: none; margin: 0; padding: 0; }
.pm-todo li { display: flex; gap: 8px; font-size: 13px; line-height: 1.6; padding: 2px 0; }
.pm-check { flex: none; margin-top: 3px; }
.pm-note { display: flex; gap: 8px; align-items: flex-start; background: var(--bg-yellow, #fff7d3); color: var(--text-on-yellow, #5c4a00); border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-top: 10px; }
.pm-kv { display: flex; flex-direction: column; padding: 7px 0; border-bottom: 1px solid var(--border-color, #ededed); }
.pm-kv:last-child { border-bottom: 0; }
.pm-k { font-size: 11px; color: var(--text-muted, #6c7680); }
.pm-v { font-size: 13px; margin-top: 1px; }
.pm-nav { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-top: 1px solid var(--border-color, #ededed); }
.pm-nav .btn { display: inline-flex; align-items: center; gap: 6px; }
.pm-list { padding: 12px 16px; }
.pm-grp { border-top: 1px solid var(--border-color, #ededed); padding-top: 10px; margin-top: 10px; }
.pm-grp:first-child { border-top: 0; margin-top: 0; padding-top: 0; }
.pm-gt { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
.pm-mini { width: 22px; height: 22px; border-radius: 50%; color: #fff; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
.pm-svg .ph { font-size: 10.5px; font-weight: 600; }
.pm-svg .ph-band { fill: var(--text-color, #1f272e); fill-opacity: .035; }
.pm-svg .ph-br { fill: none; stroke: var(--gray-400, #a0aec0); stroke-width: 1; }
.pm-flow { position: relative; }
.pm-flow:before { content: ""; position: absolute; left: 14px; top: 22px; bottom: 22px; border-left: 1px dashed var(--border-color, #d1d8dd); }
.pm-fr { position: relative; display: flex; gap: 12px; align-items: flex-start; padding: 6px 0; }
.pm-fi { width: 29px; height: 29px; border-radius: 50%; background: var(--card-bg, #fff); border: 1px solid var(--border-color, #ededed); display: flex; align-items: center; justify-content: center; flex: none; position: relative; z-index: 1; }
.pm-ft { min-width: 0; padding-top: 1px; }
.pm-ft .pm-v { margin-top: 2px; }
.pm-bar { height: 4px; border-radius: 2px; background: var(--border-color, #ededed); margin-top: 6px; overflow: hidden; width: 160px; max-width: 100%; }
.pm-bar i { display: block; height: 100%; border-radius: 2px; }
.pm-ev { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; border-bottom: 1px solid var(--border-color, #ededed); }
.pm-ev:last-child { border-bottom: 0; }
.pm-evd { width: 10px; height: 10px; border-radius: 50%; flex: none; margin-top: 5px; box-sizing: border-box; }
.pm-evt { font-size: 13px; line-height: 1.45; }
.pm-evt b { font-weight: 600; }
.pm-docs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.pm-doc { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--border-color, #ededed); border-radius: 8px; padding: 5px 10px; font-size: 12.5px; color: var(--text-color, #1f272e); background: var(--card-bg, #fff); text-decoration: none; }
a.pm-doc { cursor: pointer; transition: border-color .15s; }
a.pm-doc:hover { border-color: var(--text-muted, #6c7680); text-decoration: none; color: var(--text-color, #1f272e); }
.pm-doc b { font-weight: 600; }
.pm-doc-k { color: var(--text-muted, #6c7680); font-size: 11px; }
.pm-doc-s { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--subtle-fg, #f3f3f3); color: var(--text-muted, #6c7680); }
.pm-doc-s.open { background: var(--bg-orange, #fff1e7); color: var(--text-on-orange, #a3410c); }
.pm-link { cursor: pointer; font-weight: 600; color: var(--text-color, #1f272e); text-decoration: none; border-bottom: 1px dashed var(--gray-400, #a0aec0); }
.pm-link:hover { text-decoration: none; border-bottom-style: solid; color: var(--text-color, #1f272e); }
`;
	const LH = 48, LANE = 42, R = 14, PAD = 24;
	const esc = (v) => frappe.utils.escape_html(String(v ?? ""));
	const norm = (v) => String(v || "").toLowerCase().replace(/[-_\s]+/g, " ").trim();
	const hours = (from, to) => Math.max(0, moment(to || undefined).diff(moment(from), "minutes") / 60);
	const until = (dt) => Math.max(0, moment(dt).diff(moment(), "minutes") / 60);
	const span = (h) => {
		if (h < 1) return __("less than an hour");
		if (h < 24) return Math.floor(h) === 1 ? __("1 hour") : __("{0} hours", [Math.floor(h)]);
		return Math.floor(h / 24) === 1 ? __("1 day") : __("{0} days", [Math.floor(h / 24)]);
	};
	const team_of = (roles) => (roles || "").split(", ").filter(Boolean).map((r) => r.replace(/ (Manager|User)$/, "")).join(", ");
	const when = (dt) => (dt ? frappe.datetime.str_to_user(dt) : "");
	const day = (dt) => (dt ? frappe.datetime.str_to_user(String(dt).slice(0, 10)) : "");
	const icon = (body, size, stroke, cls = "") =>
		`<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
	const ICON = {
		check: (c) => icon('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>', 15, c, "pm-check"),
		info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 15, "currentColor", "pm-check"),
		team: icon('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.8-1.8-5.1-4.3-5.8"/>', 16, "#fff"),
		left: icon('<path d="M15 6l-6 6 6 6"/>', 14, "currentColor"),
		right: icon('<path d="M9 6l6 6-6 6"/>', 14, "currentColor"),
	};
	const BADGE = { lost: ["Lost", "red"], done: ["Done", "green"], now: ["Now", "orange"], part: ["In progress", "blue"], todo: ["Not yet", "gray"], skipped: ["Skipped", "gray"] };
	const SEG = { lost: 1, done: 1, now: 1, part: 0.6, todo: 0.2, skipped: 0.1 };

	function phases(steps) {
		const out = [];
		steps.forEach((s, i) => {
			const last = out[out.length - 1];
			if (!s.phase) return;
			if (last && last.name === s.phase) last.b = i;
			else out.push({ name: s.phase, a: i, b: i });
		});
		return out;
	}

	function render(root, data, opts = {}) {
		const teams = data.teams || [], steps = data.steps || [];
		const progress = steps.length > 0 && !!steps[0].progress;
		root.classList.add("pm");
		root.classList.toggle("pm-progress", progress);
		root.innerHTML = `<style>${CSS}</style><div class="pm-chips"></div><div class="pm-map"><svg class="pm-svg"></svg></div><div class="pm-now"></div><div class="pm-legend"></div><div class="pm-prog"></div><div class="pm-card"></div>`;
		const svg = root.querySelector(".pm-svg"), chips = root.querySelector(".pm-chips");
		const prog = root.querySelector(".pm-prog"), card = root.querySelector(".pm-card");
		const color = Object.fromEntries(teams.map((t) => [t.name, t.color]));
		const lane = Object.fromEntries(teams.map((t, k) => [t.name, k]));
		const groups = phases(steps);
		const TOP = groups.length ? 32 : 4;
		let view = steps.map((_, i) => i), cur = 0, team = null, focus = null, lastW = 0;
		if (!progress) {
			const route = opts.route || [];
			const here = teams.find((t) => t.workspace && norm(t.workspace) === norm(route[route.length - 1]));
			const mine = here ? view.filter((i) => steps[i].team === here.name) : [];
			if (mine.length) {
				focus = here.name;
				view = mine;
			}
		}
		const state = (i) => (progress ? steps[i].progress.state : "map");
		const width = () => Math.max(svg.parentElement.clientWidth - 18, 640);
		const marker = (id, stroke) =>
			`<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M2 1L8 5L2 9" fill="none" ${stroke} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
		const label_zone = (t, c, y, h, w) =>
			`<rect x="2" y="${y}" width="${w}" height="${h}" rx="10" fill="${c}" fill-opacity=".1"/>`
			+ `<circle cx="18" cy="${y + 17}" r="4" fill="${c}"/>`
			+ `<text x="29" y="${y + 17}" dominant-baseline="central" style="font-size:12px;font-weight:600;fill:${c}">${esc(t)}</text>`;
		const dot = (x, y, c, label, st) => {
			const txt = (fill) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" style="font-size:11.5px;font-weight:600;fill:${fill};pointer-events:none">${label}</text>`;
			const extra = `<circle class="halo" cx="${x}" cy="${y}" r="${R + 7}" fill="${c}" fill-opacity=".22"/>`
				+ `<circle class="sel" cx="${x}" cy="${y}" r="${R + 4.5}" fill="none" stroke="${c}" stroke-width="1.6"/>`;
			const core = (attrs) => `<circle class="core" cx="${x}" cy="${y}" r="${R}" ${attrs}/>`;
			if (st === "todo" || st === "part") {
				return extra + core('style="fill:var(--card-bg, #fff);stroke:var(--gray-400, #a0aec0)" stroke-width="1.5"') + txt("var(--text-muted, #6c7680)");
			}
			if (st === "skipped") {
				return extra + core('style="fill:var(--card-bg, #fff);stroke:var(--gray-400, #a0aec0)" stroke-width="1.5" stroke-dasharray="3 3"')
					+ txt("var(--text-light, #8d99a6)");
			}
			if (st === "lost") {
				return extra + core('style="fill:var(--red-500, #e03131);stroke:var(--card-bg, #fff)" stroke-width="3"')
					+ `<path d="M${x - 4.5} ${y - 4.5} l9 9 M${x + 4.5} ${y - 4.5} l-9 9" stroke="#fff" stroke-width="2.2" stroke-linecap="round" style="pointer-events:none"/>`;
			}
			const inner = st === "done"
				? `<path d="M${x - 5} ${y} l3.4 3.4 l6.6 -6.8" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"/>`
				: txt("#fff");
			return extra + core(`fill="${c}" style="stroke:var(--card-bg, #fff)" stroke-width="3"`) + inner;
		};

		const count_badge = (s, x, y, c) => {
			const p = s.progress;
			if (!progress || !s.each || !p || !p.total || p.state === "skipped") return "";
			const t = `${p.reached}/${p.total}`, w = t.length * 6 + 8;
			return `<g style="pointer-events:none"><rect x="${x + R - 4}" y="${y - R - 4}" width="${w}" height="14" rx="7" fill="${c}"/>`
				+ `<text x="${x + R - 4 + w / 2}" y="${y - R + 3}" text-anchor="middle" dominant-baseline="central" style="font-size:9.5px;font-weight:600;fill:#fff">${t}</text></g>`;
		};

		function drawMap() {
			const W = width();
			const LW = Math.max(...teams.map((t) => t.name.length * 7 + 40));
			const X0 = LW + PAD + R, X1 = W - PAD - R;
			const dx = (X1 - X0) / Math.max(steps.length - 1, 1);
			const P = steps.map((s, i) => ({ x: X0 + dx * i, y: TOP + lane[s.team] * LH + 2 + 17 }));
			const reached = (i) => ["done", "now", "part", "lost"].includes(state(i));
			const curve = (a, b, from, dashed, muted) => {
				const x1 = a.x + R + 1, x2 = b.x - R - 3, m = (x1 + x2) / 2;
				const stroke = muted ? 'style="stroke:var(--gray-400, #a0aec0)"' : `stroke="${color[from.team]}" stroke-opacity=".75"`;
				return `<path class="cn" d="M${x1} ${a.y} C${m} ${a.y},${m} ${b.y},${x2} ${b.y}" fill="none" ${stroke} stroke-width="1.6"`
					+ `${dashed ? ' stroke-dasharray="3 4"' : ""} marker-end="url(#${muted ? "pm-ah-g" : "pm-ah-" + lane[from.team]})"/>`;
			};
			let h = "<defs>" + teams.map((t, k) => marker(`pm-ah-${k}`, `stroke="${t.color}"`)).join("")
				+ marker("pm-ah-g", 'style="stroke:var(--gray-400, #a0aec0)"') + "</defs>";
			teams.forEach((t, k) => {
				const y = TOP + k * LH + 2;
				h += `<g class="lane" data-t="${esc(t.name)}"><rect x="2" y="${y}" width="${W - 4}" height="${LANE}" rx="10" fill="${t.color}" fill-opacity=".05"/>`
					+ label_zone(t.name, t.color, y, LANE, LW) + "</g>";
			});
			groups.forEach((g, k) => {
				const x1 = g.a ? (P[g.a - 1].x + P[g.a].x) / 2 : Math.max(LW + 8, X0 - dx / 2);
				const x2 = g.b < steps.length - 1 ? (P[g.b].x + P[g.b + 1].x) / 2 : Math.min(W - 4, X1 + dx / 2);
				if (k % 2 === 0) h += `<rect class="ph-band" x="${x1 + 2}" y="${TOP - 2}" width="${x2 - x1 - 4}" height="${teams.length * LH}" rx="8"/>`;
				h += `<text class="ph" x="${(x1 + x2) / 2}" y="9" text-anchor="middle" dominant-baseline="central">${esc(__(g.name)).toUpperCase()}</text>`
					+ `<path class="ph-br" d="M${x1 + 8} ${TOP - 6} V${TOP - 10} H${x2 - 8} V${TOP - 6}"/>`;
				if (k) h += `<line class="ph-div" x1="${x1}" y1="${TOP}" x2="${x1}" y2="${TOP + teams.length * LH - 2}"/>`;
			});
			for (let i = 0; i < steps.length - 1; i++) {
				const off = progress && !reached(i + 1);
				h += curve(P[i], P[i + 1], steps[i], off, off);
			}
			if (!progress) {
				steps.forEach((s, i) => {
					if (s.optional && i > 0 && i < steps.length - 1) h += curve(P[i - 1], P[i + 1], steps[i - 1], true, false);
				});
			}
			steps.forEach((s, i) => {
				const st = state(i);
				h += `<g class="st ${st}" data-act="step" data-i="${i}"><title>${i + 1}. ${esc(s.title)}${progress ? " · " + __(BADGE[st][0]) : ""}</title>`
					+ dot(P[i].x, P[i].y, color[s.team], i + 1, st)
					+ `<text class="lb" x="${P[i].x}" y="${P[i].y + R + 10}" text-anchor="middle" dominant-baseline="central">${esc(__(s.short || ""))}</text>`
						+ count_badge(s, P[i].x, P[i].y, color[s.team]) + "</g>";
			});
			const H = TOP + teams.length * LH + 2;
			svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
			svg.style.height = `${H}px`;
			svg.innerHTML = h;
		}

		function drawFocus() {
			const W = width(), c = color[focus], H = 100, cy = 38;
			const LW = focus.length * 7 + 40;
			const X0 = LW + PAD + 80, X1 = W - PAD - 80;
			const n = view.length, dx = n > 1 ? (X1 - X0) / (n - 1) : 0;
			const xs = view.map((_, k) => (n > 1 ? X0 + dx * k : (X0 + X1) / 2));
			let h = `<defs>${marker("pm-ah-f", `stroke="${c}"`)}</defs>`
				+ `<rect x="2" y="4" width="${W - 4}" height="${H - 8}" rx="12" fill="${c}" fill-opacity=".05"/>`
				+ label_zone(focus, c, 21, H - 42, LW).replace(`y="21" width="${LW}" height="${H - 42}"`, `y="4" width="${LW}" height="${H - 8}"`);
			for (let k = 0; k < n - 1; k++) {
				h += `<line class="cn" x1="${xs[k] + R + 4}" y1="${cy}" x2="${xs[k + 1] - R - 6}" y2="${cy}" stroke="${c}" stroke-opacity=".6" stroke-width="1.6" marker-end="url(#pm-ah-f)"/>`;
			}
			view.forEach((i, k) => {
				h += `<g class="st map" data-act="step" data-i="${i}"><title>${esc(steps[i].title)}</title>${dot(xs[k], cy, c, k + 1, "map")}`
					+ `<text x="${xs[k]}" y="${cy + R + 18}" text-anchor="middle" dominant-baseline="central" style="font-size:12px;font-weight:500;fill:var(--text-color, #1f272e)">${esc(steps[i].title)}</text></g>`;
			});
			svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
			svg.style.height = `${H}px`;
			svg.innerHTML = h;
		}

		const draw = () => (focus ? drawFocus() : drawMap());

		function drawChips() {
			const plain = focus || progress;
			chips.innerHTML = plain ? "" : `<button class="pm-chip" data-act="team" data-t="">${__("Walk the process")}</button>`
				+ teams.map((t) => `<button class="pm-chip" data-act="team" data-t="${esc(t.name)}"><span class="pm-dot" style="background:${t.color}"></span>${esc(t.name)}</button>`).join("");
			chips.style.display = plain ? "none" : "";
			prog.innerHTML = view.map((i) =>
				`<div class="pm-seg" data-act="step" data-i="${i}" title="${i + 1}. ${esc(steps[i].title)}" style="background:${color[steps[i].team]}"></div>`
			).join("");
		}

		function marks() {
			root.querySelectorAll(".pm-svg .st").forEach((g) => {
				const i = +g.dataset.i;
				g.classList.toggle("dim", !progress && !!team && steps[i].team !== team);
				g.classList.toggle("on", !team && i === cur);
			});
			root.querySelectorAll(".pm-svg .lane").forEach((g) => g.classList.toggle("dim", !!team && g.dataset.t !== team));
			root.querySelectorAll(".pm-svg .cn").forEach((g) => g.classList.toggle("dim", !!team));
			root.querySelectorAll(".pm-seg").forEach((g) => {
				const i = +g.dataset.i;
				g.style.opacity = progress ? SEG[state(i)] : team ? (steps[i].team === team ? 1 : 0.15) : view.indexOf(i) <= view.indexOf(cur) ? 1 : 0.3;
			});
			root.querySelectorAll(".pm-chip").forEach((b) => b.classList.toggle("on", (b.dataset.t || null) === team));
		}

		const todo = (list, c) => `<ul class="pm-todo">${(list || []).map((x) => `<li>${ICON.check(c)}<span>${esc(x)}</span></li>`).join("")}</ul>`;
		const note = (s) => (s.note ? `<div class="pm-note">${ICON.info}<span>${esc(s.note)}</span></div>` : "");
		const FICON = {
			in: '<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5 13V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7"/><path d="M4 13v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',
			out: '<path d="M4 12h14"/><path d="M13 6l6 6-6 6"/>',
			flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
			clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
			doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
			bars: '<path d="M5 12h14M5 7h14M5 17h9"/>',
			info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
		};
		const frow = (ic, c, k, v) => `<div class="pm-fr"><span class="pm-fi">${icon(FICON[ic], 14, c)}</span><div class="pm-ft"><div class="pm-k">${esc(k)}</div><div class="pm-v">${v}</div></div></div>`;
		const teamdot = (txt) => {
			const t = teams.find((x) => txt && String(txt).startsWith(x.name));
			return t ? `<span class="pm-dot" style="background:${t.color};margin-right:6px"></span>` : "";
		};
		const handoff = (s) => {
			const c = color[s.team];
			const status = `<span class="indicator-pill blue">${esc(s.status_after || "—")}</span>${s.status_doctype ? ` <span class="pm-sub">${esc(s.status_doctype)}</span>` : ""}`;
			return `<div class="pm-flow">${frow("in", c, __("Receives"), esc(s.receives))}${frow("out", c, __("Hands to"), teamdot(s.hands_to) + esc(s.hands_to))}${frow("flag", c, __("Status after"), status)}</div>`;
		};
		const facts = (lines, c, p) => {
			const ICONS = { [__("Started")]: "clock", [__("Since")]: "clock", [__("Finished")]: "flag", [__("Done")]: "flag",
				[__("Took")]: "clock", [__("Lost on")]: "flag", [__("Reason")]: "info", [__("Progress")]: "bars", [__("Status")]: "info" };
			return `<div class="pm-flow">${lines.map(([k, v]) => {
				const bar = k === __("Progress") && p.total ? `<div class="pm-bar"><i style="width:${Math.round((p.reached / p.total) * 100)}%;background:${c}"></i></div>` : "";
				return frow(ICONS[k] || "doc", c, k, esc(v) + bar);
			}).join("")}</div>`;
		};
		const nav = (i, n, prev, next) => `<div class="pm-nav">
				<button class="btn btn-default btn-sm" data-act="step" data-i="${prev}">${ICON.left}${__("Previous")}</button>
				<span class="pm-sub">${i} / ${n}</span>
				<button class="btn btn-default btn-sm" data-act="step" data-i="${next}">${__("Next")}${ICON.right}</button>
			</div>`;
		const head = (num, c, sub, title, end) => `<div class="pm-hd">
				<div class="pm-num" style="background:${c}">${num}</div>
				<div><div class="pm-sub">${sub}</div><h4>${title}</h4></div>
				<div class="pm-hd-end">${end}</div>
			</div>`;

		function show(i) {
			team = null;
			cur = i;
			const s = steps[i], c = color[s.team], n = view.length, pos = view.indexOf(i);
			const ph = s.phase ? `${esc(__(s.phase))} · ` : "";
			const sub = ph + (focus ? __("Your part · step {0} of {1}", [pos + 1, n]) : `${esc(s.team)} · ${__("step {0} of {1}", [i + 1, n])}`);
			const open = s.open && frappe.model.can_read(s.open)
				? `<button class="btn btn-default btn-xs" data-act="open" data-dt="${esc(s.open)}">${__("Open {0}", [esc(s.open)])}</button>`
				: "";
			card.innerHTML = head(focus ? pos + 1 : i + 1, c, sub, esc(s.title), `${open}<span class="pm-pill" style="background:${c}14;color:${c}">${esc(s.team)}</span>`)
				+ `<div class="pm-bd">
					<div class="pm-col"><div class="pm-lbl">${__("What to do")}</div>${todo(s.todo, c)}${note(s)}</div>
					<div class="pm-col pm-side"><div class="pm-lbl">${__("Hand-off")}</div>${handoff(s)}</div>
				</div>`
				+ (n > 1 ? nav(pos + 1, n, view[(pos + n - 1) % n], view[(pos + 1) % n]) : "");
			marks();
		}

		function setTeam(t) {
			team = t;
			const c = color[t], mine = steps.map((s, i) => ({ s, i })).filter((o) => o.s.team === t);
			card.innerHTML = head(ICON.team, c, __("{0} steps in the cycle", [mine.length]), __("What {0} is responsible for", [esc(t)]), "")
				+ `<div class="pm-list">${mine.map((o) => `
					<div class="pm-grp">
						<div class="pm-gt" data-act="step" data-i="${o.i}"><span class="pm-mini" style="background:${c}">${o.i + 1}</span>${esc(o.s.title)}</div>
						${todo(o.s.todo, c)}${note(o.s)}
					</div>`).join("")}
				</div>`;
			marks();
		}

		function openText(r) {
			const who = team_of(r.waiting_on);
			if (r.is_scheduled && r.due_on) {
				return moment(r.due_on).isAfter(moment())
					? __("{0}, expected on {1}, in {2}", [__(r.stage), day(r.due_on), span(until(r.due_on))])
					: __("{0}, was expected on {1}, {2} late, waiting on {3}", [__(r.stage), day(r.due_on), span(hours(r.due_on)), who]);
			}
			const text = who ? __("{0}, waiting on {1} for {2}", [__(r.stage), who, span(hours(r.entered_on))]) : __(r.stage);
			return r.due_on && moment(r.due_on).isBefore(moment()) ? __("{0}, late since {1}", [text, when(r.due_on)]) : text;
		}

		const story = (s, p, c) => {
			const KIND = { "Opportunity": "Opportunity", "Project": "Project", "Project Estimation": "Estimation", "Supply Request": "Supply Request",
				"Project Planning": "Plan", "Project Overview": "Overview", "Project Invoicing": "Invoice" };
			const docs = p.documents || [];
			const docbox = docs.length ? `<div class="pm-lbl">${__("Documents")}</div><div class="pm-docs">${docs.map((d) => {
				const inner = `<span class="pm-doc-k">${esc(__(KIND[d.doctype] || d.doctype))}</span><b>${esc(d.name)}</b>`
					+ (d.stage ? `<span class="pm-doc-s${d.is_open ? " open" : ""}">${esc(__(d.stage))}</span>` : "");
				return frappe.model.can_read(d.doctype)
					? `<a class="pm-doc" data-act="doc" data-dt="${esc(d.doctype)}" data-dn="${esc(d.name)}">${inner}</a>`
					: `<span class="pm-doc">${inner}</span>`;
			}).join("")}</div>` : "";
			const ev = p.events || [];
			const shown = ev.slice(-12);
			const happened = ev.length ? `<div class="pm-lbl">${__("What happened")}</div><div class="pm-evs">`
				+ (ev.length > shown.length ? `<div class="pm-sub" style="padding-bottom:4px">${__("and {0} earlier", [ev.length - shown.length])}</div>` : "")
				+ shown.map((e) => {
					const move = e.previous_stage ? `${esc(__(e.previous_stage))} → ${esc(__(e.stage))}` : __("Started in {0}", [esc(__(e.stage))]);
					const stay = e.is_open ? __("still here, {0}", [span(hours(e.entered_on))]) : flt(e.duration_days) ? __("stayed {0}", [span(flt(e.duration_days) * 24)]) : "";
					const meta = [when(e.entered_on), e.by ? esc(e.by) : "", stay].filter(Boolean).join(" · ");
					const mark = e.is_open ? `border:2px solid ${c};background:var(--card-bg, #fff)` : `background:${c}`;
					return `<div class="pm-ev"><span class="pm-evd" style="${mark}"></span><div><div class="pm-evt">${e.reference_doctype && frappe.model.can_read(e.reference_doctype) ? `<a class="pm-link" data-act="doc" data-dt="${esc(e.reference_doctype)}" data-dn="${esc(e.reference_name)}">${esc(e.reference_name)}</a>` : `<b>${esc(e.reference_name)}</b>`} · ${move}</div><div class="pm-sub">${meta}</div></div></div>`;
				}).join("") + "</div>" : "";
			const ahead = ["now", "part", "todo"].includes(p.state)
				? `<div class="pm-lbl"${ev.length ? ' style="margin-top:14px"' : ""}>${p.state === "todo" ? __("What to do") : __("What to do next")}</div>${todo(s.todo, c)}${note(s)}`
				: "";
			return docbox + happened + ahead || `<div class="pm-sub">${__("Nothing recorded for this step")}</div>`;
		};

		function showProgress(i) {
			cur = i;
			const s = steps[i], p = s.progress, c = color[s.team], n = steps.length, b = BADGE[p.state];
			let since = (p.open[0] && p.open[0].entered_on) || p.started;  // the last entry, after a revision or a Return
			for (let k = i - 1; !since && k >= 0; k--) since = steps[k].progress.finished;
			const lines = [];
			const count = s.each && p.total ? [__("Progress"), __("{0} of {1} done", [p.reached, p.total])] : null;
			if (p.state === "done") {
				if (p.finished) {
					const spanned = p.started && p.started !== p.finished;
					if (spanned) lines.push([__("Started"), when(p.started)]);
					lines.push([__("Finished"), when(p.finished)]);
					if (spanned) lines.push([__("Took"), span(hours(p.started, p.finished))]);
				} else {
					lines.push([__("Done"), __("Before the records start")]);
				}
				if (count) lines.push(count);
			} else if (p.state === "now" || p.state === "part") {
				if (p.state === "now" && since) lines.push([__("Since"), `${when(since)} · ${span(hours(since))}`]);
				if (count) lines.push(count);
				p.open.forEach((r) => lines.push([r.reference_name, openText(r)]));
			} else if (p.state === "lost") {
				lines.push([__("Lost on"), when(data.ended_on)]);
				if ((data.lost_reasons || []).length) lines.push([__("Reason"), data.lost_reasons.map((r) => __(r)).join(", ")]);
			} else if (p.state === "skipped") {
				lines.push([__("Status"), __("Not needed for this project")]);
			} else {
				lines.push([__("Status"), __("Not reached yet")]);
			}
			card.innerHTML = head(i + 1, c, `${s.phase ? esc(__(s.phase)) + " · " : ""}${esc(s.team)} · ${__("step {0} of {1}", [i + 1, n])}`, esc(s.title), `<span class="indicator-pill ${b[1]}">${__(b[0])}</span>`)
				+ `<div class="pm-bd">
					<div class="pm-col">${story(s, p, c)}</div>
					<div class="pm-col pm-side"><div class="pm-lbl">${__("This project")}</div>${facts(lines, c, p)}</div>
				</div>`
				+ nav(i + 1, n, (i + n - 1) % n, (i + 1) % n);
			marks();
		}

		function drawExtras() {
			const nowEl = root.querySelector(".pm-now"), lg = root.querySelector(".pm-legend");
			nowEl.style.display = "none";
			lg.style.display = progress ? "" : "none";
			if (!progress) return;
			const k = steps.findIndex((s) => s.progress.state === "now");
			if (k >= 0) {
				const s = steps[k], p = s.progress, c = color[s.team];
				let since = (p.open[0] && p.open[0].entered_on) || p.started;  // the last entry, after a revision or a Return
				for (let j = k - 1; !since && j >= 0; j--) since = steps[j].progress.finished;
				const who = (p.open[0] && p.open[0].waiting_on) || s.team;
				nowEl.innerHTML = `<span class="pm-dot" style="background:${c}"></span><span><b>${__("Now")}:</b> ${k + 1}. ${esc(__(s.title))} · ${__("Waiting on {0}", [esc(__(who))])}${since ? " · " + span(hours(since)) : ""}</span>`;
				nowEl.dataset.act = "step";
				nowEl.dataset.i = k;
				nowEl.style.display = "";
			}
			const D = 2 * (R + 8), G = "#687178";
			const item = (st, label) => `<span class="pm-lg"><svg viewBox="0 0 ${D} ${D}"><g class="st ${st}">${dot(D / 2, D / 2, G, "", st)}</g></svg>${label}</span>`;
			lg.innerHTML = item("done", __("Done")) + item("now", __("Now")) + item("todo", __("Not yet")) + item("skipped", __("Not needed"))
				+ item("lost", __("Lost"))
				+ `<span class="pm-lg"><span class="pm-lg-count">2/5</span>${__("Documents done in a step with several")}</span>`;
		}

		if (root._pm_click) root.removeEventListener("click", root._pm_click);
		root._pm_click = (e) => {
			const el = e.target.closest("[data-act]");
			if (!el || !root.contains(el)) return;
			const { act, i, t, dt, dn } = el.dataset;
			if (act === "step") (progress ? showProgress : show)(+i);
			if (act === "team") t ? setTeam(t) : show(cur);
			if (act === "open") frappe.set_route("List", dt);
			if (act === "doc") frappe.set_route("Form", dt, dn);
		};
		root.addEventListener("click", root._pm_click);
		if (root._pm_resize) root._pm_resize.disconnect();
		root._pm_resize = new ResizeObserver(() => {
			const w = svg.parentElement.clientWidth;
			if (w === lastW) return;
			lastW = w;
			draw();
			marks();
		});
		root._pm_resize.observe(svg.parentElement);

		lastW = svg.parentElement.clientWidth;
		draw();
		drawChips();
		drawExtras();
		if (progress) {
			const now = steps.findIndex((s) => ["now", "lost"].includes(s.progress.state));
			let last = 0;
			steps.forEach((s, i) => {
				if (s.progress.state === "done") last = i;
			});
			showProgress(now >= 0 ? now : last);
		} else {
			show(view[0]);
		}
	}

	return { render };
})();
