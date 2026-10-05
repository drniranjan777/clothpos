import { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { PAYMENT_LABEL, rupeesInWords } from '../lib/format';

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
  store: { id: string; name: string; code: string; address?: string; phone?: string; gstin?: string; stateCode?: string };
  customer?: { id: string; name: string; mobile: string; gstin?: string } | null;
  cashier: { id: string; name: string };
  items: { id: string; productName: string; sku: string; barcode: string; size?: string; color?: string; hsnCode?: string; qty: number; mrp: number; unitPrice: number; itemDiscount: number; billDiscount: number; gstRate: number; taxableAmount: number; taxAmount: number; lineTotal: number; returnedQty: number; variantId: string }[];
  payments: { id: string; method: string; amount: number; tendered: number; reference?: string }[];
  offlineRef?: string | null;
  stockConflict?: boolean;
  /** true only for the provisional receipt printed while the POS is offline */
  offline?: boolean;
}

export type Paper = 58 | 80 | 'a4';

const money = (n: number) => n.toFixed(2);
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** same split as the billing engine: CGST = half rounded, SGST = the remainder (so the two always add up) */
const splitTax = (tax: number) => { const c = r2(tax / 2); return [c, r2(tax - c)] as const; };
const inr = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
};

/** GST summary per rate (and HSN), as printed on tax invoices. */
function taxSummary(sale: SaleDetail) {
  const byRate = new Map<number, { hsn: Set<string>; taxable: number; tax: number; qty: number }>();
  for (const i of sale.items) {
    const r = byRate.get(i.gstRate) ?? { hsn: new Set<string>(), taxable: 0, tax: 0, qty: 0 };
    if (i.hsnCode) r.hsn.add(i.hsnCode);
    r.taxable += i.taxableAmount;
    r.tax += i.taxAmount;
    r.qty += i.qty;
    byRate.set(i.gstRate, r);
  }
  return [...byRate].sort((a, b) => a[0] - b[0]);
}

function docTitle(sale: SaleDetail) {
  if (sale.status === 'cancelled') return 'CANCELLED INVOICE';
  return sale.offline ? 'SALE RECEIPT (OFFLINE)' : 'TAX INVOICE';
}

/**
 * 58 / 80 mm thermal receipt (BRD §17). Sized in millimetres so the browser prints it on a roll-width page;
 * the printable area of these printers is ~48 / 72 mm, hence the side padding.
 */
export function ThermalReceipt({ sale, business, gstin, footer, width = 80 }: { sale: SaleDetail; business: string; gstin?: string; footer?: string; width?: 58 | 80 }) {
  const tax = sale.cgst + sale.sgst + sale.igst;
  const narrow = width === 58;
  return (
    <div className={`receipt num ${narrow ? 'w58' : 'w80'}`}>
      <div className="c">
        <b className="biz">{business.toUpperCase()}</b>
        <div>{sale.store.name}</div>
        {sale.store.address && <div>{sale.store.address}</div>}
        {sale.store.phone && <div>Ph {sale.store.phone}</div>}
        {(sale.store.gstin ?? gstin) && <div>GSTIN {sale.store.gstin ?? gstin}</div>}
      </div>
      <hr />
      <div className="c"><b>{docTitle(sale)}</b>
        {sale.offline && <div className="small">Tax invoice no. is issued when the till reconnects</div>}
        {!sale.offline && sale.offlineRef && <div className="small">Billed offline as {sale.offlineRef}</div>}
      </div>
      <div className="r"><span>Bill: {sale.invoiceNo}</span></div>
      <div className="r"><span>{when(sale.createdAt)}</span><span>Ctr {sale.counter}</span></div>
      <div className="r"><span>Cashier: {sale.cashier.name}</span></div>
      {sale.customer && <div className="wrap">Customer: {sale.customer.name} · {sale.customer.mobile}{sale.customer.gstin && <> · GSTIN {sale.customer.gstin}</>}</div>}
      <hr />
      <div className="r head"><span>Item</span><span>Amount</span></div>
      <hr />
      {sale.items.map((i) => (
        <div key={i.id} className="item">
          <div className="wrap"><b>{i.productName}</b>{[i.size, i.color].filter(Boolean).length > 0 && ` ${[i.size, i.color].filter(Boolean).join(' / ')}`}</div>
          <div className="r"><span>{i.qty} x {money(i.unitPrice)}</span><span>{money(i.qty * i.unitPrice)}</span></div>
          <div className="r small"><span>{i.sku}{i.hsnCode ? ` · HSN ${i.hsnCode}` : ''}</span><span>MRP {money(i.mrp)}</span></div>
          {i.itemDiscount > 0 && <div className="r small"><span>Item discount</span><span>-{money(i.itemDiscount)}</span></div>}
        </div>
      ))}
      <hr />
      <div className="r"><span>Sub total ({sale.totalQty} pcs)</span><span>{money(sale.grossTotal)}</span></div>
      {sale.itemDiscount + sale.billDiscount > 0 && <div className="r"><span>Discount</span><span>-{money(sale.itemDiscount + sale.billDiscount)}</span></div>}
      {sale.roundOff !== 0 && <div className="r"><span>Round off</span><span>{money(sale.roundOff)}</span></div>}
      <hr />
      <div className="r tot"><span>NET PAYABLE</span><span>₹{money(sale.total)}</span></div>
      <hr />
      {sale.payments.map((p) => (
        <div key={p.id}>
          <div className="r"><span>{PAYMENT_LABEL[p.method] ?? p.method}{p.reference ? ` (${p.reference.length > 12 ? '…' + p.reference.slice(-8) : p.reference})` : ''}</span><span>{money(p.method === 'cash' ? p.tendered : p.amount)}</span></div>
          {p.method === 'cash' && p.tendered > p.amount && <div className="r"><span>Change returned</span><span>{money(p.tendered - p.amount)}</span></div>}
        </div>
      ))}
      <hr />
      <div className="small">
        <div className="r"><span>GST%</span><span>Taxable</span><span>{sale.isInterState ? 'IGST' : 'CGST+SGST'}</span></div>
        {taxSummary(sale).map(([r, v]) => <div className="r" key={r}><span>{r}%</span><span>{money(v.taxable)}</span><span>{money(v.tax)}</span></div>)}
        <div className="r"><span>Total tax (incl. in price)</span><span>{money(tax)}</span></div>
        {!sale.isInterState && <div className="r"><span>CGST {money(sale.cgst)}</span><span>SGST {money(sale.sgst)}</span></div>}
      </div>
      <hr />
      <div className="c">
        {sale.mrpTotal > sale.total && <div><b>You saved ₹{money(sale.mrpTotal - sale.total)} on MRP!</b></div>}
        {sale.loyaltyEarned > 0 && <div>+{sale.loyaltyEarned} loyalty points</div>}
        <div>{footer ?? 'Thank you · Visit again'}</div>
        <div className="small muted-print">Billing by NPOS · Infinite Solution</div>
      </div>
    </div>
  );
}

/** Full-page GST tax invoice (A4) - for business customers and customers who ask for a proper invoice. */
export function TaxInvoiceA4({ sale, business, gstin, stateCode, footer }: { sale: SaleDetail; business: string; gstin?: string; stateCode?: string; footer?: string }) {
  const sellerGstin = sale.store.gstin ?? gstin;
  const supplyState = sale.customer?.gstin?.slice(0, 2) ?? sale.store.stateCode ?? sellerGstin?.slice(0, 2) ?? stateCode;
  const summary = taxSummary(sale);
  const discount = (i: SaleDetail['items'][number]) => i.itemDiscount + i.billDiscount;
  return (
    <div className="a4inv">
      <div className="a4-head">
        <div>
          <div className="a4-biz">{business}</div>
          <div>{sale.store.name}</div>
          {sale.store.address && <div>{sale.store.address}</div>}
          {sale.store.phone && <div>Phone: {sale.store.phone}</div>}
          {sellerGstin && <div><b>GSTIN: {sellerGstin}</b></div>}
        </div>
        <div className="a4-title">
          <div className="a4-doc">{docTitle(sale)}</div>
          <table className="a4-meta"><tbody>
            <tr><td>Invoice no.</td><td><b>{sale.invoiceNo}</b></td></tr>
            <tr><td>Date</td><td>{when(sale.createdAt)}</td></tr>
            {supplyState && <tr><td>Place of supply</td><td>State code {supplyState}</td></tr>}
            <tr><td>Counter / cashier</td><td>{sale.counter} · {sale.cashier.name}</td></tr>
          </tbody></table>
        </div>
      </div>
      {sale.offlineRef && <div className="a4-note">Billed offline as {sale.offlineRef}</div>}

      <div className="a4-party">
        <div className="a4-label">Bill to</div>
        {sale.customer ? <>
          <b>{sale.customer.name}</b> · {sale.customer.mobile}
          {sale.customer.gstin && <> · <b>GSTIN {sale.customer.gstin}</b></>}
        </> : <span>Walk-in customer</span>}
      </div>

      <table className="a4-items">
        <thead>
          <tr>
            <th>#</th><th className="l">Description</th><th>HSN</th><th>Qty</th><th>MRP</th><th>Rate</th><th>Disc.</th><th>Taxable</th><th>GST</th>
            {sale.isInterState ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i, k) => (
            <tr key={i.id}>
              <td>{k + 1}</td>
              <td className="l"><b>{i.productName}</b><div className="sub">{[i.size, i.color].filter(Boolean).join(' · ')}{[i.size, i.color].some(Boolean) ? ' · ' : ''}{i.sku}</div></td>
              <td>{i.hsnCode ?? '—'}</td>
              <td>{i.qty}</td>
              <td>{inr(i.mrp)}</td>
              <td>{inr(i.unitPrice)}</td>
              <td>{discount(i) > 0 ? inr(discount(i)) : '—'}</td>
              <td>{inr(i.taxableAmount)}</td>
              <td>{i.gstRate}%</td>
              {sale.isInterState ? <td>{inr(i.taxAmount)}</td> : <><td>{inr(splitTax(i.taxAmount)[0])}</td><td>{inr(splitTax(i.taxAmount)[1])}</td></>}
              <td><b>{inr(i.lineTotal)}</b></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3} className="l"><b>Total</b></td>
            <td><b>{sale.totalQty}</b></td>
            <td /><td />
            <td>{sale.itemDiscount + sale.billDiscount > 0 ? inr(sale.itemDiscount + sale.billDiscount) : '—'}</td>
            <td><b>{inr(sale.taxableAmount)}</b></td>
            <td />
            {sale.isInterState ? <td><b>{inr(sale.igst)}</b></td> : <><td><b>{inr(sale.cgst)}</b></td><td><b>{inr(sale.sgst)}</b></td></>}
            <td><b>{inr(sale.total - sale.roundOff)}</b></td>
          </tr>
        </tfoot>
      </table>

      <div className="a4-bottom">
        <div className="a4-left">
          <div className="a4-label">Amount in words</div>
          <div><b>{rupeesInWords(sale.total)}</b></div>
          <div className="a4-label" style={{ marginTop: 10 }}>GST summary</div>
          <table className="a4-small">
            <thead><tr><th className="l">HSN</th><th>Rate</th><th>Taxable</th>{sale.isInterState ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}<th>Total tax</th></tr></thead>
            <tbody>{summary.map(([r, v]) => (
              <tr key={r}><td className="l">{[...v.hsn].join(', ') || '—'}</td><td>{r}%</td><td>{inr(v.taxable)}</td>
                {sale.isInterState ? <td>{inr(v.tax)}</td> : <><td>{inr(splitTax(v.tax)[0])}</td><td>{inr(splitTax(v.tax)[1])}</td></>}<td>{inr(v.tax)}</td></tr>
            ))}</tbody>
          </table>
          <div className="a4-label" style={{ marginTop: 10 }}>Payment</div>
          <div>{sale.payments.map((p) => `${PAYMENT_LABEL[p.method] ?? p.method} ₹${inr(p.amount)}${p.reference ? ` (${p.reference})` : ''}`).join(' · ')}</div>
          {sale.changeAmount > 0 && <div>Change returned ₹{inr(sale.changeAmount)}</div>}
        </div>
        <table className="a4-totals"><tbody>
          <tr><td>Gross value (MRP)</td><td>{inr(sale.mrpTotal)}</td></tr>
          {sale.mrpTotal > sale.grossTotal && <tr><td>Less: markdown on MRP</td><td>-{inr(sale.mrpTotal - sale.grossTotal)}</td></tr>}
          {sale.itemDiscount + sale.billDiscount > 0 && <tr><td>Less: discount</td><td>-{inr(sale.itemDiscount + sale.billDiscount)}</td></tr>}
          <tr><td>Taxable value</td><td>{inr(sale.taxableAmount)}</td></tr>
          {sale.isInterState ? <tr><td>IGST</td><td>{inr(sale.igst)}</td></tr> : <><tr><td>CGST</td><td>{inr(sale.cgst)}</td></tr><tr><td>SGST</td><td>{inr(sale.sgst)}</td></tr></>}
          {sale.roundOff !== 0 && <tr><td>Round off</td><td>{inr(sale.roundOff)}</td></tr>}
          <tr className="grand"><td>Invoice total</td><td>₹{inr(sale.total)}</td></tr>
        </tbody></table>
      </div>

      <div className="a4-foot">
        <div>
          <div>{footer ?? 'Goods once sold can be exchanged within 7 days with the bill.'}</div>
          <div className="sub">Prices are inclusive of GST. This is a computer-generated invoice.</div>
        </div>
        <div className="a4-sign">For {business}<div className="line">Authorised signatory</div></div>
      </div>
      <div className="a4-brand">Billing by NPOS · Infinite Solution</div>
    </div>
  );
}

/**
 * Renders children into a print-only container, sets the page size for the paper and opens the print dialog once.
 * Thermal paper gets a page exactly as wide as the roll and as tall as the content, so nothing lands on an A4 sheet.
 */
export function PrintPortal({ children, onDone, paper = 80 }: { children: React.ReactNode; onDone: () => void; paper?: Paper }) {
  const area = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useLayoutEffect(() => {
    const style = document.createElement('style');
    if (paper === 'a4') {
      style.textContent = '@page { size: A4 portrait; margin: 10mm; }';
    } else {
      const px = area.current?.scrollHeight ?? 1000;
      const heightMm = Math.ceil((px * 25.4) / 96) + 6; // a little tail for the cutter
      style.textContent = `@page { size: ${paper}mm ${heightMm}mm; margin: 0; }`;
    }
    document.head.appendChild(style);
    document.body.classList.add('printing');
    const t = setTimeout(() => {
      window.print();
      document.body.classList.remove('printing');
      style.remove();
      done.current();
    }, 60);
    return () => {
      clearTimeout(t);
      document.body.classList.remove('printing');
      style.remove();
    };
  }, [paper]);

  return createPortal(<div ref={area} className={`print-area paper-${paper}`}>{children}</div>, document.body);
}
