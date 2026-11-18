/* MPM Digital — admin dashboard */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "R" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, " ");
  const date = (s) => s ? new Date(s.replace(" ", "T") + "Z").toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const ICONS = window.MPM_ICONS || {};

  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, { method, credentials: "same-origin", headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "X-Requested-With": "mpm" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    let data = {}; try { data = await res.json(); } catch { /* ignore */ }
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
    return data;
  }
  let toastT;
  const toast = (m) => { const t = $("#toast"); t.innerHTML = `<span>${esc(m)}</span>`; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2800); };

  const ORDER_STATUS = { pending_payment: "Awaiting payment", paid: "Paid", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled" };
  const MSG_STATUS = { new: "New", replied: "Replied", closed: "Closed" };
  const PAY_STATUS = { unpaid: "Unpaid", paid: "Paid", on_account: "On account", refunded: "Refunded" };
  const PAY_METHOD = { eft: "EFT", card: "Card", "instant-eft": "Instant EFT", account: "30-day account" };
  const pill = (s, map) => `<span class="pill s-${esc(s)}">${esc(map[s] || s)}</span>`;

  let me = null, tab = "overview", cache = {};

  /* ---------- auth ---------- */
  async function boot() {
    try { me = (await api("/api/me")).user; } catch { me = null; }
    if (!me || me.role !== "admin") {
      $("#login").hidden = false; $("#shell").hidden = true;
      if (me) $("#loginErr").textContent = "This account isn't an admin. Sign in with the admin account.";
      return;
    }
    $("#login").hidden = true; $("#shell").hidden = false;
    $("#meName").textContent = me.email;
    show(location.hash.slice(1) || "overview");
  }
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#loginErr").textContent = "";
    try { await api("/api/auth/login", { method: "POST", body: Object.fromEntries(new FormData(e.currentTarget)) }); boot(); }
    catch (err) { $("#loginErr").textContent = err.message; }
  });
  $("#logout").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }).catch(() => {}); location.reload(); });

  /* ---------- nav ---------- */
  $("#aNav").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) show(b.dataset.tab); });
  function show(t) {
    tab = ["overview", "orders", "messages", "products", "trade", "customers"].includes(t) ? t : "overview";
    history.replaceState(null, "", "#" + tab);
    $$("#aNav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    ({ overview, orders: () => orders("order"), messages: () => orders("msg"), products, trade, customers })[tab]();
  }
  const main = (html) => { $("#main").innerHTML = html; };
  const loading = (title) => main(`<div class="a-head"><div><h1>${title}</h1><p>Loading…</p></div></div>`);
  const fail = (err) => { if (err.status === 401 || err.status === 403) return boot(); main(`<div class="panel"><p class="empty-note">${esc(err.message)}</p></div>`); };

  /* ---------- overview ---------- */
  async function overview() {
    loading("Overview");
    try {
      const s = await api("/api/admin/summary");
      $("#bOrders").textContent = s.awaitingPayment + s.toFulfil || "";
      $("#bMsgs").textContent = s.newMessages || "";
      $("#bTrade").textContent = s.pendingTrade || "";
      main(`<div class="a-head"><div><h1>Overview</h1><p>Here's what needs attention today.</p></div><a class="btn btn-ghost btn-sm" href="/" target="_blank" rel="noopener">View shop ↗</a></div>
        <div class="tiles">
          <div class="tile hl"><small>Revenue (30 days)</small><strong>${money(s.revenue30)}</strong></div>
          <div class="tile"><small>Orders today</small><strong>${s.ordersToday}</strong></div>
          <div class="tile"><small>Awaiting payment</small><strong>${s.awaitingPayment}</strong></div>
          <div class="tile"><small>To pack &amp; ship</small><strong>${s.toFulfil}</strong></div>
          <div class="tile"><small>New messages</small><strong>${s.newMessages}</strong></div>
          <div class="tile"><small>Trade to review</small><strong>${s.pendingTrade}</strong></div>
        </div>
        <div class="a-cols">
          <div class="panel"><h2>Recent activity</h2>${s.recent.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
            ${s.recent.map((o) => `<tr class="click" data-order="${o.id}"><td><strong>${esc(o.ref)}</strong><div class="muted">${date(o.createdAt)}</div></td><td>${esc(o.customer.name)}<div class="muted">${esc(o.customer.email)}</div></td><td>${pill(o.status, { ...ORDER_STATUS, ...MSG_STATUS })}</td><td class="num">${o.type === "order" ? money(o.total) : esc(o.type)}</td></tr>`).join("")}
            </tbody></table></div>` : `<p class="empty-note">No orders yet. They'll appear here as soon as customers check out.</p>`}</div>
          <div class="panel"><h2>Low stock</h2>${s.lowStock.length ? `<div class="tbl-wrap"><table class="tbl" style="min-width:0"><tbody>${s.lowStock.map((p) => `<tr class="click" data-product="${esc(p.id)}"><td>${esc(p.name)}</td><td class="num ${p.stock_units <= 0 ? "no-stock" : "low-stock"}">${p.stock_units} units</td></tr>`).join("")}</tbody></table></div>` : `<p class="empty-note">All products are well stocked.</p>`}
            <p class="empty-note">${s.customers} customer accounts · ${s.subscribers} newsletter subscribers</p></div>
        </div>`);
      s.recent.forEach((o) => { cache["o" + o.id] = o; });
    } catch (err) { fail(err); }
  }

  /* ---------- orders & messages ---------- */
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
      list.forEach((o) => { cache["o" + o.id] = o; });
      $("#oBody").innerHTML = list.length ? list.map((o) => `<tr class="click" data-order="${o.id}">
          <td><strong>${esc(o.ref)}</strong><div class="muted">${date(o.createdAt)}</div></td>
          <td>${esc(o.customer.name)}${o.customer.business ? `<div class="muted">${esc(o.customer.business)}</div>` : `<div class="muted">${esc(o.customer.email)}</div>`}</td>
          <td>${isMsg ? esc(o.type === "quote" ? "Quote request" : "Message") : `${o.mode === "business" ? "Business" : "Home"} · ${o.items.length} line${o.items.length === 1 ? "" : "s"}`}</td>
          <td>${pill(o.status, statusMap)}</td>
          ${isMsg ? "" : `<td>${esc(PAY_METHOD[o.paymentMethod] || o.paymentMethod)}<div class="muted">${esc(PAY_STATUS[o.paymentStatus] || o.paymentStatus)}</div></td><td class="num">${money(o.total)}</td>`}
        </tr>`).join("") : `<tr><td colspan="6" class="muted" style="padding:24px">Nothing here yet.</td></tr>`;
    };
    main(`<div class="a-head"><div><h1>${isMsg ? "Quotes &amp; messages" : "Orders"}</h1><p>${isMsg ? "Quote requests and contact messages from the shop." : "Click an order to see details and update its status."}</p></div>
      <div class="a-tools"><input class="input" id="oq" type="search" placeholder="Search ref, name or email"><select class="select" id="ost"><option value="">All statuses</option>${Object.entries(statusMap).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div></div>
      <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Ref</th><th>Customer</th><th>${isMsg ? "Type" : "Order"}</th><th>Status</th>${isMsg ? "" : "<th>Payment</th><th class='num'>Total</th>"}</tr></thead><tbody id="oBody"></tbody></table></div></div>`);
    let t; $("#oq").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => render().catch(fail), 250); });
    $("#ost").addEventListener("change", () => render().catch(fail));
    render().catch(fail);
  }

  function orderDrawer(o) {
    const isOrder = o.type === "order", c = o.customer, statusMap = isOrder ? ORDER_STATUS : MSG_STATUS;
    openDrawer(`<div class="d-head"><div><h2>${esc(o.ref)}</h2><small>${esc(o.type === "order" ? "Order" : o.type === "quote" ? "Quote request" : "Message")} · ${date(o.createdAt)} · ${o.mode === "business" ? "Business" : "Home"} shopper</small></div><button class="d-close" data-close aria-label="Close">×</button></div>
      <div class="d-body">
        <div class="d-sec"><h3>Customer</h3><div class="kv">
          <span>Name</span><b>${esc(c.name)}</b>
          ${c.business ? `<span>Business</span><b>${esc(c.business)}${c.vat ? ` · VAT ${esc(c.vat)}` : ""}</b>` : ""}
          <span>Email</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a>
          <span>Phone</span><a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>
          ${c.street ? `<span>Deliver to</span><b>${esc(c.street)}, ${esc(c.city)}, ${esc(c.province)}, ${esc(c.postal)}</b>` : ""}
          ${c.notes ? `<span>Delivery notes</span><b>${esc(c.notes)}</b>` : ""}
        </div></div>
        ${o.message ? `<div class="d-sec"><h3>Message</h3><p style="white-space:pre-wrap">${esc(o.message)}</p></div>` : ""}
        ${o.items.length ? `<div class="d-sec"><h3>Items</h3><div class="d-items">
          ${o.items.map((i) => `<div><span>${esc(i.name)}<br><small>${esc(i.sku)} · ${i.kind === "case" ? `${i.qty} case${i.qty === 1 ? "" : "s"}` : `${i.qty} single`} · ${i.units} units · ${money(i.unitEx)}/unit ex VAT</small></span><b>${money(i.lineEx)}</b></div>`).join("")}
          ${isOrder ? `<div><span>Subtotal (ex VAT)</span><b>${money(o.subtotal)}</b></div><div><span>Delivery</span><b>${money(o.delivery)}</b></div><div><span>VAT</span><b>${money(o.vat)}</b></div><div class="tot"><span>Total</span><b>${money(o.total)}</b></div>` : ""}
        </div></div>` : ""}
        <div class="d-sec"><h3>Update</h3><div class="fields">
          <div class="field"><label for="dStatus">Status</label><select class="select" id="dStatus" style="width:100%">${Object.entries(statusMap).map(([k, v]) => `<option value="${k}" ${k === o.status ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          ${isOrder ? `<div class="field"><label for="dPay">Payment (${esc(PAY_METHOD[o.paymentMethod] || o.paymentMethod)})</label><select class="select" id="dPay" style="width:100%">${Object.entries(PAY_STATUS).map(([k, v]) => `<option value="${k}" ${k === o.paymentStatus ? "selected" : ""}>${v}</option>`).join("")}</select></div>` : ""}
          <div class="field full"><label for="dNotes">Internal notes</label><textarea class="textarea" id="dNotes" placeholder="Courier tracking number, call notes…">${esc(o.adminNotes)}</textarea></div>
        </div>${isOrder ? `<p class="form-hint">Cancelling an order puts its stock back automatically.</p>` : ""}</div>
      </div>
      <div class="d-foot"><button class="btn btn-ghost btn-sm" data-close>Close</button><button class="btn btn-primary btn-sm" id="dSave">Save changes</button></div>`);
    $("#dSave").addEventListener("click", async () => {
      try {
        await api(`/api/admin/orders/${o.id}`, { method: "PATCH", body: { status: $("#dStatus").value, paymentStatus: $("#dPay")?.value, adminNotes: $("#dNotes").value } });
        toast("Saved"); closeDrawer(); show(tab);
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------- products ---------- */
  let catList = [];
  async function products() {
    loading("Products");
    try {
      const { products: list, categories } = await api("/api/admin/products");
      catList = categories;
      list.forEach((p) => { cache["p" + p.id] = p; });
      main(`<div class="a-head"><div><h1>Products</h1><p>${list.length} products · prices: wholesale per unit ex VAT, retail (RRP) incl. VAT. Stock is counted in single units.</p></div>
        <div class="a-tools"><input class="input" id="pq" type="search" placeholder="Search name or SKU"><button class="btn btn-primary btn-sm" id="addProd">+ Add product</button></div></div>
        <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Product</th><th>Category</th><th class="num">Wholesale</th><th class="num">Retail</th><th class="num">Case</th><th class="num">Stock</th><th>Status</th></tr></thead><tbody id="pBody">
        ${list.map((p) => `<tr class="click ${p.active ? "" : "inactive"}" data-product="${esc(p.id)}" data-s="${esc((p.name + " " + p.sku).toLowerCase())}">
          <td><div class="prod">${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : `<span class="thumb"></span>`}<div><strong>${esc(p.name)}</strong><span class="muted">${esc(p.sku)}</span></div></div></td>
          <td class="muted">${esc((categories.find((c) => c.id === p.cat) || {}).name || p.cat)}</td>
          <td class="num">${money(p.price)}</td><td class="num">${money(p.rrp)}</td><td class="num">${p.pack} · MOQ ${p.moq}</td>
          <td class="num ${p.stockUnits <= 0 ? "no-stock" : p.stock === "low" ? "low-stock" : ""}">${p.stockUnits}</td>
          <td>${p.active ? '<span class="pill s-delivered">Live</span>' : '<span class="pill s-cancelled">Hidden</span>'}</td></tr>`).join("")}
        </tbody></table></div></div>`);
      $("#pq").addEventListener("input", (e) => { const q = e.target.value.trim().toLowerCase(); $$("#pBody tr").forEach((r) => { r.hidden = q && !r.dataset.s.includes(q); }); });
      $("#addProd").addEventListener("click", () => productDrawer(null));
    } catch (err) { fail(err); }
  }

  function productDrawer(p) {
    const isNew = !p;
    p = p || { name: "", sku: "", cat: catList[0]?.id, supplier: "", pack: 12, moq: 1, price: 0, rrp: 0, stockUnits: 0, badge: "", desc: "", specs: {}, active: true, icon: "box" };
    const specRow = (k = "", v = "") => `<div class="row"><input class="input" placeholder="Label (e.g. Material)" value="${esc(k)}"><input class="input" placeholder="Value" value="${esc(v)}"><button type="button" class="x" aria-label="Remove">×</button></div>`;
    openDrawer(`<div class="d-head"><div><h2>${isNew ? "New product" : esc(p.name)}</h2><small>${isNew ? "Fill in the details below." : esc(p.sku)}</small></div><button class="d-close" data-close aria-label="Close">×</button></div>
      <form class="d-body" id="pForm" novalidate>
        ${isNew ? "" : `<div class="d-sec"><h3>Photo</h3><div class="img-edit"><img id="pImg" src="${esc(p.image || "")}" alt=""><div><label class="btn btn-ghost btn-sm">Change photo<input type="file" id="pFile" accept="image/jpeg,image/png,image/webp"></label><p class="form-hint">Square photos look best. JPG, PNG or WebP; large photos are resized automatically.</p></div></div></div>`}
        <div class="d-sec"><h3>Details</h3><div class="fields">
          <div class="field full"><label>Name</label><input class="input" name="name" value="${esc(p.name)}" required></div>
          <div class="field"><label>SKU</label><input class="input" name="sku" value="${esc(p.sku)}" required></div>
          <div class="field"><label>Category</label><select class="select" name="cat" style="width:100%">${catList.map((c) => `<option value="${esc(c.id)}" ${c.id === p.cat ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></div>
          <div class="field"><label>Supplier / brand</label><input class="input" name="supplier" value="${esc(p.supplier)}"></div>
          <div class="field"><label>Badge</label><select class="select" name="badge" style="width:100%">${["", "Best seller", "Hot", "New"].map((b) => `<option ${b === p.badge ? "selected" : ""} value="${b}">${b || "None"}</option>`).join("")}</select></div>
          <div class="field full"><label>Description</label><textarea class="textarea" name="desc">${esc(p.desc)}</textarea></div>
        </div></div>
        <div class="d-sec"><h3>Pricing &amp; stock</h3><div class="fields">
          <div class="field"><label>Wholesale price / unit (ex VAT)</label><input class="input" name="price" type="number" step="0.01" min="0" value="${p.price}"></div>
          <div class="field"><label>Retail price / unit (incl VAT)</label><input class="input" name="rrp" type="number" step="0.01" min="0" value="${p.rrp}"></div>
          <div class="field"><label>Units per case</label><input class="input" name="pack" type="number" min="1" value="${p.pack}"></div>
          <div class="field"><label>Minimum order (cases)</label><input class="input" name="moq" type="number" min="1" value="${p.moq}"></div>
          <div class="field"><label>Stock on hand (units)</label><input class="input" name="stockUnits" type="number" value="${p.stockUnits}"></div>
          <div class="field"><label>Visibility</label><select class="select" name="active" style="width:100%"><option value="1" ${p.active ? "selected" : ""}>Live in shop</option><option value="0" ${p.active ? "" : "selected"}>Hidden</option></select></div>
        </div></div>
        <div class="d-sec"><h3>Specifications</h3><div class="specs-edit" id="specs">${Object.entries(p.specs || {}).map(([k, v]) => specRow(k, v)).join("")}</div>
          <button type="button" class="btn btn-ghost btn-sm" id="addSpec" style="margin-top:8px">+ Add spec</button></div>
        ${isNew ? `<p class="form-hint">You can add a photo after saving.</p>` : ""}
      </form>
      <div class="d-foot"><button class="btn btn-ghost btn-sm" data-close>Cancel</button><button class="btn btn-primary btn-sm" id="pSave">${isNew ? "Create product" : "Save changes"}</button></div>`);
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
        products();
      } catch (err) { toast(err.message); }
    });
    const file = $("#pFile");
    if (file) file.addEventListener("change", () => {
      const fl = file.files[0]; if (!fl) return;
      if (fl.size > 25 * 1024 * 1024) { toast("That file is too large"); return; }
      const img = new Image(), src = URL.createObjectURL(fl);
      img.onload = async () => {
        // resize to max 1200px and re-encode as JPEG so uploads stay small
        const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(src);
        toast("Uploading photo…");
        try { const r = await api(`/api/admin/products/${encodeURIComponent(p.id)}/image`, { method: "POST", body: { dataUrl: c.toDataURL("image/jpeg", 0.85) } }); $("#pImg").src = r.product.image; toast("Photo updated"); products(); }
        catch (err) { toast(err.message); }
      };
      img.onerror = () => { URL.revokeObjectURL(src); toast("That file isn't an image we can read"); };
      img.src = src;
    });
  }

  /* ---------- trade ---------- */
  async function trade() {
    loading("Trade accounts");
    try {
      const { applications } = await api("/api/admin/trade");
      main(`<div class="a-head"><div><h1>Trade accounts</h1><p>Approving an application unlocks 30-day account payment for that customer at checkout.</p></div></div>
        <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Business</th><th>Contact</th><th>Details</th><th>Status</th><th></th></tr></thead><tbody>
        ${applications.length ? applications.map((a) => `<tr>
          <td><strong>${esc(a.business_name)}</strong><div class="muted">${esc(a.business_type)} · ${date(a.created_at)}</div></td>
          <td>${esc(a.contact)}<div class="muted"><a href="mailto:${esc(a.email)}">${esc(a.email)}</a> · ${esc(a.phone)}</div></td>
          <td class="muted">${a.cipc ? `CIPC ${esc(a.cipc)}<br>` : ""}${a.vat_number ? `VAT ${esc(a.vat_number)}<br>` : ""}Spend: ${esc(a.monthly_spend)}${a.wants_terms ? "<br><b>Wants 30-day terms</b>" : ""}</td>
          <td>${pill(a.status === "approved" ? "delivered" : a.status === "rejected" ? "cancelled" : "pending_payment", { delivered: "Approved", cancelled: "Rejected", pending_payment: "Pending" })}</td>
          <td><div class="row-actions">${a.status !== "approved" ? `<button class="btn btn-primary" data-trade="${a.id}" data-st="approved">Approve</button>` : ""}${a.status !== "rejected" ? `<button class="btn btn-ghost" data-trade="${a.id}" data-st="rejected">Reject</button>` : ""}</div></td>
        </tr>`).join("") : `<tr><td colspan="5" class="muted" style="padding:24px">No applications yet.</td></tr>`}
        </tbody></table></div></div>`);
    } catch (err) { fail(err); }
  }

  /* ---------- customers ---------- */
  async function customers() {
    loading("Customers");
    try {
      const { customers: list, subscribers } = await api("/api/admin/customers");
      main(`<div class="a-head"><div><h1>Customers</h1><p>${list.length} accounts · ${subscribers.length} newsletter subscribers</p></div>
        <div class="a-tools"><button class="btn btn-ghost btn-sm" id="csvSubs">Download subscribers (CSV)</button><button class="btn btn-ghost btn-sm" id="csvCust">Download customers (CSV)</button></div></div>
        <div class="panel"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Type</th><th class="num">Orders</th><th class="num">Spent</th><th>Joined</th></tr></thead><tbody>
        ${list.length ? list.map((u) => `<tr><td><strong>${esc(u.name)}</strong>${u.businessName ? `<div class="muted">${esc(u.businessName)}</div>` : ""}</td><td><a href="mailto:${esc(u.email)}">${esc(u.email)}</a><div class="muted">${esc(u.phone)}</div></td>
          <td>${u.accountType === "business" ? `Business${u.tradeStatus !== "none" ? ` · ${esc(u.tradeStatus)}` : ""}` : "Home"}</td><td class="num">${u.orderCount}</td><td class="num">${money(u.spent)}</td><td class="muted">${date(u.createdAt)}</td></tr>`).join("") : `<tr><td colspan="6" class="muted" style="padding:24px">No customer accounts yet.</td></tr>`}
        </tbody></table></div></div>`);
      const csv = (rows) => rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const dl = (name, text) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
      $("#csvSubs").addEventListener("click", () => dl("mpm-subscribers.csv", csv([["email", "subscribed"], ...subscribers.map((s) => [s.email, s.created_at])])));
      $("#csvCust").addEventListener("click", () => dl("mpm-customers.csv", csv([["name", "email", "phone", "type", "business", "trade_status", "orders", "spent", "joined"], ...list.map((u) => [u.name, u.email, u.phone, u.accountType, u.businessName, u.tradeStatus, u.orderCount, u.spent, u.createdAt])])));
    } catch (err) { fail(err); }
  }

  /* ---------- drawer & delegated clicks ---------- */
  function openDrawer(html) {
    const d = $("#drawer"); d.innerHTML = html; $("#dScrim").hidden = false;
    requestAnimationFrame(() => d.classList.add("on")); d.setAttribute("aria-hidden", "false");
  }
  function closeDrawer() { const d = $("#drawer"); d.classList.remove("on"); d.setAttribute("aria-hidden", "true"); $("#dScrim").hidden = true; }
  $("#dScrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  document.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]")) { e.preventDefault(); closeDrawer(); return; }
    const o = e.target.closest("[data-order]"); if (o) { const ord = cache["o" + o.dataset.order]; if (ord) orderDrawer(ord); return; }
    const p = e.target.closest("[data-product]");
    if (p) { if (!cache["p" + p.dataset.product]) { const r = await api("/api/admin/products"); catList = r.categories; r.products.forEach((x) => { cache["p" + x.id] = x; }); } productDrawer(cache["p" + p.dataset.product]); return; }
    const t = e.target.closest("[data-trade]");
    if (t) { try { await api(`/api/admin/trade/${t.dataset.trade}`, { method: "PATCH", body: { status: t.dataset.st } }); toast(t.dataset.st === "approved" ? "Approved" : "Rejected"); trade(); } catch (err) { toast(err.message); } }
  });

  boot();
})();
