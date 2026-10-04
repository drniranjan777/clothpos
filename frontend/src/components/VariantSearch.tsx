import { useEffect, useRef, useState } from 'react';
import { get, Paged } from '../lib/api';
import { inr } from '../lib/format';
import { Icon } from './Icon';
import { ProductArt } from './ProductArt';
import { useDebounced } from './ui';

/** Row shape of GET /inventory/stock - one sellable variant with its stock in the chosen store. */
export interface StockRow {
  id: string;
  sku: string;
  barcode: string;
  size?: string;
  color?: string;
  productName: string;
  artType: string;
  artColor: string;
  stock: number;
  minStock: number;
  mrp: number;
  sellingPrice: number;
  purchasePrice: number;
  gstRate: number;
}

/**
 * Scan a barcode / type SKU (Enter adds the exact match) or search by product name and pick a variant.
 * Used by purchases and stock transfers.
 */
export function VariantSearch({ storeId, onPick, placeholder = 'Scan barcode, type SKU or search product…', autoFocus }: {
  storeId: string; onPick: (row: StockRow) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const q = useDebounced(text, 200);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setRows([]); return; }
    get<Paged<StockRow>>('/inventory/stock', { storeId, search: q.trim(), pageSize: 8 }).then((r) => { setRows(r.items); setActive(0); setOpen(true); }).catch(() => setRows([]));
  }, [q, storeId]);
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const pick = (r: StockRow) => { onPick(r); setText(''); setRows([]); setOpen(false); setErr(''); };
  const enter = async () => {
    const t = text.trim();
    if (!t) return;
    // a scanner types the barcode + Enter faster than the debounce: look it up directly
    const r = await get<Paged<StockRow>>('/inventory/stock', { storeId, search: t, pageSize: 8 }).catch(() => null);
    const exact = r?.items.find((x) => x.barcode === t || x.sku.toUpperCase() === t.toUpperCase());
    if (exact) pick(exact);
    else if (r?.items.length) { setRows(r.items); setOpen(true); pick(r.items[active] ?? r.items[0]); }
    else setErr(`Nothing found for "${t}"`);
  };

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <div className={`input ${err ? 'err' : ''}`}>
        <Icon name="barcode" size={16} />
        <input autoFocus={autoFocus} placeholder={placeholder} value={text}
          onChange={(e) => { setText(e.target.value); setErr(''); }}
          onFocus={() => rows.length && setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); enter(); }
            if (e.key === 'ArrowDown') setActive((a) => Math.min(rows.length - 1, a + 1));
            if (e.key === 'ArrowUp') setActive((a) => Math.max(0, a - 1));
            if (e.key === 'Escape') setOpen(false);
          }} />
      </div>
      {err && <span className="error" style={{ fontSize: 11.5, color: 'var(--red)' }}>{err}</span>}
      {open && rows.length > 0 && (
        <div className="menu" style={{ left: 0, right: 0, maxHeight: 320, overflow: 'auto' }}>
          {rows.map((r, i) => (
            <div key={r.id} className="mi" style={i === active ? { background: 'var(--blue-ll)' } : undefined} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
              <div className="thumb" style={{ width: 32, height: 32 }}><ProductArt type={r.artType} color={r.artColor} /></div>
              <div className="grow" style={{ minWidth: 0 }}><b>{r.productName}</b><div className="muted" style={{ fontSize: 11 }}>{[r.size, r.color].filter(Boolean).join(' · ')} · {r.sku}</div></div>
              <div style={{ textAlign: 'right', fontSize: 11.5 }}><b className="num">{r.stock}</b> in stock<div className="muted">cost {inr(r.purchasePrice)}</div></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
