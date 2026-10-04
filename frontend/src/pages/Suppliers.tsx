import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { Avatar, Empty, ErrorBox, Kpi, Loading, Modal, StatusChip, Tabs, useDebounced, useLoad, useToast } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, inr, isoToday, PAYMENT_LABEL, relDay } from '../lib/format';

export interface SupplierRow { id: string; name: string; contactName?: string; mobile?: string; gstin?: string; city?: string; isActive: boolean; paymentTermsDays: number; billed: number; bills: number; lastPurchase?: string; outstanding: number; overdue: number }
interface SupplierDetail extends SupplierRow {
  email?: string; address?: string; stateCode?: string; openingBalance: number; notes?: string;
  purchases: { id: string; purchaseNo: string; supplierInvoiceNo?: string; createdAt: string; total: number; paidAmount: number; status: string; dueDate?: string }[];
  payments: { id: string; amount: number; method: string; reference?: string; paidOn: string; userName?: string; purchaseId: string | null }[];
}

export default function Suppliers() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState<'active' | 'all'>('active');
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<SupplierDetail> | null>(null);
  const [paying, setPaying] = useState<SupplierDetail | null>(null);
  const list = useLoad(() => get<SupplierRow[]>('/suppliers', { search: q, status }), [q, status]);
  useEffect(() => { if (!sel && list.data?.[0]) setSel(list.data[0].id); }, [list.data, sel]);
  const detail = useLoad(() => (sel ? get<SupplierDetail>(`/suppliers/${sel}`) : Promise.resolve(null)), [sel]);
  const d = detail.data;
  const rows = list.data ?? [];
  const totals = rows.reduce((a, r) => ({ out: a.out + r.outstanding, over: a.over + r.overdue, billed: a.billed + r.billed }), { out: 0, over: 0, billed: 0 });
  const canEdit = can('tenant_admin', 'store_manager', 'inventory_user');
  const canPay = can('tenant_admin', 'store_manager', 'accountant');

  return (
    <>
      <Topbar crumb="Catalogue › Suppliers" title="Suppliers">
        <div className="search"><Icon name="search" size={16} /><input placeholder="Name, mobile or GSTIN…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {canEdit && <button className="btn primary" onClick={() => setEditing({ paymentTermsDays: 30 })}><Icon name="plus" />Add Supplier</button>}
      </Topbar>
      <div className="content" style={{ flexDirection: 'row' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <Kpi icon="building" label="Suppliers" value={rows.length} delta={`${inr(totals.billed)} purchased`} />
            <Kpi icon="wallet" tone="amber" label="Payable to suppliers" value={inr(totals.out)} delta="received bills + opening balance − payments" />
            <Kpi icon="alert" tone="red" label="Overdue" value={inr(totals.over)} delta="past the payment terms" />
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="row" style={{ padding: '12px 16px' }}><Tabs value={status} onChange={setStatus} options={[['active', 'Active'], ['all', 'All incl. inactive']]} /></div>
            {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !rows.length ? <Empty icon="building" title="No suppliers yet" text="Add the vendors you buy stock from" /> : (
              <table className="t">
                <thead><tr><th>Supplier</th><th>Contact</th><th className="r">Bills</th><th className="r">Purchased</th><th className="r">Outstanding</th><th>Last purchase</th></tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={r.id} className={`click ${r.id === sel ? 'sel' : ''}`} onClick={() => setSel(r.id)}>
                    <td><div className="row"><Avatar name={r.name} square /><div><b>{r.name}</b><div className="muted" style={{ fontSize: 11 }}>{r.gstin ?? 'No GSTIN'} · {r.city}</div></div>{!r.isActive && <StatusChip status="inactive" />}</div></td>
                    <td>{r.contactName ?? '—'}<div className="muted" style={{ fontSize: 11 }}>{r.mobile}</div></td>
                    <td className="r num">{r.bills}</td>
                    <td className="r num">{inr(r.billed)}</td>
                    <td className="r num"><b>{inr(r.outstanding)}</b>{r.overdue > 0 && <div className="down" style={{ fontSize: 11 }}>{inr(r.overdue)} overdue</div>}</td>
                    <td>{r.lastPurchase ? relDay(r.lastPurchase) : <span className="muted">—</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
        <div className="card" style={{ width: 400, flex: 'none', display: 'flex', flexDirection: 'column', overflow: 'auto', alignSelf: 'flex-start', maxHeight: '100%' }}>
          {!d ? (detail.loading ? <Loading /> : <Empty icon="building" title="Select a supplier" />) : (
            <>
              <div style={{ padding: 18, borderBottom: '1px solid var(--line)' }}>
                <div className="row"><Avatar name={d.name} size={46} square /><div className="grow" style={{ minWidth: 0 }}><b style={{ fontSize: 16 }}>{d.name}</b><div className="muted" style={{ fontSize: 11.5 }}>{d.gstin ?? 'Unregistered'} · {d.paymentTermsDays}-day terms</div></div>
                  {canEdit && <button className="iconbtn" onClick={() => setEditing(d)} aria-label="Edit"><Icon name="edit" /></button>}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginTop: 14, fontSize: 12 }}>
                  <div><span className="muted">Contact</span><br /><b>{d.contactName ?? '—'}</b></div><div><span className="muted">Mobile</span><br /><b>{d.mobile ?? '—'}</b></div>
                  <div><span className="muted">City</span><br /><b>{d.city ?? '—'}</b></div><div><span className="muted">Opening balance</span><br /><b>{inr(d.openingBalance)}</b></div>
                </div>
              </div>
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="row between" style={{ background: d.overdue > 0 ? 'var(--red-l)' : 'var(--bg)', borderRadius: 12, padding: '12px 14px' }}>
                  <div><span className="muted" style={{ fontSize: 11.5 }}>Outstanding</span><br /><b className="num" style={{ fontSize: 20 }}>{inr(d.outstanding)}</b>{d.overdue > 0 && <div className="down" style={{ fontSize: 11.5 }}>{inr(d.overdue)} overdue</div>}</div>
                  {canPay && d.outstanding > 0 && <button className="btn primary" onClick={() => setPaying(d)}><Icon name="wallet" />Record payment</button>}
                </div>
                <div className="row between"><b>Purchase bills</b><Link className="link" style={{ fontSize: 12 }} to={`/purchases?supplier=${d.id}`}>All →</Link></div>
                {d.purchases.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No purchases yet</span>}
                {d.purchases.slice(0, 6).map((p) => (
                  <Link key={p.id} to={`/purchases?open=${p.id}`} className="row" style={{ textDecoration: 'none', borderBottom: '1px solid var(--line-2)', paddingBottom: 8 }}>
                    <div className="grow"><b>{p.purchaseNo}</b><div className="muted" style={{ fontSize: 11 }}>{p.supplierInvoiceNo ? `Bill ${p.supplierInvoiceNo} · ` : ''}{fmtDate(p.createdAt)}{p.dueDate && p.status === 'received' && p.paidAmount < p.total ? ` · due ${fmtDate(p.dueDate)}` : ''}</div></div>
                    <div style={{ textAlign: 'right' }}><b className="num">{inr(p.total)}</b><div style={{ fontSize: 11 }}>{p.status !== 'received' ? <StatusChip status={p.status === 'draft' ? 'pending' : p.status} label={p.status === 'draft' ? 'Draft' : undefined} /> : p.paidAmount >= p.total ? <span className="up">Paid</span> : <span className="down">{inr(p.total - p.paidAmount)} due</span>}</div></div>
                  </Link>
                ))}
                <b style={{ marginTop: 6 }}>Payments</b>
                {d.payments.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No payments recorded</span>}
                {d.payments.slice(0, 6).map((p) => (
                  <div key={p.id} className="row" style={{ fontSize: 12 }}><span className="chip green nodot">{PAYMENT_LABEL[p.method] ?? p.method}</span><span className="grow">{p.reference ?? ''} {p.purchaseId ? '' : <span className="muted">· on account</span>}</span><span className="muted">{fmtDate(p.paidOn)}</span><b className="num">{inr(p.amount)}</b></div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {editing && <SupplierForm initial={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); list.reload(); setSel(id); detail.reload(); }} />}
      {paying && <PaySupplier supplier={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); list.reload(); detail.reload(); }} />}
    </>
  );
}

function SupplierForm({ initial, onClose, onSaved }: { initial: Partial<SupplierDetail>; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: initial.name ?? '', contactName: initial.contactName ?? '', mobile: initial.mobile ?? '', email: initial.email ?? '', gstin: initial.gstin ?? '',
    address: initial.address ?? '', city: initial.city ?? '', paymentTermsDays: String(initial.paymentTermsDays ?? 30), openingBalance: String(initial.openingBalance ?? ''), notes: initial.notes ?? '',
  });
  const [active, setActive] = useState(initial.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true);
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || undefined]));
    body.paymentTermsDays = Number(f.paymentTermsDays) || 0;
    body.openingBalance = Number(f.openingBalance) || 0;
    if (initial.id) body.isActive = active;
    try {
      const r = initial.id ? await patch<{ id: string }>(`/suppliers/${initial.id}`, body) : await post<{ id: string }>('/suppliers', body);
      toast(initial.id ? 'Supplier updated' : 'Supplier added', 'success');
      onSaved(r.id);
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={initial.id ? `Edit ${initial.name}` : 'Add supplier'} icon="building" onClose={onClose} width={600}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || f.name.trim().length < 2} onClick={save}>Save supplier</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Supplier / firm name *</label><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label>Contact person</label><input className="input" value={f.contactName} onChange={(e) => set('contactName', e.target.value)} /></div>
        <div className="field"><label>Mobile</label><input className="input num" value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} /></div>
        <div className="field"><label>GSTIN</label><input className="input" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))} placeholder="decides CGST+SGST vs IGST" /></div>
        <div className="field"><label>Email</label><input className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
        <div className="field"><label>City</label><input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
        <div className="field"><label>Payment terms (days)</label><input className="input num" value={f.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value.replace(/\D/g, ''))} /></div>
        <div className="field full"><label>Address</label><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
        <div className="field"><label>Opening balance owed (₹)</label><input className="input num" value={f.openingBalance} onChange={(e) => set('openingBalance', e.target.value.replace(/[^\d.]/g, ''))} /><span className="hint">Dues from before you started using NPOS</span></div>
        {initial.id && <div className="field"><label>Status</label><label className="row" style={{ gap: 8, height: 38, cursor: 'pointer' }}><span className={`toggle ${active ? 'on' : ''}`} onClick={() => setActive(!active)} />{active ? 'Active' : 'Inactive'}</label></div>}
        <div className="field full"><label>Notes</label><textarea className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export function PaySupplier({ supplier, purchase, onClose, onDone }: { supplier: { id: string; name: string; outstanding: number }; purchase?: { id: string; purchaseNo: string; due: number }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(String(Math.round(purchase?.due ?? supplier.outstanding)));
  const [method, setMethod] = useState('bank');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(isoToday());
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try {
      await post(`/suppliers/${supplier.id}/payments`, { amount: Number(amount), method, reference: reference || undefined, paidOn, purchaseId: purchase?.id });
      toast(`Payment of ${inr(Number(amount))} recorded`, 'success');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={`Pay ${supplier.name}`} sub={purchase ? `Against ${purchase.purchaseNo} · due ${inr(purchase.due)}` : `Outstanding ${inr(supplier.outstanding)} · settles the oldest bills first`} icon="wallet" onClose={onClose} width={460}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !(Number(amount) > 0)} onClick={pay}>Record payment</button></>}>
      <div className="form-grid">
        <div className="field"><label>Amount (₹)</label><input className="input num" autoFocus value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} /></div>
        <div className="field"><label>Paid on</label><input className="input" type="date" value={paidOn} max={isoToday()} onChange={(e) => setPaidOn(e.target.value)} /></div>
        <div className="field"><label>Mode</label><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="bank">Bank transfer (NEFT/RTGS)</option><option value="upi">UPI</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option></select></div>
        <div className="field"><label>Reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UTR / cheque no." /></div>
      </div>
    </Modal>
  );
}
