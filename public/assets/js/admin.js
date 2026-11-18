/* MPM Digital — admin dashboard */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "R" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, " ");
  const money0 = (n) => "R" + Math.round(Number(n || 0)).toLocaleString("en-US").replace(/,/g, " ");
  const int = (n) => Math.round(Number(n || 0)).toLocaleString("en-US").replace(/,/g, " ");
  const pct = (n, d = 1) => (Number(n || 0) * 100).toFixed(d) + "%";
  const date = (s) => s ? new Date(s.replace(" ", "T") + "Z").toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const dateOnly = (s) => s ? new Date(s.replace(" ", "T") + "Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "";
  const dayLabel = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
  const ICONS = window.MPM_ICONS || {};

  // Chart colours (validated: lightness, chroma, colour-blind separation, contrast on white)
  const C1 = "#C2185B", C2 = "#7E57C2";

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, { method, credentials: "same-origin", headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "X-Requested-With": "mpm" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
    return data;
  }
  let toastT;
  const toast = (m) => { const t = $("#toast"); t.innerHTML = `<span>${esc(m)}</span>`; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3000); };

  const ORDER_STATUS = { pending_payment: "Awaiting payment", paid: "Paid", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
  const MSG_STATUS = { new: "New", replied: "Replied", closed: "Closed" };
  const PAY_STATUS = { unpaid: "Unpaid", paid: "Paid", on_account: "On account", refunded: "Refunded" };
  const PAY_METHOD = { eft: "EFT", card: "Card", "instant-eft": "Instant EFT", account: "30-day account" };
  const TRADE = { none: "None", pending: "Pending", approved: "Approved", rejected: "Rejected" };
  const pill = (s, map) => `<span class="pill s-${esc(s)}">${esc(map[s] || s)}</span>`;
  const tradePill = (s) => pill(s === "approved" ? "delivered" : s === "rejected" ? "cancelled" : s === "pending" ? "pending_payment" : "none", { delivered: "Approved", cancelled: "Rejected", pending_payment: "Pending", none: "None" });

  let me = null, tab = "overview", cache = {}, range = 30, storeSettings = null, storeUrl = "";

  /* ================================================================ charts */
  const tip = $("#chTip");
  function showTip(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY - r.height - 12;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y < 8) y = e.clientY + 16;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  const niceMax = (v) => { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
  const tableView = (cols, rows) => `<details class="tview"><summary>View as table</summary><div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr>${cols.map((c) => `<th${c.num ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td${c.num ? ' class="num"' : ""}>${c.fmt ? c.fmt(r[c.key], r) : esc(r[c.key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;

  /** Bar chart over days. series: [{key, label, color}] (1 = single, 2 = stacked). */
  function barChart(el, data, series, fmt) {
    const W = 760, H = 240, padL = 56, padR = 10, padT = 12, padB = 28;
    const totals = data.map((d) => series.reduce((a, s) => a + (d[s.key] || 0), 0));
    const max = niceMax(Math.max(...totals, 0));
    const iw = W - padL - padR, ih = H - padT - padB, n = data.length;
    const slot = iw / n, bw = Math.max(2, Math.min(28, slot - Math.max(2, slot * 0.28)));
    const y = (v) => padT + ih - (v / max) * ih;
    let grid = "";
    for (let i = 0; i <= 4; i++) { const v = (max / 4) * i, yy = y(v); grid += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="ch-grid"/><text x="${padL - 8}" y="${yy + 4}" class="ch-ax" text-anchor="end">${esc(fmt(v, true))}</text>`; }
    const every = Math.ceil(n / 7);
    let bars = "", xl = "";
    data.forEach((d, i) => {
      const x = padL + i * slot + (slot - bw) / 2;
      let base = 0;
      series.forEach((s, si) => {
        const v = d[s.key] || 0; if (v <= 0) return;
        const top = y(base + v), bottom = y(base), h = Math.max(1, bottom - top - (si > 0 ? 2 : 0));
        const r = Math.min(4, bw / 2, h);
        const isTop = series.slice(si + 1).every((s2) => !(d[s2.key] > 0));
        bars += isTop
          ? `<path d="M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + h} Z" fill="${s.color}"/>`
          : `<rect x="${x}" y="${top}" width="${bw}" height="${h}" fill="${s.color}"/>`;
        base += v;
      });
      bars += `<rect x="${padL + i * slot}" y="${padT}" width="${slot}" height="${ih}" fill="transparent" class="ch-hit" data-i="${i}"/>`;
      if (i % every === 0 || i === n - 1) xl += `<text x="${padL + i * slot + slot / 2}" y="${H - 8}" class="ch-ax" text-anchor="middle">${esc(dayLabel(d.day))}</text>`;
    });
    el.innerHTML = `${series.length > 1 ? `<div class="ch-legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join("")}</div>` : ""}
      <svg viewBox="0 0 ${W} ${H}" class="ch" role="img" aria-label="${esc(series.map((s) => s.label).join(" and "))} by day">${grid}<line x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}" class="ch-base"/>${bars}${xl}</svg>
      ${tableView([{ key: "day", label: "Day", fmt: (v) => esc(dayLabel(v)) }, ...series.map((s) => ({ key: s.key, label: s.label, num: true, fmt: (v) => esc(fmt(v || 0)) }))], data)}`;
    $$(".ch-hit", el).forEach((h) => {
      h.addEventListener("mousemove", (e) => { const d = data[+h.dataset.i]; showTip(e, `<b>${esc(dayLabel(d.day))}</b>${series.map((s) => `<div><i style="background:${s.color}"></i>${esc(s.label)} <b>${esc(fmt(d[s.key] || 0))}</b></div>`).join("")}${series.length > 1 ? `<div class="t-sum">Total <b>${esc(fmt(totals[+h.dataset.i]))}</b></div>` : ""}`); });
      h.addEventListener("mouseleave", hideTip);
    });
  }

  /** Single-series line chart over days, with crosshair tooltip. */
  function lineChart(el, data, key, label, fmt) {
    const W = 760, H = 220, padL = 46, padR = 12, padT = 12, padB = 28;
    const max = niceMax(Math.max(...data.map((d) => d[key] || 0), 0));
    const iw = W - padL - padR, ih = H - padT - padB, n = data.length;
    const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw), y = (v) => padT + ih - (v / max) * ih;
    let grid = "";
    for (let i = 0; i <= 4; i++) { const v = (max / 4) * i, yy = y(v); grid += `<line x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}" class="ch-grid"/><text x="${padL - 8}" y="${yy + 4}" class="ch-ax" text-anchor="end">${esc(fmt(v, true))}</text>`; }
    const pts = data.map((d, i) => `${x(i)},${y(d[key] || 0)}`);
    const every = Math.ceil(n / 7);
    const xl = data.map((d, i) => (i % every === 0 || i === n - 1 ? `<text x="${x(i)}" y="${H - 8}" class="ch-ax" text-anchor="middle">${esc(dayLabel(d.day))}</text>` : "")).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="ch" role="img" aria-label="${esc(label)} by day">${grid}
      <path d="M${pts[0]} L${pts.join(" L")} L${x(n - 1)},${padT + ih} L${x(0)},${padT + ih} Z" fill="${C1}" opacity=".08"/>
      <polyline points="${pts.join(" ")}" fill="none" stroke="${C1}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line class="ch-cross" x1="0" x2="0" y1="${padT}" y2="${padT + ih}" visibility="hidden"/>
      <circle class="ch-dot" r="5" fill="${C1}" stroke="#fff" stroke-width="2" visibility="hidden"/>
      <rect x="${padL}" y="${padT}" width="${iw}" height="${ih}" fill="transparent" class="ch-area"/>${xl}</svg>
      ${tableView([{ key: "day", label: "Day", fmt: (v) => esc(dayLabel(v)) }, { key, label, num: true, fmt: (v) => esc(fmt(v || 0)) }], data)}`;
    const svg = $("svg", el), area = $(".ch-area", el), cross = $(".ch-cross", el), dot = $(".ch-dot", el);
    area.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect(), sx = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((sx - padL) / iw) * (n - 1))));
      const d = data[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(d[key] || 0)); dot.setAttribute("visibility", "visible");
      showTip(e, `<b>${esc(dayLabel(d.day))}</b><div><i style="background:${C1}"></i>${esc(label)} <b>${esc(fmt(d[key] || 0))}</b></div>`);
    });
    area.addEventListener("mouseleave", () => { hideTip(); cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); });
  }

  /** Ranked horizontal bars (HTML). */
  function hbars(rows, labelFn, valueKey, fmt, emptyMsg = "No data yet for this period.") {
    if (!rows.length) return `<p class="empty-note">${emptyMsg}</p>`;
    const max = Math.max(...rows.map((r) => r[valueKey] || 0), 1);
    return `<div class="hbars">${rows.map((r) => `<div class="hb"><div class="hb-top"><span>${labelFn(r)}</span><b>${esc(fmt(r[valueKey] || 0))}</b></div><div class="hb-track"><i style="width:${Math.max(1.5, ((r[valueKey] || 0) / max) * 100)}%"></i></div></div>`).join("")}</div>`;
  }

  const delta = (cur, prev, invert) => {
    if (!prev) return cur ? `<span class="d up">New this period</span>` : `<span class="d">No change</span>`;
    const ch = (cur - prev) / prev;
    const up = ch >= 0;
    return `<span class="d ${up !== !!invert ? "up" : "down"}">${up ? "▲" : "▼"} ${Math.abs(ch * 100).toFixed(0)}% <small>vs previous ${range} days</small></span>`;
  };
  const rangePicker = () => `<div class="seg" id="range" role="group" aria-label="Date range">${[7, 30, 90, 365].map((d) => `<button type="button" data-range="${d}" class="${d === range ? "on" : ""}">${d === 365 ? "12 months" : d + " days"}</button>`).join("")}</div>`;
  const bindRange = (fn) => $("#range")?.addEventListener("click", (e) => { const b = e.target.closest("[data-range]"); if (b) { range = +b.dataset.range; fn(); } });

  /* ================================================================ auth & nav */
  async function boot() {
    try { me = (await api("/api/me")).user; } catch { me = null; }
    if (!me || me.role !== "admin") {
      $("#login").hidden = false; $("#shell").hidden = true;
      if (me) $("#loginErr").textContent = "This account isn't an admin. Sign in with an admin account.";
      return;
    }
    $("#login").hidden = true; $("#shell").hidden = false;
    $("#meName").textContent = me.email;
    try { storeUrl = (await api("/api/admin/meta")).storeUrl || ""; } catch { /* ignore */ }
    show(location.hash.slice(1) || "overview");
    refreshBadges();
  }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("#loginErr").textContent = "";
    try { await api("/api/auth/login", { method: "POST", body: Object.fromEntries(new FormData(e.currentTarget)) }); boot(); }
    catch (err) { $("#loginErr").textContent = err.message; }
  });
  $("#logout").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.reload(); });

  const TABS = { overview, traffic, sales, finances, orders: () => orders("order"), messages: () => orders("msg"), products, inventory, categories, discounts, customers, trade, subscribers, settings, team };
  $("#aNav").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab); });
  function show(t) {
    tab = TABS[t] ? t : "overview";
    history.replaceState(null, "", "#" + tab);
    $$("#aNav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    hideTip(); closeDrawer(); TABS[tab]();
  }
  async function refreshBadges() {
    try {
      const s = await api("/api/admin/summary");
      $("#bOrders").textContent = s.awaitingPayment + s.toFulfil || "";
      $("#bMsgs").textContent = s.newMessages || "";
      $("#bTrade").textContent = s.pendingTrade || "";
      $("#bStock").textContent = s.lowStock.length || "";
      return s;
    } catch { return null; }
  }
  const main = (html) => { $("#main").innerHTML = html; };
  const loading = (title) => main(`<div class="a-head"><div><h1>${title}</h1><p>Loading…</p></div></div>`);
  const fail = (err) => { if (err.status === 401 || err.status === 403) return boot(); main(`<div class="panel"><p class="empty-note">${esc(err.message)}</p></div>`); };
  const head = (title, sub, tools = "") => `<div class="a-head"><div><h1>${title}</h1><p>${sub}</p></div>${tools ? `<div class="a-tools">${tools}</div>` : ""}</div>`;

  /* ================================================================ dashboard */
  async function overview() {
    loading("Dashboard");
    try {
      const [s, a] = await Promise.all([refreshBadges(), api(`/api/admin/analytics?days=${range}`)]);
      if (!s) throw new Error("Couldn't load the dashboard.");
      const c = a.current, p = a.previous;
      const att = [
        [s.awaitingPayment, "orders awaiting payment", "orders"], [s.toFulfil, "orders to pack & ship", "orders"],
        [s.newMessages, "new quotes / messages", "messages"], [s.pendingTrade, "trade applications to review", "trade"],
        [s.lowStock.length, "products low on stock", "products"],
      ].filter(([n]) => n > 0);
      main(`${head(`Hi${me.name && me.name !== "Store admin" ? ", " + esc(me.name.split(" ")[0]) : ""} 👋`, "Here's how the store is doing.", `${rangePicker()}${storeUrl ? `<a class="btn btn-ghost btn-sm" href="${esc(storeUrl)}" target="_blank" rel="noopener">View shop ↗</a>` : ""}`)}
        <div class="tiles">
          <div class="tile hl"><small>Revenue</small><strong>${money0(c.revenue)}</strong>${delta(c.revenue, p.revenue)}</div>
          <div class="tile"><small>Orders</small><strong>${int(c.orders)}</strong>${delta(c.orders, p.orders)}</div>
          <div class="tile"><small>Visitors</small><strong>${int(c.visitors)}</strong>${delta(c.visitors, p.visitors)}</div>
          <div class="tile"><small>Conversion rate</small><strong>${pct(c.conversion)}</strong>${delta(c.conversion, p.conversion)}</div>
          <div class="tile"><small>Average order</small><strong>${money0(c.aov)}</strong>${delta(c.aov, p.aov)}</div>
        </div>
        <div class="a-cols">
          <div class="panel"><h2>Revenue per day <small>incl. VAT, excl. cancelled</small></h2><div class="chart" id="chRev"></div></div>
          <div class="panel"><h2>Needs your attention</h2>${att.length ? `<div class="att">${att.map(([n, l, t]) => `<button type="button" data-goto="${t}"><b>${n}</b><span>${l}</span><em>→</em></button>`).join("")}</div>` : `<p class="empty-note">All caught up. Nothing needs attention right now.</p>`}
            <h2 class="sub">Low stock</h2>${s.lowStock.length ? `<div class="tbl-wrap"><table class="tbl" style="min-width:0"><tbody>${s.lowStock.map((x) => `<tr class="click" data-product="${esc(x.id)}"><td>${esc(x.name)}</td><td class="num ${x.stock_units <= 0 ? "no-stock" : "low-stock"}">${x.stock_units <= 0 ? "Sold out" : x.stock_units + " units"}</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty-note">All products are well stocked.</p>`}
          </div>
        </div>
        <div class="a-cols" style="margin-top:18px">
          <div class="panel"><h2>Recent orders &amp; messages</h2>${s.recent.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
            ${s.recent.map((o) => `<tr class="click" data-order="${o.id}"><td><strong>${esc(o.ref)}</strong><div class="muted">${date(o.createdAt)}</div></td><td>${esc(o.customer.name)}<div class="muted">${esc(o.customer.email)}</div></td><td>${pill(o.status, { ...ORDER_STATUS, ...MSG_STATUS })}</td><td class="num">${o.type === "order" ? money(o.total) : esc(o.type)}</td></tr>`).join("")}
            </tbody></table></div>` : `<p class="empty-note">No orders yet. They'll appear here as soon as customers check out.</p>`}</div>
          <div class="panel"><h2>Shopping funnel</h2>${funnelHtml(a.funnel)}<p class="empty-note">${int(s.customers)} customer accounts · ${int(s.subscribers)} newsletter subscribers</p></div>
        </div>`);
      s.recent.forEach((o) => { cache["o" + o.id] = o; });
      barChart($("#chRev"), a.series, [{ key: "revenue", label: "Revenue", color: C1 }], (v, axis) => axis ? (v >= 1000 ? "R" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : "R" + Math.round(v)) : money(v));
      bindRange(overview);
    } catch (err) { fail(err); }
  }

  function funnelHtml(f) {
    const top = f[0]?.n || 0;
    if (!top) return `<p class="empty-note">No visits recorded yet for this period. The funnel fills in as people use the shop.</p>`;
    return `<div class="funnel">${f.map((s, i) => `<div class="fn"><div class="fn-top"><span>${esc(s.step)}</span><b>${int(s.n)}</b></div><div class="hb-track"><i style="width:${Math.max(1.5, (s.n / top) * 100)}%"></i></div>${i ? `<small>${f[i - 1].n ? pct(s.n / f[i - 1].n, 0) : "0%"} of previous step</small>` : ""}</div>`).join("")}</div>`;
  }

  /* ================================================================ traffic */
  async function traffic() {
    loading("Traffic");
    try {
      const a = await api(`/api/admin/analytics?days=${range}`);
      const c = a.current, p = a.previous;
      const label = (s) => esc(s === "/" || s === "/home" ? "Home page" : s.replace(/^\//, ""));
      const country = (cc) => { try { return cc === "??" ? "Unknown" : new Intl.DisplayNames(["en"], { type: "region" }).of(cc); } catch { return cc; } };
      const n = (v) => int(v);
      main(`${head("Traffic", "Visitors are counted anonymously: no cookies, no IP addresses stored (POPIA-friendly). One person visiting on two days counts as two visits.", rangePicker())}
        <div class="tiles">
          <div class="tile hl"><small>Visits</small><strong>${int(c.visitors)}</strong>${delta(c.visitors, p.visitors)}</div>
          <div class="tile"><small>Page views</small><strong>${int(c.pageviews)}</strong>${delta(c.pageviews, p.pageviews)}</div>
          <div class="tile"><small>Pages per visit</small><strong>${c.visitors ? (c.pageviews / c.visitors).toFixed(1) : "0"}</strong></div>
          <div class="tile"><small>Conversion rate</small><strong>${pct(c.conversion)}</strong>${delta(c.conversion, p.conversion)}</div>
        </div>
        <div class="a-cols even">
          <div class="panel"><h2>Visits per day</h2><div class="chart" id="chVis"></div></div>
          <div class="panel"><h2>Page views per day</h2><div class="chart" id="chPv"></div></div>
        </div>
        <div class="a-cols even" style="margin-top:18px">
          <div class="panel"><h2>Shopping funnel</h2>${funnelHtml(a.funnel)}</div>
          <div class="panel"><h2>Top pages</h2>${hbars(a.topPages, (r) => label(r.path), "views", n)}</div>
        </div>
        <div class="a-cols three" style="margin-top:18px">
          <div class="panel"><h2>Most viewed products</h2>${hbars(a.topViewed, (r) => esc(r.name || r.id), "views", n)}</div>
          <div class="panel"><h2>Most added to cart</h2>${hbars(a.topCarted, (r) => esc(r.name || r.id), "adds", n)}</div>
          <div class="panel"><h2>Where visitors come from</h2>${hbars(a.referrers, (r) => esc(r.source), "visitors", n)}</div>
        </div>
        <div class="a-cols three" style="margin-top:18px">
          <div class="panel"><h2>Devices</h2>${hbars(a.devices, (r) => esc(r.label ? r.label[0].toUpperCase() + r.label.slice(1) : "Unknown"), "visitors", n)}</div>
          <div class="panel"><h2>Countries</h2>${hbars(a.countries, (r) => esc(country(r.label)), "visitors", n)}<p class="empty-note small">Country is only known when hosted on Vercel.</p></div>
          <div class="panel"><h2>Home vs business shoppers</h2>${hbars(a.modes, (r) => esc(r.label === "business" ? "Business mode" : "Home mode"), "visitors", n)}</div>
        </div>`);
      lineChart($("#chVis"), a.series, "visitors", "Visits", (v) => int(v));
      lineChart($("#chPv"), a.series, "pageviews", "Page views", (v) => int(v));
      bindRange(traffic);
    } catch (err) { fail(err); }
  }

  /* ================================================================ sales */
  async function sales() {
    loading("Sales");
    try {
      const a = await api(`/api/admin/analytics?days=${range}`);
      const c = a.current, p = a.previous;
      const sumBy = (rows, label) => (rows.find((r) => r.label === label) || {});
      const home = sumBy(a.byMode, "home"), biz = sumBy(a.byMode, "business");
      main(`${head("Sales", "Revenue includes VAT and excludes cancelled orders.", rangePicker())}
        <div class="tiles">
          <div class="tile hl"><small>Revenue</small><strong>${money0(c.revenue)}</strong>${delta(c.revenue, p.revenue)}</div>
          <div class="tile"><small>Orders</small><strong>${int(c.orders)}</strong>${delta(c.orders, p.orders)}</div>
          <div class="tile"><small>Average order</small><strong>${money0(c.aov)}</strong>${delta(c.aov, p.aov)}</div>
          <div class="tile"><small>Home shoppers</small><strong>${money0(home.revenue || 0)}</strong><span class="d">${int(home.n || 0)} orders</span></div>
          <div class="tile"><small>Trade / business</small><strong>${money0(biz.revenue || 0)}</strong><span class="d">${int(biz.n || 0)} orders</span></div>
        </div>
        <div class="panel"><h2>Revenue per day</h2><div class="chart" id="chSales"></div></div>
        <div class="a-cols three" style="margin-top:18px">
          <div class="panel"><h2>Best-selling products <small>by revenue, excl. VAT</small></h2>${hbars(a.topProducts, (r) => `${esc(r.name)} <small class="muted">${int(r.units)} units</small>`, "revenueEx", money0)}</div>
          <div class="panel"><h2>Orders by status</h2>${hbars(a.byStatus, (r) => esc(ORDER_STATUS[r.label] || r.label), "n", int)}</div>
          <div class="panel"><h2>Payment methods</h2>${hbars(a.byPayment, (r) => esc(PAY_METHOD[r.label] || r.label || "-"), "revenue", money0)}</div>
        </div>`);
      barChart($("#chSales"), a.series, [{ key: "revenueHome", label: "Home shoppers", color: C1 }, { key: "revenueBiz", label: "Trade / business", color: C2 }],
        (v, axis) => axis ? (v >= 1000 ? "R" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : "R" + Math.round(v)) : money(v));
      bindRange(sales);
    } catch (err) { fail(err); }
  }

  /* ================================================================ orders & messages */
  let lastOrderList = [];
  async function orders(kind) {
    const isMsg = kind === "msg";
    loading(isMsg ? "Quotes & messages" : "Orders");
    const statusMap = isMsg ? MSG_STATUS : ORDER_STATUS;
    const render = async () => {
      const q = $("#oq")?.value || "", st = $("#ost")?.value || "";
      const lists = isMsg
        ? await Promise.all(["quote", "contact"].map((t) => api(`/api/admin/orders?type=${t}&status=${encodeURIComponent(st)}&q=${encodeURIComponent(q)}`)))
        : [await api(`/api/admin/orders?type=order&status=${encodeURIComponent(st)}&q=${encodeURIComponent(q)}`)];
      const list = lists.flatMap((l) => l.orders).sort((a, b) => b.id - a.id);
      lastOrderList = list;
      list.forEach((o) => { cache["o" + o.id] = o; });
      $("#oBody").innerHTML = list.length ? list.map((o) => `<tr class="click" data-order="${o.id}">
          <td><strong>${esc(o.ref)}</strong><div class="muted">${date(o.createdAt)}</div></td>
          <td>${esc(o.customer.name)}${o.customer.business ? `<div class="muted">${esc(o.customer.business)}</div>` : `<div class="muted">${esc(o.customer.email)}</div>`}</td>
          <td>${isMsg ? esc(o.type === "quote" ? "Quote request" : "Message") : `${o.mode === "business" ? "Business" : "Home"} · ${o.items.length} line${o.items.length === 1 ? "" : "s"}`}</td>
          <td>${pill(o.status, statusMap)}</td>
          ${isMsg ? "" : `<td>${esc(PAY_METHOD[o.paymentMethod] || o.paymentMethod)}<div class="muted">${esc(PAY_STATUS[o.paymentStatus] || o.paymentStatus)}</div></td><td class="num">${money(o.total)}</td>`}
        </tr>`).join("") : `<tr><td colspan="6" class="muted" style="padding:24px">Nothing here yet.</td></tr>`;
    };
    main(`${head(isMsg ? "Quotes &amp; messages" : "Orders", isMsg ? "Quote requests and contact messages from the shop." : "Click an order to see details, update its status or print an invoice.",
      `<input class="input" id="oq" type="search" placeholder="Search ref, name or email"><select class="select" id="ost"><option value="">All statuses</option>${Object.entries(statusMap).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>${isMsg ? "" : '<button class="btn btn-ghost btn-sm" id="csvOrders">Export CSV</button>'}`)}
      <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>${isMsg ? "Type" : "Order"}</th><th>Status</th>${isMsg ? "" : "<th>Payment</th><th class='num'>Total</th>"}</tr></thead><tbody id="oBody"></tbody></table></div></div>`);
    let t; $("#oq").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => render().catch(fail), 250); });
    $("#ost").addEventListener("change", () => render().catch(fail));
    $("#csvOrders")?.addEventListener("click", () => download("mpm-orders.csv", csv([
      ["ref", "date", "status", "payment_method", "payment_status", "mode", "customer", "business", "email", "phone", "city", "province", "subtotal_ex_vat", "delivery_ex_vat", "vat", "total", "items"],
      ...lastOrderList.map((o) => [o.ref, o.createdAt, o.status, o.paymentMethod, o.paymentStatus, o.mode, o.customer.name, o.customer.business, o.customer.email, o.customer.phone, o.customer.city, o.customer.province, o.subtotal, o.delivery, o.vat, o.total, o.items.map((i) => `${i.qty}${i.kind === "case" ? " case" : ""} x ${i.name}`).join("; ")]),
    ])));
    render().catch(fail);
  }

  function orderDrawer(o) {
    const isOrder = o.type === "order", c = o.customer, statusMap = isOrder ? ORDER_STATUS : MSG_STATUS;
    openDrawer(`<div class="d-head"><div><h2>${esc(o.ref)}</h2><small>${esc(o.type === "order" ? "Order" : o.type === "quote" ? "Quote request" : "Message")} · ${date(o.createdAt)} · ${o.mode === "business" ? "Business" : "Home"} shopper</small></div><button class="d-close" data-close aria-label="Close">×</button></div>
      <div class="d-body">
        <div class="d-sec"><h3>Customer</h3><div class="kv">
          <span>Name</span><b>${esc(c.name)}</b>
          ${c.business ? `<span>Business</span><b>${esc(c.business)}${c.vat ? ` · VAT ${esc(c.vat)}` : ""}</b>` : ""}
          <span>Email</span><a href="mailto:${esc(c.email)}?subject=${encodeURIComponent("Your MPM Digital order " + o.ref)}">${esc(c.email)}</a>
          <span>Phone</span><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>
          ${o.deliveryMethod === "collect" ? `<span>Delivery</span><b>Customer collects</b>` : c.street ? `<span>Deliver to</span><b>${esc(c.street)}${c.suburb ? ", " + esc(c.suburb) : ""}, ${esc(c.city)}, ${esc(c.province)}, ${esc(c.postal)}</b>` : ""}
          ${c.notes ? `<span>Delivery notes</span><b>${esc(c.notes)}</b>` : ""}
        </div></div>
        ${o.message ? `<div class="d-sec"><h3>Message</h3><p style="white-space:pre-wrap">${esc(o.message)}</p></div>` : ""}
        ${o.items.length ? `<div class="d-sec"><h3>Items</h3><div class="d-items">
          ${o.items.map((i) => `<div><span>${esc(i.name)}<br><small>${esc(i.sku)} · ${i.kind === "case" ? `${i.qty} case${i.qty === 1 ? "" : "s"}` : `${i.qty} single`} · ${i.units} units · ${money(i.unitEx)}/unit ex VAT</small></span><b>${money(i.lineEx)}</b></div>`).join("")}
          ${isOrder ? `<div><span>Subtotal (ex VAT)</span><b>${money(o.subtotal)}</b></div>${o.discount ? `<div><span>Discount ${esc(o.discountCode)}</span><b>−${money(o.discount)}</b></div>` : ""}<div><span>Delivery</span><b>${money(o.delivery)}</b></div><div><span>VAT</span><b>${money(o.vat)}</b></div><div class="tot"><span>Total</span><b>${money(o.total)}</b></div>` : ""}
        </div></div>` : ""}
        <div class="d-sec"><h3>Update</h3><div class="fields">
          <div class="field"><label for="dStatus">Status</label><select class="select" id="dStatus" style="width:100%">${Object.entries(statusMap).map(([k, v]) => `<option value="${k}" ${k === o.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          ${isOrder ? `<div class="field"><label for="dPay">Payment (${esc(PAY_METHOD[o.paymentMethod] || o.paymentMethod)})</label><select class="select" id="dPay" style="width:100%">${Object.entries(PAY_STATUS).map(([k, v]) => `<option value="${k}" ${k === o.paymentStatus ? "selected" : ""}>${v}</option>`).join("")}</select></div>` : ""}
          <div class="field full"><label for="dNotes">Internal notes</label><textarea class="textarea" id="dNotes" placeholder="Courier tracking number, call notes…">${esc(o.adminNotes)}</textarea></div>
        </div>${isOrder ? `<p class="form-hint">Cancelling an order puts its stock back automatically.</p>` : ""}</div>
      </div>
      <div class="d-foot">${isOrder ? `<button class="btn btn-ghost btn-sm" id="dPrint">Print invoice</button><button class="btn btn-ghost btn-sm" id="dSlip">Packing slip</button>${o.paymentStatus !== "refunded" ? '<button class="btn btn-ghost btn-sm danger" id="dRefund">Refund</button>' : ""}` : ""}<span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-close>Close</button><button class="btn btn-primary btn-sm" id="dSave">Save changes</button></div>`);
    $("#dSave").addEventListener("click", async () => {
      try {
        await api(`/api/admin/orders/${o.id}`, { method: "PATCH", body: { status: $("#dStatus").value, paymentStatus: $("#dPay")?.value, adminNotes: $("#dNotes").value } });
        toast("Saved"); closeDrawer(); show(tab); refreshBadges();
      } catch (err) { toast(err.message); }
    });
    $("#dPrint")?.addEventListener("click", () => printDoc(o, "invoice"));
    $("#dRefund")?.addEventListener("click", async () => {
      if (!confirm(`Refund ${o.ref}? This cancels the order, puts the stock back and marks it refunded. Pay the money back to the customer from your bank.`)) return;
      try { await api(`/api/admin/orders/${o.id}`, { method: "PATCH", body: { action: "refund", adminNotes: $("#dNotes").value } }); toast("Order refunded and stock returned"); closeDrawer(); show(tab); refreshBadges(); }
      catch (err) { toast(err.message); }
    });
    $("#dSlip")?.addEventListener("click", () => printDoc(o, "slip"));
  }

  async function printDoc(o, kind) {
    if (!storeSettings) { try { storeSettings = (await api("/api/admin/settings")).settings; } catch { storeSettings = { store: { name: "MPM Digital" }, bank: {} }; } }
    const st = storeSettings, c = o.customer, inv = kind === "invoice";
    $("#printArea").innerHTML = `<div class="pr">
      <div class="pr-head"><div><h1>${esc(st.store.name || "MPM Digital")}</h1><p>${esc(st.store.address || "")}</p><p>${esc([st.store.email, st.store.phone].filter(Boolean).join(" · "))}</p></div>
        <div class="pr-meta"><h2>${inv ? "Tax invoice" : "Packing slip"}</h2><p><b>${esc(o.ref)}</b></p><p>${dateOnly(o.createdAt)}</p>${inv ? `<p>${esc(PAY_STATUS[o.paymentStatus] || "")}</p>` : ""}</div></div>
      <div class="pr-to"><h3>${inv ? "Bill to" : "Deliver to"}</h3><p><b>${esc(c.name)}</b>${c.business ? `<br>${esc(c.business)}` : ""}${c.vat ? `<br>VAT ${esc(c.vat)}` : ""}</p><p>${esc(c.street)}<br>${esc(c.city)}, ${esc(c.province)} ${esc(c.postal)}</p><p>${esc(c.phone)} · ${esc(c.email)}</p>${c.notes ? `<p><i>${esc(c.notes)}</i></p>` : ""}</div>
      <table class="pr-tbl"><thead><tr><th>Item</th><th>SKU</th><th class="num">Qty</th><th class="num">Units</th>${inv ? '<th class="num">Unit ex VAT</th><th class="num">Line ex VAT</th>' : '<th class="num">Packed ✓</th>'}</tr></thead>
        <tbody>${o.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.sku)}</td><td class="num">${i.qty}${i.kind === "case" ? " case" + (i.qty === 1 ? "" : "s") : ""}</td><td class="num">${i.units}</td>${inv ? `<td class="num">${money(i.unitEx)}</td><td class="num">${money(i.lineEx)}</td>` : '<td class="num">☐</td>'}</tr>`).join("")}</tbody></table>
      ${inv ? `<div class="pr-tot"><div><span>Subtotal (excl. VAT)</span><b>${money(o.subtotal)}</b></div>${o.discount ? `<div><span>Discount ${esc(o.discountCode)}</span><b>−${money(o.discount)}</b></div>` : ""}<div><span>Delivery (excl. VAT)</span><b>${money(o.delivery)}</b></div><div><span>VAT 15%</span><b>${money(o.vat)}</b></div><div class="g"><span>Total</span><b>${money(o.total)}</b></div></div>
        ${st.bank && st.bank.accountNumber ? `<p class="pr-bank">EFT: ${esc(st.bank.name)} · ${esc(st.bank.accountName)} · Acc ${esc(st.bank.accountNumber)} · Branch ${esc(st.bank.branchCode)} · Ref ${esc(o.ref)}</p>` : ""}` : ""}
    </div>`;
    window.print();
  }

  /* ================================================================ products */
  let catList = [];
  async function products() {
    loading("Products");
    try {
      const { products: list, categories } = await api("/api/admin/products");
      catList = categories;
      list.forEach((p) => { cache["p" + p.id] = p; });
      const low = list.filter((p) => p.active && p.stock !== "in").length;
      main(`${head("Products", `${list.length} products · ${low} low or sold out · wholesale prices are per unit ex VAT; retail (RRP) incl. VAT; stock is counted in single units.`,
        `<input class="input" id="pq" type="search" placeholder="Search name or SKU"><select class="select" id="pcat"><option value="">All categories</option>${categories.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select><select class="select" id="pstock"><option value="">Any stock</option><option value="low">Low or sold out</option></select><button class="btn btn-ghost btn-sm" id="csvProd">Export CSV</button><button class="btn btn-primary btn-sm" id="addProd">+ Add product</button>`)}
        <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th>Category</th><th class="num">Wholesale</th><th class="num">Retail</th><th class="num">Your profit</th><th class="num">Case</th><th class="num">Stock</th><th>Status</th></tr></thead><tbody id="pBody">
        ${list.map((p) => `<tr class="click ${p.active ? "" : "inactive"}" data-product="${esc(p.id)}" data-s="${esc((p.name + " " + p.sku).toLowerCase())}" data-cat="${esc(p.cat)}" data-low="${p.stock !== "in" ? 1 : 0}">
          <td><div class="prod">${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="thumb"></span>`}<div><strong>${esc(p.name)}</strong><span class="muted">${esc(p.sku)}</span></div></div></td>
          <td class="muted">${esc((categories.find((c) => c.id === p.cat) || {}).name || p.cat)}</td>
          <td class="num">${money(p.price)}</td><td class="num">${money(p.rrp)}</td>
          <td class="num muted">${p.cost ? money(p.rrp / 1.15 - p.cost) + "/unit" : "add cost"}</td>
          <td class="num">${p.pack} · MOQ ${p.moq}</td>
          <td class="num ${p.stockUnits <= 0 ? "no-stock" : p.stock === "low" ? "low-stock" : ""}">${p.stockUnits <= 0 ? "Sold out" : int(p.stockUnits)}</td>
          <td>${p.active ? '<span class="pill s-delivered">Live</span>' : '<span class="pill s-cancelled">Hidden</span>'}</td></tr>`).join("")}
        </tbody></table></div></div>`);
      const filter = () => {
        const q = $("#pq").value.trim().toLowerCase(), c = $("#pcat").value, lowOnly = $("#pstock").value === "low";
        $$("#pBody tr").forEach((r) => { r.hidden = (q && !r.dataset.s.includes(q)) || (c && r.dataset.cat !== c) || (lowOnly && r.dataset.low !== "1"); });
      };
      ["#pq", "#pcat", "#pstock"].forEach((s) => $(s).addEventListener("input", filter));
      $("#addProd").addEventListener("click", () => productDrawer(null));
      $("#csvProd").addEventListener("click", () => download("mpm-products.csv", csv([["id", "sku", "name", "category", "supplier", "wholesale_ex_vat", "retail_incl_vat", "units_per_case", "moq_cases", "stock_units", "badge", "live", "cost_ex_vat"],
        ...list.map((p) => [p.id, p.sku, p.name, p.cat, p.supplier, p.price, p.rrp, p.pack, p.moq, p.stockUnits, p.badge, p.active ? "yes" : "no", p.cost])])));
    } catch (err) { fail(err); }
  }

  function productDrawer(p) {
    const isNew = !p;
    p = p || { name: "", sku: "", cat: catList[0]?.id, supplier: "", pack: 12, moq: 1, price: 0, rrp: 0, stockUnits: 0, badge: "", desc: "", specs: {}, active: true, icon: "box" };
    const specRow = (k = "", v = "") => `<div class="row"><input class="input" placeholder="Label (e.g. Material)" value="${esc(k)}"><input class="input" placeholder="Value" value="${esc(v)}"><button type="button" class="x" aria-label="Remove">×</button></div>`;
    openDrawer(`<div class="d-head"><div><h2>${isNew ? "New product" : esc(p.name)}</h2><small>${isNew ? "Fill in the details below." : esc(p.sku)}</small></div><button class="d-close" data-close aria-label="Close">×</button></div>
      <form class="d-body" id="pForm" novalidate>
        ${isNew ? "" : `<div class="d-sec"><h3>Photo</h3><div class="img-edit"><img id="pImg" src="${esc(p.image || "")}" alt=""><div><label class="btn btn-ghost btn-sm">Change photo<input type="file" id="pFile" accept="image/jpeg,image/png,image/webp"></label><p class="form-hint">Square photos look best. Large photos are resized automatically.</p></div></div></div>`}
        <div class="d-sec"><h3>Details</h3><div class="fields">
          <div class="field full"><label>Name</label><input class="input" name="name" value="${esc(p.name)}" required></div>
          <div class="field"><label>SKU</label><input class="input" name="sku" value="${esc(p.sku)}" required></div>
          <div class="field"><label>Category</label><select class="select" name="cat" style="width:100%">${catList.map((c) => `<option value="${esc(c.id)}" ${c.id === p.cat ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Supplier / brand</label><input class="input" name="supplier" value="${esc(p.supplier)}"></div>
          <div class="field"><label>Badge</label><select class="select" name="badge" style="width:100%">${["", "Best seller", "Hot", "New", "Sale"].map((b) => `<option ${b === p.badge ? "selected" : ""} value="${b}">${b || "None"}</option>`).join("")}</select></div>
          <div class="field full"><label>Description</label><textarea class="textarea" name="desc">${esc(p.desc)}</textarea></div>
        </div></div>
        <div class="d-sec"><h3>Pricing &amp; stock</h3><div class="fields">
          <div class="field"><label>Wholesale price / unit (ex VAT)</label><input class="input" name="price" type="number" step="0.01" min="0" value="${p.price}"></div>
          <div class="field"><label>Retail price / unit (incl VAT)</label><input class="input" name="rrp" type="number" step="0.01" min="0" value="${p.rrp}"></div>
          <div class="field"><label>Your cost / unit (excl VAT)</label><input class="input" name="cost" type="number" step="0.01" min="0" value="${p.cost || 0}"></div>
          <div class="field"><label>Units per case</label><input class="input" name="pack" type="number" min="1" value="${p.pack}"></div>
          <div class="field"><label>Minimum order (cases)</label><input class="input" name="moq" type="number" min="1" value="${p.moq}"></div>
          <div class="field"><label>Stock on hand (units)</label><input class="input" name="stockUnits" type="number" value="${p.stockUnits}"><small class="muted">To receive deliveries, use Inventory so it's recorded.</small></div>
          <div class="field"><label>Visibility</label><select class="select" name="active" style="width:100%"><option value="1" ${p.active ? "selected" : ""}>Live in shop</option><option value="0" ${p.active ? "" : "selected"}>Hidden</option></select></div>
        </div><p class="form-hint" id="marginHint"></p></div>
        ${isNew ? "" : `<div class="d-sec"><h3>Stock history</h3><div id="pHist"><p class="muted">Loading…</p></div></div>`}
        <div class="d-sec"><h3>Specifications</h3><div class="specs-edit" id="specs">${Object.entries(p.specs || {}).map(([k, v]) => specRow(k, v)).join("")}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="addSpec" style="margin-top:8px">+ Add spec</button></div>
        ${isNew ? `<p class="form-hint">You can add a photo after saving.</p>` : ""}
      </form>
      <div class="d-foot"><span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary btn-sm" id="pSave">${isNew ? "Create product" : "Save changes"}</button></div>`);
    const mh = () => {
      const f = $("#pForm"); const w = +f.price.value, r = +f.rrp.value, c = +f.cost.value;
      const parts = [];
      if (c > 0) parts.push(`Your profit per unit: ${money(r / 1.15 - c)} on home sales, ${money(w - c)} on trade sales (before volume discounts)`);
      else parts.push("Add your cost price to see profit per unit and in Finances.");
      if (r > 0) parts.push(`Trade customers' retail margin: ${Math.round((1 - (w * 1.15) / r) * 100)}%`);
      $("#marginHint").textContent = parts.join(" · ");
    };
    $("#pForm").addEventListener("input", mh); mh();
    if (!isNew) productHistory(p.id);
    $("#addSpec").addEventListener("click", () => $("#specs").insertAdjacentHTML("beforeend", specRow()));
    $("#specs").addEventListener("click", (e) => { if (e.target.closest(".x")) e.target.closest(".row").remove(); });
    $("#pSave").addEventListener("click", async () => {
      const f = Object.fromEntries(new FormData($("#pForm")));
      const specs = {}; $$("#specs .row").forEach((r) => { const [k, v] = $$("input", r).map((i) => i.value.trim()); if (k && v) specs[k] = v; });
      const body = { ...f, active: f.active === "1", specs };
      try {
        const r = isNew ? await api("/api/admin/products", { method: "POST", body }) : await api(`/api/admin/products/${encodeURIComponent(p.id)}`, { method: "PATCH", body });
        toast(isNew ? "Product created" : "Saved"); cache["p" + r.product.id] = r.product;
        if (isNew) productDrawer(r.product); else closeDrawer();
        if (tab === "products") products(); refreshBadges();
      } catch (err) { toast(err.message); }
    });
    const file = $("#pFile");
    if (file) file.addEventListener("change", () => {
      const fl = file.files[0]; if (!fl) return;
      if (fl.size > 25 * 1024 * 1024) { toast("That file is too large"); return; }
      const img = new Image(), src = URL.createObjectURL(fl);
      img.onload = async () => {
        const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas"); cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
        const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(src); toast("Uploading photo…");
        try { const r = await api(`/api/admin/products/${encodeURIComponent(p.id)}/image`, { method: "POST", body: { dataUrl: cv.toDataURL("image/jpeg", 0.85) } }); $("#pImg").src = r.product.image; toast("Photo updated"); if (tab === "products") products(); }
        catch (err) { toast(err.message); }
      };
      img.onerror = () => { URL.revokeObjectURL(src); toast("That file isn't an image we can read"); };
      img.src = src;
    });
  }

  /* ================================================================ categories */
  const TONES = ["pink", "lilac", "wine", "blush", "plum"];
  async function categories() {
    loading("Categories");
    try {
      const { categories: list } = await api("/api/admin/categories");
      main(`${head("Categories", "Categories appear in the shop menu, filters and the scrolling category showcase on the home page.", '<button class="btn btn-primary btn-sm" id="addCat">+ Add category</button>')}
        <div class="cat-admin">${list.map((c) => `<button type="button" class="cat-tile" data-cat-edit="${esc(c.id)}"><span class="art t-${esc(c.tone)}">${ICONS[c.icon] || ""}</span><span><strong>${esc(c.name)}</strong><small>${esc(c.blurb || "No description")}</small><em>${c.products} product${c.products === 1 ? "" : "s"} · position ${c.sort}</em></span></button>`).join("")}</div>`);
      list.forEach((c) => { cache["c" + c.id] = c; });
      $("#addCat").addEventListener("click", () => categoryDrawer(null));
    } catch (err) { fail(err); }
  }
  function categoryDrawer(c) {
    const isNew = !c;
    c = c || { name: "", blurb: "", icon: "box", tone: "pink", sort: 0, products: 0 };
    openDrawer(`<div class="d-head"><div><h2>${isNew ? "New category" : esc(c.name)}</h2><small>${isNew ? "" : `${c.products} products`}</small></div><button class="d-close" data-close aria-label="Close">×</button></div>
      <form class="d-body" id="cForm" novalidate>
        <div class="fields">
          <div class="field full"><label>Name</label><input class="input" name="name" value="${esc(c.name)}" required></div>
          <div class="field full"><label>Short description</label><input class="input" name="blurb" value="${esc(c.blurb)}" maxlength="200"></div>
          <div class="field"><label>Colour</label><select class="select" name="tone" style="width:100%">${TONES.map((t) => `<option value="${t}" ${t === c.tone ? "selected" : ""}>${t[0].toUpperCase() + t.slice(1)}</option>`).join("")}</select></div>
          ${isNew ? "" : `<div class="field"><label>Position (lower shows first)</label><input class="input" name="sort" type="number" value="${c.sort}"></div>`}
        </div>
        <div class="d-sec"><h3>Icon <small class="muted">(shown when a category has no product photos)</small></h3><div class="icon-pick">${Object.keys(ICONS).map((k) => `<label><input type="radio" name="icon" value="${k}" ${k === c.icon ? "checked" : ""}><span class="art t-${esc(c.tone)}">${ICONS[k]}</span></label>`).join("")}</div></div>
      </form>
      <div class="d-foot">${isNew ? "" : '<button class="btn btn-ghost btn-sm" id="cDel">Delete</button>'}<span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary btn-sm" id="cSave">${isNew ? "Create category" : "Save changes"}</button></div>`);
    $("#cSave").addEventListener("click", async () => {
      const body = Object.fromEntries(new FormData($("#cForm")));
      try {
        await api(isNew ? "/api/admin/categories" : `/api/admin/categories/${encodeURIComponent(c.id)}`, { method: isNew ? "POST" : "PATCH", body });
        toast("Saved"); closeDrawer(); categories();
      } catch (err) { toast(err.message); }
    });
    $("#cDel")?.addEventListener("click", async () => {
      if (!confirm(`Delete the category "${c.name}"? This can't be undone.`)) return;
      try { await api(`/api/admin/categories/${encodeURIComponent(c.id)}`, { method: "DELETE" }); toast("Category deleted"); closeDrawer(); categories(); }
      catch (err) { toast(err.message); }
    });
  }

  /* ================================================================ customers */
  async function customers() {
    loading("Customers");
    try {
      const { customers: list } = await api("/api/admin/customers");
      main(`${head("Customers", `${list.length} customer accounts. Click a customer to see their orders or change their trade access.`,
        `<input class="input" id="cq" type="search" placeholder="Search name, email or business"><select class="select" id="ctype"><option value="">All customers</option><option value="home">Home</option><option value="business">Business</option><option value="approved">Approved trade</option></select><button class="btn btn-ghost btn-sm" id="csvCust">Export CSV</button>`)}
        <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Type</th><th>Trade</th><th class="num">Orders</th><th class="num">Spent</th><th>Joined</th></tr></thead><tbody id="cBody">
        ${list.length ? list.map((u) => `<tr class="click" data-cust="${u.id}" data-s="${esc((u.name + " " + u.email + " " + u.businessName).toLowerCase())}" data-type="${esc(u.accountType)}" data-trade="${esc(u.tradeStatus)}"><td><strong>${esc(u.name)}</strong>${u.businessName ? `<div class="muted">${esc(u.businessName)}</div>` : ""}</td><td>${esc(u.email)}<div class="muted">${esc(u.phone)}</div></td>
          <td>${u.accountType === "business" ? "Business" : "Home"}</td><td>${u.tradeStatus === "none" ? '<span class="muted">-</span>' : tradePill(u.tradeStatus)}</td><td class="num">${u.orderCount}</td><td class="num">${money(u.spent)}</td><td class="muted">${dateOnly(u.createdAt)}</td></tr>`).join("") : `<tr><td colspan="7" class="muted" style="padding:24px">No customer accounts yet.</td></tr>`}
        </tbody></table></div></div>`);
      const filter = () => {
        const q = $("#cq").value.trim().toLowerCase(), t = $("#ctype").value;
        $$("#cBody tr[data-cust]").forEach((r) => { r.hidden = (q && !r.dataset.s.includes(q)) || (t === "approved" ? r.dataset.trade !== "approved" : t && r.dataset.type !== t); });
      };
      $("#cq").addEventListener("input", filter); $("#ctype").addEventListener("input", filter);
      $("#csvCust").addEventListener("click", () => download("mpm-customers.csv", csv([["name", "email", "phone", "type", "business", "vat", "trade_status", "orders", "spent", "joined"], ...list.map((u) => [u.name, u.email, u.phone, u.accountType, u.businessName, u.vatNumber, u.tradeStatus, u.orderCount, u.spent, u.createdAt])])));
    } catch (err) { fail(err); }
  }
  async function customerDrawer(id) {
    try {
      const { customer: u, orders: list, applications } = await api(`/api/admin/customers/${id}`);
      list.forEach((o) => { cache["o" + o.id] = o; });
      const spent = list.filter((o) => o.type === "order" && o.status !== "cancelled").reduce((a, o) => a + o.total, 0);
      const app = applications[0];
      openDrawer(`<div class="d-head"><div><h2>${esc(u.name)}</h2><small>${esc(u.email)} · joined ${dateOnly(u.createdAt)}</small></div><button class="d-close" data-close aria-label="Close">×</button></div>
        <div class="d-body">
          <div class="tiles mini"><div class="tile"><small>Orders</small><strong>${list.filter((o) => o.type === "order").length}</strong></div><div class="tile"><small>Spent</small><strong>${money0(spent)}</strong></div></div>
          <form class="d-sec" id="uForm"><h3>Account</h3><div class="fields">
            <div class="field"><label>Name</label><input class="input" name="name" value="${esc(u.name)}"></div>
            <div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(u.phone || "")}"></div>
            <div class="field"><label>Business name</label><input class="input" name="businessName" value="${esc(u.businessName || "")}"></div>
            <div class="field"><label>VAT number</label><input class="input" name="vatNumber" value="${esc(u.vatNumber || "")}"></div>
            <div class="field"><label>Account type</label><select class="select" name="accountType" style="width:100%"><option value="home" ${u.accountType === "home" ? "selected" : ""}>Home</option><option value="business" ${u.accountType === "business" ? "selected" : ""}>Business</option></select></div>
            <div class="field"><label>Trade pricing access</label><select class="select" name="tradeStatus" style="width:100%">${Object.entries(TRADE).map(([k, v]) => `<option value="${k}" ${k === u.tradeStatus ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          </div><p class="form-hint">"Approved" lets this customer see wholesale prices, order by the case and pay on 30-day terms.</p></form>
          ${app ? `<div class="d-sec"><h3>Trade application</h3><div class="kv"><span>Business</span><b>${esc(app.business_name)} (${esc(app.business_type)})</b><span>Contact</span><b>${esc(app.contact)} · ${esc(app.phone)}</b>${app.cipc ? `<span>CIPC</span><b>${esc(app.cipc)}</b>` : ""}${app.vat_number ? `<span>VAT</span><b>${esc(app.vat_number)}</b>` : ""}<span>Monthly spend</span><b>${esc(app.monthly_spend)}</b><span>30-day terms</span><b>${app.wants_terms ? "Requested" : "No"}</b></div></div>` : ""}
          <div class="d-sec"><h3>Orders &amp; messages</h3>${list.length ? `<div class="d-items">${list.map((o) => `<div class="click" data-order="${o.id}"><span><b>${esc(o.ref)}</b><br><small>${date(o.createdAt)} · ${pill(o.status, { ...ORDER_STATUS, ...MSG_STATUS })}</small></span><b>${o.type === "order" ? money(o.total) : esc(o.type)}</b></div>`).join("")}</div>` : '<p class="muted">No orders yet.</p>'}</div>
        </div>
        <div class="d-foot"><a class="btn btn-ghost btn-sm" href="mailto:${esc(u.email)}">Email customer</a><span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-close>Close</button><button class="btn btn-primary btn-sm" id="uSave">Save changes</button></div>`);
      $("#uSave").addEventListener("click", async () => {
        try { await api(`/api/admin/customers/${u.id}`, { method: "PATCH", body: Object.fromEntries(new FormData($("#uForm"))) }); toast("Saved"); closeDrawer(); show(tab); refreshBadges(); }
        catch (err) { toast(err.message); }
      });
    } catch (err) { toast(err.message); }
  }

  /* ================================================================ trade */
  async function trade() {
    loading("Trade accounts");
    try {
      const { applications } = await api("/api/admin/trade");
      main(`${head("Trade accounts", "Approving an application lets that customer see wholesale prices, order by the case and pay on 30-day terms.")}
        <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Business</th><th>Contact</th><th>Details</th><th>Status</th><th></th></tr></thead><tbody>
        ${applications.length ? applications.map((a) => `<tr>
          <td><strong>${esc(a.business_name)}</strong><div class="muted">${esc(a.business_type)} · ${date(a.created_at)}</div></td>
          <td>${esc(a.contact)}<div class="muted"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a> · ${esc(a.phone)}</div></td>
          <td class="muted">${a.cipc ? `CIPC ${esc(a.cipc)}<br>` : ""}${a.vat_number ? `VAT ${esc(a.vat_number)}<br>` : ""}Spend: ${esc(a.monthly_spend)}${a.wants_terms ? "<br><b>Wants 30-day terms</b>" : ""}</td>
          <td>${tradePill(a.status)}</td>
          <td><div class="row-actions">${a.status !== "approved" ? `<button class="btn btn-primary" data-trade="${a.id}" data-st="approved">Approve</button>` : ""}${a.status !== "rejected" ? `<button class="btn btn-ghost" data-trade="${a.id}" data-st="rejected">${a.status === "approved" ? "Revoke" : "Reject"}</button>` : ""}${a.user_id ? `<button class="btn btn-ghost" data-cust="${a.user_id}">Customer</button>` : ""}</div></td>
        </tr>`).join("") : `<tr><td colspan="5" class="muted" style="padding:24px">No applications yet.</td></tr>`}
        </tbody></table></div></div>`);
    } catch (err) { fail(err); }
  }

  /* ================================================================ subscribers */
  async function subscribers() {
    loading("Subscribers");
    try {
      const { subscribers: list } = await api("/api/admin/customers");
      main(`${head("Newsletter subscribers", `${list.length} people signed up in the footer. Export them to your email tool (e.g. Mailchimp, Brevo).`, '<button class="btn btn-primary btn-sm" id="csvSubs">Export CSV</button>')}
        <div class="panel"><div class="tbl-wrap"><table class="tbl" style="min-width:0"><thead><tr><th>Email</th><th>Signed up</th></tr></thead><tbody>
        ${list.length ? list.map((s) => `<tr><td><a href="mailto:${esc(s.email)}">${esc(s.email)}</a></td><td class="muted">${dateOnly(s.created_at)}</td></tr>`).join("") : `<tr><td colspan="2" class="muted" style="padding:24px">No subscribers yet.</td></tr>`}
        </tbody></table></div></div>`);
      $("#csvSubs").addEventListener("click", () => download("mpm-subscribers.csv", csv([["email", "subscribed"], ...list.map((s) => [s.email, s.created_at])])));
    } catch (err) { fail(err); }
  }

  /* ================================================================ team */
  async function team() {
    loading("Team");
    try {
      const { admins, me: myId } = await api("/api/admin/team");
      main(`${head("Team", "People who can sign in to this dashboard. Everyone here has full access.")}
        <div class="a-cols">
          <div class="panel"><h2>Admins</h2><div class="tbl-wrap"><table class="tbl" style="min-width:0"><tbody>
            ${admins.map((a) => `<tr><td><strong>${esc(a.name)}</strong><div class="muted">${esc(a.email)}</div></td><td class="num">${a.id === myId ? '<span class="pill s-delivered">You</span>' : `<button class="btn btn-ghost btn-sm" data-demote="${a.id}">Remove access</button>`}</td></tr>`).join("")}
          </tbody></table></div></div>
          <form class="panel pad" id="teamForm"><h2 class="flat">Add an admin</h2><p class="form-hint">They need a shop account first (they can create one under "Sign in → Create account"). Then enter their email here.</p>
            <div class="field" style="margin-top:12px"><label for="tEmail">Email</label><input class="input" id="tEmail" name="email" type="email" required></div>
            <button class="btn btn-primary btn-sm" type="submit" style="margin-top:12px">Give admin access</button></form>
        </div>
        <form class="panel pad" id="pwForm" style="margin-top:18px;max-width:520px"><h2 class="flat">Your password</h2><p class="form-hint">Admin passwords need at least 10 characters.</p><div class="fields">
          <div class="field full"><label for="pw1">Current password</label><input class="input" id="pw1" name="currentPassword" type="password" autocomplete="current-password" required></div>
          <div class="field full"><label for="pw2">New password</label><input class="input" id="pw2" name="newPassword" type="password" autocomplete="new-password" minlength="10" required></div></div>
          <button class="btn btn-primary btn-sm" type="submit">Change password</button></form>`);
      $("#pwForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await api("/api/me", { method: "PATCH", body: Object.fromEntries(new FormData(e.currentTarget)) }); toast("Password changed"); e.currentTarget.reset(); }
        catch (err) { toast(err.message); }
      });
      $("#teamForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        try { await api("/api/admin/team", { method: "POST", body: { email: $("#tEmail").value } }); toast("Admin added"); team(); }
        catch (err) { toast(err.message); }
      });
    } catch (err) { fail(err); }
  }

  /* ================================================================ settings */
  async function settings() {
    loading("Settings");
    try {
      const { settings: st, gateways } = await api("/api/admin/settings");
      storeSettings = st;
      const f = (name, label, value, attrs = "") => `<div class="field"><label>${label}</label><input class="input" name="${name}" value="${esc(value ?? "")}" ${attrs}></div>`;
      const tierRow = (t = { min: "", off: "", name: "" }) => `<div class="row"><input class="input" name="tname" placeholder="Name" value="${esc(t.name)}"><input class="input" name="tmin" type="number" min="1" placeholder="From (cases)" value="${esc(t.min)}"><input class="input" name="toff" type="number" min="0" max="90" step="0.5" placeholder="Discount %" value="${t.off === "" ? "" : esc(Math.round(t.off * 1000) / 10)}"><button type="button" class="x" aria-label="Remove tier">×</button></div>`;
      main(`${head("Settings", "Changes apply to the shop within about 20 seconds.")}
        <div class="set-grid">
          <form class="panel pad" data-sec="store"><h2 class="flat">Store details</h2><p class="form-hint">Shown on invoices and in EFT instructions.</p><div class="fields">
            ${f("name", "Store name", st.store.name)}${f("email", "Orders email", st.store.email, 'type="email"')}${f("phone", "Phone", st.store.phone)}${f("whatsapp", "WhatsApp number", st.store.whatsapp)}
            <div class="field full"><label>Address (for invoices)</label><input class="input" name="address" value="${esc(st.store.address)}"></div></div>
            <button class="btn btn-primary btn-sm" type="submit">Save store details</button></form>

          <form class="panel pad" data-sec="bank"><h2 class="flat">Bank details for EFT</h2><p class="form-hint">Shown to customers who choose EFT, with their order number as the reference.</p><div class="fields">
            ${f("name", "Bank", st.bank.name)}${f("accountName", "Account name", st.bank.accountName)}${f("accountNumber", "Account number", st.bank.accountNumber, 'inputmode="numeric"')}${f("branchCode", "Branch code", st.bank.branchCode, 'inputmode="numeric"')}</div>
            <button class="btn btn-primary btn-sm" type="submit">Save bank details</button></form>

          <form class="panel pad" data-sec="delivery"><h2 class="flat">Delivery</h2><div class="fields">
            ${f("homeFreeDelivery", "Home orders: free delivery from (R, incl. VAT)", st.delivery.homeFreeDelivery, 'type="number" min="0" step="1"')}${f("homeDeliveryFee", "Home orders: delivery fee (R, incl. VAT)", st.delivery.homeDeliveryFee, 'type="number" min="0" step="0.01"')}
            ${f("bizFreeDelivery", "Trade orders: free delivery from (R, excl. VAT)", st.delivery.bizFreeDelivery, 'type="number" min="0" step="1"')}${f("bizDeliveryFee", "Trade orders: delivery fee (R, excl. VAT)", st.delivery.bizDeliveryFee, 'type="number" min="0" step="0.01"')}
            <div class="field full"><label>Delivery time shown at checkout</label><input class="input" name="eta" value="${esc(st.delivery.eta || "")}"></div>
            <div class="field full"><label class="check"><input type="checkbox" name="collectEnabled" ${st.delivery.collectEnabled ? "checked" : ""}> Let customers collect for free</label></div>
            <div class="field full"><label>Collection address</label><input class="input" name="collectAddress" value="${esc(st.delivery.collectAddress || "")}" placeholder="Unit 4, 12 Industrial Rd, Germiston"></div>
            <div class="field full"><label>Collection note</label><input class="input" name="collectNote" value="${esc(st.delivery.collectNote || "")}"></div></div>
            <button class="btn btn-primary btn-sm" type="submit">Save delivery</button></form>

          <form class="panel pad" data-sec="tiers"><h2 class="flat">Trade volume discounts</h2><p class="form-hint">Discount off the wholesale price by the number of cases of one product. The first tier always starts at 1 case.</p>
            <div class="specs-edit tiers-edit" id="tiers">${st.tiers.map(tierRow).join("")}</div>
            <div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="btn btn-ghost btn-sm" id="addTier">+ Add tier</button><button class="btn btn-primary btn-sm" type="submit">Save discounts</button></div></form>

          <form class="panel pad" data-sec="payments"><h2 class="flat">Payment methods</h2>
            <label class="check"><input type="checkbox" name="eft" ${st.payments.eft ? "checked" : ""}> EFT / bank transfer</label>
            <label class="check"><input type="checkbox" name="account" ${st.payments.account ? "checked" : ""}> 30-day account (approved trade customers only)</label>
            <div class="gw"><div><span class="dot ${gateways.card ? "ok" : ""}"></span>Card payments: ${gateways.card ? "connected" : "not connected yet"}</div><div><span class="dot ${gateways.instantEft ? "ok" : ""}"></span>Instant EFT: ${gateways.instantEft ? "connected" : "not connected yet"}</div><div><span class="dot ${gateways.blob ? "ok" : ""}"></span>Photo storage (Vercel Blob): ${gateways.blob ? "connected" : "not connected (uploads only work locally)"}</div></div>
            <button class="btn btn-primary btn-sm" type="submit">Save payment methods</button></form>

          <form class="panel pad" data-sec="announcement"><h2 class="flat">Announcement bar</h2><p class="form-hint">The scrolling messages at the very top of the shop (up to 6).</p>
            <div class="specs-edit" id="ann">${[...st.announcement, "", ""].slice(0, Math.max(6, st.announcement.length)).slice(0, 6).map((a) => `<input class="input" name="ann" value="${esc(a)}" maxlength="90" placeholder="e.g. Free delivery over R750">`).join("")}</div>
            <button class="btn btn-primary btn-sm" type="submit" style="margin-top:10px">Save announcement</button></form>
        </div>`);
      $("#addTier").addEventListener("click", () => { if ($$("#tiers .row").length < 8) $("#tiers").insertAdjacentHTML("beforeend", tierRow()); });
      $("#tiers").addEventListener("click", (e) => { if (e.target.closest(".x") && $$("#tiers .row").length > 1) e.target.closest(".row").remove(); });
      $$("form[data-sec]").forEach((form) => form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const sec = form.dataset.sec, fd = Object.fromEntries(new FormData(form));
        let body;
        if (sec === "tiers") body = { tiers: $$("#tiers .row").map((r) => ({ name: $("[name=tname]", r).value, min: +$("[name=tmin]", r).value, off: (+$("[name=toff]", r).value || 0) / 100 })).filter((t) => t.min > 0) };
        else if (sec === "payments") body = { payments: { eft: !!form.eft.checked, account: !!form.account.checked } };
        else if (sec === "announcement") body = { announcement: $$("[name=ann]", form).map((i) => i.value) };
        else if (sec === "delivery") body = { delivery: { ...fd, collectEnabled: !!form.collectEnabled.checked } };
        else body = { [sec]: fd };
        try { const r = await api("/api/admin/settings", { method: "PUT", body }); storeSettings = r.settings; toast("Saved. The shop will update within about 20 seconds."); if (sec === "tiers") settings(); }
        catch (err) { toast(err.message); }
      }));
    } catch (err) { fail(err); }
  }

  /* ================================================================ finances */
  async function finances() {
    loading("Finances");
    try {
      const f = await api(`/api/admin/finances?days=${range}`);
      const p = f.period, pos = f.position;
      const monthName = (m) => new Date(m + "-15T12:00:00Z").toLocaleDateString("en-ZA", { month: "short", year: "numeric" });
      main(`${head("Finances", "Money in, money owed and profit. Sales are incl. VAT unless marked; profit uses each product's cost price at the time of sale.", `${rangePicker()}<button class="btn btn-ghost btn-sm" id="csvLedger">Export for accountant</button>`)}
        <h2 class="sec-title">Money position <small>all time</small></h2>
        <div class="tiles">
          <div class="tile hl"><small>Received</small><strong>${money0(pos.received.amount)}</strong><span class="d">${int(pos.received.n)} paid orders</span></div>
          <div class="tile"><small>Awaiting EFT payment</small><strong>${money0(pos.awaiting.amount)}</strong><span class="d">${int(pos.awaiting.n)} orders</span></div>
          <div class="tile"><small>Owed on 30-day accounts</small><strong>${money0(pos.onAccount.amount)}</strong><span class="d">${int(pos.onAccount.n)} orders</span></div>
          <div class="tile"><small>Stock value at cost</small><strong>${money0(f.inventory.atCost)}</strong><span class="d">${money0(f.inventory.atRetailInc)} at retail</span></div>
        </div>
        <h2 class="sec-title">This period <small>last ${range === 365 ? "12 months" : range + " days"}</small></h2>
        <div class="tiles">
          <div class="tile"><small>Gross sales</small><strong>${money0(p.gross)}</strong><span class="d">${int(p.orders)} orders</span></div>
          <div class="tile"><small>Net sales <em>excl. VAT</em></small><strong>${money0(p.netEx)}</strong><span class="d">incl. ${money0(p.deliveryEx)} delivery</span></div>
          <div class="tile"><small>VAT collected</small><strong>${money0(p.vat)}</strong><span class="d">owed to SARS</span></div>
          <div class="tile"><small>Discounts given</small><strong>${money0(p.discountEx * 1.15)}</strong><span class="d">incl. VAT</span></div>
          <div class="tile hl"><small>Gross profit <em>excl. VAT</em></small><strong>${money0(p.grossProfit)}</strong><span class="d">${pct(p.margin)} margin on goods</span></div>
        </div>
        ${p.uncostedEx > 0.5 ? `<p class="note warn">${money0(p.uncostedEx)} of this period's sales are for products without a cost price, so profit is overstated. Add cost prices under <button type="button" class="linkish" data-goto="products">Products</button>.</p>` : ""}
        <div class="a-cols fin" style="margin-top:18px">
          <div class="panel"><h2>Month by month</h2><div class="tbl-wrap"><table class="tbl compact" style="min-width:0"><thead><tr><th>Month</th><th class="num">Orders</th><th class="num">Gross (incl VAT)</th><th class="num">VAT</th><th class="num">Net (excl VAT)</th><th class="num">Cost of goods</th><th class="num">Gross profit</th></tr></thead><tbody>
            ${f.monthly.length ? f.monthly.map((m) => `<tr><td>${esc(monthName(m.month))}</td><td class="num">${int(m.orders)}</td><td class="num">${money(m.gross)}</td><td class="num">${money(m.vat)}</td><td class="num">${money(m.netEx)}</td><td class="num">${money(m.cogs)}</td><td class="num"><b>${money(m.profit)}</b></td></tr>`).join("") : `<tr><td colspan="7" class="muted" style="padding:20px">No sales yet.</td></tr>`}
          </tbody></table></div></div>
          <div class="panel"><h2>Refunds &amp; cancellations <small>this period</small></h2><div class="kv pad"><span>Refunded</span><b>${int(p.refunded.n)} · ${money(p.refunded.amount)}</b><span>Cancelled</span><b>${int(p.cancelled.n)} · ${money(p.cancelled.amount)}</b></div>
            <h2 class="sub">Who owes you (30-day accounts)</h2>${f.debtors.length ? `<div class="tbl-wrap"><table class="tbl" style="min-width:0"><tbody>${f.debtors.map((d) => `<tr class="click" data-cust="${d.id}"><td><strong>${esc(d.business || d.name)}</strong><div class="muted">${int(d.orders)} order${d.orders === 1 ? "" : "s"} · since ${dateOnly(d.oldest)}</div></td><td class="num"><b>${money(d.owed)}</b></td></tr>`).join("")}</tbody></table></div>` : `<p class="empty-note">Nobody owes you on account right now.</p>`}
          </div>
        </div>
        <div class="panel" style="margin-top:18px"><h2>Waiting for EFT payment <small>mark them paid when the money arrives</small></h2>${f.unpaidOrders.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>Placed</th><th class="num">Amount</th><th></th></tr></thead><tbody>
          ${f.unpaidOrders.map((o) => `<tr><td><strong>${esc(o.ref)}</strong></td><td>${esc(o.customer.name)}<div class="muted">${esc(o.customer.email)}</div></td><td class="muted">${date(o.createdAt)}</td><td class="num"><b>${money(o.total)}</b></td><td class="num"><button class="btn btn-primary btn-sm" data-markpaid="${o.id}">Mark paid</button> <button class="btn btn-ghost btn-sm" data-order="${o.id}">Open</button></td></tr>`).join("")}
          </tbody></table></div>` : `<p class="empty-note">No unpaid EFT orders. 🎉</p>`}</div>`);
      f.unpaidOrders.forEach((o) => { cache["o" + o.id] = o; });
      bindRange(finances);
      $("#csvLedger").addEventListener("click", async () => {
        const { orders: list } = await api("/api/admin/orders?type=order");
        download("mpm-sales-ledger.csv", csv([
          ["date", "ref", "status", "payment_status", "payment_method", "customer", "business", "vat_number", "goods_ex_vat", "discount_ex_vat", "delivery_ex_vat", "vat", "total_incl_vat", "cost_of_goods", "gross_profit_ex_vat"],
          ...list.map((o) => {
            const cogs = o.items.reduce((a, i) => a + i.units * (i.unitCost || 0), 0);
            const goods = o.subtotal - o.discount;
            return [o.createdAt, o.ref, o.status, o.paymentStatus, o.paymentMethod, o.customer.name, o.customer.business, o.customer.vat, goods.toFixed(2), o.discount.toFixed(2), o.delivery.toFixed(2), o.vat.toFixed(2), o.total.toFixed(2), cogs.toFixed(2), (goods - cogs).toFixed(2)];
          }),
        ]));
      });
    } catch (err) { fail(err); }
  }

  /* ================================================================ inventory */
  async function inventory() {
    loading("Inventory");
    try {
      const [{ products: list }, { movements }] = await Promise.all([api("/api/admin/products"), api("/api/admin/stock-movements")]);
      list.forEach((p) => { cache["p" + p.id] = p; });
      const value = list.reduce((a, p) => a + Math.max(0, p.stockUnits) * (p.cost || 0), 0);
      const REASON = { sale: "Sold", cancel: "Order cancelled", restock: "Restocked", adjust: "Adjusted", damaged: "Damaged / lost", count: "Stock count", edit: "Edited", new: "New product", return: "Customer return" };
      main(`${head("Inventory", `Stock on hand in single units. Stock value at cost: <b>${money0(value)}</b>. Every change is recorded below.`,
        `<input class="input" id="iq" type="search" placeholder="Search name or SKU"><select class="select" id="ist"><option value="">All stock</option><option value="low">Low or sold out</option></select>`)}
        <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th class="num">In stock</th><th class="num">Cases</th><th class="num">Value at cost</th><th>Receive / adjust stock</th></tr></thead><tbody id="iBody">
          ${list.map((p) => `<tr data-s="${esc((p.name + " " + p.sku).toLowerCase())}" data-low="${p.stock !== "in" ? 1 : 0}" class="${p.active ? "" : "inactive"}">
            <td><div class="prod">${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="thumb"></span>`}<div><strong class="click" data-product="${esc(p.id)}">${esc(p.name)}</strong><span class="muted">${esc(p.sku)} · case of ${p.pack}</span></div></div></td>
            <td class="num ${p.stockUnits <= 0 ? "no-stock" : p.stock === "low" ? "low-stock" : ""}"><b>${int(p.stockUnits)}</b></td>
            <td class="num muted">${(p.stockUnits / p.pack).toFixed(p.stockUnits % p.pack ? 1 : 0)}</td>
            <td class="num">${p.cost ? money0(Math.max(0, p.stockUnits) * p.cost) : '<span class="muted">no cost</span>'}</td>
            <td><form class="adj" data-adj="${esc(p.id)}"><select class="select" name="reason" aria-label="Reason"><option value="restock">Received</option><option value="damaged">Damaged / lost</option><option value="return">Customer return</option><option value="count">Counted (set total)</option><option value="adjust">Other adjustment</option></select><input class="input" name="qty" type="number" placeholder="Units" aria-label="Units"><label class="adj-case"><input type="checkbox" name="cases"> cases</label><button class="btn btn-primary btn-sm" type="submit">Save</button></form></td>
          </tr>`).join("")}
        </tbody></table></div></div>
        <div class="panel" style="margin-top:18px"><h2>Recent stock movements</h2>${movements.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>Product</th><th>What</th><th class="num">Change</th><th class="num">Balance</th><th>Reference / note</th><th>By</th></tr></thead><tbody>
          ${movements.map((m) => `<tr><td class="muted">${date(m.created_at)}</td><td>${esc(m.name || m.product_id)}</td><td>${esc(REASON[m.reason] || m.reason)}</td><td class="num ${m.change > 0 ? "pos" : "neg"}">${m.change > 0 ? "+" : ""}${int(m.change)}</td><td class="num">${int(m.balance)}</td><td class="muted">${esc([m.ref, m.note].filter(Boolean).join(" · "))}</td><td class="muted">${esc(m.by_user || (m.reason === "sale" ? "Shop" : ""))}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="empty-note">No stock movements yet.</p>`}</div>`);
      const filter = () => { const q = $("#iq").value.trim().toLowerCase(), low = $("#ist").value === "low"; $$("#iBody tr").forEach((r) => { r.hidden = (q && !r.dataset.s.includes(q)) || (low && r.dataset.low !== "1"); }); };
      $("#iq").addEventListener("input", filter); $("#ist").addEventListener("input", filter);
      $$("form[data-adj]").forEach((fm) => fm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const p = cache["p" + fm.dataset.adj], reason = fm.reason.value;
        let n = parseInt(fm.qty.value, 10);
        if (!Number.isFinite(n)) { toast("Enter a number of units"); return; }
        if (fm.cases.checked) n *= p.pack;
        const body = reason === "count" ? { reason, counted: n } : { reason, change: reason === "damaged" ? -Math.abs(n) : reason === "restock" || reason === "return" ? Math.abs(n) : n };
        try { const r = await api(`/api/admin/products/${encodeURIComponent(p.id)}/stock`, { method: "POST", body }); toast(`${p.name}: now ${int(r.product.stockUnits)} units`); inventory(); refreshBadges(); }
        catch (err) { toast(err.message); }
      }));
    } catch (err) { fail(err); }
  }

  /* ================================================================ discounts */
  async function discounts() {
    loading("Discounts");
    try {
      const { discounts: list, today } = await api("/api/admin/discounts");
      const state = (d) => !d.active ? ["cancelled", "Off"] : d.ends_at && today > d.ends_at ? ["cancelled", "Expired"] : d.starts_at && today < d.starts_at ? ["pending_payment", "Scheduled"] : d.max_uses && d.uses >= d.max_uses ? ["cancelled", "Used up"] : ["delivered", "Active"];
      main(`${head("Discount codes", "Codes customers can enter at checkout. Discounts come off the goods total before VAT and delivery.", '<button class="btn btn-primary btn-sm" id="addDisc">+ Create code</button>')}
        <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Discount</th><th>Rules</th><th class="num">Used</th><th class="num">Given away</th><th>Status</th></tr></thead><tbody>
          ${list.length ? list.map((d) => { const [cls, lbl] = state(d); return `<tr class="click" data-disc="${d.id}"><td><strong class="code">${esc(d.code)}</strong>${d.note ? `<div class="muted">${esc(d.note)}</div>` : ""}</td>
            <td>${d.type === "percent" ? `${+d.value}% off` : `${money(d.value)} off`}</td>
            <td class="muted">${[d.min_spend ? `min ${money0(d.min_spend)}` : "", d.applies_to !== "all" ? (d.applies_to === "trade" ? "trade orders" : "home orders") : "", d.starts_at ? `from ${d.starts_at}` : "", d.ends_at ? `until ${d.ends_at}` : ""].filter(Boolean).join(" · ") || "Any order"}</td>
            <td class="num">${int(d.uses)}${d.max_uses ? ` / ${int(d.max_uses)}` : ""}</td><td class="num">${money0(d.given_ex * 1.15)}</td><td><span class="pill s-${cls}">${lbl}</span></td></tr>`; }).join("") : `<tr><td colspan="6" class="muted" style="padding:24px">No discount codes yet. Create one for a launch special, a newsletter offer or a loyal customer.</td></tr>`}
        </tbody></table></div></div>`);
      list.forEach((d) => { cache["d" + d.id] = d; });
      $("#addDisc").addEventListener("click", () => discountDrawer(null));
    } catch (err) { fail(err); }
  }
  function discountDrawer(d) {
    const isNew = !d;
    d = d || { code: "", type: "percent", value: 10, min_spend: 0, applies_to: "all", starts_at: "", ends_at: "", max_uses: 0, active: 1, note: "" };
    openDrawer(`<div class="d-head"><div><h2>${isNew ? "New discount code" : esc(d.code)}</h2><small>${isNew ? "" : `Used ${int(d.uses)} time${d.uses === 1 ? "" : "s"}`}</small></div><button class="d-close" data-close aria-label="Close">×</button></div>
      <form class="d-body" id="dForm" novalidate><div class="fields">
        <div class="field full"><label>Code customers type</label><input class="input code-in" name="code" value="${esc(d.code)}" placeholder="e.g. WELCOME10" maxlength="40" required></div>
        <div class="field"><label>Type</label><select class="select" name="type" style="width:100%"><option value="percent" ${d.type === "percent" ? "selected" : ""}>Percentage off</option><option value="fixed" ${d.type === "fixed" ? "selected" : ""}>Fixed amount off (R, incl VAT)</option></select></div>
        <div class="field"><label>Amount</label><input class="input" name="value" type="number" step="0.01" min="0" value="${d.value}"></div>
        <div class="field"><label>Minimum spend (R incl VAT, optional)</label><input class="input" name="minSpend" type="number" step="1" min="0" value="${d.min_spend || ""}"></div>
        <div class="field"><label>Who can use it</label><select class="select" name="appliesTo" style="width:100%"><option value="all" ${d.applies_to === "all" ? "selected" : ""}>Everyone</option><option value="home" ${d.applies_to === "home" ? "selected" : ""}>Home orders only</option><option value="trade" ${d.applies_to === "trade" ? "selected" : ""}>Trade (case) orders only</option></select></div>
        <div class="field"><label>Starts (optional)</label><input class="input" name="startsAt" type="date" value="${esc(d.starts_at)}"></div>
        <div class="field"><label>Ends (optional)</label><input class="input" name="endsAt" type="date" value="${esc(d.ends_at)}"></div>
        <div class="field"><label>Usage limit (0 = unlimited)</label><input class="input" name="maxUses" type="number" min="0" value="${d.max_uses}"></div>
        <div class="field"><label>Status</label><select class="select" name="active" style="width:100%"><option value="1" ${d.active ? "selected" : ""}>Active</option><option value="0" ${d.active ? "" : "selected"}>Switched off</option></select></div>
        <div class="field full"><label>Internal note (optional)</label><input class="input" name="note" value="${esc(d.note)}" placeholder="e.g. Instagram launch promo"></div>
      </div></form>
      <div class="d-foot">${isNew ? "" : '<button class="btn btn-ghost btn-sm" id="dDel">Delete</button>'}<span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary btn-sm" id="dSaveDisc">${isNew ? "Create code" : "Save changes"}</button></div>`);
    $("#dSaveDisc").addEventListener("click", async () => {
      const b = Object.fromEntries(new FormData($("#dForm")));
      b.active = b.active === "1";
      try { await api(isNew ? "/api/admin/discounts" : `/api/admin/discounts/${d.id}`, { method: isNew ? "POST" : "PATCH", body: b }); toast(isNew ? "Discount code created" : "Saved"); closeDrawer(); discounts(); }
      catch (err) { toast(err.message); }
    });
    $("#dDel")?.addEventListener("click", async () => {
      if (!confirm(`Delete the code ${d.code}? Past orders keep their discount.`)) return;
      try { await api(`/api/admin/discounts/${d.id}`, { method: "DELETE" }); toast("Deleted"); closeDrawer(); discounts(); } catch (err) { toast(err.message); }
    });
  }

  async function productHistory(id) {
    try {
      const { movements } = await api(`/api/admin/products/${encodeURIComponent(id)}/history`);
      const box = $("#pHist"); if (!box) return;
      const REASON = { sale: "Sold", cancel: "Order cancelled", restock: "Restocked", adjust: "Adjusted", damaged: "Damaged / lost", count: "Stock count", edit: "Edited", new: "New product", return: "Customer return" };
      box.innerHTML = movements.length ? `<div class="d-items">${movements.slice(0, 15).map((m) => `<div><span>${esc(REASON[m.reason] || m.reason)}${m.ref ? ` · ${esc(m.ref)}` : ""}<br><small>${date(m.created_at)}${m.by_user ? " · " + esc(m.by_user) : ""}${m.note ? " · " + esc(m.note) : ""}</small></span><b class="${m.change > 0 ? "pos" : "neg"}">${m.change > 0 ? "+" : ""}${int(m.change)} → ${int(m.balance)}</b></div>`).join("")}</div>` : `<p class="muted">No changes recorded yet.</p>`;
    } catch { /* ignore */ }
  }

  /* ================================================================ helpers: CSV, drawer, clicks */
  const csv = (rows) => "﻿" + rows.map((r) => r.map((v) => { const s = String(v ?? ""); return /^[=+\-@]/.test(s) ? `"'${s.replace(/"/g, '""')}"` : `"${s.replace(/"/g, '""')}"`; }).join(",")).join("\r\n");
  const download = (name, text) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };

  function openDrawer(html) {
    const d = $("#drawer"); d.innerHTML = html; $("#dScrim").hidden = false; hideTip();
    requestAnimationFrame(() => d.classList.add("on")); d.setAttribute("aria-hidden", "false");
  }
  function closeDrawer() { const d = $("#drawer"); d.classList.remove("on"); d.setAttribute("aria-hidden", "true"); $("#dScrim").hidden = true; }
  $("#dScrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]")) { e.preventDefault(); closeDrawer(); return; }
    const g = e.target.closest("[data-goto]"); if (g) { show(g.dataset.goto); return; }
    const o = e.target.closest("[data-order]"); if (o) { const ord = cache["o" + o.dataset.order]; if (ord) orderDrawer(ord); return; }
    const cu = e.target.closest("[data-cust]"); if (cu) { customerDrawer(cu.dataset.cust); return; }
    const ce = e.target.closest("[data-cat-edit]"); if (ce) { categoryDrawer(cache["c" + ce.dataset.catEdit]); return; }
    const di = e.target.closest("[data-disc]"); if (di) { discountDrawer(cache["d" + di.dataset.disc]); return; }
    const mp = e.target.closest("[data-markpaid]");
    if (mp) { try { await api(`/api/admin/orders/${mp.dataset.markpaid}`, { method: "PATCH", body: { status: "paid", paymentStatus: "paid" } }); toast("Marked as paid"); show(tab); refreshBadges(); } catch (err) { toast(err.message); } return; }
    const p = e.target.closest("[data-product]");
    if (p) {
      if (!cache["p" + p.dataset.product] || !catList.length) { const r = await api("/api/admin/products"); catList = r.categories; r.products.forEach((x) => { cache["p" + x.id] = x; }); }
      productDrawer(cache["p" + p.dataset.product]); return;
    }
    const t = e.target.closest("[data-trade]");
    if (t) { try { await api(`/api/admin/trade/${t.dataset.trade}`, { method: "PATCH", body: { status: t.dataset.st } }); toast(t.dataset.st === "approved" ? "Approved: they can now see trade prices" : "Updated"); trade(); refreshBadges(); } catch (err) { toast(err.message); } return; }
    const dm = e.target.closest("[data-demote]");
    if (dm) {
      if (!confirm("Remove this person's admin access? They'll keep their shop account.")) return;
      try { await api(`/api/admin/customers/${dm.dataset.demote}`, { method: "PATCH", body: { role: "customer" } }); toast("Admin access removed"); team(); } catch (err) { toast(err.message); }
    }
  });

  boot();
})();
