import { useState } from 'react';

const API = '/api/demo';

/* ── Inline styles ───────────────────────────────────────────────── */
const S = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #05060a 0%, #0d0f1a 40%, #0a0c15 100%)',
    color: '#e2e8f0',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    position: 'relative',
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute', top: '-30%', left: '50%', transform: 'translateX(-50%)',
    width: '900px', height: '900px', borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(139,92,246,0.12) 0%, transparent 70%)',
    pointerEvents: 'none', zIndex: 0,
  },
  nav: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: 'clamp(12px, 3vw, 24px) clamp(16px, 4vw, 48px)', position: 'relative', zIndex: 2,
    flexWrap: 'wrap',
  },
  logo: {
    fontSize: '24px', fontWeight: 800, letterSpacing: '0.12em',
    background: 'linear-gradient(135deg, #a78bfa, #6d28d9)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  navLinks: { display: 'flex', gap: 'clamp(12px, 3vw, 32px)', alignItems: 'center', flexWrap: 'wrap' },
  navLink: {
    color: '#94a3b8', fontSize: '14px', textDecoration: 'none',
    transition: 'color 0.2s', cursor: 'pointer',
  },
  hero: {
    textAlign: 'center', padding: '80px 24px 60px', position: 'relative', zIndex: 2,
    maxWidth: '860px', margin: '0 auto',
  },
  badge: {
    display: 'inline-block', padding: '6px 18px', borderRadius: '20px',
    background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.25)',
    color: '#a78bfa', fontSize: '13px', fontWeight: 600, letterSpacing: '0.06em',
    marginBottom: '28px',
  },
  h1: {
    fontSize: 'clamp(36px, 5vw, 64px)', fontWeight: 900, lineHeight: 1.1,
    marginBottom: '24px',
    background: 'linear-gradient(135deg, #f1f5f9 0%, #cbd5e1 50%, #a78bfa 100%)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '18px', color: '#94a3b8', lineHeight: 1.7, maxWidth: '600px',
    margin: '0 auto 40px',
  },
  price: {
    display: 'inline-flex', alignItems: 'baseline', gap: '8px',
    background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)',
    borderRadius: '16px', padding: '16px 32px', marginBottom: '48px',
  },
  priceAmount: { fontSize: '42px', fontWeight: 900, color: '#a78bfa' },
  priceLabel: { fontSize: '14px', color: '#94a3b8' },
  features: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: '24px', maxWidth: '960px', margin: '0 auto', padding: '0 24px 80px',
    position: 'relative', zIndex: 2,
  },
  card: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: '16px', padding: '32px 24px', textAlign: 'center',
    transition: 'transform 0.3s, border-color 0.3s',
  },
  cardIcon: { fontSize: '36px', marginBottom: '16px' },
  cardTitle: { fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: '#f1f5f9' },
  cardDesc: { fontSize: '13px', color: '#64748b', lineHeight: 1.6 },
  // Demo button (bottom-right floating)
  fab: {
    position: 'fixed', bottom: '32px', right: '32px', zIndex: 1000,
    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
    color: '#fff', border: 'none', borderRadius: '16px',
    padding: '16px 28px', fontSize: '15px', fontWeight: 700,
    cursor: 'pointer', boxShadow: '0 8px 32px rgba(124,58,237,0.4)',
    transition: 'transform 0.2s, box-shadow 0.2s', letterSpacing: '0.03em',
  },
  // Modal overlay
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    backdropFilter: 'blur(8px)', zIndex: 1001,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    background: 'linear-gradient(160deg, #111827, #0d0f1a)',
    border: '1px solid rgba(139,92,246,0.2)', borderRadius: '20px',
    padding: '40px', width: '100%', maxWidth: '440px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
  },
  modalTitle: {
    fontSize: '22px', fontWeight: 800, marginBottom: '8px',
    background: 'linear-gradient(135deg, #f1f5f9, #a78bfa)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  },
  modalSub: { fontSize: '13px', color: '#64748b', marginBottom: '28px' },
  input: {
    width: '100%', padding: '14px 16px', borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)',
    color: '#e2e8f0', fontSize: '14px', outline: 'none',
    marginBottom: '14px', boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  },
  btn: {
    width: '100%', padding: '14px', borderRadius: '12px', border: 'none',
    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff',
    fontSize: '15px', fontWeight: 700, cursor: 'pointer',
    transition: 'opacity 0.2s', marginTop: '8px',
  },
  closeBtn: {
    position: 'absolute', top: '16px', right: '20px', background: 'none',
    border: 'none', color: '#64748b', fontSize: '22px', cursor: 'pointer',
  },
  success: {
    textAlign: 'center', padding: '20px 0', color: '#4ade80', fontSize: '15px',
    lineHeight: 1.6,
  },
  error: { color: '#f87171', fontSize: '13px', marginBottom: '12px' },
  // Activate section
  activateSection: {
    background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.12)',
    borderRadius: '20px', padding: '48px 24px', textAlign: 'center',
    maxWidth: '600px', margin: '0 auto 80px', position: 'relative', zIndex: 2,
  },
  footer: {
    textAlign: 'center', padding: '32px 24px', color: '#475569',
    fontSize: '13px', borderTop: '1px solid rgba(255,255,255,0.05)',
    position: 'relative', zIndex: 2,
  },
};

const FEATURES = [
  { icon: '🎙️', title: 'Voice AI Chat', desc: 'Natural voice conversations powered by advanced AI. Speak in any language.' },
  { icon: '🧠', title: 'Persistent Memory', desc: 'Kelion remembers you across sessions — your preferences, your life, your context.' },
  { icon: '🌍', title: 'Multi-Language', desc: 'Speak Romanian, English, French, Spanish — Kelion adapts to your native tongue.' },
  { icon: '👁️', title: 'Vision & Camera', desc: 'Show Kelion what you see. Real-time camera analysis for homework, objects, documents.' },
  { icon: '🔧', title: '10+ Live Tools', desc: 'Search, weather, crypto, forex, translate, calculate — all by voice command.' },
  { icon: '🎨', title: '3D Avatar', desc: 'A lifelike animated companion that reacts, speaks, and connects with you.' },
];

export default function LandingPage() {
  const [showForm, setShowForm] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' });
  const [activateForm, setActivateForm] = useState({ code: '', password: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [activateError, setActivateError] = useState('');
  const [activated, setActivated] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSending(true);
    try {
      const res = await fetch(`${API}/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleActivate = async (e) => {
    e.preventDefault();
    setActivateError('');
    setSending(true);
    try {
      const res = await fetch(`${API}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activateForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Activation failed');
      setActivated(true);
      // Redirect to app after 2s
      setTimeout(() => { window.location.href = '/'; }, 2000);
    } catch (err) {
      setActivateError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={S.page}>
      <div style={S.glow} />

      {/* Nav */}
      <nav style={S.nav}>
        <div style={S.logo}>KELION AI</div>
        <div style={S.navLinks}>
          <span style={S.navLink} onClick={() => setShowActivate(true)}>Activate Code</span>
          <a href="/" style={S.navLink}>Sign In</a>
        </div>
      </nav>

      {/* Hero */}
      <section style={S.hero}>
        <div style={S.badge}>✨ AI Voice Assistant — Next Generation</div>
        <h1 style={S.h1}>Your Intelligent<br />Voice Companion</h1>
        <p style={S.subtitle}>
          KelionAI is a real-time voice AI assistant with persistent memory, 3D avatar,
          and 10+ integrated tools. Speak naturally in any language — Kelion understands,
          remembers, and helps you every day.
        </p>
        <div style={S.price}>
          <span style={S.priceAmount}>£20</span>
          <span style={S.priceLabel}>one-time purchase<br />+ pay-as-you-go credits</span>
        </div>
      </section>

      {/* Features */}
      <section style={S.features}>
        {FEATURES.map((f, i) => (
          <div key={i} style={S.card}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.borderColor = 'rgba(139,92,246,0.3)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
          >
            <div style={S.cardIcon}>{f.icon}</div>
            <div style={S.cardTitle}>{f.title}</div>
            <div style={S.cardDesc}>{f.desc}</div>
          </div>
        ))}
      </section>

      {/* Activate Code Section */}
      <section style={S.activateSection}>
        <h2 style={{ ...S.modalTitle, fontSize: '24px', marginBottom: '12px' }}>Have a Demo Code?</h2>
        <p style={{ ...S.modalSub, marginBottom: '24px' }}>Enter your unique demo code to activate your 15-minute free trial</p>
        {activated ? (
          <div style={S.success}>✅ Account activated! Redirecting to KelionAI...</div>
        ) : (
          <form onSubmit={handleActivate} style={{ maxWidth: '360px', margin: '0 auto' }}>
            {activateError && <div style={S.error}>{activateError}</div>}
            <input style={S.input} placeholder="Demo Code (e.g. A1B2C3D4)"
              value={activateForm.code}
              onChange={e => setActivateForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} required />
            <input style={S.input} type="password" placeholder="Create Password (min 8 chars)"
              value={activateForm.password}
              onChange={e => setActivateForm(p => ({ ...p, password: e.target.value }))} required minLength={8} />
            <button style={S.btn} type="submit" disabled={sending}>
              {sending ? 'Activating...' : '🚀 Activate Free Trial'}
            </button>
          </form>
        )}
      </section>

      {/* Footer */}
      <footer style={S.footer}>
        © {new Date().getFullYear()} KelionAI — All rights reserved · <a href="/contact" style={{ color: '#7c3aed' }}>Contact</a>
      </footer>

      {/* Floating Demo Request Button */}
      <button style={S.fab} onClick={() => { setShowForm(true); setSent(false); setError(''); }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(124,58,237,0.5)'; }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.4)'; }}
        id="demo-request-btn"
      >
        📩 Request Demo Account
      </button>

      {/* Demo Request Modal */}
      {showForm && (
        <div style={S.overlay} onClick={() => setShowForm(false)}>
          <div style={{ ...S.modal, position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button style={S.closeBtn} onClick={() => setShowForm(false)}>✕</button>
            <div style={S.modalTitle}>Request Demo Account</div>
            <div style={S.modalSub}>Fill in your details and we'll send you a unique demo code for 15 minutes free.</div>

            {sent ? (
              <div style={S.success}>
                ✅ Request sent!<br />We will review your request and send you a demo code shortly.
              </div>
            ) : (
              <form onSubmit={handleSubmit}>
                {error && <div style={S.error}>{error}</div>}
                <input style={S.input} placeholder="First Name" value={form.firstName}
                  onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))} required minLength={2} />
                <input style={S.input} placeholder="Last Name" value={form.lastName}
                  onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))} required minLength={2} />
                <input style={S.input} type="email" placeholder="Email Address" value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required />
                <button style={S.btn} type="submit" disabled={sending}>
                  {sending ? 'Sending...' : '📨 Send Request'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Activate Modal (from nav) */}
      {showActivate && (
        <div style={S.overlay} onClick={() => setShowActivate(false)}>
          <div style={{ ...S.modal, position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button style={S.closeBtn} onClick={() => setShowActivate(false)}>✕</button>
            <div style={S.modalTitle}>Activate Demo Code</div>
            <div style={S.modalSub}>Enter your demo code and create a password to start your 15-minute free trial.</div>

            {activated ? (
              <div style={S.success}>✅ Account activated! Redirecting...</div>
            ) : (
              <form onSubmit={handleActivate}>
                {activateError && <div style={S.error}>{activateError}</div>}
                <input style={S.input} placeholder="Demo Code" value={activateForm.code}
                  onChange={e => setActivateForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} required />
                <input style={S.input} type="password" placeholder="Create Password (min 8 chars)"
                  value={activateForm.password}
                  onChange={e => setActivateForm(p => ({ ...p, password: e.target.value }))} required minLength={8} />
                <button style={S.btn} type="submit" disabled={sending}>
                  {sending ? 'Activating...' : '🚀 Activate Free Trial'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
