/* ==========================================================================
   MPM Digital — pricing rules, shared by the browser AND the server.
   The server recalculates every order with this file, so prices shown in
   the shop and prices charged can never disagree.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MPMPricing = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VAT_RATE = 0.15;
  const BIZ_FREE_DELIVERY = 5000;   // excl. VAT, orders that contain cases
  const BIZ_DELIVERY_FEE = 450;     // excl. VAT
  const HOME_FREE_DELIVERY = 750;   // incl. VAT, home orders
  const HOME_DELIVERY_FEE = 99;     // incl. VAT

  const TIERS = [
    { min: 1,  off: 0,    label: "1–9 cases",   name: "Starter" },
    { min: 10, off: 0.08, label: "10–24 cases", name: "Trade" },
    { min: 25, off: 0.15, label: "25–49 cases", name: "Volume" },
    { min: 50, off: 0.22, label: "50+ cases",   name: "Distributor" },
  ];

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const tierFor = (cases) => [...TIERS].reverse().find((t) => cases >= t.min) || TIERS[0];
  const nextTier = (cases) => TIERS.find((t) => t.min > cases);
  const unitPrice = (p, cases = 1) => p.price * (1 - tierFor(cases).off);       // ex VAT, per unit, wholesale
  const bestUnit = (p) => p.price * (1 - TIERS[TIERS.length - 1].off);
  const retailEx = (p) => p.rrp / (1 + VAT_RATE);                              // ex VAT, per unit, retail

  /** line = { id, kind: "case" | "each", qty } */
  const lineUnits = (p, l) => (l.kind === "case" ? p.pack * l.qty : l.qty);
  const lineEx = (p, l) => (l.kind === "case" ? unitPrice(p, l.qty) * p.pack * l.qty : retailEx(p) * l.qty);
  const lineListEx = (p, l) => (l.kind === "case" ? p.price * p.pack * l.qty : retailEx(p) * l.qty);

  /** getProduct(id) -> product. Returns all money values ex VAT except `total`/`vat`. */
  function totals(lines, getProduct) {
    const hasCase = lines.some((l) => l.kind === "case");
    let list = 0, sub = 0;
    for (const l of lines) { const p = getProduct(l.id); if (!p) continue; list += lineListEx(p, l); sub += lineEx(p, l); }
    const freeAtEx = hasCase ? BIZ_FREE_DELIVERY : HOME_FREE_DELIVERY / (1 + VAT_RATE);
    const fee = hasCase ? BIZ_DELIVERY_FEE : HOME_DELIVERY_FEE / (1 + VAT_RATE);
    const delivery = sub === 0 || sub >= freeAtEx - 0.005 ? 0 : fee;
    const vat = (sub + delivery) * VAT_RATE;
    return { hasCase, list, sub, saving: list - sub, delivery, vat, total: sub + delivery + vat, freeAtEx };
  }

  return { VAT_RATE, BIZ_FREE_DELIVERY, BIZ_DELIVERY_FEE, HOME_FREE_DELIVERY, HOME_DELIVERY_FEE, TIERS,
    round2, tierFor, nextTier, unitPrice, bestUnit, retailEx, lineUnits, lineEx, lineListEx, totals };
});
