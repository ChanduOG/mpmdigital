// Payment methods. This is the single place to plug in payment connectors later.
//
// Each method has:
//   enabled()                 -> should checkout offer it?
//   start(order, ctx)         -> what the shopper sees after placing the order:
//                                { type: "instructions", ... }  e.g. EFT banking details
//                                { type: "redirect", url }       e.g. PayFast / Yoco / Peach hosted page
//                                { type: "none" }
//   (optional) notify(req, body) -> webhook/ITN handler that marks orders paid
//
// To add a gateway (e.g. PayFast): implement `start` to build the signed redirect URL,
// implement `notify` to verify the callback and call markPaid(ref, gatewayRef),
// then enable it via env (PAYFAST_MERCHANT_ID etc.).
"use strict";
const { db } = require("./db");

const env = (k, d = "") => (process.env[k] || d).trim();

const methods = {
  eft: {
    label: "EFT / bank transfer",
    note: "We'll show our banking details after you place your order. Your order ships once payment clears.",
    enabled: () => true,
    start: (order) => ({
      type: "instructions",
      title: "Pay by EFT",
      lines: [
        ["Bank", env("BANK_NAME", "Your bank name")],
        ["Account name", env("BANK_ACCOUNT_NAME", "MPM Digital")],
        ["Account number", env("BANK_ACCOUNT_NUMBER", "0000000000")],
        ["Branch code", env("BANK_BRANCH_CODE", "000000")],
        ["Reference", order.ref],
        ["Amount", `R${order.total.toFixed(2)}`],
      ],
      footer: "Please use your order reference as the payment reference and email proof of payment to " + env("STORE_EMAIL", "orders@example.com") + ".",
    }),
  },

  account: {
    label: "30-day trade account",
    note: "For approved trade accounts only.",
    enabled: () => true,
    allowed: (user) => !!user && user.trade_status === "approved",
    start: () => ({ type: "none", message: "This order has been placed on your 30-day account." }),
  },

  // ---- Payment connectors: switch on once configured ----------------------
  card: {
    label: "Card payment",
    note: "Visa and Mastercard through our secure payment gateway.",
    enabled: () => !!env("CARD_GATEWAY"),          // e.g. "payfast" | "yoco" | "peach"
    start: (order) => ({ type: "redirect", url: `/pay/${encodeURIComponent(order.ref)}` }), // TODO: real gateway URL
  },
  "instant-eft": {
    label: "Instant EFT",
    note: "Pay directly from your banking app.",
    enabled: () => !!env("INSTANT_EFT_GATEWAY"),   // e.g. "ozow" | "payfast"
    start: (order) => ({ type: "redirect", url: `/pay/${encodeURIComponent(order.ref)}` }), // TODO: real gateway URL
  },
};

function available(user) {
  return Object.entries(methods)
    .filter(([, m]) => m.enabled() && (!m.allowed || m.allowed(user)))
    .map(([id, m]) => ({ id, label: m.label, note: m.note }));
}

async function markPaid(ref, paymentRef = "") {
  await db.run(`UPDATE orders SET payment_status='paid', payment_ref=?, status=CASE WHEN status='pending_payment' THEN 'paid' ELSE status END, updated_at=datetime('now') WHERE ref=?`, paymentRef, ref);
}

module.exports = { methods, available, markPaid };
