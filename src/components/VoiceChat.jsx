import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useCallback, Component } from 'react'

const SYSTEM_PROMPT = {
  kelion: `You are Kelion, a friendly and intelligent AI assistant. ALWAYS respond in the SAME language the user writes or speaks in. Be concise and helpful. Personality: calm, professional, empathetic. If the user speaks Romanian, reply in Romanian. If English, reply in English. Always match the user's language exactly.`,
}

// Default arm positions - arms close to body
const DEFAULT_ARM_ROT = { x: 1.3, y: 0.0, z: 0.15 }
const DEFAULT_FOREARM_ROT = { x: 0.4, y: 0.0, z: 0.0 }

// 3D Avatar Model
function AvatarModel({ modelPath, avatarId, isTalking, armRot, forearmRot }) {
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
  }, [scene, avatarId])

  useFrame(() => {
    const bones = bonesRef.current
    if (!bones) return

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

    applyRot(['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm', 'Left_Arm'], {
      x: armRot.x, y: armRot.y, z: armRot.z
    })
    applyRot(['RightArm', 'RightUpperArm', 'mixamorigRightArm', 'Right_Arm'], {
      x: armRot.x, y: -armRot.y, z: -armRot.z
    })
    applyRot(['LeftForeArm', 'mixamorigLeftForeArm', 'Left_ForeArm'], {
      x: forearmRot.x, y: forearmRot.y, z: forearmRot.z
    })
    applyRot(['RightForeArm', 'mixamorigRightForeArm', 'Right_ForeArm'], {
      x: forearmRot.x, y: -forearmRot.y, z: -forearmRot.z
    })
  })

  return (
    <primitive
      object={scene}
      scale={1.5}
      position={[0, -1.5, 0]}
      rotation={[0, 0, 0]}
    />
  )
}

// Error Boundary
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
          <div style={{ fontSize: '80px' }}>🤖</div>
          <div style={{ color: '#aaa', fontSize: '14px' }}>3D Avatar unavailable</div>
        </div>
      )
    }
    return this.props.children
  }
}

// Find the best native male voice for a given language code
function findMaleVoice(langCode) {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  // Extract base language (e.g., "ro" from "ro-RO")
  const baseLang = langCode ? langCode.split('-')[0].toLowerCase() : 'en'

  // Filter voices matching the language
  const langVoices = voices.filter(v => v.lang.toLowerCase().startsWith(baseLang))

  // Prefer male voices (heuristic: name contains male-related keywords, or doesn't contain female keywords)
  const maleKeywords = ['male', 'man', 'david', 'james', 'mark', 'daniel', 'google uk english male', 'andrei', 'ivan', 'hans', 'jorge', 'luca', 'pierre']
  const femaleKeywords = ['female', 'woman', 'zira', 'samantha', 'victoria', 'karen', 'moira', 'fiona', 'alice', 'anna', 'elena', 'maria', 'natalya']

  // Try to find an explicit male voice
  const male = langVoices.find(v => {
    const name = v.name.toLowerCase()
    return maleKeywords.some(k => name.includes(k))
  })
  if (male) return male

  // Try to find a voice that's NOT female
  const notFemale = langVoices.find(v => {
    const name = v.name.toLowerCase()
    return !femaleKeywords.some(k => name.includes(k))
  })
  if (notFemale) return notFemale

  // Fallback: first voice in that language
  if (langVoices.length) return langVoices[0]

  // Last resort: any voice
  return voices[0]
}

export default function VoiceChat({ avatar, onBack }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Hi! I'm ${avatar.name}. How can I help you today?` }
  ])
  const [inputText, setInputText] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isTalking, setIsTalking] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [detectedLang, setDetectedLang] = useState('en')

  const armRot = DEFAULT_ARM_ROT
  const forearmRot = DEFAULT_FOREARM_ROT

  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const recognitionRef = useRef(null)
  const chatEndRef = useRef(null)
  const synthRef = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null)
  const shouldListenRef = useRef(true)
  const isLoadingRef = useRef(false)
  const isTalkingRef = useRef(false)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Preload voices
  useEffect(() => {
    const loadVoices = () => { window.speechSynthesis.getVoices() }
    loadVoices()
    window.speechSynthesis.onvoiceschanged = loadVoices
  }, [])

  // Start camera + mic on mount
  const startMediaDevices = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (err) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = audioStream
      } catch (audioErr) {
        console.warn('Media devices unavailable:', audioErr.message)
      }
    }
  }, [])

  const stopMediaDevices = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      shouldListenRef.current = false
      stopMediaDevices()
      recognitionRef.current?.abort()
    }
  }, [stopMediaDevices])

  // Speak with native male voice in detected language
  const speak = useCallback((text, langCode) => {
    if (!synthRef.current || !text) return
    synthRef.current.cancel()
    const utter = new SpeechSynthesisUtterance(text)

    // Set language
    if (langCode) utter.lang = langCode

    // Find native male voice
    const voice = findMaleVoice(langCode || 'en')
    if (voice) utter.voice = voice

    utter.rate = 1.0
    utter.pitch = 0.85 // slightly lower for male
    utter.onstart = () => { setIsTalking(true); isTalkingRef.current = true }
    utter.onend = () => {
      setIsTalking(false)
      isTalkingRef.current = false
      // Auto-restart listening after AI finishes speaking
      setTimeout(() => {
        if (shouldListenRef.current && !isLoadingRef.current) {
          startListening()
        }
      }, 300)
    }
    utter.onerror = () => {
      setIsTalking(false)
      isTalkingRef.current = false
      setTimeout(() => {
        if (shouldListenRef.current && !isLoadingRef.current) {
          startListening()
        }
      }, 300)
    }
    synthRef.current.speak(utter)
  }, [])

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !streamRef.current) return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')
      ctx.drawImage(videoRef.current, 0, 0, 320, 240)
      return canvas.toDataURL('image/jpeg', 0.7)
    } catch { return null }
  }, [])

  const sendMessage = useCallback(async (text, lang) => {
    if (!text.trim() || isLoadingRef.current) return
    setIsLoading(true)
    isLoadingRef.current = true
    setInputText('')
    setTranscript('')

    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      let assistantText = ''
      const aiMessages = newMessages.map(m => ({ role: m.role, content: m.content }))

      // Capture camera frame for AI Vision
      const frame = captureFrame()

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          messages: aiMessages,
          systemPrompt: SYSTEM_PROMPT[avatar.id] || SYSTEM_PROMPT.kelion,
          image: frame || undefined,
        })
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              speak(assistantText, lang || detectedLang)
              break
            }
            try {
              const parsed = JSON.parse(data)
              assistantText += parsed.content || ''
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantText }
                return updated
              })
            } catch {}
          }
        }
      }
    } catch (err) {
      console.error('AI error:', err)
      const errorMsg = "I'm sorry, an error occurred. Please try again."
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: errorMsg }
        return updated
      })
      speak(errorMsg, 'en')
    } finally {
      setIsLoading(false)
      isLoadingRef.current = false
    }
  }, [messages, avatar.id, speak, detectedLang])

  // Start listening — auto, no button needed
  const startListening = useCallback(() => {
    if (isLoadingRef.current || isTalkingRef.current) return

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    // Stop any existing recognition
    try { recognitionRef.current?.abort() } catch {}

    synthRef.current?.cancel()
    const recognition = new SpeechRecognition()
    // Don't set lang — let browser auto-detect any language
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onstart = () => setIsListening(true)

    recognition.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('')
      setTranscript(t)

      if (e.results[e.results.length - 1].isFinal) {
        // Detect language from the recognition result
        const resultLang = e.results[0][0].lang || recognition.lang || ''
        if (resultLang) setDetectedLang(resultLang)

        recognition.stop()
        sendMessage(t, resultLang)
      }
    }

    recognition.onerror = (e) => {
      setIsListening(false)
      setTranscript('')
      // Auto-restart on non-fatal errors (like no-speech)
      if (e.error === 'no-speech' || e.error === 'aborted') {
        setTimeout(() => {
          if (shouldListenRef.current && !isLoadingRef.current && !isTalkingRef.current) {
            startListening()
          }
        }, 500)
      }
    }

    recognition.onend = () => {
      setIsListening(false)
      // If we didn't get a result and should still listen, restart
      // (sendMessage handles restart after AI responds via speak callback)
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [sendMessage])

  // Auto-start listening on mount + start media devices
  useEffect(() => {
    shouldListenRef.current = true
    startMediaDevices().then(() => {
      // Small delay to let media settle
      setTimeout(() => {
        if (shouldListenRef.current) startListening()
      }, 500)
    })
  }, [startMediaDevices, startListening])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputText)
    }
  }

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#0a0a0f', overflow: 'hidden', fontFamily: "'Inter', sans-serif" }}>
      {/* Avatar 3D - left */}
      <div style={{ flex: '0 0 55%', position: 'relative', overflow: 'hidden' }}>
        <AvatarErrorBoundary avatarId={avatar.id}>
          <Canvas
            camera={{ position: [0, 0.3, 3.2], fov: 45 }}
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
                armRot={armRot}
                forearmRot={forearmRot}
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
          onClick={() => { shouldListenRef.current = false; recognitionRef.current?.abort(); synthRef.current?.cancel(); onBack() }}
          style={{
            position: 'absolute', top: '16px', left: '16px',
            background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', padding: '8px 16px', borderRadius: '20px',
            cursor: 'pointer', fontSize: '14px', backdropFilter: 'blur(10px)', zIndex: 10,
          }}
        >
          ← Back
        </button>

        {/* Hidden video for AI vision */}
        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />

        {/* Avatar name + status indicator */}
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
              background: isTalking ? avatar.glow : isListening ? '#22c55e' : '#555',
              boxShadow: isTalking ? `0 0 10px ${avatar.glow}` : isListening ? '0 0 10px #22c55e' : 'none',
              animation: (isTalking || isListening) ? 'pulse 0.8s infinite' : 'none',
              transition: 'all 0.3s',
            }} />
            <span style={{ color: '#fff', fontWeight: '600', fontSize: '15px' }}>
              {avatar.name}
            </span>
            {isTalking && (
              <span style={{ color: avatar.glow, fontSize: '12px' }}>speaking...</span>
            )}
            {isListening && !isTalking && (
              <span style={{ color: '#22c55e', fontSize: '12px' }}>listening...</span>
            )}
            {isLoading && !isTalking && (
              <span style={{ color: '#f59e0b', fontSize: '12px' }}>thinking...</span>
            )}
          </div>
        </div>
      </div>

      {/* Chat Panel - right */}
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
            Chat with {avatar.name}
          </span>
          <span style={{ marginLeft: 'auto', color: '#555', fontSize: '11px' }}>
            Auto voice detection
          </span>
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
                fontSize: '14px', background: 'rgba(34,197,94,0.15)',
                border: '1px dashed rgba(34,197,94,0.5)', color: '#ccc',
              }}>
                🎤 {transcript}
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input area — text only, mic is automatic */}
        <div style={{ padding: '14px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          {/* Listening status bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px',
            padding: '8px 14px', borderRadius: '10px',
            background: isListening ? 'rgba(34,197,94,0.1)' : isTalking ? `rgba(168,85,247,0.1)` : 'rgba(255,255,255,0.03)',
            border: `1px solid ${isListening ? 'rgba(34,197,94,0.3)' : isTalking ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)'}`,
          }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: isListening ? '#22c55e' : isTalking ? avatar.glow : '#555',
              animation: (isListening || isTalking) ? 'pulse 0.8s infinite' : 'none',
            }} />
            <span style={{ color: isListening ? '#22c55e' : isTalking ? avatar.glow : '#666', fontSize: '12px', fontWeight: '500' }}>
              {isListening ? 'Listening... speak in any language' : isTalking ? `${avatar.name} is speaking...` : isLoading ? 'Thinking...' : 'Waiting...'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Or type here... (Enter = send)"
              disabled={isLoading || isTalking}
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
              disabled={isLoading || !inputText.trim() || isTalking}
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
          50% { opacity: 0.5; transform: scale(1.4); }
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 2px; }
      `}</style>
    </div>
  )
}
