// MPM Digital — request handler.
// One codebase, two separate apps:
//   APP_ROLE=store  -> the shop        (store API + shop pages)
//   APP_ROLE=admin  -> the back office (admin API + admin pages), hosted on its own domain
// Used by server/server.js (local) and api/index.js (Vercel serverless function).
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROLE = process.env.APP_ROLE === "admin" ? "admin" : "store";
const store = require("./db");
const { DATA_DIR } = store;
const auth = require("./auth");
const settingsStore = require("./settings");
const { HttpError, createRouter } = require("./core");

const { routes, route } = createRouter();
(ROLE === "admin" ? require("./admin-api") : require("./store-api")).register(route);

const STATIC_DIR = path.join(__dirname, "..", "dist", ROLE);
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com" + (ROLE === "admin" && process.env.STORE_URL ? " " + process.env.STORE_URL : ""),
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": CSP,
  ...(ROLE === "admin" ? { "X-Robots-Tag": "noindex, nofollow" } : {}),
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isJson ? JSON.stringify(body) : body);
}

async function readBody(req, limit) {
  // On Vercel the platform has already read the body; use its parsed value.
  if (store.ON_VERCEL && "body" in req) {
    let b;
    try { b = req.body; } catch { throw new HttpError(400, "Invalid JSON"); }
    if (b == null || b === "") return {};
    if (Buffer.isBuffer(b)) b = b.toString("utf8");
    if (typeof b === "string") { try { return JSON.parse(b); } catch { throw new HttpError(400, "Invalid JSON"); } }
    return b;
  }
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, "Request too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { reject(new HttpError(400, "Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

/* ------------------------------------------------------- static (local only; Vercel serves dist/ itself) */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

function serveStatic(req, res, pathname) {
  let base = STATIC_DIR, rel = pathname;
  if (pathname.startsWith("/uploads/")) { base = UPLOAD_DIR; rel = pathname.slice("/uploads".length); }
  if (rel === "/" || rel === "") rel = "/index.html";
  let file;
  try { file = path.normalize(path.join(base, decodeURIComponent(rel))); } catch { return send(res, 400, "Bad request"); }
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

/* ----------------------------------------------------------------- handler */
const READ_ONLY_MSG = "The store database isn't connected yet, so orders and sign-ins are switched off. (Owner: connect the Turso database in Vercel; see SETUP-VERCEL.md.)";

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  let pathname = url.pathname;
  // Vercel rewrite: /api/(.*) -> /api/index?__path=$1
  if (url.searchParams.has("__path")) { pathname = "/api/" + url.searchParams.get("__path"); url.searchParams.delete("__path"); }
  try {
    if (pathname.startsWith("/api/")) {
      const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
      if (!r) throw new HttpError(404, "Not found");
      // CSRF guard: mutating requests must come from our own JS (a custom header can't be sent cross-site without CORS).
      if (req.method !== "GET" && r.opts.csrf !== false && req.headers["x-requested-with"] !== "mpm") throw new HttpError(403, "Forbidden");
      await store.init(auth.ensureAdmin);
      if (req.method !== "GET" && store.readOnly() && !r.opts.allowReadOnly) {
        if (pathname === "/api/track") return send(res, 200, { ok: true, skipped: true });
        throw new HttpError(503, READ_ONLY_MSG);
      }
      const m = r.re.exec(pathname); const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const body = req.method === "GET" || req.method === "DELETE" ? {} : await readBody(req, r.opts.limit || 200 * 1024);
      const ctx = { req, res, params, query: url.searchParams, body, user: await auth.currentUser(req), settings: await settingsStore.getSettings() };
      const out = await r.handler(ctx);
      return send(res, 200, out ?? { ok: true });
    }
    if (pathname.startsWith("/pay/")) return send(res, 501, "Online payment is not connected yet. Please contact us to complete payment.");
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    return serveStatic(req, res, pathname);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    const msg = status === 500
      ? (/fetch failed|ECONNREFUSED|ENOTFOUND|SERVER_ERROR|URL_INVALID/i.test(String(e.message)) ? "We couldn't reach the store database. Please try again shortly." : "Something went wrong on our side. Please try again.")
      : e.message;
    return send(res, status, { error: msg });
  }
}

module.exports = { handle, ROLE };
