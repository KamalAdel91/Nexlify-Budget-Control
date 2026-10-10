// Business Process Map: draws steps.json as one lane per team. The workspace block (process_map/process_map.js) and
// the Project Life form both call nexlify_process_map.render(root, data, opts). When every step carries a progress
// (get_life_map), each step is drawn as done, now, part done, not yet or skipped for that one project.
window.nexlify_process_map = (() => {
	const CSS = `
.pm { color: var(--text-color, #1f272e); padding: 4px 0 8px; }
.pm-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.pm-chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border-color, #ededed); background: var(--card-bg, #fff); color: var(--text-muted, #6c7680); border-radius: 999px; padding: 3px 11px; font-size: 12px; cursor: pointer; }
.pm-chip.on { color: var(--text-color, #1f272e); border-color: var(--text-muted, #6c7680); }
.pm-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.pm-map { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #ededed); border-radius: 12px; padding: 10px; overflow-x: auto; }
.pm-svg { display: block; width: 100%; min-width: 640px; }
.pm-svg .st { cursor: pointer; }
.pm-svg .st, .pm-svg .lane, .pm-svg .cn { transition: opacity .25s; }
.pm-svg .dim { opacity: .15; }
.pm-svg .halo { opacity: 0; transition: opacity .25s; }
.pm:not(.pm-progress) .pm-svg .st.on .halo, .pm-svg .st.now .halo { opacity: 1; }
.pm.pm-progress .pm-svg .st.on .core { stroke: var(--text-color, #1f272e) !important; stroke-width: 2.5; }
.pm-svg .st:hover .core { stroke-width: 4; }
@media (prefers-reduced-motion: no-preference) { .pm:not(.pm-progress) .pm-svg .st.on .halo, .pm-svg .st.now .halo { animation: pm-pulse 1.6s ease-in-out infinite; } }
@keyframes pm-pulse { 0%, 100% { opacity: .9; } 50% { opacity: .35; } }
.pm-prog { display: flex; gap: 4px; margin: 10px 0; }
.pm-seg { flex: 1; height: 5px; border-radius: 3px; cursor: pointer; transition: opacity .25s; }
.pm-card { background: var(--card-bg, #fff); border: 1px solid var(--border-color, #ededed); border-radius: 12px; overflow: hidden; }
.pm-loading { padding: 14px 16px; color: var(--text-muted, #6c7680); font-size: 13px; }
.pm-hd { padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
.pm-num { width: 32px; height: 32px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 600; flex: none; }
.pm-hd h4 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-color, #1f272e); }
.pm-sub { font-size: 12px; color: var(--text-muted, #6c7680); }
.pm-open { margin-left: auto; }
.pm-bd { padding: 4px 16px 14px; }
.pm-lbl { font-size: 12px; color: var(--text-light, #8d99a6); margin: 8px 0 4px; }
.pm-todo { list-style: none; margin: 0; padding: 0; }
.pm-todo li { display: flex; gap: 8px; font-size: 13px; line-height: 1.6; padding: 2px 0; }
.pm-check { flex: none; margin-top: 3px; }
.pm-note { display: flex; gap: 8px; align-items: flex-start; background: var(--bg-yellow, #fff7d3); color: var(--text-on-yellow, #5c4a00); border-radius: 8px; padding: 7px 12px; font-size: 12.5px; margin-top: 10px; }
.pm-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.pm-tile { background: var(--subtle-fg, #f8f8f8); border-radius: 8px; padding: 8px 11px; font-size: 13px; }
.pm-tile .pm-lbl { margin: 0 0 2px; }
.pm-ln { display: flex; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-color, #ededed); font-size: 13px; }
.pm-ln:last-child { border-bottom: 0; }
.pm-k { width: 160px; flex: none; color: var(--text-muted, #6c7680); }
.pm-nav { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
.pm-nav .btn { display: inline-flex; align-items: center; gap: 6px; }
.pm-grp { border-top: 1px solid var(--border-color, #ededed); padding-top: 10px; margin-top: 10px; }
.pm-grp:first-child { border-top: 0; margin-top: 0; }
.pm-gt { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; cursor: pointer; }
.pm-mini { width: 22px; height: 22px; border-radius: 50%; color: #fff; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; flex: none; }
`;
	const LH = 38, LANE = 34, R = 13, PAD = 24;
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
	const BADGE = { done: ["Done", "green"], now: ["Now", "orange"], part: ["Part done", "blue"], todo: ["Not yet", "gray"], skipped: ["Skipped", "gray"] };
	const SEG = { done: 1, now: 1, part: 0.6, todo: 0.2, skipped: 0.1 };

	function render(root, data, opts = {}) {
		const teams = data.teams || [], steps = data.steps || [];
		const progress = steps.length > 0 && !!steps[0].progress;
		root.classList.add("pm");
		root.classList.toggle("pm-progress", progress);
		root.innerHTML = `<style>${CSS}</style><div class="pm-chips"></div><div class="pm-map"><svg class="pm-svg"></svg></div><div class="pm-prog"></div><div class="pm-card"></div>`;
		const svg = root.querySelector(".pm-svg"), chips = root.querySelector(".pm-chips");
		const prog = root.querySelector(".pm-prog"), card = root.querySelector(".pm-card");
		const color = Object.fromEntries(teams.map((t) => [t.name, t.color]));
		const lane = Object.fromEntries(teams.map((t, k) => [t.name, k]));
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
		const state = (i) => (progress ? steps[i].progress.state : "done");
		const width = () => Math.max(svg.parentElement.clientWidth - 20, 640);
		const marker = (id, c) =>
			`<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
		const pill = (t, c, cy) =>
			`<rect x="8" y="${cy - 11}" width="${t.length * 7 + 30}" height="22" rx="11" fill="${c}" fill-opacity=".14"/>`
			+ `<circle cx="20" cy="${cy}" r="4" fill="${c}"/>`
			+ `<text x="30" y="${cy}" dominant-baseline="central" style="font-size:12px;font-weight:600;fill:${c}">${esc(t)}</text>`;
		const dot = (x, y, c, label, st) => {
			const txt = (fill) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" style="font-size:11px;font-weight:600;fill:${fill};pointer-events:none">${label}</text>`;
			const halo = `<circle class="halo" cx="${x}" cy="${y}" r="${R + 6}" fill="${c}" fill-opacity=".22"/>`;
			const ring = (extra) => `<circle class="core" cx="${x}" cy="${y}" r="${R}" ${extra}/>`;
			if (st === "todo") return halo + ring(`style="fill:var(--card-bg, #fff)" stroke="${c}" stroke-width="1.5"`) + txt(c);
			if (st === "skipped") {
				return halo + ring('style="fill:var(--card-bg, #fff);stroke:var(--text-light, #8d99a6)" stroke-width="1.5" stroke-dasharray="3 3"')
					+ txt("var(--text-light, #8d99a6)");
			}
			if (st === "part") {
				return halo + ring(`style="fill:var(--card-bg, #fff)" stroke="${c}" stroke-width="2"`)
					+ `<path d="M${x} ${y - R + 2} A${R - 2} ${R - 2} 0 0 1 ${x} ${y + R - 2} Z" fill="${c}" fill-opacity=".55" style="pointer-events:none"/>`
					+ txt("var(--text-color, #1f272e)");
			}
			return halo + ring(`fill="${c}" style="stroke:var(--card-bg, #fff)" stroke-width="3"`) + txt("#fff");
		};

		function drawMap() {
			const W = width();
			const labelW = Math.max(...teams.map((t) => t.name.length * 7 + 30));
			const X0 = 8 + labelW + PAD + R, X1 = W - PAD - R;
			const dx = (X1 - X0) / Math.max(steps.length - 1, 1);
			const P = steps.map((s, i) => ({ x: X0 + dx * i, y: lane[s.team] * LH + 2 + LANE / 2 }));
			const reached = (i) => ["done", "now", "part"].includes(state(i));
			const curve = (a, b, from, dashed, muted) => {
				const x1 = a.x + R, x2 = b.x - R - 3, m = (x1 + x2) / 2;
				const stroke = muted ? 'style="stroke:var(--border-color, #d1d8dd)"' : `stroke="${color[from.team]}" stroke-opacity=".75"`;
				return `<path class="cn" d="M${x1} ${a.y} C${m} ${a.y},${m} ${b.y},${x2} ${b.y}" fill="none" ${stroke} stroke-width="1.5"`
					+ `${dashed ? ' stroke-dasharray="4 4"' : ""}${muted ? "" : ` marker-end="url(#pm-ah-${lane[from.team]})"`}/>`;
			};
			let h = "<defs>" + teams.map((t, k) => marker(`pm-ah-${k}`, t.color)).join("") + "</defs>";
			teams.forEach((t, k) => {
				const y = k * LH + 2;
				h += `<g class="lane" data-t="${esc(t.name)}"><rect x="0" y="${y}" width="${W}" height="${LANE}" rx="8" fill="${t.color}" fill-opacity=".06"/>${pill(t.name, t.color, y + LANE / 2)}</g>`;
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
				h += `<g class="st${progress ? " " + st : ""}" data-act="step" data-i="${i}"><title>${i + 1}. ${esc(s.title)}${progress ? " · " + __(BADGE[st][0]) : ""}</title>`
					+ `${dot(P[i].x, P[i].y, color[s.team], i + 1, st)}</g>`;
			});
			const H = teams.length * LH + 2;
			svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
			svg.style.height = `${H}px`;
			svg.innerHTML = h;
		}

		function drawFocus() {
			const W = width(), c = color[focus], H = 92, cy = 36;
			const X0 = 8 + focus.length * 7 + 30 + PAD + 80, X1 = W - PAD - 80;
			const n = view.length, dx = n > 1 ? (X1 - X0) / (n - 1) : 0;
			const xs = view.map((_, k) => (n > 1 ? X0 + dx * k : (X0 + X1) / 2));
			let h = `<defs>${marker("pm-ah-f", c)}</defs>`
				+ `<rect x="0" y="2" width="${W}" height="${H - 4}" rx="10" fill="${c}" fill-opacity=".06"/>${pill(focus, c, cy)}`;
			for (let k = 0; k < n - 1; k++) {
				h += `<line class="cn" x1="${xs[k] + R + 4}" y1="${cy}" x2="${xs[k + 1] - R - 6}" y2="${cy}" stroke="${c}" stroke-opacity=".6" stroke-width="1.5" marker-end="url(#pm-ah-f)"/>`;
			}
			view.forEach((i, k) => {
				h += `<g class="st" data-act="step" data-i="${i}"><title>${esc(steps[i].title)}</title>${dot(xs[k], cy, c, k + 1, "done")}`
					+ `<text x="${xs[k]}" y="${cy + R + 18}" text-anchor="middle" dominant-baseline="central" style="font-size:12px;fill:var(--text-color, #1f272e)">${esc(steps[i].title)}</text></g>`;
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
				g.style.opacity = progress ? SEG[state(i)] : team ? (steps[i].team === team ? 1 : 0.15) : view.indexOf(i) <= view.indexOf(cur) ? 1 : 0.25;
			});
			root.querySelectorAll(".pm-chip").forEach((b) => b.classList.toggle("on", (b.dataset.t || null) === team));
		}

		const todo = (list, c) => `<ul class="pm-todo">${list.map((x) => `<li>${ICON.check(c)}<span>${esc(x)}</span></li>`).join("")}</ul>`;
		const nav = (i, n, prev, next) => `<div class="pm-nav">
				<button class="btn btn-default btn-sm" data-act="step" data-i="${prev}">${ICON.left}${__("Previous")}</button>
				<span class="pm-sub">${i} / ${n}</span>
				<button class="btn btn-default btn-sm" data-act="step" data-i="${next}">${__("Next")}${ICON.right}</button>
			</div>`;

		function show(i) {
			team = null;
			cur = i;
			const s = steps[i], c = color[s.team], n = view.length, pos = view.indexOf(i);
			const sub = focus ? __("Your part · step {0} of {1}", [pos + 1, n]) : `${esc(s.team)} · ${__("step {0} of {1}", [i + 1, n])}`;
			const open = s.open && frappe.model.can_read(s.open)
				? `<button class="btn btn-default btn-xs pm-open" data-act="open" data-dt="${esc(s.open)}">${__("Open {0}", [esc(s.open)])}</button>`
				: "";
			card.innerHTML = `
				<div class="pm-hd" style="background:${c}14">
					<div class="pm-num" style="background:${c}">${pos + 1}</div>
					<div><div class="pm-sub">${sub}</div><h4>${esc(s.title)}</h4></div>
					${open}
				</div>
				<div class="pm-bd">
					<div class="pm-lbl">${__("What to do")}</div>
					${todo(s.todo, c)}
					${s.note ? `<div class="pm-note">${ICON.info}<span>${esc(s.note)}</span></div>` : ""}
					<div class="pm-tiles">
						<div class="pm-tile"><div class="pm-lbl">${__("Receives")}</div>${esc(s.receives)}</div>
						<div class="pm-tile"><div class="pm-lbl">${__("Hands to")}</div>${esc(s.hands_to)}</div>
						<div class="pm-tile"><div class="pm-lbl">${__("Status after")}</div>${esc(s.status_after || "—")}${s.status_doctype ? `<div class="pm-sub">${esc(s.status_doctype)}</div>` : ""}</div>
					</div>
					${n > 1 ? nav(pos + 1, n, view[(pos + n - 1) % n], view[(pos + 1) % n]) : ""}
				</div>`;
			marks();
		}

		function setTeam(t) {
			team = t;
			const c = color[t], mine = steps.map((s, i) => ({ s, i })).filter((o) => o.s.team === t);
			card.innerHTML = `
				<div class="pm-hd" style="background:${c}14">
					<div class="pm-num" style="background:${c}">${ICON.team}</div>
					<div><div class="pm-sub">${__("{0} steps in the cycle", [mine.length])}</div><h4>${__("What {0} is responsible for", [esc(t)])}</h4></div>
				</div>
				<div class="pm-bd">${mine.map((o) => `
					<div class="pm-grp">
						<div class="pm-gt" data-act="step" data-i="${o.i}"><span class="pm-mini" style="background:${c}">${o.i + 1}</span>${esc(o.s.title)}</div>
						${todo(o.s.todo, c)}
						${o.s.note ? `<div class="pm-note">${ICON.info}<span>${esc(o.s.note)}</span></div>` : ""}
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

		function showProgress(i) {
			cur = i;
			const s = steps[i], p = s.progress, c = color[s.team], n = steps.length, b = BADGE[p.state];
			let since = p.started;
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
			} else if (p.state === "skipped") {
				lines.push([__("Status"), __("Not needed for this project")]);
			} else {
				lines.push([__("Status"), __("Not reached yet")]);
			}
			card.innerHTML = `
				<div class="pm-hd" style="background:${c}14">
					<div class="pm-num" style="background:${c}">${i + 1}</div>
					<div><div class="pm-sub">${esc(s.team)} · ${__("step {0} of {1}", [i + 1, n])}</div><h4>${esc(s.title)}</h4></div>
					<span class="indicator-pill ${b[1]} pm-open">${__(b[0])}</span>
				</div>
				<div class="pm-bd">
					${lines.map((l) => `<div class="pm-ln"><span class="pm-k">${esc(l[0])}</span><span>${esc(l[1])}</span></div>`).join("")}
					${nav(i + 1, n, (i + n - 1) % n, (i + 1) % n)}
				</div>`;
			marks();
		}

		if (root._pm_click) root.removeEventListener("click", root._pm_click);
		root._pm_click = (e) => {
			const el = e.target.closest("[data-act]");
			if (!el || !root.contains(el)) return;
			const { act, i, t, dt } = el.dataset;
			if (act === "step") (progress ? showProgress : show)(+i);
			if (act === "team") t ? setTeam(t) : show(cur);
			if (act === "open") frappe.set_route("List", dt);
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
		if (progress) {
			const now = steps.findIndex((s) => s.progress.state === "now");
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
