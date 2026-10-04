import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { PrintPortal, SaleDetail } from '../components/Receipt';
import { Empty, Loading, StatusChip, useLoad, useToast } from '../components/ui';
import { ApiError, get, Paged, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtTime, inr, isoToday } from '../lib/format';
import { PosProduct } from './pos/types';

interface ReturnRow { id: string; returnNo: string; createdAt: string; type: string; refundMethod?: string; returnedValue: number; exchangeValue: number; netAmount: number; reason?: string; userName?: string; collectedAmount: number; collectMethod?: string; sale: { id: string; invoiceNo: string }; items: { productName: string; sku: string; qty: number; exchangeSku?: string; reason?: string }[] }
interface Pick { qty: number; reason: string; exchange: boolean; exchangeVariantId?: string }
const REASONS = ['Size issue', 'Colour not liked', 'Did not like', 'Defective / damaged', 'Wrong item given', 'Other'];

export default function Returns() {
  const { me, store, can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const isManager = can('tenant_admin', 'store_manager');
  const [invoiceNo, setInvoiceNo] = useState(params.get('invoice') ?? '');
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [findErr, setFindErr] = useState('');
  const [finding, setFinding] = useState(false);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [products, setProducts] = useState<Record<string, PosProduct>>({}); // saleItemId -> product with live variants
  const [refundMethod, setRefundMethod] = useState<'store_credit' | 'original' | 'cash'>('store_credit');
  const [collect, setCollect] = useState<'cash' | 'upi' | 'card'>('cash');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReturnRow | null>(null);
  const [printing, setPrinting] = useState(false);
  const recent = useLoad(() => get<Paged<ReturnRow>>('/returns', { storeId: store?.id, from: isoToday(), pageSize: 10 }), [store?.id, done]);

  const find = async (no = invoiceNo) => {
    if (!no.trim()) return;
    setFinding(true); setFindErr(''); setSale(null); setPicks({}); setDone(null);
    try {
      setSale(await get<SaleDetail>(`/sales/invoice/${encodeURIComponent(no.trim())}`));
    } catch (e) {
      setFindErr(e instanceof ApiError && e.status === 404 ? `No invoice ${no.trim().toUpperCase()} found` : (e as Error).message);
    }
    setFinding(false);
  };
  useEffect(() => { if (params.get('invoice')) find(params.get('invoice')!); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const toggle = (id: string) => setPicks((p) => {
    const n = { ...p };
    if (n[id]) delete n[id];
    else n[id] = { qty: 1, reason: REASONS[0], exchange: false };
    return n;
  });
  const setPick = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  // load the product's current variants (with store stock) when an exchange is requested
  const wantExchange = async (itemId: string, on: boolean) => {
    setPick(itemId, { exchange: on, exchangeVariantId: undefined });
    const item = sale?.items.find((i) => i.id === itemId);
    if (on && item && !products[itemId] && store) {
      try {
        const r = await get<{ product: PosProduct }>(`/pos/scan/${item.barcode}`, { storeId: store.id });
        setProducts((p) => ({ ...p, [itemId]: r.product }));
      } catch (e) { toast((e as Error).message, 'error'); }
    }
  };

  const ageDays = sale ? (Date.now() - new Date(sale.createdAt).getTime()) / 864e5 : 0;
  const windowDays = me?.settings?.returnWindowDays ?? 7;
  const outOfWindow = ageDays > windowDays;
  const lines = sale ? sale.items.filter((i) => picks[i.id]) : [];
  const returnedValue = lines.reduce((s, i) => s + (i.lineTotal * picks[i.id].qty) / i.qty, 0);
  const taxReversed = lines.reduce((s, i) => s + (i.taxAmount * picks[i.id].qty) / i.qty, 0);
  const exchangeValue = lines.reduce((s, i) => {
    const p = picks[i.id];
    const v = p.exchange && p.exchangeVariantId ? products[i.id]?.variants.find((x) => x.id === p.exchangeVariantId) : undefined;
    return s + (v ? v.price * p.qty : 0);
  }, 0);
  const net = Math.round((returnedValue - exchangeValue) * 100) / 100;
  const incomplete = lines.some((i) => picks[i.id].exchange && !picks[i.id].exchangeVariantId);
  const needsManager = (net > 0 && refundMethod !== 'store_credit' && !isManager) || (outOfWindow && !isManager);
  const noCustomerCredit = net > 0 && refundMethod === 'store_credit' && !sale?.customer;

  const submit = async () => {
    if (!sale) return;
    setBusy(true);
    try {
      const r = await post<ReturnRow>('/returns', {
        saleId: sale.id, refundMethod,
        items: lines.map((i) => ({ saleItemId: i.id, qty: picks[i.id].qty, reason: picks[i.id].reason, exchangeVariantId: picks[i.id].exchange ? picks[i.id].exchangeVariantId : undefined })),
        reason: lines.map((i) => picks[i.id].reason).join(', '),
        ...(net < 0 ? { collect: { method: collect, amount: -net } } : {}),
      });
      setDone(r);
      setSale(null); setPicks({}); setInvoiceNo('');
      toast(`${r.returnNo} completed - stock restored`, 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };

  const step = done ? 3 : sale ? 2 : 1;
  return (
    <>
      <Topbar crumb="Sales › Returns & Exchange" title="Returns & Exchange">
        <div className="steps">
          {['Find invoice', 'Select items', 'Settle'].map((t, i) => (
            <span key={t} className="row" style={{ gap: 0 }}>
              {i > 0 && <i />}
              <div className={step > i + 1 ? 'done' : step === i + 1 ? 'on' : ''}><b>{step > i + 1 ? '✓' : i + 1}</b>{t}</div>
            </span>
          ))}
        </div>
        <div className="grow" />
      </Topbar>
      <div className="content" style={{ flexDirection: 'row' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div className="card row" style={{ padding: '14px 16px', gap: 16, flexWrap: 'wrap' }}>
            <div className={`input ${findErr ? 'err' : ''}`} style={{ width: 260, borderColor: sale ? 'var(--blue)' : undefined }}>
              <Icon name="receipt" size={16} /><input autoFocus placeholder="Scan or type invoice no." value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && find()} />
              {sale && <span className="chip green" style={{ fontSize: 10 }}>Found</span>}
            </div>
            {!sale && <button className="btn primary" onClick={() => find()} disabled={finding}><Icon name="search" />Find invoice</button>}
            {findErr && <span className="error" style={{ color: 'var(--red)', fontSize: 12.5 }}>{findErr}</span>}
            {sale && <>
              <div><span className="muted" style={{ fontSize: 11 }}>Invoice date</span><br /><b>{fmtDateTime(sale.createdAt)}</b></div>
              <div><span className="muted" style={{ fontSize: 11 }}>Customer</span><br /><b>{sale.customer?.name ?? 'Walk-in'}</b></div>
              <div><span className="muted" style={{ fontSize: 11 }}>Paid</span><br /><b>{inr(sale.total)} · {sale.payments.map((p) => p.method.toUpperCase()).join('+')}</b></div>
              <div className="grow" />
              {sale.status === 'cancelled' ? <StatusChip status="cancelled" /> : outOfWindow ? <span className="chip amber">{Math.floor(ageDays)} days old · manager approval</span> : <span className="chip green">Within {windowDays}-day window</span>}
            </>}
          </div>

          {done && (
            <div className="card row" style={{ padding: 18, gap: 16, background: 'linear-gradient(135deg,#ecfdf3,#fff)' }}>
              <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'var(--green)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="check" size={22} /></div>
              <div className="grow"><b style={{ fontSize: 16 }}>{done.returnNo} completed</b><div className="muted" style={{ marginTop: 3 }}>
                {done.netAmount > 0 ? `${inr(done.netAmount, true)} refunded as ${done.refundMethod === 'store_credit' ? 'store credit' : done.refundMethod === 'cash' ? 'cash' : 'original payment mode'}` : done.netAmount < 0 ? `${inr(-done.netAmount, true)} collected for the price difference` : 'Even exchange - nothing to pay'} · stock restored</div></div>
              <button className="btn" onClick={() => setPrinting(true)}><Icon name="printer" />Print credit note</button>
            </div>
          )}

          {sale && sale.status === 'completed' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <table className="t">
                <thead><tr><th style={{ width: 30 }} /><th>Item</th><th>Return qty</th><th>Reason</th><th className="r">Action</th></tr></thead>
                <tbody>{sale.items.map((i) => {
                  const left = i.qty - i.returnedQty;
                  const p = picks[i.id];
                  const product = products[i.id];
                  return (
                    <tr key={i.id} style={p ? { background: 'var(--blue-ll)' } : undefined}>
                      <td><span className={`check ${p ? 'on' : ''}`} style={left <= 0 ? { opacity: 0.3, pointerEvents: 'none' } : undefined} onClick={() => toggle(i.id)} role="checkbox" aria-checked={!!p} /></td>
                      <td><b>{i.productName}</b><div className="muted" style={{ fontSize: 11 }}>{i.sku} · {[i.size, i.color].filter(Boolean).join(' · ')} · paid {inr(i.lineTotal / i.qty, true)}/pc{i.returnedQty > 0 && ` · ${i.returnedQty} already returned`}</div>
                        {p?.exchange && (
                          <div style={{ marginTop: 8 }}>
                            {!product ? <span className="muted" style={{ fontSize: 11.5 }}>Loading sizes…</span> : (
                              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                                {product.variants.filter((v) => v.id !== i.variantId).map((v) => (
                                  <button key={v.id} disabled={v.stock < p.qty} onClick={() => setPick(i.id, { exchangeVariantId: v.id })}
                                    className="btn sm" style={p.exchangeVariantId === v.id ? { background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' } : v.stock < p.qty ? { opacity: 0.4 } : undefined}>
                                    <i style={{ width: 10, height: 10, borderRadius: 3, background: v.colorHex, border: '1px solid rgba(0,0,0,.15)' }} />{v.size} {v.color} · {v.stock}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td>{left <= 0 ? <span className="muted">Fully returned</span> : p ? (
                        <div className="qty" style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 8, height: 30, alignItems: 'center', width: 100, background: '#fff' }}>
                          <span style={{ width: 28, textAlign: 'center', cursor: 'pointer' }} onClick={() => setPick(i.id, { qty: Math.max(1, p.qty - 1) })}>−</span><b style={{ flex: 1, textAlign: 'center' }}>{p.qty}</b>
                          <span style={{ width: 28, textAlign: 'center', cursor: 'pointer' }} onClick={() => setPick(i.id, { qty: Math.min(left, p.qty + 1) })}>+</span></div>
                      ) : <span className="muted">0 of {left}</span>}</td>
                      <td>{p ? <select className="input" style={{ height: 32, fontSize: 12, width: 170 }} value={p.reason} onChange={(e) => setPick(i.id, { reason: e.target.value })}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select> : '—'}</td>
                      <td className="r">{p ? (
                        <div className="tabs" style={{ marginLeft: 'auto' }}><span className={!p.exchange ? 'on' : ''} onClick={() => wantExchange(i.id, false)}>Refund</span><span className={p.exchange ? 'on' : ''} onClick={() => wantExchange(i.id, true)}>Exchange</span></div>
                      ) : <span className="chip gray nodot">Kept</span>}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}

          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-h" style={{ paddingBottom: 10 }}><h3>Today's returns &amp; exchanges</h3><span className="muted" style={{ fontSize: 12 }}>{recent.data ? `${inr(recent.data.items.reduce((s, r) => s + r.returnedValue, 0))} · ${recent.data.total} transactions` : ''}</span></div>
            {recent.loading && !recent.data ? <Loading /> : !recent.data?.items.length ? <Empty icon="undo" title="No returns today" /> : (
              <table className="t">
                <thead><tr><th>Credit note</th><th>Original bill</th><th>Item</th><th>Type</th><th className="r">Value</th></tr></thead>
                <tbody>{recent.data.items.map((r) => (
                  <tr key={r.id}><td><b>{r.returnNo}</b><div className="muted" style={{ fontSize: 11 }}>{fmtTime(r.createdAt)} · {r.userName}</div></td><td><Link className="link" to={`/invoices/${r.sale.id}`}>{r.sale.invoiceNo}</Link></td>
                    <td>{r.items.map((i) => `${i.productName}${i.exchangeSku ? ` → ${i.exchangeSku}` : ''}`).join(', ')}<div className="muted" style={{ fontSize: 11 }}>{r.reason}</div></td>
                    <td><StatusChip status={r.type} label={r.type === 'refund' && r.refundMethod === 'store_credit' ? 'Store credit' : undefined} /></td><td className="r num"><b>{inr(r.returnedValue)}</b></td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card" style={{ width: 360, flex: 'none', display: 'flex', flexDirection: 'column', alignSelf: 'flex-start' }}>
          <div className="card-h"><h3>Settlement</h3>{needsManager && <span className="chip amber">Manager approval</span>}</div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {!lines.length ? <Empty icon="undo" title="Select items to return" text="Find the invoice, tick the pieces coming back and choose refund or exchange." /> : <>
              <div className="row between"><span className="muted">Returned value</span><b className="num">{inr(returnedValue, true)}</b></div>
              <div className="row between"><span className="muted">Exchange items value</span><b className="num">{inr(exchangeValue, true)}</b></div>
              <div className="row between"><span className="muted">GST reversal (incl.)</span><b className="num">{inr(taxReversed, true)}</b></div>
              <div className="row between" style={{ borderTop: '1px dashed var(--line)', paddingTop: 10 }}><b>{net >= 0 ? 'Due to customer' : 'Collect from customer'}</b><b className="num" style={{ fontSize: 20, color: net >= 0 ? 'var(--blue)' : 'var(--amber)' }}>{inr(Math.abs(net), true)}</b></div>
              {net > 0 && <>
                <div style={{ fontWeight: 600, marginTop: 6 }}>Refund method</div>
                {([['store_credit', 'Store credit', sale?.customer ? `Added to ${sale.customer.name}'s wallet` : 'Needs a customer on the invoice'], ['original', 'Refund to original mode', isManager ? 'UPI / card reversal' : 'Manager only'], ['cash', 'Cash refund', isManager ? 'Paid from the drawer' : 'Manager only']] as const).map(([k, t, sub]) => (
                  <div key={k} className={`opt ${refundMethod === k ? 'on' : ''}`} onClick={() => setRefundMethod(k)}><span className="radio" /><div><b>{t}</b><div className="muted" style={{ fontSize: 11.5 }}>{sub}</div></div></div>
                ))}
              </>}
              {net < 0 && <div className="field"><label>Collect difference by</label><select className="input" value={collect} onChange={(e) => setCollect(e.target.value as typeof collect)}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></div>}
              <div className="row" style={{ gap: 8, fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}><Icon name="box" size={14} />{lines.reduce((s, i) => s + picks[i.id].qty, 0)} piece(s) go back into {store?.name} stock</div>
              {needsManager && <div style={{ fontSize: 12, color: 'var(--amber)' }}>{outOfWindow ? 'This invoice is outside the return window.' : 'Cash / original-mode refunds need a manager.'} Sign in as a manager or offer store credit.</div>}
              {noCustomerCredit && <div style={{ fontSize: 12, color: 'var(--red)' }}>Walk-in invoice — choose cash or original-mode refund.</div>}
              <button className="btn primary lg" style={{ justifyContent: 'center', marginTop: 6 }} disabled={busy || incomplete || needsManager || noCustomerCredit} onClick={submit}><Icon name="check" />{incomplete ? 'Pick the exchange size' : 'Complete return'}</button>
            </>}
          </div>
        </div>
      </div>
      {printing && done && (
        <PrintPortal onDone={() => setPrinting(false)}>
          <div className="receipt num" style={{ width: 300 }}>
            <div className="c"><b style={{ fontSize: 14 }}>{me?.tenant?.businessName?.toUpperCase()}</b><br />{store?.name}<br /><b>CREDIT NOTE</b></div><hr />
            <div className="r"><span>{done.returnNo}</span><span>{new Date(done.createdAt).toLocaleString('en-IN')}</span></div>
            <div>Against bill {done.sale.invoiceNo}</div><hr />
            {done.items.map((i, k) => <div key={k} className="r"><span>{i.qty} x {i.productName}{i.exchangeSku ? ` → ${i.exchangeSku}` : ''}</span></div>)}<hr />
            <div className="r"><span>Returned value</span><span>{done.returnedValue.toFixed(2)}</span></div>
            <div className="r"><span>Exchange value</span><span>{done.exchangeValue.toFixed(2)}</span></div>
            <div className="r tot"><span>{done.netAmount >= 0 ? 'REFUND' : 'COLLECTED'}</span><span>₹{Math.abs(done.netAmount).toFixed(2)}</span></div>
            <hr /><div className="c">{done.refundMethod === 'store_credit' ? 'Credited to your store wallet' : 'Thank you'}<br />Processed by {done.userName}</div>
          </div>
        </PrintPortal>
      )}
    </>
  );
}
