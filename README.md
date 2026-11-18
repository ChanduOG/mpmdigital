# MPM Digital — household products store

A working online store for **everyday shoppers and wholesale buyers**, in pink, burgundy and light purple.
It runs on Node.js with a SQLite-compatible database (a local file in development, [Turso](https://turso.tech) when hosted on Vercel).

## Run it
Requires Node.js 22.9 or newer.

```bash
npm install
cp .env.example .env      # then edit .env (admin email/password, bank details)
npm start
```
- Shop: http://localhost:3000
- Admin: http://localhost:3000/admin (sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`)

On first start the database (`data/mpm.db`) is created and filled with the starter catalogue and photos.
To start over, stop the server, delete the `data/` folder, and start it again.

## Hosting on Vercel
Vercel serves `public/` as the website and runs the API from `api/index.js` as a serverless function (`vercel.json` wires this up).
Vercel's disk is temporary, so the store needs two free add-ons. Set both up once in the Vercel dashboard:

1. **Database (Turso):** Project → **Storage** (or **Integrations → Marketplace**) → add **Turso**, create a database and connect it to this project.
   This adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. (Or create a database at turso.tech and add those two variables yourself.)
2. **Photo uploads (Blob):** Project → **Storage** → **Create** → **Blob** → connect to this project. This adds `BLOB_READ_WRITE_TOKEN`.
3. **Environment variables:** Project → **Settings → Environment Variables**: add `ADMIN_EMAIL`, `ADMIN_PASSWORD` (10+ chars),
   `STORE_EMAIL`, `BANK_NAME`, `BANK_ACCOUNT_NAME`, `BANK_ACCOUNT_NUMBER`, `BANK_BRANCH_CODE`.
4. **Redeploy** (Deployments → ⋯ → Redeploy). On first request the tables are created, the starter catalogue is loaded and your admin account is made.

Check it at `https://<your-site>/api/health`: it should say `"database":"connected"`.
Until the database is connected, the site runs in **preview mode**: products show, but checkout and sign-in politely say ordering isn't open yet.

## What works
**Shop**
- Two ways to shop: **Home** (single items at retail prices incl. VAT) and **Business** (by the case, with volume tiers of up to 22% off, an ex/incl VAT toggle, a bulk order sheet and quote requests).
- Live catalogue, prices and stock come from the database. Sold-out items can't be bought.
- **Checkout creates real orders.** The server recalculates every price and checks stock and minimum order quantities. Stock is reserved when an order is placed.
- EFT payment shows your banking details with the order reference. Approved trade customers can also pay on a **30-day account**.
- Customer accounts: register, sign in, order history and profile.
- Trade applications create a business account for review. Quote requests, contact messages and newsletter sign-ups are stored too.

**Admin dashboard (`/admin`)**
- **Overview:** revenue, orders awaiting payment, orders to ship, low stock.
- **Orders:** details, delivery address, status (awaiting payment → paid → processing → shipped → delivered, or cancelled) and internal notes. Cancelling an order returns its stock.
- **Products:** edit prices, stock, case size, MOQ, badges and specs, upload photos, add new products, and hide or show products.
- **Trade accounts:** approve or reject applications. Approval unlocks 30-day terms at checkout.
- **Customers and subscribers:** lists you can export to CSV.

**Security basics:** hashed passwords (scrypt), HttpOnly session cookies, server-side price checks, CSRF protection,
login rate-limiting, a strict Content-Security-Policy, upload checks and an admin-only API.

## Connecting payments later
Everything payment-related is in **`server/payments.js`**:
- `card` and `instant-eft` are already defined but switched off. Implement `start()` (build the gateway redirect) and `notify()` (verify the gateway's callback, then call `markPaid(ref)`), then enable them in `.env` (`CARD_GATEWAY`, `INSTANT_EFT_GATEWAY`).
- Gateway callbacks arrive at `POST /api/payments/<method>/notify`.
- Checkout only offers methods that are enabled, so nothing appears until it's connected.

Emails (order confirmations, new-order alerts) are stubbed in **`server/notify.js`**. Connect SMTP or an email API there.

## Project layout
```
api/
  index.js       Vercel serverless entry (wraps server/app.js)
server/
  app.js         API + admin endpoints (shared by local server and Vercel)
  server.js      local web server (npm start)
  db.js          database (local file or Turso), schema and first-run seed
  auth.js        passwords, sessions, admin bootstrap
  payments.js    payment methods (plug gateways in here)
  notify.js      notifications (plug email in here)
  seed/catalog.json   starter categories & products
public/
  index.html     storefront
  admin.html     admin dashboard
  assets/js/pricing.js   pricing rules shared by the browser and the server
  assets/img/products/   starter product photos (see CREDITS.md)
data/            database + uploaded photos (created automatically, not committed)
```

## Pricing rules
Volume tiers, VAT and delivery thresholds are in `public/assets/js/pricing.js`. The server uses the same file,
so the shop and checkout always agree. Product prices are edited in the admin dashboard:
- **Wholesale price:** per unit, excl. VAT (tier 1)
- **Retail price (RRP):** per unit, incl. VAT (what home shoppers pay)

## Going live checklist
- [ ] On Vercel: connect Turso + Blob and set the environment variables (see above). Elsewhere: any Node host with a persistent disk for `data/`.
- [ ] HTTPS: automatic on Vercel. On other hosts, put it behind HTTPS and set `COOKIE_SECURE=1`.
- [ ] Set a strong `ADMIN_PASSWORD`, real bank details and `STORE_EMAIL` in `.env`.
- [ ] Replace the starter photos (Unsplash stand-ins, see `public/assets/img/products/CREDITS.md`) and the sample products with your suppliers' real lines.
- [ ] Replace the sample reviews and headline stats on the home page.
- [ ] Connect a payment gateway and email (see above).
- [ ] Add your terms, privacy policy (POPIA) and returns policy pages.
- [ ] Back up the database (Turso has point-in-time backups; locally, copy `data/mpm.db`).
