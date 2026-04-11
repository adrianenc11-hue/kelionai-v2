import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_51TGhlVLoR6yrf0RiomeHJOInQOY3MxRgnWq7dcBbxJsmu6nGLyje5Jd3x31pVtB7JgJnjEuktYxgr2yBOuof0Ajc004D1KleAh')

const PLAN_COLORS = {
  free:       { color: '#6b7280', glow: '#9ca3af' },
  basic:      { color: '#3b82f6', glow: '#60a5fa' },
  premium:    { color: '#a855f7', glow: '#c084fc' },
  enterprise: { color: '#f59e0b', glow: '#fbbf24' },
}

const PLAN_DETAILS = {
  free: {
    name: 'Free',
    price: 0,
    label: 'Get started',
    features: ['10 messages per day', 'Basic AI responses', 'Text chat only'],
  },
  basic: {
    name: 'Basic',
    price: '$9.99',
    interval: 'month',
    label: 'Choose Basic',
    features: ['Unlimited messages', 'Voice & text chat', 'AI Vision (camera)', 'All languages', 'Priority support'],
  },
  premium: {
    name: 'Premium',
    price: '$29.99',
    interval: 'month',
    label: 'Choose Premium',
    recommended: true,
    features: ['Everything in Basic', 'Advanced AI models', 'Custom avatar settings', 'API access', 'Faster responses'],
  },
  enterprise: {
    name: 'Enterprise',
    price: '$99.99',
    interval: 'month',
    label: 'Choose Enterprise',
    features: ['Everything in Premium', 'Dedicated support', 'Custom integrations', 'SLA guarantee', 'Team accounts'],
  },
}

export default function PricingPage({ onNavigate }) {
  const { user } = useAuth()
  const [loadingPlan, setLoadingPlan] = useState(null)
  const [error, setError] = useState(null)

  const currentTier = user?.subscription_tier || null

  const handleChoosePlan = async (planId) => {
    if (planId === currentTier) return
    setError(null)

    // Free plan — just activate
    if (planId === 'free') {
      if (!user) {
        onNavigate && onNavigate('login')
        return
      }
      try {
        setLoadingPlan(planId)
        await api.post('/api/payments/create-checkout-session', { planId })
        onNavigate && onNavigate('dashboard')
      } catch (err) {
        setError(err.message || 'Failed to activate free plan.')
      } finally {
        setLoadingPlan(null)
      }
      return
    }

    // Paid plan — redirect to Stripe Checkout
    if (!user) {
      // Not logged in — go to login first, then pricing
      onNavigate && onNavigate('login')
      return
    }

    try {
      setLoadingPlan(planId)
      const res = await api.post('/api/payments/create-checkout-session', { planId })

      if (res.sessionId) {
        const stripe = await stripePromise
        if (stripe) {
          const { error: stripeError } = await stripe.redirectToCheckout({ sessionId: res.sessionId })
          if (stripeError) {
            setError(stripeError.message)
          }
        } else {
          setError('Stripe failed to load. Please try again.')
        }
      } else if (res.redirectUrl) {
        window.location.href = res.redirectUrl
      } else {
        setError('Unexpected response from server.')
      }
    } catch (err) {
      setError(err.message || 'Payment initialization failed. Please try again.')
    } finally {
      setLoadingPlan(null)
    }
  }

  const plans = Object.entries(PLAN_DETAILS).map(([id, p]) => ({ id, ...p }))

  return (
    <div style={{
      width: '100vw', minHeight: '100vh',
      background: 'radial-gradient(ellipse at top, #0d0d1a 0%, #060608 70%)',
      color: '#fff', fontFamily: "'Inter', sans-serif",
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <h1 style={{
          fontSize: '20px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          margin: 0,
        }}>
          KelionAI
        </h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          {user ? (
            <button
              onClick={() => onNavigate && onNavigate('dashboard')}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#ccc', padding: '8px 16px', borderRadius: '10px',
                cursor: 'pointer', fontSize: '13px',
              }}
            >
              ← Dashboard
            </button>
          ) : (
            <button
              onClick={() => onNavigate && onNavigate('login')}
              style={{
                background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)',
                color: '#c084fc', padding: '8px 16px', borderRadius: '10px',
                cursor: 'pointer', fontSize: '13px', fontWeight: '600',
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '64px 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: '64px' }}>
          <div style={{
            display: 'inline-block', background: 'rgba(168,85,247,0.1)',
            border: '1px solid rgba(168,85,247,0.2)', borderRadius: '20px',
            padding: '6px 16px', fontSize: '13px', color: '#a855f7',
            marginBottom: '20px', fontWeight: '600',
          }}>
            Simple, transparent pricing
          </div>
          <h2 style={{
            fontSize: '44px', fontWeight: '800', margin: '0 0 16px',
            background: 'linear-gradient(135deg, #fff 0%, #a855f7 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Choose Your Plan
          </h2>
          <p style={{ color: '#666', fontSize: '17px', margin: 0 }}>
            Start free. Upgrade when you're ready. Cancel anytime.
          </p>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '12px', padding: '14px 20px', marginBottom: '32px',
            color: '#f87171', textAlign: 'center', fontSize: '14px',
          }}>
            {error}
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '24px',
        }}>
          {plans.map((plan) => {
            const colors = PLAN_COLORS[plan.id] || PLAN_COLORS.free
            const isCurrent = currentTier === plan.id
            const isLoading = loadingPlan === plan.id

            return (
              <div
                key={plan.id}
                style={{
                  background: plan.recommended
                    ? 'linear-gradient(160deg, rgba(168,85,247,0.12), rgba(244,114,182,0.06))'
                    : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isCurrent ? colors.glow : plan.recommended ? colors.color : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: '20px', padding: '32px 24px',
                  display: 'flex', flexDirection: 'column',
                  position: 'relative',
                  boxShadow: plan.recommended ? `0 0 40px rgba(168,85,247,0.15)` : 'none',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-4px)'
                  e.currentTarget.style.boxShadow = `0 12px 40px ${colors.color}22`
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = 'translateY(0)'
                  e.currentTarget.style.boxShadow = plan.recommended ? `0 0 40px rgba(168,85,247,0.15)` : 'none'
                }}
              >
                {plan.recommended && (
                  <div style={{
                    position: 'absolute', top: '-14px', left: '50%', transform: 'translateX(-50%)',
                    background: 'linear-gradient(135deg, #a855f7, #f472b6)',
                    borderRadius: '20px', padding: '5px 18px', fontSize: '12px', fontWeight: '700',
                    color: '#fff', whiteSpace: 'nowrap', letterSpacing: '0.5px',
                  }}>
                    ⭐ MOST POPULAR
                  </div>
                )}

                {isCurrent && (
                  <div style={{
                    position: 'absolute', top: '16px', right: '16px',
                    background: `${colors.color}22`, color: colors.glow,
                    fontSize: '11px', fontWeight: '700', padding: '3px 10px',
                    borderRadius: '8px', border: `1px solid ${colors.color}44`,
                  }}>
                    CURRENT
                  </div>
                )}

                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ color: colors.glow, fontSize: '18px', fontWeight: '700', margin: '0 0 12px' }}>
                    {plan.name}
                  </h3>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                    <span style={{ fontSize: '40px', fontWeight: '800', color: '#fff', lineHeight: 1 }}>
                      {plan.price === 0 ? 'Free' : plan.price}
                    </span>
                    {plan.interval && (
                      <span style={{ color: '#555', fontSize: '14px' }}>/{plan.interval}</span>
                    )}
                  </div>
                </div>

                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 28px', flex: 1 }}>
                  {plan.features.map((f) => (
                    <li key={f} style={{
                      display: 'flex', alignItems: 'flex-start', gap: '10px',
                      color: '#bbb', fontSize: '14px', marginBottom: '12px',
                    }}>
                      <span style={{ color: colors.glow, flexShrink: 0, marginTop: '1px' }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => handleChoosePlan(plan.id)}
                  disabled={isCurrent || isLoading}
                  style={{
                    width: '100%', padding: '13px',
                    background: isCurrent
                      ? 'rgba(255,255,255,0.05)'
                      : `linear-gradient(135deg, ${colors.color}, ${colors.glow})`,
                    border: isCurrent ? '1px solid rgba(255,255,255,0.08)' : 'none',
                    borderRadius: '12px', color: isCurrent ? '#444' : '#fff',
                    fontSize: '14px', fontWeight: '700',
                    cursor: isCurrent ? 'default' : 'pointer',
                    transition: 'opacity 0.2s',
                    opacity: isLoading ? 0.7 : 1,
                    letterSpacing: '0.3px',
                  }}
                >
                  {isLoading ? 'Processing...' : isCurrent ? 'Current Plan' : plan.label}
                </button>
              </div>
            )
          })}
        </div>

        <div style={{ textAlign: 'center', marginTop: '48px' }}>
          <p style={{ color: '#444', fontSize: '13px', margin: '0 0 8px' }}>
            🔒 Payments are securely processed by Stripe. No card data is stored on our servers.
          </p>
          <p style={{ color: '#333', fontSize: '12px', margin: 0 }}>
            Monthly subscriptions — cancel anytime. Annual plans eligible for refund within 3 months.
          </p>
        </div>
      </div>
    </div>
  )
}
