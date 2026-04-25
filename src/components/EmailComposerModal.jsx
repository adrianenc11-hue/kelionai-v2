// In-app email composer modal. Adrian: "sa deschida cimpurile de mail, sa
// poata fi setate". When Kelion (text or voice) decides to draft an email
// it calls compose_email_draft → the renderer-only dispatcher opens this
// modal pre-populated with To / Subject / Body / Cc / Bcc / Reply-To. The
// user reviews and edits in place; nothing is delivered until they click
// Send. The Send button routes through the existing send_email tool which
// uses our Resend account, so the user never has to copy a token.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { subscribeComposer, getComposer, closeComposer } from '../lib/composerStore'
import { getCsrfToken } from '../lib/api'

function emailRe(addr) {
  return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test((addr || '').trim())
}

function parseRecipients(input) {
  return String(input || '')
    .split(/[,;\n]\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
}

export default function EmailComposerModal({ authToken }) {
  const composer = useSyncExternalStore(subscribeComposer, getComposer, getComposer)
  const open = composer.kind === 'email' && !!composer.draft
  const draft = composer.draft

  // Local copies so the user can edit. Reset whenever a new draft arrives.
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [bcc, setBcc] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [replyTo, setReplyTo] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)  // null | 'sent' | { error }
  const subjectRef = useRef(null)

  useEffect(() => {
    if (!open || !draft) return
    setTo((draft.to || []).join(', '))
    setCc((draft.cc || []).join(', '))
    setBcc((draft.bcc || []).join(', '))
    setSubject(draft.subject || '')
    setBody(draft.body || '')
    setReplyTo(draft.reply_to || '')
    setShowCc(((draft.cc || []).length + (draft.bcc || []).length) > 0)
    setStatus(null)
    setBusy(false)
    // Focus the subject so the user can start tweaking immediately. If
    // they want to edit recipients, they tab back one field — minimal
    // friction for the common case (model already inferred recipients
    // from the conversation; subject/body are usually what gets edited).
    setTimeout(() => { subjectRef.current && subjectRef.current.focus() }, 60)
  }, [open, composer.openedAt])  // re-run for every new draft (different openedAt)

  // ESC closes (but only when not mid-send — avoid losing user's edits to
  // a stray keypress while the network call is in flight).
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy && status !== 'sent') {
        closeComposer()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, busy, status])

  if (!open) return null

  const recipients = parseRecipients(to)
  const ccList = parseRecipients(cc)
  const bccList = parseRecipients(bcc)
  const allAddrs = [...recipients, ...ccList, ...bccList]
  const invalidAddr = allAddrs.find((a) => !emailRe(a))
  const canSend =
    recipients.length > 0 &&
    !invalidAddr &&
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    !busy

  async function handleSend() {
    if (!canSend) return
    setBusy(true)
    setStatus(null)
    try {
      const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() }
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`
      const r = await fetch('/api/tools/execute', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          name: 'send_email',
          args: {
            to: recipients,
            cc: ccList.length ? ccList : undefined,
            bcc: bccList.length ? bccList : undefined,
            subject: subject.trim(),
            text: body,
            reply_to: replyTo && emailRe(replyTo) ? replyTo : undefined,
          },
        }),
      })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j?.ok) {
        const msg = j?.error || `Send failed (${r.status}).`
        setStatus({ error: msg })
        return
      }
      setStatus('sent')
      // Auto-close after a short success flash so the user sees the
      // confirmation but isn't blocked from continuing the conversation.
      setTimeout(() => closeComposer(), 900)
    } catch (e) {
      setStatus({ error: e?.message || 'Network error.' })
    } finally {
      setBusy(false)
    }
  }

  const wrap = {
    position: 'fixed', inset: 0, zIndex: 50,
    background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
  }
  const card = {
    width: '100%', maxWidth: 640, maxHeight: '92vh', overflow: 'auto',
    background: '#0d0f1a', color: '#e6e8ee',
    border: '1px solid #2a2e3f', borderRadius: 12,
    padding: '20px 22px',
    boxShadow: '0 12px 48px rgba(0,0,0,0.6)',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  }
  const labelStyle = { display: 'block', fontSize: 12, color: '#8a8fa3', marginBottom: 4, marginTop: 10 }
  const inputStyle = {
    width: '100%', padding: '10px 12px',
    background: '#161929', color: '#e6e8ee',
    border: '1px solid #2a2e3f', borderRadius: 8,
    fontSize: 14, outline: 'none', boxSizing: 'border-box',
  }
  const textareaStyle = { ...inputStyle, minHeight: 180, fontFamily: 'inherit', resize: 'vertical' }
  const btnPrimary = {
    padding: '10px 18px',
    background: canSend ? '#4a7dff' : '#2a3148',
    color: canSend ? '#fff' : '#5a6178',
    border: 'none', borderRadius: 8,
    fontSize: 14, fontWeight: 600,
    cursor: canSend ? 'pointer' : 'not-allowed',
  }
  const btnGhost = {
    padding: '10px 14px',
    background: 'transparent', color: '#a0a4b8',
    border: '1px solid #2a2e3f', borderRadius: 8,
    fontSize: 14, cursor: 'pointer',
  }

  return (
    <div style={wrap} onClick={(e) => { if (e.target === e.currentTarget && !busy && status !== 'sent') closeComposer() }}>
      <div style={card} role="dialog" aria-modal="true" aria-label="Compose email">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Trimite e-mail</h2>
          <button
            type="button"
            onClick={() => { if (!busy && status !== 'sent') closeComposer() }}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: '#8a8fa3', fontSize: 22, cursor: 'pointer', padding: '0 4px' }}
          >
            ×
          </button>
        </div>

        <p style={{ margin: '0 0 4px 0', fontSize: 12, color: '#8a8fa3' }}>
          Verifică câmpurile, modifică ce vrei, apoi apasă Send. Nu pleacă nimic până nu apeși tu.
        </p>

        <label style={labelStyle}>To</label>
        <input
          type="text"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="recipient@example.com"
          style={inputStyle}
          autoComplete="off"
          spellCheck={false}
        />

        {!showCc && (
          <button
            type="button"
            onClick={() => setShowCc(true)}
            style={{ background: 'transparent', border: 'none', color: '#7a85a8', fontSize: 12, cursor: 'pointer', marginTop: 6, padding: 0 }}
          >
            + Cc / Bcc
          </button>
        )}

        {showCc && (
          <>
            <label style={labelStyle}>Cc</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="optional@example.com"
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
            />
            <label style={labelStyle}>Bcc</label>
            <input
              type="text"
              value={bcc}
              onChange={(e) => setBcc(e.target.value)}
              placeholder="optional@example.com"
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
            />
          </>
        )}

        <label style={labelStyle}>Subject</label>
        <input
          ref={subjectRef}
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subiectul mesajului"
          style={inputStyle}
          maxLength={300}
        />

        <label style={labelStyle}>Mesaj</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Scrie mesajul..."
          style={textareaStyle}
        />

        {showCc && (
          <>
            <label style={labelStyle}>Reply-to (opțional)</label>
            <input
              type="text"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="reply@example.com"
              style={inputStyle}
              autoComplete="off"
              spellCheck={false}
            />
          </>
        )}

        {invalidAddr && (
          <div style={{ marginTop: 10, fontSize: 12, color: '#ff8a8a' }}>
            Adresă invalidă: <code>{invalidAddr}</code>
          </div>
        )}

        {status && status !== 'sent' && status.error && (
          <div style={{ marginTop: 10, padding: 10, background: '#3a1d1d', color: '#ff8a8a', borderRadius: 8, fontSize: 13 }}>
            {status.error}
          </div>
        )}

        {status === 'sent' && (
          <div style={{ marginTop: 10, padding: 10, background: '#143a26', color: '#7ed9a3', borderRadius: 8, fontSize: 13 }}>
            Trimis.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button
            type="button"
            onClick={() => { if (!busy && status !== 'sent') closeComposer() }}
            disabled={busy || status === 'sent'}
            style={btnGhost}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            style={btnPrimary}
          >
            {busy ? 'Trimit...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
