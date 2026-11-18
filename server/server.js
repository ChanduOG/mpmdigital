// Local servers:
//   npm start          -> the shop   on http://localhost:3000
//   npm run admin      -> the admin  on http://localhost:3001
// On Vercel each app is its own project (see SETUP-VERCEL.md) and runs via api/index.js.
"use strict";
const role = (process.argv[2] || process.env.APP_ROLE || "store") === "admin" ? "admin" : "store";
process.env.APP_ROLE = role;

const http = require("node:http");
const { build } = require("../scripts/build");
build(role);

const { handle } = require("./app");
const store = require("./db");
const auth = require("./auth");

const PORT = role === "admin" ? Number(process.env.ADMIN_PORT) || 3001 : Number(process.env.PORT) || 3000;

store.init(auth.ensureAdmin)
  .then(() => {
    http.createServer(handle).listen(PORT, () => console.log(`MPM Digital ${role === "admin" ? "ADMIN" : "shop"} running on http://localhost:${PORT}`));
  })
  .catch((e) => { console.error("Could not open the database:", e.message); process.exit(1); });
