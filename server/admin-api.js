// Admin (back office) API. Deployed separately with APP_ROLE=admin.
// The shop deployment never loads this file.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { db, tx, DATA_DIR, ON_VERCEL } = require("./db");
const store = require("./db");
const auth = require("./auth");
const settingsStore = require("./settings");
const analytics = require("./analytics");
const { notify } = require("./notify");
const {
  HttpError, bad, str, int, isEmail, r2, rateLimit, rowToProduct, getProduct, orderDetail, details, logStock, saToday, P,
} = require("./core");

const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const UNIT_COST = "(CASE WHEN i.unit_cost > 0 THEN i.unit_cost ELSE COALESCE(p.cost, 0) END)";
const requireAdmin = (ctx) => {
  if (!ctx.user) throw new HttpError(401, "Please sign in.");
  if (ctx.user.role !== "admin") throw new HttpError(403, "Admins only.");
  return ctx.user;
};

async function saveUpload(name, buf, contentType) {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = require("@vercel/blob");
    const blob = await put(`products/${name}`, buf, { access: "public", contentType, addRandomSuffix: true });
    return blob.url;
  }
  if (ON_VERCEL) throw new HttpError(503, "Photo storage isn't connected yet. In Vercel, add a Blob store to the admin project (Storage → Blob), then redeploy.");
  fs.mkdirSync(path.join(UPLOAD_DIR, "products"), { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, "products", name), buf);
  return `/uploads/products/${name}`;
}

function register(route) {
  route("GET", "/api/health", async () => ({ ok: true, app: "admin", database: store.readOnly() ? "preview (not connected)" : store.isLocalFile ? "local file" : "connected" }));

  /* ---- admin sign-in (admins only) ---- */
  route("POST", "/api/auth/login", async (ctx) => {
    rateLimit(ctx.req, "admin-login", 8, 15 * 60e3);
    const email = str(ctx.body.email, 160).toLowerCase(), pw = String(ctx.body.password || "");
    const u = await db.get("SELECT * FROM users WHERE email = ?", email);
    if (!u || !auth.verifyPassword(pw, u.password_hash) || u.role !== "admin") throw new HttpError(401, "That email and password don't match an admin account.");
    await auth.createSession(ctx.res, ctx.req, u.id);
    return { user: auth.publicUser(u) };
  });
  route("POST", "/api/auth/logout", async (ctx) => { await auth.destroySession(ctx.req, ctx.res); return { ok: true }; }, { allowReadOnly: true });
  route("GET", "/api/me", async (ctx) => ({ user: ctx.user && ctx.user.role === "admin" ? auth.publicUser(ctx.user) : null }));
  route("PATCH", "/api/me", async (ctx) => {
    const u = requireAdmin(ctx), b = ctx.body;
    await db.run("UPDATE users SET name=?, phone=? WHERE id=?", str(b.name, 120) || u.name, str(b.phone, 40), u.id);
    if (b.newPassword) {
      if (!auth.verifyPassword(String(b.currentPassword || ""), u.password_hash)) throw bad("Your current password is incorrect.");
      if (String(b.newPassword).length < 10) throw bad("Admin passwords need at least 10 characters.");
      await db.run("UPDATE users SET password_hash=? WHERE id=?", auth.hashPassword(String(b.newPassword)), u.id);
    }
    return { user: auth.publicUser(await db.get("SELECT * FROM users WHERE id = ?", u.id)) };
  });

  route("GET", "/api/admin/meta", async (ctx) => {
    requireAdmin(ctx);
    return { storeUrl: (process.env.STORE_URL || "").replace(/\/$/, ""), database: store.readOnly() ? "preview" : store.isLocalFile ? "local" : "connected" };
  });

  /* ---- dashboard ---- */
  route("GET", "/api/admin/summary", async (ctx) => {
    requireAdmin(ctx);
    const one = (sql, ...a) => db.get(sql, ...a);
    return {
      ordersToday: (await one("SELECT COUNT(*) AS n FROM orders WHERE type='order' AND date(created_at,'+2 hours')=?", saToday())).n,
      awaitingPayment: (await one("SELECT COUNT(*) AS n FROM orders WHERE status='pending_payment'")).n,
      toFulfil: (await one("SELECT COUNT(*) AS n FROM orders WHERE status IN ('paid','processing')")).n,
      newMessages: (await one("SELECT COUNT(*) AS n FROM orders WHERE type IN ('quote','contact') AND status='new'")).n,
      pendingTrade: (await one("SELECT COUNT(*) AS n FROM trade_applications WHERE status='pending'")).n,
      lowStock: await db.all("SELECT id,name,stock_units,pack FROM products WHERE active=1 AND stock_units <= pack*10 ORDER BY stock_units LIMIT 10"),
      customers: (await one("SELECT COUNT(*) AS n FROM users WHERE role='customer'")).n,
      subscribers: (await one("SELECT COUNT(*) AS n FROM subscribers")).n,
      recent: await details(await db.all("SELECT * FROM orders ORDER BY id DESC LIMIT 8")),
    };
  });

  route("GET", "/api/admin/analytics", async (ctx) => {
    requireAdmin(ctx);
    const d = int(ctx.query.get("days"));
    return analytics.report([7, 30, 90, 365].includes(d) ? d : 30);
  });

  /* ---- finances ---- */
  route("GET", "/api/admin/finances", async (ctx) => {
    requireAdmin(ctx);
    const d = int(ctx.query.get("days"));
    const days = [7, 30, 90, 365].includes(d) ? d : 30;
    const from = new Date(Date.now() + 2 * 3600e3 - (days - 1) * 864e5).toISOString().slice(0, 10);
    const one = async (sql, ...a) => (await db.get(sql, ...a)) || {};
    const live = "type='order' AND status != 'cancelled'";
    const inPeriod = "date(created_at, '+2 hours') >= ?";

    const s = await one(`SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS gross, COALESCE(SUM(discount),0) AS discountEx,
      COALESCE(SUM(subtotal - discount),0) AS goodsEx, COALESCE(SUM(delivery),0) AS deliveryEx, COALESCE(SUM(vat),0) AS vat
      FROM orders WHERE ${live} AND ${inPeriod}`, from);
    // cost at time of sale; for older orders without one, fall back to the product's current cost
    const cogs = await one(`SELECT COALESCE(SUM(i.units * ${UNIT_COST}),0) AS cogs, COALESCE(SUM(CASE WHEN ${UNIT_COST} = 0 THEN i.line_ex ELSE 0 END),0) AS uncostedEx
      FROM order_items i JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id WHERE o.type='order' AND o.status != 'cancelled' AND date(o.created_at, '+2 hours') >= ?`, from);
    const refunded = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM orders WHERE type='order' AND payment_status='refunded' AND ${inPeriod}`, from);
    const cancelled = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM orders WHERE type='order' AND status='cancelled' AND ${inPeriod}`, from);

    // money position (all time, not just this period)
    const received = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM orders WHERE ${live} AND payment_status='paid'`);
    const awaiting = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM orders WHERE ${live} AND payment_status='unpaid'`);
    const onAccount = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM orders WHERE ${live} AND payment_status='on_account'`);
    const debtors = await db.all(`SELECT u.id, u.name, u.business_name AS business, u.email, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS owed, MIN(o.created_at) AS oldest
      FROM orders o JOIN users u ON u.id = o.user_id WHERE o.type='order' AND o.status!='cancelled' AND o.payment_status='on_account'
      GROUP BY u.id ORDER BY owed DESC LIMIT 50`);
    const unpaidOrders = await details(await db.all(`SELECT * FROM orders WHERE ${live} AND payment_status='unpaid' ORDER BY id LIMIT 50`));

    const monthly = await db.all(`SELECT strftime('%Y-%m', created_at, '+2 hours') AS month, COUNT(*) AS orders, COALESCE(SUM(total),0) AS gross,
      COALESCE(SUM(subtotal - discount + delivery),0) AS netEx, COALESCE(SUM(vat),0) AS vat, COALESCE(SUM(discount),0) AS discountEx,
      COALESCE(SUM((SELECT SUM(i.units * ${UNIT_COST}) FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = orders.id)),0) AS cogs
      FROM orders WHERE ${live} AND created_at >= datetime('now', '-12 months') GROUP BY month ORDER BY month DESC`);
    const inventory = await one(`SELECT COALESCE(SUM(stock_units * cost),0) AS atCost, COALESCE(SUM(stock_units * price),0) AS atWholesaleEx,
      COALESCE(SUM(stock_units * rrp),0) AS atRetailInc, SUM(cost = 0) AS uncosted, COUNT(*) AS products FROM products WHERE active = 1 AND stock_units > 0`);

    const grossProfit = (s.goodsEx || 0) - (cogs.cogs || 0);
    return {
      days, from,
      period: {
        orders: s.orders || 0, gross: r2(s.gross), discountEx: r2(s.discountEx), goodsEx: r2(s.goodsEx), deliveryEx: r2(s.deliveryEx), vat: r2(s.vat),
        netEx: r2((s.goodsEx || 0) + (s.deliveryEx || 0)), cogs: r2(cogs.cogs), grossProfit: r2(grossProfit),
        margin: s.goodsEx ? grossProfit / s.goodsEx : 0, uncostedEx: r2(cogs.uncostedEx),
        refunded: { n: refunded.n || 0, amount: r2(refunded.amount) }, cancelled: { n: cancelled.n || 0, amount: r2(cancelled.amount) },
      },
      position: {
        received: { n: received.n || 0, amount: r2(received.amount) },
        awaiting: { n: awaiting.n || 0, amount: r2(awaiting.amount) },
        onAccount: { n: onAccount.n || 0, amount: r2(onAccount.amount) },
      },
      debtors, unpaidOrders,
      monthly: monthly.map((m) => ({ ...m, gross: r2(m.gross), netEx: r2(m.netEx), vat: r2(m.vat), discountEx: r2(m.discountEx), cogs: r2(m.cogs), profit: r2(m.netEx - m.cogs) })),
      inventory: { ...inventory, atCost: r2(inventory.atCost), atWholesaleEx: r2(inventory.atWholesaleEx), atRetailInc: r2(inventory.atRetailInc) },
    };
  });

  /* ---- orders ---- */
  route("GET", "/api/admin/orders", async (ctx) => {
    requireAdmin(ctx);
    const type = str(ctx.query.get("type"), 20), status = str(ctx.query.get("status"), 30), q = str(ctx.query.get("q"), 80), pay = str(ctx.query.get("pay"), 20);
    let sql = "SELECT * FROM orders WHERE 1=1"; const a = [];
    if (type) { sql += " AND type = ?"; a.push(type); }
    if (status) { sql += " AND status = ?"; a.push(status); }
    if (pay) { sql += " AND payment_status = ?"; a.push(pay); }
    if (q) { sql += " AND (ref LIKE ? OR customer LIKE ?)"; a.push(`%${q}%`, `%${q}%`); }
    sql += " ORDER BY id DESC LIMIT 500";
    return { orders: await details(await db.all(sql, ...a)) };
  });

  const ORDER_STATUSES = ["pending_payment", "paid", "processing", "shipped", "delivered", "cancelled", "new", "replied", "closed"];
  route("PATCH", "/api/admin/orders/:id", async (ctx) => {
    const me = requireAdmin(ctx);
    const o = await db.get("SELECT * FROM orders WHERE id = ?", int(ctx.params.id));
    if (!o) throw new HttpError(404, "Order not found");
    const b = ctx.body;
    let status = b.status && ORDER_STATUSES.includes(b.status) ? b.status : o.status;
    let payStatus = ["unpaid", "paid", "on_account", "refunded"].includes(b.paymentStatus) ? b.paymentStatus : o.payment_status;
    if (b.action === "refund") { status = "cancelled"; payStatus = "refunded"; }
    if (status === "paid" && payStatus === "unpaid") payStatus = "paid";
    await tx(async (q) => {
      // Return stock if an order is cancelled; take it again if it is un-cancelled.
      if (o.type === "order" && status !== o.status && (status === "cancelled" || o.status === "cancelled")) {
        const sign = status === "cancelled" ? 1 : -1;
        for (const it of await q.all("SELECT product_id, units FROM order_items WHERE order_id = ?", o.id)) {
          await q.run("UPDATE products SET stock_units = stock_units + ? WHERE id = ?", sign * it.units, it.product_id);
          await logStock(q, it.product_id, sign * it.units, sign > 0 ? "cancel" : "sale", { ref: o.ref, by: me.email });
        }
      }
      await q.run("UPDATE orders SET status=?, payment_status=?, admin_notes=?, updated_at=datetime('now') WHERE id=?",
        status, payStatus, b.adminNotes !== undefined ? str(b.adminNotes, 2000) : o.admin_notes, o.id);
    });
    if (status !== o.status) notify("order.status", { ref: o.ref, status });
    return { order: await orderDetail(await db.get("SELECT * FROM orders WHERE id = ?", o.id)) };
  });

  /* ---- products & inventory ---- */
  route("GET", "/api/admin/products", async (ctx) => {
    requireAdmin(ctx);
    return { products: (await db.all("SELECT * FROM products ORDER BY sort, name")).map(rowToProduct), categories: await db.all("SELECT * FROM categories ORDER BY sort") };
  });

  async function productFields(b, existing = {}) {
    const num = (v, d) => (v === undefined || v === "" ? d : Number(v));
    const f = {
      name: b.name !== undefined ? str(b.name, 160) : existing.name,
      cat: b.cat !== undefined ? str(b.cat, 40) : existing.cat,
      sku: b.sku !== undefined ? str(b.sku, 60) : existing.sku,
      supplier: b.supplier !== undefined ? str(b.supplier, 120) : existing.supplier,
      pack: int(num(b.pack, existing.pack)), moq: int(num(b.moq, existing.moq)),
      price: num(b.price, existing.price), rrp: num(b.rrp, existing.rrp), cost: num(b.cost, existing.cost ?? 0),
      stock_units: int(num(b.stockUnits, existing.stockUnits ?? 0)),
      badge: b.badge !== undefined ? str(b.badge, 30) : existing.badge,
      description: b.desc !== undefined ? str(b.desc, 3000) : existing.desc,
      icon: b.icon !== undefined ? str(b.icon, 30) : existing.icon || "box",
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing.active === false ? 0 : 1,
      specs: b.specs !== undefined && typeof b.specs === "object" ? JSON.stringify(b.specs) : JSON.stringify(existing.specs || {}),
    };
    if (!f.name || !f.sku) throw bad("Name and SKU are required.");
    if (!(await db.get("SELECT 1 AS x FROM categories WHERE id = ?", f.cat))) throw bad("Unknown category.");
    if (!(f.pack > 0) || !(f.moq > 0)) throw bad("Pack size and MOQ must be at least 1.");
    for (const k of ["price", "rrp", "cost"]) if (!Number.isFinite(f[k]) || f[k] < 0) throw bad("Prices must be valid numbers of 0 or more.");
    if (!Number.isFinite(f.stock_units)) throw bad("Stock must be a whole number.");
    return f;
  }

  route("POST", "/api/admin/products", async (ctx) => {
    const me = requireAdmin(ctx);
    const f = await productFields(ctx.body);
    const id = (str(ctx.body.id, 60) || f.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    if (!id || (await db.get("SELECT 1 AS x FROM products WHERE id = ?", id))) throw bad("A product with that ID already exists.");
    try {
      await tx(async (q) => {
        await q.run(`INSERT INTO products (id,name,cat,icon,sku,supplier,pack,moq,price,rrp,cost,stock_units,badge,description,specs,active,sort)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM products))`,
          id, f.name, f.cat, f.icon, f.sku, f.supplier, f.pack, f.moq, f.price, f.rrp, f.cost, f.stock_units, f.badge, f.description, f.specs, f.active);
        await logStock(q, id, f.stock_units, "new", { by: me.email, note: "Opening stock" });
      });
    } catch (e) { if (/UNIQUE/i.test(e.message)) throw bad("That SKU is already in use."); throw e; }
    return { product: await getProduct(id) };
  });

  route("PATCH", "/api/admin/products/:id", async (ctx) => {
    const me = requireAdmin(ctx);
    const existing = await getProduct(ctx.params.id);
    if (!existing) throw new HttpError(404, "Product not found");
    const f = await productFields(ctx.body, existing);
    try {
      await tx(async (q) => {
        await q.run(`UPDATE products SET name=?,cat=?,icon=?,sku=?,supplier=?,pack=?,moq=?,price=?,rrp=?,cost=?,stock_units=?,badge=?,description=?,specs=?,active=?,updated_at=datetime('now') WHERE id=?`,
          f.name, f.cat, f.icon, f.sku, f.supplier, f.pack, f.moq, f.price, f.rrp, f.cost, f.stock_units, f.badge, f.description, f.specs, f.active, existing.id);
        await logStock(q, existing.id, f.stock_units - existing.stockUnits, "edit", { by: me.email, note: "Edited in product form" });
      });
    } catch (e) { if (/UNIQUE/i.test(e.message)) throw bad("That SKU is already in use."); throw e; }
    return { product: await getProduct(existing.id) };
  });

  // quick stock adjustment with a reason (restock from supplier, damaged, stock count…)
  const REASONS = ["restock", "adjust", "damaged", "count", "return"];
  route("POST", "/api/admin/products/:id/stock", async (ctx) => {
    const me = requireAdmin(ctx);
    const p = await getProduct(ctx.params.id);
    if (!p) throw new HttpError(404, "Product not found");
    const b = ctx.body, reason = REASONS.includes(b.reason) ? b.reason : "adjust";
    let change = int(b.change);
    if (reason === "count") { const counted = int(b.counted); if (!Number.isFinite(counted) || counted < 0) throw bad("Enter the number of units you counted."); change = counted - p.stockUnits; }
    if (!Number.isFinite(change) || change === 0) throw bad("Enter how many units to add or remove.");
    if (Math.abs(change) > 1e6) throw bad("That's a very large change. Please check the number.");
    await tx(async (q) => {
      await q.run("UPDATE products SET stock_units = stock_units + ?, updated_at = datetime('now') WHERE id = ?", change, p.id);
      await logStock(q, p.id, change, reason, { ref: b.ref, note: b.note, by: me.email });
    });
    return { product: await getProduct(p.id) };
  });

  route("GET", "/api/admin/products/:id/history", async (ctx) => {
    requireAdmin(ctx);
    return { movements: await db.all("SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 100", ctx.params.id) };
  });

  route("GET", "/api/admin/stock-movements", async (ctx) => {
    requireAdmin(ctx);
    return { movements: await db.all(`SELECT m.*, p.name FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id ORDER BY m.id DESC LIMIT 200`) };
  });

  route("POST", "/api/admin/products/:id/image", async (ctx) => {
    requireAdmin(ctx);
    const p = await getProduct(ctx.params.id);
    if (!p) throw new HttpError(404, "Product not found");
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(ctx.body.dataUrl || ""));
    if (!m) throw bad("Please upload a JPG, PNG or WebP image.");
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 3 * 1024 * 1024) throw bad("Images must be under 3 MB.");
    const magic = { jpeg: [0xff, 0xd8], png: [0x89, 0x50], webp: [0x52, 0x49] }[m[1]];
    if (buf[0] !== magic[0] || buf[1] !== magic[1]) throw bad("That file doesn't look like a valid image.");
    const name = `${p.id}-${Date.now()}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
    const url = await saveUpload(name, buf, `image/${m[1]}`);
    await db.run("UPDATE products SET image=?, updated_at=datetime('now') WHERE id=?", url, p.id);
    return { product: await getProduct(p.id) };
  }, { limit: 5 * 1024 * 1024 });

  /* ---- categories ---- */
  const TONES = ["pink", "lilac", "wine", "blush", "plum"];
  const ICON_NAMES = ["pot", "pan", "glass", "plate", "mop", "spray", "sponge", "broom", "bin", "towel", "soap", "roll", "box", "container", "basket", "hanger", "candle", "lamp", "kettle", "blender", "cup"];
  const allCats = () => db.all("SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.cat = c.id) AS products FROM categories c ORDER BY c.sort, c.name");
  route("GET", "/api/admin/categories", async (ctx) => { requireAdmin(ctx); return { categories: await allCats() }; });
  route("POST", "/api/admin/categories", async (ctx) => {
    requireAdmin(ctx);
    const b = ctx.body, name = str(b.name, 80);
    if (!name) throw bad("Please give the category a name.");
    const id = (str(b.id, 40) || name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!id || (await db.get("SELECT 1 AS x FROM categories WHERE id = ?", id))) throw bad("A category with that name already exists.");
    await db.run("INSERT INTO categories (id,name,blurb,icon,tone,sort) VALUES (?,?,?,?,?,(SELECT COALESCE(MAX(sort),0)+1 FROM categories))",
      id, name, str(b.blurb, 200), ICON_NAMES.includes(b.icon) ? b.icon : "box", TONES.includes(b.tone) ? b.tone : "pink");
    return { categories: await allCats() };
  });
  route("PATCH", "/api/admin/categories/:id", async (ctx) => {
    requireAdmin(ctx);
    const c = await db.get("SELECT * FROM categories WHERE id = ?", ctx.params.id);
    if (!c) throw new HttpError(404, "Category not found");
    const b = ctx.body;
    await db.run("UPDATE categories SET name=?, blurb=?, icon=?, tone=?, sort=? WHERE id=?",
      str(b.name, 80) || c.name, b.blurb !== undefined ? str(b.blurb, 200) : c.blurb,
      ICON_NAMES.includes(b.icon) ? b.icon : c.icon, TONES.includes(b.tone) ? b.tone : c.tone,
      Number.isFinite(int(b.sort)) ? int(b.sort) : c.sort, c.id);
    return { categories: await allCats() };
  });
  route("DELETE", "/api/admin/categories/:id", async (ctx) => {
    requireAdmin(ctx);
    const n = (await db.get("SELECT COUNT(*) AS n FROM products WHERE cat = ?", ctx.params.id)).n;
    if (n) throw bad(`Move or delete the ${n} product(s) in this category first.`);
    await db.run("DELETE FROM categories WHERE id = ?", ctx.params.id);
    return { categories: await allCats() };
  });

  /* ---- discount codes ---- */
  const discountFields = (b, cur = {}) => {
    const f = {
      code: b.code !== undefined ? str(b.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, "") : cur.code,
      type: ["percent", "fixed"].includes(b.type) ? b.type : cur.type || "percent",
      value: b.value !== undefined ? Number(b.value) : cur.value,
      min_spend: b.minSpend !== undefined && b.minSpend !== "" ? Number(b.minSpend) : cur.min_spend || 0,
      applies_to: ["all", "home", "trade"].includes(b.appliesTo) ? b.appliesTo : cur.applies_to || "all",
      starts_at: b.startsAt !== undefined ? str(b.startsAt, 10) : cur.starts_at || "",
      ends_at: b.endsAt !== undefined ? str(b.endsAt, 10) : cur.ends_at || "",
      max_uses: b.maxUses !== undefined && b.maxUses !== "" ? int(b.maxUses) : cur.max_uses || 0,
      active: b.active !== undefined ? (b.active ? 1 : 0) : cur.active ?? 1,
      note: b.note !== undefined ? str(b.note, 200) : cur.note || "",
    };
    if (!f.code || f.code.length < 3) throw bad("Codes need at least 3 letters or numbers.");
    if (!Number.isFinite(f.value) || f.value <= 0) throw bad("Enter a discount amount above 0.");
    if (f.type === "percent" && f.value > 90) throw bad("Percentage discounts can be at most 90%.");
    if (!Number.isFinite(f.min_spend) || f.min_spend < 0) throw bad("Minimum spend must be 0 or more.");
    if (!Number.isFinite(f.max_uses) || f.max_uses < 0) throw bad("Usage limit must be 0 (unlimited) or more.");
    for (const k of ["starts_at", "ends_at"]) if (f[k] && !/^\d{4}-\d{2}-\d{2}$/.test(f[k])) throw bad("Dates must look like 2026-12-31.");
    if (f.starts_at && f.ends_at && f.ends_at < f.starts_at) throw bad("The end date is before the start date.");
    return f;
  };
  route("GET", "/api/admin/discounts", async (ctx) => {
    requireAdmin(ctx);
    const list = await db.all(`SELECT d.*, (SELECT COALESCE(SUM(o.discount),0) FROM orders o WHERE o.discount_code = d.code AND o.status != 'cancelled') AS given_ex
      FROM discounts d ORDER BY d.active DESC, d.id DESC`);
    return { discounts: list, today: saToday() };
  });
  route("POST", "/api/admin/discounts", async (ctx) => {
    requireAdmin(ctx);
    const f = discountFields(ctx.body);
    try {
      await db.run("INSERT INTO discounts (code,type,value,min_spend,applies_to,starts_at,ends_at,max_uses,active,note) VALUES (?,?,?,?,?,?,?,?,?,?)",
        f.code, f.type, f.value, f.min_spend, f.applies_to, f.starts_at, f.ends_at, f.max_uses, f.active, f.note);
    } catch (e) { if (/UNIQUE/i.test(e.message)) throw bad("That code already exists."); throw e; }
    return { ok: true };
  });
  route("PATCH", "/api/admin/discounts/:id", async (ctx) => {
    requireAdmin(ctx);
    const cur = await db.get("SELECT * FROM discounts WHERE id = ?", int(ctx.params.id));
    if (!cur) throw new HttpError(404, "Discount not found");
    const f = discountFields(ctx.body, cur);
    try {
      await db.run("UPDATE discounts SET code=?,type=?,value=?,min_spend=?,applies_to=?,starts_at=?,ends_at=?,max_uses=?,active=?,note=? WHERE id=?",
        f.code, f.type, f.value, f.min_spend, f.applies_to, f.starts_at, f.ends_at, f.max_uses, f.active, f.note, cur.id);
    } catch (e) { if (/UNIQUE/i.test(e.message)) throw bad("That code already exists."); throw e; }
    return { ok: true };
  });
  route("DELETE", "/api/admin/discounts/:id", async (ctx) => {
    requireAdmin(ctx);
    await db.run("DELETE FROM discounts WHERE id = ?", int(ctx.params.id));
    return { ok: true };
  });

  /* ---- customers, trade, team ---- */
  route("GET", "/api/admin/trade", async (ctx) => {
    requireAdmin(ctx);
    return { applications: await db.all("SELECT * FROM trade_applications ORDER BY id DESC LIMIT 300") };
  });
  route("PATCH", "/api/admin/trade/:id", async (ctx) => {
    requireAdmin(ctx);
    const a = await db.get("SELECT * FROM trade_applications WHERE id = ?", int(ctx.params.id));
    if (!a) throw new HttpError(404, "Application not found");
    const status = ["pending", "approved", "rejected"].includes(ctx.body.status) ? ctx.body.status : a.status;
    await tx(async (q) => {
      await q.run("UPDATE trade_applications SET status=? WHERE id=?", status, a.id);
      if (a.user_id) await q.run("UPDATE users SET trade_status=? WHERE id=?", status, a.user_id);
    });
    return { ok: true };
  });

  route("GET", "/api/admin/customers", async (ctx) => {
    requireAdmin(ctx);
    const rows = await db.all(`SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id AND o.type='order') AS order_count,
      (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id=u.id AND o.type='order' AND o.status!='cancelled') AS spent
      FROM users u WHERE role='customer' ORDER BY u.id DESC LIMIT 1000`);
    return {
      customers: rows.map((u) => ({ ...auth.publicUser(u), orderCount: u.order_count, spent: u.spent })),
      subscribers: await db.all("SELECT * FROM subscribers ORDER BY created_at DESC"),
    };
  });
  route("GET", "/api/admin/customers/:id", async (ctx) => {
    requireAdmin(ctx);
    const u = await db.get("SELECT * FROM users WHERE id = ?", int(ctx.params.id));
    if (!u) throw new HttpError(404, "Customer not found");
    return {
      customer: auth.publicUser(u),
      orders: await details(await db.all("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 100", u.id)),
      applications: await db.all("SELECT * FROM trade_applications WHERE user_id = ? ORDER BY id DESC", u.id),
    };
  });
  route("PATCH", "/api/admin/customers/:id", async (ctx) => {
    const me = requireAdmin(ctx);
    const u = await db.get("SELECT * FROM users WHERE id = ?", int(ctx.params.id));
    if (!u) throw new HttpError(404, "Customer not found");
    const b = ctx.body;
    const trade = ["none", "pending", "approved", "rejected"].includes(b.tradeStatus) ? b.tradeStatus : u.trade_status;
    const type = ["home", "business"].includes(b.accountType) ? b.accountType : u.account_type;
    const role = ["customer", "admin"].includes(b.role) ? b.role : u.role;
    if (role !== u.role && u.id === me.id) throw bad("You can't change your own admin access.");
    if (u.role === "admin" && role !== "admin" && (await db.get("SELECT COUNT(*) AS n FROM users WHERE role='admin'")).n <= 1) throw bad("You need at least one admin.");
    await db.run("UPDATE users SET trade_status=?, account_type=?, role=?, name=?, phone=?, business_name=?, vat_number=? WHERE id=?",
      trade, type, role, str(b.name, 120) || u.name, b.phone !== undefined ? str(b.phone, 40) : u.phone,
      b.businessName !== undefined ? str(b.businessName, 160) : u.business_name, b.vatNumber !== undefined ? str(b.vatNumber, 40) : u.vat_number, u.id);
    if (trade !== u.trade_status && trade !== "none") await db.run("UPDATE trade_applications SET status=? WHERE user_id=? AND status!=?", trade, u.id, trade);
    if (role !== u.role) await db.run("DELETE FROM sessions WHERE user_id = ?", u.id);
    return { customer: auth.publicUser(await db.get("SELECT * FROM users WHERE id = ?", u.id)) };
  });

  route("GET", "/api/admin/team", async (ctx) => {
    requireAdmin(ctx);
    return { admins: (await db.all("SELECT * FROM users WHERE role='admin' ORDER BY id")).map(auth.publicUser), me: ctx.user.id };
  });
  route("POST", "/api/admin/team", async (ctx) => {
    requireAdmin(ctx);
    const email = str(ctx.body.email, 160).toLowerCase();
    if (!isEmail(email)) throw bad("Enter a valid email address.");
    const u = await db.get("SELECT * FROM users WHERE email = ?", email);
    if (!u) throw bad("There's no account with that email yet. Ask them to create one in the shop first, then add them here.");
    if (u.role === "admin") throw bad("That person is already an admin.");
    await db.run("UPDATE users SET role='admin' WHERE id=?", u.id);
    await db.run("DELETE FROM sessions WHERE user_id = ?", u.id);
    return { ok: true };
  });

  /* ---- settings ---- */
  route("GET", "/api/admin/settings", async (ctx) => {
    requireAdmin(ctx);
    const { analyticsSalt, ...st } = await settingsStore.getSettings(true);
    return { settings: st, gateways: { card: !!process.env.CARD_GATEWAY, instantEft: !!process.env.INSTANT_EFT_GATEWAY, blob: !!process.env.BLOB_READ_WRITE_TOKEN } };
  });
  route("PUT", "/api/admin/settings", async (ctx) => {
    requireAdmin(ctx);
    try {
      const { analyticsSalt, ...st } = await settingsStore.saveSettings(ctx.body || {});
      return { settings: st };
    } catch (e) { throw new HttpError(e.status || 400, e.message); }
  });
}

module.exports = { register };
