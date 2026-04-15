import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

import LandingPage from './pages/LandingPage'

const AvatarSelect = lazy(() => import('./components/AvatarSelect'))
const VoiceChat = lazy(() => import('./components/VoiceChat'))

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
            <Route path="/chat" element={<AvatarSelect />} />
            <Route path="/chat/:avatarId" element={<VoiceChat />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
