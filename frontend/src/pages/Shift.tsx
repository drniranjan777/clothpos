import { useMemo, useState } from 'react';
import { Bars } from '../components/Charts';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { PrintPortal } from '../components/Receipt';
import { Empty, ErrorBox, Kpi, Loading, StatusChip, useLoad, useToast } from '../components/ui';
import { get, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtTime, inr, PAYMENT_LABEL } from '../lib/format';
import { OpenShift } from './pos/PosModals';

interface Summary { bills: number; cancelled: number; grossSales: number; discounts: number; items: number; payments: { method: string; count: number; amount: number }[]; cashRefunds: number; cashRefundCount: number; cashCollected: number; hourly: { hour: number; total: number }[]; heldBills: number; openingCash: number; cashSales: number; expectedCash: number; countedCash?: number; variance?: number }
interface ShiftT { id: string; shiftNo: number; counter: number; openingCash: number; openedAt: string; closedAt?: string; status: string; countedCash?: number; expectedCash?: number; note?: string; summary: Summary; user?: { id: string; name: string } }
const NOTES = ['500', '200', '100', '50', '20', '10'];
const TONE: Record<string, [string, string]> = { '500': ['#f3e8ff', '#7e22ce'], '200': ['#fce7f3', '#be185d'], '100': ['#fef9c3', '#a16207'], '50': ['#e0f2fe', '#0369a1'], '20': ['#dcfce7', '#15803d'], '10': ['#f1f5f9', '#475569'] };
const TOLERANCE = 200;

export default function Shift() {
  const { me, store, can } = useAuth();
  const toast = useToast();
  const cur = useLoad(() => (store ? get<{ shift: ShiftT | null }>('/shifts/current', { storeId: store.id }) : Promise.resolve({ shift: null })), [store?.id]);
  const recent = useLoad(() => (can('tenant_admin', 'store_manager') ? get<ShiftT[]>('/shifts', { storeId: store?.id }) : Promise.resolve([])), [store?.id]);
  const [den, setDen] = useState<Record<string, string>>({});
  const [coins, setCoins] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState(false);
  const [closed, setClosed] = useState<ShiftT | null>(null);
  const [printing, setPrinting] = useState(false);
  const shift = cur.data?.shift;
  const s = shift?.summary;
  const counted = useMemo(() => NOTES.reduce((a, k) => a + Number(k) * (Number(den[k]) || 0), 0) + (Number(coins) || 0), [den, coins]);
  const variance = s ? Math.round((counted - s.expectedCash) * 100) / 100 : 0;
  const touched = Object.values(den).some(Boolean) || !!coins;

  const close = async () => {
    if (!shift) return;
    setBusy(true);
    try {
      const r = await post<ShiftT>(`/shifts/${shift.id}/close`, { denominations: { ...Object.fromEntries(NOTES.map((k) => [k, Number(den[k]) || 0])), coins: Number(coins) || 0 }, note: note || undefined });
      setClosed(r);
      toast(`Shift #${r.shiftNo} closed`, 'success');
      setPrinting(true);
      cur.reload(); recent.reload();
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  const approve = async (id: string) => {
    try { await post(`/shifts/${id}/approve`); toast('Shift approved', 'success'); recent.reload(); } catch (e) { toast((e as Error).message, 'error'); }
  };

  const hours = s ? Array.from({ length: 13 }, (_, i) => i + 9) : [];
  return (
    <>
      <Topbar crumb="Sales › Shift & Day Close" title={shift ? `Close Shift #${shift.shiftNo} · Counter ${shift.counter}` : 'Shift & Day Close'}>
        {shift && <span className="chip green">Open since {fmtTime(shift.openedAt)}</span>}
        {shift && <button className="btn" onClick={() => setPrinting(true)}><Icon name="printer" />Print X-report</button>}
      </Topbar>
      <div className="content" style={{ flexDirection: 'row' }}>
        {cur.loading && !cur.data ? <Loading /> : cur.error ? <ErrorBox error={cur.error} onRetry={cur.reload} /> : !shift || !s ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card"><Empty icon="timer" title={closed ? `Shift #${closed.shiftNo} closed · variance ${inr(closed.summary.variance ?? 0)}` : 'You have no open shift'} text="Open a shift with the opening drawer cash to start billing."
              action={<button className="btn primary" onClick={() => setOpening(true)}><Icon name="play" />Open shift</button>} /></div>
            {(recent.data?.length ?? 0) > 0 && <RecentShifts rows={recent.data!} onApprove={approve} />}
          </div>
        ) : (
          <>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              <div className="kpis" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                <Kpi label="Opening cash" value={inr(s.openingCash)} delta={`counted at ${fmtTime(shift.openedAt)}`} />
                <Kpi label="Bills processed" value={s.bills} delta={`${s.heldBills} held · ${s.cancelled} cancelled`} />
                <Kpi label="Gross sales" value={inr(s.grossSales)} delta={`${inr(s.discounts)} discounts given`} />
                <Kpi label="Cash refunds paid" value={inr(s.cashRefunds)} delta={`${s.cashRefundCount} refund(s)${s.cashCollected ? ` · ${inr(s.cashCollected)} collected` : ''}`} />
              </div>
              <div className="card" style={{ overflow: 'hidden' }}>
                <div className="card-h" style={{ paddingBottom: 10 }}><h3>Payment summary</h3><span className="muted" style={{ fontSize: 12 }}>System totals for this shift</span></div>
                {s.payments.length === 0 ? <Empty icon="card" title="No payments yet" /> : (
                  <table className="t">
                    <thead><tr><th>Method</th><th className="r">Transactions</th><th className="r">Amount</th><th className="r">Expected in drawer</th></tr></thead>
                    <tbody>{s.payments.map((p) => (
                      <tr key={p.method}><td><div className="row"><Icon name={p.method === 'store_credit' ? 'gift' : p.method} /><b>{PAYMENT_LABEL[p.method] ?? p.method}</b></div></td><td className="r num">{p.count}</td><td className="r num"><b>{inr(p.amount)}</b></td>
                        <td className="r num">{p.method === 'cash' ? <b>{inr(s.expectedCash)}</b> : <span className="muted">settles to bank</span>}</td></tr>
                    ))}</tbody>
                  </table>
                )}
              </div>
              {touched && Math.abs(variance) > 0 && (
                <div className="card row" style={{ padding: '16px 18px', gap: 16, background: Math.abs(variance) > TOLERANCE ? 'var(--red-l)' : 'var(--amber-l)', borderColor: Math.abs(variance) > TOLERANCE ? '#f8cdb8' : '#f6d9a8' }}>
                  <span style={{ width: 40, height: 40, borderRadius: 10, background: '#fff', color: 'var(--amber)', display: 'grid', placeItems: 'center' }}><Icon name="alert" /></span>
                  <div className="grow"><b>Cash {variance < 0 ? 'short' : 'excess'} by {inr(Math.abs(variance))}</b><div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{Math.abs(variance) > TOLERANCE ? `Above the ₹${TOLERANCE} tolerance — a note is required.` : `Within the ₹${TOLERANCE} tolerance.`} The manager confirms before day closing.</div></div>
                  <input className="input" style={{ width: 280 }} placeholder="Note, e.g. change given twice on bill 08417" value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              )}
              <div className="card">
                <div className="card-h"><h3>Hourly sales · this shift</h3><span className="muted" style={{ fontSize: 12 }}>{s.items} pieces sold</span></div>
                <div className="card-b" style={{ paddingTop: 4 }}>
                  <Bars data={hours.map((h) => s.hourly.find((x) => x.hour === h)?.total ?? 0)} labels={hours.map((h) => String(h > 12 ? h - 12 : h))} height={110} title={(i) => `${hours[i]}:00 · ${inr(s.hourly.find((x) => x.hour === hours[i])?.total ?? 0)}`} />
                </div>
              </div>
              {(recent.data?.length ?? 0) > 0 && <RecentShifts rows={recent.data!} onApprove={approve} />}
            </div>
            <div className="card" style={{ width: 350, flex: 'none', display: 'flex', flexDirection: 'column', alignSelf: 'flex-start' }}>
              <div className="card-h"><h3>Cash count</h3><span className="muted" style={{ fontSize: 12 }}>by denomination</span></div>
              <div className="card-b" style={{ display: 'flex', flexDirection: 'column' }}>
                {NOTES.map((k) => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '70px 1fr 90px', gap: 10, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
                    <span style={{ display: 'grid', placeItems: 'center', height: 28, borderRadius: 6, fontWeight: 700, fontSize: 12, background: TONE[k][0], color: TONE[k][1] }}>₹{k}</span>
                    <input className="input num" style={{ height: 32, width: 80, textAlign: 'center' }} inputMode="numeric" placeholder="0" value={den[k] ?? ''} onChange={(e) => setDen({ ...den, [k]: e.target.value.replace(/\D/g, '') })} />
                    <b className="num" style={{ textAlign: 'right' }}>{inr(Number(k) * (Number(den[k]) || 0))}</b>
                  </div>
                ))}
                <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 90px', gap: 10, alignItems: 'center', padding: '6px 0' }}>
                  <span style={{ display: 'grid', placeItems: 'center', height: 28, borderRadius: 6, fontWeight: 700, fontSize: 12, background: '#f1f5f9', color: '#475569' }}>Coins</span>
                  <input className="input num" style={{ height: 32, width: 80, textAlign: 'center' }} inputMode="decimal" placeholder="₹" value={coins} onChange={(e) => setCoins(e.target.value.replace(/[^\d.]/g, ''))} />
                  <b className="num" style={{ textAlign: 'right' }}>{inr(Number(coins) || 0)}</b>
                </div>
                <div className="row between" style={{ marginTop: 10, background: 'var(--navy)', color: '#fff', borderRadius: 10, padding: 14 }}><span>Counted cash</span><b className="num" style={{ fontSize: 20 }}>{inr(counted)}</b></div>
                <div className="row between" style={{ marginTop: 8, fontSize: 12, padding: '0 4px' }}><span className="muted">Expected (opening + cash sales − refunds)</span><b className="num">{inr(s.expectedCash)}</b></div>
                <button className="btn primary lg" style={{ justifyContent: 'center', marginTop: 16 }} disabled={busy || !touched || (Math.abs(variance) > TOLERANCE && !note.trim())} onClick={close}><Icon name="check" />Close shift &amp; print Z-report</button>
                <span className="muted" style={{ fontSize: 11.5, marginTop: 8, textAlign: 'center' }}>{me?.user.role === 'cashier' ? 'Your manager approves the closed shift.' : 'You can approve closed shifts below.'}</span>
              </div>
            </div>
          </>
        )}
      </div>
      {opening && store && <OpenShift storeId={store.id} counters={store.counters} required={false} onClose={() => setOpening(false)} onOpened={() => { setOpening(false); setClosed(null); cur.reload(); }} />}
      {printing && (closed ?? shift) && (
        <PrintPortal onDone={() => setPrinting(false)}>
          <ShiftReport shift={(closed ?? shift)!} business={me?.tenant?.businessName ?? ''} storeName={store?.name ?? ''} cashier={me?.user.name ?? ''} kind={closed ? 'Z' : 'X'} />
        </PrintPortal>
      )}
    </>
  );
}

function RecentShifts({ rows, onApprove }: { rows: ShiftT[]; onApprove: (id: string) => void }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-h" style={{ paddingBottom: 10 }}><h3>Recent shifts</h3><span className="muted" style={{ fontSize: 12 }}>Manager confirmation</span></div>
      <table className="t">
        <thead><tr><th>Shift</th><th>Cashier</th><th>Opened</th><th>Closed</th><th className="r">Expected</th><th className="r">Counted</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.slice(0, 8).map((r) => {
          const v = r.countedCash != null && r.expectedCash != null ? r.countedCash - r.expectedCash : null;
          return (
            <tr key={r.id}><td><b>#{r.shiftNo}</b> · C{r.counter}</td><td>{r.user?.name}</td><td>{fmtDateTime(r.openedAt)}</td><td>{r.closedAt ? fmtDateTime(r.closedAt) : '—'}</td>
              <td className="r num">{r.expectedCash != null ? inr(r.expectedCash) : '—'}</td>
              <td className="r num">{r.countedCash != null ? <>{inr(r.countedCash)} {v !== null && v !== 0 && <span className={v < 0 ? 'down' : 'up'}>({v > 0 ? '+' : ''}{v})</span>}</> : '—'}</td>
              <td><StatusChip status={r.status} /></td>
              <td>{r.status === 'closed' && <button className="btn sm" onClick={() => onApprove(r.id)}>Approve</button>}</td></tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function ShiftReport({ shift, business, storeName, cashier, kind }: { shift: ShiftT; business: string; storeName: string; cashier: string; kind: 'X' | 'Z' }) {
  const s = shift.summary;
  return (
    <div className="receipt num" style={{ width: 300 }}>
      <div className="c"><b style={{ fontSize: 14 }}>{business.toUpperCase()}</b><br />{storeName}<br /><b>{kind}-REPORT · SHIFT #{shift.shiftNo}</b></div><hr />
      <div className="r"><span>Cashier</span><span>{shift.user?.name ?? cashier}</span></div>
      <div className="r"><span>Counter</span><span>{shift.counter}</span></div>
      <div className="r"><span>Opened</span><span>{new Date(shift.openedAt).toLocaleString('en-IN')}</span></div>
      {shift.closedAt && <div className="r"><span>Closed</span><span>{new Date(shift.closedAt).toLocaleString('en-IN')}</span></div>}<hr />
      <div className="r"><span>Bills</span><span>{s.bills}</span></div>
      <div className="r"><span>Gross sales</span><span>{s.grossSales.toFixed(2)}</span></div>
      <div className="r"><span>Discounts</span><span>{s.discounts.toFixed(2)}</span></div><hr />
      {s.payments.map((p) => <div className="r" key={p.method}><span>{PAYMENT_LABEL[p.method]} ({p.count})</span><span>{p.amount.toFixed(2)}</span></div>)}<hr />
      <div className="r"><span>Opening cash</span><span>{s.openingCash.toFixed(2)}</span></div>
      <div className="r"><span>Cash refunds</span><span>-{s.cashRefunds.toFixed(2)}</span></div>
      <div className="r tot"><span>EXPECTED CASH</span><span>{s.expectedCash.toFixed(2)}</span></div>
      {s.countedCash != null && <><div className="r"><span>Counted</span><span>{s.countedCash.toFixed(2)}</span></div><div className="r"><span>Variance</span><span>{(s.variance ?? 0).toFixed(2)}</span></div></>}
      <hr /><div className="c">Printed {fmtDateTime(new Date())}</div>
    </div>
  );
}
