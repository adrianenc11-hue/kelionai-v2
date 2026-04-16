import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import VoiceChat from './components/VoiceChat'
import ArmSettingsPage from './pages/ArmSettingsPage'
import AdminPage from './pages/AdminPage'

function ChatWrapper() {
  const { avatar } = useParams()
  return <VoiceChat avatar={avatar || 'kelion'} />
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/chat" element={<ChatWrapper />} />
        <Route path="/chat/:avatar" element={<ChatWrapper />} />
        <Route path="/arm-settings" element={<ArmSettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  )
}

export default App
