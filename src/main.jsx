import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

// Eagerly loaded (small, critical path)
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'

// Lazy-loaded (heavy / auth-gated)
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PricingPage = lazy(() => import('./pages/PricingPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const ReferralPage = lazy(() => import('./pages/ReferralPage'))
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
        <AuthProvider>
          <Suspense fallback={<Loader />}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/pricing" element={<PricingPage />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/referral" element={<ReferralPage />} />
              <Route path="/chat" element={<AvatarSelect />} />
              <Route path="/chat/:avatarId" element={<VoiceChat />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
