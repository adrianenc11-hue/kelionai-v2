// Admin Payouts page — Stripe balance, destination, payout history, instant payout.

import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { KpiCard, Skeleton, useToast, ConfirmModal } from './AdminComponents'

function fmtSchedule(s) {
  if (!s?.interval) return '—'
  if (s.interval === 'manual') return 'Manual (doar instant)'
  if (s.interval === 'daily') return `Zilnic (T+${s.delayDays ?? '?'} zile)`
  if (s.interval === 'weekly') return `Săptămânal${s.weeklyAnchor ? ' · ' + s.weeklyAnchor : ''}`
  if (s.interval === 'monthly') return `Lunar${s.monthlyAnchor ? ' · ziua ' + s.monthlyAnchor : ''}`
  return s.interval
}

export default function PayoutsPage() {
  const { getCsrfToken } = useOutletContext()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [instantModal, setInstantModal] = useState(false)
  const [busy, setBusy] = useState(false)

  const fetchPayouts = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/payouts?days=30', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setData(await r.json())
    } catch (err) { toast?.error?.(err.message) }
    finally { setLoading(false) }
  }, [toast])

  useEffect(() => { fetchPayouts() }, [fetchPayouts])

  const handleInstant = useCallback(async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/payouts/instant', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      toast?.success?.(`OK — ${body.display} · status ${body.status}`)
      setInstantModal(false)
      fetchPayouts()
    } catch (err) { toast?.error?.(err.message) }
    finally { setBusy(false) }
  }, [getCsrfToken, fetchPayouts, toast])

  const bal = data?.balance || {}
  const fmt = (b) => b?.display || '—'
  const dest = data?.destination
  const recent = Array.isArray(data?.recentPayouts) ? data.recentPayouts : []
  const split = data?.split || {}
  const canInstant = data?.instantEligible && bal.instantAvailable?.amount > 0

  if (loading) return <div><Skeleton height={400} /></div>

  if (!data?.configured) {
    return (
      <div className="admin-card" style={{ textAlign: 'center', padding: 48 }}>
        <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>💳</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Stripe nu e configurat</div>
        <div style={{ fontSize: 13, color: 'var(--admin-text-dim)' }}>
          Setează STRIPE_SECRET_KEY pe server pentru a vedea soldul real.
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="kpi-grid">
        <KpiCard icon="💰" label="Disponibil" value={fmt(bal.available)} accent="var(--admin-green)" />
        <KpiCard icon="⏳" label="În tranzit" value={fmt(bal.pending)} accent="var(--admin-amber)" />
        <KpiCard icon="⚡" label="Eligibil instant" value={fmt(bal.instantAvailable)} accent="var(--admin-accent)" />
      </div>

      {/* Destination + Schedule */}
      {dest && (
        <div className="admin-card">
          <div className="admin-card-title" style={{ marginBottom: 12 }}>📬 Destinație Payout</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--admin-text-dim)' }}>Tip</span>
              <span>{dest.type === 'card' ? `Card ${dest.brand || ''} •••• ${dest.last4 || '?'}` :
                     dest.type === 'bank_account' ? `IBAN •••• ${dest.last4 || '?'} (${dest.country || ''})` :
                     dest.type || '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--admin-text-dim)' }}>Program</span>
              <span>{fmtSchedule(data.schedule)}</span>
            </div>
          </div>
        </div>
      )}

      {/* 50/50 Split */}
      <div className="admin-card">
        <div className="admin-card-title" style={{ marginBottom: 12 }}>📊 Split 50/50 · ultimele {split.window?.days || 30} zile</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--admin-text-dim)' }}>Venit brut</span>
            <span style={{ fontWeight: 600 }}>{split.revenue?.grossDisplay || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--admin-text-dim)' }}>Rezervat AI</span>
            <span>{split.allocation?.display || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--admin-text-dim)' }}>Profit net</span>
            <span style={{ fontWeight: 700, color: 'var(--admin-green)' }}>{split.allocation?.ownerDisplay || '—'}</span>
          </div>
        </div>
      </div>

      {/* Instant payout button */}
      <button
        className={`admin-btn ${canInstant ? 'primary' : ''}`}
        style={{ width: '100%', justifyContent: 'center', padding: '14px 20px', marginBottom: 16 }}
        disabled={!canInstant || busy}
        onClick={() => setInstantModal(true)}
      >
        {canInstant ? '⚡ Instant payout pe card (~30 min, taxa ~1% + 0.25 EUR)' : '⚡ Instant payout indisponibil'}
      </button>

      {/* Recent payouts */}
      {recent.length > 0 && (
        <div className="admin-card">
          <div className="admin-card-title" style={{ marginBottom: 12 }}>📋 Ultimele payout-uri</div>
          <div style={{ fontSize: 13 }}>
            {recent.slice(0, 10).map((p) => (
              <div key={p.id} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}>
                <span style={{ color: 'var(--admin-text-dim)' }}>
                  {p.createdMs ? new Date(p.createdMs).toLocaleDateString('ro-RO') : '—'} · {p.method || 'standard'}
                </span>
                <span>
                  {p.display || '—'} <span style={{ opacity: 0.5 }}>· {p.status}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmModal
        open={instantModal}
        title="Instant Payout"
        message="Transferi soldul disponibil pe cardul legat acum. Taxa Stripe ~1% + 0.25 EUR. Acțiunea nu poate fi anulată."
        confirmLabel="Transferă acum"
        danger
        busy={busy}
        onConfirm={handleInstant}
        onCancel={() => setInstantModal(false)}
      />
    </div>
  )
}
