import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

const TIER_COLORS = {
  free:       { color: '#6b7280', glow: '#9ca3af' },
  basic:      { color: '#3b82f6', glow: '#60a5fa' },
  premium:    { color: '#a855f7', glow: '#c084fc' },
  enterprise: { color: '#f59e0b', glow: '#fbbf24' },
}

export default function ProfilePage({ onNavigate }) {
  const { user, refreshUser } = useAuth()
  const [name, setName]     = useState(user?.name || '')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState(null)
  const [msgType, setMsgType] = useState('success')

  if (!user) return null

  const tier   = user.subscription_tier || 'free'
  const colors = TIER_COLORS[tier] || TIER_COLORS.free

  async function handleSave(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setMsg(null)
    try {
      await api.put('/api/users/me', { name: name.trim() })
      await refreshUser()
      setMsg('Profile updated!')
      setMsgType('success')
    } catch (err) {
      setMsg(err.message || 'Error saving profile')
      setMsgType('error')
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
          KelionAI
        </h1>
        <button
          onClick={() => onNavigate('dashboard')}
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
      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '40px 24px' }}>
        <h2 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '32px' }}>👤 Profile</h2>

        {/* Avatar + info */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px', padding: '28px', marginBottom: '24px',
          display: 'flex', alignItems: 'center', gap: '20px',
        }}>
          {user.picture ? (
            <img src={user.picture} alt={user.name}
              style={{ width: '72px', height: '72px', borderRadius: '50%', border: `3px solid ${colors.color}` }} />
          ) : (
            <div style={{
              width: '72px', height: '72px', borderRadius: '50%',
              background: `linear-gradient(135deg, ${colors.color}, ${colors.glow})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '28px', fontWeight: '700', flexShrink: 0,
            }}>
              {user.name?.[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <div style={{ color: '#fff', fontSize: '20px', fontWeight: '700' }}>{user.name}</div>
            <div style={{ color: '#666', fontSize: '14px', marginTop: '4px' }}>{user.email}</div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px',
              marginTop: '8px',
              background: `${colors.color}22`, border: `1px solid ${colors.color}44`,
              borderRadius: '20px', padding: '3px 12px',
            }}>
              <span style={{ fontSize: '9px', color: colors.glow }}>●</span>
              <span style={{ color: colors.glow, fontWeight: '600', fontSize: '13px' }}>
                {tier.charAt(0).toUpperCase() + tier.slice(1)}
              </span>
            </div>
          </div>
        </div>

        {/* Edit form */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px', padding: '28px', marginBottom: '24px',
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '20px' }}>Edit Profile</h3>
          <form onSubmit={handleSave}>
            <label style={{ display: 'block', color: '#888', fontSize: '13px', marginBottom: '6px' }}>
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%', padding: '12px 16px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '12px', color: '#fff', fontSize: '15px',
                outline: 'none', boxSizing: 'border-box',
              }}
            />

            {msg && (
              <div style={{
                marginTop: '12px', padding: '10px 14px', borderRadius: '10px',
                background: msgType === 'success' ? 'rgba(16,185,129,0.15)' : 'rgba(220,38,38,0.15)',
                border: `1px solid ${msgType === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(220,38,38,0.4)'}`,
                color: msgType === 'success' ? '#6ee7b7' : '#fca5a5',
                fontSize: '14px',
              }}>
                {msg}
              </div>
            )}

            <button
              type="submit"
              disabled={saving || !name.trim()}
              style={{
                marginTop: '16px',
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                border: 'none', borderRadius: '12px', color: '#fff',
                padding: '12px 24px', fontSize: '14px', fontWeight: '600',
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </form>
        </div>

        {/* Subscription info */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '20px', padding: '28px',
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '20px' }}>Subscription</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Row label="Plan" value={tier.charAt(0).toUpperCase() + tier.slice(1)} />
            <Row label="Status" value={user.subscription_status || 'active'} />
            <Row label="Expires" value={user.subscription_expires_at
              ? new Date(user.subscription_expires_at).toLocaleDateString('en-US')
              : 'N/A'} />
            <Row label="Today's Usage" value={`${user.usage?.today ?? 0} / ${user.usage?.daily_limit ?? '∞'}`} />
          </div>
          <button
            onClick={() => onNavigate('pricing')}
            style={{
              marginTop: '20px',
              background: `linear-gradient(135deg, ${colors.color}, ${colors.glow})`,
              border: 'none', borderRadius: '12px', color: '#fff',
              padding: '12px 20px', fontSize: '14px', fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            💳 Change Plan
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: '#666', fontSize: '14px' }}>{label}</span>
      <span style={{ color: '#ccc', fontSize: '14px', fontWeight: '500' }}>{value}</span>
    </div>
  )
}
