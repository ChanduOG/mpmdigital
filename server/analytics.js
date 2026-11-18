// First-party, privacy-friendly traffic analytics (POPIA-friendly):
//  • no cookies, no third-party scripts
//  • no IP addresses stored — visitors are counted with a hash of (secret salt + day + IP + browser)
//    that changes every day, so nobody can be tracked across days
//  • bots are ignored; admins are not counted
"use strict";
const crypto = require("node:crypto");
const { db } = require("./db");
const { analyticsSalt } = require("./settings");

const BOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|axios|node-fetch|vercel/i;
const TYPES = new Set(["pageview", "add_to_cart", "checkout", "order"]);

// Day in South African time (UTC+2) so "today" matches the shop's day.
const saDay = (d = new Date()) => new Date(d.getTime() + 2 * 3600e3).toISOString().slice(0, 10);

function device(ua) {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/mobi|iphone|android/i.test(ua)) return "mobile";
  return "desktop";
}

function refDomain(ref, host) {
  try {
    const u = new URL(ref);
    const h = u.hostname.replace(/^www\./, "");
    if (!h || h === String(host || "").replace(/^www\./, "").split(":")[0]) return "";
    return h.slice(0, 80);
  } catch { return ""; }
}

async function visitorId(req) {
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const ua = String(req.headers["user-agent"] || "");
  const salt = await analyticsSalt();
  return crypto.createHash("sha256").update(`${salt}|${saDay()}|${ip}|${ua}`).digest("base64url").slice(0, 16);
}

/** Record an event. Never throws (analytics must not break the shop). */
async function record(req, { type, path = "", productId = "", referrer = "", mode = "" }, user) {
  try {
    if (!TYPES.has(type)) return;
    const ua = String(req.headers["user-agent"] || "");
    if (!ua || BOT.test(ua)) return;
    if (user && user.role === "admin") return;
    const country = String(req.headers["x-vercel-ip-country"] || req.headers["cf-ipcountry"] || "").slice(0, 2).toUpperCase();
    await db.run(
      "INSERT INTO events (day, type, path, product_id, visitor, referrer, device, country, mode) VALUES (?,?,?,?,?,?,?,?,?)",
      saDay(), type, String(path).slice(0, 120), String(productId).slice(0, 80), await visitorId(req),
      refDomain(referrer, req.headers.host), device(ua), country, mode === "business" ? "business" : mode ? "home" : "",
    );
    // keep ~13 months of raw events
    if (Math.random() < 0.01) await db.run("DELETE FROM events WHERE day < ?", saDay(new Date(Date.now() - 400 * 864e5)));
  } catch (e) { console.warn("[analytics]", e.message); }
}

/** Build the analytics report for the admin dashboard. */
async function report(days) {
  const today = saDay();
  const from = saDay(new Date(Date.now() - (days - 1) * 864e5));
  const prevFrom = saDay(new Date(Date.now() - (2 * days - 1) * 864e5));
  const prevTo = saDay(new Date(Date.now() - days * 864e5));
  const all = (sql, ...a) => db.all(sql, ...a);
  const one = async (sql, ...a) => (await db.get(sql, ...a)) || {};

  // daily series (fill gaps with zeros)
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) dayList.push(saDay(new Date(Date.now() - i * 864e5)));
  const traffic = await all(`SELECT day, COUNT(DISTINCT visitor) AS visitors, SUM(type='pageview') AS pageviews
    FROM events WHERE day >= ? GROUP BY day`, from);
  const sales = await all(`SELECT date(created_at, '+2 hours') AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue,
      COALESCE(SUM(CASE WHEN mode='business' THEN total ELSE 0 END),0) AS revenueBiz,
      COALESCE(SUM(CASE WHEN mode!='business' THEN total ELSE 0 END),0) AS revenueHome
    FROM orders WHERE type='order' AND status!='cancelled' AND date(created_at, '+2 hours') >= ? GROUP BY 1`, from);
  const tMap = Object.fromEntries(traffic.map((r) => [r.day, r]));
  const sMap = Object.fromEntries(sales.map((r) => [r.day, r]));
  const series = dayList.map((d) => ({
    day: d, visitors: tMap[d]?.visitors || 0, pageviews: tMap[d]?.pageviews || 0,
    orders: sMap[d]?.orders || 0, revenue: sMap[d]?.revenue || 0, revenueHome: sMap[d]?.revenueHome || 0, revenueBiz: sMap[d]?.revenueBiz || 0,
  }));

  const period = async (a, b) => {
    const t = await one("SELECT COUNT(DISTINCT visitor || day) AS visitors, SUM(type='pageview') AS pageviews FROM events WHERE day BETWEEN ? AND ?", a, b);
    const s = await one(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders
      WHERE type='order' AND status!='cancelled' AND date(created_at, '+2 hours') BETWEEN ? AND ?`, a, b);
    const buyers = await one("SELECT COUNT(DISTINCT visitor || day) AS n FROM events WHERE type='order' AND day BETWEEN ? AND ?", a, b);
    const visitors = t.visitors || 0, orders = s.orders || 0, revenue = s.revenue || 0;
    return { visitors, pageviews: t.pageviews || 0, orders, revenue, aov: orders ? revenue / orders : 0, conversion: visitors ? (buyers.n || 0) / visitors : 0 };
  };
  const current = await period(from, today);
  const previous = await period(prevFrom, prevTo);

  // funnel: distinct visitor-days reaching each step
  const step = async (cond) => (await one(`SELECT COUNT(DISTINCT visitor || day) AS n FROM events WHERE day >= ? AND ${cond}`, from)).n || 0;
  const funnel = [
    { step: "Visited the shop", n: await step("type='pageview'") },
    { step: "Viewed a product", n: await step("type='pageview' AND path LIKE '/product/%'") },
    { step: "Added to cart", n: await step("type='add_to_cart'") },
    { step: "Started checkout", n: await step("type='checkout'") },
    { step: "Placed an order", n: await step("type='order'") },
  ];

  const topPages = await all(`SELECT CASE WHEN path IN ('', '/home') THEN '/' ELSE path END AS path, COUNT(*) AS views, COUNT(DISTINCT visitor || day) AS visitors FROM events
    WHERE type='pageview' AND day >= ? GROUP BY 1 ORDER BY views DESC LIMIT 10`, from);
  const topViewed = await all(`SELECT e.product_id AS id, p.name, COUNT(*) AS views FROM events e LEFT JOIN products p ON p.id = e.product_id
    WHERE e.type='pageview' AND e.product_id != '' AND e.day >= ? GROUP BY e.product_id ORDER BY views DESC LIMIT 10`, from);
  const topCarted = await all(`SELECT e.product_id AS id, p.name, COUNT(*) AS adds FROM events e LEFT JOIN products p ON p.id = e.product_id
    WHERE e.type='add_to_cart' AND e.day >= ? GROUP BY e.product_id ORDER BY adds DESC LIMIT 10`, from);
  // each visit counted once, under the site that sent it (if any)
  const referrers = await all(`SELECT CASE WHEN r='' THEN 'Direct / unknown' ELSE r END AS source, COUNT(*) AS visitors
    FROM (SELECT visitor, day, MAX(referrer) AS r FROM events WHERE type='pageview' AND day >= ? GROUP BY visitor, day)
    GROUP BY 1 ORDER BY visitors DESC LIMIT 10`, from);
  const devices = await all(`SELECT device AS label, COUNT(DISTINCT visitor || day) AS visitors FROM events WHERE type='pageview' AND day >= ? GROUP BY device ORDER BY visitors DESC`, from);
  const countries = await all(`SELECT CASE WHEN country='' THEN '??' ELSE country END AS label, COUNT(DISTINCT visitor || day) AS visitors FROM events
    WHERE type='pageview' AND day >= ? GROUP BY 1 ORDER BY visitors DESC LIMIT 10`, from);
  const modes = await all(`SELECT mode AS label, COUNT(DISTINCT visitor || day) AS visitors FROM events WHERE type='pageview' AND mode != '' AND day >= ? GROUP BY mode`, from);

  // sales breakdowns
  const topProducts = await all(`SELECT i.product_id AS id, i.name, SUM(i.units) AS units, SUM(i.line_ex) AS revenueEx FROM order_items i
    JOIN orders o ON o.id = i.order_id WHERE o.type='order' AND o.status!='cancelled' AND date(o.created_at, '+2 hours') >= ?
    GROUP BY i.product_id ORDER BY revenueEx DESC LIMIT 10`, from);
  const byStatus = await all("SELECT status AS label, COUNT(*) AS n FROM orders WHERE type='order' AND date(created_at, '+2 hours') >= ? GROUP BY status", from);
  const byPayment = await all(`SELECT payment_method AS label, COUNT(*) AS n, COALESCE(SUM(total),0) AS revenue FROM orders
    WHERE type='order' AND status!='cancelled' AND date(created_at, '+2 hours') >= ? GROUP BY payment_method`, from);
  const byMode = await all(`SELECT mode AS label, COUNT(*) AS n, COALESCE(SUM(total),0) AS revenue FROM orders
    WHERE type='order' AND status!='cancelled' AND date(created_at, '+2 hours') >= ? GROUP BY mode`, from);

  return { days, from, to: today, series, current, previous, funnel, topPages, topViewed, topCarted, referrers, devices, countries, modes, topProducts, byStatus, byPayment, byMode };
}

module.exports = { record, report, saDay };
