import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useCallback } from 'react'
import Nxcode from '@nxcode/sdk'
import { AvatarModelDebug, DebugPanel } from './AvatarDebug'

const SYSTEM_PROMPT = {
  kelion: `Ești Kelion, un asistent AI masculin prietenos și inteligent. Răspunzi în română, ești concis și util. Personalitate: calm, profesionist, empatic.`,
  kira: `Ești Kira, o asistentă AI feminină prietenoasă și entuziastă. Răspunzi în română, ești caldă și directă. Personalitate: veselă, creativă, plină de energie.`,
}

export default function VoiceChat({ avatar, onBack }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Bună! Sunt ${avatar.name}. Cu ce te pot ajuta?` }
  ])
  const [inputText, setInputText] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isTalking, setIsTalking] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [transcript, setTranscript] = useState('')

  // Debug state
  const [showDebug, setShowDebug] = useState(false)
  const [debugConfig, setDebugConfig] = useState({
    scale: 1.8, posX: 0, posY: -1.8, posZ: 0,
    leftArm: { x: 0, y: 0, z: 0 },
    rightArm: { x: 0, y: 0, z: 0 },
  })
  const [boneNames, setBoneNames] = useState([])

  const recognitionRef = useRef(null)
  const chatEndRef = useRef(null)
  const synthRef = useRef(window.speechSynthesis)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const speak = useCallback((text) => {
    synthRef.current.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = 'ro-RO'
    utter.rate = 1.0
    utter.pitch = avatar.id === 'kira' ? 1.3 : 0.9
    utter.onstart = () => setIsTalking(true)
    utter.onend = () => setIsTalking(false)
    synthRef.current.speak(utter)
  }, [avatar.id])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim()) return
    setIsLoading(true)
    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setInputText('')
    setTranscript('')

    try {
      let assistantText = ''
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      await Nxcode.ai.chatStream({
        messages: [
          { role: 'user', content: SYSTEM_PROMPT[avatar.id] },
          ...newMessages,
        ],
        model: 'fast',
        onChunk: (chunk) => {
          assistantText += chunk.content || ''
          setMessages(prev => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: assistantText }
            return updated
          })
          if (chunk.done) speak(assistantText)
        }
      })
    } catch (err) {
      const errorMsg = 'Îmi pare rău, a apărut o eroare. Încearcă din nou.'
      setMessages(prev => [...prev, { role: 'assistant', content: errorMsg }])
      speak(errorMsg)
    } finally {
      setIsLoading(false)
    }
  }, [messages, avatar.id, speak])

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop()
      return
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Browser-ul tău nu suportă recunoașterea vocii. Folosește Chrome.')
      return
    }

    synthRef.current.cancel()
    const recognition = new SpeechRecognition()
    recognition.lang = 'ro-RO'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onstart = () => setIsListening(true)
    recognition.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('')
      setTranscript(t)
      if (e.results[e.results.length - 1].isFinal) {
        recognition.stop()
        sendMessage(t)
      }
    }
    recognition.onerror = () => setIsListening(false)
    recognition.onend = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
  }, [isListening, sendMessage])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputText)
    }
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#0a0a0f' }}>
      {/* Avatar 3D */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas camera={{ position: [0, 0.5, 3], fov: 45 }}>
          <ambientLight intensity={0.4} />
          <directionalLight position={[2, 4, 2]} intensity={1.5} />
          <pointLight position={[0, 2, 2]} intensity={isTalking ? 2 : 0.5} color={avatar.glow} />
          <Environment preset="city" />
          <Suspense fallback={null}>
            <AvatarModelDebug
              modelPath={avatar.model}
              debugConfig={debugConfig}
              onBonesReady={setBoneNames}
            />
          </Suspense>
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            minPolarAngle={Math.PI / 4}
            maxPolarAngle={Math.PI / 1.8}
          />
        </Canvas>

        {/* Back button */}
        <button
          onClick={onBack}
          style={{
            position: 'absolute', top: '20px', left: '20px',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', padding: '8px 16px', borderRadius: '20px',
            cursor: 'pointer', fontSize: '14px', backdropFilter: 'blur(10px)',
          }}
        >
          ← Înapoi
        </button>

        {/* Debug toggle button */}
        <button
          onClick={() => setShowDebug(v => !v)}
          style={{
            position: 'absolute', top: '20px', right: '20px',
            background: showDebug
              ? `linear-gradient(135deg, ${avatar.color}, ${avatar.glow})`
              : 'rgba(255,255,255,0.1)',
            border: `1px solid ${showDebug ? avatar.glow : 'rgba(255,255,255,0.2)'}`,
            color: '#fff', padding: '8px 14px', borderRadius: '20px',
            cursor: 'pointer', fontSize: '13px', backdropFilter: 'blur(10px)',
          }}
        >
          {showDebug ? '✕ Debug' : '🔧 Debug'}
        </button>

        {/* Debug Panel */}
        <DebugPanel
          visible={showDebug}
          avatarColor={avatar.color}
          avatarGlow={avatar.glow}
          onConfigChange={setDebugConfig}
          boneNames={boneNames}
        />

        {/* Avatar name + talking indicator */}
        <div style={{
          position: 'absolute', bottom: '30px', left: '50%',
          transform: 'translateX(-50%)', textAlign: 'center',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)',
            padding: '8px 20px', borderRadius: '30px',
            border: `1px solid ${avatar.color}44`,
          }}>
            {isTalking && (
              <span style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: avatar.glow, animation: 'pulse 0.8s infinite',
                boxShadow: `0 0 10px ${avatar.glow}`,
              }} />
            )}
            <span style={{ color: avatar.glow, fontWeight: '600' }}>{avatar.name}</span>
            {isTalking && <span style={{ color: '#aaa', fontSize: '12px' }}>vorbește...</span>}
          </div>
        </div>
      </div>

      {/* Chat Panel */}
      <div style={{
        width: '380px', display: 'flex', flexDirection: 'column',
        background: 'rgba(255,255,255,0.03)', borderLeft: '1px solid rgba(255,255,255,0.08)',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: avatar.glow, boxShadow: `0 0 8px ${avatar.glow}`,
          }} />
          <span style={{ fontWeight: '600', color: '#fff' }}>Chat cu {avatar.name}</span>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '16px',
          display: 'flex', flexDirection: 'column', gap: '12px',
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '80%', padding: '10px 14px', borderRadius: '16px',
                fontSize: '14px', lineHeight: '1.5',
                background: msg.role === 'user'
                  ? `linear-gradient(135deg, ${avatar.color}, ${avatar.glow})`
                  : 'rgba(255,255,255,0.08)',
                color: '#fff',
                borderBottomRightRadius: msg.role === 'user' ? '4px' : '16px',
                borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : '16px',
              }}>
                {msg.content || <span style={{ opacity: 0.5 }}>...</span>}
              </div>
            </div>
          ))}
          {transcript && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                maxWidth: '80%', padding: '10px 14px', borderRadius: '16px',
                fontSize: '14px', background: 'rgba(168,85,247,0.2)',
                border: '1px dashed rgba(168,85,247,0.5)', color: '#ccc',
              }}>
                🎤 {transcript}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {/* Voice button */}
          <button
            onClick={toggleListening}
            disabled={isLoading}
            style={{
              width: '100%', padding: '14px', marginBottom: '10px',
              borderRadius: '14px', border: 'none', cursor: isLoading ? 'not-allowed' : 'pointer',
              background: isListening
                ? `linear-gradient(135deg, #dc2626, #ef4444)`
                : `linear-gradient(135deg, ${avatar.color}, ${avatar.glow})`,
              color: '#fff', fontSize: '16px', fontWeight: '600',
              transition: 'all 0.2s',
              boxShadow: isListening ? '0 0 20px rgba(220,38,38,0.5)' : `0 0 20px ${avatar.glow}44`,
            }}
          >
            {isListening ? '⏹ Oprește' : '🎤 Vorbește'}
          </button>

          {/* Text input */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Sau scrie aici... (Enter = trimite)"
              disabled={isLoading || isListening}
              rows={2}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px',
                color: '#fff', padding: '10px 14px', fontSize: '14px',
                resize: 'none', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => sendMessage(inputText)}
              disabled={isLoading || !inputText.trim() || isListening}
              style={{
                background: `linear-gradient(135deg, ${avatar.color}, ${avatar.glow})`,
                border: 'none', borderRadius: '12px', color: '#fff',
                width: '44px', cursor: 'pointer', fontSize: '18px',
                opacity: isLoading || !inputText.trim() ? 0.4 : 1,
              }}
            >
              ➤
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
