// Local server:  npm start  ->  http://localhost:3000   (admin: /admin)
// On Vercel the same handler runs as a serverless function (see api/index.js).
"use strict";
const http = require("node:http");
const { handle } = require("./app");
const store = require("./db");
const auth = require("./auth");

const PORT = Number(process.env.PORT) || 3000;

store.init(auth.ensureAdmin)
  .then(() => {
    http.createServer(handle).listen(PORT, () => console.log(`MPM Digital running on http://localhost:${PORT}  (admin: /admin)`));
  })
  .catch((e) => { console.error("Could not open the database:", e.message); process.exit(1); });
