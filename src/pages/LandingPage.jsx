import { Suspense, useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'
import { getCsrfToken } from '../lib/api'

// ── Fingerprint anti-abuse ──────────────────────────────────────────────────
function getFingerprint() {
  const parts = [
    navigator.userAgent, navigator.language,
    screen.width + 'x' + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency || 0,
  ]
  let hash = 0
  const str = parts.join('|')
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

function checkDemoUsed() {
  try {
    const fp = getFingerprint()
    const key = `demo_used_${fp}`
    const data = JSON.parse(localStorage.getItem(key) || 'null')
    if (!data) return { used: false, fp, key }
    const elapsed = Date.now() - data.ts
    if (elapsed > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(key)
      return { used: false, fp, key }
    }
    return { used: true, fp, key, usedAt: new Date(data.ts).toLocaleString() }
  } catch {
    return { used: false, fp: 'unknown', key: 'demo_used_unknown' }
  }
}

function markDemoUsed(key) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now() })) } catch {}
}

// ── Avatar 3D ───────────────────────────────────────────────────────────────
const KELION_MODEL = '/kelion-rpm_e27cb94d.glb'
const DEFAULT_ARM     = { x: 1.3, y: 0.0, z: 0.15 }
const DEFAULT_FOREARM = { x: 0.4, y: 0.0, z: 0.0 }

// Read saved arm positions from localStorage (set via ArmSettings page)
function getSavedArm() {
  try {
    const data = JSON.parse(localStorage.getItem('arm_rot_kelion') || localStorage.getItem('arm_rot_landing') || 'null')
    if (data && data.arm && data.forearm) return data
  } catch {}
  return { arm: { ...DEFAULT_ARM }, forearm: { ...DEFAULT_FOREARM } }
}

function KelionModel({ armRot, forearmRot }) {
  const { scene } = useGLTF(KELION_MODEL)
  const bonesRef = useRef(null)

  // Initial bone setup — same pattern as AvatarSelect
  useEffect(() => {
    const bones = {}
    scene.traverse((obj) => {
      if (obj.isBone || obj.type === 'Bone') bones[obj.name] = obj
      if (obj.isSkinnedMesh && obj.skeleton) {
        obj.skeleton.bones.forEach(b => { bones[b.name] = b })
      }
    })
    bonesRef.current = bones
    const setRot = (names, x, y, z) => {
      for (const n of names) {
        if (bones[n]) { bones[n].rotation.set(x, y, z); break }
      }
    }
    setRot(['LeftArm', 'LeftUpperArm'],   armRot.x,  armRot.y,  armRot.z)
    setRot(['RightArm', 'RightUpperArm'], armRot.x, -armRot.y, -armRot.z)
    setRot(['LeftForeArm'],               forearmRot.x,  forearmRot.y,  forearmRot.z)
    setRot(['RightForeArm'],              forearmRot.x, -forearmRot.y, -forearmRot.z)
  }, [scene, armRot, forearmRot])

  // Persistent enforcement every frame
  useFrame(() => {
    const b = bonesRef.current
    if (!b) return
    const set = (names, rot) => {
      for (const n of names) {
        if (b[n]) { b[n].rotation.x = rot.x; b[n].rotation.y = rot.y; b[n].rotation.z = rot.z; break }
      }
    }
    set(['LeftArm', 'LeftUpperArm'],   { x: armRot.x, y:  armRot.y, z:  armRot.z })
    set(['RightArm', 'RightUpperArm'], { x: armRot.x, y: -armRot.y, z: -armRot.z })
    set(['LeftForeArm'],               { x: forearmRot.x, y:  forearmRot.y, z:  forearmRot.z })
    set(['RightForeArm'],              { x: forearmRot.x, y: -forearmRot.y, z: -forearmRot.z })
  })

  return <primitive object={scene} scale={1.6} position={[0, -1.6, 0]} rotation={[0, 0, 0]} />
}

// ── Find native male voice for any language ─────────────────────────────────
function findMaleVoice(langCode) {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const baseLang = langCode ? langCode.split('-')[0].toLowerCase() : 'en'
  const langVoices = voices.filter(v => v.lang.toLowerCase().startsWith(baseLang))
  const maleKw = ['male','man','david','james','mark','daniel','andrei','ivan','hans','jorge','luca','pierre','pablo','marco']
  const femaleKw = ['female','woman','zira','samantha','victoria','karen','moira','fiona','alice','anna','elena','maria','natalya']
  const male = langVoices.find(v => { const n = v.name.toLowerCase(); return maleKw.some(k => n.includes(k)) })
  if (male) return male
  const notFemale = langVoices.find(v => { const n = v.name.toLowerCase(); return !femaleKw.some(k => n.includes(k)) })
  if (notFemale) return notFemale
  if (langVoices.length) return langVoices[0]
  return voices[0]
}

// ── Demo Chat (auto voice, auto camera, no buttons) ─────────────────────────
function DemoChat({ onExpire, onPricing }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I'm Kelion, your AI assistant. Speak in any language — I'm listening!" }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isTalking, setIsTalking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [timeLeft, setTimeLeft] = useState(15 * 60)

  const chatEndRef = useRef(null)
  const recognitionRef = useRef(null)
  const synthRef = useRef(window.speechSynthesis)
  const timerRef = useRef(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const shouldListenRef = useRef(true)
  const isLoadingRef = useRef(false)
  const isTalkingRef = useRef(false)
  const messagesRef = useRef(messages)

  // Keep messagesRef in sync
  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Preload voices
  useEffect(() => {
    const load = () => { window.speechSynthesis.getVoices() }
    load()
    window.speechSynthesis.onvoiceschanged = load
  }, [])

  // Countdown timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); onExpire(); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [onExpire])

  const formatTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`

  // Start camera + mic together (camera hidden, only for AI)
  const startMediaDevices = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = audioStream
      } catch (err) {
        console.warn('Media unavailable:', err.message)
      }
    }
  }, [])

  // Stop camera + mic completely
  const stopMediaDevices = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  // Cleanup on unmount — disconnect everything
  useEffect(() => {
    return () => {
      shouldListenRef.current = false
      try { recognitionRef.current?.abort() } catch {}
      synthRef.current?.cancel()
      stopMediaDevices()
      clearInterval(timerRef.current)
    }
  }, [stopMediaDevices])

  // Speak with native male voice
  const speak = useCallback((text, langCode) => {
    if (!synthRef.current || !text) return
    synthRef.current.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    if (langCode) utter.lang = langCode
    const voice = findMaleVoice(langCode || 'en')
    if (voice) utter.voice = voice
    utter.rate = 1.0
    utter.pitch = 0.85
    utter.onstart = () => { setIsTalking(true); isTalkingRef.current = true }
    utter.onend = () => {
      setIsTalking(false); isTalkingRef.current = false
      setTimeout(() => {
        if (shouldListenRef.current && !isLoadingRef.current) startListening()
      }, 300)
    }
    utter.onerror = () => {
      setIsTalking(false); isTalkingRef.current = false
      setTimeout(() => {
        if (shouldListenRef.current && !isLoadingRef.current) startListening()
      }, 300)
    }
    synthRef.current.speak(utter)
  }, [])

  // Capture camera frame for AI Vision (hidden from user)
  const captureFrame = useCallback(() => {
    if (!videoRef.current || !streamRef.current) return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 240
      const ctx = canvas.getContext('2d')
      ctx.drawImage(videoRef.current, 0, 0, 320, 240)
      return canvas.toDataURL('image/jpeg', 0.7)
    } catch { return null }
  }, [])

  // Send message to AI
  const sendMessage = useCallback(async (text, lang) => {
    if (!text.trim() || isLoadingRef.current) return
    setIsLoading(true); isLoadingRef.current = true
    setInput(''); setTranscript('')

    const newMessages = [...messagesRef.current, { role: 'user', content: text }]
    setMessages(newMessages)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    // Capture camera frame for AI Vision
    const frame = captureFrame()

    try {
      let assistantText = ''
      const res = await fetch('/api/chat/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        })
      })
      if (!res.ok) throw new Error('AI error')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') { speak(assistantText, lang); break }
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
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: "Sorry, connection error. Please try again." }
        return updated
      })
    } finally {
      setIsLoading(false); isLoadingRef.current = false
    }
  }, [speak])

  // Auto-listen — no button, starts automatically
  const startListening = useCallback(() => {
    if (isLoadingRef.current || isTalkingRef.current) return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    try { recognitionRef.current?.abort() } catch {}
    synthRef.current?.cancel()

    const rec = new SR()
    // No lang set → auto-detect any language
    rec.continuous = false
    rec.interimResults = true

    rec.onstart = () => setIsListening(true)
    rec.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join('')
      setTranscript(t)
      if (e.results[e.results.length - 1].isFinal) {
        const resultLang = e.results[0][0].lang || rec.lang || ''
        rec.stop()
        sendMessage(t, resultLang)
      }
    }
    rec.onerror = (e) => {
      setIsListening(false); setTranscript('')
      if (e.error === 'no-speech' || e.error === 'aborted') {
        setTimeout(() => {
          if (shouldListenRef.current && !isLoadingRef.current && !isTalkingRef.current) startListening()
        }, 500)
      }
    }
    rec.onend = () => { setIsListening(false) }
    recognitionRef.current = rec
    rec.start()
  }, [sendMessage])

  // Auto-start: camera + mic + listening on mount
  useEffect(() => {
    shouldListenRef.current = true
    startMediaDevices().then(() => {
      setTimeout(() => { if (shouldListenRef.current) startListening() }, 500)
    })
  }, [startMediaDevices, startListening])

  const urgentColor = timeLeft < 60 ? '#ef4444' : timeLeft < 180 ? '#f59e0b' : '#22c55e'

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex',
      background: '#0a0a0f', overflow: 'hidden', fontFamily: "'Inter', sans-serif",
    }}>
      {/* Avatar left */}
      <div style={{ flex: '0 0 55%', position: 'relative' }}>
        <Canvas camera={{ position: [0, 0.3, 3.5], fov: 45 }} style={{ width: '100%', height: '100%' }} gl={{ antialias: true }}>
          <color attach="background" args={['#0a0a0f']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[2, 4, 2]} intensity={1.5} />
          <pointLight position={[0, 1, 2]} intensity={isTalking ? 2.5 : 0.8} color="#a855f7" />
          <Suspense fallback={null}>
              <hemisphereLight skyColor="#b1e1ff" groundColor="#000000" intensity={0.6} />
            <KelionModel armRot={DEFAULT_ARM} forearmRot={DEFAULT_FOREARM} />
          </Suspense>
          <OrbitControls enableZoom={false} enablePan={false}
            minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
            minAzimuthAngle={-Math.PI / 5} maxAzimuthAngle={Math.PI / 5}
          />
        </Canvas>

        {/* Hidden video — camera feeds AI only, never displayed */}
        <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />

        {/* Timer */}
        <div style={{
          position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)',
          border: `1px solid ${urgentColor}55`, borderRadius: '20px',
          padding: '6px 18px', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 10,
        }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: urgentColor, animation: 'pulse 1s infinite' }} />
          <span style={{ color: urgentColor, fontWeight: '700', fontSize: '14px', fontFamily: 'monospace' }}>
            {formatTime(timeLeft)} remaining
          </span>
        </div>

        {/* Status badge */}
        <div style={{
          position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
          padding: '8px 20px', borderRadius: '30px', border: '1px solid rgba(168,85,247,0.3)',
          display: 'flex', alignItems: 'center', gap: '8px', zIndex: 10,
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: isTalking ? '#a855f7' : isListening ? '#22c55e' : '#555',
            boxShadow: isTalking ? '0 0 10px #a855f7' : isListening ? '0 0 10px #22c55e' : 'none',
            animation: (isTalking || isListening) ? 'pulse 0.8s infinite' : 'none',
          }} />
          <span style={{ color: '#fff', fontWeight: '600', fontSize: '15px' }}>Kelion</span>
          {isTalking && <span style={{ color: '#a855f7', fontSize: '12px' }}>speaking...</span>}
          {isListening && !isTalking && <span style={{ color: '#22c55e', fontSize: '12px' }}>listening...</span>}
          {isLoading && !isTalking && <span style={{ color: '#f59e0b', fontSize: '12px' }}>thinking...</span>}
        </div>
      </div>

      {/* Chat right */}
      <div style={{
        flex: '0 0 45%', display: 'flex', flexDirection: 'column',
        borderLeft: '1px solid rgba(168,85,247,0.2)', background: 'rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(0,0,0,0.3)', flexShrink: 0,
        }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px #a855f7' }} />
          <span style={{ color: '#fff', fontWeight: '600', fontSize: '14px' }}>Chat with Kelion</span>
          <span style={{ marginLeft: 'auto', color: '#555', fontSize: '11px' }}>Auto voice detection</span>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', padding: '10px 14px', borderRadius: '16px',
                fontSize: '14px', lineHeight: '1.6', color: '#fff',
                background: msg.role === 'user' ? 'linear-gradient(135deg, #7c3aed, #a855f7)' : 'rgba(255,255,255,0.08)',
                borderBottomRightRadius: msg.role === 'user' ? '4px' : '16px',
                borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : '16px',
                wordBreak: 'break-word',
              }}>
                {msg.content || <span style={{ opacity: 0.4 }}>...</span>}
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

        {/* Input — text only, voice is automatic */}
        <div style={{ padding: '14px', borderTop: '1px solid rgba(255,255,255,0.08)', flexShrink: 0 }}>
          {/* Status bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px',
            padding: '8px 14px', borderRadius: '10px',
            background: isListening ? 'rgba(34,197,94,0.1)' : isTalking ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${isListening ? 'rgba(34,197,94,0.3)' : isTalking ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)'}`,
          }}>
            <div style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: isListening ? '#22c55e' : isTalking ? '#a855f7' : '#555',
              animation: (isListening || isTalking) ? 'pulse 0.8s infinite' : 'none',
            }} />
            <span style={{
              color: isListening ? '#22c55e' : isTalking ? '#a855f7' : '#666',
              fontSize: '12px', fontWeight: '500',
            }}>
              {isListening ? 'Listening... speak in any language' : isTalking ? 'Kelion is speaking...' : isLoading ? 'Thinking...' : 'Waiting...'}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
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
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim() || isTalking}
              style={{
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                border: 'none', borderRadius: '12px', color: '#fff',
                width: '44px', cursor: 'pointer', fontSize: '18px',
                opacity: isLoading || !input.trim() ? 0.4 : 1,
              }}
            >➤</button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px}
      `}</style>
    </div>
  )
}

// ── Trial Expired → go to pricing ───────────────────────────────────────────
function TrialExpired({ onPricing }) {
  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0a0a0f', fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{
        textAlign: 'center', maxWidth: '480px', padding: '48px 32px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(168,85,247,0.3)',
        borderRadius: '24px', backdropFilter: 'blur(20px)',
      }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>⏱</div>
        <h2 style={{ color: '#fff', fontSize: '28px', fontWeight: '800', margin: '0 0 12px' }}>
          Your free trial has ended
        </h2>
        <p style={{ color: '#888', fontSize: '16px', lineHeight: '1.6', margin: '0 0 32px' }}>
          You've used your 15-minute free trial. To continue using Kelion, please choose a subscription plan.
        </p>
        <button
          onClick={onPricing}
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
            border: 'none', borderRadius: '12px', color: '#fff',
            padding: '16px 40px', fontSize: '17px', fontWeight: '700', cursor: 'pointer',
            boxShadow: '0 8px 30px rgba(168,85,247,0.4)',
          }}
        >
          View Subscription Plans →
        </button>
      </div>
    </div>
  )
}

// ── Already Used → go to pricing ────────────────────────────────────────────
function AlreadyUsed({ usedAt, onPricing, onSignIn }) {
  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0a0a0f', fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{
        textAlign: 'center', maxWidth: '480px', padding: '48px 32px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(168,85,247,0.3)',
        borderRadius: '24px', backdropFilter: 'blur(20px)',
      }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>🔒</div>
        <h2 style={{ color: '#fff', fontSize: '28px', fontWeight: '800', margin: '0 0 12px' }}>
          Free trial already used
        </h2>
        <p style={{ color: '#888', fontSize: '16px', lineHeight: '1.6', margin: '0 0 8px' }}>
          You already used your 15-minute free trial on this device.
        </p>
        <p style={{ color: '#555', fontSize: '13px', margin: '0 0 32px' }}>
          Used on: {usedAt}
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={onPricing}
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '12px', color: '#fff',
              padding: '14px 28px', fontSize: '16px', fontWeight: '700', cursor: 'pointer',
            }}
          >
            View Plans →
          </button>
          <button
            onClick={onSignIn}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '12px', color: '#ccc',
              padding: '14px 28px', fontSize: '16px', cursor: 'pointer',
            }}
          >
            Sign In
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Landing Page ────────────────────────────────────────────────────────
export default function LandingPage() {
  const navigate = useNavigate()
  const onSignIn = () => navigate('/login')
  const onPricing = () => navigate('/pricing')
  const [demoState, setDemoState] = useState('landing')
  const [demoInfo, setDemoInfo] = useState(null)

  const demoKeyRef = useRef(null)

  const handleStartDemo = () => {
    const check = checkDemoUsed()
    if (check.used) {
      setDemoInfo(check)
      setDemoState('used')
    } else {
      demoKeyRef.current = check.key
      setDemoState('demo')
    }
  }

  const handleDemoExpire = () => {
    if (demoKeyRef.current) markDemoUsed(demoKeyRef.current)
    setDemoState('expired')
  }

  if (demoState === 'demo') {
    return <DemoChat onExpire={handleDemoExpire} onPricing={onPricing} />
  }

  if (demoState === 'expired') {
    return <TrialExpired onPricing={onPricing} />
  }

  if (demoState === 'used') {
    return <AlreadyUsed usedAt={demoInfo?.usedAt} onPricing={onPricing} onSignIn={onSignIn} />
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0a0a0f', fontFamily: "'Inter', sans-serif", overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 40px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)',
        position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <span style={{
          fontSize: '22px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>KelionAI</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: '600' }}>Online</span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onPricing} style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '8px', color: '#ccc', padding: '8px 18px', fontSize: '14px', cursor: 'pointer',
          }}>Pricing</button>
          <button onClick={onSignIn} style={{
            background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
            border: 'none', borderRadius: '8px', color: '#fff',
            padding: '8px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
          }}>Sign In</button>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: '0 0 52%', position: 'relative' }}>
          <Canvas camera={{ position: [0, 0.3, 3.5], fov: 45 }} style={{ width: '100%', height: '100%' }} gl={{ antialias: true }}>
            <color attach="background" args={['#0a0a0f']} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[2, 4, 2]} intensity={1.5} />
            <pointLight position={[0, 1, 2]} intensity={0.8} color="#a855f7" />
            <Suspense fallback={null}>
                <hemisphereLight skyColor="#b1e1ff" groundColor="#000000" intensity={0.6} />
              <KelionModel armRot={getSavedArm().arm} forearmRot={getSavedArm().forearm} />
            </Suspense>
            <OrbitControls enableZoom={false} enablePan={false}
              minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
              minAzimuthAngle={-Math.PI / 5} maxAzimuthAngle={Math.PI / 5}
            />
          </Canvas>
          <div style={{
            position: 'absolute', bottom: '10%', left: '50%', transform: 'translateX(-50%)',
            width: '200px', height: '30px',
            background: 'radial-gradient(ellipse, rgba(168,85,247,0.4) 0%, transparent 70%)',
            filter: 'blur(10px)', pointerEvents: 'none',
          }} />
        </div>

        <div style={{
          flex: '0 0 48%', display: 'flex', flexDirection: 'column',
          justifyContent: 'center', padding: '40px 48px',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ color: '#a855f7', fontSize: '12px', fontWeight: '700', letterSpacing: '3px', marginBottom: '16px', textTransform: 'uppercase' }}>
            YOUR AI ASSISTANT
          </div>
          <h1 style={{
            fontSize: '64px', fontWeight: '900', margin: '0 0 20px',
            background: 'linear-gradient(135deg, #ffffff, #a855f7)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: '1.1',
          }}>Kelion</h1>
          <p style={{ color: '#888', fontSize: '17px', lineHeight: '1.7', margin: '0 0 32px', maxWidth: '380px' }}>
            Intelligent, empathetic and always available. Speak naturally — Kelion understands, responds and helps you in real time.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '36px' }}>
            {[
              { icon: '🎙', title: 'Natural Voice', desc: 'Automatic voice detection in any language' },
              { icon: '👁', title: 'AI Vision', desc: 'Sees and understands your context' },
              { icon: '🌍', title: 'Any Language', desc: 'Native voice response in your language' },
            ].map(f => (
              <div key={f.title} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                  background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
                }}>{f.icon}</div>
                <div>
                  <div style={{ color: '#fff', fontWeight: '600', fontSize: '14px' }}>{f.title}</div>
                  <div style={{ color: '#666', fontSize: '13px' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '380px' }}>
            <button onClick={handleStartDemo} style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '14px', color: '#fff',
              padding: '16px 32px', fontSize: '17px', fontWeight: '700',
              cursor: 'pointer', boxShadow: '0 8px 30px rgba(168,85,247,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
            }}>▶ Start Free 15-min Demo</button>
            <span
              onClick={onSignIn}
              style={{
                color: '#777', fontSize: '13px', cursor: 'pointer', textAlign: 'center',
                marginTop: '4px', textDecoration: 'underline', textUnderlineOffset: '3px',
              }}
            >Already have an account? Sign in above ↗</span>
          </div>

          <p style={{ color: '#444', fontSize: '12px', marginTop: '16px' }}>
            ✓ No credit card required · ✓ No account needed for demo · ✓ 15 minutes free
          </p>
        </div>
      </div>
    </div>
  )
}
