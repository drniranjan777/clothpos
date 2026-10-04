// End-to-end smoke test against a running API seeded with `npm run seed`.
// Creates real records (a sale, a return, a cancellation) - run it on a dev database only.
//   node scripts/smoke.mjs [http://localhost:4000/api]
const API = process.argv[2] ?? 'http://localhost:4000/api';
let failures = 0;

async function call(token, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!cond) failures++;
}
const login = async (login, password) => (await call(null, 'POST', '/auth/login', { login, password, returnRefreshToken: true })).data;

// ---- auth
const bad = await call(null, 'POST', '/auth/login', { login: 'vijay@vastrafashions.in', password: 'wrong' });
check('wrong password rejected', bad.status === 401);
const cashier = await login('vijay@vastrafashions.in', 'Cashier@1234');
check('cashier login', !!cashier.accessToken);
const byMobile = await login('98765 00001', 'Cashier@1234');
check('login by mobile number', !!byMobile.accessToken);
const me = (await call(cashier.accessToken, 'GET', '/auth/me')).data;
const store = me.stores?.[0];
check('me returns store + subscription', !!store && me.subscription?.status === 'active', `${store?.name} / ${me.subscription?.plan?.name}`);
const refreshed = await call(null, 'POST', '/auth/refresh', { refreshToken: cashier.refreshToken });
check('refresh token rotates', refreshed.status === 200 && !!refreshed.data.accessToken);
const graced = await call(null, 'POST', '/auth/refresh', { refreshToken: cashier.refreshToken });
check('just-rotated token still works for 30 s (parallel tabs)', graced.status === 200);
const throwaway = await login('vijay@vastrafashions.in', 'Cashier@1234');
await call(null, 'POST', '/auth/logout', { refreshToken: throwaway.refreshToken });
const afterLogout = await call(null, 'POST', '/auth/refresh', { refreshToken: throwaway.refreshToken });
check('refresh token is dead after sign-out', afterLogout.status === 401);
const T = refreshed.data.accessToken;

// ---- POS
const shift = (await call(T, 'GET', `/shifts/current?storeId=${store.id}`)).data.shift;
check('cashier has open shift', !!shift, shift && `#${shift.shiftNo} expected cash ₹${shift.summary.expectedCash}`);
const cats = (await call(T, 'GET', '/pos/categories')).data;
check('categories with counts', cats.length >= 10 && cats.every((c) => typeof c.productCount === 'number'));
const grid = (await call(T, 'GET', `/pos/products?storeId=${store.id}&pageSize=12`)).data;
check('product grid', grid.items?.length === 12 && grid.items[0].variants.length > 0);
const v1 = grid.items.flatMap((p) => p.variants).find((v) => v.stock > 3);
const scan = await call(T, 'GET', `/pos/scan/${v1.barcode}?storeId=${store.id}`);
check('barcode scan finds exact variant', scan.status === 200 && scan.data.variantId === v1.id, `${scan.data.product?.name} ${v1.size}/${v1.color}`);
const miss = await call(T, 'GET', `/pos/scan/0000000000000?storeId=${store.id}`);
check('unknown barcode -> 404', miss.status === 404);
const skuScan = await call(T, 'GET', `/pos/scan/${v1.sku.toLowerCase()}?storeId=${store.id}`);
check('SKU lookup (case-insensitive)', skuScan.data.variantId === v1.id);

const v2 = grid.items.flatMap((p) => p.variants).find((v) => v.stock > 3 && v.id !== v1.id);
const subtotal = v1.price * 2 + v2.price;
const total = Math.round(subtotal - 100);
const tooMuch = await call(T, 'POST', '/sales', { storeId: store.id, items: [{ variantId: v1.id, qty: 1 }], billDiscount: { type: 'percent', value: 25 }, payments: [{ method: 'cash', amount: 1 }] });
check('cashier discount limit enforced', tooMuch.status === 403, tooMuch.data.message);
const wrongPay = await call(T, 'POST', '/sales', { storeId: store.id, items: [{ variantId: v1.id, qty: 1 }], payments: [{ method: 'cash', amount: 1 }] });
check('payment must equal total', wrongPay.status === 400);
const clientRef = 'smoke-' + Date.now();
const saleReq = {
  storeId: store.id, clientRef,
  items: [{ variantId: v1.id, qty: 2 }, { variantId: v2.id, qty: 1 }],
  billDiscount: { type: 'flat', value: 100 },
  customer: { name: 'Smoke Test', mobile: '9' + String(Date.now()).slice(-9) },
  payments: [{ method: 'upi', amount: total - 500, reference: 'UTR-SMOKE' }, { method: 'cash', amount: 500, tendered: 1000 }],
};
const sale = await call(T, 'POST', '/sales', saleReq);
check('sale created', sale.status === 201, `${sale.data.invoiceNo} total ₹${sale.data.total} change ₹${sale.data.changeAmount}`);
const s = sale.data;
const taxOk = Math.abs(s.taxableAmount + s.cgst + s.sgst - s.total + s.roundOff) < 0.02;
check('GST split adds up (taxable + CGST + SGST = total)', taxOk, `taxable ${s.taxableAmount} cgst ${s.cgst} sgst ${s.sgst}`);
check('bill discount fully allocated', Math.abs(s.items.reduce((a, i) => a + i.billDiscount, 0) - 100) < 0.01);
check('change for cash tendered', s.changeAmount === 500);
const again = await call(T, 'POST', '/sales', saleReq);
check('same clientRef is not billed twice', again.data.id === s.id);
const after = await call(T, 'GET', `/pos/scan/${v1.barcode}?storeId=${store.id}`);
const stockAfter = after.data.product.variants.find((v) => v.id === v1.id).stock;
check('stock deducted', stockAfter === v1.stock - 2, `${v1.stock} -> ${stockAfter}`);

// held bills
const held = await call(T, 'POST', '/pos/held', { storeId: store.id, itemCount: 1, total: 999, label: 'smoke', payload: { items: [] } });
check('hold bill', held.status === 201);
await call(T, 'DELETE', `/pos/held/${held.data.id}`);

// ---- returns: cashier gets store credit only; manager can refund cash
const ret = await call(T, 'POST', '/returns', { saleId: s.id, refundMethod: 'cash', items: [{ saleItemId: s.items[0].id, qty: 1 }] });
check('cashier cannot refund cash', ret.status === 403);
const manager = await login('priya@vastrafashions.in', 'Manager@1234');
const ret2 = await call(manager.accessToken, 'POST', '/returns', { saleId: s.id, refundMethod: 'cash', reason: 'smoke', items: [{ saleItemId: s.items[0].id, qty: 1, reason: 'Size issue' }] });
check('manager cash refund', ret2.status === 201, `${ret2.data.returnNo} ₹${ret2.data.netAmount}`);
const over = await call(manager.accessToken, 'POST', '/returns', { saleId: s.id, refundMethod: 'cash', items: [{ saleItemId: s.items[0].id, qty: 2 }] });
check('cannot return more than sold', over.status === 400, over.data.message);
const cancel = await call(manager.accessToken, 'POST', `/sales/${s.id}/cancel`, { reason: 'smoke' });
check('invoice with returns cannot be cancelled', cancel.status === 400);

// ---- dashboards / reports / inventory
const owner = await login('anita@vastrafashions.in', 'Owner@1234');
const dash = (await call(owner.accessToken, 'GET', '/reports/dashboard')).data;
check('dashboard', dash.trend?.length === 14 && dash.today.bills > 0, `today ₹${dash.today.sales} / ${dash.today.bills} bills`);
const rep = await call(owner.accessToken, 'GET', '/reports/sales');
check('sales report', rep.status === 200 && rep.data.byCategory.length > 0, `net ₹${rep.data.current?.netSales} margin ${rep.data.current?.marginPct}%`);
const repCashier = await call(T, 'GET', '/reports/sales');
check('cashier blocked from sales report', repCashier.status === 403);
const inv = (await call(owner.accessToken, 'GET', '/inventory/summary')).data;
check('inventory summary', inv.skus > 0 && inv.outOfStock > 0, `skus ${inv.skus} low ${inv.lowStock} out ${inv.outOfStock}`);
const adj = await call(owner.accessToken, 'POST', '/inventory/adjustments', { storeId: store.id, variantId: v2.id, type: 'damage', qty: 1, reason: 'smoke test' });
check('stock adjustment', adj.status === 201, adj.data.referenceNo);
const cAdj = await call(T, 'POST', '/inventory/adjustments', { storeId: store.id, variantId: v2.id, type: 'damage', qty: 1, reason: 'smoke test' });
check('cashier cannot adjust stock', cAdj.status === 403);
const prods = (await call(owner.accessToken, 'GET', '/catalog/products?pageSize=5')).data;
check('product list', prods.total > 20);
const cust = (await call(owner.accessToken, 'GET', '/customers/lookup?mobile=9876543210')).data;
check('customer lookup by mobile', cust.customer?.name === 'Vijay Sharma');

// ---- tenant isolation & super admin
const admin = await login('admin@clothpos.in', 'Admin@1234');
const sa = (await call(admin.accessToken, 'GET', '/admin/dashboard')).data;
check('super admin dashboard', sa.total >= 17, `tenants ${sa.total} MRR ₹${sa.mrr}`);
const saOnTenant = await call(admin.accessToken, 'GET', '/sales');
check('super admin has no tenant data access', saOnTenant.status === 403);
const ownerOnAdmin = await call(owner.accessToken, 'GET', '/admin/tenants');
check('tenant owner cannot reach super admin', ownerOnAdmin.status === 403);
const otherOwner = await login('owner@kurtakraft.in', 'Owner@1234');
const otherSale = await call(otherOwner.accessToken, 'GET', `/sales/${s.id}`);
check('other tenant cannot read this invoice', otherSale.status === 404);
const suspended = await login('owner@ethnicelegance.in', 'Owner@1234');
const susMe = (await call(suspended.accessToken, 'GET', '/auth/me')).data;
const susStore = susMe.stores?.[0];
const susSale = await call(suspended.accessToken, 'POST', '/sales', { storeId: susStore.id, items: [{ variantId: v1.id, qty: 1 }], payments: [{ method: 'cash', amount: 1 }] });
check('suspended tenant cannot bill', susSale.status === 403, susSale.data.message);

// ================= Phase 2 =================
const O = owner.accessToken;
const stockOf = async (variant, storeId) => (await call(O, 'GET', `/pos/scan/${variant.barcode}?storeId=${storeId}`)).data.product.variants.find((v) => v.id === variant.id).stock;

// refresh token travels in an httpOnly cookie for browsers and is not exposed in the body
const raw = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'anita@vastrafashions.in', password: 'Owner@1234' }) });
const setCookie = raw.headers.get('set-cookie') ?? '';
const rawBody = await raw.json();
check('login sets httpOnly refresh cookie', /npos_rt=/.test(setCookie) && /HttpOnly/i.test(setCookie) && /Path=\/api\/auth/i.test(setCookie));
check('browser login body has no refresh token', !rawBody.refreshToken && !!rawBody.accessToken);
const viaCookie = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json', cookie: setCookie.split(';')[0] }, body: '{}' });
check('refresh works from the cookie', viaCookie.status === 200 && !!(await viaCookie.json()).accessToken);

// purchases: create + receive raises stock and updates cost; payment settles the bill
const sup = await call(O, 'POST', '/suppliers', { name: 'Smoke Supplier ' + Date.now(), gstin: '29AABCS1234K1Z2', paymentTermsDays: 30 });
check('create supplier', sup.status === 201, sup.data.message);
const before = await stockOf(v2, store.id);
const po = await call(O, 'POST', '/purchases', { storeId: store.id, supplierId: sup.data.id, supplierInvoiceNo: 'SMK-1', items: [{ variantId: v2.id, qty: 10, unitCost: 410 }], otherCharges: 100, receive: true });
check('purchase received', po.status === 201 && po.data.status === 'received', `${po.data.purchaseNo} total ₹${po.data.total}`);
check('purchase GST is exclusive (4100 + 5% + 100)', po.data.total === 4405);
const afterPo = await stockOf(v2, store.id);
check('purchase added stock', afterPo === before + 10, `${before} -> ${afterPo}`);
const supAfter = await call(O, 'POST', `/suppliers/${sup.data.id}/payments`, { amount: 3000, method: 'bank', reference: 'NEFT1' });
check('supplier payment allocated to the bill', supAfter.data.outstanding === 1405 && supAfter.data.purchases[0].paidAmount === 3000, `outstanding ₹${supAfter.data.outstanding}`);
const draft = await call(O, 'POST', '/purchases', { storeId: store.id, supplierId: sup.data.id, items: [{ variantId: v2.id, qty: 1, unitCost: 400 }] });
const cancelDraft = await call(O, 'POST', `/purchases/${draft.data.id}/cancel`, { reason: 'smoke' });
check('draft purchase can be cancelled', cancelDraft.data.status === 'cancelled');
const cashierPo = await call(T, 'POST', '/purchases', { storeId: store.id, supplierId: sup.data.id, items: [{ variantId: v2.id, qty: 1, unitCost: 1 }] });
check('cashier cannot create purchases', cashierPo.status === 403);
const starter = await login('owner@littlethreadskids.in', 'Owner@1234');
const gated = await call(starter.accessToken, 'GET', '/suppliers');
check('Starter plan has no purchases module', gated.status === 403, gated.data.message);

// transfers: dispatch removes stock at MG, receive (with a shortage) adds at IN
const stores = (await call(O, 'GET', '/stores')).data;
const inStore = stores.find((s) => s.code === 'IN');
const tr = await call(O, 'POST', '/transfers', { fromStoreId: store.id, toStoreId: inStore.id, items: [{ variantId: v2.id, qty: 3 }], dispatch: true });
check('transfer dispatched', tr.status === 201 && tr.data.status === 'in_transit', tr.data.transferNo);
check('dispatch removed stock at source', (await stockOf(v2, store.id)) === afterPo - 3);
const inBefore = await stockOf(v2, inStore.id);
const rec = await call(O, 'POST', `/transfers/${tr.data.id}/receive`, { items: [{ itemId: tr.data.items[0].id, receivedQty: 2 }] });
const inAfter = await stockOf(v2, inStore.id);
check('receive adds what arrived and records the shortage', rec.data.status === 'received' && inAfter === inBefore + 2 && /Short/.test(rec.data.notes ?? ''), rec.data.notes);
const tooMany = await call(O, 'POST', '/transfers', { fromStoreId: store.id, toStoreId: inStore.id, items: [{ variantId: v2.id, qty: 99999 }], dispatch: true });
check('cannot dispatch more than in stock', tooMany.status === 400);

// settings & price lists
const rules = await call(O, 'PATCH', '/settings/rules', { cashierDiscountLimitPct: 12 });
check('owner updates billing rules', rules.data.rules?.cashierDiscountLimitPct === 12);
await call(O, 'PATCH', '/settings/rules', { cashierDiscountLimitPct: 10 });
const mgrRules = await call(manager.accessToken, 'PATCH', '/settings/rules', { cashierDiscountLimitPct: 50 });
check('manager cannot change billing rules', mgrRules.status === 403);
const pl = await call(O, 'POST', '/price-lists', { name: 'Smoke list ' + Date.now() });
const rule = await call(O, 'POST', `/price-lists/${pl.data.id}/apply-rule`, { basis: 'mrp', percentOff: 20, roundTo9: true });
check('price rule applied', rule.data.set > 100, `${rule.data.set} prices`);
const plPage = await call(O, 'GET', `/price-lists/${pl.data.id}/prices?pageSize=5&search=shirt`);
check('price list editor page', plPage.status === 200 && plPage.data.items.length > 0 && plPage.data.items.every((r) => r.listPrice > 0), plPage.data.message);
const priced = (await call(T, 'GET', `/pos/scan/${v1.barcode}?storeId=${store.id}&priceListId=${pl.data.id}`)).data.product.variants.find((v) => v.id === v1.id);
check('POS uses the price list (ends in 9)', priced.price % 10 === 9 && priced.price <= priced.mrp, `₹${priced.price}`);
const dupStore = await call(O, 'POST', '/stores', { name: 'Dup', code: 'MG' });
check('duplicate store code rejected', dupStore.status === 409);

// offline sync: provisional number, idempotent retry, negative stock flagged instead of rejected
const cat = await call(T, 'GET', `/pos/catalog?storeId=${store.id}`);
check('offline catalogue', cat.status === 200 && cat.data.products.length > 20);
const lowV = cat.data.products.flatMap((p) => p.variants).find((v) => v.stock > 0 && v.stock < 6 && v.price <= 1000) ?? v1;
const offRef = 'smoke-off-' + Date.now();
const offQty = lowV.stock + 2;
const offReq = { storeId: store.id, clientRef: offRef, offline: { ref: 'OFF-MG2-0001', at: new Date(Date.now() - 3600e3).toISOString() },
  items: [{ variantId: lowV.id, qty: offQty, unitPrice: lowV.price }], payments: [{ method: 'cash', amount: lowV.price * offQty }] };
const off = await call(T, 'POST', '/sales', offReq);
check('offline sale synced', off.status === 201 && off.data.offlineRef === 'OFF-MG2-0001', off.data.message ?? off.data.invoiceNo);
check('oversold offline sale flagged, not rejected', off.data.stockConflict === true);
const offAgain = await call(T, 'POST', '/sales', offReq);
check('offline retry does not duplicate', offAgain.data.id === off.data.id);
const stale = await call(T, 'POST', '/sales', { ...offReq, clientRef: offRef + 'x', offline: { ref: 'OFF-MG2-0002', at: '2020-01-01T00:00:00Z' } });
check('offline sale outside sync window rejected', stale.status === 400);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
