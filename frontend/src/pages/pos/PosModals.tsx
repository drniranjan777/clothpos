import { useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { ProductArt } from '../../components/ProductArt';
import { Paper, PrintPortal, SaleDetail, TaxInvoiceA4, ThermalReceipt } from '../../components/Receipt';
import { Modal, useToast } from '../../components/ui';
import { post } from '../../lib/api';
import { BillResult } from '../../lib/billing';
import { inr, PAYMENT_LABEL } from '../../lib/format';
import { BillDiscount, CartLine, PosCustomer, PosProduct, PosVariant } from './types';

// ---------------------------------------------------------------- variant picker
/** Size × colour grid shown when a product with several variants is tapped (barcode scans skip this). */
export function VariantPicker({ product, onPick, onClose, allowNegative }: { product: PosProduct; onPick: (v: PosVariant) => void; onClose: () => void; allowNegative: boolean }) {
  const colors = [...new Set(product.variants.map((v) => v.color ?? '—'))];
  const sizes = [...new Set(product.variants.map((v) => v.size ?? '—'))];
  return (
    <Modal title={product.name} sub={`${product.code}${product.brand ? ' · ' + product.brand : ''} · pick size and colour`} onClose={onClose} width={620}>
      <div className="row" style={{ gap: 16, alignItems: 'flex-start' }}>
        <div className="thumb lg" style={{ width: 96, height: 96, borderRadius: 14 }}><ProductArt type={product.artType} color={product.artColor} imageUrl={product.imageUrl} /></div>
        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {colors.map((c) => {
            const hex = product.variants.find((v) => (v.color ?? '—') === c)?.colorHex;
            return (
              <div key={c}>
                <div className="row" style={{ gap: 8, marginBottom: 6, fontWeight: 600, fontSize: 12.5 }}><i style={{ width: 12, height: 12, borderRadius: 4, background: hex, border: '1px solid rgba(0,0,0,.15)' }} />{c}</div>
                <div className="variant-pick">
                  {sizes.map((s) => {
                    const v = product.variants.find((x) => (x.color ?? '—') === c && (x.size ?? '—') === s);
                    if (!v) return null;
                    const out = v.stock <= 0 && !allowNegative;
                    return (
                      <div key={v.id} className={out ? 'x' : ''} onClick={() => !out && onPick(v)} title={v.sku}>
                        <b>{s}</b>
                        <small style={{ color: v.stock <= 0 ? 'var(--red)' : v.stock <= v.minStock ? 'var(--amber)' : undefined }}>{v.stock <= 0 ? 'Out of stock' : `${v.stock} in stock`}</small>
                        <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 2 }}>{inr(v.price)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- discount
export function DiscountModal({ lines, discount, limitPct, isManager, gross, onSave, onClose }: {
  lines: CartLine[]; discount: BillDiscount; limitPct: number; isManager: boolean; gross: number;
  onSave: (d: BillDiscount, lineDiscounts: Record<string, number>) => void; onClose: () => void;
}) {
  const [type, setType] = useState<'flat' | 'percent'>(discount?.type ?? 'flat');
  const [value, setValue] = useState(discount?.value ? String(discount.value) : '');
  const [lineD, setLineD] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.variant.id, l.discount ? String(l.discount) : ''])));
  const itemTotal = Object.values(lineD).reduce((s, v) => s + (Number(v) || 0), 0);
  const billValue = Number(value) || 0;
  const billAmt = type === 'percent' ? ((gross - itemTotal) * billValue) / 100 : billValue;
  const pct = gross ? ((itemTotal + billAmt) / gross) * 100 : 0;
  const over = !isManager && pct > limitPct + 0.001;
  return (
    <Modal title="Discount" icon="percent" sub={`Your limit: ${isManager ? 'manager - no limit' : `${limitPct}% of the bill`}`} onClose={onClose} width={520}
      footer={<>
        <button className="btn" onClick={() => onSave(null, Object.fromEntries(lines.map((l) => [l.variant.id, 0])))}>Remove all</button>
        <button className="btn primary" disabled={over} onClick={() => onSave(billValue > 0 ? { type, value: billValue } : null, Object.fromEntries(Object.entries(lineD).map(([k, v]) => [k, Number(v) || 0])))}>Apply discount</button>
      </>}>
      <div className="field"><label>Bill discount</label>
        <div className="row" style={{ gap: 8 }}>
          <div className="tabs"><span className={type === 'flat' ? 'on' : ''} onClick={() => setType('flat')}>₹ Flat</span><span className={type === 'percent' ? 'on' : ''} onClick={() => setType('percent')}>% Percent</span></div>
          <input className="input" autoFocus inputMode="decimal" placeholder={type === 'flat' ? 'Amount in ₹' : 'Percent'} value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} style={{ flex: 1 }} />
        </div>
        <div className="pill-row" style={{ marginTop: 4 }}>{(type === 'flat' ? [50, 100, 200, 500] : [5, 10, 15]).map((q) => <span key={q} onClick={() => setValue(String(q))}>{type === 'flat' ? `₹${q}` : `${q}%`}</span>)}</div>
      </div>
      <div style={{ marginTop: 16, fontWeight: 600, fontSize: 12.5 }}>Item discounts (₹ off the line)</div>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto' }}>
        {lines.map((l) => (
          <div key={l.variant.id} className="row" style={{ gap: 10 }}>
            <span className="grow" style={{ fontSize: 12.5 }}>{l.product.name} <span className="muted">· {[l.variant.size, l.variant.color].filter(Boolean).join(' / ')} · {l.qty} × {inr(l.variant.price)}</span></span>
            <input className="input" style={{ width: 100, height: 32 }} inputMode="decimal" placeholder="₹ 0" value={lineD[l.variant.id] ?? ''} onChange={(e) => setLineD({ ...lineD, [l.variant.id]: e.target.value.replace(/[^\d.]/g, '') })} />
          </div>
        ))}
      </div>
      <div className="row between" style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: over ? 'var(--red-l)' : 'var(--bg)', color: over ? 'var(--red)' : undefined, fontSize: 12.5 }}>
        <span>Total discount {inr(itemTotal + billAmt, true)} · {pct.toFixed(1)}% of bill</span>
        {over && <b>Above your limit — ask a manager</b>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- payment
type Method = 'cash' | 'upi' | 'card' | 'wallet' | 'bank' | 'store_credit';
const METHODS: { id: Method; label: string; icon: string; sub: string }[] = [
  { id: 'cash', label: 'Cash', icon: 'cash', sub: 'Auto change calc' },
  { id: 'upi', label: 'UPI', icon: 'upi', sub: 'QR / VPA' },
  { id: 'card', label: 'Credit / Debit Card', icon: 'card', sub: 'POS terminal' },
  { id: 'wallet', label: 'Wallet', icon: 'wallet', sub: 'Paytm, PhonePe' },
  { id: 'bank', label: 'Bank Transfer', icon: 'bank', sub: 'NEFT / IMPS' },
  { id: 'store_credit', label: 'Store Credit', icon: 'gift', sub: '' },
];
interface PayRow { method: Method; amount: string; reference: string }

export function PaymentModal({ bill, lines, customer, billNo, request, onDone, onClose }: {
  bill: BillResult; lines: CartLine[]; customer: PosCustomer | null; billNo: string;
  request: (payments: { method: Method; amount: number; tendered?: number; reference?: string }[]) => Promise<SaleDetail>;
  onDone: (sale: SaleDetail) => void; onClose: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<PayRow[]>([{ method: 'cash', amount: String(bill.total), reference: '' }]);
  const [tendered, setTendered] = useState(String(bill.total));
  const [busy, setBusy] = useState(false);
  const credit = customer?.storeCredit ?? 0;

  const allocated = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const remaining = Math.round((bill.total - allocated) * 100) / 100;
  const cashRow = rows.find((r) => r.method === 'cash');
  const cashAmt = Number(cashRow?.amount) || 0;
  const change = cashRow ? Math.max(0, (Number(tendered) || 0) - cashAmt) : 0;
  const shortCash = !!cashRow && (Number(tendered) || 0) < cashAmt;
  const creditRow = rows.find((r) => r.method === 'store_credit');
  const overCredit = !!creditRow && (Number(creditRow.amount) || 0) > credit;
  const canPay = Math.abs(remaining) < 0.01 && !shortCash && !overCredit && !busy;

  const toggle = (m: Method) => {
    if (rows.some((r) => r.method === m)) {
      if (rows.length === 1) return;
      setRows(rows.filter((r) => r.method !== m));
      return;
    }
    // a newly added method takes whatever is still unpaid (store credit capped at the balance)
    const left = Math.max(0, bill.total - allocated);
    const amt = m === 'store_credit' ? Math.min(left, credit) : left;
    setRows([...rows, { method: m, amount: String(Math.round(amt * 100) / 100), reference: '' }]);
  };
  // typing a UPI/card/... amount re-balances the cash row so the split always adds up
  const setAmount = (i: number, v: string) => {
    let next = rows.map((x, j) => (j === i ? { ...x, amount: v } : x));
    const cashIdx = next.findIndex((x) => x.method === 'cash');
    if (cashIdx >= 0 && cashIdx !== i) {
      const others = next.reduce((s, x, j) => (j === cashIdx ? s : s + (Number(x.amount) || 0)), 0);
      next = next.map((x, j) => (j === cashIdx ? { ...x, amount: String(Math.max(0, Math.round((bill.total - others) * 100) / 100)) } : x));
    }
    setRows(next);
  };
  const setOnly = (m: Method) => setRows([{ method: m, amount: String(m === 'store_credit' ? Math.min(bill.total, credit) : bill.total), reference: '' }]);

  useEffect(() => {
    if (cashRow && (Number(tendered) || 0) < cashAmt) setTendered(String(cashAmt));
    // keep tendered >= cash part when the split changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cashAmt]);

  const complete = async () => {
    if (!canPay) return;
    setBusy(true);
    try {
      const sale = await request(rows.map((r) => ({
        method: r.method, amount: Number(r.amount), reference: r.reference || undefined,
        ...(r.method === 'cash' ? { tendered: Math.max(Number(tendered) || 0, Number(r.amount)) } : {}),
      })));
      onDone(sale);
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F12') { e.preventDefault(); complete(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const quick = useMemo(() => {
    const a = cashAmt;
    return [...new Set([a, Math.ceil(a / 10) * 10, Math.ceil(a / 100) * 100, Math.ceil(a / 500) * 500, Math.ceil(a / 2000) * 2000])].filter((x) => x >= a).slice(0, 4);
  }, [cashAmt]);
  const key = (k: string) => setTendered((t) => (k === 'C' ? '' : k === '⌫' ? t.slice(0, -1) : (t === String(cashAmt) ? '' : t) + k));

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal pay-modal" role="dialog" aria-modal="true">
        <div>
          <div className="modal-h">
            <span className="kpi" style={{ padding: 0 }}><span className="l"><span className="ib"><Icon name="card" /></span></span></span>
            <div className="grow"><h2>Collect Payment</h2><div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{billNo} · {customer ? `${customer.name} · ${customer.mobile}` : 'Walk-in customer'} · {bill.totalQty} item{bill.totalQty === 1 ? '' : 's'}</div></div>
            <button className="btn sm" onClick={onClose} disabled={busy}><Icon name="x" />Esc</button>
          </div>
          <div className="methods">
            {METHODS.filter((m) => m.id !== 'store_credit' || credit > 0).map((m) => {
              const on = rows.some((r) => r.method === m.id);
              return (
                <div key={m.id} className={`m ${on ? 'on' : ''}`} onClick={() => setOnly(m.id)}>
                  {on && <span className="tick"><Icon name="check" /></span>}
                  <span className="ib"><Icon name={m.icon} /></span>{m.label}<small>{m.id === 'store_credit' ? `Bal. ${inr(credit, true)}` : m.sub}</small>
                </div>
              );
            })}
          </div>
          <div className="row between" style={{ padding: '14px 22px 0' }}>
            <b>{rows.length > 1 ? 'Split Payment' : 'Payment'}</b>
            <div className="row" style={{ gap: 8 }}>
              {Math.abs(remaining) < 0.01 ? <span className="chip green">Fully allocated</span> : <span className="chip amber">{remaining > 0 ? `${inr(remaining, true)} unallocated` : `${inr(-remaining, true)} over`}</span>}
              <select className="input" style={{ height: 30, width: 150, fontSize: 12 }} value="" onChange={(e) => e.target.value && toggle(e.target.value as Method)}>
                <option value="">+ Split with…</option>
                {METHODS.filter((m) => !rows.some((r) => r.method === m.id) && (m.id !== 'store_credit' || credit > 0)).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div className="split">
            {rows.map((r, i) => (
              <div className="sr" key={r.method}>
                <span className="thumb" style={{ width: 30, height: 30, color: 'var(--blue)' }}><Icon name={METHODS.find((m) => m.id === r.method)!.icon} /></span>
                <div><b>{PAYMENT_LABEL[r.method]}</b><div className="muted" style={{ fontSize: 11 }}>{r.method === 'cash' ? `Tendered ${inr(Number(tendered) || 0, true)}` : r.method === 'store_credit' ? `Balance ${inr(credit, true)}` : 'Enter reference'}</div></div>
                <input className={`amt num ${r.method === 'store_credit' && overCredit ? 'err' : ''}`} inputMode="decimal" value={r.amount} onChange={(e) => setAmount(i, e.target.value.replace(/[^\d.]/g, ''))} />
                {['upi', 'card', 'wallet', 'bank'].includes(r.method)
                  ? <input className="input" style={{ height: 34, fontSize: 12 }} placeholder={r.method === 'upi' ? 'UTR (optional)' : 'Ref / last 4'} value={r.reference} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))} />
                  : r.method === 'cash' ? <span className={`chip ${change > 0 ? 'amber' : 'gray'}`}>Change {inr(change)}</span> : <span />}
                {rows.length > 1 ? <button className="link faint" onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="trash" size={16} /></button> : <span />}
              </div>
            ))}
          </div>
          <div className="pay-lines">
            {lines.slice(0, 4).map((l) => <span key={l.variant.id}>{l.qty} × {l.product.name} {l.variant.size}</span>)}
            {lines.length > 4 && <span>+{lines.length - 4} more</span>}
          </div>
        </div>
        <div className="right">
          <div className="big"><span>Payable Amount</span><b className="num">{inr(bill.total, true)}</b>
            <div className="row between" style={{ marginTop: 10, fontSize: 12, color: '#c7d0ea' }}><span>GST incl. {inr(bill.cgst + bill.sgst + bill.igst, true)}</span>{change > 0 && <span style={{ color: '#86efac', fontWeight: 600 }}>Change {inr(change, true)}</span>}</div>
          </div>
          {cashRow ? (
            <>
              <div className="row between" style={{ fontSize: 12 }}><span className="muted">Cash tendered</span><b className="num" style={{ fontSize: 18, color: shortCash ? 'var(--red)' : undefined }}>{inr(Number(tendered) || 0)}</b></div>
              <div className="quick">{quick.map((q) => <span key={q} onClick={() => setTendered(String(q))}>{inr(q)}</span>)}</div>
              <div className="keys">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map((k) => <div key={k} onClick={() => key(k)}>{k === '⌫' ? <Icon name="x" /> : k}</div>)}</div>
            </>
          ) : (
            <div className="empty" style={{ flex: 1 }}><Icon name={rows[0].method === 'upi' ? 'upi' : 'card'} /><span>Confirm the {PAYMENT_LABEL[rows[0].method]} payment on the customer's app / terminal, then complete the sale.</span></div>
          )}
          <button className="done" disabled={!canPay} onClick={complete}>{busy ? 'Saving…' : <>Complete Sale <span className="kbd">F12</span><Icon name="arrow" /></>}</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sale completed
export function SaleDone({ sale, business, gstin, stateCode, footer, roll = 80, onNew }: { sale: SaleDetail; business: string; gstin?: string; stateCode?: string; footer?: string; roll?: 58 | 80; onNew: () => void }) {
  const [printing, setPrinting] = useState<Paper | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F1' || e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); onNew(); }
      if (e.key === 'F9') { e.preventDefault(); setPrinting(roll); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNew]);
  const wa = `https://wa.me/91${sale.customer?.mobile}?text=${encodeURIComponent(`Thank you for shopping at ${business}! Invoice ${sale.invoiceNo} for ₹${sale.total.toFixed(2)}.`)}`;
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 760, flexDirection: 'row' }}>
        <div style={{ flex: 1, padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="row" style={{ gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--green)', display: 'grid', placeItems: 'center', color: '#fff', boxShadow: '0 8px 20px rgba(21,128,61,.3)' }}><Icon name="check" size={26} /></div>
            <div><b style={{ fontSize: 18 }}>Sale completed · {inr(sale.total, true)}</b><div className="muted" style={{ marginTop: 3 }}>{sale.invoiceNo} · {sale.offline ? 'saved on this device - syncs when back online' : `stock updated for ${sale.totalQty} pcs`}</div></div>
          </div>
          {sale.changeAmount > 0 && <div className="row between" style={{ background: 'var(--amber-l)', color: 'var(--amber)', borderRadius: 12, padding: '14px 16px' }}><b>Return change to customer</b><b className="num" style={{ fontSize: 22 }}>{inr(sale.changeAmount, true)}</b></div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <button className="btn lg" style={{ justifyContent: 'center' }} onClick={() => setPrinting(roll)}><Icon name="printer" />Print receipt <span className="kbd l">F9</span></button>
            <button className="btn lg" style={{ justifyContent: 'center' }} disabled={sale.offline} title={sale.offline ? 'Available once the sale has synced' : undefined} onClick={() => setPrinting('a4')}><Icon name="file" />A4 tax invoice</button>
            <a className={`btn lg ${sale.customer ? '' : 'disabled'}`} style={{ justifyContent: 'center', gridColumn: '1 / -1' }} href={sale.customer ? wa : undefined} target="_blank" rel="noreferrer"><Icon name="whatsapp" />WhatsApp</a>
          </div>
          {sale.loyaltyEarned > 0 && <div className="row" style={{ gap: 8, fontSize: 12.5 }}><Icon name="star" size={15} />{sale.customer?.name} earned {sale.loyaltyEarned} loyalty points</div>}
          <button className="btn primary lg" style={{ justifyContent: 'center', marginTop: 'auto' }} autoFocus onClick={onNew}><Icon name="plus" />New Bill <span className="kbd">F1</span></button>
        </div>
        <div style={{ width: 340, background: '#e9edf5', padding: 16, display: 'flex', justifyContent: 'center', overflow: 'auto', maxHeight: '80vh' }}>
          <div className="receipt-paper"><ThermalReceipt sale={sale} business={business} gstin={gstin} footer={footer} width={roll} /></div>
        </div>
      </div>
      {printing && (
        <PrintPortal paper={printing} onDone={() => setPrinting(null)}>
          {printing === 'a4' ? <TaxInvoiceA4 sale={sale} business={business} gstin={gstin} stateCode={stateCode} footer={footer} /> : <ThermalReceipt sale={sale} business={business} gstin={gstin} footer={footer} width={printing} />}
        </PrintPortal>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shift gate
export function OpenShift({ storeId, counters, onOpened, onClose, required }: { storeId: string; counters: number; onOpened: () => void; onClose?: () => void; required: boolean }) {
  const toast = useToast();
  const [counter, setCounter] = useState(1);
  const [cash, setCash] = useState('5000');
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    try {
      await post('/shifts/open', { storeId, counter, openingCash: Number(cash) || 0 });
      toast('Shift opened - happy billing!', 'success');
      onOpened();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title="Open your shift" icon="timer" sub={required ? 'Cashiers open a shift with the drawer cash before billing (BRD §21)' : 'Track your counter cash for day closing'} onClose={onClose ?? (() => undefined)} width={440}
      footer={<>{onClose && <button className="btn" onClick={onClose}>Later</button>}<button className="btn primary" disabled={busy} onClick={open}><Icon name="play" />Open shift</button></>}>
      <div className="form-grid">
        <div className="field"><label>Counter</label>
          <select className="input" value={counter} onChange={(e) => setCounter(Number(e.target.value))}>{Array.from({ length: counters }, (_, i) => <option key={i} value={i + 1}>Counter {i + 1}</option>)}</select></div>
        <div className="field"><label>Opening cash in drawer</label><input className="input num" inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ''))} /></div>
      </div>
    </Modal>
  );
}
