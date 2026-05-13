import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

import LandingPage from './pages/LandingPage'

const VoiceChat        = lazy(() => import('./components/VoiceChat'))
const AdminPage        = lazy(() => import('./pages/AdminPage'))
const ArmSettingsPage  = lazy(() => import('./pages/ArmSettingsPage'))
const LegalPage        = lazy(() => import('./pages/LegalPage'))

function Loader() {
  return (
    <div style={{
      width: '100vw', height: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0f',
    }}>
      <div style={{
        fontSize: '32px', fontWeight: '800',
        background: 'linear-gradient(135deg, #a855f7, #f472b6)',
        WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
      }}>
        KelionAI…
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<Loader />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/chat" element={<VoiceChat />} />
            <Route path="/chat/:avatar" element={<Navigate to="/chat" replace />} />
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/arm-settings" element={<ArmSettingsPage />} />
            <Route path="/terms"   element={<LegalPage slug="terms"   />} />
            <Route path="/privacy" element={<LegalPage slug="privacy" />} />
            <Route path="/refund"  element={<LegalPage slug="refund"  />} />
            <Route path="/cookies" element={<LegalPage slug="cookies" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
