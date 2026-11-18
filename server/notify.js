// Notifications (order confirmations, new-order alerts to the shop).
// Currently logs to the console. Connect an email service here later
// (e.g. SMTP via nodemailer, Resend, Postmark, SendGrid, or a WhatsApp API).
"use strict";

function notify(event, payload) {
  const summary = {
    "order.created": () => `New ${payload.type} ${payload.ref}: R${(payload.total || 0).toFixed(2)} from ${payload.customer?.email || "unknown"}`,
    "trade.applied": () => `Trade application from ${payload.business_name} (${payload.email})`,
    "order.status": () => `Order ${payload.ref} is now ${payload.status}`,
  }[event];
  console.log(`[notify] ${summary ? summary() : event}`);
  // TODO: send email to the customer and/or the shop here.
}

module.exports = { notify };
