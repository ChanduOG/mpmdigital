// Store settings, editable in Admin → Settings. Saved in the `settings` table as JSON.
// Environment variables act as defaults until something is saved in admin.
"use strict";
const crypto = require("node:crypto");
const { db } = require("./db");
const P = require("../public/assets/js/pricing.js");

const env = (k, d = "") => (process.env[k] || d).trim();

const DEFAULTS = () => ({
  store: { name: "MPM Digital", email: env("STORE_EMAIL", ""), phone: "", whatsapp: "", address: "" },
  bank: {
    name: env("BANK_NAME", ""), accountName: env("BANK_ACCOUNT_NAME", "MPM Digital"),
    accountNumber: env("BANK_ACCOUNT_NUMBER", ""), branchCode: env("BANK_BRANCH_CODE", ""),
  },
  delivery: {
    homeFreeDelivery: P.DEFAULTS.homeFreeDelivery, homeDeliveryFee: P.DEFAULTS.homeDeliveryFee,
    bizFreeDelivery: P.DEFAULTS.bizFreeDelivery, bizDeliveryFee: P.DEFAULTS.bizDeliveryFee,
    collectEnabled: false, collectAddress: "", collectNote: "Ready for collection within 1 business day. We'll WhatsApp you.",
    eta: "2–4 business days in main centres, 3–6 in regional areas",
  },
  tiers: P.DEFAULTS.tiers.map(({ min, off, name }) => ({ min, off, name })),
  payments: { eft: true, account: true },
  announcement: [
    "Free delivery on home orders over R750",
    "Trade accounts: wholesale prices by the case",
    "Dispatch within 48 hours, nationwide",
    "Direct from trusted suppliers",
  ],
});
const KEYS = Object.keys(DEFAULTS());

let cache = null, cachedAt = 0;
const TTL = 20e3; // serverless instances re-read settings every 20s

async function getSettings(force = false) {
  if (!force && cache && Date.now() - cachedAt < TTL) return cache;
  const rows = await db.all("SELECT key, value FROM settings");
  const saved = Object.fromEntries(rows.map((r) => { try { return [r.key, JSON.parse(r.value)]; } catch { return [r.key, null]; } }));
  const d = DEFAULTS();
  const out = {};
  for (const k of KEYS) {
    const v = saved[k];
    out[k] = v == null ? d[k] : Array.isArray(d[k]) ? v : { ...d[k], ...v };
  }
  out.analyticsSalt = saved.analytics_salt || null;
  cache = out; cachedAt = Date.now();
  P.configure({ ...out.delivery, tiers: out.tiers });
  return out;
}

const num = (v, min = 0, max = 1e7) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new Error("bad number"); return n; };
const s = (v, max = 200) => String(v ?? "").trim().slice(0, max);

/** Validate + save a partial settings update from the admin. */
async function saveSettings(patch) {
  const cur = await getSettings(true);
  const next = {};
  if (patch.store) next.store = { name: s(patch.store.name, 80) || "MPM Digital", email: s(patch.store.email, 160), phone: s(patch.store.phone, 40), whatsapp: s(patch.store.whatsapp, 40), address: s(patch.store.address, 300) };
  if (patch.bank) next.bank = { name: s(patch.bank.name, 80), accountName: s(patch.bank.accountName, 120), accountNumber: s(patch.bank.accountNumber, 40), branchCode: s(patch.bank.branchCode, 20) };
  if (patch.delivery) {
    try {
      next.delivery = {
        homeFreeDelivery: num(patch.delivery.homeFreeDelivery), homeDeliveryFee: num(patch.delivery.homeDeliveryFee),
        bizFreeDelivery: num(patch.delivery.bizFreeDelivery), bizDeliveryFee: num(patch.delivery.bizDeliveryFee),
        collectEnabled: !!patch.delivery.collectEnabled, collectAddress: s(patch.delivery.collectAddress, 300),
        collectNote: s(patch.delivery.collectNote, 200), eta: s(patch.delivery.eta, 120),
      };
    } catch { throw Object.assign(new Error("Delivery amounts must be numbers of 0 or more."), { status: 400 }); }
  }
  if (patch.tiers) {
    if (!Array.isArray(patch.tiers) || !patch.tiers.length || patch.tiers.length > 8) throw Object.assign(new Error("Add between 1 and 8 tiers."), { status: 400 });
    try {
      next.tiers = patch.tiers.map((t) => ({ min: Math.round(num(t.min, 1, 100000)), off: num(t.off, 0, 0.9), name: s(t.name, 30) })).sort((a, b) => a.min - b.min);
    } catch { throw Object.assign(new Error("Each tier needs a minimum (1 or more cases) and a discount between 0% and 90%."), { status: 400 }); }
    if (new Set(next.tiers.map((t) => t.min)).size !== next.tiers.length) throw Object.assign(new Error("Two tiers can't start at the same number of cases."), { status: 400 });
    next.tiers[0].min = 1;
  }
  if (patch.payments) next.payments = { eft: !!patch.payments.eft, account: !!patch.payments.account };
  if (patch.announcement) next.announcement = (Array.isArray(patch.announcement) ? patch.announcement : []).map((x) => s(x, 90)).filter(Boolean).slice(0, 6);
  for (const [k, v] of Object.entries(next)) {
    await db.run("INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", k, JSON.stringify(v));
  }
  void cur;
  return getSettings(true);
}

/** Secret salt for anonymous visitor hashes (created once, stored in the DB). */
async function analyticsSalt() {
  const st = await getSettings();
  if (st.analyticsSalt) return st.analyticsSalt;
  const salt = crypto.randomBytes(24).toString("base64url");
  await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('analytics_salt', ?)", JSON.stringify(salt));
  return (await getSettings(true)).analyticsSalt || salt;
}

module.exports = { getSettings, saveSettings, analyticsSalt };
