// Admin AI Credits page — provider health, auto-topup status, grant form.

import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { KpiCard, Skeleton, useToast, InputModal } from './AdminComponents'
import { ensureCsrfToken } from '../../lib/api'

function friendlyStatus(card) {
  if (!card) return { headline: '—', tone: 'muted' }
  switch (card.status) {
    case 'ok': return { headline: 'Credit suficient ✓', tone: 'ok' }
    case 'low': return { headline: 'Credit aproape terminat — reîncarcă →', tone: 'warn' }
    case 'error': return { headline: 'Problemă cu cheia — verifică →', tone: 'error' }
    case 'unconfigured': return { headline: 'Neconfigurat', tone: 'muted' }
    default: return { headline: card.balanceDisplay || 'Necunoscut', tone: 'muted' }
  }
}

export default function AiCreditsPage() {
  const { getCsrfToken } = useOutletContext()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [cards, setCards] = useState([])
  const [autoTopup, setAutoTopup] = useState(null)
  const [split, setSplit] = useState(null)
  const [grantModal, setGrantModal] = useState({ open: false })
  const [grantBusy, setGrantBusy] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const opts = { credentials: 'include' }
      const [cR, sR] = await Promise.allSettled([
        fetch('/api/admin/credits', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/revenue-split?days=30', opts).then(r => r.ok ? r.json() : null),
      ])
      if (cR.status === 'fulfilled' && cR.value) {
        setCards(Array.isArray(cR.value.cards) ? cR.value.cards : [])
        setAutoTopup(cR.value.autoTopup || null)
      }
      if (sR.status === 'fulfilled') setSplit(sR.value)
    } catch (_) {
      toast?.error?.('Nu am putut încărca AI credits')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleGrant = useCallback(async (values) => {
    const email = (values.email || '').trim().toLowerCase()
    const minutes = Number(values.minutes)
    if (!email || !/.+@.+\..+/.test(email)) {
      toast?.error?.('Introdu un email valid')
      return
    }
    if (!Number.isFinite(minutes) || minutes === 0) {
      toast?.error?.('Introdu un număr valid de minute')
      return
    }
    setGrantBusy(true)
    try {
      const rand = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const idempotencyKey = `admin:${email}:${minutes}:${rand}`
      const csrf = await ensureCsrfToken()
      const r = await fetch('/api/admin/credits/grant', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf || getCsrfToken(),
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ email, minutes: Math.trunc(minutes), note: values.note || '', idempotencyKey }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      toast?.success?.(body.duplicate
        ? `Deja acordat (duplicat). Sold: ${body.balanceMinutes} min.`
        : `Acordat ${body.deltaMinutes} min → ${body.email}. Sold: ${body.balanceMinutes} min.`
      )
      setGrantModal({ open: false })
    } catch (err) {
      toast?.error?.(err.message)
    } finally {
      setGrantBusy(false)
    }
  }, [getCsrfToken, toast])

  const toneColors = { ok: 'var(--admin-green)', warn: 'var(--admin-amber)', error: 'var(--admin-red)', muted: 'var(--admin-text-dim)' }
  const toneBg = { ok: 'var(--admin-green-bg)', warn: 'var(--admin-amber-bg)', error: 'var(--admin-red-bg)', muted: 'var(--admin-surface-2)' }

  return (
    <div>
      {/* Split overview */}
      {split && (
        <div className="kpi-grid" style={{ marginBottom: 20 }}>
          <KpiCard icon="💰" label="Venit brut (30z)" value={split.revenue?.grossDisplay || '—'} accent="#10b981" />
          <KpiCard icon="🧠" label={`Alocare AI (${Math.round((split.fraction || 0.5) * 100)}%)`} value={split.allocation?.display || '—'} accent="#f472b6" />
          <KpiCard icon="💸" label="Profit net" value={split.allocation?.ownerDisplay || '—'} accent="#a78bfa" />
        </div>
      )}

      {/* Auto-topup status */}
      {autoTopup && (
        <div className="admin-card" style={{ marginBottom: 16 }}>
          <div className="admin-card-title" style={{ marginBottom: 8 }}>⚡ Auto-Topup</div>
          <div style={{ fontSize: 13, color: 'var(--admin-text-dim)' }}>
            {autoTopup.enabled
              ? `Activ · Prag: ${autoTopup.threshold} · Sumă: ${autoTopup.amount} · Ultimul: ${autoTopup.lastRun || '—'}`
              : 'Dezactivat'
            }
          </div>
        </div>
      )}

      {/* Provider cards */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div className="admin-card-title">🔌 Provideri AI</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="admin-btn sm" onClick={() => setGrantModal({ open: true })}>
              💰 Acordă credite
            </button>
            <button className="admin-btn sm" onClick={fetchAll} disabled={loading}>
              {loading ? '…' : '🔄 Refresh'}
            </button>
          </div>
        </div>
        {loading ? <Skeleton height={120} count={3} /> : (
          cards.length === 0 ? (
            <div className="admin-empty">
              <div className="admin-empty-icon">🔌</div>
              <div className="admin-empty-text">Niciun provider AI configurat.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {cards.map((card, i) => {
                const st = friendlyStatus(card)
                return (
                  <div key={i} style={{
                    padding: '16px 20px',
                    background: toneBg[st.tone],
                    borderRadius: 10,
                    border: `1px solid ${toneColors[st.tone]}30`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                  }}>
                    <span className={`status-dot ${st.tone === 'ok' ? 'online' : st.tone === 'error' ? 'offline' : 'warning'}`} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {card.providerLabel || card.provider || `Provider ${i + 1}`}
                      </div>
                      <div style={{ fontSize: 13, color: toneColors[st.tone], marginTop: 2 }}>
                        {st.headline}
                      </div>
                      {card.balanceDisplay && (
                        <div style={{ fontSize: 12, color: 'var(--admin-text-dim)', marginTop: 4 }}>
                          Sold: {card.balanceDisplay}
                        </div>
                      )}
                      {card.message && (
                        <div style={{ fontSize: 11, color: 'var(--admin-text-muted)', marginTop: 2 }}>
                          {card.message}
                        </div>
                      )}
                    </div>
                    {card.dashboardUrl && (
                      <a
                        href={card.dashboardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="admin-btn sm"
                        style={{ textDecoration: 'none' }}
                      >
                        Deschide →
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      <InputModal
        open={grantModal.open}
        title="Acordă credite — formular admin"
        fields={[
          { key: 'email', label: 'Email utilizator', placeholder: 'user@kelionai.app' },
          { key: 'minutes', label: 'Minute (negativ = retragi)', placeholder: '33', type: 'number' },
          { key: 'note', label: 'Notă (opțional)', placeholder: 'Refund, compensare, bonus…' },
        ]}
        submitLabel="Acordă"
        busy={grantBusy}
        onSubmit={handleGrant}
        onCancel={() => setGrantModal({ open: false })}
      />
    </div>
  )
}
