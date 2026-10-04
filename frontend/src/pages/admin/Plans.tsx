import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Topbar } from '../../components/Layout';
import { ErrorBox, Loading, Modal, Tabs, useLoad, useToast } from '../../components/ui';
import { get, patch, post } from '../../lib/api';
import { inr, n } from '../../lib/format';

interface Plan { id: string; name: string; code: string; description?: string; priceMonthly: number; priceYearly: number; trialDays: number; graceDays: number; maxStores: number | null; maxUsers: number | null; maxSkus: number | null; maxMonthlyTransactions: number | null; modules: string[]; supportLevel: string; isPopular: boolean; isActive: boolean; tenants: number }
const MODULES: [string, string][] = [['pos', 'POS billing & barcode'], ['inventory', 'Inventory & stock ledger'], ['customers', 'Customers'], ['returns', 'Returns & exchange'], ['reports', 'Reports'], ['offline', 'Offline POS'], ['purchases', 'Purchases & suppliers'], ['multi_store', 'Multi-store transfers'], ['loyalty', 'Loyalty program'], ['whatsapp', 'WhatsApp invoices']];
const lim = (v: number | null) => (v == null ? 'Unlimited' : n(v));

export default function Plans() {
  const { data, error, loading, reload } = useLoad(() => get<Plan[]>('/admin/plans'), []);
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);
  const toast = useToast();
  const toggleModule = async (p: Plan, m: string) => {
    try {
      await patch(`/admin/plans/${p.id}`, { modules: p.modules.includes(m) ? p.modules.filter((x) => x !== m) : [...p.modules, m] });
      reload();
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <>
      <Topbar crumb="Platform › Subscription Plans" title="Subscription Plans">
        <Tabs value={cycle} onChange={setCycle} options={[['monthly', 'Monthly'], ['yearly', 'Yearly · save 17%']]} />
        <button className="btn primary" onClick={() => setEditing({ modules: ['pos', 'inventory', 'customers', 'returns', 'reports'], trialDays: 14, graceDays: 7, supportLevel: 'Email', isActive: true })}><Icon name="plus" />Create Plan</button>
      </Topbar>
      <div className="content">
        {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(data.length, 4)},1fr)`, gap: 18, marginTop: 6 }}>
              {data.map((p) => (
                <div key={p.id} className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, position: 'relative', ...(p.isPopular ? { border: '2px solid var(--blue)', boxShadow: '0 10px 30px rgba(29,78,216,.15)' } : {}), opacity: p.isActive ? 1 : 0.6 }}>
                  {p.isPopular && <span style={{ position: 'absolute', top: -11, left: 20, background: 'var(--blue)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>Most popular</span>}
                  <div className="row between"><b style={{ fontSize: 16 }}>{p.name}</b><span className={`chip ${p.isActive ? 'green' : 'gray'}`}>{p.isActive ? 'Active' : 'Inactive'}</span></div>
                  <div className="muted" style={{ fontSize: 12 }}>{p.description}</div>
                  <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.02em' }} className="num">{inr(cycle === 'monthly' ? p.priceMonthly : p.priceYearly)}<small style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}> / {cycle === 'monthly' ? 'month' : 'year'}</small></div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}><span className="chip gray nodot">{p.trialDays ? `${p.trialDays}-day trial` : 'No trial'}</span><span className="chip gray nodot">{p.graceDays}-day grace</span><span className="chip blue nodot">{p.tenants} tenants</span></div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                    <div className="row" style={{ gap: 8 }}><Icon name="check" size={15} style={{ color: 'var(--green)' }} />{lim(p.maxStores)} store{p.maxStores === 1 ? '' : 's'} · {lim(p.maxUsers)} users</div>
                    <div className="row" style={{ gap: 8 }}><Icon name="check" size={15} style={{ color: 'var(--green)' }} />{lim(p.maxSkus)} SKUs · {lim(p.maxMonthlyTransactions)} bills/mo</div>
                    <div className="row" style={{ gap: 8 }}><Icon name="headset" size={15} style={{ color: 'var(--blue)' }} />Support: {p.supportLevel}</div>
                  </div>
                  <button className={`btn ${p.isPopular ? 'primary' : ''}`} style={{ justifyContent: 'center', marginTop: 'auto' }} onClick={() => setEditing(p)}><Icon name="edit" />Edit plan</button>
                </div>
              ))}
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-h" style={{ paddingBottom: 10 }}><div><h3>Feature matrix</h3><div className="sub">Toggle modules per plan · tenants can also get per-tenant overrides · every change is audited</div></div></div>
              <table className="t">
                <thead><tr><th>Module</th>{data.map((p) => <th key={p.id} className="r">{p.name}</th>)}</tr></thead>
                <tbody>{MODULES.map(([m, label]) => (
                  <tr key={m}><td><b>{label}</b></td>{data.map((p) => <td key={p.id} className="r"><span className={`toggle ${p.modules.includes(m) ? 'on' : ''}`} role="switch" aria-checked={p.modules.includes(m)} onClick={() => toggleModule(p, m)} /></td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {editing && <PlanForm plan={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function PlanForm({ plan, onClose, onSaved }: { plan: Partial<Plan>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const num = (v?: number | null) => (v == null ? '' : String(v));
  const [f, setF] = useState({ name: plan.name ?? '', code: plan.code ?? '', description: plan.description ?? '', priceMonthly: num(plan.priceMonthly), priceYearly: num(plan.priceYearly), trialDays: num(plan.trialDays), graceDays: num(plan.graceDays), maxStores: num(plan.maxStores), maxUsers: num(plan.maxUsers), maxSkus: num(plan.maxSkus), maxMonthlyTransactions: num(plan.maxMonthlyTransactions), supportLevel: plan.supportLevel ?? 'Email', isPopular: !!plan.isPopular, isActive: plan.isActive ?? true });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const body = {
      name: f.name, code: f.code, description: f.description || undefined, supportLevel: f.supportLevel, isPopular: f.isPopular, isActive: f.isActive,
      priceMonthly: Number(f.priceMonthly) || 0, priceYearly: Number(f.priceYearly) || 0, trialDays: Number(f.trialDays) || 0, graceDays: Number(f.graceDays) || 0,
      maxStores: f.maxStores ? Number(f.maxStores) : null, maxUsers: f.maxUsers ? Number(f.maxUsers) : null, maxSkus: f.maxSkus ? Number(f.maxSkus) : null, maxMonthlyTransactions: f.maxMonthlyTransactions ? Number(f.maxMonthlyTransactions) : null,
      ...(plan.id ? {} : { modules: plan.modules ?? [] }),
    };
    try {
      if (plan.id) await patch(`/admin/plans/${plan.id}`, body); else await post('/admin/plans', body);
      toast('Plan saved', 'success');
      onSaved();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <div className="field"><label>{label}</label><input className="input" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} />{hint && <span className="hint">{hint}</span>}</div>
  );
  return (
    <Modal title={plan.id ? `Edit ${plan.name}` : 'Create plan'} icon="layers" onClose={onClose} width={620}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.name || !/^[a-z0-9_]{2,30}$/.test(f.code)} onClick={save}>Save plan</button></>}>
      <div className="form-grid">
        {field('name', 'Plan name')}{field('code', 'Code', 'lowercase, e.g. growth_plus')}
        <div className="full">{field('description', 'Tagline')}</div>
        {field('priceMonthly', 'Price / month (₹)')}{field('priceYearly', 'Price / year (₹)')}
        {field('trialDays', 'Trial days')}{field('graceDays', 'Grace days after expiry')}
        {field('maxStores', 'Max stores', 'blank = unlimited')}{field('maxUsers', 'Max users', 'blank = unlimited')}
        {field('maxSkus', 'Max SKUs', 'blank = unlimited')}{field('maxMonthlyTransactions', 'Max bills / month', 'blank = unlimited')}
        {field('supportLevel', 'Support level')}
        <div className="field"><label>Visibility</label>
          <div className="row" style={{ gap: 16, height: 38 }}>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}><span className={`toggle ${f.isActive ? 'on' : ''}`} onClick={() => setF({ ...f, isActive: !f.isActive })} />Active</label>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}><span className={`toggle ${f.isPopular ? 'on' : ''}`} onClick={() => setF({ ...f, isPopular: !f.isPopular })} />Popular</label>
          </div></div>
      </div>
    </Modal>
  );
}
