import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Topbar } from '../../components/Layout';
import { Avatar, Confirm, Empty, ErrorBox, Loading, Modal, Pager, StatusChip, Tabs, useDebounced, useLoad, useToast } from '../../components/ui';
import { get, Paged, patch, post } from '../../lib/api';
import { daysUntil, fmtDate, inr, n, PAYMENT_LABEL } from '../../lib/format';

interface Row { id: string; businessName: string; ownerName: string; city?: string; mobile: string; tenantStatus: string; createdAt: string; plan?: string; planCode?: string; maxStores?: number; maxUsers?: number; status?: string; endDate?: string; billingCycle?: string; stores: number; users: number }
interface Plan { id: string; name: string; code: string; priceMonthly: number; priceYearly: number; trialDays: number; modules: string[]; maxStores: number | null; maxUsers: number | null; maxSkus: number | null; isActive: boolean }
interface Detail {
  id: string; businessName: string; code: string; ownerName: string; mobile: string; email: string; gstin?: string; city?: string; state?: string; status: string; createdAt: string; featureOverrides: Record<string, boolean>;
  owner?: { name: string; email: string };
  subscription?: { id: string; status: string; billingCycle: string; startDate: string; endDate: string; amount: number; autoRenew: boolean; plan: Plan };
  history: { id: string; status: string; startDate: string; endDate: string; amount: number; billingCycle: string; isCurrent: boolean; plan: Plan; createdAt: string }[];
  payments: { id: string; amount: number; method: string; status: string; paidAt?: string; createdAt: string; failureReason?: string; reference?: string }[];
  usage: { stores: number; users: number; skus: number; monthTransactions: number; monthSales: number };
  modules: string[];
}
const MODULE_LABEL: Record<string, string> = { pos: 'POS Billing', inventory: 'Inventory', reports: 'Reports', customers: 'Customers', returns: 'Returns', purchases: 'Purchases', multi_store: 'Multi-store', loyalty: 'Loyalty', whatsapp: 'WhatsApp', offline: 'Offline POS' };

export default function Tenants() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState<string | null>(params.get('id'));
  const [onboard, setOnboard] = useState(params.get('onboard') === '1');
  const [action, setAction] = useState<null | 'extend' | 'plan' | 'renew'>(null);
  const [statusChange, setStatusChange] = useState<null | 'active' | 'suspended'>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => { get<Plan[]>('/admin/plans').then(setPlans).catch(() => undefined); }, []);
  useEffect(() => setPage(1), [q, status]);
  const list = useLoad(() => get<Paged<Row> & { counts: Record<string, number> }>('/admin/tenants', { search: q, status, page, pageSize: 10 }), [q, status, page]);
  useEffect(() => { if (!sel && list.data?.items[0]) setSel(list.data.items[0].id); }, [list.data, sel]);
  const detail = useLoad(() => (sel ? get<Detail>(`/admin/tenants/${sel}`) : Promise.resolve(null)), [sel]);
  const t = detail.data;
  const sub = t?.subscription;
  const counts = list.data?.counts;
  const refresh = () => { list.reload(); detail.reload(); };

  const toggleFeature = async (m: string) => {
    if (!t) return;
    const inPlan = sub?.plan.modules.includes(m);
    const on = t.modules.includes(m);
    const overrides = { ...t.featureOverrides };
    // store an override only when it differs from the plan default
    if (!on === !!inPlan) delete overrides[m]; else overrides[m] = !on;
    try { await patch(`/admin/tenants/${t.id}/features`, { overrides }); detail.reload(); toast(`${MODULE_LABEL[m]} ${on ? 'disabled' : 'enabled'} for ${t.businessName}`, 'success'); }
    catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <>
      <Topbar crumb="Platform › Tenants" title="Tenants">
        <button className="btn primary" onClick={() => setOnboard(true)}><Icon name="plus" />Onboard Tenant</button>
      </Topbar>
      <div className="content" style={{ flexDirection: 'row' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="search" style={{ width: 260, background: '#fff' }}><Icon name="search" size={16} /><input placeholder="Business, owner, GSTIN, mobile…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Tabs value={status} onChange={setStatus} options={[['', `All ${counts?.all ?? ''}`], ['active', `Active ${counts?.active ?? ''}`], ['trial', `Trial ${counts?.trial ?? ''}`], ['past_due', `Past due ${counts?.past_due ?? ''}`], ['suspended', `Suspended ${counts?.suspended ?? ''}`]]} />
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data!.items.length ? <Empty icon="building" title="No tenants found" /> : (
              <>
                <table className="t">
                  <thead><tr><th>Business</th><th>Plan</th><th>Subscription</th><th>Expiry</th><th className="r">Stores</th><th className="r">Users</th></tr></thead>
                  <tbody>{list.data!.items.map((r) => (
                    <tr key={r.id} className={`click ${r.id === sel ? 'sel' : ''}`} onClick={() => { setSel(r.id); setParams({}); }}>
                      <td><div className="row"><Avatar name={r.businessName} square /><div><b>{r.businessName}</b><div className="muted" style={{ fontSize: 11 }}>{r.ownerName} · {r.city}</div></div></div></td>
                      <td>{r.plan ?? '—'}<div className="muted" style={{ fontSize: 11 }}>{r.billingCycle}</div></td>
                      <td>{r.tenantStatus !== 'active' ? <StatusChip status={r.tenantStatus} /> : r.status === 'trial' && r.endDate ? <span className="chip blue">Trial · {Math.max(0, daysUntil(r.endDate))}d left</span> : <StatusChip status={r.status ?? 'inactive'} />}</td>
                      <td>{r.endDate ? fmtDate(r.endDate) : '—'}</td>
                      <td className="r num">{r.stores} / {r.maxStores ?? '∞'}</td>
                      <td className="r num">{r.users} / {r.maxUsers ?? '∞'}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <Pager {...list.data!} onPage={setPage} />
              </>
            )}
          </div>
        </div>
        <div className="card" style={{ width: 400, flex: 'none', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          {!t ? (detail.loading ? <Loading /> : <Empty icon="building" title="Select a tenant" />) : (
            <>
              <div style={{ padding: 18, borderBottom: '1px solid var(--line)' }}>
                <div className="row"><Avatar name={t.businessName} size={48} square /><div className="grow" style={{ minWidth: 0 }}><b style={{ fontSize: 16 }}>{t.businessName}</b><div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{t.code} · since {fmtDate(t.createdAt)}</div></div><StatusChip status={t.status} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px', marginTop: 14, fontSize: 12 }}>
                  <div><span className="muted">Owner</span><br /><b>{t.ownerName}</b></div><div><span className="muted">Mobile</span><br /><b>{t.mobile}</b></div>
                  <div><span className="muted">GSTIN</span><br /><b>{t.gstin ?? '—'}</b></div><div><span className="muted">Login</span><br /><b style={{ wordBreak: 'break-all' }}>{t.owner?.email ?? t.email}</b></div>
                </div>
              </div>
              <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {sub && (
                  <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
                    <div className="row between"><b>{sub.plan.name} · {sub.billingCycle}</b><b className="num">{inr(sub.amount)}/{sub.billingCycle === 'yearly' ? 'yr' : 'mo'}</b></div>
                    <div className="row between" style={{ marginTop: 4 }}><span className="muted" style={{ fontSize: 11.5 }}>{fmtDate(sub.startDate)} → {fmtDate(sub.endDate)} ({daysUntil(sub.endDate)}d)</span><StatusChip status={sub.status} /></div>
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 9, fontSize: 12 }}>
                      {([['Stores', t.usage.stores, sub.plan.maxStores], ['Users', t.usage.users, sub.plan.maxUsers], ['SKUs', t.usage.skus, sub.plan.maxSkus]] as const).map(([k, used, max]) => (
                        <div key={k}><div className="row between"><span>{k}</span><b>{n(used)} / {max ? n(max) : '∞'}</b></div><div className="bar-track" style={{ marginTop: 4 }}><i style={{ width: `${max ? Math.min(100, (used / max) * 100) : 8}%`, background: max && used / max > 0.85 ? '#f59e0b' : undefined }} /></div></div>
                      ))}
                      <div className="row between muted"><span>This month</span><span>{n(t.usage.monthTransactions)} bills · {inr(t.usage.monthSales)}</span></div>
                    </div>
                  </div>
                )}
                <div>
                  <b>Feature entitlements</b><span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>plan default · click to override</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 14px', marginTop: 10, fontSize: 12 }}>
                    {Object.keys(MODULE_LABEL).map((m) => (
                      <div key={m} className="row between"><span>{MODULE_LABEL[m]}{t.featureOverrides[m] !== undefined && <span className="chip violet nodot" style={{ marginLeft: 4, padding: '0 5px', fontSize: 9.5 }}>custom</span>}</span>
                        <span className={`toggle ${t.modules.includes(m) ? 'on' : ''}`} onClick={() => toggleFeature(m)} role="switch" aria-checked={t.modules.includes(m)} /></div>
                    ))}
                  </div>
                </div>
                <div>
                  <b>Subscription history</b>
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                    {t.payments.slice(0, 4).map((p) => (
                      <div className="row" key={p.id}><StatusChip status={p.status} /><span className="grow">{inr(p.amount)} · {PAYMENT_LABEL[p.method] ?? p.method}{p.failureReason ? ` · ${p.failureReason}` : ''}</span><span className="muted">{fmtDate(p.paidAt ?? p.createdAt)}</span></div>
                    ))}
                    {t.history.filter((h) => !h.isCurrent).slice(0, 3).map((h) => (
                      <div className="row" key={h.id}><span className="chip gray nodot">{h.plan.name}</span><span className="grow">{fmtDate(h.startDate)} → {fmtDate(h.endDate)}</span><StatusChip status={h.status} /></div>
                    ))}
                    {!t.payments.length && t.history.length <= 1 && <span className="muted">No payments yet</span>}
                  </div>
                </div>
                <div style={{ marginTop: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button className="btn" style={{ justifyContent: 'center' }} onClick={() => setAction('extend')}><Icon name="calendar" />Extend</button>
                  <button className="btn" style={{ justifyContent: 'center' }} onClick={() => setAction('plan')}><Icon name="layers" />Change plan</button>
                  <button className="btn" style={{ justifyContent: 'center' }} onClick={() => setAction('renew')}><Icon name="card" />Record renewal</button>
                  {t.status === 'active'
                    ? <button className="btn danger" style={{ justifyContent: 'center' }} onClick={() => setStatusChange('suspended')}><Icon name="pause" />Suspend</button>
                    : <button className="btn primary" style={{ justifyContent: 'center' }} onClick={() => setStatusChange('active')}><Icon name="play" />Reactivate</button>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {onboard && <OnboardModal plans={plans} onClose={() => { setOnboard(false); setParams({}); }} onDone={(id) => { setOnboard(false); setParams({}); setSel(id); refresh(); }} />}
      {action && t && <SubscriptionModal action={action} tenant={t} plans={plans} onClose={() => setAction(null)} onDone={() => { setAction(null); refresh(); }} />}
      {statusChange && t && (
        <Confirm title={statusChange === 'suspended' ? `Suspend ${t.businessName}?` : `Reactivate ${t.businessName}?`} needReason danger={statusChange === 'suspended'}
          confirmLabel={statusChange === 'suspended' ? 'Suspend tenant' : 'Reactivate'} onClose={() => setStatusChange(null)}
          text={statusChange === 'suspended' ? 'All users are signed out and billing stops immediately. Their data stays intact and read-only.' : 'Users can sign in and bill again (subject to the subscription status).'}
          onConfirm={async (reason) => { await patch(`/admin/tenants/${t.id}/status`, { status: statusChange, reason }); toast('Tenant status updated', 'success'); refresh(); }} />
      )}
    </>
  );
}

function SubscriptionModal({ action, tenant, plans, onClose, onDone }: { action: 'extend' | 'plan' | 'renew'; tenant: Detail; plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const sub = tenant.subscription;
  const [days, setDays] = useState('7');
  const [planId, setPlanId] = useState(sub?.plan.id ?? plans[0]?.id);
  const [cycle, setCycle] = useState(sub?.billingCycle ?? 'monthly');
  const [method, setMethod] = useState(action === 'renew' ? 'upi' : '');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const plan = plans.find((p) => p.id === planId);
  const amount = plan ? (cycle === 'yearly' ? plan.priceYearly : plan.priceMonthly) : 0;
  const go = async () => {
    setBusy(true);
    try {
      await post(`/admin/tenants/${tenant.id}/subscription`, action === 'extend'
        ? { action: 'extend', days: Number(days) }
        : { action: action === 'plan' ? 'change_plan' : 'renew', planId, billingCycle: cycle, paymentMethod: method || undefined, paymentReference: ref || undefined });
      toast('Subscription updated', 'success');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={{ extend: 'Extend subscription', plan: 'Change plan', renew: 'Record renewal payment' }[action]} sub={tenant.businessName} icon="calendar" onClose={onClose} width={460}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={go}>Confirm</button></>}>
      {action === 'extend' ? (
        <div className="field"><label>Extend by (days)</label>
          <div className="pill-row" style={{ marginBottom: 6 }}>{[7, 14, 30].map((d) => <span key={d} className={days === String(d) ? 'on' : ''} onClick={() => setDays(String(d))}>{d} days</span>)}</div>
          <input className="input num" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />
          <span className="hint">Current end date {sub && fmtDate(sub.endDate)} · a suspended/grace subscription becomes active.</span></div>
      ) : (
        <div className="form-grid">
          <div className="field"><label>Plan</label><select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}>{plans.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="field"><label>Billing cycle</label><select className="input" value={cycle} onChange={(e) => setCycle(e.target.value)}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
          <div className="field"><label>Payment received via</label><select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Not paid yet (payment pending)</option><option value="upi">UPI</option><option value="card">Card</option><option value="netbanking">Net banking</option><option value="bank">Bank transfer</option></select></div>
          <div className="field"><label>Reference</label><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR / txn id" /></div>
          <div className="full row between" style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px' }}><span className="muted">New period amount</span><b className="num">{inr(amount)}</b></div>
        </div>
      )}
    </Modal>
  );
}

function OnboardModal({ plans, onClose, onDone }: { plans: Plan[]; onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ businessName: '', ownerName: '', mobile: '', email: '', gstin: '', city: '', state: '', stateCode: '', storeName: '', storeCode: '', adminPassword: '', planId: '', billingCycle: 'monthly', startTrial: true });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!f.planId && plans[0]) setF((x) => ({ ...x, planId: plans.find((p) => p.code === 'professional')?.id ?? plans[0].id })); }, [plans, f.planId]);
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  const valid = f.businessName.trim().length > 1 && f.ownerName.trim() && /^\d{10}$/.test(f.mobile) && /\S+@\S+\.\S+/.test(f.email) && f.city && /^\d{2}$/.test(f.stateCode) && f.storeName && /^[A-Z]{2,4}$/.test(f.storeCode) && f.adminPassword.length >= 8 && f.planId;
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ id: string }>('/admin/tenants', { ...f, gstin: f.gstin || undefined, state: f.state || f.city });
      toast(`${f.businessName} onboarded - owner can sign in with ${f.email}`, 'success');
      onDone(r.id);
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  const plan = plans.find((p) => p.id === f.planId);
  return (
    <Modal title="Onboard tenant" icon="building" sub="Creates the business, its first store, the owner login and the subscription (BRD §31)" onClose={onClose} width={680}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={save}>Create tenant</button></>}>
      <div className="form-grid">
        <div className="field"><label>Business name *</label><input className="input" autoFocus value={f.businessName} onChange={(e) => set('businessName', e.target.value)} /></div>
        <div className="field"><label>GSTIN</label><input className="input" value={f.gstin} onChange={(e) => { const g = e.target.value.toUpperCase().slice(0, 15); setF({ ...f, gstin: g, stateCode: /^\d{2}/.test(g) ? g.slice(0, 2) : f.stateCode }); }} placeholder="Optional" /></div>
        <div className="field"><label>Owner name *</label><input className="input" value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} /></div>
        <div className="field"><label>Owner mobile *</label><input className="input num" value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} /></div>
        <div className="field"><label>Owner email (login) *</label><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
        <div className="field"><label>Temporary password *</label><input className="input" value={f.adminPassword} onChange={(e) => set('adminPassword', e.target.value)} placeholder="min 8 characters" /></div>
        <div className="field"><label>City *</label><input className="input" value={f.city} onChange={(e) => set('city', e.target.value)} /></div>
        <div className="field"><label>GST state code *</label><input className="input num" value={f.stateCode} onChange={(e) => set('stateCode', e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="29 = Karnataka" /></div>
        <div className="field"><label>First store name *</label><input className="input" value={f.storeName} onChange={(e) => set('storeName', e.target.value)} placeholder="e.g. Main Road Store" /></div>
        <div className="field"><label>Store code (invoice prefix) *</label><input className="input" value={f.storeCode} onChange={(e) => set('storeCode', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="MR" /></div>
        <div className="field"><label>Plan</label><select className="input" value={f.planId} onChange={(e) => set('planId', e.target.value)}>{plans.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name} · {inr(p.priceMonthly)}/mo</option>)}</select></div>
        <div className="field"><label>Billing cycle</label><select className="input" value={f.billingCycle} onChange={(e) => set('billingCycle', e.target.value)}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
        <label className="full row" style={{ gap: 8, fontSize: 12.5, cursor: 'pointer' }}><span className={`check ${f.startTrial ? 'on' : ''}`} onClick={() => set('startTrial', !f.startTrial)} />Start with the {plan?.trialDays ?? 14}-day free trial {plan && plan.trialDays === 0 && <span className="muted">(this plan has no trial — payment pending)</span>}</label>
      </div>
    </Modal>
  );
}
