// Database layer — libSQL (SQLite-compatible).
//   Local:   a file at data/mpm.db (no setup needed)
//   Vercel:  a hosted Turso database (set TURSO_DATABASE_URL + TURSO_AUTH_TOKEN)
// If the site runs on Vercel without a database configured, it starts in
// read-only "preview" mode: the catalogue loads, but orders/sign-ins are refused
// with a clear message instead of silently losing data.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@libsql/client");

const ON_VERCEL = !!process.env.VERCEL;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
// Find the database settings. The Vercel ↔ Turso integration sets TURSO_DATABASE_URL and
// TURSO_AUTH_TOKEN; if a custom prefix was chosen when connecting (e.g. STORE_TURSO_DATABASE_URL),
// we pick that up too.
function findDbEnv() {
  const env = process.env;
  if (env.TURSO_DATABASE_URL) return { url: env.TURSO_DATABASE_URL, token: env.TURSO_AUTH_TOKEN || "" };
  if (env.LIBSQL_URL) return { url: env.LIBSQL_URL, token: env.LIBSQL_AUTH_TOKEN || "" };
  const key = Object.keys(env).find((k) => /DATABASE_URL$/.test(k) && /^(libsql|https?|wss?):\/\//.test(env[k] || "") && /turso|libsql/i.test(k + env[k]));
  if (!key) return { url: "", token: "" };
  const prefix = key.slice(0, -"DATABASE_URL".length);
  return { url: env[key], token: env[prefix + "AUTH_TOKEN"] || "" };
}
const { url: REMOTE_URL, token: AUTH_TOKEN } = findDbEnv();

let url, readOnly = false;
if (REMOTE_URL) url = REMOTE_URL;
else if (ON_VERCEL) { url = ":memory:"; readOnly = true; }
else {
  fs.mkdirSync(path.join(DATA_DIR, "uploads", "products"), { recursive: true });
  url = "file:" + path.join(DATA_DIR, "mpm.db").replace(/\\/g, "/");
}
const isLocalFile = url.startsWith("file:");
const client = createClient(AUTH_TOKEN ? { url, authToken: AUTH_TOKEN } : { url });

const clean = (args) => args.map((a) => (a === undefined ? null : typeof a === "boolean" ? (a ? 1 : 0) : a));
const toObjects = (rs) => rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));

function wrap(exec) {
  return {
    async all(sql, ...args) { return toObjects(await exec({ sql, args: clean(args) })); },
    async get(sql, ...args) { return (await this.all(sql, ...args))[0]; },
    async run(sql, ...args) {
      const r = await exec({ sql, args: clean(args) });
      return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid != null ? Number(r.lastInsertRowid) : null };
    },
  };
}

const db = wrap((s) => client.execute(s));

/** Run fn(tx) inside a write transaction. tx has the same all/get/run API. */
async function tx(fn) {
  const t = await client.transaction("write");
  try {
    const out = await fn(wrap((s) => t.execute(s)));
    await t.commit();
    return out;
  } catch (e) {
    await t.rollback().catch(() => {});
    throw e;
  } finally {
    t.close();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',
  account_type TEXT NOT NULL DEFAULT 'home',
  business_name TEXT DEFAULT '',
  vat_number TEXT DEFAULT '',
  trade_status TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, blurb TEXT DEFAULT '', icon TEXT DEFAULT 'box', tone TEXT DEFAULT 'pink', sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cat TEXT NOT NULL REFERENCES categories(id),
  icon TEXT DEFAULT 'box',
  sku TEXT NOT NULL UNIQUE,
  supplier TEXT DEFAULT '',
  pack INTEGER NOT NULL CHECK (pack > 0),
  moq INTEGER NOT NULL DEFAULT 1 CHECK (moq > 0),
  price REAL NOT NULL CHECK (price >= 0),
  rrp REAL NOT NULL CHECK (rrp >= 0),
  stock_units INTEGER NOT NULL DEFAULT 0,
  badge TEXT DEFAULT '',
  description TEXT DEFAULT '',
  specs TEXT DEFAULT '{}',
  image TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT DEFAULT 'home',
  status TEXT NOT NULL,
  payment_method TEXT DEFAULT '',
  payment_status TEXT DEFAULT 'unpaid',
  payment_ref TEXT DEFAULT '',
  subtotal REAL DEFAULT 0, delivery REAL DEFAULT 0, vat REAL DEFAULT 0, total REAL DEFAULT 0, saving REAL DEFAULT 0,
  customer TEXT NOT NULL DEFAULT '{}',
  message TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  name TEXT NOT NULL, sku TEXT NOT NULL,
  kind TEXT NOT NULL, qty INTEGER NOT NULL, units INTEGER NOT NULL,
  unit_price_ex REAL NOT NULL, line_ex REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS trade_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  business_name TEXT NOT NULL, business_type TEXT DEFAULT '', contact TEXT NOT NULL,
  phone TEXT DEFAULT '', email TEXT NOT NULL, cipc TEXT DEFAULT '', vat_number TEXT DEFAULT '',
  monthly_spend TEXT DEFAULT '', wants_terms INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,                 -- YYYY-MM-DD in South African time
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,                -- pageview | add_to_cart | checkout | order
  path TEXT DEFAULT '',
  product_id TEXT DEFAULT '',
  visitor TEXT NOT NULL,             -- anonymous daily-rotating hash (no cookies, no IP stored)
  referrer TEXT DEFAULT '',          -- referring domain only
  device TEXT DEFAULT '',            -- mobile | tablet | desktop
  country TEXT DEFAULT '',
  mode TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_events_day ON events(day, type);
CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL DEFAULT 'percent',      -- percent | fixed (Rand off, incl. VAT)
  value REAL NOT NULL,
  min_spend REAL NOT NULL DEFAULT 0,         -- incl. VAT, goods only
  applies_to TEXT NOT NULL DEFAULT 'all',    -- all | home | trade
  starts_at TEXT DEFAULT '',                 -- YYYY-MM-DD (optional)
  ends_at TEXT DEFAULT '',                   -- YYYY-MM-DD (optional, inclusive)
  max_uses INTEGER NOT NULL DEFAULT 0,       -- 0 = unlimited
  uses INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  change INTEGER NOT NULL,                   -- units (+ in, - out)
  balance INTEGER NOT NULL,                  -- stock after the change
  reason TEXT NOT NULL,                      -- sale | cancel | restock | adjust | damaged | count | edit | new
  ref TEXT DEFAULT '',                       -- order ref, supplier invoice, etc.
  note TEXT DEFAULT '',
  by_user TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_moves_product ON stock_movements(product_id, id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
`;

async function seed() {
  const row = await db.get("SELECT COUNT(*) AS n FROM products");
  if (row && row.n > 0) return;
  const { categories, products } = require("./seed/catalog.json");
  await tx(async (t) => {
    for (const c of categories)
      await t.run("INSERT OR IGNORE INTO categories (id,name,blurb,icon,tone,sort) VALUES (?,?,?,?,?,?)", c.id, c.name, c.blurb, c.icon, c.tone, c.sort);
    for (const p of products)
      await t.run(`INSERT OR IGNORE INTO products (id,name,cat,icon,sku,supplier,pack,moq,price,rrp,cost,stock_units,badge,description,specs,image,sort)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, p.id, p.name, p.cat, p.icon, p.sku, p.supplier, p.pack, p.moq, p.price, p.rrp, p.cost || 0, p.stock_units, p.badge, p.description, JSON.stringify(p.specs), p.image, p.sort);
  });
  console.log(`[db] seeded ${categories.length} categories and ${products.length} products`);
}

// Add columns introduced after the first release (safe to run every start).
const COLUMNS = [
  ["products", "cost", "REAL NOT NULL DEFAULT 0"],              // supplier cost per unit, excl. VAT
  ["orders", "discount_code", "TEXT DEFAULT ''"],
  ["orders", "discount", "REAL DEFAULT 0"],                      // excl. VAT
  ["orders", "delivery_method", "TEXT DEFAULT 'courier'"],      // courier | collect
  ["order_items", "unit_cost", "REAL DEFAULT 0"],                // cost at time of sale, excl. VAT
];
async function migrate() {
  for (const [table, col, def] of COLUMNS) {
    const cols = toObjects(await client.execute(`PRAGMA table_info(${table})`)).map((c) => c.name);
    if (!cols.includes(col)) await client.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

let ready = null;
/** Create tables + seed once per process (cheap on warm serverless instances). */
function init(afterSchema) {
  if (!ready) {
    ready = (async () => {
      if (isLocalFile) await client.executeMultiple("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
      await client.execute("PRAGMA foreign_keys = ON");
      await client.executeMultiple(SCHEMA);
      await migrate();
      await seed();
      if (afterSchema) await afterSchema();
      if (readOnly) console.warn("[db] No TURSO_DATABASE_URL set on Vercel: running in read-only preview mode.");
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

module.exports = { db, tx, init, DATA_DIR, ON_VERCEL, readOnly: () => readOnly, isLocalFile };
