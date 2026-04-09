import { useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginPage from './pages/LoginPage'
import Dashboard from './pages/Dashboard'
import PricingPage from './pages/PricingPage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/AdminPage'
import AvatarSelect from './components/AvatarSelect'
import VoiceChat from './components/VoiceChat'

function AppInner() {
  const { user, loading } = useAuth()
  const [page, setPage]   = useState('dashboard')        // current page
  const [selectedAvatar, setSelectedAvatar] = useState(null)

  // While checking auth status, show a minimal loader
  if (loading) {
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

  // Not logged in → show login page (pricing is also public)
  if (!user) {
    if (page === 'pricing') {
      return <PricingPage onNavigate={setPage} />
    }
    return <LoginPage />
  }

  // Logged in – handle navigation
  if (page === 'chat') {
    if (!selectedAvatar) {
      return <AvatarSelect onSelect={(av) => { setSelectedAvatar(av); setPage('chat') }} />
    }
    return (
      <VoiceChat
        avatar={selectedAvatar}
        onBack={() => { setSelectedAvatar(null); setPage('dashboard') }}
      />
    )
  }

  if (page === 'pricing') return <PricingPage onNavigate={setPage} />
  if (page === 'profile') return <ProfilePage onNavigate={setPage} />
  if (page === 'admin')   return <AdminPage   onNavigate={setPage} />

  // Default: dashboard
  return <Dashboard onNavigate={(p) => { setPage(p); if (p !== 'chat') setSelectedAvatar(null) }} />
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
