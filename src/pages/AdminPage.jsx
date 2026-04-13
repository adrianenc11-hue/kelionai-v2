import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

const TIERS    = ['free', 'basic', 'premium', 'enterprise']
const STATUSES = ['active', 'cancelled', 'expired', 'trial']

const TIER_COLORS = {
  free:       '#9ca3af',
  basic:      '#60a5fa',
  premium:    '#c084fc',
  enterprise: '#fbbf24',
}

export default function AdminPage() {
  const { user, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const [editing, setEditing] = useState(null) // { userId, tier, status, expires }
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState(null)

  useEffect(() => {
    if (!isAdmin) return
    api.get('/api/admin/users')
      .then((data) => setUsers(data.users || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [isAdmin])

  if (!isAdmin) {
    return (
      <div style={{
        width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0a0f', color: '#fff', flexDirection: 'column', gap: '16px',
      }}>
        <div style={{ fontSize: '48px' }}>🔒</div>
        <h2>Access Denied</h2>
        <p style={{ color: '#666' }}>You do not have administrator permissions.</p>
        <button onClick={() => navigate('/dashboard')}
          style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', padding: '10px 20px', borderRadius: '10px', cursor: 'pointer' }}>
          ← Dashboard
        </button>
      </div>
    )
  }

  async function handleSaveSubscription() {
    if (!editing) return
    setSaving(true)
    setMsg(null)
    try {
      const updated = await api.put(`/api/admin/users/${editing.userId}/subscription`, {
        subscription_tier:       editing.tier,
        subscription_status:     editing.status,
        subscription_expires_at: editing.expires || null,
      })
      setUsers((prev) => prev.map((u) => u.id === updated.id ? updated : u))
      setMsg('Subscription updated!')
      setEditing(null)
    } catch (err) {
      setMsg(err.message || 'Error saving')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      width: '100vw', minHeight: '100vh',
      background: 'radial-gradient(ellipse at top, #1a0533 0%, #0a0a0f 60%)',
      color: '#fff',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 32px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(20px)',
      }}>
        <h1 style={{
          fontSize: '22px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          KelionAI Admin
        </h1>
        <button
          onClick={() => navigate('/dashboard')}
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#ccc', padding: '8px 14px', borderRadius: '10px',
            cursor: 'pointer', fontSize: '13px',
          }}
        >
          ← Dashboard
        </button>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '40px 24px' }}>
        <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>⚙️ Admin Panel</h2>
        <p style={{ color: '#666', marginBottom: '32px' }}>
          Manage users and subscriptions · Logged in as <strong style={{ color: '#a855f7' }}>{user?.email}</strong>
        </p>

        {msg && (
          <div style={{
            background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)',
            borderRadius: '12px', padding: '12px 20px', marginBottom: '20px',
            color: '#6ee7b7', fontSize: '14px',
          }}>
            ✓ {msg}
          </div>
        )}

        {error && (
          <div style={{
            background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)',
            borderRadius: '12px', padding: '12px 20px', marginBottom: '20px',
            color: '#fca5a5', fontSize: '14px',
          }}>
            ⚠️ {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#666' }}>Loading users...</div>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: '20px', overflow: 'hidden',
          }}>
            {/* Table header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1.4fr 0.8fr 0.8fr 0.9fr 0.9fr 0.7fr',
              padding: '14px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              background: 'rgba(255,255,255,0.04)',
            }}>
              {['Name', 'Email', 'Plan', 'Status', 'Registered', 'Last Access', 'Actions'].map((h) => (
                <div key={h} style={{ color: '#666', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {h}
                </div>
              ))}
            </div>

            {users.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#555' }}>
                No users registered.
              </div>
            ) : users.map((u) => (
              <div key={u.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.4fr 0.8fr 0.8fr 0.9fr 0.9fr 0.7fr',
                padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                alignItems: 'center',
                background: editing?.userId === u.id ? 'rgba(168,85,247,0.06)' : 'transparent',
              }}>
                <div style={{ color: '#fff', fontSize: '14px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>
                  {u.name}
                </div>
                <div style={{ color: '#888', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '8px' }}>
                  {u.email}
                </div>
                <div>
                  <span style={{
                    background: `${TIER_COLORS[u.subscription_tier] || '#9ca3af'}22`,
                    color: TIER_COLORS[u.subscription_tier] || '#9ca3af',
                    border: `1px solid ${TIER_COLORS[u.subscription_tier] || '#9ca3af'}44`,
                    borderRadius: '8px', padding: '3px 10px', fontSize: '12px', fontWeight: '600',
                  }}>
                    {u.subscription_tier || 'free'}
                  </span>
                </div>
                <div style={{ color: '#888', fontSize: '13px' }}>
                  {u.subscription_status || 'active'}
                </div>
                <div style={{ color: '#666', fontSize: '12px' }}>
                  {u.created_at ? new Date(u.created_at).toLocaleDateString('en-US') : '—'}
                </div>
                <div style={{ color: '#666', fontSize: '12px' }}>
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-US') : '—'}
                </div>
                <div>
                  <button
                    onClick={() => setEditing({
                      userId:  u.id,
                      tier:    u.subscription_tier || 'free',
                      status:  u.subscription_status || 'active',
                      expires: u.subscription_expires_at || '',
                    })}
                    style={{
                      background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)',
                      color: '#c084fc', padding: '5px 10px', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '12px',
                    }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit modal */}
        {editing && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 100, backdropFilter: 'blur(4px)',
          }}>
            <div style={{
              background: '#111', border: '1px solid rgba(168,85,247,0.4)',
              borderRadius: '20px', padding: '32px', width: '380px',
              boxShadow: '0 0 60px rgba(168,85,247,0.2)',
            }}>
              <h3 style={{ color: '#fff', fontSize: '18px', fontWeight: '700', marginBottom: '24px' }}>
                Edit Subscription
              </h3>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ color: '#888', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Plan</label>
                <select
                  value={editing.tier}
                  onChange={(e) => setEditing({ ...editing, tier: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 14px',
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '10px', color: '#fff', fontSize: '14px',
                  }}
                >
                  {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ color: '#888', fontSize: '13px', display: 'block', marginBottom: '6px' }}>Status</label>
                <select
                  value={editing.status}
                  onChange={(e) => setEditing({ ...editing, status: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 14px',
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '10px', color: '#fff', fontSize: '14px',
                  }}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ color: '#888', fontSize: '13px', display: 'block', marginBottom: '6px' }}>
                  Expires on (optional)
                </label>
                <input
                  type="date"
                  value={editing.expires}
                  onChange={(e) => setEditing({ ...editing, expires: e.target.value })}
                  style={{
                    width: '100%', padding: '10px 14px', boxSizing: 'border-box',
                    background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '10px', color: '#fff', fontSize: '14px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={handleSaveSubscription}
                  disabled={saving}
                  style={{
                    flex: 1, padding: '12px',
                    background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                    border: 'none', borderRadius: '12px', color: '#fff',
                    fontSize: '14px', fontWeight: '600',
                    cursor: saving ? 'not-allowed' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setEditing(null)}
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '12px', color: '#ccc', fontSize: '14px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
