import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { Avatar, Empty, ErrorBox, Kpi, Loading, Modal, Pager, StatusChip, Tabs, useDebounced, useLoad, useToast } from '../components/ui';
import { get, Paged, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, n, relDay } from '../lib/format';

interface Row { id: string; name: string; mobile: string; email?: string; gstin?: string; loyaltyPoints: number; storeCredit: number; visits: number; lifetimeSpend: number; lastVisit?: string }
interface Stats { total: number; newThisMonth: number; pointsOutstanding: number; storeCreditOutstanding: number; repeatRate: number }
interface Detail extends Row { address?: string; notes?: string; avgBill: number; preferredSizes: string[]; sales: { id: string; invoiceNo: string; createdAt: string; total: number; totalQty: number; status: string; payments: { method: string }[] }[]; returns: { id: string; returnNo: string; createdAt: string; type: string; returnedValue: number }[] }

export default function Customers() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [segment, setSegment] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<'purchases' | 'returns' | 'profile'>('purchases');
  const [editing, setEditing] = useState<Partial<Detail> | null>(null);
  useEffect(() => setPage(1), [q, segment]);

  const stats = useLoad(() => get<Stats>('/customers/stats'), []);
  const list = useLoad(() => get<Paged<Row>>('/customers', { search: q, segment, page, pageSize: 12 }), [q, segment, page]);
  useEffect(() => { if (!sel && list.data?.items[0]) setSel(list.data.items[0].id); }, [list.data, sel]);
  const detail = useLoad(() => (sel ? get<Detail>(`/customers/${sel}`) : Promise.resolve(null)), [sel]);
  const c = detail.data;

  return (
    <>
      <Topbar crumb="Sales › Customers" title="Customers">
        <div className="search"><Icon name="phone" size={16} /><input placeholder="Name or mobile number…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <button className="btn primary" onClick={() => setEditing({})}><Icon name="plus" />Add Customer</button>
      </Topbar>
      <div className="content" style={{ flexDirection: 'row' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
            <Kpi icon="users" label="Total customers" value={stats.data ? n(stats.data.total) : '…'} delta={stats.data && <><span className="up">+{stats.data.newThisMonth}</span> this month</>} />
            <Kpi icon="refresh" tone="green" label="Repeat rate" value={stats.data ? `${stats.data.repeatRate}%` : '…'} delta="visited 2+ times in 90 days" />
            <Kpi icon="star" tone="amber" label="Loyalty points outstanding" value={stats.data ? n(stats.data.pointsOutstanding) : '…'} delta={stats.data && `${inr(stats.data.storeCreditOutstanding)} store credit held`} />
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div className="row" style={{ padding: '12px 16px' }}><Tabs value={segment} onChange={setSegment} options={[['', 'All'], ['loyal', 'Loyal (5+ visits)'], ['new', 'New'], ['b2b', 'B2B (GSTIN)'], ['inactive', 'Inactive 90d']]} /></div>
            {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data!.items.length ? <Empty icon="users" title="No customers found" /> : (
              <>
                <table className="t">
                  <thead><tr><th>Customer</th><th>Mobile</th><th className="r">Visits</th><th className="r">Lifetime spend</th><th>Last visit</th><th className="r">Points</th></tr></thead>
                  <tbody>{list.data!.items.map((r) => (
                    <tr key={r.id} className={`click ${r.id === sel ? 'sel' : ''}`} onClick={() => setSel(r.id)}>
                      <td><div className="row"><Avatar name={r.name} /><b>{r.name}</b>{r.visits >= 15 && <span className="chip amber nodot">Gold</span>}{r.gstin && <span className="chip blue nodot">B2B</span>}</div></td>
                      <td className="num">{r.mobile.replace(/(\d{5})(\d{5})/, '$1 $2')}</td>
                      <td className="r num">{r.visits}</td>
                      <td className="r num"><b>{inr(r.lifetimeSpend)}</b></td>
                      <td>{r.lastVisit ? relDay(r.lastVisit) : <span className="muted">Never</span>}</td>
                      <td className="r num">{r.gstin ? '—' : n(r.loyaltyPoints)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <Pager {...list.data!} onPage={setPage} />
              </>
            )}
          </div>
        </div>
        <div className="card" style={{ width: 400, flex: 'none', display: 'flex', flexDirection: 'column', overflow: 'auto', alignSelf: 'flex-start', maxHeight: '100%' }}>
          {!c ? (detail.loading ? <Loading /> : <Empty icon="user" title="Select a customer" />) : (
            <>
              <div style={{ padding: 18, background: 'linear-gradient(135deg,var(--navy),#1c3aa9)', color: '#fff' }}>
                <div className="row"><div className="av-s" style={{ width: 48, height: 48, fontSize: 16, background: '#fff', color: 'var(--blue)' }}>{c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
                  <div className="grow" style={{ minWidth: 0 }}><b style={{ fontSize: 16 }}>{c.name}</b><div style={{ fontSize: 12, color: '#c7d0ea', marginTop: 2 }}>{c.mobile}{c.email ? ` · ${c.email}` : ''}</div></div>
                  <button className="hbtn" style={{ background: 'rgba(255,255,255,.1)', border: 0, width: 32, height: 32, borderRadius: 8, color: '#fff' }} onClick={() => setEditing(c)} aria-label="Edit"><Icon name="edit" size={16} /></button></div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 16 }}>
                  <div><span style={{ fontSize: 11, color: '#9aa8d6' }}>Lifetime</span><br /><b className="num" style={{ fontSize: 16 }}>{inr(c.lifetimeSpend)}</b></div>
                  <div><span style={{ fontSize: 11, color: '#9aa8d6' }}>Avg bill</span><br /><b className="num" style={{ fontSize: 16 }}>{inr(c.avgBill)}</b></div>
                  <div><span style={{ fontSize: 11, color: '#9aa8d6' }}>Points</span><br /><b className="num" style={{ fontSize: 16 }}>{n(c.loyaltyPoints)}</b></div>
                </div>
              </div>
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {c.preferredSizes.length > 0 && <span className="chip gray nodot">Prefers: {c.preferredSizes.join(' / ')}</span>}
                  <span className="chip gray nodot">{c.visits} visits</span>
                  {c.storeCredit > 0 && <span className="chip green nodot">Store credit {inr(c.storeCredit)}</span>}
                  {c.gstin && <span className="chip blue nodot">GSTIN {c.gstin}</span>}
                </div>
                <Tabs value={tab} onChange={setTab} options={[['purchases', 'Purchases'], ['returns', `Returns (${c.returns.length})`], ['profile', 'Profile']]} />
                {tab === 'purchases' && (c.sales.length === 0 ? <Empty title="No purchases yet" /> : c.sales.map((s) => (
                  <Link key={s.id} to={`/invoices/${s.id}`} className="row" style={{ padding: '9px 0', borderBottom: '1px solid var(--line-2)', textDecoration: 'none' }}>
                    <div className="thumb"><Icon name="receipt" /></div>
                    <div className="grow"><b>{s.invoiceNo}</b><div className="muted" style={{ fontSize: 11 }}>{relDay(s.createdAt)} · {s.totalQty} item{s.totalQty === 1 ? '' : 's'} · {s.payments.map((p) => p.method.toUpperCase()).join(' + ')}</div></div>
                    {s.status === 'cancelled' ? <StatusChip status="cancelled" /> : <b className="num">{inr(s.total)}</b>}
                  </Link>
                )))}
                {tab === 'returns' && (c.returns.length === 0 ? <Empty icon="undo" title="No returns" /> : c.returns.map((r) => (
                  <div key={r.id} className="row" style={{ padding: '9px 0', borderBottom: '1px solid var(--line-2)' }}><div className="grow"><b>{r.returnNo}</b><div className="muted" style={{ fontSize: 11 }}>{relDay(r.createdAt)}</div></div><StatusChip status={r.type} /><b className="num">{inr(r.returnedValue)}</b></div>
                )))}
                {tab === 'profile' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px', fontSize: 12.5 }}>
                    {[['Mobile', c.mobile], ['Email', c.email], ['GSTIN', c.gstin], ['Address', c.address], ['Notes', c.notes]].map(([k, v]) => <div key={k} style={k === 'Address' || k === 'Notes' ? { gridColumn: '1/-1' } : undefined}><span className="muted">{k}</span><br /><b>{v || '—'}</b></div>)}
                  </div>
                )}
                {can('tenant_admin', 'store_manager', 'cashier') && <div className="row" style={{ gap: 8 }}>
                  <a className="btn grow" style={{ justifyContent: 'center' }} href={`https://wa.me/91${c.mobile}`} target="_blank" rel="noreferrer"><Icon name="whatsapp" />WhatsApp</a>
                  <button className="btn primary grow" style={{ justifyContent: 'center' }} onClick={() => nav('/pos')}><Icon name="pos" />New bill</button>
                </div>}
              </div>
            </>
          )}
        </div>
      </div>
      {editing && <CustomerForm initial={editing} onClose={() => setEditing(null)} onSaved={(id) => { setEditing(null); list.reload(); stats.reload(); setSel(id); detail.reload(); }} />}
    </>
  );
}

function CustomerForm({ initial, onClose, onSaved }: { initial: Partial<Detail>; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: initial.name ?? '', mobile: initial.mobile ?? '', email: initial.email ?? '', gstin: initial.gstin ?? '', address: initial.address ?? '', notes: initial.notes ?? '' });
  const [busy, setBusy] = useState(false);
  const valid = f.name.trim() && /^\d{10}$/.test(f.mobile);
  const save = async () => {
    setBusy(true);
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || undefined]));
    try {
      const r = initial.id ? await patch<{ id: string }>(`/customers/${initial.id}`, body) : await post<{ id: string }>('/customers', body);
      toast(initial.id ? 'Customer updated' : 'Customer added', 'success');
      onSaved(r.id);
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={initial.id ? 'Edit customer' : 'Add customer'} icon="user_plus" onClose={onClose} width={520}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <div className="field"><label>Name *</label><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label>Mobile *</label><input className="input num" inputMode="numeric" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></div>
        <div className="field"><label>Email</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="field"><label>GSTIN (B2B)</label><input className="input" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase().slice(0, 15) })} placeholder="29ABCDE1234F1Z5" /></div>
        <div className="field full"><label>Address</label><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div className="field full"><label>Notes</label><textarea className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. prefers slim fit, size L" /></div>
      </div>
    </Modal>
  );
}
