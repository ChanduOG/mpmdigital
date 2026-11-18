// Password hashing (scrypt) and cookie sessions.
"use strict";
const crypto = require("node:crypto");
const { db } = require("./db");

const SESSION_DAYS = 30;
const COOKIE = "mpm_sid";

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored).split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* bad cookie */ } }
  });
  return out;
}
const isSecure = (req) => process.env.COOKIE_SECURE === "1" || req.headers["x-forwarded-proto"] === "https";

async function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await db.run("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)", token, userId, expires);
  await db.run("DELETE FROM sessions WHERE expires_at < ?", Date.now()); // tidy up old sessions
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isSecure(req) ? "; Secure" : ""}`);
}
async function destroySession(req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) await db.run("DELETE FROM sessions WHERE token = ?", t);
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? "; Secure" : ""}`);
}
async function currentUser(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t) return null;
  const row = await db.get("SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?", t);
  if (!row) return null;
  if (row.expires_at < Date.now()) { await db.run("DELETE FROM sessions WHERE token = ?", t); return null; }
  return row;
}
const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, accountType: u.account_type,
  businessName: u.business_name, vatNumber: u.vat_number, tradeStatus: u.trade_status, createdAt: u.created_at,
});

// Make sure an admin exists, using ADMIN_EMAIL / ADMIN_PASSWORD from the environment.
async function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || "").trim();
  const pw = process.env.ADMIN_PASSWORD || "";
  const has = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  if (has.n) return;
  if (!email || pw.length < 10) {
    console.warn("[auth] No admin account yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ chars) and restart/redeploy.");
    return;
  }
  const existing = await db.get("SELECT id FROM users WHERE email = ?", email);
  if (existing) await db.run("UPDATE users SET role='admin', password_hash=? WHERE id=?", hashPassword(pw), existing.id);
  else await db.run("INSERT OR IGNORE INTO users (email, name, password_hash, role, account_type) VALUES (?,?,?,?,?)", email, "Store admin", hashPassword(pw), "admin", "business");
  console.log(`[auth] admin account ready for ${email}`);
}

module.exports = { hashPassword, verifyPassword, createSession, destroySession, currentUser, publicUser, ensureAdmin };
