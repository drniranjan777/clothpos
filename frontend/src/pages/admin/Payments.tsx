import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Topbar } from '../../components/Layout';
import { Empty, ErrorBox, Loading, Pager, StatusChip, Tabs, useLoad } from '../../components/ui';
import { get, Paged } from '../../lib/api';
import { fmtDateTime, inr, PAYMENT_LABEL } from '../../lib/format';

interface Row { id: string; amount: number; method: string; status: string; reference?: string; failureReason?: string; paidAt?: string; createdAt: string; tenant: { id: string; businessName: string } }

export default function Payments() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status]);
  const { data, error, loading, reload } = useLoad(() => get<Paged<Row>>('/admin/payments', { status, page }), [status, page]);
  return (
    <>
      <Topbar crumb="Platform › Payments" title="Subscription Payments"><Tabs value={status} onChange={setStatus} options={[['', 'All'], ['paid', 'Paid'], ['failed', 'Failed'], ['pending', 'Pending']]} /></Topbar>
      <div className="content">
        <div className="card" style={{ overflow: 'hidden' }}>
          {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data!.items.length ? <Empty icon="card" title="No payments" /> : (
            <>
              <table className="t">
                <thead><tr><th>Date</th><th>Tenant</th><th>Method</th><th>Reference</th><th className="r">Amount</th><th>Status</th></tr></thead>
                <tbody>{data!.items.map((p) => (
                  <tr key={p.id}><td>{fmtDateTime(p.paidAt ?? p.createdAt)}</td><td><Link className="link" to={`/admin/tenants?id=${p.tenant.id}`}>{p.tenant.businessName}</Link></td>
                    <td>{PAYMENT_LABEL[p.method] ?? p.method}</td><td className="num">{p.reference ?? '—'}{p.failureReason && <div className="down" style={{ fontSize: 11 }}>{p.failureReason}</div>}</td>
                    <td className="r num"><b>{inr(p.amount, true)}</b></td><td><StatusChip status={p.status} /></td></tr>
                ))}</tbody>
              </table>
              <Pager {...data!} onPage={setPage} />
            </>
          )}
        </div>
      </div>
    </>
  );
}
