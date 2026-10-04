import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { ProductArt } from '../components/ProductArt';
import { Empty, ErrorBox, Kpi, Loading, Modal, Pager, Tabs, useDebounced, useLoad, useToast } from '../components/ui';
import { get, Paged, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDay, fmtTime, inrShort, n } from '../lib/format';

interface Summary { skus: number; products: number; costValue: number; mrpValue: number; units: number; lowStock: number; outOfStock: number }
interface Ledger { id: string; createdAt: string; type: string; quantity: number; balanceAfter: number; referenceNo?: string; note?: string; userName?: string; variant: { sku: string; size?: string; color?: string }; product: { name: string; artType: string; artColor: string } }
interface StockRow { id: string; sku: string; barcode: string; size?: string; color?: string; productName: string; artType: string; artColor: string; stock: number; minStock: number; mrp: number; purchasePrice: number }
interface Lookup { variant: { id: string; sku: string; barcode: string; size?: string; color?: string }; product: { name: string; artType: string; artColor: string }; stock: number }

const TYPE: Record<string, [string, string]> = {
  sale: ['blue', 'Sale'], sale_cancel: ['gray', 'Sale cancelled'], return: ['violet', 'Return'], exchange_out: ['violet', 'Exchange out'], purchase: ['green', 'Purchase'],
  opening: ['gray', 'Opening'], adjustment_damage: ['red', 'Damage / loss'], adjustment_found: ['green', 'Found'], adjustment_recount: ['amber', 'Recount'],
  transfer_in: ['green', 'Transfer in'], transfer_out: ['amber', 'Transfer out'],
};

export default function Inventory() {
  const { store, can } = useAuth();
  const storeId = store?.id;
  const [tab, setTab] = useState<'ledger' | 'stock'>('ledger');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [receiving, setReceiving] = useState(false);
  useEffect(() => setPage(1), [tab, filter, q, storeId]);

  const summary = useLoad(() => get<Summary>('/inventory/summary', { storeId }), [storeId]);
  const ledger = useLoad(() => (tab === 'ledger' ? get<Paged<Ledger>>('/inventory/ledger', { storeId, search: q, page, pageSize: 12 }) : Promise.resolve(null)), [tab, storeId, q, page]);
  const stock = useLoad(() => (tab === 'stock' ? get<Paged<StockRow>>('/inventory/stock', { storeId, search: q, filter, page, pageSize: 12 }) : Promise.resolve(null)), [tab, storeId, q, filter, page]);
  const canAdjust = can('tenant_admin', 'store_manager', 'inventory_user');
  const refresh = () => { summary.reload(); ledger.reload(); stock.reload(); };
  const s = summary.data;
  const cur = tab === 'ledger' ? ledger : stock;

  return (
    <>
      <Topbar crumb="Catalogue › Inventory" title="Inventory">
        <span className="btn" style={{ cursor: 'default' }}><Icon name="store" />{store?.name}</span>
        {canAdjust && <button className="btn" onClick={() => setReceiving(true)}><Icon name="truck" />Receive Stock</button>}
      </Topbar>
      <div className="content">
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
          <Kpi icon="box" label="Inventory value (cost)" value={s ? inrShort(s.costValue) : '…'} delta={s && `at purchase price · ${inrShort(s.mrpValue)} at MRP`} />
          <Kpi icon="tag" tone="violet" label="Active SKUs" value={s ? n(s.skus) : '…'} delta={s && `${n(s.units)} pieces · ${s.products} products`} />
          <Kpi icon="alert" tone="amber" label="Low stock" value={s ? s.lowStock : '…'} delta={<button className="link" onClick={() => { setTab('stock'); setFilter('low'); }}>below minimum level →</button>} />
          <Kpi icon="x" tone="red" label="Out of stock" value={s ? s.outOfStock : '…'} delta={<button className="link" onClick={() => { setTab('stock'); setFilter('out'); }}>selling blocked →</button>} />
          <Kpi icon="history" tone="green" label="Stock ledger" value="Live" delta="every sale, return & adjustment" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: canAdjust ? '1fr 370px' : '1fr', gap: 16, alignItems: 'start' }}>
          <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px' }} className="row">
              <Tabs value={tab} onChange={setTab} options={[['ledger', 'Stock ledger'], ['stock', 'Current stock']]} />
              {tab === 'stock' && <div className="pill-row"><span className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All</span><span className={filter === 'low' ? 'on' : ''} onClick={() => setFilter('low')}>Low</span><span className={filter === 'out' ? 'on' : ''} onClick={() => setFilter('out')}>Out</span></div>}
              <div className="grow" />
              <div className="search" style={{ width: 220, height: 34 }}><Icon name="search" size={15} /><input placeholder="SKU, barcode or product" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            </div>
            {cur.loading && !cur.data ? <Loading /> : cur.error ? <ErrorBox error={cur.error} onRetry={cur.reload} /> : tab === 'ledger' ? (
              ledger.data && (ledger.data.items.length === 0 ? <Empty icon="history" title="No stock movements" /> : <>
                <table className="t">
                  <thead><tr><th>Date / Time</th><th>SKU · Variant</th><th>Movement</th><th>Reference</th><th className="r">Qty</th><th className="r">Balance</th></tr></thead>
                  <tbody>{ledger.data.items.map((t) => {
                    const [tone, label] = TYPE[t.type] ?? ['gray', t.type];
                    return (
                      <tr key={t.id} title={t.note ?? ''}>
                        <td>{fmtDay(t.createdAt)}<div className="muted" style={{ fontSize: 11 }}>{fmtTime(t.createdAt)}</div></td>
                        <td><div className="row"><div className="thumb"><ProductArt type={t.product.artType} color={t.product.artColor} /></div><div><b>{t.variant.sku}</b><div className="muted" style={{ fontSize: 11 }}>{t.product.name} · {[t.variant.size, t.variant.color].filter(Boolean).join(' · ')}</div></div></div></td>
                        <td><span className={`chip ${tone}`}>{label}</span></td>
                        <td>{t.referenceNo ?? '—'}<div className="muted" style={{ fontSize: 11 }}>{t.userName}</div></td>
                        <td className={`r num ${t.quantity > 0 ? 'up' : 'down'}`}>{t.quantity > 0 ? `+${t.quantity}` : t.quantity}</td>
                        <td className="r num"><b>{t.balanceAfter}</b></td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                <Pager {...ledger.data} onPage={setPage} />
              </>)
            ) : (
              stock.data && (stock.data.items.length === 0 ? <Empty icon="check" title={filter === 'all' ? 'No items' : 'Nothing here — stock levels are fine'} /> : <>
                <table className="t">
                  <thead><tr><th>SKU · Variant</th><th>Barcode</th><th className="r">Min</th><th className="r">Stock</th><th className="r">Value (cost)</th></tr></thead>
                  <tbody>{stock.data.items.map((r) => (
                    <tr key={r.id}>
                      <td><div className="row"><div className="thumb"><ProductArt type={r.artType} color={r.artColor} /></div><div><b>{r.sku}</b><div className="muted" style={{ fontSize: 11 }}>{r.productName} · {[r.size, r.color].filter(Boolean).join(' · ')}</div></div></div></td>
                      <td className="num">{r.barcode}</td>
                      <td className="r num">{r.minStock}</td>
                      <td className="r"><span className={`chip ${r.stock <= 0 ? 'red' : r.stock <= r.minStock ? 'amber' : 'green'} nodot`}>{r.stock}</span></td>
                      <td className="r num">{inrShort(Math.max(0, r.stock) * r.purchasePrice)}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <Pager {...stock.data} onPage={setPage} />
              </>)
            )}
          </div>
          {canAdjust && storeId && <AdjustPanel storeId={storeId} onDone={refresh} />}
        </div>
      </div>
      {receiving && storeId && <ReceiveModal storeId={storeId} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); refresh(); }} />}
    </>
  );
}

function useScanLookup(storeId: string) {
  const [code, setCode] = useState('');
  const [item, setItem] = useState<Lookup | null>(null);
  const [err, setErr] = useState('');
  const look = async (c = code) => {
    if (!c.trim()) return;
    try {
      setItem(await get<Lookup>('/inventory/lookup', { code: c.trim(), storeId }));
      setErr('');
    } catch (e) {
      setItem(null);
      setErr((e as Error).message);
    }
  };
  return { code, setCode, item, setItem, err, look };
}

function AdjustPanel({ storeId, onDone }: { storeId: string; onDone: () => void }) {
  const toast = useToast();
  const s = useScanLookup(storeId);
  const [type, setType] = useState<'damage' | 'found' | 'recount'>('damage');
  const [qty, setQty] = useState('1');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const q = Number(qty) || 0;
  const newBal = s.item ? (type === 'damage' ? s.item.stock - q : type === 'found' ? s.item.stock + q : q) : 0;
  const submit = async () => {
    if (!s.item) return;
    setBusy(true);
    try {
      const r = await post<{ referenceNo: string; balance: number }>('/inventory/adjustments', { storeId, variantId: s.item.variant.id, type, qty: q, reason });
      toast(`${r.referenceNo} saved · new balance ${r.balance}`, 'success');
      s.setItem(null); s.setCode(''); setReason(''); setQty('1');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="card">
      <div className="card-h"><div><h3>New stock adjustment</h3><div className="sub">Damage, found items or a physical recount · audited</div></div></div>
      <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field"><label>Scan or search SKU</label>
          <div className={`input ${s.err ? 'err' : ''}`}><Icon name="barcode" size={16} /><input placeholder="Scan barcode or type SKU, press Enter" value={s.code} onChange={(e) => s.setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && s.look()} />{s.item && <span className="chip green" style={{ fontSize: 10 }}>Found</span>}</div>
          {s.err && <span className="error">{s.err}</span>}</div>
        {s.item && (
          <div className="row" style={{ background: 'var(--bg)', borderRadius: 10, padding: 10 }}>
            <div className="thumb"><ProductArt type={s.item.product.artType} color={s.item.product.artColor} /></div>
            <div className="grow"><b>{s.item.product.name}</b><div className="muted" style={{ fontSize: 11 }}>{s.item.variant.sku} · {[s.item.variant.size, s.item.variant.color].filter(Boolean).join(' · ')}</div></div>
            <div style={{ textAlign: 'right' }}><span className="muted" style={{ fontSize: 11 }}>On hand</span><br /><b>{s.item.stock}</b></div>
          </div>
        )}
        <div className="field"><label>Adjustment type</label><Tabs value={type} onChange={setType} options={[['damage', 'Damage / loss'], ['found', 'Found'], ['recount', 'Recount']]} /></div>
        <div className="row" style={{ gap: 10 }}>
          <div className="field grow"><label>{type === 'recount' ? 'Counted quantity' : 'Quantity'}</label><input className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} /></div>
          <div className="field grow"><label>New balance</label><div className="input num" style={{ background: 'var(--bg)', color: newBal < 0 ? 'var(--red)' : undefined }}>{s.item ? newBal : '—'}</div></div>
        </div>
        <div className="field"><label>Reason</label><textarea className="input" placeholder="e.g. Zip broken - returned to vendor" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <div className="row" style={{ gap: 8, fontSize: 11.5, color: 'var(--muted)' }}><Icon name="shield" size={14} />Logged in the audit trail with your name &amp; time</div>
        <button className="btn primary lg" style={{ justifyContent: 'center' }} disabled={!s.item || busy || reason.trim().length < 3 || (type !== 'recount' && q < 1) || newBal < 0} onClick={submit}>Submit adjustment</button>
      </div>
    </div>
  );
}

function ReceiveModal({ storeId, onClose, onDone }: { storeId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const s = useScanLookup(storeId);
  const [rows, setRows] = useState<(Lookup & { qty: number })[]>([]);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!s.item) return;
    const it = s.item;
    setRows((r) => (r.some((x) => x.variant.id === it.variant.id) ? r.map((x) => (x.variant.id === it.variant.id ? { ...x, qty: x.qty + 1 } : x)) : [...r, { ...it, qty: 1 }]));
    s.setItem(null);
    s.setCode('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.item]);
  const units = rows.reduce((a, r) => a + r.qty, 0);
  const save = async () => {
    setBusy(true);
    try {
      await post('/inventory/receive', { storeId, reference: reference || undefined, items: rows.map((r) => ({ variantId: r.variant.id, qty: r.qty })) });
      toast(`${units} pieces received into stock`, 'success');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title="Receive stock" icon="truck" sub="Scan each piece (or type SKU) - quantities add up automatically" onClose={onClose} width={640}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!rows.length || busy} onClick={save}>Add {units} piece{units === 1 ? '' : 's'} to stock</button></>}>
      <div className="form-grid">
        <div className="field"><label>Scan barcode / SKU</label><div className={`input ${s.err ? 'err' : ''}`}><Icon name="barcode" size={16} /><input autoFocus value={s.code} onChange={(e) => s.setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && s.look()} /></div>{s.err && <span className="error">{s.err}</span>}</div>
        <div className="field"><label>Supplier invoice / PO reference</label><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="PO-0912" /></div>
      </div>
      <div style={{ marginTop: 14, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {rows.length === 0 ? <Empty icon="scan" title="Nothing scanned yet" /> : (
          <table className="t"><tbody>{rows.map((r) => (
            <tr key={r.variant.id}>
              <td><div className="row"><div className="thumb"><ProductArt type={r.product.artType} color={r.product.artColor} /></div><div><b>{r.product.name}</b><div className="muted" style={{ fontSize: 11 }}>{r.variant.sku} · now {r.stock}</div></div></div></td>
              <td style={{ width: 110 }}><input className="input num" style={{ height: 32 }} value={r.qty} onChange={(e) => setRows(rows.map((x) => (x.variant.id === r.variant.id ? { ...x, qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) } : x)))} /></td>
              <td style={{ width: 30 }}><button className="link faint" onClick={() => setRows(rows.filter((x) => x.variant.id !== r.variant.id))} aria-label="Remove"><Icon name="trash" size={16} /></button></td>
            </tr>
          ))}</tbody></table>
        )}
      </div>
    </Modal>
  );
}
