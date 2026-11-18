/* ==========================================================================
   MPM Digital — pricing rules, shared by the browser AND the server.
   The server recalculates every order with this file, so prices shown in
   the shop and prices charged can never disagree.
   Tiers and delivery fees are editable in Admin → Settings; both sides call
   configure() with the saved values.
   ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MPMPricing = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VAT_RATE = 0.15;

  const DEFAULTS = {
    bizFreeDelivery: 5000,   // excl. VAT, orders that contain cases
    bizDeliveryFee: 450,     // excl. VAT
    homeFreeDelivery: 750,   // incl. VAT, home orders
    homeDeliveryFee: 99,     // incl. VAT
    tiers: [
      { min: 1,  off: 0,    label: "1–9 cases",   name: "Starter" },
      { min: 10, off: 0.08, label: "10–24 cases", name: "Trade" },
      { min: 25, off: 0.15, label: "25–49 cases", name: "Volume" },
      { min: 50, off: 0.22, label: "50+ cases",   name: "Distributor" },
    ],
  };
  const C = JSON.parse(JSON.stringify(DEFAULTS));

  /** Apply saved settings: { tiers?, bizFreeDelivery?, bizDeliveryFee?, homeFreeDelivery?, homeDeliveryFee? } */
  function configure(o = {}) {
    for (const k of ["bizFreeDelivery", "bizDeliveryFee", "homeFreeDelivery", "homeDeliveryFee"]) {
      const v = Number(o[k]);
      if (o[k] !== undefined && o[k] !== null && Number.isFinite(v) && v >= 0) C[k] = v;
    }
    if (Array.isArray(o.tiers) && o.tiers.length) {
      const t = o.tiers
        .map((x) => ({ min: Math.max(1, Math.round(Number(x.min))), off: Math.min(0.9, Math.max(0, Number(x.off))), name: String(x.name || "").slice(0, 30) }))
        .filter((x) => Number.isFinite(x.min) && Number.isFinite(x.off))
        .sort((a, b) => a.min - b.min);
      if (t.length) {
        t[0].min = 1;
        t.forEach((x, i) => { const nx = t[i + 1]; x.label = nx ? `${x.min}–${nx.min - 1} cases` : `${x.min}+ cases`; x.name = x.name || `Tier ${i + 1}`; });
        C.tiers = t;
      }
    }
  }

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const tierFor = (cases) => [...C.tiers].reverse().find((t) => cases >= t.min) || C.tiers[0];
  const nextTier = (cases) => C.tiers.find((t) => t.min > cases);
  const unitPrice = (p, cases = 1) => p.price * (1 - tierFor(cases).off);       // ex VAT, per unit, wholesale
  const bestUnit = (p) => p.price * (1 - C.tiers[C.tiers.length - 1].off);
  const retailEx = (p) => p.rrp / (1 + VAT_RATE);                              // ex VAT, per unit, retail
  const maxOff = () => Math.round(C.tiers[C.tiers.length - 1].off * 100);

  /** line = { id, kind: "case" | "each", qty } */
  const lineUnits = (p, l) => (l.kind === "case" ? p.pack * l.qty : l.qty);
  const lineEx = (p, l) => (l.kind === "case" ? unitPrice(p, l.qty) * p.pack * l.qty : retailEx(p) * l.qty);
  const lineListEx = (p, l) => (l.kind === "case" ? p.price * p.pack * l.qty : retailEx(p) * l.qty);

  /**
   * getProduct(id) -> product. Money values are ex VAT except `vat` and `total`.
   * opts.discountEx: discount (ex VAT) from a discount code, taken off the goods subtotal.
   * opts.collect:    customer collects, so no delivery fee.
   */
  function totals(lines, getProduct, opts = {}) {
    const hasCase = lines.some((l) => l.kind === "case");
    let list = 0, sub = 0;
    for (const l of lines) { const p = getProduct(l.id); if (!p) continue; list += lineListEx(p, l); sub += lineEx(p, l); }
    const discount = Math.min(sub, Math.max(0, Number(opts.discountEx) || 0));
    const goods = sub - discount;
    const freeAtEx = hasCase ? C.bizFreeDelivery : C.homeFreeDelivery / (1 + VAT_RATE);
    const fee = hasCase ? C.bizDeliveryFee : C.homeDeliveryFee / (1 + VAT_RATE);
    const delivery = opts.collect || goods === 0 || goods >= freeAtEx - 0.005 ? 0 : fee;
    const vat = (goods + delivery) * VAT_RATE;
    return { hasCase, list, sub, saving: list - sub, discount, goods, delivery, vat, total: goods + delivery + vat, freeAtEx };
  }

  return {
    VAT_RATE, DEFAULTS, configure,
    get TIERS() { return C.tiers; },
    get BIZ_FREE_DELIVERY() { return C.bizFreeDelivery; },
    get BIZ_DELIVERY_FEE() { return C.bizDeliveryFee; },
    get HOME_FREE_DELIVERY() { return C.homeFreeDelivery; },
    get HOME_DELIVERY_FEE() { return C.homeDeliveryFee; },
    round2, tierFor, nextTier, unitPrice, bestUnit, retailEx, maxOff, lineUnits, lineEx, lineListEx, totals,
  };
});
