import { ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Role } from '../lib/api';
import { ROLE_LABEL, useAuth } from '../lib/auth';
import { daysUntil, fmtDate, initials } from '../lib/format';
import { Icon } from './Icon';

/** [path, label, icon, roles, plan module that must be enabled] */
type NavItem = [path: string, label: string, icon: string, roles: Role[], module?: string] | [section: null, label: string];
const ALL_TENANT: Role[] = ['tenant_admin', 'store_manager', 'cashier', 'inventory_user', 'accountant'];
const TENANT_NAV: NavItem[] = [
  [null, 'Overview'],
  ['/dashboard', 'Dashboard', 'dashboard', ['tenant_admin', 'store_manager', 'accountant']],
  ['/pos', 'POS Billing', 'pos', ['tenant_admin', 'store_manager', 'cashier']],
  [null, 'Catalogue'],
  ['/products', 'Products', 'shirt', ['tenant_admin', 'store_manager', 'inventory_user']],
  ['/inventory', 'Inventory', 'box', ['tenant_admin', 'store_manager', 'inventory_user']],
  ['/purchases', 'Purchases', 'truck', ['tenant_admin', 'store_manager', 'inventory_user', 'accountant'], 'purchases'],
  ['/suppliers', 'Suppliers', 'building', ['tenant_admin', 'store_manager', 'inventory_user', 'accountant'], 'purchases'],
  ['/transfers', 'Stock Transfers', 'swap', ['tenant_admin', 'store_manager', 'inventory_user'], 'multi_store'],
  [null, 'Sales'],
  ['/invoices', 'Invoices', 'receipt', ALL_TENANT],
  ['/returns', 'Returns & Exchange', 'undo', ['tenant_admin', 'store_manager', 'cashier']],
  ['/customers', 'Customers', 'users', ['tenant_admin', 'store_manager', 'cashier', 'accountant']],
  ['/shift', 'Shift & Day Close', 'timer', ['tenant_admin', 'store_manager', 'cashier']],
  [null, 'Insights'],
  ['/reports', 'Reports', 'chart', ['tenant_admin', 'store_manager', 'accountant']],
  [null, 'Administration'],
  ['/staff', 'Staff & Roles', 'user_plus', ['tenant_admin', 'store_manager']],
  ['/settings', 'Settings', 'settings', ['tenant_admin', 'store_manager', 'accountant']],
];
const ADMIN_NAV: NavItem[] = [
  [null, 'Platform'],
  ['/admin', 'Dashboard', 'dashboard', ['super_admin']],
  ['/admin/tenants', 'Tenants', 'building', ['super_admin']],
  ['/admin/plans', 'Subscription Plans', 'layers', ['super_admin']],
  ['/admin/payments', 'Payments', 'card', ['super_admin']],
  [null, 'Insights'],
  ['/admin/audit', 'Audit Logs', 'history', ['super_admin']],
];

function Sidebar() {
  const { me, store, setStoreId } = useAuth();
  const [open, setOpen] = useState(false);
  if (!me) return null;
  const isAdmin = me.user.role === 'super_admin';
  const visible = (n: NavItem) => n[0] !== null && n[3].includes(me.user.role) && (!n[4] || me.modules.includes(n[4]));
  const nav = (isAdmin ? ADMIN_NAV : TENANT_NAV).filter((n, i, arr) => {
    if (n[0] !== null) return visible(n);
    // drop a section header when nothing below it is visible
    const next = arr.slice(i + 1).findIndex((x) => x[0] === null);
    const items = arr.slice(i + 1, next === -1 ? undefined : i + 1 + next);
    return items.some(visible);
  });
  const sub = me.subscription;
  const days = sub ? daysUntil(sub.endDate) : 0;
  return (
    <aside className="side no-print">
      <div className="brand"><div><img className="brand-logo" src="/logo-light-compact.png" alt="NPOS" /><small>{isAdmin ? 'Super Admin Console' : 'Clothing Retail POS'}</small></div></div>
      {isAdmin ? (
        <div className="tenant"><div className="av" style={{ background: '#6d28d9' }}><Icon name="crown" size={16} /></div><div className="grow"><b>Platform Owner</b><span>Production · v1.0</span></div></div>
      ) : (
        <div style={{ position: 'relative' }}>
          <div className="tenant" style={{ cursor: me.stores.length > 1 ? 'pointer' : 'default' }} onClick={() => me.stores.length > 1 && setOpen(!open)}>
            <div className="av">{initials(me.tenant?.businessName)}</div>
            <div className="grow" style={{ minWidth: 0 }}><b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.tenant?.businessName}</b><span>{store?.name ?? 'No store'}{me.stores.length > 1 ? ' ▾' : ''}</span></div>
          </div>
          {open && (
            <div className="menu" style={{ left: 0, right: 'auto', top: 'calc(100% - 8px)', minWidth: 208 }}>
              {me.stores.map((s) => (
                <div key={s.id} className="mi" onClick={() => { setStoreId(s.id); setOpen(false); }}>
                  <Icon name="store" size={16} /><span className="grow">{s.name}</span>{s.id === store?.id && <Icon name="check" size={15} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {nav.map((n, i) => n[0] === null
        ? <div key={i} className="sec">{n[1]}</div>
        : <NavLink key={n[0]} to={n[0]} end={n[0] === '/admin'} className={({ isActive }) => (isActive ? 'on' : '')}><Icon name={n[2]} />{n[1]}</NavLink>)}
      <div className="foot">
        {sub && !isAdmin && (
          <div style={{ background: 'var(--navy-2)', borderRadius: 10, padding: 12, fontSize: 11.5 }}>
            <div className="row between"><b style={{ color: '#fff' }}>{sub.plan.name}</b>
              <span className="chip nodot" style={sub.status === 'active' ? { background: '#14532d', color: '#86efac' } : { background: '#78350f', color: '#fcd34d' }}>{sub.status.replace('_', ' ')}</span></div>
            <div style={{ color: '#8d9bc7', margin: '6px 0 8px' }}>{days >= 0 ? `Renews ${fmtDate(sub.endDate)} · ${days} days` : `Ended ${fmtDate(sub.endDate)}`}</div>
            <div className="bar-track" style={{ background: '#24346f' }}><i style={{ width: `${Math.max(4, Math.min(100, (days / (sub.billingCycle === 'yearly' ? 365 : 30)) * 100))}%`, background: '#60a5fa' }} /></div>
            <div style={{ color: '#8d9bc7', marginTop: 6 }}>{me.stores.length}{sub.plan.maxStores ? ` of ${sub.plan.maxStores}` : ''} stores · {sub.billingCycle}</div>
          </div>
        )}
      </div>
    </aside>
  );
}

function UserMenu() {
  const { me, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (!me) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="me" style={{ cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div className="av" style={me.user.role === 'super_admin' ? { background: 'var(--violet-l)', color: 'var(--violet)' } : undefined}>{initials(me.user.name)}</div>
        <div><b>{me.user.name}</b><span>{ROLE_LABEL[me.user.role]}</span></div>
      </div>
      {open && (
        <div className="menu" style={{ minWidth: 230 }}>
          <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid var(--line-2)', marginBottom: 4 }}>
            <b>{me.user.name}</b><div className="muted" style={{ fontSize: 11.5 }}>{me.user.email}</div>
          </div>
          <div className="mi" onClick={async () => { await logout(); nav('/login'); }}><Icon name="logout" size={16} />Sign out</div>
        </div>
      )}
    </div>
  );
}

export function Topbar({ crumb, title, children }: { crumb?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="top no-print">
      <div style={{ minWidth: 0 }}>{crumb && <div className="crumb">{crumb}</div>}<h1 style={{ whiteSpace: 'nowrap' }}>{title}</h1></div>
      <div className="grow" />
      {children}
      <UserMenu />
    </div>
  );
}

function SubscriptionBanner() {
  const { me } = useAuth();
  const sub = me?.subscription;
  if (!sub || me?.user.role === 'super_admin') return null;
  const days = daysUntil(sub.endDate);
  if (['suspended', 'expired', 'cancelled'].includes(sub.status)) {
    return <div className="banner danger no-print"><Icon name="lock" size={16} />Your subscription is {sub.status}. Billing is paused and data is read-only — renew to continue.</div>;
  }
  if (['grace', 'past_due', 'payment_pending'].includes(sub.status)) {
    return <div className="banner warn no-print"><Icon name="alert" size={16} />Payment for your {sub.plan.name} plan is due. Billing will stop after the grace period — please renew.</div>;
  }
  if (sub.status === 'trial' && days <= 7) {
    return <div className="banner warn no-print"><Icon name="timer" size={16} />Trial ends in {days} day{days === 1 ? '' : 's'}. Choose a plan to keep billing without interruption.</div>;
  }
  return null;
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <SubscriptionBanner />
        {children}
      </div>
    </div>
  );
}
