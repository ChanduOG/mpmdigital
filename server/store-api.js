// Store (shop front) API. Deployed with APP_ROLE=store. Contains NO admin endpoints.
"use strict";
const { db, tx } = require("./db");
const store = require("./db");
const auth = require("./auth");
const payments = require("./payments");
const analytics = require("./analytics");
const { notify } = require("./notify");
const {
  HttpError, bad, str, int, isEmail, r2, rateLimit, rowToProduct, getProduct, isTrade, details, logStock, evaluateDiscount, newRef, P,
} = require("./core");

function register(route) {
  route("GET", "/api/health", async () => ({ ok: true, app: "store", database: store.readOnly() ? "preview (not connected)" : store.isLocalFile ? "local file" : "connected" }));

  /* ---- catalogue ---- */
  route("GET", "/api/catalog", async (ctx) => {
    const user = ctx.user, st = ctx.settings, trade = isTrade(user);
    const categories = await db.all("SELECT id, name, blurb, icon, tone, sort FROM categories ORDER BY sort, name");
    const products = (await db.all("SELECT * FROM products WHERE active = 1 ORDER BY sort, name")).map(rowToProduct)
      // never expose stock counts or supplier cost; only approved trade accounts receive wholesale prices
      .map(({ stockUnits, active, price, cost, updatedAt, supplier, ...p }) => (trade ? { ...p, price } : p));
    return {
      categories, products,
      tiers: P.TIERS,                              // discount percentages only (no prices)
      settings: {
        vatRate: P.VAT_RATE, bizFreeDelivery: P.BIZ_FREE_DELIVERY, bizDeliveryFee: P.BIZ_DELIVERY_FEE,
        homeFreeDelivery: P.HOME_FREE_DELIVERY, homeDeliveryFee: P.HOME_DELIVERY_FEE,
        paymentMethods: payments.available(user, st),
        announcement: st.announcement,
        store: { name: st.store.name, email: st.store.email, phone: st.store.phone, whatsapp: st.store.whatsapp },
        delivery: { collectEnabled: !!st.delivery.collectEnabled, collectAddress: st.delivery.collectAddress, collectNote: st.delivery.collectNote, eta: st.delivery.eta },
        preview: store.readOnly(),
        trade,
        tradeStatus: user ? user.trade_status : "none",
      },
    };
  });

  // Anonymous, cookie-free page/event tracking for the admin traffic dashboard.
  route("POST", "/api/track", async (ctx) => {
    rateLimit(ctx.req, "track", 240, 60e3);
    const b = ctx.body;
    const path = str(b.path, 120).replace(/[^\w\-/.]/g, "");
    const m = /^\/product\/([\w-]+)$/.exec(path);
    await analytics.record(ctx.req, { type: str(b.type, 20), path, productId: str(b.productId, 80) || (m ? m[1] : ""), referrer: str(b.referrer, 300), mode: str(b.mode, 10) }, ctx.user);
    return { ok: true };
  });

  /* ---- customer accounts ---- */
  route("POST", "/api/auth/register", async (ctx) => {
    rateLimit(ctx.req, "register", 10, 15 * 60e3);
    const b = ctx.body;
    const email = str(b.email, 160).toLowerCase(), name = str(b.name, 120), pw = String(b.password || "");
    if (!name) throw bad("Please enter your name.");
    if (!isEmail(email)) throw bad("Please enter a valid email address.");
    if (pw.length < 8) throw bad("Your password needs at least 8 characters.");
    if (await db.get("SELECT 1 AS x FROM users WHERE email = ?", email)) throw new HttpError(409, "An account with that email already exists. Try signing in.");
    const info = await db.run("INSERT INTO users (email,name,phone,password_hash,account_type) VALUES (?,?,?,?,?)",
      email, name, str(b.phone, 40), auth.hashPassword(pw), b.accountType === "business" ? "business" : "home");
    await auth.createSession(ctx.res, ctx.req, info.lastInsertRowid);
    return { user: auth.publicUser(await db.get("SELECT * FROM users WHERE id = ?", info.lastInsertRowid)) };
  });

  route("POST", "/api/auth/login", async (ctx) => {
    rateLimit(ctx.req, "login", 10, 15 * 60e3);
    const email = str(ctx.body.email, 160).toLowerCase(), pw = String(ctx.body.password || "");
    const u = await db.get("SELECT * FROM users WHERE email = ?", email);
    if (!u || !auth.verifyPassword(pw, u.password_hash)) throw new HttpError(401, "That email and password don't match.");
    await auth.createSession(ctx.res, ctx.req, u.id);
    return { user: auth.publicUser(u) };
  });

  route("POST", "/api/auth/logout", async (ctx) => { await auth.destroySession(ctx.req, ctx.res); return { ok: true }; }, { allowReadOnly: true });

  route("GET", "/api/me", async (ctx) => {
    if (!ctx.user) return { user: null };
    const orders = await details(await db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50", ctx.user.id));
    // customers see their own orders, without internal notes or supplier costs
    return { user: auth.publicUser(ctx.user), orders: orders.map(({ adminNotes, items, ...o }) => ({ ...o, items: items.map(({ unitCost, ...i }) => i) })) };
  });

  route("PATCH", "/api/me", async (ctx) => {
    const u = ctx.user; if (!u) throw new HttpError(401, "Please sign in.");
    const b = ctx.body;
    await db.run("UPDATE users SET name=?, phone=?, business_name=?, vat_number=? WHERE id=?",
      str(b.name, 120) || u.name, str(b.phone, 40), str(b.businessName, 160), str(b.vatNumber, 40), u.id);
    if (b.newPassword) {
      if (!auth.verifyPassword(String(b.currentPassword || ""), u.password_hash)) throw bad("Your current password is incorrect.");
      if (String(b.newPassword).length < 8) throw bad("Your new password needs at least 8 characters.");
      await db.run("UPDATE users SET password_hash=? WHERE id=?", auth.hashPassword(String(b.newPassword)), u.id);
    }
    return { user: auth.publicUser(await db.get("SELECT * FROM users WHERE id = ?", u.id)) };
  });

  /* ---- checkout ---- */
  route("POST", "/api/checkout/preview", async (ctx) => {
    rateLimit(ctx.req, "preview", 120, 60e3);
    const q = await quoteCart(ctx.body, ctx.user, ctx.settings, { forOrder: false });
    return { totals: q.totals, discount: q.discountInfo, issues: q.issues };
  }, { allowReadOnly: true });

  route("POST", "/api/orders", (ctx) => { rateLimit(ctx.req, "orders", 30, 10 * 60e3); return createOrder(ctx); });

  /* ---- trade applications & newsletter ---- */
  route("POST", "/api/trade-applications", async (ctx) => {
    rateLimit(ctx.req, "trade", 10, 30 * 60e3);
    const b = ctx.body;
    const app = {
      business_name: str(b.businessName, 160), business_type: str(b.businessType, 80), contact: str(b.contact, 120),
      phone: str(b.phone, 40), email: str(b.email, 160).toLowerCase(), cipc: str(b.cipc, 60), vat_number: str(b.vatNumber, 40),
      monthly_spend: str(b.monthlySpend, 60), wants_terms: b.wantsTerms ? 1 : 0,
    };
    if (!app.business_name || !app.contact || !app.phone || !app.business_type) throw bad("Please complete all required fields.");
    if (!isEmail(app.email)) throw bad("Please enter a valid email address.");
    let user = ctx.user;
    if (!user) {
      const pw = String(b.password || "");
      if (await db.get("SELECT 1 AS x FROM users WHERE email = ?", app.email)) throw new HttpError(409, "An account with that email already exists. Sign in first, then apply.");
      if (pw.length < 8) throw bad("Choose a password of at least 8 characters for your account.");
      const info = await db.run("INSERT INTO users (email,name,phone,password_hash,account_type,business_name,vat_number) VALUES (?,?,?,?,?,?,?)",
        app.email, app.contact, app.phone, auth.hashPassword(pw), "business", app.business_name, app.vat_number);
      user = await db.get("SELECT * FROM users WHERE id = ?", info.lastInsertRowid);
      await auth.createSession(ctx.res, ctx.req, user.id);
    }
    await db.run("UPDATE users SET account_type='business', business_name=?, vat_number=?, trade_status=CASE WHEN trade_status='approved' THEN 'approved' ELSE 'pending' END WHERE id=?",
      app.business_name, app.vat_number, user.id);
    await db.run(`INSERT INTO trade_applications (user_id,business_name,business_type,contact,phone,email,cipc,vat_number,monthly_spend,wants_terms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, user.id, app.business_name, app.business_type, app.contact, app.phone, app.email, app.cipc, app.vat_number, app.monthly_spend, app.wants_terms);
    notify("trade.applied", app);
    return { ok: true, user: auth.publicUser(await db.get("SELECT * FROM users WHERE id = ?", user.id)) };
  });

  route("POST", "/api/subscribe", async (ctx) => {
    rateLimit(ctx.req, "subscribe", 10, 10 * 60e3);
    const email = str(ctx.body.email, 160).toLowerCase();
    if (!isEmail(email)) throw bad("Please enter a valid email address.");
    await db.run("INSERT OR IGNORE INTO subscribers (email) VALUES (?)", email);
    return { ok: true };
  });

  // Payment gateway callbacks (ITN / webhooks) land here once a connector is added.
  route("POST", "/api/payments/:method/notify", async (ctx) => {
    const m = payments.methods[ctx.params.method];
    if (!m || typeof m.notify !== "function") throw new HttpError(404, "Unknown payment method");
    return (await m.notify(ctx.req, ctx.body)) || { ok: true };
  }, { csrf: false });
}

/* ------------------------------------------------------------------ helpers */
function cleanLines(lines) {
  if (!Array.isArray(lines)) return [];
  const merged = new Map();
  for (const l of lines.slice(0, 200)) {
    const id = str(l.id, 80), kind = l.kind === "case" ? "case" : "each", qty = int(l.qty);
    if (!id || !Number.isFinite(qty) || qty <= 0 || qty > 9999) continue;
    const key = id + ":" + kind;
    merged.set(key, { id, kind, qty: (merged.get(key)?.qty || 0) + qty });
  }
  return [...merged.values()];
}

/** Price a cart on the server (the only prices that count). */
async function quoteCart(body, user, st, { forOrder }) {
  const lines = cleanLines(body.lines);
  if (lines.some((l) => l.kind === "case") && !isTrade(user))
    throw new HttpError(403, "Wholesale (by the case) pricing is only available to approved trade accounts. Please sign in with your trade account, or remove the cases from your cart.");
  const items = [], issues = [];
  for (const l of lines) {
    const p = await getProduct(l.id);
    if (!p || !p.active) { if (forOrder) throw bad(`A product in your cart is no longer available (${l.id}).`); issues.push({ id: l.id, issue: "unavailable" }); continue; }
    if (l.kind === "case" && l.qty < p.moq) { if (forOrder) throw bad(`${p.name}: the minimum order is ${p.moq} case(s).`); issues.push({ id: l.id, issue: "moq", moq: p.moq }); }
    const units = P.lineUnits(p, l);
    if (units > p.stockUnits) {
      if (forOrder) throw new HttpError(409, p.stockUnits > 0 ? `Sorry, we only have ${p.stockUnits} units of ${p.name} in stock.` : `Sorry, ${p.name} is sold out.`);
      issues.push({ id: l.id, issue: "stock", available: Math.max(0, p.stockUnits) });
    }
    const unitEx = l.kind === "case" ? P.unitPrice(p, l.qty) : P.retailEx(p);
    items.push({ p, l, units, unitEx, lineEx: P.lineEx(p, l) });
  }
  const getP = (id) => items.find((i) => i.p.id === id)?.p;
  const base = P.totals(lines, getP);
  const d = body.code ? await evaluateDiscount(body.code, base.sub, base.hasCase) : { ok: false, discountEx: 0, code: "" };
  if (forOrder && body.code && !d.ok) throw bad(d.message || "That discount code isn't valid.");
  const collect = body.deliveryMethod === "collect";
  if (collect && !st.delivery.collectEnabled) throw bad("Collection isn't available right now. Please choose delivery.");
  const t = P.totals(lines, getP, { discountEx: d.discountEx, collect });
  return {
    lines, items, collect, d, issues,
    discountInfo: body.code ? { ok: d.ok, code: d.code, label: d.label || "", message: d.message || "" } : null,
    totals: {
      sub: r2(t.sub), discount: r2(t.discount), goods: r2(t.goods), delivery: r2(t.delivery), vat: r2(t.vat), total: r2(t.total),
      saving: r2(t.saving), freeAt: r2(t.hasCase ? t.freeAtEx : t.freeAtEx * (1 + P.VAT_RATE)), hasCase: t.hasCase,
    },
  };
}

function cleanCustomer(c = {}, needAddress) {
  const out = {
    name: str(c.name, 120), email: str(c.email, 160).toLowerCase(), phone: str(c.phone, 40),
    business: str(c.business, 160), vat: str(c.vat, 40),
    street: str(c.street, 200), suburb: str(c.suburb, 100), city: str(c.city, 100), province: str(c.province, 60), postal: str(c.postal, 12), notes: str(c.notes, 300),
  };
  if (!out.name) throw bad("Please enter your name.");
  if (!isEmail(out.email)) throw bad("Please enter a valid email address.");
  if (!out.phone) throw bad("Please enter a phone number.");
  if (needAddress && (!out.street || !out.city || !out.province || !out.postal)) throw bad("Please complete your delivery address.");
  return out;
}

async function createOrder(ctx) {
  const body = ctx.body, user = ctx.user, st = ctx.settings;
  const type = ["order", "quote", "contact"].includes(body.type) ? body.type : "order";
  const mode = body.mode === "business" ? "business" : "home";
  const message = str(body.message, 4000);
  if (type === "contact" && !message) throw bad("Please tell us how we can help.");

  const q = await quoteCart(body, user, st, { forOrder: type === "order" });
  if (type === "order" && !q.items.length) throw bad("Your cart is empty.");
  const customer = cleanCustomer(body.customer, type === "order" && !q.collect);

  let payMethod = "", status = type === "order" ? "pending_payment" : "new", payStatus = "unpaid";
  if (type === "order") {
    payMethod = str(body.payMethod, 30);
    const m = payments.methods[payMethod];
    if (!m || !m.enabled(st) || (m.allowed && !m.allowed(user))) throw bad("Please choose an available payment method.");
    if (payMethod === "account") { status = "processing"; payStatus = "on_account"; }
  }

  const t = q.totals;
  const ref = await newRef(type === "order" ? "MPM" : type === "quote" ? "Q" : "C");
  const order = await tx(async (x) => {
    if (type === "order") {
      for (const i of q.items) {
        const r = await x.run("UPDATE products SET stock_units = stock_units - ?, updated_at = datetime('now') WHERE id = ? AND stock_units >= ?", i.units, i.p.id, i.units);
        if (r.changes !== 1) throw new HttpError(409, `Sorry, ${i.p.name} just sold out. Please update your cart.`);
        await logStock(x, i.p.id, -i.units, "sale", { ref });
      }
      if (q.d.ok) {
        const u = await x.run("UPDATE discounts SET uses = uses + 1 WHERE id = ? AND (max_uses = 0 OR uses < max_uses)", q.d.id);
        if (u.changes !== 1) throw bad("That discount code has just been fully used.");
      }
    }
    const info = await x.run(`INSERT INTO orders (ref,type,user_id,mode,status,payment_method,payment_status,subtotal,discount,discount_code,delivery,delivery_method,vat,total,saving,customer,message)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ref, type, user ? user.id : null, mode, status, payMethod, payStatus,
      t.sub, t.discount, q.d.ok ? q.d.code : "", t.delivery, q.collect ? "collect" : "courier", t.vat, t.total, t.saving, JSON.stringify(customer), message);
    for (const i of q.items)
      await x.run("INSERT INTO order_items (order_id,product_id,name,sku,kind,qty,units,unit_price_ex,line_ex,unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?)",
        info.lastInsertRowid, i.p.id, i.p.name, i.p.sku, i.l.kind, i.l.qty, i.units, i.unitEx, i.lineEx, i.p.cost || 0);
    return { id: info.lastInsertRowid, ref, type, status, total: t.total };
  });

  notify("order.created", { ...order, customer });
  if (type === "order") await analytics.record(ctx.req, { type: "order", path: "/checkout", mode }, user);
  let payment = type === "order" ? payments.methods[payMethod].start(order, { user, settings: st }) : { type: "none" };
  if (type === "order" && q.collect) payment = { ...payment, collect: { address: st.delivery.collectAddress, note: st.delivery.collectNote } };
  return {
    ref, type, status, totals: t, deliveryMethod: q.collect ? "collect" : "courier",
    items: q.items.map((i) => ({ name: i.p.name, image: i.p.image, kind: i.l.kind, qty: i.l.qty, units: i.units, lineEx: r2(i.lineEx), lineInc: r2(i.lineEx * (1 + P.VAT_RATE)) })),
    payment,
  };
}

module.exports = { register };
