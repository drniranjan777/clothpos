import { useEffect, useMemo, useState } from 'react';
import { Barcode } from '../components/Barcode';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { ART_TYPES, ProductArt } from '../components/ProductArt';
import { PrintPortal } from '../components/Receipt';
import { Empty, ErrorBox, Loading, Modal, Pager, StatusChip, Tabs, useDebounced, useLoad, useToast } from '../components/ui';
import { get, Paged, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, inr } from '../lib/format';

interface Row { id: string; name: string; code: string; category?: string; brand?: string; categoryId: string | null; artType: string; artColor: string; isActive: boolean; variants: number; stock: number; outVariants: number; minPrice: number; maxPrice: number; mrp: number; gstRate: number; hsnCode?: string; minStock: number }
interface Variant { id: string; sku: string; barcode: string; size?: string; color?: string; colorHex?: string; purchasePrice: number; mrp: number; sellingPrice: number; minStock: number | null; isActive: boolean; stockByStore: Record<string, number>; prices: Record<string, number> }
interface Detail { id: string; name: string; code: string; category?: string; brand?: string; gender?: string; season?: string; fabric?: string; hsnCode?: string; gstRate: number; artType: string; artColor: string; minStock: number; isActive: boolean; description?: string; categoryId: string | null; brandId: string | null; stores: { id: string; name: string; code: string }[]; priceLists: { id: string; name: string; isDefault: boolean }[]; variants: Variant[] }
interface Master { id: string; name: string; hex?: string }

export default function Products() {
  const { store } = useAuth();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const [selId, setSelId] = useState<string | null>(null);
  const [tab, setTab] = useState<'variants' | 'pricing' | 'details'>('variants');
  const [selVariant, setSelVariant] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editPrice, setEditPrice] = useState<Variant | null>(null);
  const [labels, setLabels] = useState<{ v: Variant; n: number } | null>(null);
  const [cats, setCats] = useState<Master[]>([]);
  const [brands, setBrands] = useState<Master[]>([]);

  useEffect(() => {
    get<Master[]>('/catalog/categories').then(setCats).catch(() => undefined);
    get<Master[]>('/catalog/brands').then(setBrands).catch(() => undefined);
  }, []);
  useEffect(() => setPage(1), [q, categoryId, brandId, status]);

  const list = useLoad(() => get<Paged<Row>>('/catalog/products', { search: q, categoryId, brandId, status, page, pageSize: 12 }), [q, categoryId, brandId, status, page]);
  useEffect(() => {
    if (!selId && list.data?.items[0]) setSelId(list.data.items[0].id);
  }, [list.data, selId]);
  const detail = useLoad(() => (selId ? get<Detail>(`/catalog/products/${selId}`) : Promise.resolve(null)), [selId]);
  const d = detail.data;

  const sizes = useMemo(() => [...new Set(d?.variants.map((v) => v.size ?? '—'))], [d]);
  const colors = useMemo(() => [...new Set(d?.variants.map((v) => v.color ?? '—'))], [d]);
  const sv = d?.variants.find((v) => v.id === selVariant) ?? d?.variants[0];
  const storeStock = (v: Variant) => (store ? v.stockByStore[store.id] ?? 0 : Object.values(v.stockByStore).reduce((a, b) => a + b, 0));
  const min = (v: Variant) => v.minStock ?? d?.minStock ?? 0;

  const toggleActive = async () => {
    if (!d) return;
    try {
      await patch(`/catalog/products/${d.id}`, { isActive: !d.isActive });
      toast(d.isActive ? 'Product hidden from POS' : 'Product active again', 'success');
      detail.reload(); list.reload();
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <>
      <Topbar crumb="Catalogue › Products" title="Products & Variants">
        {sv && <button className="btn" onClick={() => setLabels({ v: sv, n: Math.max(1, storeStock(sv)) })}><Icon name="barcode" />Print Barcode Labels</button>}
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add Product</button>
      </Topbar>
      <div className="content" style={{ flexDirection: 'row' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <div className="search" style={{ width: 280, background: '#fff' }}><Icon name="search" size={16} /><input placeholder="Name, SKU, barcode…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <select className="input" style={{ width: 180 }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select className="input" style={{ width: 160 }} value={brandId} onChange={(e) => setBrandId(e.target.value)}><option value="">All brands</option>{brands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <Tabs value={status} onChange={setStatus} options={[['active', 'Active'], ['inactive', 'Inactive'], ['', 'All']]} />
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {list.loading && !list.data ? <Loading /> : list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : list.data!.items.length === 0 ? <Empty icon="shirt" title="No products match" text="Change the filters or add a new product" /> : (
              <>
                <table className="t">
                  <thead><tr><th>Product</th><th>Category · Brand</th><th className="r">Stock</th><th className="r">MRP / Price</th><th>Status</th></tr></thead>
                  <tbody>{list.data!.items.map((p) => (
                    <tr key={p.id} className={`click ${p.id === selId ? 'sel' : ''}`} onClick={() => { setSelId(p.id); setSelVariant(null); }}>
                      <td><div className="row"><div className="thumb"><ProductArt type={p.artType} color={p.artColor} /></div><div><b>{p.name}</b><div className="muted" style={{ fontSize: 11 }}>{p.code}</div></div></div></td>
                      <td>{p.category ?? '—'}<div className="muted" style={{ fontSize: 11 }}>{p.brand}</div></td>
                      <td className="r num"><b>{p.stock}</b><div className="muted" style={{ fontSize: 11 }}>{p.variants} variant{p.variants === 1 ? '' : 's'}</div></td>
                      <td className="r num">{p.mrp > p.maxPrice && <span className="strike">{inr(p.mrp)} </span>}<b>{p.minPrice === p.maxPrice ? inr(p.minPrice) : `${inr(p.minPrice)}+`}</b><div className="muted" style={{ fontSize: 11 }}>GST {p.gstRate}% · HSN {p.hsnCode ?? '—'}</div></td>
                      <td>{!p.isActive ? <StatusChip status="inactive" /> : p.stock <= 0 ? <span className="chip red">Out of stock</span> : p.outVariants > 0 ? <span className="chip amber">{p.outVariants} sizes out</span> : <StatusChip status="active" />}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <Pager page={list.data!.page} pages={list.data!.pages} total={list.data!.total} pageSize={list.data!.pageSize} onPage={setPage} />
              </>
            )}
          </div>
        </div>

        <div className="card" style={{ width: 420, flex: 'none', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          {!d ? (detail.loading ? <Loading /> : <Empty icon="shirt" title="Select a product" />) : (
            <>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--line)' }} className="row">
                <div className="thumb lg" style={{ width: 64, height: 64, borderRadius: 12 }}><ProductArt type={d.artType} color={d.artColor} /></div>
                <div className="grow" style={{ minWidth: 0 }}><b style={{ fontSize: 15 }}>{d.name}</b><div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{d.code} · {d.category} {d.brand && `· ${d.brand}`}</div>
                  <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>{d.season && <span className="chip blue nodot">{d.season}</span>}{d.fabric && <span className="chip gray nodot">{d.fabric}</span>}{d.gender && <span className="chip gray nodot">{d.gender}</span>}<span className="chip gray nodot">GST {d.gstRate}%</span></div></div>
                <button className="iconbtn" title={d.isActive ? 'Deactivate' : 'Activate'} onClick={toggleActive}><Icon name={d.isActive ? 'ban' : 'check'} /></button>
              </div>
              <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Tabs value={tab} onChange={setTab} options={[['variants', 'Variants'], ['pricing', 'Pricing'], ['details', 'Details']]} />
                {tab === 'variants' && (
                  <>
                    <div className="row between"><b>Size × Colour matrix</b><span className="muted" style={{ fontSize: 11.5 }}>stock at {store?.name ?? 'all stores'}</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: `86px repeat(${sizes.length}, 1fr)`, gap: 6, fontSize: 12 }}>
                      <span />{sizes.map((s) => <span key={s} className="muted" style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 600 }}>{s.replace('UK ', '')}</span>)}
                      {colors.map((c) => (
                        <div key={c} style={{ display: 'contents' }}>
                          <span className="row" style={{ gap: 7, fontWeight: 600 }}><i style={{ width: 12, height: 12, borderRadius: 4, border: '1px solid rgba(0,0,0,.15)', background: d.variants.find((v) => v.color === c)?.colorHex }} />{c}</span>
                          {sizes.map((s) => {
                            const v = d.variants.find((x) => (x.color ?? '—') === c && (x.size ?? '—') === s);
                            if (!v) return <span key={s} />;
                            const st = storeStock(v);
                            const tone = st <= 0 ? { background: 'var(--red-l)', color: 'var(--red)', borderColor: '#f8cdb8' } : st <= min(v) ? { background: 'var(--amber-l)', color: 'var(--amber)', borderColor: '#f6d9a8' } : {};
                            const sel = sv?.id === v.id;
                            return <button key={s} onClick={() => setSelVariant(v.id)} title={v.sku} style={{ height: 40, borderRadius: 8, border: sel ? '2px solid var(--blue)' : '1px solid var(--line)', fontWeight: 700, background: sel ? 'var(--blue-ll)' : '#fff', opacity: v.isActive ? 1 : 0.4, ...tone }}>{st}</button>;
                          })}
                        </div>
                      ))}
                    </div>
                    {sv && (
                      <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>
                        <div className="row between"><div><b>Variant {sv.sku}</b><div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{[sv.color, sv.size].filter(Boolean).join(' · ')} · Min stock {min(sv)}</div></div>
                          <span className={`chip ${storeStock(sv) <= 0 ? 'red' : storeStock(sv) <= min(sv) ? 'amber' : 'green'}`}>{storeStock(sv)} in stock</span></div>
                        <div className="row" style={{ marginTop: 12, gap: 14 }}>
                          <Barcode value={sv.barcode} />
                          <div className="grow" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                            <div><span className="muted">Purchase</span><br /><b className="num">{inr(sv.purchasePrice, true)}</b></div>
                            <div><span className="muted">MRP</span><br /><b className="num">{inr(sv.mrp, true)}</b></div>
                            <div><span className="muted">Selling</span><br /><b className="num" style={{ color: 'var(--blue)' }}>{inr(sv.sellingPrice, true)}</b></div>
                            <div><span className="muted">Margin</span><br /><b className="num" style={{ color: 'var(--green)' }}>{(((sv.sellingPrice / (1 + d.gstRate / 100) - sv.purchasePrice) / (sv.sellingPrice / (1 + d.gstRate / 100))) * 100).toFixed(1)}%</b></div>
                          </div>
                        </div>
                        {d.stores.length > 1 && <div className="row" style={{ gap: 10, marginTop: 10, fontSize: 11.5, flexWrap: 'wrap' }}>{d.stores.map((s) => <span key={s.id} className="chip gray nodot">{s.code}: {sv.stockByStore[s.id] ?? 0}</span>)}</div>}
                      </div>
                    )}
                    <div className="row" style={{ gap: 8 }}>
                      {sv && <button className="btn grow" style={{ justifyContent: 'center' }} onClick={() => setLabels({ v: sv, n: Math.max(1, storeStock(sv)) })}><Icon name="printer" />Print labels</button>}
                      {sv && <button className="btn primary grow" style={{ justifyContent: 'center' }} onClick={() => setEditPrice(sv)}><Icon name="edit" />Edit prices</button>}
                    </div>
                  </>
                )}
                {tab === 'pricing' && (
                  <table className="t">
                    <thead><tr><th>Variant</th><th className="r">MRP</th>{d.priceLists.map((pl) => <th key={pl.id} className="r">{pl.isDefault ? 'Retail' : pl.name.split(' ')[0]}</th>)}</tr></thead>
                    <tbody>{d.variants.map((v) => (
                      <tr key={v.id} className="click" onClick={() => setEditPrice(v)}><td><b>{[v.size, v.color].filter(Boolean).join(' · ')}</b></td><td className="r num">{inr(v.mrp)}</td>{d.priceLists.map((pl) => <td key={pl.id} className="r num">{inr(pl.isDefault ? v.sellingPrice : v.prices[pl.id] ?? v.sellingPrice)}</td>)}</tr>
                    ))}</tbody>
                  </table>
                )}
                {tab === 'details' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', fontSize: 12.5 }}>
                    {[['Product code', d.code], ['HSN code', d.hsnCode], ['GST rate', `${d.gstRate}% (price includes GST)`], ['Category', d.category], ['Brand', d.brand], ['Gender', d.gender], ['Season', d.season], ['Fabric', d.fabric], ['Default min stock', d.minStock], ['Variants', d.variants.length]].map(([k, v]) => (
                      <div key={String(k)}><span className="muted">{k}</span><br /><b>{v ?? '—'}</b></div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {adding && <AddProduct cats={cats} brands={brands} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); list.reload(); setSelId(id); toast('Product created with barcodes', 'success'); }} />}
      {editPrice && d && <EditVariant v={editPrice} gstRate={d.gstRate} onClose={() => setEditPrice(null)} onSaved={() => { setEditPrice(null); detail.reload(); list.reload(); }} />}
      {labels && d && <LabelDialog product={d} variant={labels.v} count={labels.n} onClose={() => setLabels(null)} />}
    </>
  );
}

// ------------------------------------------------------------ add product with size × colour variant generator
const SIZE_SETS: Record<string, string[]> = { Apparel: ['S', 'M', 'L', 'XL', '2XL'], Waist: ['28', '30', '32', '34', '36'], Footwear: ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10'], 'Free size': ['Free'] };
function AddProduct({ cats, brands, onClose, onSaved }: { cats: Master[]; brands: Master[]; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [colorsMaster, setColorsMaster] = useState<Master[]>([]);
  const [f, setF] = useState({ name: '', categoryId: cats[0]?.id ?? '', brandId: '', hsnCode: '', gstRate: 5, season: '', fabric: '', gender: '', artType: 'tshirt', minStock: 4 });
  const [sizes, setSizes] = useState<string[]>(SIZE_SETS.Apparel.slice(0, 4));
  const [colors, setColors] = useState<string[]>([]);
  const [price, setPrice] = useState({ purchasePrice: '', mrp: '', sellingPrice: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { get<Master[]>('/catalog/colors').then((c) => { setColorsMaster(c); setColors(c.slice(0, 1).map((x) => x.name)); }).catch(() => undefined); }, []);
  const toggle = (arr: string[], set: (v: string[]) => void, v: string) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const n = sizes.length * Math.max(1, colors.length);
  const valid = f.name.trim().length >= 2 && sizes.length > 0 && colors.length > 0 && Number(price.mrp) > 0 && Number(price.sellingPrice) > 0 && Number(price.sellingPrice) <= Number(price.mrp);
  // the 2025 GST rule for apparel: ≤ ₹2,500 → 5 %, above → 18 %
  useEffect(() => { const p = Number(price.sellingPrice); if (p > 0) setF((x) => ({ ...x, gstRate: p > 2500 ? 18 : 5 })); }, [price.sellingPrice]);

  const save = async () => {
    setBusy(true);
    try {
      const firstHex = colorsMaster.find((c) => c.name === colors[0])?.hex;
      const r = await post<{ id: string }>('/catalog/products', {
        name: f.name.trim(), categoryId: f.categoryId || undefined, brandId: f.brandId || undefined, hsnCode: f.hsnCode || undefined, gstRate: Number(f.gstRate),
        season: f.season || undefined, fabric: f.fabric || undefined, gender: f.gender || undefined, artType: f.artType, artColor: firstHex, minStock: Number(f.minStock),
        variants: colors.flatMap((c) => sizes.map((s) => ({ size: s, color: c, colorHex: colorsMaster.find((x) => x.name === c)?.hex, purchasePrice: Number(price.purchasePrice) || 0, mrp: Number(price.mrp), sellingPrice: Number(price.sellingPrice) }))),
      });
      onSaved(r.id);
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  };
  return (
    <Modal title="Add product" icon="shirt" sub="Each size × colour becomes its own SKU with a printable EAN-13 barcode" onClose={onClose} width={720}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={save}>{busy ? 'Saving…' : `Create product · ${n} variant${n === 1 ? '' : 's'}`}</button></>}>
      <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
        <div style={{ width: 120, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="thumb lg" style={{ width: 120, height: 120, borderRadius: 14 }}><ProductArt type={f.artType} color={colorsMaster.find((c) => c.name === colors[0])?.hex} /></div>
          <select className="input" value={f.artType} onChange={(e) => setF({ ...f, artType: e.target.value })} aria-label="Illustration">{ART_TYPES.map((a) => <option key={a}>{a}</option>)}</select>
        </div>
        <div className="form-grid grow">
          <div className="field full"><label>Product name *</label><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Linen Mandarin Shirt" /></div>
          <div className="field"><label>Category</label><select className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label>Brand</label><select className="input" value={f.brandId} onChange={(e) => setF({ ...f, brandId: e.target.value })}><option value="">—</option>{brands.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="field"><label>HSN code</label><input className="input" value={f.hsnCode} onChange={(e) => setF({ ...f, hsnCode: e.target.value.replace(/\D/g, '').slice(0, 8) })} placeholder="6205" /></div>
          <div className="field"><label>GST rate</label><select className="input" value={f.gstRate} onChange={(e) => setF({ ...f, gstRate: Number(e.target.value) })}>{[0, 3, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select><span className="hint">Auto: apparel ≤ ₹2,500 → 5%, above → 18%</span></div>
          <div className="field"><label>Season</label><input className="input" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} placeholder="AW-26" /></div>
          <div className="field"><label>Fabric</label><input className="input" value={f.fabric} onChange={(e) => setF({ ...f, fabric: e.target.value })} placeholder="Cotton" /></div>
        </div>
      </div>
      <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field"><label>Sizes</label>
          <div className="row" style={{ gap: 6, marginBottom: 4 }}>{Object.entries(SIZE_SETS).map(([k, v]) => <button key={k} className="btn sm" onClick={() => setSizes(v)}>{k}</button>)}</div>
          <div className="pill-row">{[...new Set([...Object.values(SIZE_SETS).flat()])].map((s) => <span key={s} className={sizes.includes(s) ? 'on' : ''} onClick={() => toggle(sizes, setSizes, s)}>{s}</span>)}</div></div>
        <div className="field"><label>Colours</label>
          <div className="pill-row">{colorsMaster.map((c) => <span key={c.id} className={colors.includes(c.name) ? 'on' : ''} onClick={() => toggle(colors, setColors, c.name)}><i style={{ width: 10, height: 10, borderRadius: 3, background: c.hex, marginRight: 6, border: '1px solid rgba(0,0,0,.15)' }} />{c.name}</span>)}</div></div>
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="field"><label>Purchase price</label><input className="input num" inputMode="decimal" value={price.purchasePrice} onChange={(e) => setPrice({ ...price, purchasePrice: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <div className="field"><label>MRP *</label><input className="input num" inputMode="decimal" value={price.mrp} onChange={(e) => setPrice({ ...price, mrp: e.target.value.replace(/[^\d.]/g, '') })} /></div>
          <div className="field"><label>Selling price *</label><input className={`input num ${Number(price.sellingPrice) > Number(price.mrp) ? 'err' : ''}`} inputMode="decimal" value={price.sellingPrice} onChange={(e) => setPrice({ ...price, sellingPrice: e.target.value.replace(/[^\d.]/g, '') })} />
            {Number(price.sellingPrice) > Number(price.mrp) && <span className="error">Cannot exceed MRP</span>}</div>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Same prices are applied to all {n} variants — adjust individual sizes afterwards from the matrix.</span>
      </div>
    </Modal>
  );
}

function EditVariant({ v, gstRate, onClose, onSaved }: { v: Variant; gstRate: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ purchasePrice: String(v.purchasePrice), mrp: String(v.mrp), sellingPrice: String(v.sellingPrice), minStock: v.minStock === null ? '' : String(v.minStock) });
  const [busy, setBusy] = useState(false);
  const bad = Number(f.sellingPrice) > Number(f.mrp);
  const save = async () => {
    setBusy(true);
    try {
      await patch(`/catalog/variants/${v.id}`, { purchasePrice: Number(f.purchasePrice), mrp: Number(f.mrp), sellingPrice: Number(f.sellingPrice), minStock: f.minStock === '' ? null : Number(f.minStock) });
      toast('Prices updated (recorded in audit log)', 'success');
      onSaved();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={`Edit ${v.sku}`} sub={`${[v.size, v.color].filter(Boolean).join(' · ')} · GST ${gstRate}% included`} icon="tag" onClose={onClose} width={460}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={bad || busy} onClick={save}>Save prices</button></>}>
      <div className="form-grid">
        {(['purchasePrice', 'mrp', 'sellingPrice', 'minStock'] as const).map((k) => (
          <div className="field" key={k}><label>{{ purchasePrice: 'Purchase price', mrp: 'MRP', sellingPrice: 'Selling price', minStock: 'Min stock (blank = product default)' }[k]}</label>
            <input className={`input num ${k === 'sellingPrice' && bad ? 'err' : ''}`} inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^\d.]/g, '') })} /></div>
        ))}
      </div>
      {bad && <div className="error" style={{ marginTop: 8, color: 'var(--red)', fontSize: 12 }}>Selling price cannot exceed MRP</div>}
    </Modal>
  );
}

function LabelDialog({ product, variant, count, onClose }: { product: Detail; variant: Variant; count: number; onClose: () => void }) {
  const [n, setN] = useState(String(count));
  const [printing, setPrinting] = useState(false);
  const label = (
    <div style={{ width: 190, border: '1px dashed #cbd5e1', borderRadius: 6, padding: '6px 8px', fontFamily: 'Inter, sans-serif', fontSize: 10, color: '#0f172a', breakInside: 'avoid' }}>
      <b style={{ fontSize: 10.5 }}>{product.name}</b>
      <div className="row between" style={{ fontSize: 9.5 }}><span>{[variant.size, variant.color].filter(Boolean).join(' · ')}</span><span>{variant.sku}</span></div>
      <div style={{ margin: '3px 0' }}><Barcode value={variant.barcode} height={34} module={1.3} /></div>
      <div className="row between"><span>MRP <s>₹{variant.mrp}</s></span><b style={{ fontSize: 12 }}>₹{variant.sellingPrice}</b></div>
      <div style={{ fontSize: 8, color: '#64748b' }}>Incl. of all taxes · {fmtDateTime(new Date()).split(' · ')[0]}</div>
    </div>
  );
  const qty = Math.min(200, Math.max(1, Number(n) || 1));
  return (
    <Modal title="Print barcode labels" icon="barcode" sub={`${product.name} · ${variant.sku}`} onClose={onClose} width={480}
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" onClick={() => setPrinting(true)}><Icon name="printer" />Print {qty} label{qty === 1 ? '' : 's'}</button></>}>
      <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
        {label}
        <div className="field grow"><label>Number of labels</label><input className="input num" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ''))} /><span className="hint">Defaults to the stock on hand. Works with A4 label sheets or a label printer (38 × 25 mm).</span></div>
      </div>
      {printing && <PrintPortal onDone={() => setPrinting(false)}><div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 8 }}>{Array.from({ length: qty }, (_, i) => <div key={i}>{label}</div>)}</div></PrintPortal>}
    </Modal>
  );
}
