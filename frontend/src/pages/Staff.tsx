import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Topbar } from '../components/Layout';
import { Avatar, Empty, ErrorBox, Loading, Modal, StatusChip, useLoad, useToast } from '../components/ui';
import { get, patch, post, Role } from '../lib/api';
import { ROLE_LABEL, useAuth } from '../lib/auth';
import { relDay } from '../lib/format';

interface StaffRow { id: string; name: string; email: string; mobile?: string; role: Role; isActive: boolean; lastLoginAt?: string; stores: { id: string; name: string }[] }
const ROLES: [Role, string][] = [
  ['cashier', 'POS billing, payments, reprints, permitted returns'],
  ['store_manager', 'Store operations, stock, returns, staff and reports for assigned stores'],
  ['inventory_user', 'Products, receiving stock, adjustments, transfers'],
  ['accountant', 'Sales, payment, tax reports and supplier payments'],
  ['tenant_admin', 'Full control of the business, all stores and settings'],
];

export default function Staff() {
  const { me, can } = useAuth();
  const { data, error, loading, reload } = useLoad(() => get<StaffRow[]>('/users'), []);
  const [editing, setEditing] = useState<Partial<StaffRow> | null>(null);
  const isOwner = can('tenant_admin');
  const max = me?.subscription?.plan.maxUsers;
  const active = data?.filter((u) => u.isActive).length ?? 0;
  return (
    <>
      <Topbar crumb="Administration › Staff & Roles" title="Staff & Roles">
        <span className="muted" style={{ fontSize: 12 }}>{active}{max ? ` of ${max}` : ''} active users on your plan</span>
        {isOwner && <button className="btn primary" disabled={!!max && active >= max} onClick={() => setEditing({ role: 'cashier', stores: [] })}><Icon name="user_plus" />Add Staff</button>}
      </Topbar>
      <div className="content">
        {!isOwner && <div className="card" style={{ padding: '10px 14px', fontSize: 12.5 }} ><Icon name="info" size={14} /> Only the owner can add staff or change roles. You can see who works in your stores.</div>}
        <div className="card" style={{ overflow: 'hidden' }}>
          {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : !data!.length ? <Empty icon="users" title="No staff yet" /> : (
            <table className="t">
              <thead><tr><th>Name</th><th>Role</th><th>Stores</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
              <tbody>{data!.map((u) => (
                <tr key={u.id}>
                  <td><div className="row"><Avatar name={u.name} /><div><b>{u.name}</b>{u.id === me?.user.id && <span className="chip blue nodot" style={{ marginLeft: 6 }}>You</span>}<div className="muted" style={{ fontSize: 11 }}>{u.email}{u.mobile ? ` · ${u.mobile}` : ''}</div></div></div></td>
                  <td><span className={`chip nodot ${u.role === 'tenant_admin' ? 'violet' : u.role === 'store_manager' ? 'blue' : 'gray'}`}>{ROLE_LABEL[u.role]}</span></td>
                  <td>{u.role === 'tenant_admin' || u.role === 'accountant' ? <span className="muted">All stores</span> : u.stores.map((s) => s.name).join(', ') || <span className="down">None</span>}</td>
                  <td>{u.lastLoginAt ? relDay(u.lastLoginAt) : <span className="muted">Never</span>}</td>
                  <td><StatusChip status={u.isActive ? 'active' : 'inactive'} /></td>
                  <td className="r">{isOwner && <button className="btn sm" onClick={() => setEditing(u)}><Icon name="edit" />Edit</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <b>What each role can do</b>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 10, marginTop: 10 }}>
            {ROLES.map(([r, d]) => <div key={r} style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 12px', fontSize: 12 }}><b>{ROLE_LABEL[r]}</b><div className="muted" style={{ marginTop: 3 }}>{d}</div></div>)}
          </div>
        </div>
      </div>
      {editing && <StaffForm initial={editing} self={editing.id === me?.user.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function StaffForm({ initial, self, onClose, onSaved }: { initial: Partial<StaffRow>; self: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { me } = useAuth();
  const isNew = !initial.id;
  const [name, setName] = useState(initial.name ?? '');
  const [email, setEmail] = useState(initial.email ?? '');
  const [mobile, setMobile] = useState(initial.mobile ?? '');
  const [role, setRole] = useState<Role>(initial.role ?? 'cashier');
  const [storeIds, setStoreIds] = useState<string[]>(initial.stores?.map((s) => s.id) ?? (me?.stores[0] ? [me.stores[0].id] : []));
  const [password, setPassword] = useState('');
  const [active, setActive] = useState(initial.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const allStores = me?.stores ?? [];
  const wide = role === 'tenant_admin' || role === 'accountant';
  const valid = isNew ? name.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && password.length >= 8 && (wide || storeIds.length > 0) : (wide || storeIds.length > 0) && (!password || password.length >= 8);
  const save = async () => {
    setBusy(true);
    const stores = wide ? allStores.map((s) => s.id) : storeIds;
    try {
      if (isNew) await post('/users', { name: name.trim(), email: email.trim(), mobile: mobile || undefined, role, password, storeIds: stores });
      else await patch(`/users/${initial.id}`, { role: self ? undefined : role, isActive: self ? undefined : active, storeIds: stores, password: password || undefined });
      toast(isNew ? `${name} can now sign in` : 'Staff updated', 'success');
      onSaved();
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  };
  return (
    <Modal title={isNew ? 'Add staff member' : `Edit ${initial.name}`} icon="user_plus" onClose={onClose} width={600}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!valid || busy} onClick={save}>{isNew ? 'Create login' : 'Save changes'}</button></>}>
      <div className="form-grid">
        {isNew ? <>
          <div className="field"><label>Full name *</label><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label>Mobile (can sign in with it)</label><input className="input num" value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} /></div>
          <div className="field full"><label>Email (login) *</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </> : <div className="full row" style={{ background: 'var(--bg)', borderRadius: 10, padding: 10 }}><Avatar name={initial.name ?? ''} /><div><b>{initial.name}</b><div className="muted" style={{ fontSize: 11.5 }}>{initial.email}</div></div></div>}
        <div className="field full"><label>Role</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {ROLES.map(([r, d]) => (
              <div key={r} className={`opt ${role === r ? 'on' : ''}`} style={self ? { opacity: 0.5, pointerEvents: 'none' } : undefined} onClick={() => setRole(r)}><span className="radio" /><div><b style={{ fontSize: 12.5 }}>{ROLE_LABEL[r]}</b><div className="muted" style={{ fontSize: 11 }}>{d}</div></div></div>
            ))}
          </div>
          {self && <span className="hint">You can't change your own role or disable yourself.</span>}
        </div>
        <div className="field full"><label>Stores</label>
          {wide ? <span className="muted" style={{ fontSize: 12.5 }}>This role covers every store.</span> : (
            <div className="pill-row">{allStores.map((s) => <span key={s.id} className={storeIds.includes(s.id) ? 'on' : ''} onClick={() => setStoreIds(storeIds.includes(s.id) ? storeIds.filter((x) => x !== s.id) : [...storeIds, s.id])}>{s.name}</span>)}</div>
          )}
        </div>
        <div className="field"><label>{isNew ? 'Temporary password *' : 'Reset password'}</label><input className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isNew ? 'min 8 characters' : 'leave blank to keep'} />
          {password && password.length < 8 && <span className="error">At least 8 characters</span>}</div>
        {!isNew && !self && <div className="field"><label>Access</label><label className="row" style={{ gap: 8, height: 38, cursor: 'pointer' }}><span className={`toggle ${active ? 'on' : ''}`} onClick={() => setActive(!active)} />{active ? 'Can sign in' : 'Disabled'}</label></div>}
      </div>
    </Modal>
  );
}
