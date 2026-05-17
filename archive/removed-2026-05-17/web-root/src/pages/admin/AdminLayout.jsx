// Admin Layout — sidebar + header + content area.
// Wraps every admin sub-page; handles auth guard too.

import { useState, useEffect, useCallback } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { ToastProvider } from './AdminComponents'
import { getCsrfToken } from '../../lib/api'
import './admin.css'

const NAV_ITEMS = [
  { to: '/admin',          icon: '📊', label: 'Dashboard',  end: true },
  { to: '/admin/users',    icon: '👥', label: 'Utilizatori' },
  { to: '/admin/revenue',  icon: '💰', label: 'Venituri' },
  { to: '/admin/ai',       icon: '🧠', label: 'AI Credits' },
  { to: '/admin/visitors', icon: '📈', label: 'Analitics' },
  { to: '/admin/payouts',  icon: '💸', label: 'Payouts' },
  { to: '/admin/settings', icon: '⚙️', label: 'Setări' },
  { to: '/admin/agent',    icon: '🤖', label: 'Agent Mode' },
]

const PAGE_TITLES = {
  '/admin':          'Dashboard',
  '/admin/users':    'Utilizatori',
  '/admin/revenue':  'Venituri',
  '/admin/ai':       'AI Credits',
  '/admin/visitors': 'Analitics',
  '/admin/payouts':  'Payouts',
  '/admin/settings': 'Setări',
  '/admin/agent':    'Agent Mode',
}

export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarOpen(v => !v), [])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  // Auth check — redirect to / if not admin
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/auth/me', { credentials: 'include' })
        if (!r.ok) throw new Error('Not authenticated')
        const userObj = await r.json()
        if (userObj.role !== 'admin') throw new Error('Not admin')
        if (!cancelled) setUser(userObj)
      } catch (err) {
        if (!cancelled) setAuthError(err.message)
        setTimeout(() => navigate('/', { replace: true }), 1500)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [navigate])

  const pageTitle = PAGE_TITLES[location.pathname] || 'Admin'

  if (loading) {
    return (
      <div className="admin-root" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--admin-accent)' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>⚡</div>
          <div style={{ fontSize: 13, letterSpacing: '0.15em', fontWeight: 600 }}>KELION ADMIN</div>
          <div style={{ fontSize: 12, opacity: 0.5, marginTop: 8 }}>Se verifică permisiunile…</div>
        </div>
      </div>
    )
  }

  if (authError) {
    return (
      <div className="admin-root" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: 'var(--admin-red)' }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>🔒</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Acces interzis</div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>{authError}</div>
          <div style={{ fontSize: 11, opacity: 0.4, marginTop: 12 }}>Redirecționare…</div>
        </div>
      </div>
    )
  }

  return (
    <ToastProvider>
      <div className="admin-root">
        {/* Overlay backdrop (mobile) */}
        <div
          className={`admin-overlay ${sidebarOpen ? 'open' : ''}`}
          onClick={closeSidebar}
          aria-hidden="true"
        />

        {/* Sidebar */}
        <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="admin-sidebar-logo">
            <span style={{ fontSize: 20 }}>⚡</span>
            <span>KELION ADMIN</span>
          </div>
          <nav className="admin-sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `admin-nav-item ${isActive ? 'active' : ''}`}
                onClick={closeSidebar}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="admin-sidebar-back">
            <button
              className="admin-nav-item"
              onClick={() => { closeSidebar(); navigate('/'); }}
              style={{ color: 'var(--admin-text-muted)' }}
            >
              <span className="nav-icon">←</span>
              <span className="nav-label">Înapoi la KelionAI</span>
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="admin-main">
          <header className="admin-header">
            <div className="admin-header-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                className="hamburger-btn"
                onClick={toggleSidebar}
                aria-label="Toggle sidebar"
                type="button"
              >
                ☰
              </button>
              <span>{pageTitle}</span>
            </div>
            <div className="admin-header-actions">
              <span style={{ fontSize: 12, color: 'var(--admin-text-dim)' }}>
                {user?.email || 'Admin'}
              </span>
              <div className="admin-avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                {(user?.displayName || user?.email || 'A')[0]}
              </div>
            </div>
          </header>
          <div className="admin-content">
            <Outlet context={{ user, getCsrfToken }} />
          </div>
        </main>
      </div>
    </ToastProvider>
  )
}
