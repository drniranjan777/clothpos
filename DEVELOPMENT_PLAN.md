# Clothing Shop POS SaaS — Development Plan

Source of truth: `Clothing_Shop_POS_SaaS_BRD.docx` (v1.0) · UI/UX reference: `Clothing-POS-UI-Screens.pdf` and `ui/*.html`.

## Stack

| Layer | Choice |
|---|---|
| Backend | NestJS 11 · TypeScript · TypeORM 0.3 · REST (`/api`) |
| Database | PostgreSQL · database `clothpos` |
| Auth | JWT access (15 min) + rotating refresh token (7 days, hashed in DB) · bcrypt |
| Frontend | React 19 · Vite · TypeScript · React Router · design system ported from `ui/assets/app.css` |
| Hardware | USB keyboard-wedge barcode scanner (global key capture), browser print for 58/80 mm thermal receipts |

## Folder layout

```
backend/   NestJS API  (src/modules/<feature>, src/database/entities, src/database/seed.ts)
frontend/  React app   (src/pages, src/components, src/api)
ui/        Approved static HTML designs + PDF export script
```

## Multi-tenancy & security
- Every business table carries `tenant_id`; the tenant comes **only** from the signed JWT, never from the request body.
- Roles: `super_admin`, `tenant_admin`, `store_manager`, `cashier`, `inventory_user`, `accountant` — enforced by `@Roles()` guard.
- Store boundary: non-admin users act only on their assigned stores.
- Subscription guard: suspended / expired tenants keep read-only access but cannot create bills.
- No hard deletes for financial records — invoices are cancelled, returns are recorded; critical actions go to `audit_logs`.

## Phases

### Phase 1 — MVP foundation ✅ delivered 2026-10-04
1. Database schema for tenants, plans, subscriptions, stores, users, catalogue (category, brand, product, size/colour variant with SKU + barcode), price lists, inventory + stock ledger, customers, sales, payments, held bills, shifts, returns, audit logs.
2. Seed data: platform Super Admin, 3 plans, demo tenant *Vastra Fashions* with 2 stores, staff, products/variants, customers.
3. APIs: auth (login / refresh / logout / me), POS (barcode lookup, search, categories, held bills, create sale with GST + stock deduction), invoices, products & variants, inventory (ledger, adjustment, receive), customers, returns & exchanges, cashier shifts & day close, dashboard & reports, Super Admin (dashboard, tenants, plans, subscriptions).
4. Frontend screens from the PDF wired to the API, with an enhanced Login screen.
5. `npm run smoke` — 38 end-to-end API checks (billing maths, idempotency, stock, returns, roles, tenant isolation).

### Phase 2 — Hardening ✅ delivered 2026-10-05
1. Purchases & suppliers: GST-exclusive bills, draft/receive, cost update, due dates, FIFO supplier payments, outstanding/overdue.
2. Stock transfers between stores (dispatch / receive with shortages / cancel).
3. Staff & roles screen, store / invoice settings, billing rules, price-list management with bulk rules.
4. Plan-module enforcement on the API (purchases, multi-store).
5. TypeORM migrations instead of `synchronize`; seed runs the migrations.
6. httpOnly refresh-token cookie; access token in memory only.
7. Offline POS: IndexedDB catalogue + sale queue, idempotent sync, stock-conflict flagging.
8. Tests: 12 unit tests (billing + purchase maths), 65 API smoke checks, offline end-to-end browser test.

### Phase 3 — next
Supplier returns / debit notes (reverse a received purchase), a review screen for offline stock conflicts, purchase orders sent to suppliers before delivery, barcode label templates per printer, CI pipeline running the three test suites.

### Phase 4 — BRD Phase 2 items
Loyalty program, WhatsApp/email invoices, payment-gateway webhooks for subscriptions, advanced promotions, customer display, deeper analytics.

## Billing rules implemented (BRD §15)
- Prices are **GST-inclusive** (MRP/selling price includes tax). Taxable value = net ÷ (1 + rate).
- Item discount and bill discount (percent or flat); bill discount is spread across lines in proportion to their value so tax stays correct per HSN.
- Intra-state → CGST + SGST (half each); inter-state → IGST.
- Cashier discount limit (tenant setting, default 10 %) — larger discounts need manager role.
- Total rounded to nearest rupee; round-off stored.
- Invoice number `<STORE PREFIX>-<YEAR>-<5-digit seq>` generated inside the sale transaction (row lock on store).
- Stock is validated per store/variant; overselling is blocked unless the tenant enables `allowNegativeStock`.
