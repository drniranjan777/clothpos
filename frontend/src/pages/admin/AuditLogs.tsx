import { useEffect, useState } from 'react';
import { Topbar } from '../../components/Layout';
import { Empty, ErrorBox, Loading, Pager, Tabs, useLoad } from '../../components/ui';
import { get, Paged } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';

interface Row { id: string; createdAt: string; tenantId: string | null; userName?: string; action: string; entity: string; entityId?: string; meta?: Record<string, unknown> }
const TONE: Record<string, string> = { tenant: 'violet', subscription: 'blue', plan: 'blue', sale: 'amber', inventory: 'green', auth: 'gray', shift: 'gray', user: 'violet', product: 'green' };

export default function AuditLogs() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [action]);
  const { data, error, loading, reload } = useLoad(() => get<Paged<Row>>('/admin/audit-logs', { action, page }), [action, page]);
  return (
    <>
      <Topbar crumb="Platform › Audit Logs" title="Audit Logs">
        <Tabs value={action} onChange={setAction} options={[['', 'All'], ['tenant', 'Tenants'], ['subscription', 'Subscriptions'], ['plan', 'Plans'], ['sale', 'Sales'], ['inventory', 'Inventory'], ['auth', 'Sign-ins']]} />
      </Topbar>
      <div className="content">
        <div className="card" style={{ overflow: 'hidden' }}>
          {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data!.items.length ? <Empty icon="history" title="No audit entries" /> : (
            <>
              <table className="t">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
                <tbody>{data!.items.map((a) => (
                  <tr key={a.id}><td>{fmtDateTime(a.createdAt)}</td><td><b>{a.userName ?? 'System'}</b></td>
                    <td><span className={`chip ${TONE[a.action.split('.')[0]] ?? 'gray'}`}>{a.action}</span></td>
                    <td style={{ whiteSpace: 'normal', fontSize: 11.5, color: 'var(--muted)', maxWidth: 520 }}>{a.meta ? Object.entries(a.meta).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ') : '—'}</td></tr>
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
