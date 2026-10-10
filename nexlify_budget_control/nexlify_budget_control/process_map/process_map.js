const METHOD = "nexlify_budget_control.nexlify_budget_control.process_map.process_map.get_process_map";
const LH = 38, LANE = 34, R = 13, PAD = 24;
const svg = root_element.querySelector(".pm-svg");
const chips = root_element.querySelector(".pm-chips");
const prog = root_element.querySelector(".pm-prog");
const card = root_element.querySelector(".pm-card");
const esc = (v) => frappe.utils.escape_html(String(v ?? ""));
const norm = (v) => String(v || "").toLowerCase().replace(/[-_\s]+/g, " ").trim();
const icon = (body, size, stroke, cls = "") =>
	`<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
	check: (c) => icon('<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>', 15, c, "pm-check"),
	info: icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>', 15, "currentColor", "pm-check"),
	team: icon('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.8-1.8-5.1-4.3-5.8"/>', 16, "#fff"),
	left: icon('<path d="M15 6l-6 6 6 6"/>', 14, "currentColor"),
	right: icon('<path d="M9 6l6 6-6 6"/>', 14, "currentColor"),
};
let teams = [], steps = [], color = {}, lane = {}, view = [], cur = 0, team = null, focus = null, lastW = 0;

const marker = (id, c) =>
	`<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M2 1L8 5L2 9" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
const dot = (x, y, c, label, i) =>
	`<circle class="halo" cx="${x}" cy="${y}" r="${R + 6}" fill="${c}" fill-opacity=".22"/>`
	+ `<circle class="core" cx="${x}" cy="${y}" r="${R}" fill="${c}" style="stroke:var(--card-bg, #fff)" stroke-width="3"/>`
	+ `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" style="font-size:11px;font-weight:600;fill:#fff;pointer-events:none">${label}</text>`;
const pill = (t, c, cy) =>
	`<rect x="8" y="${cy - 11}" width="${t.length * 7 + 30}" height="22" rx="11" fill="${c}" fill-opacity=".14"/>`
	+ `<circle cx="20" cy="${cy}" r="4" fill="${c}"/>`
	+ `<text x="30" y="${cy}" dominant-baseline="central" style="font-size:12px;font-weight:600;fill:${c}">${esc(t)}</text>`;
const width = () => Math.max(svg.parentElement.clientWidth - 20, 640);

function drawMap() {
	const W = width();
	const labelW = Math.max(...teams.map((t) => t.name.length * 7 + 30));
	const X0 = 8 + labelW + PAD + R, X1 = W - PAD - R;
	const dx = (X1 - X0) / Math.max(steps.length - 1, 1);
	const P = steps.map((s, i) => ({ x: X0 + dx * i, y: lane[s.team] * LH + 2 + LANE / 2 }));
	const curve = (a, b, from, dashed) => {
		const x1 = a.x + R, x2 = b.x - R - 3, m = (x1 + x2) / 2;
		return `<path class="cn" d="M${x1} ${a.y} C${m} ${a.y},${m} ${b.y},${x2} ${b.y}" fill="none" stroke="${color[from.team]}" stroke-opacity=".75" stroke-width="1.5"${dashed ? ' stroke-dasharray="4 4"' : ""} marker-end="url(#pm-ah-${lane[from.team]})"/>`;
	};
	let h = "<defs>" + teams.map((t, k) => marker(`pm-ah-${k}`, t.color)).join("") + "</defs>";
	teams.forEach((t, k) => {
		const y = k * LH + 2;
		h += `<g class="lane" data-t="${esc(t.name)}"><rect x="0" y="${y}" width="${W}" height="${LANE}" rx="8" fill="${t.color}" fill-opacity=".06"/>${pill(t.name, t.color, y + LANE / 2)}</g>`;
	});
	for (let i = 0; i < steps.length - 1; i++) h += curve(P[i], P[i + 1], steps[i], false);
	steps.forEach((s, i) => {
		if (s.optional && i > 0 && i < steps.length - 1) h += curve(P[i - 1], P[i + 1], steps[i - 1], true);
	});
	steps.forEach((s, i) => {
		h += `<g class="st" data-act="step" data-i="${i}"><title>${i + 1}. ${esc(s.title)}</title>${dot(P[i].x, P[i].y, color[s.team], i + 1)}</g>`;
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
		h += `<g class="st" data-act="step" data-i="${i}"><title>${esc(steps[i].title)}</title>${dot(xs[k], cy, c, k + 1)}`
			+ `<text x="${xs[k]}" y="${cy + R + 18}" text-anchor="middle" dominant-baseline="central" style="font-size:12px;fill:var(--text-color, #1f272e)">${esc(steps[i].title)}</text></g>`;
	});
	svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
	svg.style.height = `${H}px`;
	svg.innerHTML = h;
}

function draw() {
	focus ? drawFocus() : drawMap();
}

function drawChips() {
	chips.innerHTML = focus ? "" : `<button class="pm-chip" data-act="team" data-t="">Walk the process</button>`
		+ teams.map((t) => `<button class="pm-chip" data-act="team" data-t="${esc(t.name)}"><span class="pm-dot" style="background:${t.color}"></span>${esc(t.name)}</button>`).join("");
	chips.style.display = focus ? "none" : "";
	prog.innerHTML = view.map((i) =>
		`<div class="pm-seg" data-act="step" data-i="${i}" title="${esc(steps[i].title)}" style="background:${color[steps[i].team]}"></div>`
	).join("");
}

function marks() {
	root_element.querySelectorAll(".pm-svg .st").forEach((g) => {
		const i = +g.dataset.i;
		g.classList.toggle("dim", !!team && steps[i].team !== team);
		g.classList.toggle("on", !team && i === cur);
	});
	root_element.querySelectorAll(".pm-svg .lane").forEach((g) => g.classList.toggle("dim", !!team && g.dataset.t !== team));
	root_element.querySelectorAll(".pm-svg .cn").forEach((g) => g.classList.toggle("dim", !!team));
	root_element.querySelectorAll(".pm-seg").forEach((g) => {
		const i = +g.dataset.i;
		g.style.opacity = team ? (steps[i].team === team ? 1 : 0.15) : view.indexOf(i) <= view.indexOf(cur) ? 1 : 0.25;
	});
	root_element.querySelectorAll(".pm-chip").forEach((b) => b.classList.toggle("on", (b.dataset.t || null) === team));
}

function todo(list, c) {
	return `<ul class="pm-todo">${list.map((x) => `<li>${ICON.check(c)}<span>${esc(x)}</span></li>`).join("")}</ul>`;
}

function show(i) {
	team = null;
	cur = i;
	const s = steps[i], c = color[s.team], n = view.length, pos = view.indexOf(i);
	const sub = focus ? `Your part · step ${pos + 1} of ${n}` : `${esc(s.team)} · step ${i + 1} of ${n}`;
	const open = s.open && frappe.model.can_read(s.open)
		? `<button class="btn btn-default btn-xs pm-open" data-act="open" data-dt="${esc(s.open)}">Open ${esc(s.open)}</button>`
		: "";
	card.innerHTML = `
		<div class="pm-hd" style="background:${c}14">
			<div class="pm-num" style="background:${c}">${pos + 1}</div>
			<div><div class="pm-sub">${sub}</div><h4>${esc(s.title)}</h4></div>
			${open}
		</div>
		<div class="pm-bd">
			<div class="pm-lbl">What to do</div>
			${todo(s.todo, c)}
			${s.note ? `<div class="pm-note">${ICON.info}<span>${esc(s.note)}</span></div>` : ""}
			<div class="pm-tiles">
				<div class="pm-tile"><div class="pm-lbl">Receives</div>${esc(s.receives)}</div>
				<div class="pm-tile"><div class="pm-lbl">Hands to</div>${esc(s.hands_to)}</div>
				<div class="pm-tile"><div class="pm-lbl">Status after</div>${esc(s.status_after || "—")}${s.status_doctype ? `<div class="pm-sub">${esc(s.status_doctype)}</div>` : ""}</div>
			</div>
			${n > 1 ? `<div class="pm-nav">
				<button class="btn btn-default btn-sm" data-act="step" data-i="${view[(pos + n - 1) % n]}">${ICON.left}Previous</button>
				<span class="pm-sub">${pos + 1} / ${n}</span>
				<button class="btn btn-default btn-sm" data-act="step" data-i="${view[(pos + 1) % n]}">Next${ICON.right}</button>
			</div>` : ""}
		</div>`;
	marks();
}

function setTeam(t) {
	team = t;
	const c = color[t], mine = steps.map((s, i) => ({ s, i })).filter((o) => o.s.team === t);
	card.innerHTML = `
		<div class="pm-hd" style="background:${c}14">
			<div class="pm-num" style="background:${c}">${ICON.team}</div>
			<div><div class="pm-sub">${mine.length} step${mine.length > 1 ? "s" : ""} in the cycle</div><h4>What ${esc(t)} is responsible for</h4></div>
		</div>
		<div class="pm-bd">${mine.map((o) => `
			<div class="pm-grp">
				<div class="pm-gt" data-act="step" data-i="${o.i}"><span class="pm-mini" style="background:${c}">${o.i + 1}</span>${esc(o.s.title)}</div>
				${todo(o.s.todo, c)}
			</div>`).join("")}
		</div>`;
	marks();
}

root_element.addEventListener("click", (e) => {
	const el = e.target.closest("[data-act]");
	if (!el) return;
	const { act, i, t, dt } = el.dataset;
	if (act === "step") show(+i);
	if (act === "team") t ? setTeam(t) : show(cur);
	if (act === "open") frappe.set_route("List", dt);
});

new ResizeObserver(() => {
	const w = svg.parentElement.clientWidth;
	if (!steps.length || w === lastW) return;
	lastW = w;
	draw();
	marks();
}).observe(svg.parentElement);

frappe
	.xcall(METHOD)
	.then((data) => {
		teams = data.teams;
		steps = data.steps;
		color = Object.fromEntries(teams.map((t) => [t.name, t.color]));
		lane = Object.fromEntries(teams.map((t, k) => [t.name, k]));
		steps.forEach((s, i) => s.status_after || console.warn(`Business Process Map: no status found for step ${i + 1} (${s.title})`));
		const route = frappe.get_route() || [];
		const here = teams.find((t) => t.workspace && norm(t.workspace) === norm(route[route.length - 1]));
		const mine = here ? steps.map((_, i) => i).filter((i) => steps[i].team === here.name) : [];
		focus = mine.length ? here.name : null;
		view = focus ? mine : steps.map((_, i) => i);
		lastW = svg.parentElement.clientWidth;
		draw();
		drawChips();
		show(view[0]);
	})
	.catch(() => {
		card.innerHTML = `<div class="pm-loading">Couldn't load the business process.</div>`;
	});
