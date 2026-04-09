import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

const PLAN_COLORS = {
  free:       { color: '#6b7280', glow: '#9ca3af' },
  basic:      { color: '#3b82f6', glow: '#60a5fa' },
  premium:    { color: '#a855f7', glow: '#c084fc' },
  enterprise: { color: '#f59e0b', glow: '#fbbf24' },
}

export default function PricingPage({ onNavigate }) {
  const { user } = useAuth()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/api/subscription/plans')
      .then((data) => setPlans(data.plans || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const currentTier = user?.subscription_tier || null

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
        {user && (
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
        )}
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '60px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '56px' }}>
          <h2 style={{
            fontSize: '40px', fontWeight: '800',
            background: 'linear-gradient(135deg, #a855f7, #f472b6)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: '12px',
          }}>
            Planuri & Prețuri
          </h2>
          <p style={{ color: '#888', fontSize: '16px' }}>
            Alege planul potrivit pentru nevoile tale
          </p>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: '#666' }}>Se încarcă planurile...</div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '24px',
          }}>
            {plans.map((plan) => {
              const colors    = PLAN_COLORS[plan.id] || PLAN_COLORS.free
              const isCurrent = currentTier === plan.id
              const isPremium = plan.id === 'premium'

              return (
                <div
                  key={plan.id}
                  style={{
                    background: isPremium
                      ? `linear-gradient(160deg, ${colors.color}22, ${colors.glow}11)`
                      : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isCurrent ? colors.glow : isPremium ? colors.color : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '20px', padding: '28px 24px',
                    display: 'flex', flexDirection: 'column',
                    position: 'relative',
                    boxShadow: isCurrent ? `0 0 30px ${colors.glow}33` : 'none',
                  }}
                >
                  {isPremium && (
                    <div style={{
                      position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)',
                      background: `linear-gradient(135deg, ${colors.color}, ${colors.glow})`,
                      borderRadius: '20px', padding: '4px 16px', fontSize: '12px', fontWeight: '700',
                      color: '#fff', whiteSpace: 'nowrap',
                    }}>
                      ⭐ Recomandat
                    </div>
                  )}

                  <div style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <h3 style={{ color: colors.glow, fontSize: '20px', fontWeight: '700' }}>
                        {plan.name}
                      </h3>
                      {isCurrent && (
                        <span style={{
                          background: `${colors.color}33`, color: colors.glow,
                          fontSize: '11px', fontWeight: '600', padding: '2px 8px',
                          borderRadius: '8px', border: `1px solid ${colors.color}44`,
                        }}>
                          Planul tău
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                      <span style={{ fontSize: '36px', fontWeight: '800', color: '#fff' }}>
                        {plan.price === 0 ? 'Gratuit' : `$${plan.price}`}
                      </span>
                      {plan.interval && (
                        <span style={{ color: '#666', fontSize: '14px' }}>/{plan.interval}</span>
                      )}
                    </div>
                  </div>

                  <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', flex: 1 }}>
                    {plan.features.map((f) => (
                      <li key={f} style={{
                        display: 'flex', alignItems: 'flex-start', gap: '8px',
                        color: '#ccc', fontSize: '14px', marginBottom: '10px',
                      }}>
                        <span style={{ color: colors.glow, flexShrink: 0 }}>✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => {
                      if (isCurrent) return
                      if (!user) { onNavigate('login'); return }
                      alert('Plățile Stripe vor fi disponibile în curând!')
                    }}
                    disabled={isCurrent}
                    style={{
                      width: '100%', padding: '12px',
                      background: isCurrent
                        ? 'rgba(255,255,255,0.06)'
                        : `linear-gradient(135deg, ${colors.color}, ${colors.glow})`,
                      border: isCurrent ? '1px solid rgba(255,255,255,0.1)' : 'none',
                      borderRadius: '12px', color: isCurrent ? '#555' : '#fff',
                      fontSize: '14px', fontWeight: '600',
                      cursor: isCurrent ? 'default' : 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    {isCurrent ? 'Plan curent' : plan.price === 0 ? 'Început gratuit' : 'Alege planul'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <p style={{ textAlign: 'center', color: '#555', fontSize: '13px', marginTop: '40px' }}>
          💳 Plățile Stripe vor fi disponibile în curând. Contactează admin pentru upgrade manual.
        </p>
      </div>
    </div>
  )
}
