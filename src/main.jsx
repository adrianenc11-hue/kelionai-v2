import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
