import { useMemo, useState } from 'react';
import { Bars, Donut, PALETTE } from '../components/Charts';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { Delta, Empty, ErrorBox, Kpi, Loading, Tabs, useLoad } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr, inrShort, isoToday, n, PAYMENT_LABEL } from '../lib/format';

interface K { netSales: number; grossSales: number; invoices: number; avgBill: number; discounts: number; tax: number; marginPct: number; returnValue: number; returnCount: number; returnRatePct: number }
interface Rep {
  range: { from: string; to: string };
  current: K; previous: K;
  byStoreDaily: { date: string; store: string; total: number }[];
  byCategory: { name: string; total: number; qty: number }[];
  bySize: { size: string; qty: number }[];
  byColor: { color: string; hex?: string; qty: number }[];
  byPayment: { method: string; amount: number; count: number }[];
  byCashier: { name: string; bills: number; sales: number; discountPct: number; variance: number }[];
  topProducts: { name: string; qty: number; sales: number }[];
}
type Range = 'today' | '7d' | '30d' | 'month' | 'lastmonth';
const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);

function rangeDates(r: Range) {
  const d = new Date();
  const iso = (x: Date) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (r === 'today') return { from: isoToday(), to: isoToday() };
  if (r === '7d') return { from: iso(new Date(Date.now() - 6 * 864e5)), to: isoToday() };
  if (r === '30d') return { from: iso(new Date(Date.now() - 29 * 864e5)), to: isoToday() };
  if (r === 'month') return { from: iso(new Date(d.getFullYear(), d.getMonth(), 1)), to: isoToday() };
  return { from: iso(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: iso(new Date(d.getFullYear(), d.getMonth(), 0)) };
}

export default function Reports() {
  const { me, store } = useAuth();
  const [range, setRange] = useState<Range>('30d');
  const [scope, setScope] = useState<'store' | 'all'>(me?.user.role === 'tenant_admin' ? 'all' : 'store');
  const { from, to } = rangeDates(range);
  const { data: r, error, loading, reload } = useLoad(() => get<Rep>('/reports/sales', { from, to, storeId: scope === 'store' ? store?.id : undefined }), [from, to, scope, store?.id]);

  // weekly buckets per store for the paired bar chart
  const weekly = useMemo(() => {
    if (!r) return null;
    const stores = [...new Set(r.byStoreDaily.map((x) => x.store))].slice(0, 2);
    const start = new Date(r.range.from).getTime();
    const days = Math.max(1, Math.round((new Date(r.range.to).getTime() - start) / 864e5) + 1);
    const daily = days <= 14;
    const buckets = daily ? days : Math.ceil(days / 7);
    const series = stores.map((s) => Array.from({ length: buckets }, (_, i) => r.byStoreDaily.filter((x) => x.store === s && Math.floor((new Date(x.date).getTime() - start) / 864e5 / (daily ? 1 : 7)) === i).reduce((a, x) => a + x.total, 0)));
    const labels = Array.from({ length: buckets }, (_, i) => (daily ? new Date(start + i * 864e5).getDate().toString() : `Wk ${i + 1}`));
    return { stores, series, labels, daily };
  }, [r]);
  const catTotal = r?.byCategory.reduce((a, c) => a + c.total, 0) ?? 0;
  const payTotal = r?.byPayment.reduce((a, c) => a + c.amount, 0) ?? 0;

  const exportCsv = () => {
    if (!r) return;
    const rows = [['Section', 'Name', 'Qty', 'Amount'], ...r.byCategory.map((c) => ['Category', c.name, c.qty, c.total]), ...r.topProducts.map((p) => ['Product', p.name, p.qty, p.sales]),
      ...r.byPayment.map((p) => ['Payment', PAYMENT_LABEL[p.method] ?? p.method, p.count, p.amount]), ...r.byCashier.map((c) => ['Cashier', c.name, c.bills, c.sales])];
    const csv = rows.map((x) => x.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `sales-report-${from}-to-${to}.csv`;
    a.click();
  };

  return (
    <>
      <Topbar crumb="Insights › Reports" title="Sales Reports">
        <Tabs value={range} onChange={setRange} options={[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days'], ['month', 'This month'], ['lastmonth', 'Last month']]} />
        {(me?.stores.length ?? 0) > 1 && <Tabs value={scope} onChange={setScope} options={[['store', store?.code ?? 'Store'], ['all', 'All stores']]} />}
        <button className="btn primary" onClick={exportCsv} disabled={!r}><Icon name="download" />Export</button>
      </Topbar>
      <div className="content">
        {loading && !r ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : r && (
          <>
            <div className="kpis" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
              <Kpi label="Net sales" value={inrShort(r.current.netSales)} delta={<><Delta pct={pct(r.current.netSales, r.previous.netSales)} /> vs previous period</>} />
              <Kpi label="Invoices" value={n(r.current.invoices)} delta={<Delta pct={pct(r.current.invoices, r.previous.invoices)} />} />
              <Kpi label="Avg bill value" value={inr(r.current.avgBill)} delta={<><span className={r.current.avgBill >= r.previous.avgBill ? 'up' : 'down'}>{r.current.avgBill >= r.previous.avgBill ? '▲' : '▼'} {inr(Math.abs(r.current.avgBill - r.previous.avgBill))}</span></>} />
              <Kpi label="Gross margin" value={`${r.current.marginPct.toFixed(1)}%`} delta={<><span className={r.current.marginPct >= r.previous.marginPct ? 'up' : 'down'}>{r.current.marginPct >= r.previous.marginPct ? '▲' : '▼'} {Math.abs(r.current.marginPct - r.previous.marginPct).toFixed(1)} pt</span> · {inrShort(r.current.discounts)} discounts</>} />
              <Kpi label="Return rate" value={`${r.current.returnRatePct.toFixed(1)}%`} delta={`${inrShort(r.current.returnValue)} · ${r.current.returnCount} returns`} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
              <div className="card">
                <div className="card-h"><div><h3>Store-wise sales</h3><div className="sub">{r.range.from} → {r.range.to} · {weekly?.daily ? 'daily' : 'weekly'} totals</div></div>
                  <div className="legend">{weekly?.stores.map((s, i) => <span key={s}><i style={{ background: i ? '#93c5fd' : '#1d4ed8' }} />{s}</span>)}</div></div>
                <div className="card-b">{weekly && weekly.series.length ? <Bars data={weekly.series[0]} series2={weekly.series[1]} labels={weekly.labels} height={170} /> : <Empty icon="chart" title="No sales in this period" />}</div>
              </div>
              <div className="card">
                <div className="card-h"><div><h3>Category-wise sales</h3><div className="sub">Share of net sales</div></div></div>
                <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 11, paddingTop: 16 }}>
                  {r.byCategory.slice(0, 7).map((c) => (
                    <div key={c.name}><div className="row between" style={{ fontSize: 12, marginBottom: 5 }}><span>{c.name}</span><b className="num">{inrShort(c.total)} · {catTotal ? Math.round((c.total / catTotal) * 100) : 0}%</b></div>
                      <div className="bar-track"><i style={{ width: `${r.byCategory[0].total ? (c.total / r.byCategory[0].total) * 100 : 0}%` }} /></div></div>
                  ))}
                  {!r.byCategory.length && <Empty title="No data" />}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '.85fr .8fr .8fr 1.55fr', gap: 16 }}>
              <div className="card">
                <div className="card-h"><div><h3>Size-wise units</h3><div className="sub">Plan buying by size</div></div></div>
                <div className="card-b">{r.bySize.length ? <Bars data={r.bySize.map((s) => s.qty)} labels={r.bySize.map((s) => s.size.replace('UK ', ''))} height={150} width={320} /> : <Empty title="No data" />}</div>
              </div>
              <div className="card">
                <div className="card-h"><div><h3>Top colours</h3><div className="sub">Units sold</div></div></div>
                <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14 }}>
                  {r.byColor.map((c) => <div className="row" key={c.color}><i style={{ width: 14, height: 14, borderRadius: 4, background: c.hex, border: '1px solid #cbd5e1', display: 'inline-block' }} /><span className="grow">{c.color}</span><b className="num">{n(c.qty)}</b></div>)}
                </div>
              </div>
              <div className="card">
                <div className="card-h"><div><h3>Payments</h3><div className="sub">Collection by mode</div></div></div>
                <div className="card-b" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <Donut data={r.byPayment.map((p) => p.amount)} colors={PALETTE} r={48} t={16}><b style={{ fontSize: 14 }}>{inrShort(payTotal)}</b></Donut>
                  <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7, fontSize: 12 }}>
                    {r.byPayment.map((p, i) => <div className="row between" key={p.method}><span className="row" style={{ gap: 7 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[i % PALETTE.length], display: 'inline-block' }} />{PAYMENT_LABEL[p.method] ?? p.method}</span><b className="num">{payTotal ? Math.round((p.amount / payTotal) * 100) : 0}%</b></div>)}
                  </div>
                </div>
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-h" style={{ paddingBottom: 10 }}><h3>Cashier performance</h3></div>
                <table className="t">
                  <thead><tr><th>Cashier</th><th className="r">Bills</th><th className="r">Sales</th><th className="r">Disc.</th><th className="r">Cash var.</th></tr></thead>
                  <tbody>{r.byCashier.map((c) => (
                    <tr key={c.name}><td><b>{c.name}</b></td><td className="r num">{c.bills}</td><td className="r num">{inrShort(c.sales)}</td><td className="r num">{c.discountPct}%</td>
                      <td className="r"><span className={`chip nodot ${c.variance === 0 ? 'green' : Math.abs(c.variance) > 200 ? 'red' : 'amber'}`}>{c.variance > 0 ? '+' : ''}{inr(c.variance)}</span></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-h" style={{ paddingBottom: 10 }}><h3>Top selling products</h3><span className="muted" style={{ fontSize: 12 }}>by units</span></div>
              <table className="t">
                <thead><tr><th>#</th><th>Product</th><th className="r">Units</th><th className="r">Sales</th><th style={{ width: '35%' }}>Share</th></tr></thead>
                <tbody>{r.topProducts.map((p, i) => (
                  <tr key={p.name}><td className="muted">{i + 1}</td><td><b>{p.name}</b></td><td className="r num">{p.qty}</td><td className="r num">{inr(p.sales)}</td><td><div className="bar-track"><i style={{ width: `${(p.qty / r.topProducts[0].qty) * 100}%` }} /></div></td></tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}
