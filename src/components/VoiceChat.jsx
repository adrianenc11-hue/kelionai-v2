import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useCallback, Component } from 'react'
import Nxcode from '@nxcode/sdk'

const SYSTEM_PROMPT = {
  kelion: `You are Kelion, a friendly and intelligent male AI assistant. Always respond in the same language the user writes in. Be concise and helpful. Personality: calm, professional, empathetic.`,
  kira: `You are Kira, a friendly and enthusiastic female AI assistant. Always respond in the same language the user writes in. Be warm and direct. Personality: cheerful, creative, energetic.`,
}

const LANGUAGES = [
  { code: 'ro-RO', label: '\U0001f1f7\U0001f1f4 RO' },
  { code: 'en-US', label: '\U0001f1fa\U0001f1f8 EN' },
  { code: 'fr-FR', label: '\U0001f1eb\U0001f1f7 FR' },
  { code: 'de-DE', label: '\U0001f1e9\U0001f1ea DE' },
  { code: 'es-ES', label: '\U0001f1ea\U0001f1f8 ES' },
  { code: 'it-IT', label: '\U0001f1ee\U0001f1f9 IT' },
]

// Componenta avatar 3D cu maini lipite de corp
function AvatarModel({ modelPath, avatarId, isTalking }) {
  const { scene } = useGLTF(modelPath)
  const bonesRef = useRef({})

  useEffect(() => {
    const bones = {}
    scene.traverse((obj) => {
      if (obj.isBone || obj.type === 'Bone') bones[obj.name] = obj
      if (obj.isSkinnedMesh && obj.skeleton) {
        obj.skeleton.bones.forEach(b => { bones[b.name] = b })
      }
    })
    bonesRef.current = bones

    const applyRot = (nameList, rot) => {
      for (const name of nameList) {
        const bone = bones[name]
        if (bone) {
          bone.rotation.x = rot.x
          bone.rotation.y = rot.y
          bone.rotation.z = rot.z
          break
        }
      }
    }

    // Maini lipite de corp
    applyRot(['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm', 'Left_Arm'], { x: 0.0, y: 0.0, z: 1.2 })
    applyRot(['RightArm', 'RightUpperArm', 'mixamorigRightArm', 'Right_Arm'], { x: 0.0, y: 0.0, z: -1.2 })
    applyRot(['LeftForeArm', 'mixamorigLeftForeArm', 'Left_ForeArm'], { x: 0.3, y: 0.0, z: 0.0 })
    applyRot(['RightForeArm', 'mixamorigRightForeArm', 'Right_ForeArm'], { x: 0.3, y: 0.0, z: 0.0 })
  }, [scene, avatarId])

  return (
    <primitive
      object={scene}
      scale={2.0}
      position={[0, -2.0, 0]}
      rotation={[0, 0, 0]}
    />
  )
}

// Error Boundary pentru crash-uri Three.js/WebGL
class AvatarErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: '100%', height: '100%', display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: '12px',
        }}>
          <div style={{ fontSize: '80px' }}>
            {this.props.avatarId === 'kira' ? '\U0001f469' : '\U0001f468'}
          </div>
          <div style={{ color: '#aaa', fontSize: '14px' }}>Avatar 3D indisponibil</div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function VoiceChat({ avatar, onBack }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Buna! Sunt ${avatar.name}. Cu ce te pot ajuta?` }
  ])
  const [inputText, setInputText] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isTalking, setIsTalking] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [voiceLang, setVoiceLang] = useState('ro-RO')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [facingMode, setFacingMode] = useState('user')
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recognitionRef = useRef(null)
  const chatEndRef = useRef(null)
  const synthRef = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setHasMultipleCameras(devices.filter(d => d.kind === 'videoinput').length > 1)
    }).catch(() => {})
  }, [])

  const startCamera = useCallback(async (facing) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    try {
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        })
      }
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (err) {
      console.error('Camera error:', err)
      setCameraOpen(false)
    }
  }, [])

  useEffect(() => {
    if (cameraOpen) startCamera(facingMode)
    else {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    }
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    }
  }, [cameraOpen, facingMode])

  const speak = useCallback((text) => {
    if (!synthRef.current || !text) return
    synthRef.current.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = voiceLang
    utter.rate = 1.0
    utter.pitch = avatar.id === 'kira' ? 1.3 : 0.9
    utter.onstart = () => setIsTalking(true)
    utter.onend = () => setIsTalking(false)
    utter.onerror = () => setIsTalking(false)
    synthRef.current.speak(utter)
  }, [avatar.id, voiceLang])

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || isLoading) return
    setIsLoading(true)
    setInputText('')
    setTranscript('')

    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)

    try {
      let assistantText = ''
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      await Nxcode.ai.chatStream({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT[avatar.id] || SYSTEM_PROMPT.kelion },
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
      console.error('AI error:', err)
      const errorMsg = 'Imi pare rau, a aparut o eroare. Te rog incearca din nou.'
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: errorMsg }
        return updated
      })
      speak(errorMsg)
    } finally {
      setIsLoading(false)
    }
  }, [messages, isLoading, avatar.id, speak])

  const toggleListening = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('Browserul tau nu suporta recunoasterea vocala. Foloseste Chrome.')
      return
    }
    synthRef.current?.cancel()
    const recognition = new SpeechRecognition()
    recognition.lang = voiceLang
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
    recognition.onerror = () => { setIsListening(false); setTranscript('') }
    recognition.onend = () => { setIsListening(false) }
    recognitionRef.current = recognition
    recognition.start()
  }, [isListening, voiceLang, sendMessage])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputText)
    }
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#0a0a0f', overflow: 'hidden' }}>
      {/* Avatar 3D - stanga */}
      <div style={{ flex: '0 0 55%', position: 'relative', overflow: 'hidden' }}>
        <AvatarErrorBoundary avatarId={avatar.id}>
          <Canvas
            camera={{ position: [0, 0.2, 2.5], fov: 42 }}
            style={{ width: '100%', height: '100%' }}
            gl={{ antialias: true, alpha: false }}
          >
            <color attach="background" args={['#0a0a0f']} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[2, 4, 2]} intensity={1.5} />
            <pointLight
              position={[0, 1, 2]}
              intensity={isTalking ? 2.5 : 0.8}
              color={avatar.glow}
            />
            <Environment preset="city" />
            <Suspense fallback={null}>
              <AvatarModel
                modelPath={avatar.model}
                avatarId={avatar.id}
                isTalking={isTalking}
              />
            </Suspense>
            <OrbitControls
              enableZoom={false}
              enablePan={false}
              minPolarAngle={Math.PI / 4}
              maxPolarAngle={Math.PI / 1.8}
              minAzimuthAngle={-Math.PI / 5}
              maxAzimuthAngle={Math.PI / 5}
            />
          </Canvas>
        </AvatarErrorBoundary>

        {/* Back button */}
        <button
          onClick={onBack}
          style={{
            position: 'absolute', top: '16px', left: '16px',
            background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', padding: '8px 16px', borderRadius: '20px',
            cursor: 'pointer', fontSize: '14px', backdropFilter: 'blur(10px)', zIndex: 10,
          }}
        >
          \u2190 Inapoi
        </button>

        {/* Camera button */}
        <button
          onClick={() => setCameraOpen(prev => !prev)}
          style={{
            position: 'absolute', top: '16px', right: '16px',
            background: cameraOpen
              ? `linear-gradient(135deg, ${avatar.color}, ${avatar.glow})`
              : 'rgba(0,0,0,0.7)',
            border: `1px solid ${cameraOpen ? avatar.glow : 'rgba(255,255,255,0.2)'}`,
            color: '#fff', padding: '8px 14px', borderRadius: '20px',
            cursor: 'pointer', fontSize: '13px', backdropFilter: 'blur(10px)', zIndex: 10,
          }}
        >
          {cameraOpen ? '\U0001f4f7 Opreste' : '\U0001f4f7 Camera'}
        </button>

        {cameraOpen && hasMultipleCameras && (
          <button
            onClick={() => setFacingMode(prev => prev === 'user' ? 'environment' : 'user')}
            style={{
              position: 'absolute', top: '56px', right: '16px',
              background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', padding: '6px 12px', borderRadius: '16px',
              cursor: 'pointer', fontSize: '12px', zIndex: 10,
            }}
          >
            \U0001f504 Flip
          </button>
        )}

        {/* Video invizibil - doar pentru AI */}
        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />

        {/* Avatar name + talking indicator */}
        <div style={{
          position: 'absolute', bottom: '20px', left: '50%',
          transform: 'translateX(-50%)', zIndex: 10,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
            padding: '8px 20px', borderRadius: '30px',
            border: `1px solid ${avatar.color}44`,
          }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: isTalking ? avatar.glow : '#555',
              boxShadow: isTalking ? `0 0 10px ${avatar.glow}` : 'none',
              animation: isTalking ? 'pulse 0.8s infinite' : 'none',
              transition: 'all 0.3s',
            }} />
            <span style={{ color: '#fff', fontWeight: '600', fontSize: '15px' }}>
              {avatar.name}
            </span>
            {isTalking && (
              <span style={{ color: avatar.glow, fontSize: '12px' }}>vorbeste...</span>
            )}
          </div>
        </div>
      </div>

      {/* Chat Panel - dreapta */}
      <div style={{
        flex: '0 0 45%', display: 'flex', flexDirection: 'column',
        borderLeft: `1px solid ${avatar.color}33`,
        background: 'rgba(0,0,0,0.5)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: '10px',
          background: 'rgba(0,0,0,0.3)', flexShrink: 0,
        }}>
          <div style={{
            width: '10px', height: '10px', borderRadius: '50%',
            background: avatar.glow, boxShadow: `0 0 8px ${avatar.glow}`,
          }} />
          <span style={{ fontWeight: '600', color: '#fff', fontSize: '14px' }}>
            Chat cu {avatar.name}
          </span>
          <select
            value={voiceLang}
            onChange={e => setVoiceLang(e.target.value)}
            style={{
              marginLeft: 'auto', background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px',
              color: '#ccc', fontSize: '12px', padding: '4px 8px', cursor: 'pointer',
            }}
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code} style={{ background: '#1a1a2e' }}>
                {l.label}
              </option>
            ))}
          </select>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '14px',
          display: 'flex', flexDirection: 'column', gap: '10px',
        }}>
          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              <div style={{
                maxWidth: '85%', padding: '10px 14px', borderRadius: '16px',
                fontSize: '14px', lineHeight: '1.6',
                background: msg.role === 'user'
                  ? `linear-gradient(135deg, ${avatar.color}, ${avatar.glow})`
                  : 'rgba(255,255,255,0.08)',
                color: '#fff',
                borderBottomRightRadius: msg.role === 'user' ? '4px' : '16px',
                borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : '16px',
                wordBreak: 'break-word', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
              }}>
                {msg.content || <span style={{ opacity: 0.5 }}>...</span>}
              </div>
            </div>
          ))}
          {transcript && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                maxWidth: '85%', padding: '10px 14px', borderRadius: '16px',
                fontSize: '14px', background: 'rgba(168,85,247,0.2)',
                border: '1px dashed rgba(168,85,247,0.5)', color: '#ccc',
              }}>
                \U0001f3a4 {transcript}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div style={{ padding: '14px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          <button
            onClick={toggleListening}
            disabled={isLoading}
            style={{
              width: '100%', padding: '12px', marginBottom: '10px',
              borderRadius: '14px', border: 'none',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              background: isListening
                ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                : `linear-gradient(135deg, ${avatar.color}, ${avatar.glow})`,
              color: '#fff', fontSize: '15px', fontWeight: '600',
              transition: 'all 0.2s',
              boxShadow: isListening
                ? '0 0 20px rgba(220,38,38,0.5)'
                : `0 0 20px ${avatar.glow}44`,
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isListening ? '\u23f9 Stop' : '\U0001f3a4 Vorbeste'}
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Scrie in orice limba... (Enter = trimite)"
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
              \u27a4
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
      `}</style>
    </div>
  )
}
