import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import { installErrorReporter } from './lib/errorReporter'
import { getCsrfToken } from './lib/api'
import './index.css'

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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
