// Manpower Category order and colors, shared by every screen that lists roles.
window.nexlify = window.nexlify || {};
(function (nx) {
	const PAL = ["#2490EF", "#20A39E", "#F59E0B", "#8B5CF6", "#EC4899", "#64748B"];
	const order = () => (frappe.boot && frappe.boot.nexlify_manpower_order) || [];
	nx.trade_rank = (t) => { const i = order().indexOf(t); return i < 0 ? 999 : i; };
	nx.trade_cmp = (a, b) => (nx.trade_rank(a) - nx.trade_rank(b)) || String(a || "").localeCompare(String(b || ""));
	nx.sort_trades = (list, key) => (list || []).slice().sort((a, b) => nx.trade_cmp(key ? a[key] : a, key ? b[key] : b));
	nx.trade_color = (t) => { const r = nx.trade_rank(t); return PAL[(r === 999 ? PAL.length - 1 : r) % PAL.length]; };
})(window.nexlify);
