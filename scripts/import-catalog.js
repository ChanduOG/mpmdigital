// Imports server/seed/catalog.json into the configured database (local file, or Turso if
// TURSO_DATABASE_URL is set). Safe to run more than once.
//   node --env-file-if-exists=.env scripts/import-catalog.js               add new categories/products only
//   node --env-file-if-exists=.env scripts/import-catalog.js --hide-others also hide products not in the file
//   node --env-file-if-exists=.env scripts/import-catalog.js --update      also overwrite names/prices/photos of existing ones
"use strict";
const store = require("../server/db");
const { tx } = store;
const { categories, products } = require("../server/seed/catalog.json");

const args = new Set(process.argv.slice(2));
(async () => {
  await store.init();
  if (store.readOnly()) throw new Error("No database configured.");
  let catNew = 0, prodNew = 0, prodUpd = 0, hidden = 0;
  await tx(async (q) => {
    for (const c of categories) {
      const ex = await q.get("SELECT id FROM categories WHERE id = ?", c.id);
      if (ex) await q.run("UPDATE categories SET name=?, blurb=?, icon=?, tone=?, sort=? WHERE id=?", c.name, c.blurb, c.icon, c.tone, c.sort, c.id);
      else { await q.run("INSERT INTO categories (id,name,blurb,icon,tone,sort) VALUES (?,?,?,?,?,?)", c.id, c.name, c.blurb, c.icon, c.tone, c.sort); catNew++; }
    }
    for (const p of products) {
      const ex = await q.get("SELECT id FROM products WHERE id = ? OR sku = ?", p.id, p.sku);
      if (!ex) {
        await q.run(`INSERT INTO products (id,name,cat,icon,sku,supplier,pack,moq,price,rrp,cost,stock_units,badge,description,specs,image,active,sort)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`, p.id, p.name, p.cat, p.icon, p.sku, p.supplier, p.pack, p.moq, p.price, p.rrp, p.cost || 0,
          p.stock_units, p.badge || "", p.description, JSON.stringify(p.specs || {}), p.image, p.sort);
        await q.run("INSERT INTO stock_movements (product_id, change, balance, reason, note, by_user) VALUES (?,?,?,?,?,?)", p.id, p.stock_units, p.stock_units, "new", "Imported from supplier catalogue", "import");
        prodNew++;
      } else if (args.has("--update")) {
        await q.run("UPDATE products SET name=?, cat=?, icon=?, supplier=?, price=?, rrp=?, description=?, specs=?, image=?, active=1, updated_at=datetime('now') WHERE id=?",
          p.name, p.cat, p.icon, p.supplier, p.price, p.rrp, p.description, JSON.stringify(p.specs || {}), p.image, ex.id);
        prodUpd++;
      } else {
        await q.run("UPDATE products SET active=1 WHERE id=?", ex.id);
      }
    }
    if (args.has("--hide-others")) {
      const keep = new Set(products.map((p) => p.id));
      for (const r of await q.all("SELECT id FROM products WHERE active = 1")) {
        if (!keep.has(r.id)) { await q.run("UPDATE products SET active = 0 WHERE id = ?", r.id); hidden++; }
      }
    }
  });
  console.log(`categories added: ${catNew} · products added: ${prodNew} · updated: ${prodUpd} · hidden: ${hidden}`);
})().catch((e) => { console.error("Import failed:", e.message); process.exit(1); });
