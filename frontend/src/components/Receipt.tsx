import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PAYMENT_LABEL } from '../lib/format';

/** Shape returned by GET /sales/:id */
export interface SaleDetail {
  id: string;
  invoiceNo: string;
  status: 'completed' | 'cancelled';
  createdAt: string;
  counter: number;
  mrpTotal: number;
  grossTotal: number;
  itemDiscount: number;
  billDiscount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  totalQty: number;
  itemCount: number;
  isInterState: boolean;
  loyaltyEarned: number;
  notes?: string;
  cancelReason?: string;
  store: { id: string; name: string; code: string; address?: string; phone?: string; gstin?: string };
  customer?: { id: string; name: string; mobile: string; gstin?: string } | null;
  cashier: { id: string; name: string };
  items: { id: string; productName: string; sku: string; barcode: string; size?: string; color?: string; hsnCode?: string; qty: number; mrp: number; unitPrice: number; itemDiscount: number; billDiscount: number; gstRate: number; taxableAmount: number; taxAmount: number; lineTotal: number; returnedQty: number; variantId: string }[];
  payments: { id: string; method: string; amount: number; tendered: number; reference?: string }[];
  offlineRef?: string | null;
  stockConflict?: boolean;
  /** true only for the provisional receipt printed while the POS is offline */
  offline?: boolean;
}

const money = (n: number) => n.toFixed(2);

/** 58/80mm thermal receipt (BRD §17). Width follows the paper size; prints via the browser. */
export function ThermalReceipt({ sale, business, gstin, footer, width = 80 }: { sale: SaleDetail; business: string; gstin?: string; footer?: string; width?: 58 | 80 }) {
  const d = new Date(sale.createdAt);
  const tax = sale.cgst + sale.sgst + sale.igst;
  // GST summary per rate, as required on a tax invoice
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const i of sale.items) {
    const r = byRate.get(i.gstRate) ?? { taxable: 0, tax: 0 };
    r.taxable += i.taxableAmount;
    r.tax += i.taxAmount;
    byRate.set(i.gstRate, r);
  }
  return (
    <div className="receipt num" style={{ width: width === 80 ? 300 : 210 }}>
      <div className="c"><b style={{ fontSize: 15, letterSpacing: '.06em' }}>{business.toUpperCase()}</b><br />{sale.store.name}<br />{sale.store.address}{sale.store.phone && <><br />Ph {sale.store.phone}</>}{(sale.store.gstin ?? gstin) && <><br />GSTIN {sale.store.gstin ?? gstin}</>}</div>
      <hr /><div className="c"><b>{sale.status === 'cancelled' ? 'CANCELLED INVOICE' : sale.offline ? 'SALE RECEIPT (OFFLINE)' : 'TAX INVOICE'}</b>
        {sale.offline && <div style={{ fontSize: 9.5 }}>Tax invoice no. is issued when the till reconnects</div>}
        {!sale.offline && sale.offlineRef && <div style={{ fontSize: 9.5 }}>Billed offline as {sale.offlineRef}</div>}</div>
      <div className="r"><span>Bill: {sale.invoiceNo}</span><span>{d.toLocaleDateString('en-IN')} {d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div className="r"><span>Cashier: {sale.cashier.name}</span><span>Ctr {sale.counter}</span></div>
      {sale.customer && <div>Cust: {sale.customer.name} {sale.customer.mobile}{sale.customer.gstin && <><br />GSTIN {sale.customer.gstin}</>}</div>}
      <hr />
      <div className="r"><b>Item</b><b>Qty x Rate    Amt</b></div><hr />
      {sale.items.map((i) => (
        <div key={i.id} style={{ marginBottom: 4 }}>
          {i.productName} {[i.size, i.color].filter(Boolean).join('/')}
          <div className="r"><span>{i.sku} MRP {i.mrp}</span><span>{i.qty} x {i.unitPrice} {money(i.qty * i.unitPrice)}</span></div>
          {i.itemDiscount > 0 && <div className="r"><span>  item discount</span><span>-{money(i.itemDiscount)}</span></div>}
        </div>
      ))}
      <hr />
      <div className="r"><span>Sub Total ({sale.totalQty} pcs)</span><span>{money(sale.grossTotal)}</span></div>
      {sale.itemDiscount + sale.billDiscount > 0 && <div className="r"><span>Discount</span><span>-{money(sale.itemDiscount + sale.billDiscount)}</span></div>}
      {sale.isInterState
        ? <div className="r"><span>IGST incl.</span><span>{money(sale.igst)}</span></div>
        : <><div className="r"><span>CGST incl.</span><span>{money(sale.cgst)}</span></div><div className="r"><span>SGST incl.</span><span>{money(sale.sgst)}</span></div></>}
      {sale.roundOff !== 0 && <div className="r"><span>Round off</span><span>{money(sale.roundOff)}</span></div>}
      <hr /><div className="r tot"><span>NET PAYABLE</span><span>₹{money(sale.total)}</span></div><hr />
      {sale.payments.map((p) => (
        <div className="r" key={p.id}><span>{PAYMENT_LABEL[p.method] ?? p.method}{p.reference ? ` (${p.reference.slice(-6)})` : ''}</span><span>{p.method === 'cash' && p.tendered > p.amount ? `${money(p.tendered)} / chg ${money(p.tendered - p.amount)}` : money(p.amount)}</span></div>
      ))}
      <hr />
      <div style={{ fontSize: 10 }}>
        <div className="r"><span>GST%  Taxable</span><span>Tax</span></div>
        {[...byRate].map(([r, v]) => <div className="r" key={r}><span>{r}%  {money(v.taxable)}</span><span>{money(v.tax)}</span></div>)}
        <div className="r"><span>Total tax</span><span>{money(tax)}</span></div>
      </div>
      <hr />
      <div className="c">
        {sale.mrpTotal > sale.total && <>You saved ₹{money(sale.mrpTotal - sale.total)} on MRP!<br /></>}
        {sale.loyaltyEarned > 0 && <>+{sale.loyaltyEarned} loyalty points<br /></>}
        {footer ?? 'Thank you · Visit again'}
        <div style={{ marginTop: 6, fontSize: 9, color: '#555' }}>Billing by NPOS · Infinite Solution</div>
      </div>
    </div>
  );
}

/** Renders children into a print-only container and opens the browser print dialog once. */
export function PrintPortal({ children, onDone }: { children: React.ReactNode; onDone: () => void }) {
  useEffect(() => {
    document.body.classList.add('printing');
    const t = setTimeout(() => {
      window.print();
      document.body.classList.remove('printing');
      onDone();
    }, 50);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('printing');
    };
  }, [onDone]);
  return createPortal(<div className="print-area">{children}</div>, document.body);
}
