import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { Empty, ErrorBox, Loading, Pager, StatusChip, Tabs, useDebounced, useLoad } from '../components/ui';
import { get, Paged } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDay, fmtTime, inr, isoToday } from '../lib/format';

interface Row { id: string; invoiceNo: string; createdAt: string; status: string; total: number; totalQty: number; itemCount: number; customer?: { name: string; mobile: string } | null; cashier: { name: string }; store: { name: string; code: string }; offlineRef?: string | null; stockConflict?: boolean }

export default function Invoices() {
  const { store } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const q = useDebounced(search);
  const [range, setRange] = useState<'today' | '7d' | '30d' | 'all'>(params.get('search') ? 'all' : 'today');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [q, range, status]);
  const from = range === 'today' ? isoToday() : range === '7d' ? new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10) : range === '30d' ? new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10) : undefined;
  const list = useLoad(() => get<Paged<Row>>('/sales', { storeId: store?.id, search: q, from, status, page, pageSize: 15 }), [store?.id, q, from, status, page]);

  // jump straight to an exact invoice number typed in the POS "Search Bill No."
  useEffect(() => {
    if (list.data?.items.length === 1 && q && list.data.items[0].invoiceNo.toLowerCase() === q.toLowerCase()) nav(`/invoices/${list.data.items[0].id}`, { replace: true });
  }, [list.data, q, nav]);

  const total = list.data?.items.filter((r) => r.status === 'completed').reduce((s, r) => s + r.total, 0) ?? 0;
  return (
    <>
      <Topbar crumb="Sales › Invoices" title="Invoices">
        <div className="search"><Icon name="search" size={16} /><input autoFocus placeholder="Invoice no., customer name or mobile" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </Topbar>
      <div className="content">
        <div className="row">
          <Tabs value={range} onChange={setRange} options={[['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['all', 'All']]} />
          <Tabs value={status} onChange={setStatus} options={[['', 'All'], ['completed', 'Paid'], ['cancelled', 'Cancelled']]} />
          <div className="grow" />
          {list.data && <span className="muted">{list.data.total} invoices · page total <b style={{ color: 'var(--text)' }}>{inr(total)}</b></span>}
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : list.data!.items.length === 0 ? <Empty icon="receipt" title="No invoices found" text="Try a different date range or search" /> : (
            <>
              <table className="t">
                <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Cashier</th><th className="r">Items</th><th className="r">Total</th><th>Status</th></tr></thead>
                <tbody>{list.data!.items.map((r) => (
                  <tr key={r.id} className="click" onClick={() => nav(`/invoices/${r.id}`)}>
                    <td><b>{r.invoiceNo}</b></td>
                    <td>{fmtDay(r.createdAt)} <span className="muted">{fmtTime(r.createdAt)}</span></td>
                    <td>{r.customer ? <>{r.customer.name}<div className="muted" style={{ fontSize: 11 }}>{r.customer.mobile}</div></> : <span className="muted">Walk-in</span>}</td>
                    <td>{r.cashier.name}</td>
                    <td className="r num">{r.totalQty}</td>
                    <td className="r num"><b>{inr(r.total, true)}</b></td>
                    <td><StatusChip status={r.status} />{r.offlineRef && <span className="chip violet nodot" style={{ marginLeft: 4 }} title={`Billed offline as ${r.offlineRef}`}>Offline</span>}{r.stockConflict && <span className="chip red nodot" style={{ marginLeft: 4 }}>Stock check</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
              <Pager {...list.data!} onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
