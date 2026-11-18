// MPM Digital — web server (Node 22.5+, no external dependencies).
//   npm start            -> http://localhost:3000
"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { db, tx, DATA_DIR } = require("./db");
const auth = require("./auth");
const payments = require("./payments");
const { notify } = require("./notify");
const P = require("../public/assets/js/pricing.js");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

auth.ensureAdmin();

/* ------------------------------------------------------------------ helpers */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; "),
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, "Request too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(bad("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const int = (v) => Number.parseInt(v, 10);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const r2 = P.round2;

// tiny in-memory rate limiter (per IP + bucket)
const hits = new Map();
function rateLimit(req, bucket, max, windowMs) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  const key = bucket + ":" + ip, now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (arr.length > max) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
}

/* ----------------------------------------------------------------- catalog */
const rowToProduct = (r) => ({
  id: r.id, name: r.name, cat: r.cat, icon: r.icon, sku: r.sku, supplier: r.supplier, pack: r.pack, moq: r.moq,
  price: r.price, rrp: r.rrp, badge: r.badge, desc: r.description, specs: safeJson(r.specs, {}), image: r.image,
  stockUnits: r.stock_units, stock: r.stock_units <= 0 ? "out" : r.stock_units <= r.pack * 10 ? "low" : "in",
  active: !!r.active, sort: r.sort,
});
function safeJson(s, d) { try { return JSON.parse(s); } catch { return d; } }
const getProduct = (id) => { const r = db.prepare("SELECT * FROM products WHERE id = ?").get(id); return r ? rowToProduct(r) : null; };

function catalog(user) {
  const categories = db.prepare("SELECT * FROM categories ORDER BY sort, name").all();
  const products = db.prepare("SELECT * FROM products WHERE active = 1 ORDER BY sort, name").all().map(rowToProduct)
    .map(({ stockUnits, active, ...p }) => p);   // don't expose exact stock counts publicly
  return {
    categories, products, tiers: P.TIERS,
    settings: {
      vatRate: P.VAT_RATE, bizFreeDelivery: P.BIZ_FREE_DELIVERY, bizDeliveryFee: P.BIZ_DELIVERY_FEE,
      homeFreeDelivery: P.HOME_FREE_DELIVERY, homeDeliveryFee: P.HOME_DELIVERY_FEE,
      paymentMethods: payments.available(user),
    },
  };
}

/* ------------------------------------------------------------------ orders */
function newRef(prefix) {
  const d = new Date(), ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  for (;;) {
    const ref = `${prefix}-${ymd}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    if (!db.prepare("SELECT 1 FROM orders WHERE ref = ?").get(ref)) return ref;
  }
}

function cleanCustomer(c = {}, needAddress) {
  const out = {
    name: str(c.name, 120), email: str(c.email, 160).toLowerCase(), phone: str(c.phone, 40),
    business: str(c.business, 160), vat: str(c.vat, 40),
    street: str(c.street, 200), city: str(c.city, 100), province: str(c.province, 60), postal: str(c.postal, 12), notes: str(c.notes, 300),
  };
  if (!out.name) throw bad("Please enter your name.");
  if (!isEmail(out.email)) throw bad("Please enter a valid email address.");
  if (!out.phone) throw bad("Please enter a phone number.");
  if (needAddress && (!out.street || !out.city || !out.province || !out.postal)) throw bad("Please complete your delivery address.");
  return out;
}

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

function createOrder(body, user) {
  const type = ["order", "quote", "contact"].includes(body.type) ? body.type : "order";
  const mode = body.mode === "business" ? "business" : "home";
  const customer = cleanCustomer(body.customer, type === "order");
  const message = str(body.message, 4000);
  const lines = cleanLines(body.lines);

  if (type === "contact" && !message) throw bad("Please tell us how we can help.");
  if (type === "order" && !lines.length) throw bad("Your cart is empty.");

  // Validate products & quantities against the live catalogue (server is the source of truth).
  const items = [];
  for (const l of lines) {
    const p = getProduct(l.id);
    if (!p || !p.active) throw bad(`A product in your cart is no longer available (${l.id}).`);
    if (l.kind === "case" && l.qty < p.moq) throw bad(`${p.name}: the minimum order is ${p.moq} case(s).`);
    const units = P.lineUnits(p, l);
    if (type === "order" && units > p.stockUnits) throw new HttpError(409, `Sorry, we only have ${p.stockUnits} units of ${p.name} in stock.`);
    const unitEx = l.kind === "case" ? P.unitPrice(p, l.qty) : P.retailEx(p);
    items.push({ p, l, units, unitEx, lineEx: P.lineEx(p, l) });   // stored at full precision, rounded for display
  }
  const t = P.totals(lines, (id) => items.find((i) => i.p.id === id)?.p);

  let payMethod = "", status = type === "order" ? "pending_payment" : "new", payStatus = "unpaid";
  if (type === "order") {
    payMethod = str(body.payMethod, 30);
    const m = payments.methods[payMethod];
    if (!m || !m.enabled() || (m.allowed && !m.allowed(user))) throw bad("Please choose an available payment method.");
    if (payMethod === "account") { status = "processing"; payStatus = "on_account"; }
  }

  const ref = newRef(type === "order" ? "MPM" : type === "quote" ? "Q" : "C");
  const order = tx(() => {
    if (type === "order") {
      const dec = db.prepare("UPDATE products SET stock_units = stock_units - ?, updated_at = datetime('now') WHERE id = ? AND stock_units >= ?");
      for (const i of items) {
        if (dec.run(i.units, i.p.id, i.units).changes !== 1) throw new HttpError(409, `Sorry, ${i.p.name} just sold out. Please update your cart.`);
      }
    }
    const info = db.prepare(`INSERT INTO orders (ref,type,user_id,mode,status,payment_method,payment_status,subtotal,delivery,vat,total,saving,customer,message)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ref, type, user ? user.id : null, mode, status, payMethod, payStatus,
      r2(t.sub), r2(t.delivery), r2(t.vat), r2(t.total), r2(t.saving), JSON.stringify(customer), message);
    const ins = db.prepare("INSERT INTO order_items (order_id,product_id,name,sku,kind,qty,units,unit_price_ex,line_ex) VALUES (?,?,?,?,?,?,?,?,?)");
    items.forEach((i) => ins.run(info.lastInsertRowid, i.p.id, i.p.name, i.p.sku, i.l.kind, i.l.qty, i.units, i.unitEx, i.lineEx));
    return { id: Number(info.lastInsertRowid), ref, type, status, total: r2(t.total) };
  });

  notify("order.created", { ...order, customer });
  const payment = type === "order" ? payments.methods[payMethod].start(order, { user }) : { type: "none" };
  return {
    ref, type, status,
    totals: { sub: r2(t.sub), delivery: r2(t.delivery), vat: r2(t.vat), total: r2(t.total), saving: r2(t.saving) },
    items: items.map((i) => ({ name: i.p.name, kind: i.l.kind, qty: i.l.qty, units: i.units, lineEx: r2(i.lineEx), lineInc: r2(i.lineEx * (1 + P.VAT_RATE)) })),
    payment,
  };
}

function orderDetail(o) {
  return {
    id: o.id, ref: o.ref, type: o.type, mode: o.mode, status: o.status, paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    paymentRef: o.payment_ref, subtotal: o.subtotal, delivery: o.delivery, vat: o.vat, total: o.total, saving: o.saving,
    customer: safeJson(o.customer, {}), message: o.message, adminNotes: o.admin_notes, createdAt: o.created_at, updatedAt: o.updated_at,
    items: db.prepare("SELECT product_id AS id, name, sku, kind, qty, units, unit_price_ex AS unitEx, line_ex AS lineEx FROM order_items WHERE order_id = ?").all(o.id)
      .map((i) => ({ ...i, unitEx: r2(i.unitEx), lineInc: r2(i.lineEx * (1 + P.VAT_RATE)), lineEx: r2(i.lineEx) })),
  };
}

/* ----------------------------------------------------------------- routes */
const routes = [];
const route = (method, pattern, handler, opts = {}) => {
  const keys = []; const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
  routes.push({ method, re, keys, handler, opts });
};
const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, "Please sign in."); return ctx.user; };
const requireAdmin = (ctx) => { const u = requireUser(ctx); if (u.role !== "admin") throw new HttpError(403, "Admins only."); return u; };

// --- public
route("GET", "/api/catalog", (ctx) => catalog(ctx.user));

route("POST", "/api/auth/register", (ctx) => {
  rateLimit(ctx.req, "register", 10, 15 * 60e3);
  const b = ctx.body;
  const email = str(b.email, 160).toLowerCase(), name = str(b.name, 120), pw = String(b.password || "");
  if (!name) throw bad("Please enter your name.");
  if (!isEmail(email)) throw bad("Please enter a valid email address.");
  if (pw.length < 8) throw bad("Your password needs at least 8 characters.");
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new HttpError(409, "An account with that email already exists. Try signing in.");
  const info = db.prepare("INSERT INTO users (email,name,phone,password_hash,account_type) VALUES (?,?,?,?,?)")
    .run(email, name, str(b.phone, 40), auth.hashPassword(pw), b.accountType === "business" ? "business" : "home");
  auth.createSession(ctx.res, ctx.req, info.lastInsertRowid);
  return { user: auth.publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid)) };
});

route("POST", "/api/auth/login", (ctx) => {
  rateLimit(ctx.req, "login", 10, 15 * 60e3);
  const email = str(ctx.body.email, 160).toLowerCase(), pw = String(ctx.body.password || "");
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!u || !auth.verifyPassword(pw, u.password_hash)) throw new HttpError(401, "That email and password don't match.");
  auth.createSession(ctx.res, ctx.req, u.id);
  return { user: auth.publicUser(u) };
});

route("POST", "/api/auth/logout", (ctx) => { auth.destroySession(ctx.req, ctx.res); return { ok: true }; });

route("GET", "/api/me", (ctx) => {
  if (!ctx.user) return { user: null };
  const orders = db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50").all(ctx.user.id).map(orderDetail);
  return { user: auth.publicUser(ctx.user), orders };
});

route("PATCH", "/api/me", (ctx) => {
  const u = requireUser(ctx), b = ctx.body;
  const name = str(b.name, 120) || u.name;
  db.prepare("UPDATE users SET name=?, phone=?, business_name=?, vat_number=? WHERE id=?").run(name, str(b.phone, 40), str(b.businessName, 160), str(b.vatNumber, 40), u.id);
  if (b.newPassword) {
    if (!auth.verifyPassword(String(b.currentPassword || ""), u.password_hash)) throw bad("Your current password is incorrect.");
    if (String(b.newPassword).length < 8) throw bad("Your new password needs at least 8 characters.");
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(auth.hashPassword(String(b.newPassword)), u.id);
  }
  return { user: auth.publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(u.id)) };
});

route("POST", "/api/orders", (ctx) => { rateLimit(ctx.req, "orders", 30, 10 * 60e3); return createOrder(ctx.body, ctx.user); });

route("POST", "/api/trade-applications", (ctx) => {
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
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(app.email)) throw new HttpError(409, "An account with that email already exists. Sign in first, then apply.");
    if (pw.length < 8) throw bad("Choose a password of at least 8 characters for your account.");
    const info = db.prepare("INSERT INTO users (email,name,phone,password_hash,account_type,business_name,vat_number) VALUES (?,?,?,?,?,?,?)")
      .run(app.email, app.contact, app.phone, auth.hashPassword(pw), "business", app.business_name, app.vat_number);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(info.lastInsertRowid);
    auth.createSession(ctx.res, ctx.req, user.id);
  }
  db.prepare("UPDATE users SET account_type='business', business_name=?, vat_number=?, trade_status=CASE WHEN trade_status='approved' THEN 'approved' ELSE 'pending' END WHERE id=?")
    .run(app.business_name, app.vat_number, user.id);
  db.prepare(`INSERT INTO trade_applications (user_id,business_name,business_type,contact,phone,email,cipc,vat_number,monthly_spend,wants_terms)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(user.id, app.business_name, app.business_type, app.contact, app.phone, app.email, app.cipc, app.vat_number, app.monthly_spend, app.wants_terms);
  notify("trade.applied", app);
  return { ok: true, user: auth.publicUser(db.prepare("SELECT * FROM users WHERE id = ?").get(user.id)) };
});

route("POST", "/api/subscribe", (ctx) => {
  rateLimit(ctx.req, "subscribe", 10, 10 * 60e3);
  const email = str(ctx.body.email, 160).toLowerCase();
  if (!isEmail(email)) throw bad("Please enter a valid email address.");
  db.prepare("INSERT OR IGNORE INTO subscribers (email) VALUES (?)").run(email);
  return { ok: true };
});

// Payment gateway callbacks (ITN / webhooks) land here once a connector is added.
route("POST", "/api/payments/:method/notify", (ctx) => {
  const m = payments.methods[ctx.params.method];
  if (!m || typeof m.notify !== "function") throw new HttpError(404, "Unknown payment method");
  return m.notify(ctx.req, ctx.body) || { ok: true };
}, { csrf: false });

// --- admin
route("GET", "/api/admin/summary", (ctx) => {
  requireAdmin(ctx);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  return {
    ordersToday: one("SELECT COUNT(*) n FROM orders WHERE type='order' AND date(created_at)=date('now')").n,
    revenue30: one("SELECT COALESCE(SUM(total),0) s FROM orders WHERE type='order' AND status!='cancelled' AND created_at >= datetime('now','-30 days')").s,
    awaitingPayment: one("SELECT COUNT(*) n FROM orders WHERE status='pending_payment'").n,
    toFulfil: one("SELECT COUNT(*) n FROM orders WHERE status IN ('paid','processing')").n,
    newMessages: one("SELECT COUNT(*) n FROM orders WHERE type IN ('quote','contact') AND status='new'").n,
    pendingTrade: one("SELECT COUNT(*) n FROM trade_applications WHERE status='pending'").n,
    lowStock: db.prepare("SELECT id,name,stock_units,pack FROM products WHERE active=1 AND stock_units <= pack*10 ORDER BY stock_units LIMIT 10").all(),
    customers: one("SELECT COUNT(*) n FROM users WHERE role='customer'").n,
    subscribers: one("SELECT COUNT(*) n FROM subscribers").n,
    recent: db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 8").all().map(orderDetail),
  };
});

route("GET", "/api/admin/orders", (ctx) => {
  requireAdmin(ctx);
  const type = str(ctx.query.get("type"), 20), status = str(ctx.query.get("status"), 30), q = str(ctx.query.get("q"), 80);
  let sql = "SELECT * FROM orders WHERE 1=1"; const a = [];
  if (type) { sql += " AND type = ?"; a.push(type); }
  if (status) { sql += " AND status = ?"; a.push(status); }
  if (q) { sql += " AND (ref LIKE ? OR customer LIKE ?)"; a.push(`%${q}%`, `%${q}%`); }
  sql += " ORDER BY id DESC LIMIT 300";
  return { orders: db.prepare(sql).all(...a).map(orderDetail) };
});

const ORDER_STATUSES = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "new", "replied", "closed"];
route("PATCH", "/api/admin/orders/:id", (ctx) => {
  requireAdmin(ctx);
  const o = db.prepare("SELECT * FROM orders WHERE id = ?").get(int(ctx.params.id));
  if (!o) throw new HttpError(404, "Order not found");
  const b = ctx.body;
  const status = b.status && ORDER_STATUSES.includes(b.status) ? b.status : o.status;
  const payStatus = ["unpaid", "paid", "on_account", "refunded"].includes(b.paymentStatus) ? b.paymentStatus : o.payment_status;
  tx(() => {
    // Return stock if an order is cancelled; take it again if it is un-cancelled.
    if (o.type === "order" && status !== o.status && (status === "cancelled" || o.status === "cancelled")) {
      const sign = status === "cancelled" ? 1 : -1;
      for (const it of db.prepare("SELECT product_id, units FROM order_items WHERE order_id = ?").all(o.id))
        db.prepare("UPDATE products SET stock_units = stock_units + ? WHERE id = ?").run(sign * it.units, it.product_id);
    }
    db.prepare("UPDATE orders SET status=?, payment_status=?, admin_notes=?, updated_at=datetime('now') WHERE id=?")
      .run(status, payStatus, b.adminNotes !== undefined ? str(b.adminNotes, 2000) : o.admin_notes, o.id);
  });
  if (status !== o.status) notify("order.status", { ref: o.ref, status });
  return { order: orderDetail(db.prepare("SELECT * FROM orders WHERE id = ?").get(o.id)) };
});

route("GET", "/api/admin/products", (ctx) => {
  requireAdmin(ctx);
  return { products: db.prepare("SELECT * FROM products ORDER BY sort, name").all().map(rowToProduct), categories: db.prepare("SELECT * FROM categories ORDER BY sort").all() };
});

function productFields(b, existing = {}) {
  const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
  const f = {
    name: b.name !== undefined ? str(b.name, 160) : existing.name,
    cat: b.cat !== undefined ? str(b.cat, 40) : existing.cat,
    sku: b.sku !== undefined ? str(b.sku, 60) : existing.sku,
    supplier: b.supplier !== undefined ? str(b.supplier, 120) : existing.supplier,
    pack: int(num(b.pack, existing.pack)), moq: int(num(b.moq, existing.moq)),
    price: num(b.price, existing.price), rrp: num(b.rrp, existing.rrp),
    stock_units: int(num(b.stockUnits, existing.stockUnits ?? 0)),
    badge: b.badge !== undefined ? str(b.badge, 30) : existing.badge,
    description: b.desc !== undefined ? str(b.desc, 3000) : existing.desc,
    icon: b.icon !== undefined ? str(b.icon, 30) : existing.icon || "box",
    active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active === false ? 0 : 1,
    specs: b.specs !== undefined && typeof b.specs === "object" ? JSON.stringify(b.specs) : JSON.stringify(existing.specs || {}),
  };
  if (!f.name || !f.sku) throw bad("Name and SKU are required.");
  if (!db.prepare("SELECT 1 FROM categories WHERE id = ?").get(f.cat)) throw bad("Unknown category.");
  if (!(f.pack > 0) || !(f.moq > 0)) throw bad("Pack size and MOQ must be at least 1.");
  if (!(f.price >= 0) || !(f.rrp >= 0) || !Number.isFinite(f.price) || !Number.isFinite(f.rrp)) throw bad("Prices must be valid numbers.");
  if (!Number.isFinite(f.stock_units)) throw bad("Stock must be a whole number.");
  return f;
}

route("POST", "/api/admin/products", (ctx) => {
  requireAdmin(ctx);
  const f = productFields(ctx.body);
  const id = (str(ctx.body.id, 60) || f.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  if (!id || db.prepare("SELECT 1 FROM products WHERE id = ?").get(id)) throw bad("A product with that ID already exists.");
  try {
    db.prepare(`INSERT INTO products (id,name,cat,icon,sku,supplier,pack,moq,price,rrp,stock_units,badge,description,specs,active,sort)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM products))`)
      .run(id, f.name, f.cat, f.icon, f.sku, f.supplier, f.pack, f.moq, f.price, f.rrp, f.stock_units, f.badge, f.description, f.specs, f.active);
  } catch (e) { if (/UNIQUE/.test(e.message)) throw bad("That SKU is already in use."); throw e; }
  return { product: getProduct(id) };
});

route("PATCH", "/api/admin/products/:id", (ctx) => {
  requireAdmin(ctx);
  const existing = getProduct(ctx.params.id);
  if (!existing) throw new HttpError(404, "Product not found");
  const f = productFields(ctx.body, existing);
  try {
    db.prepare(`UPDATE products SET name=?,cat=?,icon=?,sku=?,supplier=?,pack=?,moq=?,price=?,rrp=?,stock_units=?,badge=?,description=?,specs=?,active=?,updated_at=datetime('now') WHERE id=?`)
      .run(f.name, f.cat, f.icon, f.sku, f.supplier, f.pack, f.moq, f.price, f.rrp, f.stock_units, f.badge, f.description, f.specs, f.active, existing.id);
  } catch (e) { if (/UNIQUE/.test(e.message)) throw bad("That SKU is already in use."); throw e; }
  return { product: getProduct(existing.id) };
});

route("POST", "/api/admin/products/:id/image", (ctx) => {
  requireAdmin(ctx);
  const p = getProduct(ctx.params.id);
  if (!p) throw new HttpError(404, "Product not found");
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.dataUrl || ""));
  if (!m) throw bad("Please upload a JPG, PNG or WebP image.");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 4 * 1024 * 1024) throw bad("Images must be under 4 MB.");
  const magic = { jpeg: [0xff, 0xd8], png: [0x89, 0x50], webp: [0x52, 0x49] }[m[1]];
  if (buf[0] !== magic[0] || buf[1] !== magic[1]) throw bad("That file doesn't look like a valid image.");
  const name = `${p.id}-${Date.now()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, "products", name), buf);
  db.prepare("UPDATE products SET image=?, updated_at=datetime('now') WHERE id=?").run(`/uploads/products/${name}`, p.id);
  return { product: getProduct(p.id) };
}, { limit: 6 * 1024 * 1024 });

route("GET", "/api/admin/trade", (ctx) => {
  requireAdmin(ctx);
  return { applications: db.prepare("SELECT * FROM trade_applications ORDER BY id DESC LIMIT 300").all() };
});

route("PATCH", "/api/admin/trade/:id", (ctx) => {
  requireAdmin(ctx);
  const a = db.prepare("SELECT * FROM trade_applications WHERE id = ?").get(int(ctx.params.id));
  if (!a) throw new HttpError(404, "Application not found");
  const status = ["pending", "approved", "rejected"].includes(ctx.body.status) ? ctx.body.status : a.status;
  tx(() => {
    db.prepare("UPDATE trade_applications SET status=? WHERE id=?").run(status, a.id);
    if (a.user_id) db.prepare("UPDATE users SET trade_status=? WHERE id=?").run(status, a.user_id);
  });
  return { ok: true };
});

route("GET", "/api/admin/customers", (ctx) => {
  requireAdmin(ctx);
  return {
    customers: db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.type='order') AS order_count,
      (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id=u.id AND o.type='order' AND o.status!='cancelled') AS spent
      FROM users u WHERE role='customer' ORDER BY u.id DESC LIMIT 500`).all()
      .map((u) => ({ ...auth.publicUser(u), orderCount: u.order_count, spent: u.spent })),
    subscribers: db.prepare("SELECT * FROM subscribers ORDER BY created_at DESC").all(),
  };
});

/* ------------------------------------------------------------ static files */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8" };

function serveStatic(req, res, pathname) {
  let base = PUBLIC_DIR, rel = pathname;
  if (pathname.startsWith("/uploads/")) { base = UPLOAD_DIR; rel = pathname.slice("/uploads".length); }
  if (rel === "/" ) rel = "/index.html";
  if (rel === "/admin" || rel === "/admin/") rel = "/admin.html";
  const file = path.normalize(path.join(base, decodeURIComponent(rel)));
  if (!file.startsWith(base + path.sep)) return send(res, 403, "Forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, "Not found");
    const ext = path.extname(file).toLowerCase();
    const longCache = /\/(img|uploads)\//.test(file.replace(/\\/g, "/"));
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[ext] || "application/octet-stream", "Content-Length": st.size,
      "Cache-Control": ext === ".html" ? "no-cache" : longCache ? "public, max-age=604800" : "public, max-age=300" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ------------------------------------------------------------------ server */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;
  try {
    if (pathname.startsWith("/api/")) {
      const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
      if (!r) throw new HttpError(404, "Not found");
      // CSRF guard: mutating requests must come from our own JS (custom header can't be sent cross-site without CORS).
      if (req.method !== "GET" && r.opts.csrf !== false && req.headers["x-requested-with"] !== "mpm") throw new HttpError(403, "Forbidden");
      const m = r.re.exec(pathname); const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const body = req.method === "GET" ? {} : await readBody(req, r.opts.limit || 200 * 1024);
      const ctx = { req, res, params, query: url.searchParams, body, user: auth.currentUser(req) };
      const out = await r.handler(ctx);
      return send(res, 200, out ?? { ok: true });
    }
    if (pathname.startsWith("/pay/")) return send(res, 501, "Online payment is not connected yet. Please contact us to complete payment.");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    return serveStatic(req, res, pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    return send(res, status, { error: status === 500 ? "Something went wrong on our side. Please try again." : e.message });
  }
});

server.listen(PORT, () => console.log(`MPM Digital running on http://localhost:${PORT}  (admin: /admin)`));
