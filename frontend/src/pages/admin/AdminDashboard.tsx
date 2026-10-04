import { Link } from 'react-router-dom';
import { Bars, Donut } from '../../components/Charts';
import { Icon } from '../../components/Icon';
import { Topbar } from '../../components/Layout';
import { Avatar, Empty, ErrorBox, Kpi, Loading, StatusChip, useLoad } from '../../components/ui';
import { get } from '../../lib/api';
import { daysUntil, fmtDay, inr, inrShort, n, PAYMENT_LABEL, relDay } from '../../lib/format';

interface D {
  total: number; active: number; trial: number; atRisk: number; inactive: number; newThisMonth: number; mrr: number; arr: number;
  plans: { id: string; name: string; tenants: number; mrr: number; priceMonthly: number }[];
  revenue: { month: string; amount: number }[];
  recentSignups: { id: string; businessName: string; city?: string; createdAt: string; plan?: string; status?: string; endDate?: string; stores: number }[];
  expiring: { id: string; businessName: string; plan: string; endDate: string; status: string }[];
  failedPayments: { id: string; tenantId: string; businessName: string; amount: number; method: string; failureReason?: string; subscriptionStatus: string; endDate: string }[];
}
const PLAN_COLORS = ['#93c5fd', '#1d4ed8', '#0a1640', '#a78bfa'];

export default function AdminDashboard() {
  const { data: d, error, loading, reload } = useLoad(() => get<D>('/admin/dashboard'), []);
  const months = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(new Date().getFullYear(), new Date().getMonth() - 11 + i, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
  });
  return (
    <>
      <Topbar crumb="Platform" title="SaaS Overview">
        <button className="iconbtn" onClick={reload} title="Refresh"><Icon name="refresh" /></button>
        <Link className="btn primary" to="/admin/tenants?onboard=1"><Icon name="plus" />Onboard Tenant</Link>
      </Topbar>
      <div className="content">
        {loading && !d ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : d && (
          <>
            <div className="kpis" style={{ gridTemplateColumns: 'repeat(6,1fr)' }}>
              <Kpi label="Total tenants" value={n(d.total)} delta={<><span className="up">+{d.newThisMonth}</span> this month</>} />
              <Kpi label={<span className="chip green" style={{ padding: '2px 7px' }}>Active</span>} value={n(d.active)} delta={`${d.total ? ((d.active / d.total) * 100).toFixed(1) : 0}% of total`} />
              <Kpi label={<span className="chip blue" style={{ padding: '2px 7px' }}>Trial</span>} value={n(d.trial)} delta="convert before expiry" />
              <Kpi label={<span className="chip red" style={{ padding: '2px 7px' }}>At risk / inactive</span>} value={`${d.atRisk} / ${d.inactive}`} delta={<span className="down">past due · suspended / expired</span>} />
              <div className="card kpi" style={{ background: 'var(--navy)', borderColor: 'var(--navy)', color: '#fff' }}><div className="l" style={{ color: '#9aa8d6' }}>MRR</div><div className="v num">{inrShort(d.mrr)}</div><div className="d" style={{ color: '#9aa8d6' }}>monthly recurring revenue</div></div>
              <Kpi label="ARR run-rate" value={inrShort(d.arr)} delta="MRR × 12" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1fr', gap: 16 }}>
              <div className="card">
                <div className="card-h"><div><h3>Subscription revenue</h3><div className="sub">Payments collected per month · last 12 months</div></div></div>
                <div className="card-b"><Bars data={months.map((m) => d.revenue.find((r) => r.month === m)?.amount ?? 0)} labels={months.map((m) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short' }))} height={180} title={(i) => `${months[i]} · ${inr(d.revenue.find((r) => r.month === months[i])?.amount ?? 0)}`} /></div>
              </div>
              <div className="card">
                <div className="card-h"><div><h3>Plan distribution</h3><div className="sub">Paying + grace subscriptions</div></div></div>
                <div className="card-b row" style={{ gap: 20, paddingTop: 16 }}>
                  <Donut data={d.plans.map((p) => p.tenants)} colors={PLAN_COLORS} r={56} t={20}><div><b style={{ fontSize: 18 }}>{d.plans.reduce((a, p) => a + p.tenants, 0)}</b><div className="muted" style={{ fontSize: 11 }}>paying</div></div></Donut>
                  <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 12, whiteSpace: 'nowrap' }}>
                    {d.plans.map((p, i) => (
                      <div key={p.id}><div className="row between"><span className="row" style={{ gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: PLAN_COLORS[i], display: 'inline-block' }} />{p.name}</span><b>{p.tenants}</b></div>
                        <div className="muted" style={{ fontSize: 11, marginLeft: 18 }}>{inr(p.priceMonthly)}/mo · {inrShort(p.mrr)} MRR</div></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 16 }}>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-h" style={{ paddingBottom: 10 }}><h3>Recent signups</h3><Link className="link" style={{ fontSize: 12 }} to="/admin/tenants">All tenants →</Link></div>
                <table className="t">
                  <thead><tr><th>Tenant</th><th>Plan</th><th>Status</th></tr></thead>
                  <tbody>{d.recentSignups.map((t) => (
                    <tr key={t.id}><td><b>{t.businessName}</b><div className="muted" style={{ fontSize: 11 }}>{t.city} · {relDay(t.createdAt)}</div></td><td>{t.plan}</td>
                      <td>{t.status === 'trial' && t.endDate ? <span className="chip blue">Trial · {daysUntil(t.endDate)}d</span> : <StatusChip status={t.status ?? 'inactive'} />}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <div className="card">
                <div className="card-h"><h3>Expiring in 7 days</h3><span className="chip amber">{d.expiring.length} tenants</span></div>
                <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {d.expiring.length === 0 && <Empty icon="check" title="Nothing expiring this week" />}
                  {d.expiring.map((t) => (
                    <Link key={t.id} to={`/admin/tenants?id=${t.id}`} className="row" style={{ textDecoration: 'none' }}><Avatar name={t.businessName} /><div className="grow"><b>{t.businessName}</b><div className="muted" style={{ fontSize: 11 }}>{t.plan} · {fmtDay(t.endDate)} · {daysUntil(t.endDate)}d</div></div><StatusChip status={t.status} /></Link>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-h"><h3>Failed payments</h3>{d.failedPayments.length > 0 && <span className="chip red">{d.failedPayments.length} need action</span>}</div>
                <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {d.failedPayments.length === 0 && <Empty icon="check" title="No failed payments" />}
                  {d.failedPayments.map((p) => (
                    <Link key={p.id} to={`/admin/tenants?id=${p.tenantId}`} className="row" style={{ textDecoration: 'none' }}>
                      <span style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--red-l)', color: 'var(--red)', display: 'grid', placeItems: 'center' }}><Icon name="card" size={16} /></span>
                      <div className="grow"><b>{p.businessName}</b><div className="muted" style={{ fontSize: 11 }}>{inr(p.amount)} · {PAYMENT_LABEL[p.method] ?? p.method} · {p.failureReason}</div></div><StatusChip status={p.subscriptionStatus} />
                    </Link>
                  ))}
                  <div className="row muted" style={{ borderTop: '1px solid var(--line-2)', paddingTop: 12, fontSize: 12, gap: 6 }}><Icon name="history" size={15} />Every action is recorded in <Link className="link" to="/admin/audit">audit logs</Link></div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
