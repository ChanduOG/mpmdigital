# MPM Digital

A complete household-products business: a **shop** for everyday shoppers and approved trade buyers, and a
separate **back office** where you run everything (orders, stock, products, finances, customers, settings).

Both apps live in this one repo, share one database, and are **deployed separately** (two Vercel projects).
**Going live:** follow [SETUP-VERCEL.md](SETUP-VERCEL.md).

## Run it on your computer
Requires Node.js 22.9+.

```bash
npm install
cp .env.example .env
```
Edit `.env` (admin email and password), then start each app in its own terminal:

```bash
npm start
```
```bash
npm run admin
```
- Shop: http://localhost:3000
- Back office: http://localhost:3001

Locally the database is the file `data/mpm.db`. To start over, stop both apps and delete the `data/` folder.

## The shop
- **Home and Business modes:** retail prices per item (incl. VAT) for everyone; wholesale case prices, volume tiers,
  bulk order sheet and quotes **only for approved trade accounts**. The server never sends wholesale prices to anyone else.
- **Checkout:** a step tracker; contact, delivery (courier or optional free collection) and payment cards; live order summary
  with photos and quantity controls; **discount codes**; free-delivery progress; totals calculated by the server; form
  remembered if the customer leaves; mobile summary toggle.
- **Payments:** EFT with bank details and order reference, plus 30-day account for approved trade customers.
  Card and Instant EFT plug in later (see below).
- **Accounts:** register, sign in, order history, profile, trade applications. Plus the newsletter.
- **Experience:** branded loading screen, smooth scrolling and scroll animations, real product photos,
  and anonymous, cookie-free visitor analytics.

## The back office (separate app)
| Section | What you can do |
|---|---|
| **Dashboard** | revenue, orders, visitors, conversion and average order vs the previous period; needs-attention list; low stock |
| **Traffic** | visits and page views, shopping funnel, top pages and products, traffic sources, devices, countries |
| **Sales** | revenue per day (home vs trade), best sellers, order statuses, payment methods |
| **Finances** | money received, awaiting EFT (with one-click "Mark paid"), owed on 30-day accounts and by whom, VAT collected, discounts given, **cost of goods and gross profit**, month-by-month table, stock value, **export for your accountant** |
| **Orders** | search and filter; status and payment; notes; **refund** (returns stock); **print invoice / packing slip**; CSV |
| **Quotes & messages** | quote requests and contact messages |
| **Products** | add or edit everything, including **cost price** with profit per unit; photos; visibility; specs; CSV |
| **Inventory** | receive stock (in units or cases), record damaged stock and stock counts; full **stock movement history** |
| **Categories** | add, rename, reorder, recolour, change icon, delete |
| **Discount codes** | % or Rand off, minimum spend, home or trade only, start/end dates, usage limits, usage stats |
| **Customers** | history, edit details, grant or revoke trade pricing, CSV |
| **Trade accounts** | approve, reject or revoke applications |
| **Subscribers** | newsletter list with CSV |
| **Settings** | store details, EFT bank details, delivery fees, collection, delivery time text, volume discount tiers, payment methods, announcement bar |
| **Team** | add or remove admins; change your password |

## Payments and email (to connect later)
- **Card / Instant EFT:** `server/payments.js` (switched off until configured; checkout only shows enabled methods).
- **Order emails:** `server/notify.js`.

## Project layout
```
api/index.js            Vercel entry point (runs the shop OR the admin, depending on APP_ROLE)
server/
  app.js                request handler (loads only the store API or only the admin API)
  store-api.js          shop API: catalogue, checkout, orders, accounts, tracking
  admin-api.js          back-office API: everything in the table above
  core.js               shared helpers (pricing on the server, discounts, stock log)
  db.js                 database (local file or Turso), schema, upgrades, first-run seed
  auth.js settings.js analytics.js payments.js notify.js
  seed/catalog.json     starter categories and products
scripts/build.js        packages one app into dist/<app> (the shop build has no admin files)
public/                 source files for both apps (index.html = shop, admin.html = back office)
  assets/js/pricing.js  pricing rules shared by the browser and the server
```

## Going-live checklist
- [ ] Follow [SETUP-VERCEL.md](SETUP-VERCEL.md): Turso, both projects, Blob, environment variables.
- [ ] Back office → Settings: store details, bank details, delivery fees.
- [ ] Back office → Products: set your selling prices, cost prices and stock for the Grace Home range.
- [ ] Add real customer reviews once you have them.
- [ ] Add terms, privacy policy (POPIA) and returns policy pages.
- [ ] Connect a card payment gateway and order emails.
