// Shared building blocks for the store API and the admin API.
"use strict";
const crypto = require("node:crypto");
const { db } = require("./db");
const P = require("../public/assets/js/pricing.js");

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const int = (v) => Number.parseInt(v, 10);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const r2 = P.round2;
function safeJson(s, d) { try { return JSON.parse(s); } catch { return d; } }

// small in-memory rate limiter (per instance; slows down guessing and abuse)
const hits = new Map();
function rateLimit(req, bucket, max, windowMs) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const key = bucket + ":" + ip, now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  if (arr.length > max) throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
}

/* ---- router -------------------------------------------------------------- */
function createRouter() {
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    routes.push({ method, re, keys, handler, opts });
  };
  return { routes, route };
}

/* ---- products & orders ---------------------------------------------------- */
const stockState = (r) => (r.stock_units <= 0 ? "out" : r.stock_units <= r.pack * 10 ? "low" : "in");
const rowToProduct = (r) => ({
  id: r.id, name: r.name, cat: r.cat, icon: r.icon, sku: r.sku, supplier: r.supplier, pack: r.pack, moq: r.moq,
  price: r.price, rrp: r.rrp, cost: r.cost || 0, badge: r.badge, desc: r.description, specs: safeJson(r.specs, {}), image: r.image,
  stockUnits: r.stock_units, stock: stockState(r), active: !!r.active, sort: r.sort, updatedAt: r.updated_at,
});
const getProduct = async (id, q = db) => { const r = await q.get("SELECT * FROM products WHERE id = ?", id); return r ? rowToProduct(r) : null; };

// Wholesale (case) pricing is only for approved trade accounts and admins.
const isTrade = (u) => !!u && (u.role === "admin" || u.trade_status === "approved");

async function orderDetail(o) {
  const items = (await db.all(`SELECT i.product_id AS id, i.name, i.sku, i.kind, i.qty, i.units, i.unit_price_ex AS unitEx, i.line_ex AS lineEx,
      CASE WHEN i.unit_cost > 0 THEN i.unit_cost ELSE COALESCE(p.cost, 0) END AS unitCost
      FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ?`, o.id))
    .map((i) => ({ ...i, unitEx: r2(i.unitEx), lineInc: r2(i.lineEx * (1 + P.VAT_RATE)), lineEx: r2(i.lineEx), unitCost: r2(i.unitCost || 0) }));
  return {
    id: o.id, ref: o.ref, type: o.type, mode: o.mode, status: o.status, paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    paymentRef: o.payment_ref, subtotal: o.subtotal, discount: o.discount || 0, discountCode: o.discount_code || "", delivery: o.delivery,
    deliveryMethod: o.delivery_method || "courier", vat: o.vat, total: o.total, saving: o.saving,
    customer: safeJson(o.customer, {}), message: o.message, adminNotes: o.admin_notes, createdAt: o.created_at, updatedAt: o.updated_at, items,
  };
}
const details = (rows) => Promise.all(rows.map(orderDetail));

/** Record a stock change (and keep a running balance). Call inside the same transaction as the change. */
async function logStock(q, productId, change, reason, { ref = "", note = "", by = "" } = {}) {
  if (!change) return;
  const row = await q.get("SELECT stock_units FROM products WHERE id = ?", productId);
  await q.run("INSERT INTO stock_movements (product_id, change, balance, reason, ref, note, by_user) VALUES (?,?,?,?,?,?,?)",
    productId, change, row ? row.stock_units : 0, reason, str(ref, 60), str(note, 200), str(by, 160));
}

/* ---- discount codes --------------------------------------------------------- */
const saToday = () => new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);

/**
 * Check a discount code against a cart. Returns { ok, discountEx, code, message }.
 * subEx = goods subtotal excl. VAT; hasCase = cart contains wholesale cases.
 */
async function evaluateDiscount(code, subEx, hasCase) {
  code = str(code, 40).toUpperCase();
  if (!code) return { ok: false, discountEx: 0, code: "" };
  const d = await db.get("SELECT * FROM discounts WHERE code = ?", code);
  const no = (message) => ({ ok: false, discountEx: 0, code, message });
  if (!d || !d.active) return no("That discount code isn't valid.");
  const today = saToday();
  if (d.starts_at && today < d.starts_at) return no("That discount code isn't active yet.");
  if (d.ends_at && today > d.ends_at) return no("That discount code has expired.");
  if (d.max_uses > 0 && d.uses >= d.max_uses) return no("That discount code has been fully used.");
  if (d.applies_to === "trade" && !hasCase) return no("That code is for trade (by the case) orders only.");
  if (d.applies_to === "home" && hasCase) return no("That code is for home orders only.");
  const subInc = subEx * (1 + P.VAT_RATE);
  if (d.min_spend > 0 && subInc + 0.005 < d.min_spend) return no(`Spend R${d.min_spend.toFixed(2)} or more to use this code.`);
  let discountEx = d.type === "percent" ? subEx * Math.min(100, Math.max(0, d.value)) / 100 : d.value / (1 + P.VAT_RATE);
  discountEx = Math.min(subEx, Math.max(0, discountEx));
  const label = d.type === "percent" ? `${+d.value}% off` : `R${(+d.value).toFixed(2)} off`;
  return { ok: true, discountEx, code: d.code, id: d.id, label, message: `${d.code} applied: ${label}` };
}

const newRef = async (prefix) => {
  const d = new Date(), ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  for (;;) {
    const ref = `${prefix}-${ymd}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    if (!(await db.get("SELECT 1 AS x FROM orders WHERE ref = ?", ref))) return ref;
  }
};

module.exports = {
  HttpError, bad, str, int, isEmail, r2, safeJson, rateLimit, createRouter,
  rowToProduct, getProduct, isTrade, orderDetail, details, logStock, evaluateDiscount, newRef, saToday, P,
};
