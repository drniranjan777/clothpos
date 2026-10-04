import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { StockRow, VariantSearch } from '../components/VariantSearch';
import { Confirm, Empty, ErrorBox, Loading, Modal, Pager, Tabs, useLoad, useToast } from '../components/ui';
import { get, Paged, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime } from '../lib/format';

interface TransferRow { id: string; transferNo: string; status: 'draft' | 'in_transit' | 'received' | 'cancelled'; totalQty: number; createdAt: string; dispatchedAt?: string; receivedAt?: string; notes?: string; fromStoreId: string; toStoreId: string; fromStore: { name: string; code: string }; toStore: { name: string; code: string } }
interface TransferDetail extends TransferRow {
  createdByName?: string; dispatchedByName?: string; receivedByName?: string; cancelReason?: string;
  items: { id: string; productName: string; sku: string; size?: string; color?: string; qty: number; receivedQty: number | null }[];
}
const STATUS: Record<TransferRow['status'], [string, string]> = { draft: ['gray', 'Draft'], in_transit: ['amber', 'In transit'], received: ['green', 'Received'], cancelled: ['red', 'Cancelled'] };

export default function Transfers() {
  const { me, store } = useAuth();
  const [dir, setDir] = useState<'' | 'out' | 'in'>('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setPage(1), [dir, status, store?.id]);
  const list = useLoad(() => get<Paged<TransferRow>>('/transfers', { storeId: store?.id, direction: dir || undefined, status, page, pageSize: 15 }), [store?.id, dir, status, page]);
  const incoming = list.data?.items.filter((t) => t.status === 'in_transit' && t.toStoreId === store?.id).length ?? 0;
  const otherStores = (me?.stores ?? []).filter((s) => s.id !== store?.id);

  return (
    <>
      <Topbar crumb="Catalogue › Stock Transfers" title="Stock Transfers">
        <span className="btn" style={{ cursor: 'default' }}><Icon name="store" />{store?.name}</span>
        <button className="btn primary" disabled={!otherStores.length && me?.user.role !== 'tenant_admin'} onClick={() => setCreating(true)}><Icon name="swap" />New Transfer</button>
      </Topbar>
      <div className="content">
        {incoming > 0 && (
          <div className="card row" style={{ padding: '12px 16px', gap: 12, background: 'var(--amber-l)', borderColor: '#f6d9a8' }}>
            <Icon name="truck" /><b className="grow">{incoming} transfer{incoming === 1 ? '' : 's'} on the way to {store?.name} — check the pieces and receive them.</b>
            <button className="btn sm" onClick={() => { setDir('in'); setStatus('in_transit'); }}>Show</button>
          </div>
        )}
        <div className="row">
          <Tabs value={dir} onChange={setDir} options={[['', 'All'], ['out', 'Outgoing'], ['in', 'Incoming']]} />
          <Tabs value={status} onChange={setStatus} options={[['', 'Any status'], ['in_transit', 'In transit'], ['received', 'Received'], ['draft', 'Draft'], ['cancelled', 'Cancelled']]} />
        </div>
        <div className="card" style={{ overflow: 'hidden' }}>
          {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data!.items.length ? <Empty icon="swap" title="No transfers" text="Move stock between your stores - stock leaves on dispatch and arrives when received" /> : (
            <>
              <table className="t">
                <thead><tr><th>Transfer</th><th>Route</th><th className="r">Pieces</th><th>Dispatched</th><th>Received</th><th>Status</th></tr></thead>
                <tbody>{list.data!.items.map((t) => (
                  <tr key={t.id} className="click" onClick={() => setOpenId(t.id)}>
                    <td><b>{t.transferNo}</b><div className="muted" style={{ fontSize: 11, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.notes}</div></td>
                    <td><span className="row" style={{ gap: 6 }}><b>{t.fromStore.code}</b><Icon name="arrow" size={14} /><b>{t.toStore.code}</b>{t.toStoreId === store?.id && <span className="chip blue nodot">incoming</span>}</span></td>
                    <td className="r num">{t.totalQty}</td>
                    <td>{t.dispatchedAt ? fmtDateTime(t.dispatchedAt) : '—'}</td>
                    <td>{t.receivedAt ? fmtDateTime(t.receivedAt) : '—'}</td>
                    <td><span className={`chip ${STATUS[t.status][0]}`}>{STATUS[t.status][1]}</span></td>
                  </tr>
                ))}</tbody>
              </table>
              <Pager {...list.data!} onPage={setPage} />
            </>
          )}
        </div>
      </div>
      {creating && store && <NewTransfer fromStoreId={store.id} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); list.reload(); setOpenId(id); }} />}
      {openId && <TransferView id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />}
    </>
  );
}

interface Line { row: StockRow; qty: string }

function NewTransfer({ fromStoreId, onClose, onDone }: { fromStoreId: string; onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const stores = useLoad(() => get<{ id: string; name: string; code: string }[]>('/stores'), []);
  const destinations = (stores.data ?? []).filter((s) => s.id !== fromStoreId);
  const [toStoreId, setTo] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!toStoreId && destinations[0]) setTo(destinations[0].id); }, [destinations, toStoreId]);
  const add = (row: StockRow) => setLines((ls) => (ls.some((l) => l.row.id === row.id) ? ls.map((l) => (l.row.id === row.id ? { ...l, qty: String(Number(l.qty) + 1) } : l)) : [...ls, { row, qty: '1' }]));
  const over = lines.filter((l) => Number(l.qty) > l.row.stock);
  const units = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);
  const save = async (dispatch: boolean) => {
    setBusy(true);
    try {
      const t = await post<TransferDetail>('/transfers', { fromStoreId, toStoreId, notes: notes || undefined, dispatch, items: lines.map((l) => ({ variantId: l.row.id, qty: Number(l.qty) })) });
      toast(dispatch ? `${t.transferNo} dispatched - ${t.totalQty} pieces left this store` : `${t.transferNo} saved as draft`, 'success');
      onDone(t.id);
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title="New stock transfer" icon="swap" sub="Stock leaves this store when dispatched and arrives when the other store receives it" onClose={onClose} width={760}
      footer={<><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy || !lines.length || !toStoreId} onClick={() => save(false)}>Save draft</button>
        <button className="btn primary" disabled={busy || !lines.length || !toStoreId || over.length > 0} onClick={() => save(true)}><Icon name="truck" />Dispatch {units} piece{units === 1 ? '' : 's'}</button></>}>
      {stores.data && !destinations.length ? <Empty icon="store" title="You have only one store" text="Add another store in Settings to move stock between stores" /> : <>
        <div className="form-grid">
          <div className="field"><label>Send to</label><select className="input" value={toStoreId} onChange={(e) => setTo(e.target.value)}>{destinations.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></div>
          <div className="field"><label>Note</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Weekend demand" /></div>
        </div>
        <div style={{ marginTop: 14 }}><VariantSearch storeId={fromStoreId} onPick={add} autoFocus /></div>
        <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          {!lines.length ? <Empty icon="scan" title="Scan the pieces you are sending" /> : (
            <table className="t"><tbody>{lines.map((l, i) => {
              const bad = Number(l.qty) > l.row.stock;
              return (
                <tr key={l.row.id} style={bad ? { background: 'var(--red-l)' } : undefined}>
                  <td><b>{l.row.productName}</b><div className="muted" style={{ fontSize: 11 }}>{[l.row.size, l.row.color].filter(Boolean).join(' · ')} · {l.row.sku}</div></td>
                  <td className="r" style={{ fontSize: 12 }}>{bad ? <span className="down">only {l.row.stock} here</span> : <span className="muted">{l.row.stock} in stock</span>}</td>
                  <td style={{ width: 100 }}><input className="input num" style={{ height: 32 }} value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value.replace(/\D/g, '') } : x)))} /></td>
                  <td style={{ width: 30 }}><button className="link faint" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label="Remove"><Icon name="trash" size={16} /></button></td>
                </tr>
              );
            })}</tbody></table>
          )}
        </div>
      </>}
    </Modal>
  );
}

function TransferView({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { canStore } = useStoreAccess();
  const { data: t, loading, error, reload } = useLoad(() => get<TransferDetail>(`/transfers/${id}`), [id]);
  const [got, setGot] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => { if (t) setGot(Object.fromEntries(t.items.map((i) => [i.id, String(i.receivedQty ?? i.qty)]))); }, [t]);
  const done = () => { reload(); onChanged(); };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg, 'success'); done(); } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  const short = t ? t.items.reduce((s, i) => s + Math.max(0, i.qty - (Number(got[i.id]) || 0)), 0) : 0;
  const atSource = t && canStore(t.fromStoreId);
  const atDest = t && canStore(t.toStoreId);
  return (
    <Modal title={t?.transferNo ?? 'Transfer'} sub={t && `${t.fromStore.name} → ${t.toStore.name}`} icon="swap" onClose={onClose} width={720}
      footer={t && <>
        {['draft', 'in_transit'].includes(t.status) && atSource && <button className="btn danger" onClick={() => setCancelling(true)}>Cancel transfer</button>}
        <span className="grow" />
        {t.status === 'draft' && atSource && <button className="btn primary" disabled={busy} onClick={() => act(() => post(`/transfers/${t.id}/dispatch`), 'Dispatched - stock left this store')}><Icon name="truck" />Dispatch</button>}
        {t.status === 'in_transit' && atDest && <button className="btn primary" disabled={busy} onClick={() => act(() => post(`/transfers/${t.id}/receive`, { items: t.items.map((i) => ({ itemId: i.id, receivedQty: Number(got[i.id]) || 0 })) }), short ? `Received - shortage of ${short} recorded` : 'All pieces received')}><Icon name="check" />Receive{short ? ` (${short} short)` : ''}</button>}
        {(t.status === 'received' || t.status === 'cancelled' || (t.status === 'in_transit' && !atDest)) && <button className="btn" onClick={onClose}>Close</button>}
      </>}>
      {loading && !t ? <Loading /> : error || !t ? <ErrorBox error={error ?? 'Not found'} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
            <span className={`chip ${STATUS[t.status][0]}`}>{STATUS[t.status][1]}</span>
            <span><span className="muted">Created</span> {fmtDateTime(t.createdAt)} · {t.createdByName}</span>
            {t.dispatchedAt && <span><span className="muted">Dispatched</span> {fmtDateTime(t.dispatchedAt)} · {t.dispatchedByName}</span>}
            {t.receivedAt && <span><span className="muted">Received</span> {fmtDateTime(t.receivedAt)} · {t.receivedByName}</span>}
          </div>
          {t.notes && <div className="muted" style={{ fontSize: 12.5 }}>{t.notes}</div>}
          {t.cancelReason && <div className="down" style={{ fontSize: 12.5 }}>Cancelled: {t.cancelReason}</div>}
          {t.status === 'in_transit' && atDest && <div style={{ background: 'var(--blue-ll)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>Count the pieces that arrived. Anything missing is recorded as a shortage on this transfer.</div>}
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
            <table className="t">
              <thead><tr><th>Item</th><th className="r">Sent</th><th className="r" style={{ width: 130 }}>Received</th></tr></thead>
              <tbody>{t.items.map((i) => (
                <tr key={i.id}><td><b>{i.productName}</b><div className="muted" style={{ fontSize: 11 }}>{[i.size, i.color].filter(Boolean).join(' · ')} · {i.sku}</div></td>
                  <td className="r num">{i.qty}</td>
                  <td className="r">{t.status === 'in_transit' && atDest
                    ? <input className="input num" style={{ height: 32, width: 90, marginLeft: 'auto' }} value={got[i.id] ?? ''} onChange={(e) => setGot({ ...got, [i.id]: e.target.value.replace(/\D/g, '') })} />
                    : i.receivedQty == null ? <span className="muted">—</span> : <b className={i.receivedQty < i.qty ? 'down' : 'num'}>{i.receivedQty}</b>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {cancelling && t && <Confirm title={`Cancel ${t.transferNo}?`} danger needReason confirmLabel="Cancel transfer" onClose={() => setCancelling(false)}
        text={t.status === 'in_transit' ? `The ${t.totalQty} pieces go back into ${t.fromStore.name} stock.` : 'The draft is cancelled; no stock has moved.'}
        onConfirm={async (reason) => { await post(`/transfers/${t.id}/cancel`, { reason }); toast('Transfer cancelled', 'success'); done(); }} />}
    </Modal>
  );
}

/** Mirrors the server's store-access rule so the right buttons show at each end of a transfer. */
function useStoreAccess() {
  const { me } = useAuth();
  const wide = me?.user.role === 'tenant_admin';
  return { canStore: (id: string) => wide || !!me?.stores.some((s) => s.id === id) };
}
