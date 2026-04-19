// Professional auth modal — email + password (primary), Google SSO, passkey.
//
// Adrian asked for a standard sign-in UX like real sites: the passkey-first
// prompt was too narrow (users who didn't have a passkey on the device got
// stuck). This modal surfaces email/password as the primary path, Google as
// a 1-click alternative, and keeps passkey available as a tertiary option
// for returning users who already have one.
//
// Backend endpoints used:
//   POST /auth/local/register   { email, password, name } → sets kelion.token cookie
//   POST /auth/local/login      { email, password }       → sets kelion.token cookie
//   GET  /auth/google/start?mode=web                      → 302 to Google
//   (passkey is wired via props.onUsePasskey — the parent owns the flow)

import { useState, useCallback, useEffect, useRef } from 'react'

const MODES = {
  SIGN_IN: 'sign_in',
  SIGN_UP: 'sign_up',
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')
}

export default function SignInModal({
  open,
  onClose,
  onAuthenticated,
  onUsePasskey,
  passkeySupported,
}) {
  const [mode, setMode] = useState(MODES.SIGN_IN)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const emailRef = useRef(null)

  // Focus email on open; reset transient state when closed.
  useEffect(() => {
    if (open) {
      setError(null)
      setBusy(false)
      // Don't wipe fields between opens — user might want to retry.
      setTimeout(() => { emailRef.current && emailRef.current.focus() }, 40)
    }
  }, [open])

  // ESC to close, Enter already submits inside the form.
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, onClose])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    if (busy) return
    setError(null)

    // Client-side validation — keep messages matching server wording.
    if (!isValidEmail(email)) {
      setError('Please enter a valid email address.')
      return
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (mode === MODES.SIGN_UP && (!name || name.trim().length < 2)) {
      setError('Please enter your name (2+ characters).')
      return
    }

    setBusy(true)
    try {
      const endpoint = mode === MODES.SIGN_UP
        ? '/auth/local/register'
        : '/auth/local/login'
      const body = mode === MODES.SIGN_UP
        ? { email: email.trim(), password, name: name.trim() }
        : { email: email.trim(), password }

      const resp = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        throw new Error(json.error || `Request failed (${resp.status})`)
      }
      // Pass the raw JWT back to the parent too — the frontend uses it as
      // a Bearer-header fallback for the first few authenticated requests
      // after login, in case the browser drops the Set-Cookie header
      // (adblockers, Safari ITP, corporate proxies, strict privacy modes).
      onAuthenticated && onAuthenticated(json.user || null, json.token || null)
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }, [mode, email, password, name, busy, onAuthenticated])

  const handleGoogle = useCallback(() => {
    // Full redirect — matches the server-side PKCE flow which expects a
    // top-level navigation so it can read its own state cookies back.
    window.location.assign('/auth/google/start?mode=web')
  }, [])

  const handleUsePasskey = useCallback(() => {
    onUsePasskey && onUsePasskey()
  }, [onUsePasskey])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(4, 2, 12, 0.66)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={mode === MODES.SIGN_UP ? 'Create account' : 'Sign in'}
        style={{
          width: 'min(420px, 100%)',
          background: 'rgba(14, 10, 28, 0.96)',
          border: '1px solid rgba(167, 139, 250, 0.28)',
          borderRadius: 18,
          padding: '28px 26px 22px',
          color: '#ede9fe',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '0.01em' }}>
              {mode === MODES.SIGN_UP ? 'Create your account' : 'Sign in to Kelion'}
            </div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
              {mode === MODES.SIGN_UP
                ? 'So Kelion remembers you across devices.'
                : 'Welcome back.'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 999,
              background: 'transparent',
              border: '1px solid rgba(167, 139, 250, 0.2)',
              color: '#ede9fe', fontSize: 16, cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}
          >✕</button>
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            style={{
              fontSize: 12, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.55)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              padding: '8px 10px', borderRadius: 8, marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        {/* Google first — matches Apple/Google/Microsoft sign-in conventions
            where SSO is offered up-front and email is available below. */}
        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy}
          style={{
            width: '100%', height: 42, borderRadius: 10,
            background: '#ffffff',
            border: '1px solid rgba(255,255,255,0.9)',
            color: '#1f2937', fontSize: 14, fontWeight: 500,
            cursor: busy ? 'wait' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            marginBottom: 10,
          }}
        >
          <GoogleGlyph />
          <span>Continue with Google</span>
        </button>

        {/* Passkey — only shown if the browser supports WebAuthn. Existing
            users who already registered a passkey can use this for 1-tap. */}
        {passkeySupported && (
          <button
            type="button"
            onClick={handleUsePasskey}
            disabled={busy}
            style={{
              width: '100%', height: 42, borderRadius: 10,
              background: 'rgba(167, 139, 250, 0.1)',
              border: '1px solid rgba(167, 139, 250, 0.3)',
              color: '#ede9fe', fontSize: 14, fontWeight: 500,
              cursor: busy ? 'wait' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 16 }}>🔐</span>
            <span>Use a passkey</span>
          </button>
        )}

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 14px' }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(167, 139, 250, 0.15)' }} />
          <div style={{ fontSize: 11, opacity: 0.5, letterSpacing: 0.4, textTransform: 'uppercase' }}>
            Or with email
          </div>
          <div style={{ flex: 1, height: 1, background: 'rgba(167, 139, 250, 0.15)' }} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          {mode === MODES.SIGN_UP && (
            <Field
              label="Name"
              value={name}
              onChange={setName}
              type="text"
              autoComplete="name"
              disabled={busy}
              placeholder="Your name"
            />
          )}
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            type="email"
            autoComplete={mode === MODES.SIGN_UP ? 'email' : 'username'}
            inputMode="email"
            disabled={busy}
            placeholder="you@example.com"
            inputRef={emailRef}
            required
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type={showPassword ? 'text' : 'password'}
            autoComplete={mode === MODES.SIGN_UP ? 'new-password' : 'current-password'}
            disabled={busy}
            placeholder={mode === MODES.SIGN_UP ? 'At least 8 characters' : '••••••••'}
            required
            suffix={
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                disabled={busy}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'rgba(237, 233, 254, 0.6)', fontSize: 12,
                  cursor: 'pointer', padding: 4,
                }}
              >{showPassword ? 'Hide' : 'Show'}</button>
            }
          />

          {mode === MODES.SIGN_IN && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '-4px 0 10px' }}>
              <a
                href="mailto:contact@kelionai.app?subject=Password%20reset%20request"
                style={{
                  fontSize: 11, color: 'rgba(237, 233, 254, 0.6)',
                  textDecoration: 'none',
                }}
              >
                Forgot your password?
              </a>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{
              width: '100%', height: 44, borderRadius: 10,
              background: busy
                ? 'rgba(167, 139, 250, 0.35)'
                : 'linear-gradient(135deg, #a78bfa, #60a5fa)',
              color: '#0a0818', fontSize: 14, fontWeight: 600,
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              marginTop: 4,
              letterSpacing: '0.01em',
            }}
          >
            {busy
              ? (mode === MODES.SIGN_UP ? 'Creating account…' : 'Signing in…')
              : (mode === MODES.SIGN_UP ? 'Create account' : 'Sign in')}
          </button>
        </form>

        {/* Toggle */}
        <div style={{
          fontSize: 12, opacity: 0.7, marginTop: 14, textAlign: 'center',
        }}>
          {mode === MODES.SIGN_UP ? (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => { setMode(MODES.SIGN_IN); setError(null) }}
                disabled={busy}
                style={{
                  background: 'transparent', border: 'none',
                  color: '#a78bfa', cursor: 'pointer',
                  fontSize: 12, padding: 0,
                }}
              >Sign in</button>
            </>
          ) : (
            <>
              New to Kelion?{' '}
              <button
                type="button"
                onClick={() => { setMode(MODES.SIGN_UP); setError(null) }}
                disabled={busy}
                style={{
                  background: 'transparent', border: 'none',
                  color: '#a78bfa', cursor: 'pointer',
                  fontSize: 12, padding: 0,
                }}
              >Create an account</button>
            </>
          )}
        </div>

        <div style={{
          fontSize: 10, opacity: 0.4, marginTop: 14, textAlign: 'center',
          lineHeight: 1.5,
        }}>
          By continuing you agree to our{' '}
          <a href="/contact" style={{ color: 'inherit' }}>terms</a> and{' '}
          <a href="/contact" style={{ color: 'inherit' }}>privacy policy</a>.
        </div>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type, autoComplete, inputMode, disabled, placeholder, required, inputRef, suffix }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <div style={{
        fontSize: 11, opacity: 0.7, letterSpacing: 0.3,
        marginBottom: 6, textTransform: 'uppercase',
      }}>
        {label}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(167, 139, 250, 0.2)',
        borderRadius: 10,
        padding: '0 10px',
        height: 40,
      }}>
        <input
          ref={inputRef}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          inputMode={inputMode}
          disabled={disabled}
          placeholder={placeholder}
          required={required}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#ede9fe', fontSize: 14, minWidth: 0,
          }}
        />
        {suffix}
      </div>
    </label>
  )
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.07-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.1c4.16-3.83 6.57-9.47 6.57-16.17z"/>
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.1-5.52c-1.97 1.32-4.49 2.1-7.46 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"/>
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
    </svg>
  )
}
