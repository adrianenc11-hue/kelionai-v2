import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login, error, setError, loading } = useAuth()

  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #1a0533 0%, #0a0a0f 70%)',
    }}>
      {/* Logo / Title */}
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <h1 style={{
          fontSize: '52px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: '12px', letterSpacing: '-2px',
        }}>
          KelionAI
        </h1>
        <p style={{ color: '#888', fontSize: '16px' }}>
          Asistent AI vocal — vorbește, ascultă, înțelege
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div style={{
          background: 'rgba(220,38,38,0.15)', border: '1px solid rgba(220,38,38,0.4)',
          borderRadius: '12px', padding: '12px 20px', marginBottom: '24px',
          maxWidth: '400px', textAlign: 'center', color: '#fca5a5', fontSize: '14px',
        }}>
          ⚠️ {error}
          <button
            onClick={() => setError(null)}
            style={{
              marginLeft: '12px', background: 'none', border: 'none',
              color: '#fca5a5', cursor: 'pointer', fontSize: '16px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Login card */}
      <div style={{
        background: 'rgba(255,255,255,0.05)', backdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.1)', borderRadius: '24px',
        padding: '40px 48px', maxWidth: '400px', width: '90%', textAlign: 'center',
        boxShadow: '0 0 60px rgba(168,85,247,0.15)',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🤖</div>
        <h2 style={{ color: '#fff', fontSize: '24px', fontWeight: '700', marginBottom: '8px' }}>
          Bun venit!
        </h2>
        <p style={{ color: '#888', fontSize: '14px', marginBottom: '32px', lineHeight: '1.6' }}>
          Conectează-te cu Google pentru a accesa asistenții AI vocali și toate funcționalitățile KelionAI.
        </p>

        <button
          onClick={login}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
            width: '100%', padding: '14px 24px',
            background: '#fff', border: 'none', borderRadius: '14px',
            color: '#1a1a1a', fontSize: '16px', fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            transition: 'all 0.2s', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.transform = 'scale(1.02)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}
        >
          <GoogleIcon />
          Continuă cu Google
        </button>

        <p style={{ color: '#555', fontSize: '12px', marginTop: '20px' }}>
          Prin conectare, ești de acord cu termenii de utilizare
        </p>
      </div>

      {/* Features preview */}
      <div style={{
        display: 'flex', gap: '16px', marginTop: '40px', flexWrap: 'wrap',
        justifyContent: 'center', maxWidth: '600px',
      }}>
        {[
          { icon: '🎤', text: 'Voce în timp real' },
          { icon: '🌍', text: 'Orice limbă' },
          { icon: '🤖', text: 'AI avansat' },
          { icon: '🔒', text: 'Securizat' },
        ].map(({ icon, text }) => (
          <div key={text} style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px', padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: '8px',
            color: '#888', fontSize: '13px',
          }}>
            <span>{icon}</span> {text}
          </div>
        ))}
      </div>
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}
