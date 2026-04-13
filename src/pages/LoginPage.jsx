import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function LoginPage() {
  const { login, localLogin, registerLocal, error: authError, setError } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    if (setError) setError(null)

    let result
    if (isRegistering) {
      result = await registerLocal(email, password, name)
    } else {
      result = await localLogin(email, password)
    }

    if (result && result.success) {
      setMessage(isRegistering ? 'Registration successful! Logging in...' : 'Login successful!')
    } else {
      setMessage(result ? result.message : 'Authentication failed. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0a0a0f', fontFamily: "'Inter', sans-serif",
    }}>
      {/* Back to landing */}
      <button
        onClick={() => navigate('/')}
        style={{
          position: 'absolute', top: '20px', left: '20px',
          background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: '8px', color: '#888', padding: '8px 16px',
          fontSize: '13px', cursor: 'pointer',
        }}
      >
        ← Back
      </button>

      <div style={{
        width: '100%', maxWidth: '420px', padding: '40px 36px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(168,85,247,0.25)',
        borderRadius: '24px', backdropFilter: 'blur(20px)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            fontSize: '28px', fontWeight: '800',
            background: 'linear-gradient(135deg, #a855f7, #f472b6)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: '8px',
          }}>
            KelionAI
          </div>
          <h2 style={{ color: '#fff', fontSize: '22px', fontWeight: '700', margin: 0 }}>
            {isRegistering ? 'Create your account' : 'Welcome back'}
          </h2>
          <p style={{ color: '#666', fontSize: '14px', margin: '6px 0 0' }}>
            {isRegistering ? 'Start your AI journey today' : 'Sign in to continue with Kelion'}
          </p>
        </div>

        {/* Error/Success messages */}
        {authError && (
          <div style={{
            background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '10px', padding: '10px 14px', marginBottom: '16px',
            color: '#fca5a5', fontSize: '14px',
          }}>
            {authError}
          </div>
        )}
        {message && (
          <div style={{
            background: message.includes('successful') ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${message.includes('successful') ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
            borderRadius: '10px', padding: '10px 14px', marginBottom: '16px',
            color: message.includes('successful') ? '#86efac' : '#fca5a5', fontSize: '14px',
          }}>
            {message}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {isRegistering && (
            <div>
              <label style={{ color: '#aaa', fontSize: '13px', fontWeight: '500', display: 'block', marginBottom: '6px' }}>
                Full Name
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                required
                style={{
                  width: '100%', padding: '11px 14px', borderRadius: '10px',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                  color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
                }}
              />
            </div>
          )}
          <div>
            <label style={{ color: '#aaa', fontSize: '13px', fontWeight: '500', display: 'block', marginBottom: '6px' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={{
                width: '100%', padding: '11px 14px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ color: '#aaa', fontSize: '13px', fontWeight: '500', display: 'block', marginBottom: '6px' }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={{
                width: '100%', padding: '11px 14px', borderRadius: '10px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '12px', color: '#fff',
              padding: '13px', fontSize: '15px', fontWeight: '700',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, marginTop: '4px',
              boxShadow: '0 4px 20px rgba(168,85,247,0.3)',
            }}
          >
            {loading ? 'Processing...' : (isRegistering ? 'Create Account' : 'Sign In')}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '20px 0' }}>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
          <span style={{ color: '#555', fontSize: '12px' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
        </div>

        {/* Google login */}
        <button
          onClick={login}
          style={{
            width: '100%', padding: '12px', borderRadius: '12px',
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </button>

        {/* Toggle */}
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <button
            onClick={() => { setIsRegistering(!isRegistering); setMessage(''); if (setError) setError(null) }}
            style={{
              background: 'none', border: 'none', color: '#a855f7',
              fontSize: '14px', cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            {isRegistering ? 'Already have an account? Sign In' : "Don't have an account? Register"}
          </button>
        </div>
      </div>
    </div>
  )
}
