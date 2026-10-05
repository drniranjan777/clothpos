import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { ProductArt } from '../../components/ProductArt';
import { PrintPortal, SaleDetail, ThermalReceipt } from '../../components/Receipt';
import { Confirm, Modal, useDebounced, useToast } from '../../components/ui';
import { ApiError, del, get, Paged, post } from '../../lib/api';
import { CachedCatalog, findInCatalog, loadCatalog, nextOfflineRef, queuePut, refreshCatalog, saveCatalog, useOfflineSync } from '../../lib/offline';
import { useAuth } from '../../lib/auth';
import { computeBill } from '../../lib/billing';
import { fmtTime, inr, initials } from '../../lib/format';
import '../../styles/pos.css';
import '../../styles/receipt.css';
import { DiscountModal, OpenShift, PaymentModal, SaleDone, VariantPicker } from './PosModals';
import { BillDiscount, CartLine, PosCustomer, PosProduct, PosVariant, variantLabel } from './types';

interface Category { id: string; name: string; productCount: number }
interface PriceList { id: string; name: string; isDefault: boolean }
interface Held { id: string; label?: string; customerName?: string; itemCount: number; total: number; createdAt: string; userName?: string; payload: Draft }
interface Shift { id: string; shiftNo: number; counter: number; openedAt: string }
interface Draft { lines: CartLine[]; billDiscount: BillDiscount; customer: PosCustomer | null; priceListId: string }

const BILLABLE = ['trial', 'active', 'payment_pending', 'past_due', 'grace'];
const draftKey = (storeId: string) => `clothpos.cart.${storeId}`;

/** Short confirmation beep for scans (a failed scan beeps low). */
function beep(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1800 : 300;
    g.gain.value = 0.05;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.07 : 0.25));
    o.onended = () => ctx.close();
  } catch {
    /* audio not available */
  }
}

export default function PosPage() {
  const { me, store, logout, can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const storeId = store?.id ?? '';
  const settings = me?.settings;
  const allowNegative = !!settings?.allowNegativeStock;
  const billable = !!me?.subscription && BILLABLE.includes(me.subscription.status) && me.tenant?.status === 'active';
  const isManager = can('tenant_admin', 'store_manager');

  // ---- catalogue
  const [cats, setCats] = useState<Category[]>([]);
  const [cat, setCat] = useState<string>('popular');
  const [search, setSearch] = useState('');
  const q = useDebounced(search, 250);
  const [products, setProducts] = useState<PosProduct[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loadingGrid, setLoadingGrid] = useState(true);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);

  // ---- bill
  const [lines, setLines] = useState<CartLine[]>([]);
  const [billDiscount, setBillDiscount] = useState<BillDiscount>(null);
  const [customer, setCustomer] = useState<PosCustomer | null>(null);
  const [priceListId, setPriceListId] = useState('');
  const [mobile, setMobile] = useState('');
  const [newName, setNewName] = useState('');
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<{ ok: boolean; text: string; at: number } | null>(null);
  const [scanFx, setScanFx] = useState<'flash' | 'err' | ''>('');
  const [code, setCode] = useState('');

  // ---- session / ui
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);
  const [showShift, setShowShift] = useState(false);
  const [held, setHeld] = useState<Held[]>([]);
  const [menu, setMenu] = useState<'' | 'held' | 'nav'>('');
  const [picker, setPicker] = useState<PosProduct | null>(null);
  const [showDiscount, setShowDiscount] = useState(false);
  const [paying, setPaying] = useState<string | null>(null); // clientRef while the payment modal is open
  const [done, setDone] = useState<SaleDetail | null>(null);
  const [lastSale, setLastSale] = useState<SaleDetail | null>(null);
  const [reprint, setReprint] = useState(false);
  const [confirm, setConfirm] = useState<null | 'new' | 'cancel'>(null);
  const [holdLabel, setHoldLabel] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CachedCatalog | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [now, setNow] = useState(new Date());

  const scanRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);

  const offline = useOfflineSync((n) => {
    toast(`${n} offline sale${n === 1 ? '' : 's'} synced - invoice numbers assigned`, 'success');
    if (storeId) refreshCatalog(storeId).then((c) => c && setCatalog(c));
  });
  const online = offline.online;

  // ------------------------------------------------------------ loading
  // offline catalogue: show the cached copy at once, refresh it in the background and every 10 minutes
  useEffect(() => {
    if (!storeId) return;
    let alive = true;
    loadCatalog(storeId).then((c) => alive && c && setCatalog((cur) => cur ?? c)).catch(() => undefined);
    const pull = () => refreshCatalog(storeId).then((c) => alive && c && setCatalog(c));
    pull();
    const t = setInterval(pull, 10 * 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [storeId]);

  useEffect(() => {
    get<Category[]>('/pos/categories').then(setCats).catch(() => undefined);
    get<PriceList[]>('/pos/price-lists').then(setPriceLists).catch(() => undefined);
  }, []);

  const loadShift = useCallback(() => {
    if (!storeId) return;
    get<{ shift: Shift | null }>('/shifts/current', { storeId }).then((r) => {
      setShift(r.shift);
      if (!r.shift && me?.user.role === 'cashier') setShowShift(true);
    }).catch(() => undefined); // offline: shift status unknown - don't block billing
  }, [storeId, me?.user.role]);
  const loadHeld = useCallback(() => storeId && get<Held[]>('/pos/held', { storeId }).then(setHeld).catch(() => undefined), [storeId]);
  useEffect(() => { loadShift(); loadHeld(); }, [loadShift, loadHeld]);

  const loadGrid = useCallback(async (p = 1) => {
    if (!storeId) return;
    setLoadingGrid(true);
    try {
      const r = await get<Paged<PosProduct>>('/pos/products', { storeId, categoryId: cat === 'popular' ? undefined : cat, search: q || undefined, priceListId: priceListId || undefined, page: p, pageSize: 36 });
      setProducts((prev) => (p === 1 ? r.items : [...prev, ...r.items]));
      setPage(r.page);
      setPages(r.pages);
    } catch (e) {
      if (catalog && (!navigator.onLine || (e instanceof ApiError && e.status === 0))) {
        const term = q.trim().toLowerCase();
        const items = catalog.products.filter((p) => (cat === 'popular' || p.categoryId === cat) && (!term
          || [p.name, p.code, p.brand ?? ''].some((x) => x.toLowerCase().includes(term))
          || p.variants.some((v) => v.sku.toLowerCase().includes(term) || v.barcode === term)));
        setProducts(items);
        setPage(1);
        setPages(1);
      } else toast((e as Error).message, 'error');
    } finally {
      setLoadingGrid(false);
    }
  }, [storeId, cat, q, priceListId, toast, catalog]);
  useEffect(() => { loadGrid(1); }, [loadGrid]);

  // restore the unfinished bill of this store (survives refresh)
  useEffect(() => {
    if (!storeId) return;
    try {
      const d = JSON.parse(localStorage.getItem(draftKey(storeId)) ?? 'null') as Draft | null;
      setLines(d?.lines ?? []);
      setBillDiscount(d?.billDiscount ?? null);
      setCustomer(d?.customer ?? null);
      setMobile(d?.customer?.mobile ?? '');
      setPriceListId(d?.priceListId ?? '');
    } catch {
      /* ignore broken draft */
    }
  }, [storeId]);
  useEffect(() => {
    if (!storeId) return;
    try {
      localStorage.setItem(draftKey(storeId), JSON.stringify({ lines, billDiscount, customer, priceListId }));
    } catch {
      /* storage unavailable */
    }
  }, [storeId, lines, billDiscount, customer, priceListId]);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(t);
  }, []);

  // ------------------------------------------------------------ bill maths (mirror of the server)
  const interState = !!(customer?.gstin && me?.tenant?.stateCode && customer.gstin.slice(0, 2) !== me.tenant.stateCode);
  const bill = useMemo(() => computeBill(
    lines.map((l) => ({ unitPrice: l.variant.price, qty: l.qty, mrp: l.variant.mrp, gstRate: l.product.gstRate, itemDiscount: l.discount })),
    billDiscount, { interState, roundOff: settings?.roundOff ?? true },
  ), [lines, billDiscount, interState, settings?.roundOff]);
  const discountPct = bill.grossTotal ? ((bill.itemDiscount + bill.billDiscount) / bill.grossTotal) * 100 : 0;
  const stockIssues = lines.filter((l) => l.qty > l.variant.stock);
  const blocked = !allowNegative && stockIssues.length > 0;

  // ------------------------------------------------------------ cart actions
  const addVariant = useCallback((product: PosProduct, v: PosVariant, source: 'scan' | 'tap') => {
    setLines((prev) => {
      const existing = prev.find((l) => l.variant.id === v.id);
      const qty = (existing?.qty ?? 0) + 1;
      if (qty > v.stock && !allowNegative) {
        toast(`Only ${v.stock} of ${product.name} (${variantLabel(v)}) in stock`, 'error');
        beep(false);
        return prev;
      }
      if (source === 'scan') beep(true);
      const p = { id: product.id, name: product.name, gstRate: product.gstRate, artType: product.artType, artColor: product.artColor, imageUrl: product.imageUrl, hsnCode: product.hsnCode };
      return existing ? prev.map((l) => (l.variant.id === v.id ? { ...l, qty, variant: v } : l)) : [...prev, { variant: v, product: p, qty, discount: 0 }];
    });
    setLastAdded(v.id);
  }, [allowNegative, toast]);

  const scan = useCallback(async (raw: string) => {
    const c = raw.trim();
    if (!c || !storeId) return;
    setCode('');
    const fromCache = () => {
      const hit = findInCatalog(catalog, c);
      if (!hit) throw new Error(`No item found for barcode "${c}" (offline catalogue)`);
      return { product: hit.product, v: hit.variant };
    };
    try {
      let found: { product: PosProduct; v: PosVariant };
      if (!navigator.onLine && catalog) found = fromCache();
      else {
        try {
          const r = await get<{ product: PosProduct; variantId: string }>(`/pos/scan/${encodeURIComponent(c)}`, { storeId, priceListId: priceListId || undefined });
          found = { product: r.product, v: r.product.variants.find((x) => x.id === r.variantId)! };
        } catch (e) {
          if (e instanceof ApiError && e.status === 0 && catalog) found = fromCache();
          else throw e;
        }
      }
      addVariant(found.product, found.v, 'scan');
      setScanMsg({ ok: true, text: `${c} → ${found.product.name} · ${variantLabel(found.v)} added`, at: Date.now() });
      setScanFx('flash');
    } catch (e) {
      beep(false);
      setScanMsg({ ok: false, text: (e as Error).message, at: Date.now() });
      setScanFx('err');
    }
    setTimeout(() => setScanFx(''), 500);
  }, [storeId, priceListId, addVariant, catalog]);

  const setQty = (id: string, qty: number) => setLines((ls) => ls.map((l) => (l.variant.id === id ? { ...l, qty: Math.max(1, qty), discount: Math.min(l.discount, l.variant.price * Math.max(1, qty)) } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.variant.id !== id));
  const clearBill = useCallback(() => {
    setLines([]); setBillDiscount(null); setCustomer(null); setMobile(''); setNewName(''); setScanMsg(null);
    scanRef.current?.focus();
  }, []);

  // customer lookup as soon as 10 digits are typed (BRD §19 quick lookup)
  useEffect(() => {
    const m = mobile.replace(/\D/g, '');
    if (m.length !== 10) {
      if (customer && customer.mobile !== m) setCustomer(null);
      return;
    }
    if (customer?.mobile === m) return;
    get<{ customer: PosCustomer | null }>('/customers/lookup', { mobile: m }).then((r) => {
      setCustomer(r.customer ?? (newName ? { name: newName, mobile: m } : null));
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile]);
  const mobileDigits = mobile.replace(/\D/g, '');
  const needsName = mobileDigits.length === 10 && !customer?.id;

  // re-price the cart when the price list changes
  const changePriceList = async (id: string) => {
    setPriceListId(id);
    if (!lines.length) return;
    try {
      const repriced = await Promise.all(lines.map(async (l) => {
        const r = await get<{ product: PosProduct; variantId: string }>(`/pos/scan/${l.variant.barcode}`, { storeId, priceListId: id || undefined });
        return { ...l, variant: r.product.variants.find((v) => v.id === l.variant.id) ?? l.variant };
      }));
      setLines(repriced);
      toast('Cart re-priced for the selected price list', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  // ------------------------------------------------------------ hold / resume (F5 / F6)
  const hold = async (label: string) => {
    try {
      await post('/pos/held', { storeId, label: label || undefined, customerName: customer?.name, itemCount: lines.length, total: bill.total, payload: { lines, billDiscount, customer, priceListId } });
      toast('Bill held - resume it any time with F6', 'success');
      clearBill();
      loadHeld();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
    setHoldLabel(null);
  };
  const resume = async (h: Held) => {
    if (lines.length) return toast('Hold or finish the current bill before resuming another', 'error');
    setLines(h.payload.lines ?? []);
    setBillDiscount(h.payload.billDiscount ?? null);
    setCustomer(h.payload.customer ?? null);
    setMobile(h.payload.customer?.mobile ?? '');
    setPriceListId(h.payload.priceListId ?? '');
    setMenu('');
    await del(`/pos/held/${h.id}`).catch(() => undefined);
    loadHeld();
  };

  const startPayment = useCallback(() => {
    if (!lines.length) return toast('Scan an item first', 'error');
    if (!billable) return toast('Subscription inactive - billing is paused', 'error');
    if (!online && !catalog) return toast('You are offline and no catalogue is cached on this device yet', 'error');
    if (blocked) return toast('Some items exceed available stock', 'error');
    if (needsName && !newName.trim()) { mobileRef.current?.focus(); return toast('Enter the new customer name, or clear the mobile number', 'error'); }
    if (me?.user.role === 'cashier' && shift === null) { setShowShift(true); return; }
    setPaying(crypto.randomUUID());
  }, [lines.length, billable, online, blocked, needsName, newName, me?.user.role, shift, toast]);

  type Pay = { method: string; amount: number; tendered?: number; reference?: string };
  const saleBody = (payments: Pay[]) => ({
    storeId, counter: shift?.counter, clientRef: paying, priceListId: priceListId || undefined,
    ...(customer?.id ? { customerId: customer.id } : mobileDigits.length === 10 && newName.trim() ? { customer: { name: newName.trim(), mobile: mobileDigits } } : {}),
    items: lines.map((l) => ({ variantId: l.variant.id, qty: l.qty, discount: l.discount || undefined })),
    billDiscount: billDiscount ?? undefined,
    payments,
  });

  /** Offline sale: queued on this device with a provisional number; synced (and numbered) when back online. */
  const createOffline = async (payments: Pay[]): Promise<SaleDetail> => {
    const counter = shift?.counter ?? 1;
    const ref = nextOfflineRef(store!.code, counter);
    const at = new Date().toISOString();
    const body = saleBody(payments);
    const payload = { ...body, items: lines.map((l) => ({ variantId: l.variant.id, qty: l.qty, discount: l.discount || undefined, unitPrice: l.variant.price })), offline: { ref, at } };
    await queuePut({ clientRef: paying!, offlineRef: ref, storeId, createdAt: at, total: bill.total, itemCount: lines.length, customerName: customer?.name ?? (newName || undefined), payload, status: 'pending', attempts: 0 });
    // keep the cached stock honest until the next sync
    if (catalog) {
      const sold = new Map(lines.map((l) => [l.variant.id, l.qty]));
      const next = { ...catalog, products: catalog.products.map((p) => ({ ...p, variants: p.variants.map((v) => (sold.has(v.id) ? { ...v, stock: v.stock - sold.get(v.id)! } : v)) })) };
      setCatalog(next);
      saveCatalog(next).catch(() => undefined);
    }
    offline.refreshQueue();
    const change = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + Math.max(0, (p.tendered ?? p.amount) - p.amount), 0);
    return {
      id: paying!, invoiceNo: ref, offlineRef: ref, offline: true, status: 'completed', createdAt: at, counter,
      mrpTotal: bill.mrpTotal, grossTotal: bill.grossTotal, itemDiscount: bill.itemDiscount, billDiscount: bill.billDiscount, taxableAmount: bill.taxableAmount,
      cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst, roundOff: bill.roundOff, total: bill.total, paidAmount: bill.total + change, changeAmount: change,
      totalQty: bill.totalQty, itemCount: lines.length, isInterState: interState, loyaltyEarned: 0,
      store: { id: storeId, name: store!.name, code: store!.code, address: store!.address, phone: store!.phone, gstin: store!.gstin },
      customer: customer?.id ? { id: customer.id, name: customer.name, mobile: customer.mobile } : newName && mobileDigits.length === 10 ? { id: '', name: newName, mobile: mobileDigits } : null,
      cashier: { id: me!.user.id, name: me!.user.name },
      items: lines.map((l, i) => ({
        id: `${paying}-${i}`, variantId: l.variant.id, productName: l.product.name, sku: l.variant.sku, barcode: l.variant.barcode, size: l.variant.size, color: l.variant.color,
        hsnCode: l.product.hsnCode, qty: l.qty, mrp: l.variant.mrp, unitPrice: l.variant.price, itemDiscount: bill.lines[i].itemDiscount, billDiscount: bill.lines[i].billDiscount,
        gstRate: l.product.gstRate, taxableAmount: bill.lines[i].taxableAmount, taxAmount: bill.lines[i].taxAmount, lineTotal: bill.lines[i].lineTotal, returnedQty: 0,
      })),
      payments: payments.map((p, i) => ({ id: `${paying}-p${i}`, method: p.method, amount: p.amount, tendered: p.tendered ?? p.amount, reference: p.reference })),
    };
  };

  const createSale = async (payments: Pay[]) => {
    if (!navigator.onLine) return createOffline(payments);
    try {
      return await post<SaleDetail>('/sales', saleBody(payments));
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) return createOffline(payments); // connection dropped mid-sale
      throw e;
    }
  };

  // ------------------------------------------------------------ keyboard: F-keys + USB scanner (keyboard wedge)
  const anyModal = !!(picker || showDiscount || paying || done || confirm || holdLabel !== null || showShift || reprint);
  useEffect(() => {
    let buf = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
      if (/^F([1-9]|1[0-2])$/.test(e.key)) e.preventDefault(); // keep F5 from reloading the page
      if (anyModal) return;
      switch (e.key) {
        case 'F1': return lines.length ? setConfirm('new') : clearBill();
        case 'F2': return searchRef.current?.focus();
        case 'F3': return scanRef.current?.focus();
        case 'F4': return mobileRef.current?.focus();
        case 'F5': return lines.length && setHoldLabel('');
        case 'F6': return setMenu((m) => (m === 'held' ? '' : 'held'));
        case 'F7': return lines.length && setShowDiscount(true);
        case 'F8': return startPayment();
        case 'F9': return lastSale && setReprint(true);
        case 'F10': return lines.length && setConfirm('cancel');
        case 'Escape': return setMenu('');
      }
      // scanner typing while focus is not in a field: collect the burst and treat Enter as a scan
      if (typing) return;
      const ts = Date.now();
      if (ts - last > 120) buf = '';
      last = ts;
      if (e.key === 'Enter' && buf.length >= 4) { scan(buf); buf = ''; return; }
      if (e.key.length === 1) { buf += e.key; scanRef.current?.focus(); setCode(buf); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyModal, lines.length, clearBill, startPayment, scan, lastSale]);

  useEffect(() => { if (!anyModal) scanRef.current?.focus(); }, [anyModal]);

  // ------------------------------------------------------------ render
  const totalProducts = cat === 'popular' ? undefined : cats.find((c) => c.id === cat)?.productCount;
  const visible = inStockOnly ? products.filter((p) => p.variants.some((v) => v.stock > 0)) : products;
  const lastScanAgo = scanMsg ? Math.max(0, Math.round((now.getTime() - scanMsg.at) / 1000)) : null;

  return (
    <div className="pos">
      <div className="pos-head">
        <div className="pos-r1">
          <div style={{ position: 'relative' }}>
            <div className="hbtn" style={{ background: 'none', border: 0 }} onClick={() => setMenu(menu === 'nav' ? '' : 'nav')} title="Menu"><Icon name="menu" /></div>
            {menu === 'nav' && (
              <div className="menu" style={{ left: 0, right: 'auto' }}>
                {can('tenant_admin', 'store_manager') && <Link className="mi" to="/dashboard"><Icon name="dashboard" size={16} />Dashboard</Link>}
                <Link className="mi" to="/invoices"><Icon name="receipt" size={16} />Invoices &amp; reprint</Link>
                <Link className="mi" to="/returns"><Icon name="undo" size={16} />Returns &amp; exchange</Link>
                <Link className="mi" to="/customers"><Icon name="users" size={16} />Customers</Link>
                <Link className="mi" to="/shift"><Icon name="timer" size={16} />Close shift / day</Link>
                <div className="mi" onClick={async () => { await logout(); nav('/login'); }}><Icon name="logout" size={16} />Sign out</div>
              </div>
            )}
          </div>
          <div className="brand"><img src="/logo-light-compact.png" alt="NPOS" style={{ height: 34, display: 'block' }} /></div>
          <span className="pill" style={{ marginLeft: 14 }}><Icon name="store" size={14} />{store?.name}</span>
          <span className="pill" style={{ cursor: 'pointer' }} onClick={() => setShowQueue(true)} title="Offline queue">
            {!online ? <><i className="g" style={{ background: '#f97316', boxShadow: '0 0 0 3px rgba(249,115,22,.25)' }} />Offline{offline.pending ? ` · ${offline.pending} queued` : ' · billing locally'}</>
              : offline.pending ? <><i className="g" style={{ background: '#f59e0b' }} />{offline.busy ? 'Syncing' : 'Waiting to sync'} {offline.pending}</>
              : <><i className="g" />Online · Synced</>}
            {offline.failed > 0 && <span className="chip red nodot" style={{ marginLeft: 6, padding: '1px 7px' }}>{offline.failed} need review</span>}
          </span>
          {shift
            ? <span className="pill"><Icon name="timer" size={14} />Shift #{shift.shiftNo} · Counter {shift.counter} · {fmtTime(shift.openedAt)}</span>
            : shift === null && <span className="pill" style={{ cursor: 'pointer', color: '#fcd34d' }} onClick={() => setShowShift(true)}><Icon name="timer" size={14} />No open shift · Open</span>}
          <div className="grow" />
          <div className="hin" style={{ width: 210 }}><Icon name="search" size={16} />
            <input placeholder="Search Bill No." onKeyDown={(e) => { if (e.key === 'Enter' && e.currentTarget.value.trim()) nav(`/invoices?search=${encodeURIComponent(e.currentTarget.value.trim())}`); }} />
          </div>
          <div className="neworder" style={{ cursor: 'pointer' }} onClick={() => (lines.length ? setConfirm('new') : clearBill())}><span><Icon name="plus" size={16} />New Order <span className="kbd">F1</span></span></div>
          <div style={{ position: 'relative' }}>
            <div className="hbtn" title="Held bills (F6)" onClick={() => setMenu(menu === 'held' ? '' : 'held')}><Icon name="pause" />{held.length > 0 && <span className="dot" />}</div>
            {menu === 'held' && (
              <div className="menu">
                <div className="row between" style={{ padding: '6px 10px 8px' }}><b>Held bills</b><span className="muted" style={{ fontSize: 11 }}>F6</span></div>
                {held.length === 0 && <div className="muted" style={{ padding: '6px 10px 10px', fontSize: 12 }}>No bills on hold</div>}
                {held.map((h) => (
                  <div key={h.id} className="mi" onClick={() => resume(h)}>
                    <Icon name="receipt" size={16} />
                    <div className="grow"><b>{h.label || h.customerName || 'Held bill'}</b><div className="muted" style={{ fontSize: 11 }}>{h.itemCount} item{h.itemCount === 1 ? '' : 's'} · {fmtTime(h.createdAt)} · {h.userName}</div></div>
                    <b className="num">{inr(h.total)}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="hbtn" title="Refresh stock" onClick={() => { loadGrid(1); loadHeld(); }}><Icon name="refresh" /></div>
          <div className="row" style={{ gap: 8, marginLeft: 4 }}>
            <div className="av-s" style={{ background: '#f59e0b', color: '#fff', width: 34, height: 34 }}>{initials(me?.user.name)}</div>
            <div style={{ lineHeight: 1.25 }}><b style={{ fontSize: 12 }}>{me?.user.name}</b><div style={{ fontSize: 10.5, color: '#9aa8d6' }}>{me?.user.role === 'cashier' ? 'Cashier' : 'Manager'}{shift ? ` · Counter ${shift.counter}` : ''}</div></div>
          </div>
        </div>
        <div className="pos-r2">
          <div className="hin" style={{ width: 330 }}><Icon name="search" size={16} /><input ref={searchRef} placeholder="Search items, Category, SKU, Brand…" value={search} onChange={(e) => setSearch(e.target.value)} /><span className="kbd">F2</span></div>
          <div className={`scanbox ${scanFx}`}>
            <i className="c c1" /><i className="c c2" /><i className="c c3" /><i className="c c4" />
            <div className="in"><Icon name="barcode" />
              <input ref={scanRef} placeholder="Search Barcode…" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && scan(code)} aria-label="Barcode" />
              <span className="kbd">F3</span></div>
          </div>
          <div className="hin" style={{ width: 190 }}><Icon name="phone" size={16} />
            <input ref={mobileRef} placeholder="Customer mobile (F4)" inputMode="numeric" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/[^\d ]/g, '').slice(0, 11))} />
          </div>
          {customer?.id ? (
            <div className="hin" style={{ width: 250 }}><Icon name="user" size={16} /><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{customer.name}</b>
              <span className="chip nodot" style={{ marginLeft: 'auto', background: '#24346f', color: '#fcd34d', padding: '2px 7px' }}><Icon name="star" size={11} /> {customer.loyaltyPoints ?? 0} pts</span>
              {(customer.storeCredit ?? 0) > 0 && <span className="chip nodot" style={{ background: '#14532d', color: '#86efac', padding: '2px 7px' }}>₹{customer.storeCredit}</span>}
            </div>
          ) : needsName ? (
            <div className="hin" style={{ width: 250, borderColor: '#f59e0b' }}><Icon name="user_plus" size={16} /><input autoFocus placeholder="New customer name" value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
          ) : (
            <div className="hin" style={{ width: 250 }}><Icon name="user" size={16} /><span>Walk-in customer</span></div>
          )}
          <div className="grow" />
          <div className="hbtn" title="Clear customer" onClick={() => { setCustomer(null); setMobile(''); setNewName(''); }}><Icon name="x" /></div>
          <div className="hbtn" title="Discount (F7)" onClick={() => lines.length && setShowDiscount(true)}><Icon name="percent" /></div>
          <div className="hbtn" title="Reprint last receipt (F9)" onClick={() => lastSale ? setReprint(true) : toast('No receipt yet in this session')}><Icon name="printer" /></div>
        </div>
      </div>

      {!billable && <div className="banner danger"><Icon name="lock" size={16} />Subscription is not active — billing is paused. Your data is safe and read-only.</div>}

      <div className="pos-body">
        <div className="cats">
          <div className="t">Categories</div>
          <div className={cat === 'popular' ? 'on' : ''} onClick={() => setCat('popular')}>Most Popular<span>★</span></div>
          {cats.map((c) => <div key={c.id} className={cat === c.id ? 'on' : ''} onClick={() => setCat(c.id)}>{c.name}<span>{c.productCount}</span></div>)}
        </div>

        <div className="grid-wrap">
          <div className="row between">
            <div><b style={{ fontSize: 15 }}>{cat === 'popular' ? 'Most Popular' : cats.find((c) => c.id === cat)?.name}</b>
              <span className="muted" style={{ marginLeft: 6 }}>{q ? `results for “${q}”` : totalProducts !== undefined ? `${totalProducts} products` : 'best sellers first'}</span></div>
            <div className="pill-row"><span className={!inStockOnly ? 'on' : ''} onClick={() => setInStockOnly(false)}>All</span><span className={inStockOnly ? 'on' : ''} onClick={() => setInStockOnly(true)}>In stock</span></div>
          </div>
          <div className="pgrid">
            {visible.map((p) => {
              const stock = p.variants.reduce((s, v) => s + Math.max(0, v.stock), 0);
              // "Low" only when the product as a whole is running out, not when one size is
              const low = stock > 0 && stock <= p.variants.reduce((s, v) => s + v.minStock, 0);
              const sizesOut = p.variants.filter((v) => v.stock <= 0).length;
              const minP = Math.min(...p.variants.map((v) => v.price));
              const mrp = Math.max(...p.variants.map((v) => v.mrp));
              const sizes = [...new Set(p.variants.map((v) => v.size).filter(Boolean))] as string[];
              const inCart = lines.some((l) => l.product.id === p.id);
              return (
                <div key={p.id} className={`pc ${inCart ? 'sel' : ''} ${stock <= 0 ? 'out' : ''}`}
                  onClick={() => (p.variants.length === 1 ? addVariant(p, p.variants[0], 'tap') : setPicker(p))}>
                  <div className="img"><ProductArt type={p.artType} color={p.artColor} imageUrl={p.imageUrl} alt={p.name} /></div>
                  <span className={`stk ${stock <= 0 || low ? 'low' : ''}`}>{stock <= 0 ? 'Out of stock' : `${low ? 'Low · ' : ''}${stock} in stock${sizesOut && !low ? ` · ${sizesOut} out` : ''}`}</span>
                  <span className="add"><Icon name="plus" /></span>
                  <div className="nm" title={p.name}>{p.name}</div>
                  <div className="pr">{inr(minP)}{mrp > minP && <s>{inr(mrp)}</s>}</div>
                  <div className="sz">{sizes.slice(0, 5).map((s) => <i key={s} className={p.variants.filter((v) => v.size === s).every((v) => v.stock <= 0) ? 'x' : ''}>{s.replace('UK ', '')}</i>)}</div>
                </div>
              );
            })}
          </div>
          {!loadingGrid && visible.length === 0 && <div className="empty"><Icon name="search" /><b>No products found</b><span>Try another category or search term</span></div>}
          {loadingGrid && <div className="loading"><div className="spinner" /></div>}
          {!loadingGrid && page < pages && <button className="btn" style={{ alignSelf: 'center' }} onClick={() => loadGrid(page + 1)}>Load more</button>}
        </div>

        <div className="cart">
          <div className="cart-top">
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>Price List</span>
            <select className="input" style={{ flex: 1, height: 34 }} value={priceListId} onChange={(e) => changePriceList(e.target.value)}>
              {priceLists.map((p) => <option key={p.id} value={p.isDefault ? '' : p.id}>{p.name}</option>)}
            </select>
            <span className="chip blue nodot" style={{ height: 28 }}>{store?.code} · New bill</span>
          </div>
          {scanMsg && (Date.now() - scanMsg.at < 8000) && (
            <div className="scan-toast" style={scanMsg.ok ? undefined : { background: 'var(--red-l)', color: 'var(--red)' }}>
              <Icon name={scanMsg.ok ? 'check' : 'alert'} size={16} /><span>{scanMsg.text}</span><span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.8 }}>just now</span>
            </div>
          )}
          <div className="cart-th"><span>Items</span><span style={{ textAlign: 'center' }}>Qty</span><span style={{ textAlign: 'right' }}>Sub Total</span><span /></div>
          <div className="cart-items">
            {lines.map((l) => {
              const short = l.qty > l.variant.stock;
              return (
                <div key={l.variant.id} className={`ci ${lastAdded === l.variant.id ? 'hl' : ''}`} style={short ? { background: 'var(--red-l)' } : undefined}>
                  <div className="info">
                    <div className="thumb"><ProductArt type={l.product.artType} color={l.product.artColor} imageUrl={l.product.imageUrl} /></div>
                    <div style={{ minWidth: 0 }}>
                      <b>{l.product.name}</b>
                      <div className="meta">{l.variant.size && <span>Size: <b style={{ display: 'inline', color: 'var(--text-2)' }}>{l.variant.size}</b></span>}{l.variant.color && <span><i className="sw" style={{ background: l.variant.colorHex }} />{l.variant.color}</span>}</div>
                      <div className="meta"><code>{l.variant.sku}</code>{inr(l.variant.price)}{l.variant.mrp > l.variant.price && <s className="strike">{inr(l.variant.mrp)}</s>}
                        {short ? <b style={{ color: 'var(--red)', display: 'inline' }}>only {l.variant.stock} left</b> : l.discount > 0 && <b style={{ color: 'var(--green)', display: 'inline' }}>−{inr(l.discount)}</b>}</div>
                    </div>
                  </div>
                  <div className="qty">
                    <span onClick={() => (l.qty > 1 ? setQty(l.variant.id, l.qty - 1) : remove(l.variant.id))}><Icon name="minus" /></span>
                    <input value={l.qty} inputMode="numeric" onChange={(e) => setQty(l.variant.id, Number(e.target.value.replace(/\D/g, '')) || 1)} aria-label="Quantity" />
                    <span onClick={() => setQty(l.variant.id, l.qty + 1)}><Icon name="plus" /></span>
                  </div>
                  <div className="st num">{inr(l.qty * l.variant.price - l.discount)}{l.variant.mrp > l.variant.price && <small>{inr(l.qty * l.variant.mrp)}</small>}</div>
                  <button className="del" onClick={() => remove(l.variant.id)} aria-label="Remove item"><Icon name="trash" size={16} /></button>
                </div>
              );
            })}
            <div style={{ margin: '10px 16px', border: '1.5px dashed var(--line)', borderRadius: 10, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, color: 'var(--faint)', fontSize: 12 }}>
              <Icon name="scan" size={20} /><span>{lines.length ? 'Scan next barcode or tap a product' : 'Scan a barcode or tap a product to start the bill'} — size, colour &amp; price come from the barcode</span>
            </div>
          </div>
          <div className="cart-sum num">
            <div>
              <div className="l"><span>Sub Total</span><b>{inr(bill.grossTotal, true)}</b></div>
              <div className="l"><span>Discount {discountPct > 0 ? `(${discountPct.toFixed(1)}%)` : ''}</span><b style={{ color: 'var(--green)' }}>{bill.itemDiscount + bill.billDiscount > 0 ? '− ' : ''}{inr(bill.itemDiscount + bill.billDiscount, true)}</b></div>
              {interState
                ? <div className="l"><span>IGST (incl.)</span><b>{inr(bill.igst, true)}</b></div>
                : <><div className="l"><span>CGST (incl.)</span><b>{inr(bill.cgst, true)}</b></div><div className="l"><span>SGST (incl.)</span><b>{inr(bill.sgst, true)}</b></div></>}
            </div>
            <div>
              <div className="l"><span>Round Off</span><b>{inr(bill.roundOff, true)}</b></div>
              <div className="l"><span>Customer saves vs MRP</span><b style={{ color: 'var(--green)' }}>{inr(Math.max(0, bill.savings), true)}</b></div>
              <div className="tq"><span>Total Qty<b>{bill.totalQty}</b></span><span>No. of Items<b>{lines.length}</b></span></div>
            </div>
            <div style={{ gridColumn: 1, alignSelf: 'end', fontSize: 11, color: discountPct > (settings?.cashierDiscountLimitPct ?? 10) && !isManager ? 'var(--red)' : 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="tag" size={14} />{isManager ? 'Manager · no discount limit' : `Discount limit ${settings?.cashierDiscountLimitPct ?? 10}% · used ${discountPct.toFixed(1)}%`}
            </div>
            <div className="payable"><span>Payable Amount</span><b>{inr(bill.total, true)}</b></div>
          </div>
          <div className="cart-act">
            <div className={lines.length ? '' : 'dis'} onClick={() => setHoldLabel('')}><Icon name="pause" />Hold <span className="kbd">F5</span></div>
            <div className={lines.length ? '' : 'dis'} onClick={() => setShowDiscount(true)}><Icon name="percent" />Add Discount <span className="kbd">F7</span></div>
            <div className={`go ${!lines.length || !billable || blocked ? 'dis' : ''}`} onClick={startPayment}>Confirm Payment <span className="kbd">F8</span><Icon name="arrow" /></div>
          </div>
        </div>
      </div>

      <div className="pos-foot">
        {[['F1', 'New Bill'], ['F2', 'Search'], ['F3', 'Scan'], ['F4', 'Customer'], ['F5', 'Hold'], ['F6', 'Resume'], ['F7', 'Discount'], ['F8', 'Payment'], ['F9', 'Print'], ['F10', 'Cancel'], ['F12', 'Complete Sale']].map(([k, l]) => <span key={k}><span className="kbd">{k}</span>{l}</span>)}
        <div className="r">
          <span><Icon name="printer" size={14} />Browser print · 80mm</span>
          <span><Icon name="barcode" size={14} />{lastScanAgo === null ? 'Scanner ready' : `Last scan ${lastScanAgo < 60 ? `${lastScanAgo}s` : `${Math.round(lastScanAgo / 60)}m`} ago`}</span>
          <span>{now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {fmtTime(now)}</span>
        </div>
      </div>

      {picker && <VariantPicker product={picker} allowNegative={allowNegative} onClose={() => setPicker(null)} onPick={(v) => { addVariant(picker, v, 'tap'); setPicker(null); }} />}
      {showDiscount && (
        <DiscountModal lines={lines} discount={billDiscount} gross={bill.grossTotal} isManager={isManager} limitPct={settings?.cashierDiscountLimitPct ?? 10}
          onClose={() => setShowDiscount(false)}
          onSave={(d, ld) => { setBillDiscount(d); setLines((ls) => ls.map((l) => ({ ...l, discount: Math.min(ld[l.variant.id] ?? 0, l.qty * l.variant.price) }))); setShowDiscount(false); }} />
      )}
      {paying && (
        <PaymentModal bill={bill} lines={lines} customer={customer ?? (needsName ? { name: newName, mobile: mobileDigits } : null)} billNo={`${store?.code} · new bill`}
          request={createSale} onClose={() => setPaying(null)}
          onDone={(sale) => {
            setPaying(null); setDone(sale); setLastSale(sale); clearBill();
            if (!sale.offline) { loadGrid(1); refreshCatalog(storeId).then((c) => c && setCatalog(c)); }
          }} />
      )}
      {done && <SaleDone sale={done} business={me?.tenant?.businessName ?? ''} gstin={me?.tenant?.gstin} stateCode={me?.tenant?.stateCode} roll={settings?.receiptWidth === 58 ? 58 : 80} footer={settings?.invoiceFooter} onNew={() => { setDone(null); scanRef.current?.focus(); }} />}
      {reprint && lastSale && <PrintPortal paper={settings?.receiptWidth === 58 ? 58 : 80} onDone={() => setReprint(false)}><ThermalReceipt sale={lastSale} business={me?.tenant?.businessName ?? ''} gstin={me?.tenant?.gstin} footer={settings?.invoiceFooter} width={settings?.receiptWidth === 58 ? 58 : 80} /></PrintPortal>}
      {showQueue && (
        <Modal title="Offline sales queue" icon="wifi" onClose={() => setShowQueue(false)} width={620}
          sub={online ? 'Connected - queued sales sync automatically every 30 seconds' : 'No internet - sales are saved on this device and sync when the connection returns'}
          footer={<><span className="muted grow" style={{ fontSize: 12 }}>Catalogue cached {catalog ? new Date(catalog.generatedAt).toLocaleString('en-IN') : 'never'}</span>
            <button className="btn" onClick={() => refreshCatalog(storeId).then((c) => c ? (setCatalog(c), toast('Catalogue refreshed', 'success')) : toast('Could not reach the server', 'error'))}><Icon name="refresh" />Refresh catalogue</button>
            <button className="btn primary" disabled={!online || offline.busy || !offline.pending} onClick={offline.sync}><Icon name="upi" />Sync now</button></>}>
          {offline.queue.length === 0 ? <div className="empty"><Icon name="check" /><b>Nothing waiting</b><span>All sales are on the server.</span></div> : (
            <table className="t">
              <thead><tr><th>Receipt</th><th>Time</th><th>Customer</th><th className="r">Total</th><th>Status</th><th /></tr></thead>
              <tbody>{offline.queue.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((q) => (
                <tr key={q.clientRef}><td><b>{q.offlineRef}</b><div className="muted" style={{ fontSize: 11 }}>{q.itemCount} item(s)</div></td><td>{fmtTime(q.createdAt)}</td><td>{q.customerName ?? 'Walk-in'}</td>
                  <td className="r num">{inr(q.total)}</td>
                  <td style={{ whiteSpace: 'normal', maxWidth: 200 }}>{q.status === 'pending' ? <span className="chip amber">Waiting</span> : <><span className="chip red">Needs review</span><div className="down" style={{ fontSize: 11, marginTop: 3 }}>{q.error}</div></>}</td>
                  <td className="r">{q.status === 'failed' && <span className="row" style={{ gap: 6 }}><button className="btn sm" onClick={() => offline.retry(q)}>Retry</button><button className="btn sm danger" onClick={() => window.confirm(`Discard ${q.offlineRef}? The sale will not reach the server - re-enter it manually.`) && offline.discard(q)}>Discard</button></span>}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Modal>
      )}
      {confirm && <Confirm title={confirm === 'new' ? 'Start a new bill?' : 'Cancel this bill?'} text={`The current bill with ${lines.length} item(s) will be cleared. Hold it (F5) instead if the customer is coming back.`}
        confirmLabel={confirm === 'new' ? 'Clear & start new' : 'Cancel bill'} danger onClose={() => setConfirm(null)} onConfirm={() => clearBill()} />}
      {holdLabel !== null && (
        <Modal title="Hold bill" icon="pause" sub={`${lines.length} item(s) · ${inr(bill.total)}`} width={420} onClose={() => setHoldLabel(null)}
          footer={<><button className="btn" onClick={() => setHoldLabel(null)}>Cancel</button><button className="btn primary" onClick={() => hold(holdLabel)}>Hold bill</button></>}>
          <div className="field"><label>Note so you can find it later (optional)</label>
            <input className="input" autoFocus placeholder="e.g. Lady in red saree - trying kurtis" value={holdLabel} onChange={(e) => setHoldLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && hold(holdLabel)} /></div>
        </Modal>
      )}
      {showShift && storeId && (
        <OpenShift storeId={storeId} counters={store?.counters ?? 1} required={me?.user.role === 'cashier'}
          onClose={me?.user.role === 'cashier' ? undefined : () => setShowShift(false)}
          onOpened={() => { setShowShift(false); loadShift(); }} />
      )}
    </div>
  );
}
