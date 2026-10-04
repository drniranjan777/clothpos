import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { avatarColor, initials } from '../lib/format';
import { Icon } from './Icon';

// ---------------- toasts
type ToastKind = 'info' | 'success' | 'error';
interface ToastItem { id: number; kind: ToastKind; text: string }
const ToastCtx = createContext<(text: string, kind?: ToastKind) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-3), { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'} size={16} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------- modal
export function Modal({ title, sub, icon, onClose, children, footer, width = 560 }: {
  title: ReactNode; sub?: ReactNode; icon?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-h">
          {icon && <span className="kpi" style={{ padding: 0 }}><span className="l"><span className="ib"><Icon name={icon} /></span></span></span>}
          <div className="grow"><h2>{title}</h2>{sub && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{sub}</div>}</div>
          <button className="btn sm" onClick={onClose}><Icon name="x" />Esc</button>
        </div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ title, text, confirmLabel = 'Confirm', danger, onConfirm, onClose, needReason }: {
  title: string; text: ReactNode; confirmLabel?: string; danger?: boolean; needReason?: boolean;
  onConfirm: (reason: string) => Promise<unknown> | void; onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const go = async () => {
    setBusy(true);
    try {
      await onConfirm(reason);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose} width={440} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'dark' : 'primary'}`} disabled={busy || (needReason && reason.trim().length < 3)} onClick={go}>{busy ? 'Please wait…' : confirmLabel}</button>
    </>}>
      <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.5 }}>{text}</div>
      {needReason && <div className="field" style={{ marginTop: 14 }}><label>Reason (saved in audit log)</label><textarea className="input" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
    </Modal>
  );
}

// ---------------- small pieces
export const Loading = () => <div className="loading"><div className="spinner" /></div>;

export function Empty({ icon = 'inbox', title, text, action }: { icon?: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <b style={{ color: 'var(--text-2)' }}>{title}</b>
      {text && <span style={{ fontSize: 12 }}>{text}</span>}
      {action}
    </div>
  );
}

export function Avatar({ name, size = 30, square }: { name: string; size?: number; square?: boolean }) {
  const [bg, fg] = avatarColor(name);
  return <div className="av-s" style={{ width: size, height: size, background: bg, color: fg, borderRadius: square ? 8 : '50%', fontSize: size > 40 ? 15 : 11.5 }}>{initials(name)}</div>;
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, ReactNode][]; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([k, label]) => <span key={k} role="tab" aria-selected={k === value} className={k === value ? 'on' : ''} onClick={() => onChange(k)}>{label}</span>)}
    </div>
  );
}

export function Pager({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (total <= pageSize) return <div className="row between" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', fontSize: 12 }}><span className="muted">{total} record{total === 1 ? '' : 's'}</span></div>;
  const from = (page - 1) * pageSize + 1;
  const nums = [...new Set([1, page - 1, page, page + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  return (
    <div className="row between" style={{ padding: '12px 16px', borderTop: '1px solid var(--line)', fontSize: 12 }}>
      <span className="muted">Showing {from}–{Math.min(total, from + pageSize - 1)} of {total.toLocaleString('en-IN')}</span>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">‹</button>
        {nums.map((p, i) => (
          <span key={p} className="row" style={{ gap: 6 }}>
            {i > 0 && p - nums[i - 1] > 1 && <span className="muted">…</span>}
            <button className="btn sm" style={p === page ? { background: 'var(--blue)', color: '#fff', borderColor: 'var(--blue)' } : undefined} onClick={() => onPage(p)}>{p}</button>
          </span>
        ))}
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">›</button>
      </div>
    </div>
  );
}

export function Kpi({ label, value, delta, icon, tone }: { label: ReactNode; value: ReactNode; delta?: ReactNode; icon?: string; tone?: 'violet' | 'green' | 'amber' | 'red' }) {
  const tones = { violet: ['var(--violet-l)', 'var(--violet)'], green: ['var(--green-l)', 'var(--green)'], amber: ['var(--amber-l)', 'var(--amber)'], red: ['var(--red-l)', 'var(--red)'] };
  const [bg, fg] = tone ? tones[tone] : [];
  return (
    <div className="card kpi">
      <div className="l">{icon && <span className="ib" style={tone ? { background: bg, color: fg } : undefined}><Icon name={icon} /></span>}{label}</div>
      <div className="v num">{value}</div>
      {delta !== undefined && <div className="d">{delta}</div>}
    </div>
  );
}

export function Delta({ pct, suffix = '' }: { pct: number | null | undefined; suffix?: string }) {
  if (pct === null || pct === undefined || !isFinite(pct)) return <span className="muted">—</span>;
  return <span className={pct >= 0 ? 'up' : 'down'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%{suffix}</span>;
}

const STATUS: Record<string, [string, string]> = {
  active: ['green', 'Active'], completed: ['green', 'Paid'], paid: ['green', 'Paid'], approved: ['green', 'Approved'],
  trial: ['blue', 'Trial'], open: ['green', 'Open'], closed: ['gray', 'Closed'],
  payment_pending: ['amber', 'Payment pending'], past_due: ['red', 'Past due'], grace: ['amber', 'Grace period'],
  suspended: ['gray', 'Suspended'], expired: ['red', 'Expired'], cancelled: ['red', 'Cancelled'], archived: ['gray', 'Archived'],
  failed: ['red', 'Failed'], pending: ['amber', 'Pending'], inactive: ['gray', 'Inactive'],
  refund: ['blue', 'Refund'], exchange: ['violet', 'Exchange'], mixed: ['violet', 'Refund + exchange'],
};
export function StatusChip({ status, label }: { status: string; label?: string }) {
  const [tone, text] = STATUS[status] ?? ['gray', status];
  return <span className={`chip ${tone}`}>{label ?? text}</span>;
}

/** Debounced value for search boxes. */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Load data with loading/error state; re-runs when deps change. Returns reload(). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fn();
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError((e as Error).message);
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <Empty icon="alert" title="Could not load this page" text={error} action={onRetry && <button className="btn sm" onClick={onRetry}><Icon name="refresh" />Try again</button>} />;
}
