// Consensual voice-clone flow.
//
// Three-panel modal:
//   1. Consent   — legal copy + checkboxes + typed full-name signature.
//   2. Record    — read three passages, stop when >=30s captured; allow
//                  re-record + playback; upload to the server.
//   3. Manage    — shows current clone state + toggle to use cloned voice
//                  in Kelion's replies + delete button.
//
// Everything is opt-in. Nothing records until the user clicks "Start
// recording" on panel 2 *after* ticking all three consent checkboxes
// and typing their full name as a digital signature. The MediaRecorder
// runs entirely in the browser — the sample is never sent anywhere
// until the user clicks "Upload to ElevenLabs". There is no background
// capture, no silent recording.
//
// Server contract:
//   GET    /api/voice/clone          → { voice: { voiceId, enabled, consentAt, consentVersion } }
//   POST   /api/voice/clone          → { audioBase64, mimeType, consent:true, consentVersion, displayName }
//   PATCH  /api/voice/clone          → { enabled: boolean }
//   DELETE /api/voice/clone          → clears the clone on ElevenLabs + DB

import { useCallback, useEffect, useRef, useState } from 'react'

const CONSENT_VERSION = '2026-04-20.v1'
const MIN_SECONDS = 30
const TARGET_SECONDS = 60
const MAX_SECONDS = 180
const SAMPLE_PASSAGES = [
  'Hi, my name is [your name] and I am recording this sample so that Kelion can speak in my voice. I give my explicit consent to this recording.',
  'The quick brown fox jumps over the lazy dog. She sells seashells by the seashore. Peter Piper picked a peck of pickled peppers.',
  'I understand this sample will be uploaded to ElevenLabs to create a voice clone tied only to my account, that I can delete it at any time, and that it will only be used for Kelion\'s replies to me.',
]

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mt)) return mt
  }
  return 'audio/webm'
}

function fmt(n) {
  const s = Math.max(0, Math.floor(n))
  const mm = String(Math.floor(s / 60)).padStart(1, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const str = String(reader.result || '')
      const comma = str.indexOf(',')
      resolve(comma >= 0 ? str.slice(comma + 1) : str)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export default function VoiceCloneModal({ open, onClose, userEmail, userName }) {
  const [step, setStep] = useState('loading')
  const [existing, setExisting] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  // Consent panel state
  const [agree1, setAgree1] = useState(false)
  const [agree2, setAgree2] = useState(false)
  const [agree3, setAgree3] = useState(false)
  const [signature, setSignature] = useState('')

  // Recording panel state
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [sampleBlob, setSampleBlob] = useState(null)
  const [sampleUrl, setSampleUrl] = useState(null)
  const mediaRecorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const resetRecording = useCallback(() => {
    try { if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop() } catch (_) { /* ignore */ }
    try { streamRef.current && streamRef.current.getTracks().forEach(t => t.stop()) } catch (_) { /* ignore */ }
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setRecording(false)
    setElapsed(0)
    if (sampleUrl) { try { URL.revokeObjectURL(sampleUrl) } catch (_) {} }
    setSampleBlob(null)
    setSampleUrl(null)
  }, [sampleUrl])

  // Load existing state when modal opens.
  useEffect(() => {
    if (!open) return
    let alive = true
    setError(null)
    setBusy(false)
    setStep('loading')
    fetch('/api/voice/clone', { credentials: 'include' })
      .then(async (r) => {
        if (!alive) return
        if (r.status === 401) {
          setError('Sign in to clone your voice.')
          setStep('error')
          return
        }
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setError((j && j.error) || 'Failed to load voice clone state.')
          setStep('error')
          return
        }
        const voice = (j && j.voice) || null
        setExisting(voice && voice.voiceId ? voice : null)
        setStep(voice && voice.voiceId ? 'manage' : 'consent')
      })
      .catch(() => {
        if (!alive) return
        setError('Failed to contact the server.')
        setStep('error')
      })
    return () => {
      alive = false
      resetRecording()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => () => resetRecording(), [resetRecording])

  // ESC to close (only when nothing is recording/uploading).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape' && !recording && !busy) {
        onClose && onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, recording, busy, onClose])

  const canConsent =
    agree1 && agree2 && agree3 &&
    signature.trim().length >= 3 &&
    (!userEmail || signature.trim().length >= 3)

  const startRecording = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError('Your browser does not support microphone capture.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || mimeType || 'audio/webm' })
        setSampleBlob(blob)
        const url = URL.createObjectURL(blob)
        setSampleUrl(url)
        try { streamRef.current && streamRef.current.getTracks().forEach(t => t.stop()) } catch (_) {}
        streamRef.current = null
      }
      mediaRecorderRef.current = mr
      mr.start()
      setRecording(true)
      setElapsed(0)
      if (timerRef.current) clearInterval(timerRef.current)
      timerRef.current = setInterval(() => {
        setElapsed((v) => {
          if (v + 1 >= MAX_SECONDS) {
            // Auto-stop at the hard ceiling.
            try { mr.state !== 'inactive' && mr.stop() } catch (_) { /* ignore */ }
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
            setRecording(false)
            return MAX_SECONDS
          }
          return v + 1
        })
      }, 1000)
    } catch (err) {
      console.warn('[voice-clone] getUserMedia failed', err)
      setError(err && err.name === 'NotAllowedError'
        ? 'Microphone access was denied.'
        : 'Could not access the microphone.')
    }
  }, [])

  const stopRecording = useCallback(() => {
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
    } catch (_) { /* ignore */ }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setRecording(false)
  }, [])

  const uploadSample = useCallback(async () => {
    if (!sampleBlob) { setError('Record a sample first.'); return }
    if (elapsed < MIN_SECONDS) {
      setError(`Please record at least ${MIN_SECONDS} seconds.`)
      return
    }
    setError(null)
    setBusy(true)
    try {
      const audioBase64 = await blobToBase64(sampleBlob)
      const r = await fetch('/api/voice/clone', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64,
          mimeType: sampleBlob.type || 'audio/webm',
          consent: true,
          consentVersion: CONSENT_VERSION,
          displayName: userName ? `Kelion — ${userName}` : undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error((j && j.error) || `Upload failed (${r.status}).`)
      }
      setExisting(j.voice || null)
      setStep('manage')
      resetRecording()
    } catch (err) {
      setError(err.message || 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }, [sampleBlob, elapsed, userName, resetRecording])

  const toggleEnabled = useCallback(async (next) => {
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/voice/clone', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: Boolean(next) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((j && j.error) || 'Toggle failed.')
      setExisting(j.voice || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [])

  const deleteClone = useCallback(async () => {
    if (!window.confirm('Delete your cloned voice? This also removes it from ElevenLabs. This cannot be undone.')) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/voice/clone', { method: 'DELETE', credentials: 'include' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((j && j.error) || 'Delete failed.')
      setExisting(null)
      setAgree1(false); setAgree2(false); setAgree3(false); setSignature('')
      setStep('consent')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }, [])

  if (!open) return null

  return (
    <div
      onClick={() => { if (!recording && !busy) onClose && onClose() }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(3, 4, 10, 0.65)',
        backdropFilter: 'blur(6px)',
        zIndex: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Voice clone"
        style={{
          width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto',
          background: 'rgba(14, 10, 28, 0.96)',
          border: '1px solid rgba(167, 139, 250, 0.35)',
          borderRadius: 18, padding: 24,
          color: '#ede9fe', fontSize: 14, lineHeight: 1.5,
          boxShadow: '0 28px 80px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Clone my voice</h2>
          <button
            type="button"
            onClick={() => { if (!recording && !busy) onClose && onClose() }}
            disabled={recording || busy}
            style={{
              background: 'transparent', color: '#cbd5f5',
              border: 'none', fontSize: 22, cursor: recording || busy ? 'not-allowed' : 'pointer',
              lineHeight: 1, padding: 4,
            }}
            aria-label="Close"
          >×</button>
        </div>

        {error && (
          <div style={{
            background: 'rgba(80, 14, 14, 0.4)', color: '#fecaca',
            border: '1px solid rgba(239, 68, 68, 0.45)',
            padding: '8px 12px', borderRadius: 10, marginBottom: 12, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        {step === 'loading' && (
          <div style={{ padding: 16 }}>Loading…</div>
        )}

        {step === 'error' && (
          <div style={{ padding: 12 }}>
            <button type="button" onClick={onClose} style={primaryBtn}>Close</button>
          </div>
        )}

        {step === 'consent' && (
          <>
            <p style={{ marginTop: 0 }}>
              Kelion can speak in <strong>your own voice</strong> by uploading a short
              recording of you to <strong>ElevenLabs</strong> and using the voice
              clone only when replying to <em>you</em>. Before we record anything,
              please read and agree:
            </p>
            <ul style={{ paddingLeft: 18, margin: '8px 0 16px' }}>
              <li>We record ~{TARGET_SECONDS} seconds of your voice in this browser, only after you click <em>Start recording</em>.</li>
              <li>The audio sample is uploaded to ElevenLabs, who returns a voice ID tied to your account.</li>
              <li>The clone is used only for Kelion's replies to you — never for anyone else, never without the toggle in Manage being on.</li>
              <li>You can delete the clone at any time. Delete removes it from ElevenLabs and from our database.</li>
              <li>We keep an audit log (create / enable / disable / delete / synthesize) so we can prove how the clone was used.</li>
            </ul>
            <label style={checkboxRow}>
              <input type="checkbox" checked={agree1} onChange={(e) => setAgree1(e.target.checked)} />
              I am the person whose voice is being recorded, and I consent to this recording.
            </label>
            <label style={checkboxRow}>
              <input type="checkbox" checked={agree2} onChange={(e) => setAgree2(e.target.checked)} />
              I consent to the sample being uploaded to ElevenLabs to create a voice clone tied to my Kelion account.
            </label>
            <label style={checkboxRow}>
              <input type="checkbox" checked={agree3} onChange={(e) => setAgree3(e.target.checked)} />
              I understand I can delete the clone at any time from this screen.
            </label>
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
                Type your full name as a digital signature
              </label>
              <input
                type="text"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={userName || 'Full name'}
                style={inputStyle}
              />
              {userEmail && (
                <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                  Signed as {userEmail} · consent version {CONSENT_VERSION}
                </div>
              )}
            </div>
            <div style={btnRow}>
              <button type="button" onClick={onClose} style={secondaryBtn} disabled={busy}>Cancel</button>
              <button
                type="button"
                onClick={() => setStep('record')}
                disabled={!canConsent}
                style={{ ...primaryBtn, opacity: canConsent ? 1 : 0.5 }}
              >
                Continue to recording
              </button>
            </div>
          </>
        )}

        {step === 'record' && (
          <>
            <p style={{ marginTop: 0 }}>
              Read the three passages below in a natural voice. Aim for at least
              {' '}<strong>{MIN_SECONDS} seconds</strong>{' '} (ideal ~{TARGET_SECONDS}s).
              Use a quiet room and a decent microphone for best results.
            </p>
            <ol style={{ paddingLeft: 18, margin: '0 0 16px' }}>
              {SAMPLE_PASSAGES.map((p, i) => (
                <li key={i} style={{ marginBottom: 6 }}>{p}</li>
              ))}
            </ol>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px',
              background: 'rgba(167, 139, 250, 0.08)',
              border: '1px solid rgba(167, 139, 250, 0.22)',
              borderRadius: 10, marginBottom: 12,
            }}>
              <span>
                <span style={{
                  display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                  background: recording ? '#ef4444' : '#64748b',
                  boxShadow: recording ? '0 0 10px #ef4444' : 'none',
                  marginRight: 8, verticalAlign: 'middle',
                }} />
                {recording ? 'Recording…' : sampleBlob ? 'Captured' : 'Ready'}
              </span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                {fmt(elapsed)} / {fmt(MAX_SECONDS)}
              </span>
            </div>
            {!recording && !sampleBlob && (
              <div style={btnRow}>
                <button type="button" onClick={() => setStep('consent')} style={secondaryBtn}>Back</button>
                <button type="button" onClick={startRecording} style={primaryBtn}>Start recording</button>
              </div>
            )}
            {recording && (
              <div style={btnRow}>
                <button type="button" onClick={stopRecording} style={primaryBtn}>
                  Stop {elapsed < MIN_SECONDS && `(${MIN_SECONDS - elapsed}s left to minimum)`}
                </button>
              </div>
            )}
            {!recording && sampleBlob && (
              <>
                <audio src={sampleUrl} controls style={{ width: '100%', marginBottom: 12 }} />
                <div style={btnRow}>
                  <button type="button" onClick={resetRecording} style={secondaryBtn} disabled={busy}>
                    Re-record
                  </button>
                  <button
                    type="button"
                    onClick={uploadSample}
                    disabled={busy || elapsed < MIN_SECONDS}
                    style={{ ...primaryBtn, opacity: (busy || elapsed < MIN_SECONDS) ? 0.5 : 1 }}
                  >
                    {busy ? 'Uploading…' : 'Upload to ElevenLabs'}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {step === 'manage' && (
          <>
            <p style={{ marginTop: 0 }}>
              You have a cloned voice on file. Kelion can use it when replying to you.
            </p>
            <div style={{
              background: 'rgba(167, 139, 250, 0.08)',
              border: '1px solid rgba(167, 139, 250, 0.22)',
              borderRadius: 10, padding: '10px 12px', marginBottom: 12, fontSize: 13,
            }}>
              <div><strong>Voice ID:</strong> <code style={{ opacity: 0.8 }}>{existing && existing.voiceId}</code></div>
              {existing && existing.consentAt && (
                <div><strong>Consented:</strong> {new Date(existing.consentAt).toLocaleString()}</div>
              )}
              {existing && existing.consentVersion && (
                <div><strong>Version:</strong> {existing.consentVersion}</div>
              )}
            </div>
            <label style={{ ...checkboxRow, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={Boolean(existing && existing.enabled)}
                onChange={(e) => toggleEnabled(e.target.checked)}
                disabled={busy}
              />
              Use my voice for Kelion's replies to me
            </label>
            <div style={btnRow}>
              <button type="button" onClick={deleteClone} style={destructiveBtn} disabled={busy}>
                {busy ? 'Working…' : 'Delete cloned voice'}
              </button>
              <button type="button" onClick={onClose} style={primaryBtn}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '8px 10px', borderRadius: 8,
  background: 'rgba(255,255,255,0.05)',
  color: '#ede9fe',
  border: '1px solid rgba(167, 139, 250, 0.25)',
  fontSize: 14,
}

const btnRow = {
  display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8,
}

const primaryBtn = {
  padding: '8px 14px', borderRadius: 10,
  background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
  color: 'white', border: 'none', cursor: 'pointer',
  fontSize: 14, fontWeight: 600,
}

const secondaryBtn = {
  padding: '8px 14px', borderRadius: 10,
  background: 'rgba(255,255,255,0.06)',
  color: '#ede9fe',
  border: '1px solid rgba(167, 139, 250, 0.25)',
  cursor: 'pointer',
  fontSize: 14,
}

const destructiveBtn = {
  padding: '8px 14px', borderRadius: 10,
  background: 'rgba(220, 38, 38, 0.85)',
  color: 'white', border: 'none', cursor: 'pointer',
  fontSize: 14, fontWeight: 600,
}

const checkboxRow = {
  display: 'flex', alignItems: 'flex-start', gap: 8,
  margin: '6px 0', fontSize: 13, lineHeight: 1.4,
  cursor: 'pointer',
}
