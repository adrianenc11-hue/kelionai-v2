import { Component } from 'react'

/**
 * React Error Boundary — catches render errors in child components
 * and shows a friendly fallback UI instead of a white screen.
 *
 * Auto-retries after 3 seconds so transient WebGL context-loss
 * crashes recover without manual intervention. The user can also
 * click "Reload Page" immediately.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
    this._retryTimer = null
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    // Auto-retry after 3s for transient errors (WebGL context loss etc.)
    if (this._retryTimer) clearTimeout(this._retryTimer)
    this._retryTimer = setTimeout(() => {
      this.setState({ hasError: false, error: null })
    }, 3000)
  }

  componentWillUnmount() {
    if (this._retryTimer) clearTimeout(this._retryTimer)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100vw', height: '100vh', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          background: '#0a0a0f', fontFamily: "'Inter', sans-serif",
        }}>
          <div style={{
            textAlign: 'center', maxWidth: '480px', padding: '48px 32px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: '24px', backdropFilter: 'blur(20px)',
          }}>
            <div style={{ fontSize: '64px', marginBottom: '16px' }}>⚠️</div>
            <h2 style={{
              color: '#fff', fontSize: '24px', fontWeight: '800', margin: '0 0 12px',
            }}>
              Something went wrong
            </h2>
            <p style={{ color: '#888', fontSize: '15px', lineHeight: '1.6', margin: '0 0 8px' }}>
              An unexpected error occurred. This might be a temporary issue with your browser or graphics driver.
            </p>
            <p style={{ color: '#666', fontSize: '13px', lineHeight: '1.5', margin: '0 0 24px' }}>
              Retrying automatically…
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                border: 'none', borderRadius: '12px', color: '#fff',
                padding: '14px 32px', fontSize: '16px', fontWeight: '700',
                cursor: 'pointer', boxShadow: '0 8px 30px rgba(168,85,247,0.4)',
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
