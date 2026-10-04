import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { PrintPortal, SaleDetail, ThermalReceipt } from '../components/Receipt';
import { Confirm, ErrorBox, Loading, StatusChip, useLoad, useToast } from '../components/ui';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, inr, PAYMENT_LABEL } from '../lib/format';

export default function InvoiceDetail() {
  const { id } = useParams();
  const { me, can } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data: s, error, loading, reload } = useLoad(() => get<SaleDetail>(`/sales/${id}`), [id]);
  const [printing, setPrinting] = useState<58 | 80 | null>(null);
  const [cancelling, setCancelling] = useState(false);
  if (loading && !s) return <><Topbar title="Invoice" /><Loading /></>;
  if (error || !s) return <><Topbar title="Invoice" /><ErrorBox error={error ?? 'Not found'} onRetry={reload} /></>;

  const business = me?.tenant?.businessName ?? '';
  const byRate = [...s.items.reduce((m, i) => {
    const r = m.get(i.gstRate) ?? { hsn: new Set<string>(), names: [] as string[], taxable: 0, tax: 0, total: 0 };
    if (i.hsnCode) r.hsn.add(i.hsnCode);
    r.names.push(i.productName.split(' ').slice(-1)[0]);
    r.taxable += i.taxableAmount; r.tax += i.taxAmount; r.total += i.lineTotal;
    m.set(i.gstRate, r);
    return m;
  }, new Map<number, { hsn: Set<string>; names: string[]; taxable: number; tax: number; total: number }>())];
  const returned = s.items.some((i) => i.returnedQty > 0);
  const wa = s.customer ? `https://wa.me/91${s.customer.mobile}?text=${encodeURIComponent(`Thank you for shopping at ${business}! Invoice ${s.invoiceNo} for ₹${s.total.toFixed(2)}.`)}` : undefined;

  return (
    <>
      <Topbar crumb={<><Link className="link" to="/invoices">Invoices</Link> › {s.invoiceNo}</>} title={<span className="row" style={{ gap: 10 }}>Invoice {s.invoiceNo} <StatusChip status={s.status} /></span>}>
        {s.status === 'completed' && can('tenant_admin', 'store_manager', 'cashier') && <button className="btn" onClick={() => nav(`/returns?invoice=${s.invoiceNo}`)}><Icon name="undo" />Return / Exchange</button>}
        {s.status === 'completed' && can('tenant_admin', 'store_manager') && !returned && <button className="btn danger" onClick={() => setCancelling(true)}><Icon name="x" />Cancel invoice</button>}
      </Topbar>
      <div className="content" style={{ flexDirection: 'row', gap: 20 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          {s.stockConflict && (
            <div className="card row" style={{ padding: '12px 16px', gap: 12, background: 'var(--red-l)', borderColor: '#f8cdb8' }}>
              <Icon name="alert" /><div className="grow"><b>Sold offline beyond recorded stock</b><div className="muted" style={{ fontSize: 12 }}>This bill was made while the till was offline ({s.offlineRef}) and took some items below zero. Recount those items and post a stock adjustment.</div></div>
            </div>
          )}
          {!s.stockConflict && s.offlineRef && <div className="muted" style={{ fontSize: 12 }}><Icon name="wifi" size={13} /> Billed offline as {s.offlineRef} and synced later</div>}
          {s.status === 'cancelled' ? (
            <div className="card row" style={{ padding: 20, gap: 16, background: 'var(--red-l)', borderColor: '#f8cdb8' }}>
              <Icon name="ban" size={28} /><div><b style={{ fontSize: 16 }}>Invoice cancelled</b><div className="muted" style={{ marginTop: 4 }}>Reason: {s.cancelReason} · stock restored</div></div>
            </div>
          ) : (
            <div className="card row" style={{ padding: 20, gap: 18, background: 'linear-gradient(135deg,#ecfdf3,#fff)' }}>
              <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--green)', display: 'grid', placeItems: 'center', color: '#fff' }}><Icon name="check" size={26} /></div>
              <div className="grow"><b style={{ fontSize: 18 }}>Paid · {inr(s.total, true)}</b><div className="muted" style={{ marginTop: 4 }}>{fmtDateTime(s.createdAt)} · Counter {s.counter} · {s.cashier.name} · {s.store.name}</div></div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
            <button className="card" style={{ padding: 16, textAlign: 'left', borderColor: 'var(--blue)' }} onClick={() => setPrinting(80)}><span className="ib" style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--blue)', color: '#fff', display: 'grid', placeItems: 'center' }}><Icon name="printer" /></span><b style={{ display: 'block', marginTop: 10 }}>Reprint 80mm</b><span className="muted" style={{ fontSize: 11.5 }}>Thermal receipt</span></button>
            <button className="card" style={{ padding: 16, textAlign: 'left' }} onClick={() => setPrinting(58)}><span style={{ width: 36, height: 36, borderRadius: 9, background: '#f1f5f9', display: 'grid', placeItems: 'center' }}><Icon name="receipt" /></span><b style={{ display: 'block', marginTop: 10 }}>Reprint 58mm</b><span className="muted" style={{ fontSize: 11.5 }}>Narrow printer</span></button>
            <a className={`card ${wa ? '' : 'disabled'}`} style={{ padding: 16, textDecoration: 'none', opacity: wa ? 1 : 0.5 }} href={wa} target="_blank" rel="noreferrer"><span style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--green-l)', color: 'var(--green)', display: 'grid', placeItems: 'center' }}><Icon name="whatsapp" /></span><b style={{ display: 'block', marginTop: 10 }}>WhatsApp</b><span className="muted" style={{ fontSize: 11.5 }}>{s.customer?.mobile ?? 'No customer'}</span></a>
            <div className="card" style={{ padding: 16 }}><span style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--violet-l)', color: 'var(--violet)', display: 'grid', placeItems: 'center' }}><Icon name="star" /></span><b style={{ display: 'block', marginTop: 10 }}>+{s.loyaltyEarned} points</b><span className="muted" style={{ fontSize: 11.5 }}>{s.customer?.name ?? 'Walk-in'}</span></div>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-h" style={{ paddingBottom: 10 }}><h3>Items</h3><span className="muted" style={{ fontSize: 12 }}>{s.totalQty} pcs</span></div>
            <table className="t">
              <thead><tr><th>Item</th><th>SKU</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Discount</th><th className="r">Amount</th></tr></thead>
              <tbody>{s.items.map((i) => (
                <tr key={i.id}><td><b>{i.productName}</b><div className="muted" style={{ fontSize: 11 }}>{[i.size, i.color].filter(Boolean).join(' · ')}{i.returnedQty > 0 && <span className="chip violet nodot" style={{ marginLeft: 6 }}>{i.returnedQty} returned</span>}</div></td>
                  <td>{i.sku}</td><td className="r num">{i.qty}</td><td className="r num">{inr(i.unitPrice)}<div className="strike" style={{ fontSize: 11 }}>{i.mrp > i.unitPrice ? inr(i.mrp) : ''}</div></td>
                  <td className="r num">{i.itemDiscount + i.billDiscount > 0 ? `−${inr(i.itemDiscount + i.billDiscount, true)}` : '—'}</td><td className="r num"><b>{inr(i.lineTotal, true)}</b></td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="card-h" style={{ paddingBottom: 10 }}><h3>GST summary</h3><span className="muted" style={{ fontSize: 12 }}>{s.isInterState ? 'Inter-state · IGST' : 'Intra-state · CGST + SGST'}</span></div>
            <table className="t">
              <thead><tr><th>HSN</th><th>Rate</th><th className="r">Taxable value</th>{s.isInterState ? <th className="r">IGST</th> : <><th className="r">CGST</th><th className="r">SGST</th></>}<th className="r">Total</th></tr></thead>
              <tbody>
                {byRate.map(([rate, r]) => (
                  <tr key={rate}><td><b>{[...r.hsn].join(' / ') || '—'}</b></td><td>{rate}%</td><td className="r num">{inr(r.taxable, true)}</td>
                    {s.isInterState ? <td className="r num">{inr(r.tax, true)}</td> : <><td className="r num">{inr(r.tax / 2, true)}</td><td className="r num">{inr(r.tax / 2, true)}</td></>}
                    <td className="r num"><b>{inr(r.total, true)}</b></td></tr>
                ))}
                <tr style={{ background: '#f8fafd' }}><td colSpan={2}><b>Total</b>{s.roundOff !== 0 && <span className="muted"> (round off {inr(s.roundOff, true)})</span>}</td><td className="r num"><b>{inr(s.taxableAmount, true)}</b></td>
                  {s.isInterState ? <td className="r num"><b>{inr(s.igst, true)}</b></td> : <><td className="r num"><b>{inr(s.cgst, true)}</b></td><td className="r num"><b>{inr(s.sgst, true)}</b></td></>}
                  <td className="r num"><b>{inr(s.total, true)}</b></td></tr>
              </tbody>
            </table>
          </div>
          <div className="card" style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            <div><span className="muted" style={{ fontSize: 11.5 }}>Payments</span><br /><b>{s.payments.map((p) => `${PAYMENT_LABEL[p.method]} ${inr(p.amount)}`).join(' + ')}</b></div>
            <div><span className="muted" style={{ fontSize: 11.5 }}>Change returned</span><br /><b>{inr(s.changeAmount, true)}</b></div>
            <div><span className="muted" style={{ fontSize: 11.5 }}>Customer saved vs MRP</span><br /><b>{inr(Math.max(0, s.mrpTotal - s.total), true)}</b></div>
          </div>
        </div>
        <div style={{ width: 360, flex: 'none', background: '#e9edf5', borderRadius: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '16px 0', gap: 10, alignSelf: 'flex-start' }}>
          <div className="row muted" style={{ gap: 8, fontSize: 12 }}><Icon name="eye" size={15} />Receipt preview · 80mm</div>
          <div className="receipt-paper"><ThermalReceipt sale={s} business={business} gstin={me?.tenant?.gstin} footer={me?.settings?.invoiceFooter} /></div>
        </div>
      </div>
      {printing && <PrintPortal onDone={() => setPrinting(null)}><ThermalReceipt sale={s} business={business} gstin={me?.tenant?.gstin} footer={me?.settings?.invoiceFooter} width={printing} /></PrintPortal>}
      {cancelling && <Confirm title={`Cancel ${s.invoiceNo}?`} danger needReason confirmLabel="Cancel invoice" onClose={() => setCancelling(false)}
        text={<>Stock for {s.totalQty} pieces goes back to {s.store.name} and the invoice stays on record as cancelled. Refund the customer's {inr(s.total)} separately.</>}
        onConfirm={async (reason) => { await post(`/sales/${s.id}/cancel`, { reason }); toast('Invoice cancelled', 'success'); reload(); }} />}
    </>
  );
}
