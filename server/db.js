// SQLite database (built into Node 22.5+ as node:sqlite). Single file: data/mpm.db
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(path.join(DATA_DIR, "uploads", "products"), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, "mpm.db"));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',           -- customer | admin
  account_type TEXT NOT NULL DEFAULT 'home',        -- home | business
  business_name TEXT DEFAULT '',
  vat_number TEXT DEFAULT '',
  trade_status TEXT NOT NULL DEFAULT 'none',        -- none | pending | approved | rejected
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
  price REAL NOT NULL CHECK (price >= 0),           -- wholesale unit price excl. VAT (tier 1)
  rrp REAL NOT NULL CHECK (rrp >= 0),               -- retail unit price incl. VAT
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
  type TEXT NOT NULL,                               -- order | quote | contact
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  mode TEXT DEFAULT 'home',
  status TEXT NOT NULL,                             -- order: pending_payment|paid|processing|shipped|delivered|cancelled ; quote/contact: new|replied|closed
  payment_method TEXT DEFAULT '',
  payment_status TEXT DEFAULT 'unpaid',             -- unpaid | paid | on_account | refunded
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
  status TEXT NOT NULL DEFAULT 'pending',           -- pending | approved | rejected
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
`);

// First run: load the starter catalogue.
function seed() {
  const n = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  if (n > 0) return;
  const { categories, products } = JSON.parse(fs.readFileSync(path.join(__dirname, "seed", "catalog.json"), "utf8"));
  const insC = db.prepare("INSERT OR IGNORE INTO categories (id,name,blurb,icon,tone,sort) VALUES (?,?,?,?,?,?)");
  const insP = db.prepare(`INSERT INTO products (id,name,cat,icon,sku,supplier,pack,moq,price,rrp,stock_units,badge,description,specs,image,sort)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  tx(() => {
    categories.forEach((c) => insC.run(c.id, c.name, c.blurb, c.icon, c.tone, c.sort));
    products.forEach((p) => insP.run(p.id, p.name, p.cat, p.icon, p.sku, p.supplier, p.pack, p.moq, p.price, p.rrp, p.stock_units, p.badge, p.description, JSON.stringify(p.specs), p.image, p.sort));
  });
  console.log(`[db] seeded ${categories.length} categories and ${products.length} products`);
}

function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

seed();

module.exports = { db, tx, DATA_DIR };
