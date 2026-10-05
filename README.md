<img src="frontend/public/logo.png" alt="NPOS" height="80">

# NPOS — Clothing Shop POS & Barcode Billing SaaS

Multi-tenant retail POS for garment stores: barcode-first billing, size × colour variants, GST invoices, inventory, returns/exchanges, cashier shifts, reports, and a Super Admin console for tenants and subscriptions.

- Requirements: `Clothing_Shop_POS_SaaS_BRD.docx` (v1.0)
- Approved UI/UX: `Clothing-POS-UI-Screens.pdf` and `ui/*.html`
- Roadmap: [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)

| Folder | What |
|---|---|
| `backend/` | NestJS 11 REST API · TypeORM · PostgreSQL |
| `frontend/` | React 19 + Vite + TypeScript app (design system ported from `ui/`) |
| `ui/` | Static HTML design screens + PDF export script |

## Run it locally

Prerequisites: Node 20+ and PostgreSQL with an empty database named `clothpos`.

```bash
cd backend
cp .env.example .env      # then set DB_USER / DB_PASSWORD and the two JWT secrets
npm install
npm run seed              # DROPS all tables, rebuilds them from the migrations, loads demo data
npm run dev               # API on http://localhost:4000/api (applies pending migrations on start)
```

```bash
cd frontend
npm install
npm run dev               # app on http://localhost:5173 (proxies /api to :4000)
```

If another program already uses port 4000, run the API on another port and point the app at it:

```bash
cd backend && PORT=4100 npm run dev
cd frontend && API_URL=http://localhost:4100 npm run dev
```

### Demo accounts (created by `npm run seed`)

| Role | Login | Lands on |
|---|---|---|
| Cashier | `vijay@vastrafashions.in` | POS (shift #142 already open, counter 2) |
| Store manager | `priya@vastrafashions.in` | Dashboard |
| Owner / tenant admin | `anita@vastrafashions.in` | Dashboard (both stores) |
| Super Admin | `admin@clothpos.in` | SaaS console |

Passwords are in `backend/src/database/seed.ts` (`DEMO_PASSWORDS`). Staff can also sign in with their mobile number.

Sample barcode to try on the POS: `8901234000014` (Checked Casual Shirt · S · Maroon). Any USB keyboard-wedge scanner works without clicking a field first.

## Scripts

| Where | Command | Does |
|---|---|---|
| backend | `npm run dev` | API with watch mode |
| backend | `npm run build && npm start` | production build / run |
| backend | `npm run seed` | reset DB + demo data (dev only) |
| backend | `npm test` | unit tests for the GST billing and purchase maths |
| backend | `npm run smoke` | 65 end-to-end API checks against a running, seeded API (creates records) |
| backend | `npm run migration:generate -- src/database/migrations/<Name>` | new migration from entity changes |
| backend | `npm run migration:run` / `migration:revert` / `migration:show` | apply / undo / list migrations |
| frontend | `npm run dev` / `npm run build` | dev server / production bundle in `frontend/dist` |
| frontend | `npm run e2e:offline` | headless-Chrome test: bill offline, reconnect, sale syncs (needs both dev servers) |

## What is built

**POS (BRD §11–17, §25, §37)** — barcode/SKU scan with scanner keyboard capture, product grid by category and best sellers, size × colour picker, live GST-inclusive cart, item and bill discounts with cashier limit, price lists, customer lookup by mobile with loyalty points and store credit, hold/resume, split payments with cash change, 58/80 mm thermal receipt, F1–F12 shortcuts, unfinished bill survives a refresh.

**Back office** — dashboard, products & variants (EAN-13 barcodes, label printing, price edits audited), inventory (ledger, damage/found/recount adjustments, receive stock, low/out-of-stock), invoices (reprint, cancel with stock restore), returns & exchanges (window, reasons, refund vs store credit, size/colour exchange with price difference), customers, cashier shift open/close with denomination count, variance and manager approval, sales reports with CSV export.

**SaaS (BRD §5–8, §27)** — tenant onboarding, plans and feature matrix, per-tenant feature overrides, subscription lifecycle (trial → active → grace → suspended / expired, hourly job), extend / change plan / record renewal, suspend (signs users out), subscription payments, audit logs.

**Phase 2 — purchasing, multi-store & admin**
- **Purchases & suppliers (BRD §20):** supplier master with GSTIN and payment terms, GST-exclusive purchase bills (trade discount, freight, IGST for out-of-state suppliers), draft → receive into stock, cost prices updated from the bill, due dates, supplier payments settled oldest-bill-first, outstanding and overdue amounts.
- **Stock transfers:** store-to-store, dispatch removes stock at the source, the destination counts what arrived and shortages are recorded, cancel returns in-transit goods.
- **Staff & roles:** add staff, assign roles and stores, disable or reset passwords (signs them out), plan user limits.
- **Settings:** business profile, billing rules (cashier discount limit, round-off, negative stock, return window, loyalty rate, cash variance tolerance, receipt width/footer), stores with unique invoice prefixes, price lists with bulk rules ("10% off, ending in 9") and per-item prices.
- **Offline POS (BRD §23):** the store catalogue is cached in IndexedDB, barcodes keep scanning without internet, sales get a provisional `OFF-…` receipt and queue on the device, then sync automatically with a real invoice number; retries never double-bill, overselling offline is flagged for review instead of rejected.
- **Plan entitlements enforced on the server:** purchases and multi-store need the plan module (Starter tenants get a clear upgrade message).
- **Schema migrations** replace auto-sync; the seed builds the database through the same migrations.

**Security** — JWT access token kept in memory + rotating hashed refresh token in an **httpOnly, SameSite=strict cookie** (page scripts can't read it; 30 s grace for parallel tabs), role guard on every route, tenant id taken only from the token, store-level access checks, suspended/expired tenants are read-only, no hard deletes for financial records, idempotent sale creation (`clientRef`), stock rows locked during sales.

## API map

All routes are under `/api` and need `Authorization: Bearer <token>` except `auth/login|refresh|logout`.

| Area | Routes |
|---|---|
| Auth | `POST auth/login` · `POST auth/refresh` · `POST auth/logout` · `GET auth/me` |
| POS | `GET pos/categories` · `GET pos/products` · `GET pos/scan/:code` · `GET/POST/DELETE pos/held` |
| Sales | `POST sales` · `GET sales` · `GET sales/:id` · `GET sales/invoice/:no` · `POST sales/:id/cancel` |
| Returns | `POST returns` · `GET returns` · `GET returns/:id` |
| Catalogue | `catalog/products` (CRUD) · `catalog/products/:id/variants` · `PATCH catalog/variants/:id` · `catalog/categories|brands|sizes|colors` |
| Inventory | `GET inventory/summary|stock|ledger|lookup` · `POST inventory/adjustments` · `POST inventory/receive` |
| Customers | `GET customers` · `GET customers/stats|lookup` · `GET/PATCH customers/:id` · `POST customers` |
| Shifts | `GET shifts/current` · `POST shifts/open` · `POST shifts/:id/close` · `POST shifts/:id/approve` |
| Reports | `GET reports/dashboard` · `GET reports/sales` |
| Org | `GET stores` · `GET/POST users` · `PATCH users/:id` |
| Purchases | `GET/POST/PATCH suppliers` · `POST suppliers/:id/payments` · `GET/POST purchases` · `PATCH purchases/:id` · `POST purchases/:id/receive|cancel` |
| Transfers | `GET/POST transfers` · `POST transfers/:id/dispatch|receive|cancel` |
| Settings | `GET settings` · `PATCH settings/business|rules` · `POST stores` · `PATCH stores/:id` · `GET/POST/PATCH price-lists` · `GET/PUT price-lists/:id/prices` · `POST price-lists/:id/apply-rule` |
| Offline | `GET pos/catalog` · `POST sales` with `offline: { ref, at }` + `clientRef` |
| Super Admin | `admin/dashboard` · `admin/tenants` (+ `status`, `subscription`, `features`) · `admin/plans` · `admin/payments` · `admin/audit-logs` |

## Notes for production

- Keep `DB_SYNC=false`; ship schema changes as migrations (`DB_MIGRATE_ON_START=true` applies them when the API boots).
- Use long random `JWT_*` secrets; serve the frontend and API from the same origin over HTTPS and set `COOKIE_SECURE=true`.
- Non-browser API clients send `returnRefreshToken: true` on login to get the refresh token in the body instead of the cookie.
- `npm run seed` wipes the configured database — never point it at production.
