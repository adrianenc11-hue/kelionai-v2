// Admin Visitors / Analytics page

import { useState, useEffect, useCallback } from 'react'
import { KpiCard, KpiSkeleton, SparkChart, BarChart, DataTable, Skeleton, useToast } from './AdminComponents'

function flagEmoji(code) {
  if (!code || typeof code !== 'string' || code.length < 2) return ''
  const cc = code.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  const base = 0x1f1e6 - 65
  return String.fromCodePoint(base + cc.charCodeAt(0), base + cc.charCodeAt(1))
}

export default function VisitorsPage() {
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [analytics, setAnalytics] = useState(null)
  const [visits, setVisits] = useState([])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const opts = { credentials: 'include' }
      const [anaR, rawR] = await Promise.allSettled([
        fetch('/api/admin/visitors/analytics?days=30', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/visitors?limit=200&windowHours=24', opts).then(r => r.ok ? r.json() : null),
      ])
      if (anaR.status === 'fulfilled') setAnalytics(anaR.value)
      if (rawR.status === 'fulfilled') setVisits(Array.isArray(rawR.value?.visits) ? rawR.value.visits : [])
    } catch (_) {
      toast?.error?.('Eroare la încărcarea analytics')
    } finally { setLoading(false) }
  }, [toast])

  useEffect(() => { fetchAll() }, [fetchAll])
  useEffect(() => { const iv = setInterval(fetchAll, 10000); return () => clearInterval(iv) }, [fetchAll])

  const totals = analytics?.totals || {}
  const byCountry = Array.isArray(analytics?.byCountry) ? analytics.byCountry : []
  const byDevice = analytics?.byDevice || {}
  const byBrowser = Array.isArray(analytics?.byBrowser) ? analytics.byBrowser : []
  const byOs = Array.isArray(analytics?.byOs) ? analytics.byOs : []
  const topReferrers = Array.isArray(analytics?.topReferrers) ? analytics.topReferrers : []
  const byDay = Array.isArray(analytics?.byDay) ? analytics.byDay : []
  const funnel = analytics?.funnel || {}

  const deviceItems = [
    { key: 'Desktop', count: byDevice.desktop || 0 },
    { key: 'Mobil', count: byDevice.mobile || 0 },
    { key: 'Tabletă', count: byDevice.tablet || 0 },
  ].filter(d => d.count > 0)

  const funnelSteps = [
    { key: 'Vizite', count: funnel.visits || 0 },
    { key: 'Cu cont logat', count: funnel.signedInVisits || 0 },
    { key: 'Unici logați', count: funnel.uniqueSignedInUsers || 0 },
    { key: 'Au făcut top-up', count: funnel.usersWithTopup || 0 },
    { key: 'Au consumat', count: funnel.usersWithConsumption || 0 },
  ]

  const visitColumns = [
    { key: 'ip', label: 'IP', render: (v) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v || '—'}</span> },
    { key: 'country', label: 'Țară', render: (v) => <span>{flagEmoji(v)} {v || '—'}</span> },
    { key: 'email', label: 'User', render: (v) => v || <span style={{ opacity: 0.4 }}>guest</span> },
    { key: 'path', label: 'Pagină', render: (v) => v || '/' },
    { key: 'createdAt', label: 'Ora', render: (v) => v ? new Date(v).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }) : '—' },
  ]

  const loginRate = totals.visits > 0 ? Math.round((totals.signedInVisits * 100) / totals.visits) : 0

  return (
    <div>
      {loading ? <KpiSkeleton /> : (
        <div className="kpi-grid">
          <KpiCard icon="👁️" label="Vizite (30z)" value={totals.visits?.toLocaleString() || 0} accent="var(--admin-accent)" />
          <KpiCard icon="👤" label="Utilizatori unici" value={totals.uniqueUsers || 0} accent="var(--admin-blue)" />
          <KpiCard icon="🔑" label="% Logați" value={`${loginRate}%`} accent="var(--admin-green)" />
          <KpiCard icon="🌍" label="Țări" value={byCountry.length} accent="var(--admin-pink)" />
        </div>
      )}

      <div className="admin-card">
        <div className="admin-card-header">
          <div className="admin-card-title">📈 Trafic / Zi — 30 Zile</div>
          <button className="admin-btn sm" onClick={fetchAll} disabled={loading}>{loading ? '…' : '🔄'}</button>
        </div>
        {loading ? <Skeleton height={180} /> : (
          byDay.length > 0
            ? <SparkChart data={byDay} valueKey="count" labelKey="day" color="var(--admin-accent)" height={160} />
            : <div className="admin-empty"><div className="admin-empty-text">Nicio dată.</div></div>
        )}
      </div>

      <div className="admin-grid-2">
        <div className="admin-card">
          <div className="admin-card-title" style={{ marginBottom: 12 }}>🌍 Geografie · {byCountry.length} țări</div>
          <BarChart data={byCountry.slice(0, 12).map(c => ({ key: `${flagEmoji(c.country)} ${c.country}`, count: c.count }))} color="var(--admin-accent)" />
        </div>
        <div className="admin-card">
          <div className="admin-card-title" style={{ marginBottom: 12 }}>📱 Dispozitive & Browser</div>
          <BarChart data={deviceItems} color="var(--admin-blue)" />
          <div style={{ marginTop: 16, fontSize: 11, fontWeight: 600, color: 'var(--admin-text-dim)', marginBottom: 6 }}>BROWSER</div>
          <BarChart data={byBrowser.slice(0, 6)} color="var(--admin-accent)" />
          <div style={{ marginTop: 16, fontSize: 11, fontWeight: 600, color: 'var(--admin-text-dim)', marginBottom: 6 }}>SISTEM</div>
          <BarChart data={byOs.slice(0, 6)} color="var(--admin-pink)" />
        </div>
      </div>

      <div className="admin-grid-2">
        <div className="admin-card">
          <div className="admin-card-title" style={{ marginBottom: 12 }}>🔗 Referrers</div>
          {topReferrers.length > 0
            ? <BarChart data={topReferrers.slice(0, 8)} color="var(--admin-green)" />
            : <div style={{ fontSize: 12, opacity: 0.4 }}>Doar trafic direct.</div>}
        </div>
        <div className="admin-card">
          <div className="admin-card-title" style={{ marginBottom: 12 }}>🎯 Funnel: Vizită → Client</div>
          <BarChart data={funnelSteps} color="var(--admin-accent)" />
        </div>
      </div>

      <div className="admin-card" style={{ marginTop: 8 }}>
        <div className="admin-card-header">
          <div className="admin-card-title">📋 Vizite Recente (24h)</div>
          <span style={{ fontSize: 11, color: 'var(--admin-text-dim)' }}>Auto-refresh 10s</span>
        </div>
        {loading ? <Skeleton height={200} /> : (
          <DataTable columns={visitColumns} data={visits} emptyText="Nicio vizită în ultimele 24h." pageSize={30} />
        )}
      </div>
    </div>
  )
}
