# Going live on Vercel: step-by-step

MPM Digital is **two separate apps** built from the same GitHub repo:

| App | What it is | Vercel project | Address (example) |
|---|---|---|---|
| **Shop** | what customers see | `mpmdigital` (you already have this) | https://mpmdigital.vercel.app |
| **Back office** | your admin: orders, stock, finances, everything | a **new** project, e.g. `mpm-admin` | https://mpm-admin.vercel.app |

Both use the **same Turso database**, so an order placed in the shop appears in the back office instantly.
The shop contains no admin pages or admin code at all.

Time needed: about 15 minutes, once.

---

## Part 1: Create the database (Turso, free)

1. Go to **https://vercel.com** → open your **mpmdigital** project → **Storage** tab.
2. Click **Create Database** (or **Browse Marketplace**) → choose **Turso Cloud** → **Continue**.
3. Choose the **Free** plan ($0: 100 databases, 5 GB, 500 million reads and 10 million writes per month; that's plenty).
4. Name it `mpm-store`. Region: the closest one offered to South Africa (Europe, e.g. Frankfurt/London).
5. Connect it to **mpmdigital** and tick **Production, Preview, Development**. Leave the prefix empty/default.

Vercel adds `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the shop project for you.

## Part 2: Shop project settings

In **mpmdigital → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `APP_ROLE` | `store` |

Then **Deployments → ⋯ (latest) → Redeploy**.
Check **https://mpmdigital.vercel.app/api/health**: it should say `"app":"store","database":"connected"`.

## Part 3: Create the back-office project

1. On the Vercel dashboard click **Add New… → Project**.
2. **Import** the same GitHub repository (`mpmdigital`).
3. Project name: `mpm-admin` (this becomes `mpm-admin.vercel.app`; use any name you like).
4. Framework preset: **Other**. Leave Build/Output settings as they are (the repo's `vercel.json` handles them).
5. Open **Environment Variables** before deploying and add:

| Name | Value |
|---|---|
| `APP_ROLE` | `admin` |
| `ADMIN_EMAIL` | the email you'll sign in with |
| `ADMIN_PASSWORD` | a strong password, **10+ characters** |
| `STORE_URL` | `https://mpmdigital.vercel.app` (your shop's address) |

6. Click **Deploy**.

## Part 4: Connect the back office to the same database + photo storage

1. Open the **mpm-admin** project → **Storage** tab.
2. Find the `mpm-store` Turso database you made in Part 1 → **Connect Project** → choose **mpm-admin** (all environments).
   (If it isn't listed: open the database from the shop project's Storage tab and use **Connect Project** there, or copy
   `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` from the shop project's environment variables into the admin project.)
3. Still in **mpm-admin → Storage**: **Create Database → Blob** → name `mpm-photos` → connect to **mpm-admin**.
   This lets you upload product photos. (The shop just displays them; it doesn't need the token.)
4. **Deployments → ⋯ → Redeploy** the admin project.

## Part 5: Check everything

1. **https://mpm-admin.vercel.app/api/health** → `"app":"admin","database":"connected"`.
2. Open **https://mpm-admin.vercel.app** → sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
3. **Settings:** add your store details, bank details for EFT, delivery fees, and (optionally) collection.
4. **Products:** check prices, add your cost prices (for profit reports), upload real photos.
5. Place a small test order in the shop → it appears under **Orders** → **Refund** it (stock goes back).

## Optional: your own domain

- Shop: **mpmdigital → Settings → Domains** → add e.g. `mpmdigital.co.za`.
- Back office: **mpm-admin → Settings → Domains** → add e.g. `admin.mpmdigital.co.za`.
- Then update `STORE_URL` in the admin project and redeploy.

## Good to know

- **Security:** the back office has its own login and cookie, only accepts admin accounts, tells search engines not to
  index it, and isn't linked from the shop. Customer accounts can't sign in to it.
- **More admins:** in the back office go to **Team** (they create a shop account first, then you add their email).
- **Changing your admin password:** back office → **Team → Your password**.
- **Backups:** export orders/products/customers as CSV any time; Turso Free keeps 1 day of point-in-time restore
  (paid plans keep longer).
- **Usage:** visitor analytics write one small row per page view. 10 million writes a month is roughly 300 000 page views a
  day, so you're far below the free limit.
