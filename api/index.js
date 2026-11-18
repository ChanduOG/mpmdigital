// Vercel serverless entry point. All /api/* requests are rewritten here (see vercel.json).
const { handle } = require("../server/app");

module.exports = (req, res) => handle(req, res);
