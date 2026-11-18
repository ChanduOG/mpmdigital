// Builds the static files for ONE app into its own folder, so the shop and the
// admin are deployed completely separately:
//   node scripts/build.js store   -> dist/store  (shop pages only, no admin files)
//   node scripts/build.js admin   -> dist/admin  (admin pages only)
// On Vercel the role comes from the APP_ROLE environment variable and the result is
// also copied to dist/site (the folder vercel.json serves).
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "public");

const APPS = {
  store: {
    page: "index.html",
    files: ["assets/css/styles.css", "assets/js/app.js", "assets/js/pricing.js", "assets/js/icons.js"],
    dirs: ["assets/img"],
  },
  admin: {
    page: "admin.html",
    files: ["assets/css/styles.css", "assets/css/admin.css", "assets/js/admin.js", "assets/js/icons.js"],
    dirs: ["assets/img"], // product photos referenced by the catalogue
  },
};

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

function build(role) {
  const app = APPS[role];
  if (!app) throw new Error(`Unknown app "${role}". Use "store" or "admin".`);
  const out = path.join(ROOT, "dist", role);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  // cache-busting version so browsers always load the newest scripts after a deploy
  const version = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 10);
  const html = fs.readFileSync(path.join(SRC, app.page), "utf8").replace(/(assets\/(?:css|js)\/[\w-]+\.(?:css|js))(\?v=[\w-]+)?"/g, `$1?v=${version}"`);
  fs.writeFileSync(path.join(out, "index.html"), html);
  for (const f of app.files) { fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true }); fs.copyFileSync(path.join(SRC, f), path.join(out, f)); }
  for (const d of app.dirs) copyDir(path.join(SRC, d), path.join(out, d));
  fs.writeFileSync(path.join(out, "robots.txt"), role === "admin" ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /\n");
  return out;
}

module.exports = { build };

if (require.main === module) {
  const role = process.argv[2] || process.env.APP_ROLE || "store";
  const out = build(role);
  if (process.env.VERCEL) {
    const site = path.join(ROOT, "dist", "site");
    fs.rmSync(site, { recursive: true, force: true });
    copyDir(out, site);
  }
  console.log(`Built the ${role} app -> ${path.relative(ROOT, out)}`);
}
