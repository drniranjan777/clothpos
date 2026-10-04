import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { ProductArt } from '../components/ProductArt';
import { Empty, ErrorBox, Loading, Modal, Pager, StatusChip, Tabs, useDebounced, useLoad, useToast } from '../components/ui';
import { api, get, Paged, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { inr } from '../lib/format';

interface Business { businessName: string; ownerName: string; mobile: string; email: string; gstin?: string; address?: string; city?: string; state?: string; stateCode?: string }
interface Rules { allowNegativeStock: boolean; cashierDiscountLimitPct: number; returnWindowDays: number; roundOff: boolean; invoiceFooter: string; receiptWidth: 58 | 80; loyaltyPointsPer100: number; cashVarianceTolerance: number }
interface StoreRow { id: string; name: string; code: string; invoicePrefix: string; address?: string; phone?: string; gstin?: string; stateCode?: string; counters: number; isActive: boolean; invoiceSeq: number }
interface SettingsData { business: Business; rules: Rules; stores: StoreRow[]; limits: { maxStores: number | null; modules: string[] } }
type Tab = 'business' | 'rules' | 'stores' | 'prices';

export default function Settings() {
  const { can, reload: reloadMe } = useAuth();
  const isOwner = can('tenant_admin');
  const [tab, setTab] = useState<Tab>('business');
  const { data, error, loading, reload, setData } = useLoad(() => get<SettingsData>('/settings'), []);
  const saved = (d: SettingsData) => { setData(d); reloadMe(); };
  return (
    <>
      <Topbar crumb="Administration › Settings" title="Settings">
        <Tabs value={tab} onChange={setTab} options={[['business', 'Business'], ['rules', 'Billing rules'], ['stores', 'Stores'], ['prices', 'Price lists']]} />
      </Topbar>
      <div className="content">
        {!isOwner && tab !== 'prices' && <div className="card" style={{ padding: '10px 14px', fontSize: 12.5 }}><Icon name="lock" size={14} /> Read-only: only the owner can change business settings.</div>}
        {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data && (
          tab === 'business' ? <BusinessTab data={data} editable={isOwner} onSaved={saved} />
            : tab === 'rules' ? <RulesTab data={data} editable={isOwner} onSaved={saved} />
              : tab === 'stores' ? <StoresTab data={data} editable={isOwner} onChanged={() => { reload(); reloadMe(); }} />
                : <PriceListsTab />
        )}
      </div>
    </>
  );
}

function BusinessTab({ data, editable, onSaved }: { data: SettingsData; editable: boolean; onSaved: (d: SettingsData) => void }) {
  const toast = useToast();
  const [f, setF] = useState<Business>(data.business);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Business, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || undefined : v]));
      onSaved(await patch<SettingsData>('/settings/business', body));
      toast('Business details saved - new invoices use them', 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  return (
    <div className="card" style={{ padding: 20, maxWidth: 820 }}>
      <b style={{ fontSize: 15 }}>Business profile</b>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>Printed on tax invoices and receipts. The GSTIN's first two digits decide CGST + SGST vs IGST.</div>
      <fieldset disabled={!editable} style={{ border: 0, marginTop: 16 }}>
        <div className="form-grid">
          <div className="field"><label>Business / trade name</label><input className="input" value={f.businessName} onChange={(e) => set('businessName', e.target.value)} /></div>
          <div className="field"><label>GSTIN</label><input className="input" value={f.gstin ?? ''} onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))} /></div>
          <div className="field"><label>Owner name</label><input className="input" value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} /></div>
          <div className="field"><label>Mobile</label><input className="input num" value={f.mobile} onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))} /></div>
          <div className="field"><label>Email</label><input className="input" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
          <div className="field"><label>City</label><input className="input" value={f.city ?? ''} onChange={(e) => set('city', e.target.value)} /></div>
          <div className="field full"><label>Registered address</label><input className="input" value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} /></div>
          <div className="field"><label>State</label><input className="input" value={f.state ?? ''} onChange={(e) => set('state', e.target.value)} /></div>
          <div className="field"><label>GST state code</label><input className="input num" value={f.stateCode ?? ''} onChange={(e) => set('stateCode', e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder="29 = Karnataka" /></div>
        </div>
      </fieldset>
      {editable && <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}><button className="btn primary" disabled={busy} onClick={save}>Save business details</button></div>}
    </div>
  );
}

function RulesTab({ data, editable, onSaved }: { data: SettingsData; editable: boolean; onSaved: (d: SettingsData) => void }) {
  const toast = useToast();
  const [r, setR] = useState<Rules>(data.rules);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      onSaved(await patch<SettingsData>('/settings/rules', { ...r, cashierDiscountLimitPct: Number(r.cashierDiscountLimitPct), returnWindowDays: Number(r.returnWindowDays), loyaltyPointsPer100: Number(r.loyaltyPointsPer100), cashVarianceTolerance: Number(r.cashVarianceTolerance) }));
      toast('Billing rules saved - they apply to the next bill', 'success');
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  // plain render helpers (not components) so inputs keep focus while typing
  const toggle = (k: 'allowNegativeStock' | 'roundOff', title: string, text: string) => (
    <div className="row" style={{ gap: 14, padding: '12px 0', borderBottom: '1px solid var(--line-2)' }}>
      <div className="grow"><b>{title}</b><div className="muted" style={{ fontSize: 12 }}>{text}</div></div>
      <span className={`toggle ${r[k] ? 'on' : ''}`} style={editable ? undefined : { pointerEvents: 'none' }} onClick={() => setR({ ...r, [k]: !r[k] })} role="switch" aria-checked={r[k]} />
    </div>
  );
  const num = (k: 'cashierDiscountLimitPct' | 'returnWindowDays' | 'loyaltyPointsPer100' | 'cashVarianceTolerance', title: string, text: string, suffix: string) => (
    <div className="row" style={{ gap: 14, padding: '12px 0', borderBottom: '1px solid var(--line-2)' }}>
      <div className="grow"><b>{title}</b><div className="muted" style={{ fontSize: 12 }}>{text}</div></div>
      <div className="input" style={{ width: 150 }}><input className="num" disabled={!editable} value={String(r[k])} onChange={(e) => setR({ ...r, [k]: e.target.value.replace(/[^\d.]/g, '') as unknown as number })} /><span className="muted" style={{ fontSize: 12 }}>{suffix}</span></div>
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: '6px 20px 14px' }}>
        <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Billing</h3>
        {num("cashierDiscountLimitPct", "Cashier discount limit", "Discounts above this need a manager or owner", "% of bill")}
        {toggle("roundOff", "Round bills to the nearest rupee", "The round-off is shown on the invoice")}
        {toggle("allowNegativeStock", "Allow selling below zero stock", "Off = the POS blocks items you don't have. Offline sales always sync and are flagged.")}
        {num("loyaltyPointsPer100", "Loyalty points", "Points a customer earns for every ₹100 billed (0 = off)", "per ₹100")}
      </div>
      <div className="card" style={{ padding: '6px 20px 14px' }}>
        <h3 style={{ fontSize: 14, margin: '12px 0 4px' }}>Returns, cash &amp; receipts</h3>
        {num("returnWindowDays", "Return / exchange window", "Older invoices need a manager", "days")}
        {num("cashVarianceTolerance", "Cash variance tolerance", "Shift can close without a note within this difference", "₹")}
        <div className="row" style={{ gap: 14, padding: '12px 0', borderBottom: '1px solid var(--line-2)' }}>
          <div className="grow"><b>Receipt paper</b><div className="muted" style={{ fontSize: 12 }}>Default thermal printer width</div></div>
          <Tabs value={String(r.receiptWidth) as '58' | '80'} onChange={(v) => editable && setR({ ...r, receiptWidth: Number(v) as 58 | 80 })} options={[['58', '58 mm'], ['80', '80 mm']]} />
        </div>
        <div className="field" style={{ padding: '12px 0' }}><label>Receipt footer</label><input className="input" disabled={!editable} value={r.invoiceFooter} onChange={(e) => setR({ ...r, invoiceFooter: e.target.value })} /></div>
      </div>
      {editable && <div className="row" style={{ gridColumn: '1/-1', justifyContent: 'flex-end' }}><button className="btn primary" disabled={busy} onClick={save}>Save billing rules</button></div>}
    </div>
  );
}

function StoresTab({ data, editable, onChanged }: { data: SettingsData; editable: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<Partial<StoreRow> | null>(null);
  const active = data.stores.filter((s) => s.isActive).length;
  const max = data.limits.maxStores;
  const multi = data.limits.modules.includes('multi_store');
  const canAdd = editable && (max == null || active < max) && (active === 0 || multi);
  return (
    <>
      <div className="row"><span className="muted" style={{ fontSize: 12.5 }}>{active}{max ? ` of ${max}` : ''} stores on your plan{!multi && ' · multi-store is not in your plan'}</span><div className="grow" />
        {editable && <button className="btn primary" disabled={!canAdd} onClick={() => setEditing({ counters: 1 })}><Icon name="plus" />Add store</button>}</div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="t">
          <thead><tr><th>Store</th><th>Invoice prefix</th><th>Counters</th><th>Address</th><th className="r">Invoices</th><th>Status</th><th /></tr></thead>
          <tbody>{data.stores.map((s) => (
            <tr key={s.id}><td><b>{s.name}</b><div className="muted" style={{ fontSize: 11 }}>Code {s.code}{s.gstin ? ` · ${s.gstin}` : ''}</div></td>
              <td className="num">{s.invoicePrefix}-YYYY-00001</td><td className="num">{s.counters}</td>
              <td style={{ whiteSpace: 'normal', maxWidth: 260, fontSize: 12 }}>{s.address}{s.phone ? ` · ${s.phone}` : ''}</td>
              <td className="r num">{s.invoiceSeq}</td><td><StatusChip status={s.isActive ? 'active' : 'inactive'} /></td>
              <td className="r">{editable && <button className="btn sm" onClick={() => setEditing(s)}><Icon name="edit" />Edit</button>}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {editing && <StoreForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />}
    </>
  );
}

function StoreForm({ initial, onClose, onSaved }: { initial: Partial<StoreRow>; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = !initial.id;
  const [f, setF] = useState({ name: initial.name ?? '', code: initial.code ?? '', invoicePrefix: initial.invoicePrefix ?? '', address: initial.address ?? '', phone: initial.phone ?? '', gstin: initial.gstin ?? '', counters: String(initial.counters ?? 1) });
  const [active, setActive] = useState(initial.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const save = async () => {
    setBusy(true);
    const body: Record<string, unknown> = { name: f.name.trim(), invoicePrefix: f.invoicePrefix || undefined, address: f.address || undefined, phone: f.phone || undefined, gstin: f.gstin || undefined, counters: Number(f.counters) || 1 };
    try {
      if (isNew) await post('/stores', { ...body, code: f.code });
      else await patch(`/stores/${initial.id}`, { ...body, isActive: active });
      toast(isNew ? `${f.name} added - assign staff to it in Staff & Roles` : 'Store updated', 'success');
      onSaved();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Add store' : `Edit ${initial.name}`} icon="store" onClose={onClose} width={560}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || f.name.trim().length < 2 || (isNew && !/^[A-Z]{2,4}$/.test(f.code))} onClick={save}>Save store</button></>}>
      <div className="form-grid">
        <div className="field"><label>Store name *</label><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Koramangala Store" /></div>
        <div className="field"><label>Store code *</label><input className="input" disabled={!isNew} value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))} placeholder="KR" /><span className="hint">2–4 letters, used on transfers and returns</span></div>
        <div className="field"><label>Invoice prefix</label><input className="input" value={f.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder={f.code || 'same as code'} /><span className="hint">{(f.invoicePrefix || f.code || 'KR')}-{new Date().getFullYear()}-00001 · numbering never repeats</span></div>
        <div className="field"><label>Billing counters</label><input className="input num" value={f.counters} onChange={(e) => set('counters', e.target.value.replace(/\D/g, '').slice(0, 2))} /></div>
        <div className="field full"><label>Address (printed on receipts)</label><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></div>
        <div className="field"><label>Phone</label><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></div>
        <div className="field"><label>Store GSTIN (if different)</label><input className="input" value={f.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase().slice(0, 15))} /></div>
        {!isNew && <div className="field"><label>Status</label><label className="row" style={{ gap: 8, height: 38, cursor: 'pointer' }}><span className={`toggle ${active ? 'on' : ''}`} onClick={() => setActive(!active)} />{active ? 'Open for billing' : 'Closed'}</label></div>}
      </div>
    </Modal>
  );
}

interface ListRow { id: string; name: string; isDefault: boolean; isActive: boolean; priceCount: number }
interface PriceRow { variantId: string; sku: string; size?: string; color?: string; productName: string; artType: string; artColor: string; mrp: number; sellingPrice: number; purchasePrice: number; gstRate: number; listPrice: number | null }

function PriceListsTab() {
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can('tenant_admin', 'store_manager');
  const lists = useLoad(() => get<ListRow[]>('/price-lists'), []);
  const [sel, setSel] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [page, setPage] = useState(1);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [rule, setRule] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (!sel && lists.data) setSel(lists.data.find((l) => !l.isDefault)?.id ?? lists.data[0]?.id ?? null); }, [lists.data, sel]);
  useEffect(() => { setPage(1); setEdits({}); }, [sel, q]);
  const list = lists.data?.find((l) => l.id === sel);
  const prices = useLoad(() => (sel ? get<Paged<PriceRow>>(`/price-lists/${sel}/prices`, { search: q, page, pageSize: 15 }) : Promise.resolve(null)), [sel, q, page]);
  const dirty = Object.keys(edits).length;
  const saveEdits = async () => {
    try {
      const r = await api<{ set: number; removed: number }>(`/price-lists/${sel}/prices`, { method: 'PUT', body: { items: Object.entries(edits).map(([variantId, v]) => ({ variantId, price: v === '' ? null : Number(v) })) } });
      toast(`${r.set} prices saved${r.removed ? `, ${r.removed} reset to selling price` : ''}`, 'success');
      setEdits({}); prices.reload(); lists.reload();
    } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, alignItems: 'start' }}>
      <div className="card" style={{ padding: 8 }}>
        {lists.loading && !lists.data ? <Loading /> : lists.data?.map((l) => (
          <div key={l.id} className="mi row" style={{ padding: '10px 12px', borderRadius: 9, cursor: 'pointer', background: l.id === sel ? 'var(--blue-ll)' : undefined }} onClick={() => setSel(l.id)}>
            <Icon name="tag" size={16} /><div className="grow"><b>{l.name}</b><div className="muted" style={{ fontSize: 11 }}>{l.isDefault ? 'Product selling prices' : `${l.priceCount} custom prices`}</div></div>
            {!l.isActive && <span className="chip gray nodot">Off</span>}
          </div>
        ))}
        {canEdit && <button className="btn block" style={{ marginTop: 8 }} onClick={() => setCreating(true)}><Icon name="plus" />New price list</button>}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {!list ? <Empty icon="tag" title="Select a price list" /> : <>
          <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
            <div className="grow"><b style={{ fontSize: 15 }}>{list.name}</b><div className="muted" style={{ fontSize: 12 }}>{list.isDefault ? 'The default list uses each product\'s selling price - edit those on the Products page.' : 'Cashiers pick this list on the POS; items without a custom price use the normal selling price.'}</div></div>
            <div className="search" style={{ width: 220, height: 34 }}><Icon name="search" size={15} /><input placeholder="Product or SKU" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            {canEdit && !list.isDefault && <>
              <button className="btn sm" onClick={() => setRule(true)}><Icon name="percent" />Apply rule</button>
              <button className="btn sm" onClick={async () => { await patch(`/price-lists/${list.id}`, { name: list.name, isActive: !list.isActive }); lists.reload(); }}>{list.isActive ? 'Turn off' : 'Turn on'}</button>
            </>}
          </div>
          {prices.loading && !prices.data ? <Loading /> : prices.error ? <ErrorBox error={prices.error} /> : prices.data && <>
            <table className="t">
              <thead><tr><th>Item</th><th className="r">Cost</th><th className="r">MRP</th><th className="r">Selling</th><th className="r" style={{ width: 150 }}>{list.isDefault ? 'Price' : 'List price'}</th><th className="r">Margin</th></tr></thead>
              <tbody>{prices.data.items.map((r) => {
                const v = edits[r.variantId] ?? (r.listPrice != null ? String(r.listPrice) : '');
                const eff = v === '' ? r.sellingPrice : Number(v);
                const net = eff / (1 + r.gstRate / 100); // selling prices include GST
                const margin = net ? ((net - r.purchasePrice) / net) * 100 : 0;
                return (
                  <tr key={r.variantId}>
                    <td><div className="row"><div className="thumb"><ProductArt type={r.artType} color={r.artColor} /></div><div><b>{r.productName}</b><div className="muted" style={{ fontSize: 11 }}>{[r.size, r.color].filter(Boolean).join(' · ')} · {r.sku}</div></div></div></td>
                    <td className="r num">{inr(r.purchasePrice)}</td><td className="r num">{inr(r.mrp)}</td><td className="r num">{inr(r.sellingPrice)}</td>
                    <td className="r">{list.isDefault || !canEdit ? <b className="num">{inr(eff)}</b>
                      : <input className={`input num ${Number(v) > r.mrp ? 'err' : ''}`} style={{ height: 32, width: 110, marginLeft: 'auto', textAlign: 'right' }} placeholder={String(r.sellingPrice)} value={v} onChange={(e) => setEdits({ ...edits, [r.variantId]: e.target.value.replace(/[^\d.]/g, '') })} />}</td>
                    <td className={`r num ${margin < 15 ? 'down' : ''}`}>{margin.toFixed(0)}%</td>
                  </tr>
                );
              })}</tbody>
            </table>
            <Pager {...prices.data} onPage={setPage} />
          </>}
          {dirty > 0 && <div className="row" style={{ padding: '10px 16px', background: 'var(--amber-l)', borderTop: '1px solid #f6d9a8' }}><b className="grow">{dirty} unsaved price{dirty === 1 ? '' : 's'} · blank resets to the selling price</b><button className="btn sm" onClick={() => setEdits({})}>Discard</button><button className="btn sm primary" onClick={saveEdits}>Save prices</button></div>}
        </>}
      </div>
      {rule && list && <RuleModal list={list} onClose={() => setRule(false)} onDone={() => { setRule(false); prices.reload(); lists.reload(); }} />}
      {creating && <NewListModal onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); lists.reload(); setSel(id); }} />}
    </div>
  );
}

function RuleModal({ list, onClose, onDone }: { list: ListRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const cats = useLoad(() => get<{ id: string; name: string }[]>('/catalog/categories'), []);
  const [basis, setBasis] = useState<'selling' | 'mrp'>('selling');
  const [pct, setPct] = useState('10');
  const [categoryId, setCategoryId] = useState('');
  const [roundTo9, setRoundTo9] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const r = await post<{ set: number }>(`/price-lists/${list.id}/apply-rule`, { basis, percentOff: Number(pct), categoryId: categoryId || undefined, roundTo9 });
      toast(`${r.set} prices set on ${list.name}`, 'success');
      onDone();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  const example = Math.max(9, (() => { const p = (basis === 'mrp' ? 1499 : 999) * (1 - Number(pct || 0) / 100); return roundTo9 ? Math.floor(p / 10) * 10 - 1 : Math.round(p); })());
  return (
    <Modal title={`Price rule · ${list.name}`} icon="percent" sub="Sets a price on every matching item - you can still fine-tune individual prices afterwards" onClose={onClose} width={480}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !(Number(pct) >= 0)} onClick={go}>Apply to {categoryId ? 'category' : 'all items'}</button></>}>
      <div className="form-grid">
        <div className="field"><label>Discount (%)</label><input className="input num" autoFocus value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ''))} /></div>
        <div className="field"><label>Off the</label><Tabs value={basis} onChange={setBasis} options={[['selling', 'Selling price'], ['mrp', 'MRP']]} /></div>
        <div className="field full"><label>Only this category</label><select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All categories</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <label className="full row" style={{ gap: 8, cursor: 'pointer', fontSize: 12.5 }}><span className={`check ${roundTo9 ? 'on' : ''}`} onClick={() => setRoundTo9(!roundTo9)} />End prices in 9 (₹899 instead of ₹901)</label>
        <div className="full" style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', fontSize: 12.5 }}>Example: {basis === 'mrp' ? 'MRP ₹1,499' : 'selling ₹999'} → <b>{inr(example)}</b> (never above MRP)</div>
      </div>
    </Modal>
  );
}

function NewListModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const create = async () => {
    try { const l = await post<{ id: string }>('/price-lists', { name: name.trim() }); toast('Price list created - apply a rule or enter prices', 'success'); onDone(l.id); }
    catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <Modal title="New price list" icon="tag" onClose={onClose} width={420} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={name.trim().length < 2} onClick={create}>Create</button></>}>
      <div className="field"><label>Name</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. End of season sale" onKeyDown={(e) => e.key === 'Enter' && name.trim().length >= 2 && create()} /></div>
    </Modal>
  );
}
