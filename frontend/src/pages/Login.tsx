import { FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ProductArt } from '../components/ProductArt';
import { Modal } from '../components/ui';
import { homePath, useAuth } from '../lib/auth';
import '../styles/login.css';

export default function Login() {
  const { me, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);

  if (me) return <Navigate to={homePath(me.user.role)} replace />;

  const isMobile = /^[\d\s+-]{6,}$/.test(id.trim());
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const l = id, p = pw;
    if (!l.trim() || !p) return setError('Enter your email or mobile number and password');
    setBusy(true);
    setError('');
    try {
      const m = await login(l.trim(), p);
      nav(loc.state?.from && m.user.role !== 'super_admin' ? loc.state.from : homePath(m.user.role), { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-hero">
        <div className="row" style={{ gap: 14 }}><img src="/logo-light.png" alt="NPOS – Infinite Solution" style={{ height: 88, display: 'block' }} /><span style={{ fontSize: 12, color: '#8d9bc7', borderLeft: '1px solid rgba(255,255,255,.18)', paddingLeft: 14 }}>Clothing Shop POS &amp;<br />Barcode Billing</span></div>
        <h1>Barcode scan karo,<br /><span>billing ready.</span></h1>
        <p>Kapde ki dukaan ke har piece pe barcode — scan karo, bill ready, line na lage. Size, colour &amp; price come straight from the tag.</p>

        {/* live "Scan. Bill. Done." preview */}
        <div className="demo" aria-hidden="true">
          <div className="demo-tag">
            <div className="demo-art"><ProductArt type="plaid" color="#9f1239" /></div>
            <div className="demo-code"><div className="bars" /><span>8 901234 567894</span></div>
            <i className="laser" />
          </div>
          <div className="demo-arrow"><Icon name="arrow" /></div>
          <div className="demo-bill">
            <div className="row between"><b>Bill #MG-2026-08431</b><span className="chip green">Scanning</span></div>
            <div className="demo-line l1"><span>Checked Casual Shirt · L · Maroon</span><b>₹999</b></div>
            <div className="demo-line l2"><span>Slim Fit Jeans · 32 · Indigo</span><b>₹1,599</b></div>
            <div className="demo-line l3"><span>Track Jacket · L · Green</span><b>₹1,299</b></div>
            <div className="demo-total"><span>Payable (GST incl.)</span><b>₹3,897</b></div>
          </div>
        </div>

        <div className="feats">
          <div><Icon name="zap" /><b>Scan. Bill. Done.</b><span>Near-instant barcode-to-cart</span></div>
          <div><Icon name="layers" /><b>Size × colour SKUs</b><span>Exact variant stock</span></div>
          <div><Icon name="percent" /><b>GST-ready invoices</b><span>CGST / SGST / IGST, 80mm print</span></div>
        </div>
      </section>

      <section className="login-form">
        <form onSubmit={submit} noValidate>
          <img className="login-logo" src="/logo.png" alt="NPOS – Infinite Solution" />
          <div>
            <h2>Welcome back</h2>
            <div className="muted" style={{ marginTop: 6 }}>Sign in to your store or the admin console. Your role decides what opens next.</div>
          </div>

          {error && <div className="login-error" role="alert"><Icon name="alert" size={16} />{error}</div>}

          <div className="field">
            <label htmlFor="login">Email or mobile number</label>
            <div className={`input lg ${error && !id ? 'err' : ''}`}>
              <Icon name={isMobile ? 'phone' : 'user'} size={17} />
              <input id="login" autoFocus autoComplete="username" inputMode={isMobile ? 'tel' : 'email'} placeholder="you@store.in or 98765 43210" value={id} onChange={(e) => setId(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <div className="row between"><label htmlFor="password">Password</label><button type="button" className="link" style={{ fontSize: 12 }} onClick={() => setForgot(true)}>Forgot password?</button></div>
            <div className="input lg">
              <Icon name="lock" size={17} />
              <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="••••••••" value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
                onKeyDown={(e) => setCaps(e.getModifierState('CapsLock'))} />
              <button type="button" className="pw-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'eye' : 'lock'} size={16} /></button>
            </div>
            {caps && <span className="hint" style={{ color: 'var(--amber)', fontWeight: 600 }}>Caps Lock is on</span>}
          </div>

          <button className="btn primary lg block" type="submit" disabled={busy}>
            {busy ? <><span className="spinner" style={{ width: 16, height: 16, borderColor: 'rgba(255,255,255,.35)', borderTopColor: '#fff' }} />Signing in…</> : <>Sign in<Icon name="arrow" /></>}
          </button>


          <div className="secure"><Icon name="shield" size={14} />Encrypted sign-in · role-based access · each business's data is isolated</div>
        </form>
      </section>

      {forgot && (
        <Modal title="Reset your password" icon="key" onClose={() => setForgot(false)} width={420} footer={<button className="btn primary" onClick={() => setForgot(false)}>Got it</button>}>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' }}>
            <p><b>Store staff:</b> ask your store owner or manager to reset your password from <i>Staff</i> settings.</p>
            <p style={{ marginTop: 10 }}><b>Business owners:</b> contact NPOS support with your registered mobile number — we verify and reset it for you.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
