import { useAuth } from '../contexts/AuthContext'

const TIER_COLORS = {
  free:       { color: '#6b7280', glow: '#9ca3af' },
  basic:      { color: '#3b82f6', glow: '#60a5fa' },
  premium:    { color: '#a855f7', glow: '#c084fc' },
  enterprise: { color: '#f59e0b', glow: '#fbbf24' },
}

const TIER_LABELS = {
  free:       'Free',
  basic:      'Basic',
  premium:    'Premium',
  enterprise: 'Enterprise',
}

export default function Dashboard({ onNavigate }) {
  const { user, logout, isAdmin } = useAuth()

  if (!user) return null

  const tier    = user.subscription_tier || 'free'
  const colors  = TIER_COLORS[tier] || TIER_COLORS.free
  const usedToday  = user.usage?.today ?? 0
  const dailyLimit = user.usage?.daily_limit ?? 10
  const usagePct   = dailyLimit ? Math.min((usedToday / dailyLimit) * 100, 100) : 0

  const statBox = (label, value, sub) => (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px', padding: '20px 24px', flex: 1, minWidth: '140px',
    }}>
      <div style={{ color: '#666', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </div>
      <div style={{ color: '#fff', fontSize: '28px', fontWeight: '700' }}>{value}</div>
      {sub && <div style={{ color: '#555', fontSize: '12px', marginTop: '4px' }}>{sub}</div>}
    </div>
  )

  return (
    <div style={{
      width: '100vw', minHeight: '100vh',
      background: 'radial-gradient(ellipse at top, #1a0533 0%, #0a0a0f 60%)',
      color: '#fff', fontFamily: 'inherit',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 32px', borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(20px)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <h1 style={{
          fontSize: '22px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          KelionAI
        </h1>

        <nav style={{ display: 'flex', gap: '8px' }}>
          {[
            { label: '🏠 Dashboard', page: 'dashboard' },
            { label: '💬 Chat',      page: 'chat' },
            { label: '💳 Prețuri',   page: 'pricing' },
            { label: '👤 Profil',    page: 'profile' },
            ...(isAdmin ? [{ label: '⚙️ Admin', page: 'admin' }] : []),
          ].map(({ label, page }) => (
            <button
              key={page}
              onClick={() => onNavigate(page)}
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#ccc', padding: '8px 14px', borderRadius: '10px',
                cursor: 'pointer', fontSize: '13px', fontWeight: '500',
              }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={logout}
            style={{
              background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.3)',
              color: '#fca5a5', padding: '8px 14px', borderRadius: '10px',
              cursor: 'pointer', fontSize: '13px', fontWeight: '500',
            }}
          >
            Ieși
          </button>
        </nav>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '40px 24px' }}>
        {/* Welcome */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {user.picture ? (
              <img src={user.picture} alt={user.name}
                style={{ width: '56px', height: '56px', borderRadius: '50%', border: `2px solid ${colors.color}` }} />
            ) : (
              <div style={{
                width: '56px', height: '56px', borderRadius: '50%',
                background: `linear-gradient(135deg, ${colors.color}, ${colors.glow})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '22px', fontWeight: '700',
              }}>
                {user.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#fff' }}>
                Bun venit, {user.name?.split(' ')[0]}! 👋
              </h2>
              <p style={{ color: '#666', fontSize: '14px' }}>{user.email}</p>
            </div>

            {/* Tier badge */}
            <div style={{
              marginLeft: 'auto',
              background: `linear-gradient(135deg, ${colors.color}22, ${colors.glow}22)`,
              border: `1px solid ${colors.color}44`,
              borderRadius: '20px', padding: '6px 16px',
              display: 'flex', alignItems: 'center', gap: '6px',
            }}>
              <span style={{ fontSize: '10px', color: colors.glow }}>●</span>
              <span style={{ color: colors.glow, fontWeight: '600', fontSize: '13px' }}>
                {TIER_LABELS[tier]}
              </span>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: '16px', marginBottom: '32px', flexWrap: 'wrap' }}>
          {statBox('Plan curent', TIER_LABELS[tier])}
          {statBox('Utilizare azi', `${usedToday}/${dailyLimit ?? '∞'}`, 'generări vocale')}
          {statBox('Status', user.subscription_status || 'active')}
          {statBox(
            'Membru din',
            user.created_at ? new Date(user.created_at).toLocaleDateString('ro-RO') : '—'
          )}
        </div>

        {/* Usage bar */}
        {dailyLimit && (
          <div style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '16px', padding: '20px 24px', marginBottom: '32px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ color: '#aaa', fontSize: '14px' }}>Utilizare zilnică</span>
              <span style={{ color: '#aaa', fontSize: '14px' }}>{usedToday} / {dailyLimit}</span>
            </div>
            <div style={{
              height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: '4px',
                width: `${usagePct}%`,
                background: usagePct > 80
                  ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                  : `linear-gradient(135deg, ${colors.color}, ${colors.glow})`,
                transition: 'width 0.5s ease',
              }} />
            </div>
            {usagePct >= 100 && (
              <p style={{ color: '#fca5a5', fontSize: '13px', marginTop: '10px' }}>
                ⚠️ Limita zilnică atinsă.{' '}
                <button
                  onClick={() => onNavigate('pricing')}
                  style={{ background: 'none', border: 'none', color: colors.glow, cursor: 'pointer', fontSize: '13px', padding: 0 }}
                >
                  Upgrade plan →
                </button>
              </p>
            )}
          </div>
        )}

        {/* Quick actions */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '24px',
        }}>
          <h3 style={{ color: '#fff', fontSize: '16px', fontWeight: '600', marginBottom: '16px' }}>
            Acțiuni rapide
          </h3>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <ActionBtn label="💬 Pornește chat" color="#7c3aed" glow="#a855f7"  onClick={() => onNavigate('chat')} />
            <ActionBtn label="💳 Upgrade plan"  color="#1d4ed8" glow="#3b82f6"  onClick={() => onNavigate('pricing')} />
            <ActionBtn label="👤 Profil"        color="#065f46" glow="#10b981"  onClick={() => onNavigate('profile')} />
            {isAdmin && <ActionBtn label="⚙️ Admin panel" color="#92400e" glow="#f59e0b" onClick={() => onNavigate('admin')} />}
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({ label, color, glow, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: `linear-gradient(135deg, ${color}, ${glow})`,
        border: 'none', borderRadius: '12px', color: '#fff',
        padding: '12px 20px', fontSize: '14px', fontWeight: '600',
        cursor: 'pointer', transition: 'all 0.2s',
        boxShadow: `0 4px 16px ${glow}33`,
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
    >
      {label}
    </button>
  )
}
