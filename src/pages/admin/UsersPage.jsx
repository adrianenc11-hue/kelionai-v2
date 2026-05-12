// Admin Users page — full user management with search, filter, sort,
// detail panel, ban/unban, grant credits, reset password.
// Replaces the old drawer from KelionStage.jsx.

import { useState, useEffect, useCallback } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  DataTable, UserAvatar, KpiCard, Skeleton, useToast,
  ConfirmModal, InputModal
} from './AdminComponents'
import { ensureCsrfToken } from '../../lib/api'

export default function UsersPage() {
  const { getCsrfToken } = useOutletContext()
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [totalCount, setTotalCount] = useState(0)

  // Detail panel
  const [selected, setSelected] = useState(null)
  const [selectedHistory, setSelectedHistory] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // Modals
  const [banModal, setBanModal] = useState({ open: false, ban: true })
  const [grantModal, setGrantModal] = useState({ open: false })
  const [resetModal, setResetModal] = useState({ open: false })
  const [actionBusy, setActionBusy] = useState(false)

  // Duplicates
  const [dupGroups, setDupGroups] = useState([])

  const fetchUsers = useCallback(async (q = query, status = statusFilter) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (q?.trim()) params.set('q', q.trim())
      if (status && status !== 'all') params.set('status', status)
      params.set('limit', '500')
      const r = await fetch(`/api/admin/users?${params}`, { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setUsers(Array.isArray(j.users) ? j.users : [])
      setTotalCount(j.total || j.users?.length || 0)
    } catch (err) {
      toast?.error?.(`Eroare: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }, [query, statusFilter, toast])

  useEffect(() => { fetchUsers() }, [])

  // Fetch duplicates
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/users/duplicates', { credentials: 'include' })
        if (r.ok) {
          const j = await r.json()
          setDupGroups(Array.isArray(j?.groups) ? j.groups : [])
        }
      } catch (_) {}
    })()
  }, [])

  const loadDetail = useCallback(async (userId) => {
    setDetailLoading(true)
    setSelected(null)
    setSelectedHistory(null)
    try {
      const [uRes, hRes] = await Promise.all([
        fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { credentials: 'include' }),
        fetch(`/api/admin/users/${encodeURIComponent(userId)}/history?limit=50`, { credentials: 'include' }),
      ])
      if (uRes.ok) setSelected(await uRes.json())
      if (hRes.ok) setSelectedHistory(await hRes.json())
    } catch (err) {
      toast?.error?.('Nu am putut încărca detaliile userului')
    } finally {
      setDetailLoading(false)
    }
  }, [toast])

  // Ban / Unban
  const handleBan = useCallback(async () => {
    if (!selected?.user?.id) return
    setActionBusy(true)
    try {
      const csrf = await ensureCsrfToken()
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selected.user.id)}/ban`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || getCsrfToken() },
        body: JSON.stringify({ banned: banModal.ban, reason: banModal.reason || '' }),
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      toast?.success?.(banModal.ban ? 'Cont suspendat' : 'Cont reactivat')
      setBanModal({ open: false })
      await Promise.all([loadDetail(selected.user.id), fetchUsers()])
    } catch (err) {
      toast?.error?.(err.message)
    } finally {
      setActionBusy(false)
    }
  }, [selected, banModal, getCsrfToken, loadDetail, fetchUsers, toast])

  // Grant credits
  const handleGrant = useCallback(async (values) => {
    if (!selected?.user?.id) return
    const minutes = Number(values.minutes)
    if (!Number.isFinite(minutes) || minutes === 0) {
      toast?.error?.('Introdu un număr valid de minute')
      return
    }
    setActionBusy(true)
    try {
      const csrf = await ensureCsrfToken()
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selected.user.id)}/credits/grant`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || getCsrfToken() },
        body: JSON.stringify({ minutes: Math.trunc(minutes), note: values.note || '' }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      toast?.success?.(`${minutes > 0 ? 'Adăugate' : 'Retrase'} ${Math.abs(Math.trunc(minutes))} minute · sold ${body.balance}`)
      setGrantModal({ open: false })
      await Promise.all([loadDetail(selected.user.id), fetchUsers()])
    } catch (err) {
      toast?.error?.(err.message)
    } finally {
      setActionBusy(false)
    }
  }, [selected, getCsrfToken, loadDetail, fetchUsers, toast])

  // Reset password
  const handleReset = useCallback(async () => {
    if (!selected?.user?.id) return
    setActionBusy(true)
    try {
      const csrf = await ensureCsrfToken()
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selected.user.id)}/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || getCsrfToken() },
      })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      toast?.success?.('Parolă și passkey șterse')
      setResetModal({ open: false })
      await loadDetail(selected.user.id)
    } catch (err) {
      toast?.error?.(err.message)
    } finally {
      setActionBusy(false)
    }
  }, [selected, getCsrfToken, loadDetail, toast])

  const columns = [
    {
      key: 'email',
      label: 'Utilizator',
      render: (v, row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserAvatar email={row.email} name={row.displayName} size={28} />
          <div>
            <div style={{ fontWeight: 500 }}>{row.displayName || row.email}</div>
            {row.displayName && <div style={{ fontSize: 11, color: 'var(--admin-text-dim)' }}>{row.email}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Rol',
      render: (v) => (
        <span className={`admin-badge ${v === 'admin' ? 'purple' : 'blue'}`}>
          {v || 'user'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (v, row) => (
        <span className={`admin-badge ${row.banned ? 'red' : 'green'}`}>
          {row.banned ? 'Suspendat' : 'Activ'}
        </span>
      ),
    },
    {
      key: 'balanceMinutes',
      label: 'Credit (min)',
      render: (v) => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
          {v ?? 0}
        </span>
      ),
    },
    {
      key: 'provider',
      label: 'Autentificare',
      render: (v) => v || 'local',
    },
    {
      key: 'createdAt',
      label: 'Creat',
      render: (v) => v ? new Date(v).toLocaleDateString('ro-RO') : '—',
    },
  ]

  return (
    <div style={{ display: 'flex', gap: 20 }}>
      {/* Left — users list */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* KPI row */}
        <div className="kpi-grid" style={{ marginBottom: 16 }}>
          <KpiCard icon="👥" label="Total utilizatori" value={totalCount} accent="var(--admin-accent)" />
          <KpiCard icon="🔴" label="Suspendați" value={users.filter(u => u.banned).length} accent="var(--admin-red)" />
          <KpiCard icon="⚠️" label="Duplicate" value={dupGroups.length} accent="var(--admin-amber)" />
        </div>

        {/* Search & filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <input
            className="admin-input"
            style={{ flex: '1 1 200px', maxWidth: 360 }}
            placeholder="Caută după email, nume sau ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchUsers(query, statusFilter)}
          />
          <select
            className="admin-select"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); fetchUsers(query, e.target.value) }}
          >
            <option value="all">Toți</option>
            <option value="active">Activi</option>
            <option value="banned">Suspendați</option>
            <option value="admin">Admini</option>
          </select>
          <button className="admin-btn" onClick={() => fetchUsers(query, statusFilter)} disabled={loading}>
            {loading ? 'Se încarcă…' : '🔍 Caută'}
          </button>
        </div>

        {/* Table */}
        {loading ? <Skeleton height={300} /> : (
          <DataTable
            columns={columns}
            data={users}
            onRowClick={(row) => loadDetail(row.id)}
            emptyText="Niciun utilizator găsit."
          />
        )}
      </div>

      {/* Right — detail panel */}
      {(selected || detailLoading) && (
        <div style={{
          width: 380, flexShrink: 0,
          background: 'var(--admin-surface)',
          border: '1px solid var(--admin-border)',
          borderRadius: 'var(--admin-radius)',
          padding: 20,
          height: 'fit-content',
          position: 'sticky',
          top: 'calc(var(--admin-header-h) + 24px)',
        }}>
          {detailLoading ? <Skeleton height={200} /> : selected?.user && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <UserAvatar email={selected.user.email} name={selected.user.displayName} size={40} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      {selected.user.displayName || selected.user.email}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--admin-text-dim)' }}>
                      ID #{selected.user.id} · {selected.user.provider || 'local'}
                    </div>
                  </div>
                </div>
                <button
                  className="admin-btn sm"
                  onClick={() => { setSelected(null); setSelectedHistory(null) }}
                  style={{ fontSize: 16, padding: '4px 8px' }}
                >×</button>
              </div>

              {/* Info rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16, fontSize: 13 }}>
                <InfoRow label="Email" value={selected.user.email} />
                <InfoRow label="Status" value={
                  <span className={`admin-badge ${selected.user.banned ? 'red' : 'green'}`}>
                    {selected.user.banned ? 'Suspendat' : 'Activ'}
                  </span>
                } />
                <InfoRow label="Credit" value={`${selected.user.balanceMinutes ?? 0} minute`} />
                <InfoRow label="Rol" value={
                  <span className={`admin-badge ${selected.user.role === 'admin' ? 'purple' : 'blue'}`}>
                    {selected.user.role || 'user'}
                  </span>
                } />
                <InfoRow label="Creat" value={
                  selected.user.createdAt ? new Date(selected.user.createdAt).toLocaleString('ro-RO') : '—'
                } />
                <InfoRow label="Ultimul login" value={
                  selected.user.lastLoginAt ? new Date(selected.user.lastLoginAt).toLocaleString('ro-RO') : '—'
                } />
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                <button className="admin-btn sm" onClick={() => setGrantModal({ open: true })}>
                  💰 Acordă credite
                </button>
                <button
                  className={`admin-btn sm ${selected.user.banned ? '' : 'danger'}`}
                  onClick={() => setBanModal({
                    open: true,
                    ban: !selected.user.banned,
                    reason: '',
                  })}
                >
                  {selected.user.banned ? '✅ Reactivează' : '🚫 Suspendă'}
                </button>
                <button className="admin-btn sm danger" onClick={() => setResetModal({ open: true })}>
                  🔑 Reset parolă
                </button>
              </div>

              {/* History */}
              {selectedHistory?.rows && selectedHistory.rows.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--admin-text-dim)', marginBottom: 8, letterSpacing: '0.08em' }}>
                    ISTORIC RECENT
                  </div>
                  <div style={{ maxHeight: 250, overflowY: 'auto', fontSize: 12 }}>
                    {selectedHistory.rows.map((row, i) => (
                      <div key={i} style={{
                        padding: '6px 0',
                        borderBottom: '1px solid rgba(255,255,255,0.03)',
                        display: 'flex',
                        justifyContent: 'space-between',
                      }}>
                        <span style={{ color: 'var(--admin-text-dim)' }}>
                          {row.type || row.kind || '—'}{row.note ? ` · ${row.note}` : ''}
                        </span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {row.minutes != null ? `${row.minutes > 0 ? '+' : ''}${row.minutes} min` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Modals */}
      <ConfirmModal
        open={banModal.open}
        title={banModal.ban ? 'Suspendare cont' : 'Reactivare cont'}
        message={banModal.ban
          ? `Suspenzi contul "${selected?.user?.email}"? Utilizatorul nu va mai putea accesa platforma.`
          : `Reactivezi contul "${selected?.user?.email}"?`
        }
        confirmLabel={banModal.ban ? 'Suspendă' : 'Reactivează'}
        danger={banModal.ban}
        busy={actionBusy}
        onConfirm={handleBan}
        onCancel={() => setBanModal({ open: false })}
      />
      <InputModal
        open={grantModal.open}
        title={`Acordă credite — ${selected?.user?.email || ''}`}
        fields={[
          { key: 'minutes', label: 'Minute (negativ = retragi)', placeholder: '10', type: 'number' },
          { key: 'note', label: 'Notă (opțional)', placeholder: 'Compensare, refund, bonus…' },
        ]}
        submitLabel="Acordă"
        busy={actionBusy}
        onSubmit={handleGrant}
        onCancel={() => setGrantModal({ open: false })}
      />
      <ConfirmModal
        open={resetModal.open}
        title="Reset parolă și passkey"
        message={`Ștergi parola și passkey-ul pentru "${selected?.user?.email}"? Utilizatorul va trebui să se relogeze cu Google sau passkey nou.`}
        confirmLabel="Resetează"
        danger
        busy={actionBusy}
        onConfirm={handleReset}
        onCancel={() => setResetModal({ open: false })}
      />
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'var(--admin-text-dim)' }}>{label}</span>
      <span>{value}</span>
    </div>
  )
}
