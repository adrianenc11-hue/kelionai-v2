import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'

export default function ReferralPage({ onNavigate }) {
  const { user } = useAuth()
  const [code, setCode]       = useState(null)
  const [expires, setExpires] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const [copied, setCopied]   = useState(false)

  // Apply referral code
  const [applyCode, setApplyCode]     = useState('')
  const [applyMsg, setApplyMsg]       = useState(null)
  const [applyError, setApplyError]   = useState(null)
  const [applying, setApplying]       = useState(false)

  const generateCode = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post('/api/referral/generate', {})
      setCode(res.code)
      setExpires(res.expires_at)
    } catch (err) {
      setError(err.body?.error || err.message)
    } finally {
      setLoading(false)
    }
  }

  const copyCode = () => {
    if (!code) return
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const applyReferral = async () => {
    if (!applyCode.trim()) return
    setApplying(true)
    setApplyMsg(null)
    setApplyError(null)
    try {
      const res = await api.post('/api/referral/use', { code: applyCode.trim().toUpperCase() })
      setApplyMsg(res.message || 'Code applied successfully!')
    } catch (err) {
      setApplyError(err.body?.error || err.message)
    } finally {
      setApplying(false)
    }
  }

  return (
    <div style={{
      width: '100vw', minHeight: '100vh',
      background: 'radial-gradient(ellipse at top, #1a0533 0%, #0a0a0f 60%)',
      color: '#fff', fontFamily: 'inherit', padding: '32px',
    }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <button
          onClick={() => onNavigate('dashboard')}
          style={{ background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: '#aaa', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', marginBottom: '24px' }}
        >
          ← Back
        </button>

        <h1 style={{ fontSize: '28px', fontWeight: '800', marginBottom: '8px',
          background: 'linear-gradient(135deg, #14b8a6, #a855f7)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          🎁 Invite Friends
        </h1>
        <p style={{ color: '#888', marginBottom: '32px' }}>
          Generate an invitation code. When your friend subscribes and uses the code, you get <strong style={{ color: '#14b8a6' }}>+5 free days</strong> added to your subscription.
        </p>

        {/* Generate code section */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '24px', marginBottom: '24px',
        }}>
          <h3 style={{ color: '#fff', marginBottom: '16px' }}>Generate Invitation Code</h3>
          {code ? (
            <div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{
                  flex: 1, background: 'rgba(20,184,166,0.1)', border: '1px solid rgba(20,184,166,0.3)',
                  borderRadius: '10px', padding: '14px 20px',
                  fontSize: '24px', fontWeight: '800', letterSpacing: '4px', color: '#14b8a6', textAlign: 'center',
                }}>
                  {code}
                </div>
                <button
                  onClick={copyCode}
                  style={{
                    background: copied ? 'rgba(20,184,166,0.3)' : 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)', color: '#fff',
                    padding: '14px 20px', borderRadius: '10px', cursor: 'pointer', fontSize: '14px',
                  }}
                >
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <p style={{ color: '#666', fontSize: '13px' }}>
                Expires: {expires ? new Date(expires).toLocaleDateString('en-US') : '—'}
              </p>
            </div>
          ) : (
            <button
              onClick={generateCode}
              disabled={loading}
              style={{
                background: 'linear-gradient(135deg, #0f766e, #14b8a6)',
                border: 'none', borderRadius: '12px', color: '#fff',
                padding: '14px 28px', fontSize: '15px', fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Generating...' : '✨ Generate Code'}
            </button>
          )}
          {error && <p style={{ color: '#f87171', marginTop: '12px', fontSize: '14px' }}>{error}</p>}
        </div>

        {/* Apply code section */}
        <div style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '16px', padding: '24px',
        }}>
          <h3 style={{ color: '#fff', marginBottom: '8px' }}>Have an invitation code?</h3>
          <p style={{ color: '#888', fontSize: '13px', marginBottom: '16px' }}>
            Enter the code received from a friend to activate it after subscribing.
          </p>
          <div style={{ display: 'flex', gap: '12px' }}>
            <input
              value={applyCode}
              onChange={e => setApplyCode(e.target.value.toUpperCase())}
              placeholder="Ex: A1B2C3D4"
              maxLength={8}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '10px', padding: '12px 16px', color: '#fff', fontSize: '16px',
                letterSpacing: '2px', fontWeight: '700', outline: 'none',
              }}
            />
            <button
              onClick={applyReferral}
              disabled={applying || !applyCode.trim()}
              style={{
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                border: 'none', borderRadius: '10px', color: '#fff',
                padding: '12px 20px', fontSize: '14px', fontWeight: '600',
                cursor: applying ? 'not-allowed' : 'pointer', opacity: applying ? 0.7 : 1,
              }}
            >
              {applying ? '...' : 'Apply'}
            </button>
          </div>
          {applyMsg   && <p style={{ color: '#4ade80', marginTop: '12px', fontSize: '14px' }}>✓ {applyMsg}</p>}
          {applyError && <p style={{ color: '#f87171', marginTop: '12px', fontSize: '14px' }}>✗ {applyError}</p>}
        </div>
      </div>
    </div>
  )
}
