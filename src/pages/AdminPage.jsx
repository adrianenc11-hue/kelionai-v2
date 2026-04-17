import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'

export default function AdminPage() {
  const navigate = useNavigate()
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingUser, setEditingUser] = useState(null)

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.get('/api/admin/users')
      setUsers(data.users || [])
      setTotal(data.total || 0)
    } catch (err) {
      if (err.status === 403 || err.status === 401) {
        navigate('/')
        return
      }
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function updateRole(id, role) {
    try {
      await api.put(`/api/admin/users/${id}/role`, { role })
      loadUsers()
    } catch (err) { setError(err.message) }
  }

  async function updateSubscription(id, subscription_tier) {
    try {
      await api.put(`/api/admin/users/${id}/subscription`, { subscription_tier })
      loadUsers()
    } catch (err) { setError(err.message) }
  }

  async function handleDelete(id, email) {
    if (!window.confirm(`Are you sure you want to delete user ${email}?`)) return
    try {
      await api.delete(`/api/admin/users/${id}`)
      loadUsers()
    } catch (err) { setError(err.message) }
  }

  const s = {
    page: { minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: "'Inter', sans-serif", padding: '24px 40px' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '32px' },
    title: { fontSize: '28px', fontWeight: '800', background: 'linear-gradient(135deg, #a855f7, #f472b6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' },
    badge: { background: 'rgba(168,85,247,0.2)', border: '1px solid rgba(168,85,247,0.4)', borderRadius: '8px', padding: '4px 12px', color: '#a855f7', fontSize: '13px', fontWeight: '600' },
    backBtn: { background: 'none', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', color: '#aaa', padding: '8px 16px', cursor: 'pointer', fontSize: '14px' },
    table: { width: '100%', borderCollapse: 'collapse', marginTop: '8px' },
    th: { textAlign: 'left', padding: '12px 16px', color: '#888', fontSize: '12px', fontWeight: '600', letterSpacing: '1px', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.08)' },
    td: { padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '14px', color: '#ccc' },
    select: { background: '#1a1a2e', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', padding: '4px 8px', fontSize: '13px', cursor: 'pointer' },
    deleteBtn: { background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', padding: '4px 12px', cursor: 'pointer', fontSize: '13px' },
    error: { background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '12px 16px', color: '#ef4444', marginBottom: '16px' },
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={s.title}>Admin Panel</span>
          <span style={s.badge}>{total} users</span>
        </div>
        <button onClick={() => navigate('/')} style={s.backBtn}>← Back</button>
      </div>

      {error && <div style={s.error}>{error}</div>}

      {loading ? (
        <div style={{ color: '#888', textAlign: 'center', marginTop: '60px' }}>Loading...</div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>ID</th>
                <th style={s.th}>Email</th>
                <th style={s.th}>Name</th>
                <th style={s.th}>Role</th>
                <th style={s.th}>Plan</th>
                <th style={s.th}>Usage</th>
                <th style={s.th}>Referral</th>
                <th style={s.th}>Created</th>
                <th style={s.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ transition: 'background 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(168,85,247,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={s.td}>{u.id}</td>
                  <td style={{ ...s.td, color: '#fff', fontWeight: '500' }}>{u.email}</td>
                  <td style={s.td}>{u.name || '—'}</td>
                  <td style={s.td}>
                    <select value={u.role} onChange={e => updateRole(u.id, e.target.value)} style={s.select}>
                      <option value="user">user</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td style={s.td}>
                    <select value={u.subscription_tier} onChange={e => updateSubscription(u.id, e.target.value)} style={s.select}>
                      <option value="free">free</option>
                      <option value="basic">basic</option>
                      <option value="premium">premium</option>
                      <option value="enterprise">enterprise</option>
                    </select>
                  </td>
                  <td style={s.td}>{u.usage_today ?? 0}</td>
                  <td style={{ ...s.td, fontSize: '12px', fontFamily: 'monospace' }}>{u.referral_code || '—'}</td>
                  <td style={{ ...s.td, fontSize: '12px', color: '#666' }}>{u.created_at ? new Date(u.created_at).toLocaleDateString('ro-RO') : '—'}</td>
                  <td style={s.td}>
                    <button onClick={() => handleDelete(u.id, u.email)} style={s.deleteBtn}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
