import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { StockRow, VariantSearch } from '../components/VariantSearch';
import { Confirm, Empty, ErrorBox, Loading, Modal, Pager, StatusChip, Tabs, useDebounced, useLoad, useToast } from '../components/ui';
import { get, Paged, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, inr, isoToday } from '../lib/format';
import { computePurchase } from '../lib/purchase-calc';
import { PaySupplier, SupplierRow } from './Suppliers';

interface PurchaseRow { id: string; purchaseNo: string; supplierInvoiceNo?: string; createdAt: string; status: 'draft' | 'received' | 'cancelled'; total: number; paidAmount: number; totalQty: number; dueDate?: string; supplier: { id: string; name: string }; store: { name: string; code: string } }
interface PurchaseDetail extends PurchaseRow {
  storeId: string; supplierId: string; supplierInvoiceDate?: string; isInterState: boolean; taxableAmount: number; cgst: number; sgst: number; igst: number; otherCharges: number; discount: number; roundOff: number;
  notes?: string; createdByName?: string; receivedAt?: string; receivedByName?: string; cancelReason?: string;
  items: { id: string; variantId: string; productName: string; sku: string; size?: string; color?: string; qty: number; unitCost: number; gstRate: number; taxableAmount: number; taxAmount: number; lineTotal: number }[];
  payments: { id: string; amount: number; method: string; reference?: string; paidOn: string }[];
}

export default function Purchases() {
  const { store, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<'' | 'draft' | 'received' | 'unpaid'>('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<PurchaseDetail | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get('open'));
  const supplierId = params.get('supplier') ?? undefined;
  useEffect(() => setPage(1), [tab, q, supplierId]);
  const list = useLoad(() => get<Paged<PurchaseRow>>('/purchases', {
    storeId: store?.id, supplierId, search: q, page, pageSize: 15,
    ...(tab === 'unpaid' ? { payment: 'unpaid' } : tab ? { status: tab } : {}),
  }), [store?.id, supplierId, q, page, tab]);
  const canBuy = can('tenant_admin', 'store_manager', 'inventory_user');

  return (
    <>
      <Topbar crumb="Catalogue › Purchases" title="Purchases">
        <div className="search"><Icon name="search" size={16} /><input placeholder="PO no., bill no. or supplier" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {canBuy && <button className="btn primary" onClick={() => setEditor('new')}><Icon name="plus" />New Purchase</button>}
      </Topbar>
      <div className="content">
        <div className="row">
          <Tabs value={tab} onChange={setTab} options={[['', 'All'], ['draft', 'Drafts'], ['received', 'Received'], ['unpaid', 'Unpaid']]} />
          {supplierId && <span className="chip blue nodot" style={{ cursor: 'pointer' }} onClick={() => setParams({})}>Filtered by supplier ✕</span>}
          <div className="grow" />
          <span className="muted" style={{ fontSize: 12 }}>Supplier costs are GST-exclusive · receiving adds stock to {store?.name}</span>
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data!.items.length ? <Empty icon="truck" title="No purchases" text="Record a supplier bill to bring stock in" action={canBuy && <button className="btn sm primary" onClick={() => setEditor('new')}><Icon name="plus" />New purchase</button>} /> : (
            <>
              <table className="t">
                <thead><tr><th>Purchase</th><th>Supplier</th><th>Date</th><th className="r">Pieces</th><th className="r">Total</th><th>Payment</th><th>Status</th></tr></thead>
                <tbody>{list.data!.items.map((p) => (
                  <tr key={p.id} className="click" onClick={() => setOpenId(p.id)}>
                    <td><b>{p.purchaseNo}</b><div className="muted" style={{ fontSize: 11 }}>{p.supplierInvoiceNo ? `Bill ${p.supplierInvoiceNo}` : 'No bill no.'} · {p.store.code}</div></td>
                    <td>{p.supplier.name}</td>
                    <td>{fmtDate(p.createdAt)}</td>
                    <td className="r num">{p.totalQty}</td>
                    <td className="r num"><b>{inr(p.total)}</b></td>
                    <td>{p.status !== 'received' ? <span className="muted">—</span> : p.paidAmount >= p.total ? <span className="chip green">Paid</span>
                      : <span className={`chip ${p.dueDate && p.dueDate < isoToday() ? 'red' : 'amber'}`}>{inr(p.total - p.paidAmount)} due{p.dueDate ? ` · ${fmtDate(p.dueDate)}` : ''}</span>}</td>
                    <td><StatusChip status={p.status === 'draft' ? 'pending' : p.status === 'received' ? 'completed' : p.status} label={p.status === 'draft' ? 'Draft' : p.status === 'received' ? 'Received' : undefined} /></td>
                  </tr>
                ))}</tbody>
              </table>
              <Pager {...list.data!} onPage={setPage} />
            </>
          )}
        </div>
      </div>
      {editor && store && <PurchaseEditor storeId={store.id} existing={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={(id) => { setEditor(null); list.reload(); setOpenId(id); }} />}
      {openId && !editor && <PurchaseView id={openId} onClose={() => { setOpenId(null); if (params.get('open')) setParams({}); }} onEdit={(p) => setEditor(p)} onChanged={list.reload} />}
    </>
  );
}

interface Line { variantId: string; productName: string; sku: string; size?: string; color?: string; qty: string; unitCost: string; gstRate: number; stock?: number }

function PurchaseEditor({ storeId, existing, onClose, onSaved }: { storeId: string; existing: PurchaseDetail | null; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const suppliers = useLoad(() => get<SupplierRow[]>('/suppliers'), []);
  const [supplierId, setSupplierId] = useState(existing?.supplierId ?? '');
  const [invoiceNo, setInvoiceNo] = useState(existing?.supplierInvoiceNo ?? '');
  const [invoiceDate, setInvoiceDate] = useState(existing?.supplierInvoiceDate ?? isoToday());
  const [lines, setLines] = useState<Line[]>(existing?.items.map((i) => ({ variantId: i.variantId, productName: i.productName, sku: i.sku, size: i.size, color: i.color, qty: String(i.qty), unitCost: String(i.unitCost), gstRate: i.gstRate })) ?? []);
  const [discount, setDiscount] = useState(existing?.discount ? String(existing.discount) : '');
  const [charges, setCharges] = useState(existing?.otherCharges ? String(existing.otherCharges) : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [updateCost, setUpdateCost] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!supplierId && suppliers.data?.[0]) setSupplierId(suppliers.data[0].id); }, [suppliers.data, supplierId]);

  const supplier = suppliers.data?.find((s) => s.id === supplierId);
  // same rule as the server: supplier GST state differs from ours -> IGST
  const interState = !!(supplier?.gstin && me?.tenant?.stateCode && supplier.gstin.slice(0, 2) !== me.tenant.stateCode);
  const calc = useMemo(() => computePurchase(lines.map((l) => ({ qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0, gstRate: l.gstRate })), { discount: Number(discount) || 0, otherCharges: Number(charges) || 0, interState }), [lines, discount, charges, interState]);

  const add = (r: StockRow) => setLines((ls) => {
    const i = ls.findIndex((l) => l.variantId === r.id);
    if (i >= 0) return ls.map((l, k) => (k === i ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l));
    return [...ls, { variantId: r.id, productName: r.productName, sku: r.sku, size: r.size, color: r.color, qty: '1', unitCost: String(r.purchasePrice || ''), gstRate: r.gstRate ?? 5, stock: r.stock }];
  });
  const setLine = (i: number, patchL: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patchL } : l)));
  const valid = supplierId && lines.length > 0 && lines.every((l) => Number(l.qty) >= 1 && Number(l.unitCost) >= 0);

  const save = async (receive: boolean) => {
    setBusy(true);
    const body = {
      storeId, supplierId, supplierInvoiceNo: invoiceNo || undefined, supplierInvoiceDate: invoiceDate || undefined,
      items: lines.map((l) => ({ variantId: l.variantId, qty: Number(l.qty), unitCost: Number(l.unitCost), gstRate: l.gstRate })),
      discount: Number(discount) || 0, otherCharges: Number(charges) || 0, notes: notes || undefined, receive, updateCost,
    };
    try {
      const r = existing ? await patch<PurchaseDetail>(`/purchases/${existing.id}`, body) : await post<PurchaseDetail>('/purchases', body);
      toast(receive ? `${r.purchaseNo} received - ${r.totalQty} pieces added to stock` : `${r.purchaseNo} saved as draft`, 'success');
      onSaved(r.id);
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };

  return (
    <Modal title={existing ? `Edit ${existing.purchaseNo}` : 'New purchase'} sub="Enter the supplier bill. Costs exclude GST; GST is added per line." icon="truck" onClose={onClose} width={980}
      footer={<>
        <label className="row grow" style={{ gap: 8, fontSize: 12.5, cursor: 'pointer' }}><span className={`check ${updateCost ? 'on' : ''}`} onClick={() => setUpdateCost(!updateCost)} />Update product cost prices from this bill</label>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!valid || busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn primary" disabled={!valid || busy} onClick={() => save(true)}><Icon name="check" />Save &amp; receive stock</button>
      </>}>
      <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr' }}>
        <div className="field"><label>Supplier</label>
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.data?.length === 0 && <option value="">Add a supplier first</option>}
            {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}{s.gstin ? ` · ${s.gstin}` : ''}</option>)}
          </select></div>
        <div className="field"><label>Supplier bill no.</label><input className="input" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. UDM/2026/1184" /></div>
        <div className="field"><label>Bill date</label><input className="input" type="date" value={invoiceDate} max={isoToday()} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
      </div>
      <div style={{ marginTop: 14 }}><VariantSearch storeId={storeId} onPick={add} autoFocus={!existing} /></div>
      <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {lines.length === 0 ? <Empty icon="scan" title="No items yet" text="Scan the barcodes on the delivered pieces or search by product name" /> : (
          <table className="t">
            <thead><tr><th>Item</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 120 }}>Cost / pc (excl. GST)</th><th style={{ width: 90 }}>GST</th><th className="r">Taxable</th><th className="r">Line total</th><th style={{ width: 30 }} /></tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={l.variantId}>
                <td><b>{l.productName}</b><div className="muted" style={{ fontSize: 11 }}>{[l.size, l.color].filter(Boolean).join(' · ')} · {l.sku}{l.stock !== undefined ? ` · ${l.stock} in stock` : ''}</div></td>
                <td><input className="input num" style={{ height: 32 }} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value.replace(/\D/g, '') })} /></td>
                <td><input className="input num" style={{ height: 32 }} value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value.replace(/[^\d.]/g, '') })} /></td>
                <td><select className="input" style={{ height: 32 }} value={l.gstRate} onChange={(e) => setLine(i, { gstRate: Number(e.target.value) })}>{[0, 3, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></td>
                <td className="r num">{inr(calc.lines[i]?.taxableAmount ?? 0, true)}</td>
                <td className="r num"><b>{inr(calc.lines[i]?.lineTotal ?? 0, true)}</b></td>
                <td><button className="link faint" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="Remove"><Icon name="trash" size={16} /></button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      <div className="row" style={{ marginTop: 14, gap: 18, alignItems: 'flex-start' }}>
        <div className="form-grid grow">
          <div className="field"><label>Trade discount (₹, before GST)</label><input className="input num" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/[^\d.]/g, ''))} /></div>
          <div className="field"><label>Freight / other charges (₹)</label><input className="input num" value={charges} onChange={(e) => setCharges(e.target.value.replace(/[^\d.]/g, ''))} /></div>
          <div className="field full"><label>Notes</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <div style={{ width: 300, background: 'var(--bg)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }} className="num">
          <div className="row between"><span className="muted">Goods value</span><b>{inr(calc.grossAmount, true)}</b></div>
          {calc.discount > 0 && <div className="row between"><span className="muted">Discount</span><b className="up">− {inr(calc.discount, true)}</b></div>}
          <div className="row between"><span className="muted">Taxable</span><b>{inr(calc.taxableAmount, true)}</b></div>
          <div className="row between"><span className="muted">GST (CGST + SGST / IGST)</span><b>{inr(calc.cgst + calc.sgst + calc.igst, true)}</b></div>
          {calc.otherCharges > 0 && <div className="row between"><span className="muted">Other charges</span><b>{inr(calc.otherCharges, true)}</b></div>}
          <div className="row between"><span className="muted">Round off</span><b>{inr(calc.roundOff, true)}</b></div>
          <div className="row between" style={{ borderTop: '1px dashed var(--line)', paddingTop: 8, marginTop: 4 }}><b>Bill total · {calc.totalQty} pcs</b><b style={{ fontSize: 18, color: 'var(--blue)' }}>{inr(calc.total, true)}</b></div>
        </div>
      </div>
    </Modal>
  );
}

function PurchaseView({ id, onClose, onEdit, onChanged }: { id: string; onClose: () => void; onEdit: (p: PurchaseDetail) => void; onChanged: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const { data: p, loading, error, reload } = useLoad(() => get<PurchaseDetail>(`/purchases/${id}`), [id]);
  const [cancelling, setCancelling] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [paying, setPaying] = useState(false);
  const changed = () => { reload(); onChanged(); };
  const canBuy = can('tenant_admin', 'store_manager', 'inventory_user');
  return (
    <Modal title={p ? p.purchaseNo : 'Purchase'} sub={p && `${p.supplier.name}${p.supplierInvoiceNo ? ` · bill ${p.supplierInvoiceNo}` : ''} · ${p.store.name}`} icon="truck" onClose={onClose} width={860}
      footer={p && <>
        {p.status === 'draft' && canBuy && <><button className="btn danger" onClick={() => setCancelling(true)}>Cancel draft</button><span className="grow" /><button className="btn" onClick={() => onEdit(p)}><Icon name="edit" />Edit</button><button className="btn primary" onClick={() => setReceiving(true)}><Icon name="check" />Receive stock</button></>}
        {p.status === 'received' && p.paidAmount < p.total && can('tenant_admin', 'store_manager', 'accountant') && <button className="btn primary" onClick={() => setPaying(true)}><Icon name="wallet" />Pay {inr(p.total - p.paidAmount)}</button>}
        {p.status !== 'draft' && <button className="btn" onClick={onClose}>Close</button>}
      </>}>
      {loading && !p ? <Loading /> : error || !p ? <ErrorBox error={error ?? 'Not found'} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row" style={{ gap: 18, flexWrap: 'wrap', fontSize: 12.5 }}>
            <StatusChip status={p.status === 'draft' ? 'pending' : p.status === 'received' ? 'completed' : p.status} label={p.status === 'draft' ? 'Draft' : p.status === 'received' ? 'Received' : 'Cancelled'} />
            <span><span className="muted">Created</span> {fmtDate(p.createdAt)} · {p.createdByName}</span>
            {p.receivedAt && <span><span className="muted">Received</span> {fmtDate(p.receivedAt)} · {p.receivedByName}</span>}
            {p.dueDate && p.status === 'received' && <span><span className="muted">Due</span> {fmtDate(p.dueDate)}</span>}
            {p.cancelReason && <span className="down">Cancelled: {p.cancelReason}</span>}
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            <table className="t">
              <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Cost</th><th className="r">GST</th><th className="r">Taxable</th><th className="r">Total</th></tr></thead>
              <tbody>{p.items.map((i) => (
                <tr key={i.id}><td><b>{i.productName}</b><div className="muted" style={{ fontSize: 11 }}>{[i.size, i.color].filter(Boolean).join(' · ')} · {i.sku}</div></td>
                  <td className="r num">{i.qty}</td><td className="r num">{inr(i.unitCost, true)}</td><td className="r">{i.gstRate}%</td><td className="r num">{inr(i.taxableAmount, true)}</td><td className="r num"><b>{inr(i.lineTotal, true)}</b></td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
            <div className="grow">
              <b>Payments</b>
              {p.payments.length === 0 ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>No payments against this bill yet</div> : p.payments.map((x) => (
                <div key={x.id} className="row" style={{ fontSize: 12.5, marginTop: 6 }}><span className="chip green nodot">{x.method.toUpperCase()}</span><span className="grow">{x.reference}</span><span className="muted">{fmtDate(x.paidOn)}</span><b className="num">{inr(x.amount)}</b></div>
              ))}
              {p.notes && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Notes: {p.notes}</div>}
            </div>
            <div style={{ width: 300, background: 'var(--bg)', borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5 }} className="num">
              <div className="row between"><span className="muted">Taxable</span><b>{inr(p.taxableAmount, true)}</b></div>
              {p.isInterState ? <div className="row between"><span className="muted">IGST</span><b>{inr(p.igst, true)}</b></div>
                : <><div className="row between"><span className="muted">CGST</span><b>{inr(p.cgst, true)}</b></div><div className="row between"><span className="muted">SGST</span><b>{inr(p.sgst, true)}</b></div></>}
              {p.otherCharges > 0 && <div className="row between"><span className="muted">Other charges</span><b>{inr(p.otherCharges, true)}</b></div>}
              <div className="row between" style={{ borderTop: '1px dashed var(--line)', paddingTop: 8 }}><b>Total</b><b style={{ fontSize: 17 }}>{inr(p.total, true)}</b></div>
              {p.status === 'received' && <div className="row between"><span className="muted">Paid</span><b className={p.paidAmount >= p.total ? 'up' : 'down'}>{inr(p.paidAmount, true)}</b></div>}
            </div>
          </div>
        </div>
      )}
      {receiving && p && <Confirm title={`Receive ${p.purchaseNo}?`} confirmLabel="Receive stock" onClose={() => setReceiving(false)}
        text={<>{p.totalQty} pieces are added to {p.store.name} stock and product cost prices are updated from this bill.</>}
        onConfirm={async () => { await post(`/purchases/${p.id}/receive`, { updateCost: true }); toast('Stock received', 'success'); changed(); }} />}
      {cancelling && p && <Confirm title={`Cancel ${p.purchaseNo}?`} danger needReason confirmLabel="Cancel draft" onClose={() => setCancelling(false)} text="The draft stays on record as cancelled. No stock has moved."
        onConfirm={async (reason) => { await post(`/purchases/${p.id}/cancel`, { reason }); toast('Draft cancelled', 'success'); changed(); }} />}
      {paying && p && <PaySupplier supplier={{ id: p.supplier.id, name: p.supplier.name, outstanding: p.total - p.paidAmount }} purchase={{ id: p.id, purchaseNo: p.purchaseNo, due: p.total - p.paidAmount }} onClose={() => setPaying(false)} onDone={() => { setPaying(false); changed(); }} />}
    </Modal>
  );
}
