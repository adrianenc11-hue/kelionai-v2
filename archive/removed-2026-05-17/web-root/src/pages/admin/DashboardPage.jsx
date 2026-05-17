// Admin Dashboard — main overview page with KPIs, charts, live sessions, system health.

import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { KpiCard, KpiSkeleton, SparkChart, Skeleton, useToast } from './AdminComponents'

export default function DashboardPage() {
  const { getCsrfToken } = useOutletContext()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [business, setBusiness] = useState(null)
  const [revenueChart, setRevenueChart] = useState(null)
  const [sessions, setSessions] = useState(null)
  const [credits, setCredits] = useState(null)
  const [visitorsAnalytics, setVisitorsAnalytics] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const opts = { credentials: 'include' }
      const [bizR, revR, sessR, credR, visR] = await Promise.allSettled([
        fetch('/api/admin/business?days=30', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/revenue-chart?days=30', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/live-sessions', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/credits', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/visitors/analytics?days=30', opts).then(r => r.ok ? r.json() : null),
      ])
      if (bizR.status === 'fulfilled')  setBusiness(bizR.value)
      if (revR.status === 'fulfilled')  setRevenueChart(revR.value)
      if (sessR.status === 'fulfilled') setSessions(sessR.value)
      if (credR.status === 'fulfilled') setCredits(credR.value)
      if (visR.status === 'fulfilled')  setVisitorsAnalytics(visR.value)
    } catch (err) {
      toast?.error?.('Nu am putut încărca dashboard-ul')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Auto-refresh sessions every 15s
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch('/api/admin/live-sessions', { credentials: 'include' })
        if (r.ok) setSessions(await r.json())
      } catch (_) {}
    }, 15000)
    return () => clearInterval(iv)
  }, [])

  const ledger = business?.ledger || {}
  const revenue = (ledger.revenueCents || 0) / 100
  const visitors = visitorsAnalytics?.totals?.visits || 0
  const uniqueUsers = visitorsAnalytics?.totals?.uniqueUsers || 0

  return (
    <div>
      {/* KPI Row */}
      {loading ? <KpiSkeleton /> : (
        <div className="kpi-grid">
          <KpiCard
            icon="💰"
            label="Venit total (30z)"
            value={`£${revenue.toFixed(2)}`}
            sub={`${ledger.topups || 0} top-ups`}
            accent="#10b981"
          />
          <KpiCard
            icon="👥"
            label="Vizitatori (30z)"
            value={visitors.toLocaleString()}
            sub={`${uniqueUsers} unici logați`}
            accent="#60a5fa"
          />
          <KpiCard
            icon="🧠"
            label="Minute vândute"
            value={`${ledger.minutesSold || 0}`}
            sub={`${ledger.minutesConsumed || 0} consumate`}
            accent="#a78bfa"
          />
          <KpiCard
            icon="🟢"
            label="Sesiuni live"
            value={sessions?.active || 0}
            sub="acum online"
            accent="#10b981"
          />
        </div>
      )}

      {/* Charts row */}
      <div className="admin-grid-2">
        {/* Revenue Chart */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title">📈 Topup vs Consum / Zi</div>
          </div>
          {loading ? <Skeleton height={180} /> : (
            revenueChart?.days ? (
              <>
                <SparkChart
                  data={revenueChart.days}
                  valueKey="topupMinutes"
                  labelKey="date"
                  color="var(--admin-green)"
                  secondLine="consumeMinutes"
                  secondColor="var(--admin-pink)"
                />
                <div style={{ display: 'flex', gap: 16, fontSize: 11, marginTop: 8, color: 'var(--admin-text-dim)' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 3, background: 'var(--admin-green)', display: 'inline-block', borderRadius: 2 }} />
                    Topup
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 10, height: 3, background: 'var(--admin-pink)', display: 'inline-block', borderRadius: 2 }} />
                    Consum
                  </span>
                </div>
              </>
            ) : (
              <div className="admin-empty">
                <div className="admin-empty-text">Nicio dată de revenue încă.</div>
              </div>
            )
          )}
        </div>

        {/* Live Sessions */}
        <div className="admin-card">
          <div className="admin-card-header">
            <div className="admin-card-title">
              <span className="status-dot online" /> Sesiuni Live
            </div>
            <span style={{ fontSize: 11, color: 'var(--admin-text-dim)' }}>
              Auto-refresh 15s
            </span>
          </div>
          {loading ? <Skeleton height={120} /> : (
            (!sessions?.sessions || sessions.sessions.length === 0) ? (
              <div className="admin-empty">
                <div className="admin-empty-icon">💤</div>
                <div className="admin-empty-text">Nimeni online acum.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sessions.sessions.map((s, i) => (
                  <div key={s.sessionId || i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px',
                    background: 'rgba(16, 185, 129, 0.04)',
                    borderRadius: 8,
                    border: '1px solid rgba(16, 185, 129, 0.1)',
                  }}>
                    <span className="status-dot online" />
                    <span style={{ flex: 1, fontSize: 13 }}>
                      {s.userEmail || (s.isGuest ? 'Guest' : 'Necunoscut')}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--admin-text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                      {Math.floor((s.durationMs || 0) / 60000)}:{String(Math.floor(((s.durationMs || 0) % 60000) / 1000)).padStart(2, '0')}
                    </span>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* System Health — AI provider status */}
      <div className="admin-card" style={{ marginTop: 8 }}>
        <div className="admin-card-header">
          <div className="admin-card-title">🔌 Stare Sistem — Provideri AI</div>
          <button className="admin-btn sm" onClick={fetchAll} disabled={loading}>
            {loading ? 'Se încarcă…' : 'Reîmprospătează'}
          </button>
        </div>
        {loading ? <Skeleton height={60} count={3} /> : (
          credits?.cards && credits.cards.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 10 }}>
              {credits.cards.map((card, i) => {
                const statusMap = {
                  ok: { dot: 'online', badge: 'green', text: 'Operațional' },
                  low: { dot: 'warning', badge: 'amber', text: 'Credit scăzut' },
                  error: { dot: 'offline', badge: 'red', text: 'Eroare' },
                  unconfigured: { dot: 'offline', badge: 'purple', text: 'Neconfigurat' },
                }
                const st = statusMap[card.status] || statusMap.unconfigured
                return (
                  <div key={i} style={{
                    padding: '14px 16px',
                    background: 'var(--admin-surface-2)',
                    borderRadius: 10,
                    border: '1px solid var(--admin-border)',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <span className={`status-dot ${st.dot}`} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{card.providerLabel || card.provider || `Provider ${i + 1}`}</div>
                      <div style={{ fontSize: 11, color: 'var(--admin-text-dim)', marginTop: 2 }}>
                        {card.balanceDisplay || card.message || '—'}
                      </div>
                    </div>
                    <span className={`admin-badge ${st.badge}`}>{st.text}</span>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="admin-empty">
              <div className="admin-empty-text">Niciun provider AI configurat.</div>
            </div>
          )
        )}
      </div>

      {/* Visitor chart mini */}
      {visitorsAnalytics?.byDay && visitorsAnalytics.byDay.length > 0 && (
        <div className="admin-card" style={{ marginTop: 8 }}>
          <div className="admin-card-header">
            <div className="admin-card-title">📈 Trafic / Zi — Ultimele 30 Zile</div>
          </div>
          <SparkChart
            data={visitorsAnalytics.byDay}
            valueKey="count"
            labelKey="day"
            color="var(--admin-accent)"
            height={140}
          />
        </div>
      )}
    </div>
  )
}
