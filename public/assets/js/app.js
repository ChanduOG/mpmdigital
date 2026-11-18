/* ==========================================================================
   MPM Digital — storefront app (no build step)
   Two ways to shop:
     • Home:     single units at retail price (incl. VAT)
     • Business: by the case at wholesale price with volume tiers (ex/inc VAT)
   ========================================================================== */
(() => {
  "use strict";

  const PR = window.MPMPricing;          // shared with the server (assets/js/pricing.js)
  const ICONS = window.MPM_ICONS || {};
  const { VAT_RATE, TIERS } = PR;
  let CATEGORIES = [], PRODUCTS = [], SETTINGS = { paymentMethods: [] };
  let user = null;                        // signed-in customer (or null)

  /* ---------- API ---------- */
  async function api(path, { method = "GET", body } = {}) {
    const res = await fetch(path, {
      method, credentials: "same-origin",
      headers: { "Accept": "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "X-Requested-With": "mpm" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) { const e = new Error(data.error || `Request failed (${res.status})`); e.status = res.status; throw e; }
    return data;
  }
  async function loadCatalog() {
    const c = await api("/api/catalog");
    CATEGORIES = c.categories; PRODUCTS = c.products; SETTINGS = c.settings;
    const chips = document.querySelector(".pay-chips");
    if (chips) chips.innerHTML = SETTINGS.paymentMethods.map((m) => `<span>${esc(m.label.replace(" / bank transfer", ""))}</span>`).join("");
  }
  const payWords = () => {
    const l = SETTINGS.paymentMethods.filter((m) => m.id !== "account").map((m) => m.label.replace(" / bank transfer", ""));
    return l.length ? "Pay securely by " + (l.length > 1 ? l.slice(0, -1).join(", ") + " or " + l[l.length - 1] : l[0]) : "Secure checkout";
  };

  /* ---------- helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  const byId = (id) => PRODUCTS.find((p) => p.id === id);
  const catOf = (p) => CATEGORIES.find((c) => c.id === p.cat);
  const { tierFor, nextTier, unitPrice, bestUnit, retailEx } = PR;
  const margin = (p) => Math.round((1 - (bestUnit(p) * (1 + VAT_RATE)) / p.rrp) * 100);
  const caseSaving = (p) => Math.round((1 - (p.price * (1 + VAT_RATE)) / p.rrp) * 100);
  const tone = (p) => (catOf(p) || {}).tone || "pink";

  /* ---------- state ---------- */
  let mode = store.get("mpm_mode", null);               // "home" | "business" | null (not chosen yet)
  let incVat = store.get("mpm_vat", false);
  let cart = store.get("mpm_cart", [])
    .map((l) => (l.kind ? l : { id: l.id, kind: "case", qty: l.cases }))  // migrate v1 carts
    .filter((l) => l && l.id && l.qty > 0);
  const isBiz = () => mode === "business";
  const showIncl = () => !isBiz() || incVat;

  const shown = (ex) => (showIncl() ? ex * (1 + VAT_RATE) : ex);
  const money = (n) => "R" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, " ");
  const money0 = (n) => "R" + Math.round(n).toLocaleString("en-US").replace(/,/g, " ");
  const vatLbl = () => (showIncl() ? "incl. VAT" : "excl. VAT");
  const plural = (n, w, ws) => `${n} ${n === 1 ? w : ws || w + "s"}`;

  const art = (p, cls = "") => `<div class="art t-${tone(p)} ${cls}">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" decoding="async">` : ICONS[p.icon] || ""}</div>`;

  const svg = {
    arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    truck: '<svg viewBox="0 0 24 24"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
    tag: '<svg viewBox="0 0 24 24"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    cart: '<svg viewBox="0 0 24 24"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/></svg>',
    filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-9-9a4.8 4.8 0 0 1 9-3 4.8 4.8 0 0 1 9 3c-2 4.6-9 9-9 9z"/></svg>',
  };

  /* ---------- smooth scroll (Lenis, optional) ---------- */
  let lenis = null;
  if (window.Lenis && !reduced) {
    lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 1 });
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  const scrollToTop = () => (lenis ? lenis.scrollTo(0, { immediate: true }) : window.scrollTo(0, 0));
  const scrollToEl = (el) => (lenis ? lenis.scrollTo(el, { offset: -96, duration: 1.4 }) : el.scrollIntoView({ behavior: "smooth" }));
  const lockScroll = (on) => { document.body.style.overflow = on ? "hidden" : ""; if (lenis) on ? lenis.stop() : lenis.start(); };

  /* ---------- mode ---------- */
  function syncModeUI() {
    document.body.classList.toggle("mode-biz", isBiz());
    document.body.classList.toggle("mode-home", !isBiz());
    $$("[data-aud]").forEach((a) => {
      a.classList.toggle("biz", isBiz());
      $$("[data-mode-set]", a).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.modeSet === (isBiz() ? "business" : "home"))));
    });
  }
  function setMode(m, announce = true) {
    if (m === mode) return;
    mode = m; store.set("mpm_mode", m); syncModeUI(); rerender();
    if (announce) toast(null, m === "business" ? "Business pricing on: buying by the case, ex VAT" : "Home shopping on: single items at everyday prices");
  }

  /* ---------- cart ---------- */
  const keyOf = (l) => `${l.id}:${l.kind}`;
  const saveCart = () => { store.set("mpm_cart", cart); renderCart(); };
  const itemCount = () => cart.reduce((a, l) => a + l.qty, 0);
  const lineEx = (l) => PR.lineEx(byId(l.id), l);
  const lineLabel = (l) => (l.kind === "case" ? plural(l.qty, "case") : plural(l.qty, "item"));

  const totals = (lines = cart) => PR.totals(lines, byId);

  function addToCart(id, kind, qty) {
    const p = byId(id); if (!p) return;
    if (p.stock === "out") { toast(p, `${p.name} is sold out right now`); return; }
    kind = kind || (isBiz() ? "case" : "each");
    qty = kind === "case" ? Math.max(p.moq, qty || p.moq) : Math.max(1, qty || 1);
    const line = cart.find((l) => l.id === id && l.kind === kind);
    if (line) line.qty += qty; else cart.push({ id, kind, qty });
    saveCart();
    const c = $("#cartCount"); c.classList.remove("bump"); void c.offsetWidth; c.classList.add("bump");
    toast(p, `Added ${kind === "case" ? plural(qty, "case") : plural(qty, "item")} · ${p.name}`);
  }
  function setQty(key, qty) {
    const line = cart.find((l) => keyOf(l) === key); if (!line) return;
    const p = byId(line.id), min = line.kind === "case" ? p.moq : 1;
    if (qty < min) cart = cart.filter((l) => l !== line); else line.qty = Math.min(999, qty);
    saveCart();
  }

  /* ---------- toast ---------- */
  let toastTimer;
  function toast(p, msg) {
    const t = $("#toast");
    t.innerHTML = `${p ? art(p) : ""}<span>${esc(msg)}</span>${p ? '<button type="button" data-open-cart>View cart</button>' : ""}`;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), 3200);
  }

  /* ---------- drawer ---------- */
  function openCart() {
    const d = $("#drawer"), s = $("#scrim");
    $("#toast").classList.remove("on");
    s.hidden = false; requestAnimationFrame(() => { s.classList.add("on"); d.classList.add("on"); });
    d.setAttribute("aria-hidden", "false"); lockScroll(true);
    setTimeout(() => $("#drawerClose").focus(), 300);
  }
  function closeCart() {
    const d = $("#drawer"), s = $("#scrim");
    if (!d.classList.contains("on")) return;
    s.classList.remove("on"); d.classList.remove("on"); d.setAttribute("aria-hidden", "true"); lockScroll(false);
    setTimeout(() => { s.hidden = true; }, 300);
  }

  function totalsHTML(t) {
    if (!isBiz()) {
      return `<div class="totals">
        ${t.saving > 0.005 ? `<div class="saving"><span>Bulk savings</span><b>−${money(t.saving * 1.15)}</b></div>` : ""}
        <div><span>Subtotal</span><b>${money(t.sub * 1.15)}</b></div>
        <div><span>Delivery</span><b>${t.delivery ? money(t.delivery * 1.15) : "Free"}</b></div>
        <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
        <div class="vat-note"><span>Includes VAT of ${money(t.vat)}</span></div>
      </div>`;
    }
    return `<div class="totals">
      ${t.saving > 0.005 ? `<div class="saving"><span>Volume savings</span><b>−${money(t.saving)}</b></div>` : ""}
      <div><span>Subtotal (excl. VAT)</span><b>${money(t.sub)}</b></div>
      <div><span>Delivery</span><b>${t.delivery ? money(t.delivery) : "Free"}</b></div>
      <div><span>VAT (15%)</span><b>${money(t.vat)}</b></div>
      <div class="grand"><span>Total</span><span>${money(t.total)}</span></div>
    </div>`;
  }

  function renderCart() {
    $("#cartCount").textContent = itemCount();
    $("#drawerSub").textContent = cart.length ? cart.map(lineLabel).join(" · ") + ` · prices ${vatLbl()}` : "Nothing here yet";
    const body = $("#drawerBody"), foot = $("#drawerFoot");
    if (!cart.length) {
      body.innerHTML = `<div class="drawer-empty">${art(PRODUCTS[17])}<h3>Your cart is empty</h3><p>${isBiz() ? "Add products by the case. Volume discounts are applied automatically as your order grows." : "Browse kitchen, cleaning, bathroom and décor essentials, all straight from our suppliers."}</p><a href="#/shop" class="btn btn-primary" data-close-cart>Start shopping ${svg.arrow}</a></div>`;
      foot.innerHTML = ""; foot.hidden = true; return;
    }
    foot.hidden = false;
    const t = totals();
    const leftEx = Math.max(0, t.freeAtEx - t.sub);
    const leftShown = t.hasCase ? shown(leftEx) : leftEx * 1.15;
    body.innerHTML = `
      <div class="ship-meter">${leftEx > 0.005 ? `Add <b>${money(leftShown)}</b> to unlock <b>free delivery</b>` : "<b>You've unlocked free delivery</b> 🎉"}
        <div class="meter"><i style="width:${Math.min(100, (t.sub / t.freeAtEx) * 100)}%"></i></div></div>
      ${cart.map((l) => {
        const p = byId(l.id), k = keyOf(l);
        let meta, hint = "";
        if (l.kind === "case") {
          const tier = tierFor(l.qty), nt = nextTier(l.qty);
          meta = `Case of ${p.pack} · ${money(shown(unitPrice(p, l.qty)))}/unit${tier.off ? ` · <span class="tier-pill">${tier.name} −${tier.off * 100}%</span>` : ""}`;
          if (nt) hint = `Add ${plural(nt.min - l.qty, "more case")} to unlock ${nt.name} pricing (−${nt.off * 100}%)`;
        } else {
          meta = `${money(shown(retailEx(p)))} each`;
          if (l.qty >= Math.ceil(p.pack / 2)) hint = `Buying ${l.qty}? A case of ${p.pack} is ${money(p.price * 1.15)}/unit: save ${caseSaving(p)}%`;
        }
        return `<div class="line-item">${art(p)}<div>
          <div class="li-top"><strong>${esc(p.name)}</strong><button class="li-remove" type="button" data-remove="${k}">Remove</button></div>
          <div class="li-meta"><span class="kind ${l.kind}">${l.kind === "case" ? "Wholesale" : "Single"}</span> ${meta}</div>
          <div class="li-bottom">
            <div class="stepper sm"><button type="button" data-step="${k}" data-d="-1" aria-label="Decrease">−</button><input type="number" inputmode="numeric" min="0" value="${l.qty}" data-qty="${k}" aria-label="Quantity"><button type="button" data-step="${k}" data-d="1" aria-label="Increase">+</button></div>
            <b>${money(shown(lineEx(l)))}</b>
          </div></div>
          ${hint ? `<div class="li-hint">${hint}</div>` : ""}
        </div>`;
      }).join("")}`;
    foot.innerHTML = `${totalsHTML(t)}
      <div class="btns ${isBiz() ? "" : "one"}">
        ${isBiz() ? '<a href="#/checkout?mode=quote" class="btn btn-ghost" data-close-cart>Request quote</a>' : ""}
        <a href="#/checkout" class="btn btn-primary" data-close-cart>Checkout ${svg.arrow}</a>
      </div>`;
  }

  /* ---------- shared fragments ---------- */
  function card(p, i = 0) {
    const c = catOf(p);
    const badgeCls = p.badge === "Hot" ? "hot" : p.badge === "New" ? "new" : "";
    const priceBlock = isBiz()
      ? `<div class="price"><strong>${money(shown(p.price))}</strong><small>/unit ${vatLbl()}</small><span class="from">From ${money(shown(bestUnit(p)))} at 50+ cases</span></div>`
      : `<div class="price"><strong>${money(p.rrp)}</strong><small>each</small><span class="from">Save ${caseSaving(p)}% by the case</span></div>`;
    return `<article class="card reveal" style="--d:${(i % 4) * 0.06}s">
      <a href="#/product/${p.id}" class="card-media" aria-label="${esc(p.name)}">${art(p)}
        ${p.badge ? `<span class="badge ${badgeCls}">${esc(p.badge)}</span>` : ""}
        <span class="card-margin">${isBiz() ? `Up to <b>${margin(p)}%</b> margin` : `<b>★ 4.${7 + (p.id.length % 3)}</b> · ${p.stock === "low" ? "Selling fast" : "Free delivery R750+"}`}</span></a>
      <div class="card-body">
        <div class="card-meta"><span>${esc(c.name)}</span><span class="stock ${p.stock}">${p.stock === "out" ? "Sold out" : p.stock === "low" ? "Low stock" : "In stock"}</span></div>
        <h3><a href="#/product/${p.id}">${esc(p.name)}</a></h3>
        <p class="pack">${isBiz() ? `Case of ${p.pack} · MOQ ${plural(p.moq, "case")}` : (p.pack > 1 ? `Also available by the case of ${p.pack}` : `Bulk bale · ${p.moq}+ for business pricing`)}</p>
        <div class="card-price">${priceBlock}
          ${p.stock === "out" ? '<span class="sold-out">Sold out</span>' : `<button class="add-btn" type="button" data-add="${p.id}" aria-label="Add ${esc(p.name)} to cart">${svg.plus}</button>`}
        </div>
      </div></article>`;
  }

  const mqCard = (p) => `<a class="mq-card" href="#/product/${p.id}">${art(p)}<div class="mq-info"><h4>${esc(p.name)}</h4>
      <div class="mq-price">${isBiz() ? `Case of ${p.pack} · RRP ${money0(p.rrp)}` : `${esc(catOf(p).name)}`}</div>
      <div class="mq-stats">${isBiz()
        ? `<div><strong>${money(shown(bestUnit(p)))}</strong><small>best unit price</small></div><span class="up">▲ ${margin(p)}%</span>`
        : `<div><strong>${money(p.rrp)}</strong><small>each, incl. VAT</small></div><span class="up">−${caseSaving(p)}% bulk</span>`}</div></div></a>`;

  const audSwitch = (cls = "") => `<div class="aud ${cls} ${isBiz() ? "biz" : ""}" data-aud role="radiogroup" aria-label="Shopping for"><span class="aud-pill"></span><button type="button" role="radio" aria-checked="${!isBiz()}" data-mode-set="home">${svg.home} For my home</button><button type="button" role="radio" aria-checked="${isBiz()}" data-mode-set="business">${svg.box} For my business</button></div>`;

  const words = (text) => text.split(" ").map((w) => `<span class="w">${w}</span>`).join(" ");

  /* ---------- views ---------- */
  const views = {};

  views.home = () => {
    const half = Math.ceil(PRODUCTS.length / 2);
    const rowA = PRODUCTS.slice(0, half), rowB = PRODUCTS.slice(half);
    const counts = (id) => PRODUCTS.filter((p) => p.cat === id).length;
    const biz = isBiz();
    return `
    <section class="hero" id="hero">
      <div class="orb orb-1" data-par="0.25"></div><div class="orb orb-2" data-par="-0.15"></div><div class="orb orb-3" data-par="0.4"></div>
      <div class="hero-badge" aria-hidden="true" data-par="-0.3">
        <svg viewBox="0 0 200 200"><defs><path id="circ" d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"/></defs>
          <text><textPath href="#circ">HOME ✦ WHOLESALE ✦ DIRECT FROM SUPPLIERS ✦ </textPath></text></svg>
        <span class="logo-mark"><svg viewBox="0 0 64 64"><path d="M14 48V27L32 13l18 14v21M22 48V33l10 8 10-8v15"/></svg></span>
      </div>
      <div class="container hero-inner" id="heroInner">
        <div class="reveal">${audSwitch("lg")}</div>
        <h1 class="reveal" style="--d:.08s">${biz
          ? 'Stock the <span class="serif">home.</span><br><span class="grad-text">Scale your store.</span>'
          : 'Everything for the <span class="serif">home.</span><br><span class="grad-text">Priced for everyone.</span>'}</h1>
        <p class="hero-sub reveal" style="--d:.14s">${biz
          ? "Wholesale household products, direct from our suppliers to your shelves. Buy by the case, unlock volume pricing automatically, and get dispatch within 48 hours anywhere in South Africa."
          : "Quality household essentials straight from the suppliers that stock South Africa's shops. Buy just what you need at everyday prices, or buy by the case and save even more."}</p>
        <div class="hero-ctas reveal" style="--d:.2s">
          <a href="#/shop" class="btn btn-primary">${biz ? "Browse the catalogue" : "Start shopping"} ${svg.arrow}</a>
          ${biz ? '<a href="#/bulk" class="btn btn-ghost">Bulk order sheet</a>' : '<a href="#/#categories" class="btn btn-ghost">Shop by room</a>'}
        </div>
        <div class="hero-proof reveal" style="--d:.26s">${biz
          ? `<span>${svg.check}No membership fees</span><span>${svg.check}Mix &amp; match by the case</span><span>${svg.check}30-day accounts</span>`
          : `<span>${svg.check}Free delivery over R750</span><span>${svg.check}Secure checkout</span><span>${svg.check}Easy 14-day returns</span>`}</div>
      </div>
      <div class="marquee reveal" style="--d:.32s" aria-label="Featured products">
        <div class="mq-shift" data-shift="-0.35"><div class="marquee-row">${rowA.map(mqCard).join("")}${rowA.map(mqCard).join("")}</div></div>
        <div class="mq-shift" data-shift="0.35"><div class="marquee-row rev">${rowB.map(mqCard).join("")}${rowB.map(mqCard).join("")}</div></div>
      </div>
      <div class="scroll-cue" aria-hidden="true"><span></span>Scroll</div>
    </section>

    <div class="segments"><div class="container"><p>${biz ? "Built for" : "Made for"}</p><ul>${(biz
      ? ["Retailers", "Spaza shops", "Online resellers", "Guesthouses", "Cleaning companies", "Offices"]
      : ["Kitchens", "Bathrooms", "Laundry days", "Living rooms", "Gifting", "Spring cleans"]).map((s) => `<li>${s}</li>`).join("")}</ul></div></div>

    <section class="statement" data-words>
      <div class="container">
        <span class="eyebrow">Our promise</span>
        <p class="statement-text">${words("From kitchen drawers to shop shelves, we bring quality household products straight from trusted suppliers to your door, at prices that make sense whether you're buying one item or one thousand.")}</p>
      </div>
    </section>

    <section class="hs" id="categories">
      <div class="hs-sticky">
        <div class="hs-track" data-lenis-prevent-touch>
          <div class="hs-intro">
            <span class="eyebrow">Categories</span>
            <h2 class="h2">${biz ? 'Build your <span class="serif">range</span>' : 'Shop every <span class="serif">room</span>'}</h2>
            <p class="lead">${biz ? "Eight core household categories, every line from a supplier we've vetted for quality and dependable restocks." : "Eight categories of everyday essentials, chosen for quality and priced fairly."}</p>
            <div class="hs-hint">${svg.arrow} Keep scrolling</div>
          </div>
          ${CATEGORIES.map((c, i) => { const ph = PRODUCTS.find((p) => p.cat === c.id && p.image); return `
          <a href="#/shop/${c.id}" class="hs-card t-${c.tone} ${ph ? "has-photo" : ""}">
            <span class="hs-num">0${i + 1}</span>
            <div class="art t-${c.tone}">${ph ? `<img src="${esc(ph.image)}" alt="" loading="lazy" decoding="async">` : ICONS[c.icon]}</div>
            <div class="hs-body"><h3>${esc(c.name)}</h3><p>${esc(c.blurb)}</p><span class="cat-count">${plural(counts(c.id), "product")} ${svg.arrow}</span></div>
          </a>`; }).join("")}
        </div>
        <div class="hs-progress"><i id="hsBar"></i></div>
      </div>
    </section>

    <section class="section" style="padding-top:72px">
      <div class="container">
        <div class="section-head reveal"><div><span class="eyebrow">Best sellers</span><h2>${biz ? 'What retailers are <span class="serif">re-ordering</span>' : 'Loved in homes <span class="serif">everywhere</span>'}</h2></div>
          <div class="tabs" id="homeTabs"><button class="tab on" data-tab="all">All</button>${CATEGORIES.slice(0, 5).map((c) => `<button class="tab" data-tab="${c.id}">${esc(c.name.split(" ")[0])}</button>`).join("")}</div></div>
        <div class="grid" id="homeGrid"></div>
        <div style="text-align:center;margin-top:40px"><a href="#/shop" class="btn btn-ghost">View all ${PRODUCTS.length} products ${svg.arrow}</a></div>
      </div>
    </section>

    <section class="section" id="pricing" style="padding-top:24px">
      <div class="container pricing-wrap">
        <div class="pricing-copy reveal">
          <span class="eyebrow">${biz ? "Volume pricing" : "Buying in bulk?"}</span>
          <h2 class="h2">${biz ? 'The more you stock, <span class="serif">the less you pay.</span>' : `Buy by the case, <span class="serif">save up to ${Math.max(...PRODUCTS.map(caseSaving))}%.</span>`}</h2>
          <p class="lead">${biz ? "Discounts apply per product line, so there are no codes to enter and no negotiation. Add cases and the price drops at every tier." : "Stocking up for a big family, a church event or a small business? Switch to business pricing to buy by the case at wholesale prices. There's no sign-up needed."}</p>
          <div class="tier-list" id="tierList">
            ${TIERS.map((t) => `<div class="tier-row" data-tier="${t.min}"><span class="tier-dot">${t.name[0]}</span><div><strong>${t.name}</strong><small>${t.label}</small></div><span class="tier-off">${t.off ? `−${t.off * 100}%` : "List"}</span></div>`).join("")}
          </div>
          ${biz ? "" : `<button type="button" class="btn btn-primary" data-mode-set="business" style="margin-top:22px">Switch to business pricing ${svg.arrow}</button>`}
        </div>
        <div class="calc reveal" style="--d:.1s" id="calc"></div>
      </div>
    </section>

    <section class="section band">
      <div class="container">
        <div class="reveal" style="max-width:740px"><span class="eyebrow" style="color:var(--pink-400)">Why MPM Digital</span><h2 class="h2" style="margin-top:12px">Supplier prices, <span class="serif">without the warehouse.</span></h2><p class="lead" style="margin-top:16px">We manage the supplier relationships, quality checks and logistics. You get better prices and dependable stock.</p></div>
        <div class="stats">
          <div class="stat reveal"><strong data-count="500">0</strong><span>Household products across 8 categories</span></div>
          <div class="stat reveal" style="--d:.06s"><strong data-count="48" data-suffix="h">0</strong><span>Dispatch from order confirmation</span></div>
          <div class="stat reveal" style="--d:.12s"><strong data-count="22" data-suffix="%">0</strong><span>Maximum volume discount for businesses</span></div>
          <div class="stat reveal" style="--d:.18s"><strong data-count="9">0</strong><span>Provinces delivered to, door to door</span></div>
        </div>
        <div class="features">
          <div class="feature reveal"><span class="ico">${svg.shield}</span><div><h4>Vetted suppliers</h4><p>Every supplier is checked for quality, consistency and the ability to restock.</p></div></div>
          <div class="feature reveal" style="--d:.06s"><span class="ico">${svg.tag}</span><div><h4>Honest pricing</h4><p>Everyday prices for home shoppers, plus transparent case pricing and margins for business buyers.</p></div></div>
          <div class="feature reveal" style="--d:.12s"><span class="ico">${svg.wallet}</span><div><h4>Pay your way</h4><p>${esc(payWords())}. Approved businesses can also apply for 30-day terms.</p></div></div>
        </div>
      </div>
    </section>

    <section class="section" id="how">
      <div class="container how">
        <div class="how-head">
          <span class="eyebrow">How it works</span>
          <h2 class="h2">From our suppliers <span class="serif">to your door</span></h2>
          <p class="lead">${biz ? "Three steps from catalogue to shelf." : "Shopping with us is simple, whichever way you buy."}</p>
          <a href="#/shop" class="btn btn-primary" style="margin-top:24px">${biz ? "Start an order" : "Start shopping"} ${svg.arrow}</a>
        </div>
        <div class="stack">${(biz ? [
          [svg.user, "Open a trade account", "Register your business in two minutes. You can browse prices and order straight away; applying for terms is optional."],
          [svg.box, "Build your order", "Mix and match products by the case, or use the bulk order sheet to fill a full restock in one go. Tier discounts apply automatically."],
          [svg.truck, "We deliver in 48h", "Orders are picked, packed and dispatched within 48 hours, with tracking all the way to your door."],
        ] : [
          [svg.heart, "Pick what you love", "Browse kitchen, cleaning, bathroom, storage and décor essentials, all from suppliers we trust."],
          [svg.cart, "Buy one, or buy the case", "Add single items at everyday prices. Stocking up? Each product also comes by the case at a lower unit price."],
          [svg.truck, "Delivered to your door", "We dispatch within 48 hours, and delivery is free on orders over R750 anywhere in South Africa."],
        ]).map(([ic, h, p], i) => `<div class="step" style="--i:${i}"><span class="step-n">0${i + 1}</span><span class="ico">${ic}</span><h3>${h}</h3><p>${p}</p></div>`).join("")}</div>
      </div>
    </section>

    <section class="section" style="padding-top:24px">
      <div class="container">
        <div class="section-head reveal"><div><span class="eyebrow">Reviews</span><h2>Loved at home <span class="serif">and</span> on the shelf</h2></div></div>
        <div class="quotes">
          <figure class="quote reveal"><div class="stars">★★★★★</div><blockquote>“Lovely quality towels and candles for less than the mall. Delivery was quick, too.”</blockquote><footer><span class="avatar">LS</span><div><strong>Lerato S.</strong><small>Home shopper</small></div></footer></figure>
          <figure class="quote reveal" style="--d:.08s"><div class="stars">★★★★★</div><blockquote>“The volume tiers make restocking simple. I always know my margin before I order.”</blockquote><footer><span class="avatar">NM</span><div><strong>Nomsa M.</strong><small>Homeware store owner</small></div></footer></figure>
          <figure class="quote reveal" style="--d:.16s"><div class="stars">★★★★★</div><blockquote>“The bulk order sheet saves me an hour every week, and every delivery has been on time.”</blockquote><footer><span class="avatar">TK</span><div><strong>Thabo K.</strong><small>Cleaning services</small></div></footer></figure>
        </div>
      </div>
    </section>

    <section class="section" id="faq" style="padding-top:72px">
      <div class="container faq-wrap">
        <div class="reveal"><span class="eyebrow">FAQ</span><h2 class="h2">Questions, <span class="serif">answered.</span></h2><p class="lead" style="margin-top:16px">Can't find what you need? Our team replies within one business day.</p><a href="#/checkout?mode=quote" class="btn btn-primary" style="margin-top:24px">Get in touch ${svg.arrow}</a></div>
        <div class="faq reveal" style="--d:.08s">
          <details open><summary>Can I buy just one item?</summary><p>Yes. Choose "For my home" and you can buy single items at everyday prices, delivered to your door. Delivery is free on orders over R750.</p></details>
          <details><summary>What's the difference between home and business pricing?</summary><p>Home prices are per item and include VAT. Business pricing sells by the case at wholesale rates, shows prices excluding VAT, and gives automatic volume discounts of up to 22%. Anyone can switch at any time.</p></details>
          <details><summary>How does volume pricing work?</summary><p>Each product has four tiers based on the number of cases of that line: Starter (1–9), Trade (10–24, −8%), Volume (25–49, −15%) and Distributor (50+, −22%). Discounts are applied automatically in your cart.</p></details>
          <details><summary>How long does delivery take?</summary><p>We dispatch within 48 hours. Main centres usually receive orders in 2–4 business days, and regional areas in 3–6.</p></details>
          <details><summary>Can I return something?</summary><p>Unused items can be returned within 14 days. Damaged or faulty goods are replaced free of charge if reported within 7 days of delivery.</p></details>
        </div>
      </div>
    </section>

    <section class="container" style="padding-bottom:96px">
      <div class="cta reveal">
        <div>${biz
          ? '<h2>Ready to stock <span class="serif">smarter?</span></h2><p>Open a free trade account to unlock tax invoices and saved orders, and to apply for 30-day terms.</p>'
          : '<h2>Your home, <span class="serif">sorted.</span></h2><p>New products arrive from our suppliers every month. Subscribe for drops and deals, or start shopping now.</p>'}</div>
        <div class="cta-actions">${biz
          ? `<a href="#/business" class="btn btn-light">Open trade account ${svg.arrow}</a><a href="#/bulk" class="btn btn-outline-light">Bulk order sheet</a>`
          : `<a href="#/shop" class="btn btn-light">Start shopping ${svg.arrow}</a><button type="button" class="btn btn-outline-light" data-mode-set="business">Shop for business</button>`}</div>
      </div>
    </section>`;
  };

  views.shop = ({ cat, params }) => {
    const c = CATEGORIES.find((x) => x.id === cat);
    return `
    <section class="page-head"><div class="orb orb-2"></div><div class="container">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span><a href="#/shop">Shop</a></span>${c ? `<span>${esc(c.name)}</span>` : ""}</nav>
      <h1>${c ? esc(c.name) : isBiz() ? 'The <span class="serif">catalogue</span>' : 'Shop <span class="serif">everything</span>'}</h1>
      <p>${c ? esc(c.blurb) : isBiz() ? "Every line priced per unit and sold by the case. Volume discounts are applied automatically at checkout." : "Everyday household essentials at fair prices. Need more? Every product also comes by the case."}</p>
      <div class="mode-banner">${isBiz() ? `${svg.box}<span>You're seeing <b>business pricing</b> (by the case, ${vatLbl()}).</span><button type="button" data-mode-set="home">Shop for home instead</button>` : `${svg.home}<span>You're seeing <b>home prices</b> (single items, incl. VAT).</span><button type="button" data-mode-set="business">Switch to business pricing</button>`}</div>
    </div></section>
    <div class="container shop">
      <aside class="filters" id="filters">
        <div><h4>Category</h4><div class="cat-filter">
          <button type="button" data-cat="" class="${!c ? "on" : ""}">All products <span>${PRODUCTS.length}</span></button>
          ${CATEGORIES.map((x) => `<button type="button" data-cat="${x.id}" class="${c && c.id === x.id ? "on" : ""}">${esc(x.name)} <span>${PRODUCTS.filter((p) => p.cat === x.id).length}</span></button>`).join("")}
        </div></div>
        <div><h4>Availability</h4><label class="check"><input type="checkbox" id="fStock"> In stock only</label><label class="check"><input type="checkbox" id="fNew"> New arrivals</label></div>
        <div><h4>Max price</h4><input type="range" class="range" id="fPrice" min="5" max="1000" value="1000" style="--p:100%"><div class="calc-ticks" style="color:var(--muted)"><span>R5</span><span id="fPriceVal">R1000</span></div></div>
      </aside>
      <div>
        <div class="shop-bar">
          <button class="btn btn-ghost btn-sm filter-toggle" type="button" id="filterToggle">${svg.filter} Filters</button>
          <div class="search">${svg.search}<input class="input" id="q" type="search" placeholder="Search products…" value="${esc(params.get("q") || "")}" aria-label="Search products"></div>
          <select class="select" id="sort" aria-label="Sort"><option value="pop">Most popular</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option>${isBiz() ? '<option value="margin">Highest margin</option>' : ""}<option value="az">Name A–Z</option></select>
        </div>
        <p class="result-count" id="resultCount" style="margin-bottom:16px"></p>
        <div class="grid" id="shopGrid"></div>
      </div>
    </div>`;
  };

  views.product = ({ id }) => {
    const p = byId(id);
    if (!p) return views.notFound();
    const c = catOf(p);
    const related = PRODUCTS.filter((x) => x.cat === p.cat && x.id !== p.id).concat(PRODUCTS.filter((x) => x.cat !== p.cat)).slice(0, 4);
    const tierTable = `<table class="tier-table" id="tierTable"><thead><tr><th>Tier</th><th>Cases</th><th>Discount</th><th style="text-align:right">Unit price</th></tr></thead><tbody>
      ${TIERS.map((t) => `<tr data-min="${t.min}"><td>${t.name}</td><td>${t.label.replace(" cases", "")}</td><td>${t.off ? `−${t.off * 100}%` : "n/a"}</td><td style="text-align:right">${money(isBiz() ? shown(p.price * (1 - t.off)) : p.price * (1 - t.off) * 1.15)}</td></tr>`).join("")}
      </tbody></table>`;
    const buyBox = isBiz() ? `
        <div class="pdp-box">
          <div class="pdp-price"><strong id="pdpUnit"></strong><span style="color:var(--muted)">/unit ${vatLbl()}</span><s id="pdpWas"></s><span class="save" id="pdpSave" hidden></span></div>
          <p class="pdp-rrp">RRP ${money(p.rrp)} incl. VAT · your margin up to <b>${margin(p)}%</b></p>
          ${tierTable}
          <div class="buy-row">
            <div class="stepper"><button type="button" id="pdpMinus" aria-label="One case fewer">−</button><input id="pdpQty" type="number" inputmode="numeric" min="${p.moq}" value="${p.moq}" aria-label="Number of cases"><button type="button" id="pdpPlus" aria-label="One case more">+</button></div>
            <button class="btn btn-primary" type="button" id="pdpAdd" ${p.stock === "out" ? "disabled" : ""}>${svg.cart} ${p.stock === "out" ? "Sold out" : "Add cases to cart"}</button>
          </div>
          <div class="buy-sum"><span id="pdpUnits"></span><span>Line total <b id="pdpLine"></b></span></div>
          <div class="nudge" id="pdpNudge" hidden>${svg.spark}<span></span></div>
        </div>` : `
        <div class="pdp-box">
          <div class="pdp-price"><strong>${money(p.rrp)}</strong><span style="color:var(--muted)">each, incl. VAT</span></div>
          <p class="pdp-rrp">${p.stock === "low" ? "Only a few left. " : ""}Free delivery on orders over R750 · <b>Dispatched in 48h</b></p>
          <div class="buy-row" style="margin-top:18px">
            <div class="stepper"><button type="button" id="pdpMinus" aria-label="One fewer">−</button><input id="pdpQty" type="number" inputmode="numeric" min="1" value="1" aria-label="Quantity"><button type="button" id="pdpPlus" aria-label="One more">+</button></div>
            <button class="btn btn-primary" type="button" id="pdpAdd" ${p.stock === "out" ? "disabled" : ""}>${svg.cart} ${p.stock === "out" ? "Sold out" : "Add to cart"}</button>
          </div>
          <div class="buy-sum"><span id="pdpUnits"></span><span>Total <b id="pdpLine"></b></span></div>
          <div class="upsell">
            <div class="upsell-top">${svg.box}<div><strong>Buy a case of ${p.pack} and save ${caseSaving(p)}%</strong><small>${money(p.price * 1.15)} per unit · ${money(p.price * 1.15 * p.pack * p.moq)} for ${plural(p.moq, "case")} (${p.pack * p.moq} units)</small></div>
              <button type="button" class="btn btn-pink btn-sm" data-add-case="${p.id}">Add case</button></div>
            <details><summary>See bulk pricing tiers</summary>${tierTable}</details>
          </div>
        </div>`;
    return `
    <section class="page-head" style="padding-bottom:20px"><div class="container">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span><a href="#/shop">Shop</a></span><span><a href="#/shop/${c.id}">${esc(c.name)}</a></span><span>${esc(p.name)}</span></nav>
    </div></section>
    <div class="container pdp">
      <div class="pdp-media">
        <div id="pdpMain">${art(p)}</div>
        <div class="pdp-thumbs">${["", "t-lilac", "t-blush", "t-plum"].map((t, i) => `<div class="art ${i === 0 ? "t-" + tone(p) + " on" : t}" data-thumb="${i === 0 ? tone(p) : t.slice(2)}">${p.image && i === 0 ? `<img src="${esc(p.image)}" alt="">` : ICONS[p.icon]}</div>`).join("")}</div>
      </div>
      <div class="pdp-info">
        <div class="tags"><span class="tag">${esc(c.name)}</span>${p.badge ? `<span class="tag pink">${esc(p.badge)}</span>` : ""}<span class="tag stock-tag ${p.stock}">${p.stock === "out" ? "Sold out" : p.stock === "low" ? "Low stock" : "In stock"}</span></div>
        <h1>${esc(p.name)}</h1>
        <div class="pdp-sku"><span>SKU ${esc(p.sku)}</span><span>${esc(p.supplier)}</span>${isBiz() ? `<span>Case of ${p.pack}</span>` : `<span>★ 4.${7 + (p.id.length % 3)} rating</span>`}</div>
        <p class="pdp-desc">${esc(p.desc)}</p>
        ${buyBox}
        <div class="assure"><div>${svg.truck}48h dispatch</div><div>${svg.shield}${isBiz() ? "7-day damage cover" : "14-day returns"}</div><div>${svg.tag}${isBiz() ? "Tax invoice included" : "Secure checkout"}</div></div>
        <div class="specs">${Object.entries(p.specs).map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join("")}<div><small>Units per case</small><b>${p.pack}</b></div><div><small>${isBiz() ? "Minimum order" : "Sold"}</small><b>${isBiz() ? plural(p.moq, "case") : "Individually or by the case"}</b></div></div>
      </div>
    </div>
    <section class="container" style="padding-bottom:96px">
      <div class="section-head"><div><span class="eyebrow">Pairs well with</span><h2>You might <span class="serif">also like</span></h2></div></div>
      <div class="grid">${related.map(card).join("")}</div>
    </section>`;
  };

  views.bulk = () => `
    <section class="page-head"><div class="orb orb-1"></div><div class="container">
      <nav class="crumbs"><a href="#/">Home</a><span>Bulk order</span></nav>
      <h1>Bulk order <span class="serif">sheet</span></h1>
      <p>Enter the number of cases for each line and add everything to your cart in one go. Tier pricing updates as you type.</p>
      ${isBiz() ? "" : `<div class="mode-banner">${svg.box}<span>The bulk sheet sells <b>by the case</b> at wholesale prices. Anyone can use it.</span><button type="button" data-mode-set="business">Show business pricing</button></div>`}
    </div></section>
    <div class="container" style="padding-bottom:96px">
      <div class="bulk-tools">
        <div class="search">${svg.search}<input class="input" id="bq" type="search" placeholder="Filter by name or SKU" aria-label="Filter products"></div>
        <select class="select" id="bcat" aria-label="Category"><option value="">All categories</option>${CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      </div>
      <div class="table-wrap" data-lenis-prevent-wheel><table class="bulk-table">
        <thead><tr><th>Product</th><th>Case</th><th>MOQ</th><th class="num">Unit (${showIncl() ? "inc" : "ex"} VAT)</th><th>Cases</th><th class="num">Line total</th></tr></thead>
        <tbody id="bulkBody">${PRODUCTS.map((p) => `
          <tr data-row="${p.id}" data-cat="${p.cat}" data-search="${esc((p.name + " " + p.sku).toLowerCase())}">
            <td><div class="prod">${art(p)}<div><strong><a href="#/product/${p.id}">${esc(p.name)}</a></strong><small>${esc(p.sku)}</small></div></div></td>
            <td>${p.pack} units</td><td>${p.moq}</td>
            <td class="num" data-unit="${p.id}">${money(shown(p.price))}</td>
            <td><div class="stepper sm"><button type="button" data-bstep="${p.id}" data-d="-1" aria-label="One case fewer">−</button><input type="number" min="0" value="0" inputmode="numeric" data-bulk="${p.id}" aria-label="Cases of ${esc(p.name)}"><button type="button" data-bstep="${p.id}" data-d="1" aria-label="One case more">+</button></div></td>
            <td class="num line" data-bline="${p.id}">—</td>
          </tr>`).join("")}
        </tbody></table></div>
      <div class="bulk-bar"><div><small id="bulkCount">No items selected</small><strong id="bulkTotal">R0.00</strong> <small style="display:inline">${vatLbl()}</small></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-outline-light btn-sm" type="button" id="bulkClear">Clear</button><button class="btn btn-pink" type="button" id="bulkAdd" disabled>Add all to cart ${svg.arrow}</button></div></div>
    </div>`;

  views.checkout = ({ params }) => {
    const biz = isBiz();
    const quote = biz && params.get("mode") === "quote";
    const contactOnly = !biz && params.get("mode") === "quote";
    return `
    <section class="page-head"><div class="orb orb-2"></div><div class="container">
      <nav class="crumbs"><a href="#/">Home</a><span>${quote ? "Request a quote" : contactOnly ? "Contact us" : "Checkout"}</span></nav>
      <h1>${quote ? 'Request a <span class="serif">quote</span>' : contactOnly ? 'Get in <span class="serif">touch</span>' : 'Secure <span class="serif">checkout</span>'}</h1>
      <p>${quote ? "Send us your list and our trade team will reply within one business day with pricing, stock and delivery dates." : contactOnly ? "Ask us anything about products, orders or delivery. We reply within one business day." : biz ? "Confirm your business details and delivery address. Prices are locked for this order." : "Almost there. Tell us where to deliver."}</p>
    </div></section>
    <div class="container two-col">
      <form id="checkoutForm" novalidate data-quote="${quote || contactOnly}">
        ${biz ? `<div class="mode-switch" role="tablist"><button type="button" class="${quote ? "" : "on"}" data-cmode="order">Place order</button><button type="button" class="${quote ? "on" : ""}" data-cmode="quote">Request quote</button></div>` : ""}
        <div class="form-card"><h3><span class="n">1</span>${biz ? "Business details" : "Your details"}</h3>${user ? `<p class="form-hint">Signed in as <b>${esc(user.email)}</b>.</p>` : ""}<div class="fields">
          ${biz ? `<div class="field"><label for="f1">Business name</label><input class="input" id="f1" name="business" required autocomplete="organization"></div>
          <div class="field"><label for="f2">VAT number (optional)</label><input class="input" id="f2" name="vat" inputmode="numeric"></div>` : ""}
          <div class="field"><label for="f3">${biz ? "Contact person" : "Full name"}</label><input class="input" id="f3" name="name" required autocomplete="name"></div>
          <div class="field"><label for="f4">Phone</label><input class="input" id="f4" name="phone" type="tel" required autocomplete="tel"></div>
          <div class="field full"><label for="f5">Email</label><input class="input" id="f5" name="email" type="email" required autocomplete="email"></div>
        </div></div>
        <div class="form-card" ${contactOnly ? "hidden" : ""}><h3><span class="n">2</span>Delivery</h3><div class="fields">
          <div class="field full"><label for="f6">Street address</label><input class="input" id="f6" name="street" ${contactOnly ? "" : "required"} autocomplete="street-address"></div>
          <div class="field"><label for="f7">City / town</label><input class="input" id="f7" name="city" ${contactOnly ? "" : "required"} autocomplete="address-level2"></div>
          <div class="field"><label for="f8">Province</label><select class="select" id="f8" name="province" style="width:100%" ${contactOnly ? "" : "required"}><option value="">Select…</option>${["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape"].map((x) => `<option>${x}</option>`).join("")}</select></div>
          <div class="field"><label for="f9">Postal code</label><input class="input" id="f9" name="postal" inputmode="numeric" ${contactOnly ? "" : "required"} autocomplete="postal-code"></div>
          <div class="field"><label for="f10">Delivery notes</label><input class="input" id="f10" name="notes" placeholder="${biz ? "Loading bay, hours…" : "Gate code, complex name…"}"></div>
        </div></div>
        <div class="form-card" id="payCard" ${quote || contactOnly ? "hidden" : ""}><h3><span class="n">3</span>Payment</h3><div class="radio-cards">
          ${SETTINGS.paymentMethods.map((m, i) => `<label class="radio-card"><input type="radio" name="pay" value="${esc(m.id)}" ${i === 0 ? "checked" : ""}><div><strong>${esc(m.label)}</strong><small>${esc(m.note)}</small></div></label>`).join("")}
        </div>${user ? "" : `<p class="form-hint">Have an account? <a href="#/account?next=checkout">Sign in</a> to track this order${biz ? " and pay on your trade account" : ""}.</p>`}</div>
        <div class="form-card" id="quoteCard" ${quote || contactOnly ? "" : "hidden"}><h3><span class="n">${contactOnly ? 2 : 3}</span>${contactOnly ? "Your message" : "Anything else?"}</h3>
          <div class="field"><label for="f11">${contactOnly ? "How can we help?" : "Tell us about your requirements"}</label><textarea class="textarea" id="f11" name="message" placeholder="${contactOnly ? "Product questions, an existing order…" : "Quantities, products not listed, delivery dates, private label…"}"></textarea></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:20px;height:56px" id="submitBtn">${quote ? "Send quote request" : contactOnly ? "Send message" : "Place order"} ${svg.arrow}</button>
        <p style="font-size:13px;color:var(--muted);text-align:center;margin-top:12px">By continuing you agree to our terms and returns policy.</p>
      </form>
      <aside class="summary" id="summary"></aside>
    </div>`;
  };

  views.business = () => `
    <section class="page-head"><div class="orb orb-1"></div><div class="container">
      <nav class="crumbs"><a href="#/">Home</a><span>For business</span></nav>
      <h1>Open a <span class="serif">trade account</span></h1>
      <p>Free to join. Approved accounts get tax invoices, saved order lists, a dedicated account manager and the option of 30-day terms.</p>
    </div></section>
    <div class="container two-col">
      <form id="accountForm" class="form-card" novalidate>
        <h3><span class="n">✦</span>Tell us about your business</h3>
        ${user && user.tradeStatus === "approved" ? `<p class="form-hint ok">Your trade account is approved. You can pay on 30-day terms at checkout.</p>` : user && user.tradeStatus === "pending" ? `<p class="form-hint">Your application is being reviewed. We'll email you within one business day.</p>` : ""}
        <div class="fields">
          <div class="field"><label for="a1">Business name</label><input class="input" id="a1" required autocomplete="organization"></div>
          <div class="field"><label for="a2">Business type</label><select class="select" id="a2" style="width:100%" required><option value="">Select…</option><option>Retail store</option><option>Spaza / convenience</option><option>Online reseller</option><option>Hospitality</option><option>Cleaning services</option><option>Office / corporate</option><option>Supplier: I want to sell through MPM</option></select></div>
          <div class="field"><label for="a3">Contact person</label><input class="input" id="a3" required autocomplete="name" value="${esc(user ? user.name : "")}"></div>
          <div class="field"><label for="a4">Phone</label><input class="input" id="a4" type="tel" required autocomplete="tel" value="${esc(user ? user.phone : "")}"></div>
          <div class="field full"><label for="a5">Email</label><input class="input" id="a5" type="email" required autocomplete="email" value="${esc(user ? user.email : "")}" ${user ? "readonly" : ""}></div>
          ${user ? "" : '<div class="field full"><label for="a9">Choose a password for your account</label><input class="input" id="a9" type="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></div>'}
          <div class="field"><label for="a6">CIPC registration (optional)</label><input class="input" id="a6"></div>
          <div class="field"><label for="a10">VAT number (optional)</label><input class="input" id="a10" value="${esc(user ? user.vatNumber : "")}"></div>
          <div class="field"><label for="a7">Est. monthly spend</label><select class="select" id="a7" style="width:100%"><option>Under R10 000</option><option>R10 000 – R50 000</option><option>R50 000 – R150 000</option><option>R150 000+</option></select></div>
          <div class="field full"><label class="check"><input type="checkbox" id="a8"> I'd like to apply for 30-day account terms</label></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit" id="tradeBtn" style="margin-top:20px;height:54px">${user ? "Submit application" : "Create trade account"} ${svg.arrow}</button>
        ${user ? "" : '<p class="form-hint">Already have an account? <a href="#/account?next=business">Sign in first</a>.</p>'}
      </form>
      <aside class="side-dark">
        <h3>Trade <span class="serif">perks</span></h3>
        <p>Everything you need to buy smarter, in one account.</p>
        <div class="perks">
          <div class="perk"><span class="ico">${svg.tag}</span><div><strong>Automatic volume tiers</strong><small>Up to 22% off list price on every line, with no codes needed.</small></div></div>
          <div class="perk"><span class="ico">${svg.wallet}</span><div><strong>30-day terms</strong><small>Apply for credit once you have a trading history with us.</small></div></div>
          <div class="perk"><span class="ico">${svg.clock}</span><div><strong>One-click re-orders</strong><small>Save order lists and restock in seconds.</small></div></div>
          <div class="perk"><span class="ico">${svg.user}</span><div><strong>Dedicated account manager</strong><small>A named contact for quotes, stock alerts and new supplier drops.</small></div></div>
        </div>
      </aside>
    </div>`;

  views.done = ({ id, params }) => {
    const t = params.get("t");
    const copy = {
      account: ["Welcome to MPM Digital", "Your trade account application is in. Our team will verify your details and email you within one business day."],
      quote: ["Quote request sent", "Thank you. Our trade team will email your quote within one business day."],
      contact: ["Message sent", "Thank you for getting in touch. We'll reply within one business day."],
      order: ["Order received", "Thank you! We've received your order. Keep your reference handy; we'll contact you to confirm delivery."],
    }[t] || ["Done", ""];
    return `<div class="container"><div class="done">
      <div class="tick">${svg.check}</div>
      <h1>${copy[0]}</h1><p>${copy[1]}</p>
      ${t === "account" ? "" : `<span class="ref">REF ${esc(id)}</span>`}
      ${(() => {
        let o = null; try { o = JSON.parse(sessionStorage.getItem("mpm_last_order") || "null"); } catch { /* ignore */ }
        if (!o || o.ref !== id) return "";
        const pay = o.payment || {};
        return `${o.type === "order" ? `<div class="receipt">${o.items.map((i) => `<div><span>${esc(i.name)} <small>× ${i.qty}${i.kind === "case" ? " cases" : ""}</small></span><b>${money(i.lineInc)}</b></div>`).join("")}
          <div><span>Delivery</span><b>${o.totals.delivery ? money(o.totals.delivery * 1.15) : "Free"}</b></div>
          <div class="r-total"><span>Total incl. VAT</span><b>${money(o.totals.total)}</b></div></div>` : ""}
          ${pay.type === "instructions" ? `<div class="pay-box"><h3>${esc(pay.title)}</h3>${pay.lines.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}<p>${esc(pay.footer)}</p></div>` : ""}
          ${pay.type === "none" && pay.message ? `<p class="form-hint">${esc(pay.message)}</p>` : ""}`;
      })()}
      ${t !== "account" && user ? `<p class="form-hint">You can follow this ${t === "order" ? "order" : "request"} under <a href="#/account">My account</a>.</p>` : ""}
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a href="#/shop" class="btn btn-primary">Continue shopping ${svg.arrow}</a><a href="#/" class="btn btn-ghost">Back home</a></div>
    </div></div>`;
  };

  views.notFound = () => `<div class="container"><div class="done"><h1>Page not found</h1><p>That page doesn't exist, or it may have moved.</p><a href="#/shop" class="btn btn-primary" style="margin-top:16px">Go to the shop</a></div></div>`;

  /* ---------- view behaviours ---------- */
  function mountHome() {
    const grid = $("#homeGrid");
    const fill = (cat) => {
      const list = (cat === "all" ? PRODUCTS.filter((p) => p.badge) : PRODUCTS.filter((p) => p.cat === cat)).slice(0, 8);
      grid.innerHTML = list.map(card).join(""); observe();
    };
    fill("all");
    $("#homeTabs").addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]"); if (!b) return;
      $$(".tab", e.currentTarget).forEach((t) => t.classList.toggle("on", t === b)); fill(b.dataset.tab);
    });

    // Tier calculator
    const calc = $("#calc");
    const sample = PRODUCTS.filter((p) => p.badge === "Best seller");
    let pid = sample[0].id, cases = isBiz() ? 12 : 1;
    const draw = () => {
      const p = byId(pid), t = tierFor(cases), u = unitPrice(p, cases);
      const third = isBiz()
        ? ["Est. gross profit", money0((retailEx(p) - u) * p.pack * cases)]
        : ["vs. buying singles", money0((retailEx(p) - u) * p.pack * cases * 1.15)];
      const saving = isBiz() ? shown((p.price - u) * p.pack * cases) : (retailEx(p) - u) * 1.15 * p.pack * cases;
      calc.innerHTML = `
        <div class="calc-head">${art(p)}<div><h3>${isBiz() ? "Savings calculator" : "Bulk savings calculator"}</h3><select id="calcSel" aria-label="Product">${sample.map((x) => `<option value="${x.id}" ${x.id === pid ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div></div>
        <div class="calc-label"><span>Cases</span><b>${plural(cases, "case")} · ${(cases * p.pack).toLocaleString()} units</b></div>
        <input type="range" class="range" id="calcRange" min="1" max="60" value="${cases}" style="--p:${((cases - 1) / 59) * 100}%" aria-label="Cases ordered">
        <div class="calc-ticks"><span>1</span><span>10</span><span>25</span><span>50</span><span>60</span></div>
        <div class="calc-out">
          <div><small>Unit price</small><strong>${money(isBiz() ? shown(u) : u * 1.15)}</strong></div>
          <div class="hl"><small>${isBiz() ? "Tier savings" : "Retail price"}</small><strong>${isBiz() ? money0(saving) : money(p.rrp)}</strong></div>
          <div><small>${third[0]}</small><strong>${third[1]}</strong></div>
        </div>
        <a href="#/product/${p.id}" class="btn btn-pink btn-block">${isBiz() ? `Order at ${t.name} pricing` : "View product"} ${svg.arrow}</a>`;
      $$("#tierList .tier-row").forEach((r) => r.classList.toggle("on", +r.dataset.tier === t.min));
      $("#calcRange").addEventListener("input", (e) => { cases = +e.target.value; draw(); $("#calcRange").focus(); });
      $("#calcSel").addEventListener("change", (e) => { pid = e.target.value; draw(); });
    };
    draw();

    // Count-up stats
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (!en.isIntersecting) return; io.unobserve(en.target);
      const el = en.target, to = +el.dataset.count, suf = el.dataset.suffix || (to >= 100 ? "+" : ""), t0 = performance.now();
      const tick = (now) => { const k = Math.min(1, (now - t0) / 1400), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(to * e) + suf; if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }), { threshold: 0.5 });
    $$("[data-count]").forEach((el) => io.observe(el));
  }

  function mountShop({ cat, params }) {
    const state = { cat: cat || "", q: params.get("q") || "", sort: "pop", stock: false, isNew: false, max: 1000 };
    const grid = $("#shopGrid");
    const priceOf = (p) => (isBiz() ? shown(p.price) : p.rrp);
    const draw = () => {
      const q = state.q.trim().toLowerCase();
      let list = PRODUCTS.filter((p) =>
        (!state.cat || p.cat === state.cat) &&
        (!q || (p.name + " " + p.sku + " " + p.desc).toLowerCase().includes(q)) &&
        (!state.stock || p.stock === "in") && (!state.isNew || p.badge === "New") &&
        priceOf(p) <= state.max);
      const sorters = { low: (a, b) => priceOf(a) - priceOf(b), high: (a, b) => priceOf(b) - priceOf(a), margin: (a, b) => margin(b) - margin(a), az: (a, b) => a.name.localeCompare(b.name), pop: (a, b) => (b.badge ? 1 : 0) - (a.badge ? 1 : 0) };
      list = list.sort(sorters[state.sort]);
      $("#resultCount").textContent = `${plural(list.length, "product")}${state.cat ? " in " + catOf({ cat: state.cat }).name : ""} · ${isBiz() ? "unit prices " + vatLbl() : "prices incl. VAT"}`;
      grid.innerHTML = list.length ? list.map(card).join("") : `<div class="empty"><h3>No products match</h3><p>Try a different search term, or clear your filters.</p></div>`;
      observe(); refreshScroll();
    };
    draw();
    $("#q").addEventListener("input", (e) => { state.q = e.target.value; draw(); });
    $("#sort").addEventListener("change", (e) => { state.sort = e.target.value; draw(); });
    $("#fStock").addEventListener("change", (e) => { state.stock = e.target.checked; draw(); });
    $("#fNew").addEventListener("change", (e) => { state.isNew = e.target.checked; draw(); });
    $("#fPrice").addEventListener("input", (e) => { state.max = +e.target.value; e.target.style.setProperty("--p", ((state.max - 5) / 995) * 100 + "%"); $("#fPriceVal").textContent = "R" + state.max; draw(); });
    $(".cat-filter").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cat]"); if (!b) return;
      location.hash = b.dataset.cat ? `#/shop/${b.dataset.cat}` : "#/shop";
    });
    $("#filterToggle").addEventListener("click", () => $("#filters").classList.toggle("open"));
    if (params.get("focus")) setTimeout(() => $("#q").focus(), 50);
  }

  function mountProduct({ id }) {
    const p = byId(id); if (!p) return;
    const qty = $("#pdpQty");
    const min = isBiz() ? p.moq : 1;
    const draw = () => {
      const n = Math.max(min, parseInt(qty.value, 10) || min);
      if (isBiz()) {
        const t = tierFor(n), u = unitPrice(p, n), nt = nextTier(n);
        $("#pdpUnit").textContent = money(shown(u));
        $("#pdpWas").textContent = t.off ? money(shown(p.price)) : "";
        const save = $("#pdpSave"); save.hidden = !t.off; save.textContent = `${t.name} −${t.off * 100}%`;
        $("#pdpUnits").textContent = `${plural(n, "case")} × ${p.pack} = ${(n * p.pack).toLocaleString()} units`;
        $("#pdpLine").textContent = money(shown(u * p.pack * n));
        $$("#tierTable tbody tr").forEach((r) => r.classList.toggle("on", +r.dataset.min === t.min));
        const nudge = $("#pdpNudge");
        nudge.hidden = !nt;
        if (nt) $("span", nudge).textContent = `Add ${plural(nt.min - n, "more case")} to unlock ${nt.name} pricing at ${money(shown(p.price * (1 - nt.off)))}/unit`;
      } else {
        $("#pdpUnits").textContent = plural(n, "item");
        $("#pdpLine").textContent = money(p.rrp * n);
      }
      return n;
    };
    draw();
    qty.addEventListener("input", draw);
    qty.addEventListener("blur", () => { qty.value = draw(); });
    $("#pdpMinus").addEventListener("click", () => { qty.value = Math.max(min, (+qty.value || min) - 1); draw(); });
    $("#pdpPlus").addEventListener("click", () => { qty.value = (+qty.value || 0) + 1; draw(); });
    $("#pdpAdd").addEventListener("click", () => addToCart(p.id, isBiz() ? "case" : "each", draw()));
    $(".pdp-thumbs").addEventListener("click", (e) => {
      const th = e.target.closest("[data-thumb]"); if (!th) return;
      $$(".pdp-thumbs .art").forEach((a) => a.classList.toggle("on", a === th));
      $("#pdpMain .art").className = `art t-${th.dataset.thumb}`;
    });
  }

  function mountBulk() {
    const qtys = {};
    const update = () => {
      let total = 0, lines = 0, casesN = 0;
      PRODUCTS.forEach((p) => {
        const n = qtys[p.id] || 0, row = $(`[data-row="${p.id}"]`);
        const u = unitPrice(p, Math.max(1, n)), t = tierFor(n);
        $(`[data-unit="${p.id}"]`).innerHTML = money(shown(u)) + (n && t.off ? `<span class="tier-pill">−${t.off * 100}%</span>` : "");
        $(`[data-bline="${p.id}"]`).textContent = n ? money(shown(u * p.pack * n)) : "—";
        row.classList.toggle("has", n > 0);
        if (n) { total += u * p.pack * n; lines++; casesN += n; }
      });
      $("#bulkTotal").textContent = money(shown(total));
      $("#bulkCount").textContent = lines ? `${plural(lines, "line")} · ${plural(casesN, "case")}` : "No items selected";
      $("#bulkAdd").disabled = !lines;
    };
    const setQ = (id, n) => {
      const p = byId(id); n = Math.max(0, Math.min(999, n || 0));
      if (n > 0 && n < p.moq) n = p.moq;
      qtys[id] = n; $(`[data-bulk="${id}"]`).value = n; update();
    };
    $("#bulkBody").addEventListener("click", (e) => {
      const b = e.target.closest("[data-bstep]"); if (!b) return;
      const id = b.dataset.bstep, p = byId(id), cur = qtys[id] || 0, d = +b.dataset.d;
      setQ(id, d > 0 ? (cur === 0 ? p.moq : cur + 1) : (cur <= p.moq ? 0 : cur - 1));
    });
    $("#bulkBody").addEventListener("change", (e) => { const i = e.target.closest("[data-bulk]"); if (i) setQ(i.dataset.bulk, parseInt(i.value, 10)); });
    const filter = () => {
      const q = $("#bq").value.trim().toLowerCase(), c = $("#bcat").value;
      $$("#bulkBody tr").forEach((r) => { r.hidden = (q && !r.dataset.search.includes(q)) || (c && r.dataset.cat !== c); });
    };
    $("#bq").addEventListener("input", filter); $("#bcat").addEventListener("change", filter);
    $("#bulkClear").addEventListener("click", () => PRODUCTS.forEach((p) => setQ(p.id, 0)));
    $("#bulkAdd").addEventListener("click", () => {
      let n = 0;
      Object.entries(qtys).forEach(([id, c]) => { if (c > 0) { const line = cart.find((l) => l.id === id && l.kind === "case"); if (line) line.qty += c; else cart.push({ id, kind: "case", qty: c }); n++; } });
      saveCart(); PRODUCTS.forEach((p) => setQ(p.id, 0));
      toast(null, `${plural(n, "line")} added to your cart`); openCart();
    });
    update();
  }

  function mountCheckout({ params }) {
    const form = $("#checkoutForm");
    let quote = form.dataset.quote === "true";
    const contactOnly = !isBiz() && params.get("mode") === "quote";
    const drawSummary = () => {
      const t = totals();
      $("#summary").innerHTML = cart.length ? `
        <h3>Order summary</h3>
        <div class="sum-items" data-lenis-prevent>${cart.map((l) => { const p = byId(l.id); return `<div class="sum-item">${art(p)}<div><strong>${esc(p.name)}</strong><small>${lineLabel(l)}${l.kind === "case" ? ` · ${(l.qty * p.pack).toLocaleString()} units` : ""}</small></div><b>${money(isBiz() ? lineEx(l) : lineEx(l) * 1.15)}</b></div>`; }).join("")}</div>
        ${totalsHTML(t)}
        <button class="btn btn-ghost btn-sm btn-block" type="button" data-open-cart style="margin-top:16px">Edit cart</button>`
        : `<h3>Order summary</h3><p style="color:var(--muted)">${quote || contactOnly ? "Your cart is empty. That's fine here; just tell us what you need in the form." : "Your cart is empty."}</p><a href="#/shop" class="btn btn-primary btn-sm" style="margin-top:16px">Browse products</a>`;
    };
    drawSummary();
    const ms = $(".mode-switch");
    if (ms) ms.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cmode]"); if (!b) return;
      quote = b.dataset.cmode === "quote";
      $$(".mode-switch button").forEach((x) => x.classList.toggle("on", x === b));
      $("#payCard").hidden = quote; $("#quoteCard").hidden = !quote;
      $("#submitBtn").innerHTML = (quote ? "Send quote request " : "Place order ") + svg.arrow;
    });
    // prefill from the signed-in account
    if (user) {
      const set = (n, v) => { const el = form.elements[n]; if (el && !el.value && v) el.value = v; };
      set("name", user.name); set("email", user.email); set("phone", user.phone); set("business", user.businessName); set("vat", user.vatNumber);
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const req = $$("[required]", form).filter((i) => !i.closest("[hidden]"));
      const bad = req.filter((i) => !i.value.trim() || (i.type === "email" && !/^\S+@\S+\.\S+$/.test(i.value)));
      req.forEach((i) => { i.style.borderColor = bad.includes(i) ? "var(--pink)" : ""; });
      if (bad.length) { bad[0].focus(); toast(null, "Please complete the highlighted fields"); return; }
      if (!quote && !contactOnly && !cart.length) { toast(null, "Your cart is empty. Add products first."); return; }
      const type = contactOnly ? "contact" : quote ? "quote" : "order";
      const fd = Object.fromEntries(new FormData(form));
      const btn = $("#submitBtn"); btn.disabled = true; const label = btn.innerHTML; btn.innerHTML = "Sending…";
      try {
        const res = await api("/api/orders", { method: "POST", body: {
          type, mode: mode || "home", payMethod: fd.pay, message: fd.message || "",
          lines: type === "contact" ? [] : cart.map(({ id, kind, qty }) => ({ id, kind, qty })),
          customer: { name: fd.name, email: fd.email, phone: fd.phone, business: fd.business, vat: fd.vat, street: fd.street, city: fd.city, province: fd.province, postal: fd.postal, notes: fd.notes },
        } });
        try { sessionStorage.setItem("mpm_last_order", JSON.stringify(res)); } catch { /* ignore */ }
        if (type === "order") { cart = []; saveCart(); loadCatalog().catch(() => {}); }
        if (res.payment && res.payment.type === "redirect") { location.href = res.payment.url; return; }
        location.hash = `#/done/${res.ref}?t=${type}`;
      } catch (err) {
        toast(null, err.message);
        btn.disabled = false; btn.innerHTML = label;
      }
    });
  }

  function mountBusiness() {
    $("#accountForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const bad = $$("[required]", f).filter((i) => !i.value.trim() || (i.type === "email" && !/^\S+@\S+\.\S+$/.test(i.value)) || (i.minLength > 0 && i.value.length < i.minLength));
      $$("[required]", f).forEach((i) => { i.style.borderColor = bad.includes(i) ? "var(--pink)" : ""; });
      if (bad.length) { bad[0].focus(); toast(null, "Please complete the highlighted fields"); return; }
      const v = (id) => ($("#" + id) || {}).value || "";
      const btn = $("#tradeBtn"); btn.disabled = true;
      try {
        const res = await api("/api/trade-applications", { method: "POST", body: {
          businessName: v("a1"), businessType: v("a2"), contact: v("a3"), phone: v("a4"), email: v("a5"),
          cipc: v("a6"), monthlySpend: v("a7"), wantsTerms: $("#a8").checked, vatNumber: v("a10"), password: v("a9"),
        } });
        user = res.user; syncUserUI();
        if (!isBiz()) setMode("business", false);
        location.hash = "#/done/new?t=account";
      } catch (err) { toast(null, err.message); btn.disabled = false; }
    });
  }

  const STATUS_LABEL = { pending_payment: "Awaiting payment", paid: "Paid", processing: "Processing", shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled", new: "Received", replied: "Replied", closed: "Closed" };

  views.account = ({ params }) => user ? `
    <section class="page-head"><div class="orb orb-2"></div><div class="container">
      <nav class="crumbs"><a href="#/">Home</a><span>My account</span></nav>
      <h1>Hi, <span class="serif">${esc(user.name.split(" ")[0])}</span></h1>
      <p>${esc(user.email)}${user.tradeStatus === "approved" ? " · Approved trade account" : user.tradeStatus === "pending" ? " · Trade application under review" : ""}</p>
    </div></section>
    <div class="container two-col">
      <div>
        <div class="form-card"><h3>Your orders</h3><div id="myOrders" class="my-orders"><p class="form-hint">Loading…</p></div></div>
      </div>
      <div>
        <form class="form-card" id="profileForm" novalidate><h3>Your details</h3><div class="fields">
          <div class="field full"><label for="p1">Name</label><input class="input" id="p1" name="name" value="${esc(user.name)}" required></div>
          <div class="field full"><label for="p2">Phone</label><input class="input" id="p2" name="phone" value="${esc(user.phone || "")}"></div>
          <div class="field full"><label for="p3">Business name</label><input class="input" id="p3" name="businessName" value="${esc(user.businessName || "")}"></div>
          <div class="field full"><label for="p4">VAT number</label><input class="input" id="p4" name="vatNumber" value="${esc(user.vatNumber || "")}"></div>
          <div class="field full"><label for="p5">Change password (optional)</label><input class="input" id="p5" name="currentPassword" type="password" placeholder="Current password" autocomplete="current-password"></div>
          <div class="field full"><input class="input" id="p6" name="newPassword" type="password" placeholder="New password (8+ characters)" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit" style="margin-top:18px">Save changes</button></form>
        ${user.tradeStatus === "none" ? `<a href="#/business" class="btn btn-ghost btn-block" style="margin-top:14px">Apply for a trade account ${svg.arrow}</a>` : ""}
        ${user.role === "admin" ? `<a href="/admin" class="btn btn-pink btn-block" style="margin-top:14px">Open admin dashboard ${svg.arrow}</a>` : ""}
        <button class="btn btn-ghost btn-block" type="button" id="logoutBtn" style="margin-top:14px">Sign out</button>
      </div>
    </div>` : `
    <section class="page-head"><div class="orb orb-1"></div><div class="container">
      <nav class="crumbs"><a href="#/">Home</a><span>Sign in</span></nav>
      <h1>${params.get("tab") === "register" ? 'Create your <span class="serif">account</span>' : 'Welcome <span class="serif">back</span>'}</h1>
      <p>Sign in to track orders, save your details and use trade pricing.</p>
    </div></section>
    <div class="container auth-wrap">
      <div class="form-card">
        <div class="mode-switch" role="tablist"><button type="button" data-auth="login" class="${params.get("tab") === "register" ? "" : "on"}">Sign in</button><button type="button" data-auth="register" class="${params.get("tab") === "register" ? "on" : ""}">Create account</button></div>
        <form id="loginForm" novalidate ${params.get("tab") === "register" ? "hidden" : ""}><div class="fields">
          <div class="field full"><label for="l1">Email</label><input class="input" id="l1" type="email" name="email" required autocomplete="email"></div>
          <div class="field full"><label for="l2">Password</label><input class="input" id="l2" type="password" name="password" required autocomplete="current-password"></div>
        </div><button class="btn btn-primary btn-block" type="submit" style="margin-top:18px">Sign in ${svg.arrow}</button></form>
        <form id="registerForm" novalidate ${params.get("tab") === "register" ? "" : "hidden"}><div class="fields">
          <div class="field full"><label for="r1">Full name</label><input class="input" id="r1" name="name" required autocomplete="name"></div>
          <div class="field full"><label for="r2">Email</label><input class="input" id="r2" type="email" name="email" required autocomplete="email"></div>
          <div class="field full"><label for="r3">Phone (optional)</label><input class="input" id="r3" type="tel" name="phone" autocomplete="tel"></div>
          <div class="field full"><label for="r4">Password</label><input class="input" id="r4" type="password" name="password" required minlength="8" autocomplete="new-password" placeholder="At least 8 characters"></div>
        </div><button class="btn btn-primary btn-block" type="submit" style="margin-top:18px">Create account ${svg.arrow}</button>
        <p class="form-hint">Buying for a business? <a href="#/business">Apply for a trade account</a> instead.</p></form>
      </div>
    </div>`;

  function mountAccount({ params }) {
    const next = params.get("next");
    const after = () => { location.hash = next === "checkout" ? "#/checkout" : next === "business" ? "#/business" : "#/account"; if (!next) rerender(); };
    if (!user) {
      $(".mode-switch").addEventListener("click", (e) => {
        const b = e.target.closest("[data-auth]"); if (!b) return;
        $$(".mode-switch button").forEach((x) => x.classList.toggle("on", x === b));
        $("#loginForm").hidden = b.dataset.auth !== "login"; $("#registerForm").hidden = b.dataset.auth !== "register";
      });
      const wire = (id, path, extra = {}) => $(id).addEventListener("submit", async (e) => {
        e.preventDefault();
        const body = { ...Object.fromEntries(new FormData(e.currentTarget)), ...extra };
        const btn = $("button[type=submit]", e.currentTarget); btn.disabled = true;
        try { const r = await api(path, { method: "POST", body }); user = r.user; syncUserUI(); await loadCatalog(); toast(null, `Welcome, ${user.name.split(" ")[0]}!`); after(); }
        catch (err) { toast(null, err.message); btn.disabled = false; }
      });
      wire("#loginForm", "/api/auth/login");
      wire("#registerForm", "/api/auth/register", { accountType: mode === "business" ? "business" : "home" });
      return;
    }
    api("/api/me").then(({ orders }) => {
      const box = $("#myOrders"); if (!box) return;
      box.innerHTML = orders.length ? orders.map((o) => `
        <details class="my-order"><summary><div><strong>${esc(o.ref)}</strong><small>${new Date(o.createdAt.replace(" ", "T") + "Z").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })} · ${o.type === "order" ? plural(o.items.length, "product") : o.type === "quote" ? "Quote request" : "Message"}</small></div>
          <span class="pill s-${o.status}">${STATUS_LABEL[o.status] || o.status}</span>${o.type === "order" ? `<b>${money(o.total)}</b>` : ""}</summary>
          ${o.items.length ? `<div class="receipt">${o.items.map((i) => `<div><span>${esc(i.name)} <small>× ${i.qty}${i.kind === "case" ? " cases" : ""}</small></span><b>${money(i.lineInc)}</b></div>`).join("")}</div>` : ""}
          ${o.message ? `<p class="form-hint">${esc(o.message)}</p>` : ""}
        </details>`).join("") : `<p class="form-hint">No orders yet. <a href="#/shop">Start shopping</a>.</p>`;
    }).catch(() => {});
    $("#profileForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try { const r = await api("/api/me", { method: "PATCH", body: Object.fromEntries(new FormData(e.currentTarget)) }); user = r.user; syncUserUI(); toast(null, "Saved"); e.currentTarget.reset(); rerender(); }
      catch (err) { toast(null, err.message); }
    });
    $("#logoutBtn").addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST" }).catch(() => {});
      user = null; syncUserUI(); await loadCatalog().catch(() => {}); toast(null, "Signed out"); location.hash = "#/";
    });
  }

  function syncUserUI() {
    const a = $("#accountLink");
    if (a) { a.classList.toggle("signed-in", !!user); a.setAttribute("aria-label", user ? `My account (${user.name})` : "Sign in"); a.title = user ? user.name : "Sign in"; }
  }

  /* ---------- scroll engine ---------- */
  const S = { par: [], shift: [], words: null, hs: null, steps: [], footWord: null, heroInner: null, ticking: false };

  function refreshScroll() {
    S.par = $$("[data-par]");
    S.shift = $$("[data-shift]");
    const wsec = $("[data-words]");
    S.words = wsec ? { el: wsec, w: $$(".w", wsec) } : null;
    S.heroInner = $("#heroInner");
    S.steps = $$(".stack .step");
    S.footWord = $(".footer-word");
    const hs = $(".hs");
    if (hs) {
      const track = $(".hs-track", hs);
      const pinned = window.innerWidth > 900 && !reduced;
      hs.classList.toggle("pinned", pinned);
      // intro rides inside the track when pinned, sits above the swipe row otherwise
      const intro = $(".hs-intro", hs);
      if (pinned && intro.parentNode !== track) track.prepend(intro);
      if (!pinned && intro.parentNode === track) track.before(intro);
      if (pinned) {
        track.style.transform = "";
        const dist = Math.max(0, track.scrollWidth - window.innerWidth + 64);
        hs.style.height = dist + window.innerHeight + "px";
        S.hs = { el: hs, track, dist };
      } else { hs.style.height = ""; track.style.transform = ""; S.hs = null; }
    } else S.hs = null;
    if (lenis) lenis.resize();
    onScroll();
  }

  function update() {
    S.ticking = false;
    const y = window.scrollY, vh = window.innerHeight;
    const docH = document.documentElement.scrollHeight - vh;
    $("#scrollBar").style.transform = `scaleX(${docH > 0 ? clamp(y / docH) : 0})`;
    $("#nav").classList.toggle("scrolled", y > 20);
    if (reduced) return;

    if (S.heroInner && y < vh * 1.2) {
      S.heroInner.style.transform = `translate3d(0, ${y * 0.28}px, 0)`;
      S.heroInner.style.opacity = String(clamp(1 - y / (vh * 0.75)));
    }
    S.par.forEach((el) => { if (y < vh * 1.5) el.style.transform = `translate3d(0, ${y * +el.dataset.par}px, 0)`; });
    S.shift.forEach((el) => { el.style.transform = `translate3d(${y * +el.dataset.shift}px, 0, 0)`; });

    if (S.words) {
      const r = S.words.el.getBoundingClientRect();
      const p = clamp((vh * 0.8 - r.top) / (r.height + vh * 0.1));
      const lit = Math.round(p * S.words.w.length);
      S.words.w.forEach((w, i) => w.classList.toggle("on", i < lit));
    }

    if (S.hs) {
      const r = S.hs.el.getBoundingClientRect();
      const p = clamp(-r.top / (r.height - vh));
      S.hs.track.style.transform = `translate3d(${-p * S.hs.dist}px, 0, 0)`;
      $("#hsBar").style.transform = `scaleX(${p})`;
    }

    S.steps.forEach((s, i) => {
      const next = S.steps[i + 1];
      if (!next) { s.style.transform = ""; return; }
      const r = s.getBoundingClientRect(), nr = next.getBoundingClientRect();
      const p = clamp((r.bottom - nr.top) / r.height);
      s.style.transform = `scale(${1 - p * 0.06})`;
      s.style.filter = `brightness(${1 - p * 0.08})`;
    });

    if (S.footWord) {
      const r = S.footWord.getBoundingClientRect();
      const p = clamp((vh - r.top) / (r.height + vh * 0.3));
      S.footWord.style.setProperty("--fw", p.toFixed(3));
    }
  }
  function onScroll() { if (!S.ticking) { S.ticking = true; requestAnimationFrame(update); } }
  window.addEventListener("scroll", onScroll, { passive: true });
  let rT; window.addEventListener("resize", () => { clearTimeout(rT); rT = setTimeout(refreshScroll, 150); });

  /* ---------- scroll reveal ---------- */
  let ready = false;
  const revealer = "IntersectionObserver" in window
    ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); revealer.unobserve(e.target); } }), { threshold: 0.08, rootMargin: "0px 0px -40px 0px" })
    : null;
  function observe() { if (!ready) return; $$(".reveal:not(.in)").forEach((el) => (revealer ? revealer.observe(el) : el.classList.add("in"))); }

  /* ---------- router ---------- */
  function parse() {
    const raw = location.hash.replace(/^#/, "") || "/";
    const [pathAndQuery, anchor] = raw.split("#");
    const [path, query] = pathAndQuery.split("?");
    const parts = path.split("/").filter(Boolean);
    return { parts, params: new URLSearchParams(query || ""), anchor };
  }

  const ROUTES = { home: [views.home, mountHome], shop: [views.shop, mountShop], product: [views.product, mountProduct], bulk: [views.bulk, mountBulk], checkout: [views.checkout, mountCheckout], account: [views.account, mountAccount], business: [views.business, mountBusiness], done: [views.done, null] };
  function resolve() {
    const { parts, params, anchor } = parse();
    const [name = "home", id] = parts;
    const [view, mount] = ROUTES[name] || [views.notFound, null];
    return { name, id, anchor, view, mount, key: parts.join("/") + "?" + params.toString(), ctx: { id, cat: name === "shop" ? id : undefined, params } };
  }

  let lastKey = "";
  function route() {
    const { name, id, anchor, view, mount, key, ctx } = resolve();
    const app = $("#app");

    if (key !== lastKey) {
      app.innerHTML = view(ctx);
      app.classList.remove("view-enter"); void app.offsetWidth; app.classList.add("view-enter");
      if (mount) mount(ctx);
      observe();
      if (!anchor) scrollToTop();
      lastKey = key;
      document.title = { home: "MPM Digital — Everything for the home, priced for everyone", shop: "Shop — MPM Digital", product: (byId(id) || {}).name + " — MPM Digital", bulk: "Bulk order — MPM Digital", checkout: "Checkout — MPM Digital", account: "My account — MPM Digital", business: "For business — MPM Digital" }[name] || "MPM Digital";
      requestAnimationFrame(refreshScroll);
    }
    if (anchor) setTimeout(() => { const el = document.getElementById(anchor); if (el) scrollToEl(el); }, 60);

    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name || a.dataset.nav === anchor));
    $("#nav").classList.remove("menu-open"); $("#menuBtn").setAttribute("aria-expanded", "false");
    closeCart();
  }

  // Re-render the current page in place (mode / VAT change) without jumping to the top.
  function rerender() {
    const y = window.scrollY;
    const { view, mount, key, ctx } = resolve();
    $("#app").innerHTML = view(ctx);
    if (mount) mount(ctx);
    $$("#app .reveal").forEach((el) => el.classList.add("in"));
    lastKey = key;
    renderCart();
    requestAnimationFrame(() => { refreshScroll(); if (lenis) lenis.scrollTo(y, { immediate: true }); else window.scrollTo(0, y); });
  }

  /* ---------- loader ---------- */
  function runLoader() {
    const L = $("#loader");
    const finish = () => { document.body.classList.remove("is-loading"); ready = true; observe(); };
    if (!L || reduced) { if (L) L.remove(); finish(); return Promise.resolve(); }
    let seen = false; try { seen = sessionStorage.getItem("mpm_seen") === "1"; sessionStorage.setItem("mpm_seen", "1"); } catch { /* ignore */ }
    const dur = seen ? 900 : 2100;
    return new Promise((resolve) => {
      let loaded = document.readyState === "complete", p = 0, done = false;
      window.addEventListener("load", () => { loaded = true; });
      const start = performance.now(), bar = $("#loaderBar"), count = $("#loaderCount");
      const end = () => {
        if (done) return; done = true;
        count.textContent = "100"; bar.style.transform = "scaleX(1)";
        setTimeout(() => {
          L.classList.add("done"); finish();
          setTimeout(() => { L.remove(); resolve(); }, 1100);
        }, 220);
      };
      const tick = (now) => {
        if (done) return;
        const t = (now - start) / dur;
        const target = loaded ? Math.min(1, t) : Math.min(0.86, t);
        p += (target - p) * 0.14;
        count.textContent = String(Math.round(p * 100));
        bar.style.transform = `scaleX(${p})`;
        if (loaded && t >= 1 && p > 0.985) end(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(end, dur + 3000); // fail-safe
    });
  }

  /* ---------- welcome chooser ---------- */
  function showWelcome() {
    if (mode) return;
    const w = $("#welcome");
    w.hidden = false; lockScroll(true);
    requestAnimationFrame(() => w.classList.add("on"));
    setTimeout(() => $(".w-opt", w).focus(), 400);
    w.addEventListener("click", (e) => {
      const b = e.target.closest("[data-welcome]");
      if (!b && e.target !== w) return;
      const m = b ? b.dataset.welcome : "home";
      w.classList.remove("on"); lockScroll(false);
      setTimeout(() => { w.hidden = true; }, 400);
      mode = null; setMode(m, false);
      toast(null, m === "business" ? "Welcome! You're seeing business pricing." : "Welcome! Happy shopping.");
    });
  }

  /* ---------- global events ---------- */
  document.addEventListener("click", (e) => {
    const ms = e.target.closest("[data-mode-set]");
    if (ms) { e.preventDefault(); setMode(ms.dataset.modeSet); return; }
    const add = e.target.closest("[data-add]");
    if (add) { e.preventDefault(); addToCart(add.dataset.add); return; }
    const addCase = e.target.closest("[data-add-case]");
    if (addCase) { e.preventDefault(); addToCart(addCase.dataset.addCase, "case"); return; }
    if (e.target.closest("[data-open-cart]")) { e.preventDefault(); openCart(); return; }
    if (e.target.closest("[data-close-cart]")) closeCart();
    const rm = e.target.closest("[data-remove]");
    if (rm) { cart = cart.filter((l) => keyOf(l) !== rm.dataset.remove); saveCart(); return; }
    const st = e.target.closest("[data-step]");
    if (st) { const l = cart.find((x) => keyOf(x) === st.dataset.step); if (l) setQty(st.dataset.step, l.qty + +st.dataset.d); }
  });
  $("#drawerBody").addEventListener("change", (e) => { const i = e.target.closest("[data-qty]"); if (i) setQty(i.dataset.qty, parseInt(i.value, 10) || 0); });
  $("#cartBtn").addEventListener("click", openCart);
  $("#drawerClose").addEventListener("click", closeCart);
  $("#scrim").addEventListener("click", closeCart);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeCart(); $("#nav").classList.remove("menu-open"); } });
  $("#menuBtn").addEventListener("click", () => { const open = $("#nav").classList.toggle("menu-open"); $("#menuBtn").setAttribute("aria-expanded", String(open)); });

  const vt = $("#vatToggle");
  vt.setAttribute("aria-pressed", String(incVat));
  vt.addEventListener("click", () => { incVat = !incVat; store.set("mpm_vat", incVat); vt.setAttribute("aria-pressed", String(incVat)); rerender(); toast(null, `Prices now shown ${vatLbl()}`); });

  $("#newsForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = e.currentTarget;
    try { await api("/api/subscribe", { method: "POST", body: { email: $("#newsEmail").value } }); f.reset(); toast(null, "Subscribed. Look out for our next drop."); }
    catch (err) { toast(null, err.message); }
  });
  window.addEventListener("hashchange", route);
  $("#year").textContent = new Date().getFullYear();

  /* ---------- boot ---------- */
  syncModeUI();
  const loaderDone = runLoader();
  Promise.all([loadCatalog(), api("/api/me").then((r) => { user = r.user; }).catch(() => {})])
    .then(() => {
      cart = cart.filter((l) => byId(l.id)); store.set("mpm_cart", cart);
      syncUserUI(); renderCart(); route();
      loaderDone.then(showWelcome);
    })
    .catch(() => {
      $("#app").innerHTML = `<div class="container"><div class="done"><h1>We'll be right back</h1><p>The shop couldn't load just now. Please refresh the page in a moment.</p><a class="btn btn-primary" href="/">Try again</a></div></div>`;
    });
})();
