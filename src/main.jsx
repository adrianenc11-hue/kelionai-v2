import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import ErrorBoundary from './components/ErrorBoundary'
import { installErrorReporter } from './lib/errorReporter'
import { getCsrfToken } from './lib/api'
import './index.css'

// Sentry error tracking (optional — only activates when VITE_SENTRY_DSN is set).
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
    ],
    tracesSampleRate: 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}

// Audit H4: install global safety net on the client side. Before this,
// any uncaught exception or unhandled promise rejection inside the
// React app (a voice hook throws, a WebAudio graph node rejects, a
// useEffect cleanup with a bad fetch) died silently in the user's
// browser — no server telemetry, no user-facing feedback, no record
// of why. Now every such event is rate-limited + deduped + POSTed to
// /api/diag/client-error so it shows up in Railway logs the same way
// server errors do.
installErrorReporter({ csrfToken: getCsrfToken })

// Silence a single-line noise warning emitted from THREE r183's
// `Clock` constructor every time @react-three/fiber boots its render
// loop. We can't fix the library side without upgrading r3f to the 10.x
// alpha line (which is not production-ready — breaking-change risk on
// avatar animations). We also don't want to blanket-override warn, so
// we only filter this exact deprecation string.
// See: https://github.com/pmndrs/react-three-fiber/issues/ — tracked for
// the upcoming r3f migration off THREE.Clock → THREE.Timer.
const _origWarn = console.warn
console.warn = function filteredWarn(...args) {
  if (
    typeof args[0] === 'string' &&
    args[0].includes('THREE.Clock') &&
    args[0].includes('deprecated')
  ) {
    return
  }
  return _origWarn.apply(this, args)
}

const KelionStage = lazy(() => import('./pages/KelionStage'))
const ContactPage = lazy(() => import('./pages/ContactPage'))
// Kelion Studio — voice-driven Python IDE (DS-2 lands the editor UI;
// the backend lives under /api/studio/* from DS-1/DS-3). Lazy-loaded
// so the ~4 MB Monaco bundle never ships with the landing page.
const KelionStudio = lazy(() => import('./pages/KelionStudio'))
const LandingPage = lazy(() => import('./pages/LandingPage'))

// Admin dashboard — full-page admin panel replacing the old side-drawer.
// Lazy-loaded so the admin bundle (~35 KB) never ships to normal users.
const AdminLayout   = lazy(() => import('./pages/admin/AdminLayout'))
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'))
const UsersPage     = lazy(() => import('./pages/admin/UsersPage'))
const RevenuePage   = lazy(() => import('./pages/admin/RevenuePage'))
const AiCreditsPage = lazy(() => import('./pages/admin/AiCreditsPage'))
const VisitorsPage  = lazy(() => import('./pages/admin/VisitorsPage'))
const PayoutsPage   = lazy(() => import('./pages/admin/PayoutsPage'))
const SettingsPage  = lazy(() => import('./pages/admin/SettingsPage'))
const AgentPage     = lazy(() => import('./pages/admin/AgentPage'))

function Loader() {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#05060a',
      color: '#a78bfa',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '14px',
      letterSpacing: '0.15em',
    }}>
      KELION
    </div>
  )
}

const PermanentLogo = () => (
  <div style={{
    position: 'fixed',
    bottom: '20px',
    right: '20px',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    pointerEvents: 'none',
    opacity: 0.95,
    background: 'rgba(0,0,0,0.6)',
    padding: '8px 16px',
    borderRadius: '12px',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255, 215, 0, 0.3)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.5)'
  }}>
    <img src="/ae_studio_logo_gold.png" alt="AE Studio Gold" style={{ height: '32px', filter: 'drop-shadow(0 0 8px rgba(255, 215, 0, 0.4))' }} />
    <span style={{ color: '#ffd700', fontFamily: 'system-ui, sans-serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '0.1em', textTransform: 'uppercase' }}>AE Studio</span>
  </div>
);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<KelionStage />} />
            {/* Contact route — previously missing from the router, so
                the "Contact us" menu entry (which calls
                window.location.assign('/contact')) fell through to
                the catch-all below and redirected back to "/". The
                ContactPage component has always existed
                (src/pages/ContactPage.jsx), it just wasn't wired in. */}
            <Route path="/contact" element={<ContactPage />} />
            <Route path="/landing" element={<LandingPage />} />
            {/* Kelion Studio — open via /studio (the main stage will
                link here once voice commands for "open studio" are
                wired in DS-6). Requires an authenticated session;
                KelionStudio will surface the auth error inline if
                the user isn't signed in. */}
            <Route path="/studio" element={<KelionStudio />} />
            {/* Admin dashboard — full-page panel with sidebar navigation.
                Auth-guarded inside AdminLayout (redirects non-admins). */}
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="revenue" element={<RevenuePage />} />
              <Route path="ai" element={<AiCreditsPage />} />
              <Route path="visitors" element={<VisitorsPage />} />
              <Route path="payouts" element={<PayoutsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="agent" element={<AgentPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)

