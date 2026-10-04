import { Link } from 'react-router-dom';
import { Donut, Line, PALETTE } from '../components/Charts';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { ProductArt } from '../components/ProductArt';
import { Avatar, Delta, Empty, ErrorBox, Kpi, Loading, useLoad } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDay, fmtTime, inr, inrShort, n, PAYMENT_LABEL } from '../lib/format';

interface Dash {
  today: { sales: number; bills: number; items: number; avgBill: number; salesChangePct: number | null; billsChange: number };
  returns: { value: number; refunds: number; exchanges: number };
  stock: { lowStock: number; outOfStock: number };
  trend: { date: string; total: number; previous: number }[];
  paymentMix: { method: string; amount: number; bills: number }[];
  topVariants: { variantId: string; productName: string; size?: string; color?: string; artType: string; artColor: string; qty: number; sales: number }[];
  lowStock: { id: string; sku: string; size?: string; color?: string; productName: string; stock: number; minStock: number }[];
  liveCounters: { id: string; counter: number; openedAt: string; userName: string; storeName: string; sales: number }[];
  heldBills: number;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};

export default function Dashboard() {
  const { me, store, can } = useAuth();
  const scope = store?.id ?? '';
  const { data: d, error, loading, reload } = useLoad(() => get<Dash>('/reports/dashboard', { storeId: scope || undefined }), [scope]);
  const mixTotal = d?.paymentMix.reduce((s, p) => s + p.amount, 0) ?? 0;

  return (
    <>
      <Topbar crumb={<>{me?.tenant?.businessName} › {store?.name}</>} title={`${greeting()}, ${me?.user.name.split(' ')[0]}`}>
        <span className="btn" style={{ cursor: 'default' }}><Icon name="calendar" />Today, {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
        <button className="iconbtn" onClick={reload} title="Refresh"><Icon name="refresh" /></button>
        {can('tenant_admin', 'store_manager') && <Link className="btn primary" to="/pos"><Icon name="pos" />Open POS</Link>}
      </Topbar>
      <div className="content">
        {loading && !d ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : d && (
          <>
            <div className="kpis" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
              <Kpi icon="trend" label="Today's Sales" value={inr(d.today.sales)} delta={<><Delta pct={d.today.salesChangePct} /> vs last {new Date().toLocaleDateString('en-IN', { weekday: 'long' })}</>} />
              <Kpi icon="receipt" tone="violet" label="Bills" value={n(d.today.bills)} delta={<><span className={d.today.billsChange >= 0 ? 'up' : 'down'}>{d.today.billsChange >= 0 ? '▲' : '▼'} {Math.abs(d.today.billsChange)}</span> · Avg bill {inr(d.today.avgBill)}</>} />
              <Kpi icon="shirt" tone="green" label="Items Sold" value={n(d.today.items)} delta={d.today.bills ? `${(d.today.items / d.today.bills).toFixed(1)} items per bill` : 'No bills yet today'} />
              <Kpi icon="undo" tone="amber" label="Returns / Exchanges" value={inr(d.returns.value)} delta={<><span className={d.returns.refunds ? 'down' : ''}>{d.returns.refunds} returns</span> · {d.returns.exchanges} exchanges</>} />
              <Kpi icon="alert" tone="red" label="Low / Out of Stock" value={<>{d.stock.lowStock} <span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 500 }}>/ {d.stock.outOfStock}</span></>} delta={<Link className="link" to="/inventory">SKUs need reorder →</Link>} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.75fr 1fr', gap: 16 }}>
              <div className="card">
                <div className="card-h"><div><h3>Sales trend</h3><div className="sub">Last 14 days · {store?.name}</div></div>
                  <div className="legend"><span><i style={{ background: '#1d4ed8' }} />This period</span><span><i style={{ background: '#a5b4fc' }} />Previous 14 days</span></div></div>
                <div className="card-b" style={{ paddingTop: 10 }}>
                  <Line data={d.trend.map((t) => t.total)} previous={d.trend.map((t) => t.previous)} labels={d.trend.map((t) => String(new Date(t.date).getDate()))} />
                </div>
              </div>
              <div className="card">
                <div className="card-h"><div><h3>Payment mix</h3><div className="sub">Today · {d.today.bills} bills</div></div></div>
                {mixTotal === 0 ? <Empty icon="card" title="No payments yet today" /> : (
                  <div className="card-b row" style={{ gap: 22, paddingTop: 18 }}>
                    <Donut data={d.paymentMix.map((p) => p.amount)} colors={PALETTE} r={56} t={18}><div><b style={{ fontSize: 17 }}>{inrShort(mixTotal)}</b><div className="muted" style={{ fontSize: 11 }}>collected</div></div></Donut>
                    <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 12, whiteSpace: 'nowrap' }}>
                      {d.paymentMix.map((p, i) => (
                        <div className="row between" key={p.method}>
                          <span className="row" style={{ gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: PALETTE[i % PALETTE.length], display: 'inline-block' }} />{PAYMENT_LABEL[p.method] ?? p.method}</span>
                          <b className="num">{inr(p.amount)} <span className="muted" style={{ fontWeight: 500 }}>{Math.round((p.amount / mixTotal) * 100)}%</span></b>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr .85fr', gap: 16 }}>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-h"><h3>Top selling variants</h3><span className="muted" style={{ fontSize: 12 }}>Last 7 days</span></div>
                {d.topVariants.length === 0 ? <Empty title="No sales in the last 7 days" /> : (
                  <table className="t" style={{ marginTop: 10 }}>
                    <thead><tr><th>Product</th><th>Size · Colour</th><th className="r">Qty</th><th className="r">Sales</th></tr></thead>
                    <tbody>{d.topVariants.map((t) => (
                      <tr key={t.variantId}><td><div className="row"><div className="thumb"><ProductArt type={t.artType} color={t.artColor} /></div><b>{t.productName}</b></div></td><td>{[t.size, t.color].filter(Boolean).join(' · ')}</td><td className="r num">{t.qty}</td><td className="r num"><b>{inr(t.sales)}</b></td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-h"><h3>Low-stock alerts</h3>{d.stock.outOfStock > 0 && <span className="chip red">{d.stock.outOfStock} out of stock</span>}</div>
                {d.lowStock.length === 0 ? <Empty icon="check" title="Stock levels look healthy" /> : (
                  <table className="t" style={{ marginTop: 10 }}>
                    <thead><tr><th>Item</th><th className="r">Stock</th><th className="r">Min</th></tr></thead>
                    <tbody>{d.lowStock.map((l) => (
                      <tr key={l.id}><td><b>{l.productName}</b><div className="muted" style={{ fontSize: 11 }}>{[l.size, l.color].filter(Boolean).join(' · ')} · {l.sku}</div></td><td className="r"><span className={`chip ${l.stock <= 0 ? 'red' : 'amber'}`}>{l.stock}</span></td><td className="r num">{l.minStock}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
              <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="card-h"><h3>Live counters</h3><span className={`chip ${d.liveCounters.length ? 'green' : 'gray'}`}>{d.liveCounters.length} shift{d.liveCounters.length === 1 ? '' : 's'} open</span></div>
                <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {d.liveCounters.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No cashier shifts are open right now.</span>}
                  {d.liveCounters.map((c) => (
                    <div className="row" key={c.id}><Avatar name={c.userName} /><div className="grow"><b>{c.userName}</b><div className="muted" style={{ fontSize: 11 }}>Counter {c.counter} · since {fmtTime(c.openedAt)}{c.storeName !== store?.name ? ` · ${c.storeName}` : ''}</div></div><b className="num">{inr(c.sales)}</b></div>
                  ))}
                  <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 12 }} className="row between"><span className="muted row" style={{ gap: 6 }}><Icon name="pause" size={14} />Held bills</span><b>{d.heldBills} waiting</b></div>
                  <div className="muted" style={{ fontSize: 11 }}>Updated {fmtDay(new Date())} {fmtTime(new Date())}</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
