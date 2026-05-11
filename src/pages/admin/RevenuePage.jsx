// Admin Revenue page — full revenue overview with chart, transactions, export.

import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import { KpiCard, KpiSkeleton, SparkChart, DataTable, Skeleton, useToast } from './AdminComponents'

export default function RevenuePage() {
  const { getCsrfToken } = useOutletContext()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [business, setBusiness] = useState(null)
  const [revenueChart, setRevenueChart] = useState(null)
  const [split, setSplit] = useState(null)
  const [ledger, setLedger] = useState([])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const opts = { credentials: 'include' }
      const [bizR, revR, splitR, ledR] = await Promise.allSettled([
        fetch('/api/admin/business?days=30', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/revenue-chart?days=30', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/revenue-split?days=30', opts).then(r => r.ok ? r.json() : null),
        fetch('/api/admin/credits/ledger?limit=100', opts).then(r => r.ok ? r.json() : null),
      ])
      if (bizR.status === 'fulfilled') setBusiness(bizR.value)
      if (revR.status === 'fulfilled') setRevenueChart(revR.value)
      if (splitR.status === 'fulfilled') setSplit(splitR.value)
      if (ledR.status === 'fulfilled') setLedger(Array.isArray(ledR.value?.rows) ? ledR.value.rows : [])
    } catch (_) {
      toast?.error?.('Eroare la încărcarea datelor de venit')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Auto-refresh ledger every 5s
  useEffect(() => {
    const iv = setInterval(async () => {
      try {
        const r = await fetch('/api/admin/credits/ledger?limit=100', { credentials: 'include' })
        if (r.ok) {
          const j = await r.json()
          setLedger(Array.isArray(j.rows) ? j.rows : [])
        }
      } catch (_) {}
    }, 5000)
    return () => clearInterval(iv)
  }, [])

  const biz = business?.ledger || {}
  const revenue = (biz.revenueCents || 0) / 100
  const allocPct = split?.fraction || 0.5

  const ledgerColumns = [
    {
      key: 'email',
      label: 'Utilizator',
      render: (v) => v || '—',
    },
    {
      key: 'type',
      label: 'Tip',
      render: (v) => {
        const colors = {
          topup: 'green', consume: 'red', admin_grant: 'purple',
          refund: 'amber', expire: 'red',
        }
        return <span className={`admin-badge ${colors[v] || 'blue'}`}>{v || '—'}</span>
      },
    },
    {
      key: 'minutes',
      label: 'Minute',
      render: (v) => (
        <span style={{
          fontVariantNumeric: 'tabular-nums', fontWeight: 600,
          color: v > 0 ? 'var(--admin-green)' : 'var(--admin-red)',
        }}>
          {v > 0 ? `+${v}` : v}
        </span>
      ),
    },
    {
      key: 'note',
      label: 'Notă',
      render: (v) => <span style={{ color: 'var(--admin-text-dim)' }}>{v || ''}</span>,
    },
    {
      key: 'createdAt',
      label: 'Dată',
      render: (v) => v ? new Date(v).toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
    },
  ]

  const download = (path) => {
    const a = document.createElement('a')
    a.href = path
    a.download = ''
    a.click()
  }

  return (
    <div>
      {loading ? <KpiSkeleton /> : (
        <div className="kpi-grid">
          <KpiCard icon="💰" label="Venit brut (30z)" value={`£${revenue.toFixed(2)}`} accent="#10b981" sub={`${biz.topups || 0} top-ups`} />
          <KpiCard icon="🧠" label="Alocare AI" value={`£${(revenue * allocPct).toFixed(2)}`} accent="#f472b6" sub={`${Math.round(allocPct * 100)}% din brut`} />
          <KpiCard icon="💸" label="Profit net" value={`£${(revenue * (1 - allocPct)).toFixed(2)}`} accent="#a78bfa" sub="după deducere AI" />
          <KpiCard icon="⏱️" label="Min vândute / consumate" value={`${biz.minutesSold || 0} / ${biz.minutesConsumed || 0}`} accent="#60a5fa" />
        </div>
      )}

      {/* Revenue chart */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div className="admin-card-title">📈 Topup vs Consum / Zi — 30 Zile</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="admin-btn sm" onClick={() => download('/api/admin/export/transactions.csv')}>📥 Export CSV</button>
          </div>
        </div>
        {loading ? <Skeleton height={180} /> : (
          revenueChart?.days ? (
            <SparkChart
              data={revenueChart.days}
              valueKey="topupMinutes"
              labelKey="date"
              color="var(--admin-green)"
              secondLine="consumeMinutes"
              secondColor="var(--admin-pink)"
            />
          ) : <div className="admin-empty"><div className="admin-empty-text">Nicio dată de revenue.</div></div>
        )}
      </div>

      {/* Live ledger */}
      <div className="admin-card">
        <div className="admin-card-header">
          <div className="admin-card-title">📋 Tranzacții Recente</div>
          <span style={{ fontSize: 11, color: 'var(--admin-text-dim)' }}>Auto-refresh 5s</span>
        </div>
        {loading ? <Skeleton height={200} /> : (
          <DataTable columns={ledgerColumns} data={ledger} emptyText="Nicio tranzacție încă." />
        )}
      </div>
    </div>
  )
}
