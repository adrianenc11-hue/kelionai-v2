import { useState } from 'react'
import AvatarSelect from './components/AvatarSelect'
import VoiceChat from './components/VoiceChat'

function App() {
  const [selectedAvatar, setSelectedAvatar] = useState(null)

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0a0a0f' }}>
      {!selectedAvatar ? (
        <AvatarSelect onSelect={setSelectedAvatar} />
      ) : (
        <VoiceChat avatar={selectedAvatar} onBack={() => setSelectedAvatar(null)} />
      )}
    </div>
  )
}

export default App
