import { useState, useEffect, useRef, Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, useGLTF } from '@react-three/drei'

// ── Fingerprint anti-abuse ──────────────────────────────────────────────────
function getFingerprint() {
  const parts = [
    navigator.userAgent,
    navigator.language,
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
    // Demo expires after 24h
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
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now() }))
  } catch {}
}

// ── Avatar 3D ───────────────────────────────────────────────────────────────
const KELION_MODEL = '/models/kelion.glb'

function KelionModel({ isTalking }) {
  const { scene } = useGLTF(KELION_MODEL)
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

    // Set arms close to body
    const setArm = (names, rot) => {
      for (const n of names) {
        if (bones[n]) { Object.assign(bones[n].rotation, rot); break }
      }
    }
    setArm(['LeftArm','LeftUpperArm','mixamorigLeftArm'],  { x: 0, y: 0, z: 1.2 })
    setArm(['RightArm','RightUpperArm','mixamorigRightArm'], { x: 0, y: 0, z: -1.2 })
    setArm(['LeftForeArm','mixamorigLeftForeArm'],  { x: 0.3, y: 0, z: 0 })
    setArm(['RightForeArm','mixamorigRightForeArm'], { x: 0.3, y: 0, z: 0 })
  }, [scene])

  return (
    <primitive object={scene} scale={1.6} position={[0, -1.6, 0]} rotation={[0, 0, 0]} />
  )
}

// ── Demo Chat ────────────────────────────────────────────────────────────────
function DemoChat({ onExpire, onSignUp }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi! I'm Kelion, your AI assistant. Ask me anything — I speak any language!" }
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isTalking, setIsTalking] = useState(false)
  const [timeLeft, setTimeLeft] = useState(15 * 60) // 15 minutes in seconds
  const chatEndRef = useRef(null)
  const recognitionRef = useRef(null)
  const synthRef = useRef(window.speechSynthesis)
  const timerRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Countdown timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current)
          onExpire()
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [onExpire])

  const formatTime = (s) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const speak = (text) => {
    if (!synthRef.current || !text) return
    synthRef.current.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = 1.0
    utter.pitch = 0.9
    utter.onstart = () => setIsTalking(true)
    utter.onend = () => setIsTalking(false)
    utter.onerror = () => setIsTalking(false)
    synthRef.current.speak(utter)
  }

  const sendMessage = async (text) => {
    if (!text.trim() || isLoading) return
    setIsLoading(true)
    setInput('')

    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages,
          systemPrompt: "You are Kelion, a friendly and intelligent AI assistant. Always respond in the same language the user writes in. Be concise, helpful, and empathetic. This is a demo — keep responses brief (2-3 sentences max)."
        })
      })

      if (!res.ok) throw new Error('AI error')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let assistantText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        const lines = chunk.split('\n')
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim()
            if (data === '[DONE]') {
              speak(assistantText)
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
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: "Sorry, I couldn't connect. Please try again." }
        return updated
      })
    } finally {
      setIsLoading(false)
    }
  }

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Voice recognition requires Chrome browser.'); return }
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = false
    rec.onstart = () => setIsListening(true)
    rec.onresult = (e) => {
      const t = e.results[0][0].transcript
      rec.stop()
      sendMessage(t)
    }
    rec.onerror = () => { setIsListening(false) }
    rec.onend = () => setIsListening(false)
    recognitionRef.current = rec
    rec.start()
  }

  const urgentColor = timeLeft < 60 ? '#ef4444' : timeLeft < 3 * 60 ? '#f59e0b' : '#22c55e'

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
          <Environment preset="city" />
          <Suspense fallback={null}>
            <KelionModel isTalking={isTalking} />
          </Suspense>
          <OrbitControls enableZoom={false} enablePan={false}
            minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
            minAzimuthAngle={-Math.PI / 5} maxAzimuthAngle={Math.PI / 5}
          />
        </Canvas>

        {/* Timer */}
        <div style={{
          position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)',
          border: `1px solid ${urgentColor}55`, borderRadius: '20px',
          padding: '6px 18px', display: 'flex', alignItems: 'center', gap: '8px', zIndex: 10,
        }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: urgentColor, animation: 'pulse 1s infinite' }} />
          <span style={{ color: urgentColor, fontWeight: '700', fontSize: '14px', fontFamily: 'monospace' }}>
            {formatTime(timeLeft)} free trial remaining
          </span>
        </div>

        {/* Kelion name badge */}
        <div style={{
          position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(10px)',
          padding: '8px 20px', borderRadius: '30px', border: '1px solid rgba(168,85,247,0.3)',
          display: 'flex', alignItems: 'center', gap: '8px', zIndex: 10,
        }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: isTalking ? '#a855f7' : '#555',
            boxShadow: isTalking ? '0 0 10px #a855f7' : 'none',
          }} />
          <span style={{ color: '#fff', fontWeight: '600', fontSize: '15px' }}>Kelion</span>
          {isTalking && <span style={{ color: '#a855f7', fontSize: '12px' }}>speaking...</span>}
        </div>
      </div>

      {/* Chat right */}
      <div style={{
        flex: '0 0 45%', display: 'flex', flexDirection: 'column',
        borderLeft: '1px solid rgba(168,85,247,0.2)',
        background: 'rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(0,0,0,0.3)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px #a855f7' }} />
            <span style={{ color: '#fff', fontWeight: '600', fontSize: '14px' }}>Chat with Kelion</span>
          </div>
          <button
            onClick={onSignUp}
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '8px', color: '#fff',
              padding: '6px 14px', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
            }}
          >
            Sign Up Free →
          </button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%', padding: '10px 14px', borderRadius: '16px',
                fontSize: '14px', lineHeight: '1.6', color: '#fff',
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, #7c3aed, #a855f7)'
                  : 'rgba(255,255,255,0.08)',
                borderBottomRightRadius: msg.role === 'user' ? '4px' : '16px',
                borderBottomLeftRadius: msg.role === 'assistant' ? '4px' : '16px',
                wordBreak: 'break-word',
              }}>
                {msg.content || <span style={{ opacity: 0.4 }}>...</span>}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '14px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={toggleListening}
            disabled={isLoading}
            style={{
              width: '100%', padding: '12px', marginBottom: '10px',
              borderRadius: '14px', border: 'none', cursor: 'pointer',
              background: isListening
                ? 'linear-gradient(135deg, #dc2626, #ef4444)'
                : 'linear-gradient(135deg, #7c3aed, #a855f7)',
              color: '#fff', fontSize: '15px', fontWeight: '600',
              boxShadow: isListening ? '0 0 20px rgba(220,38,38,0.4)' : '0 0 20px rgba(168,85,247,0.3)',
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isListening ? '⏹ Stop' : '🎤 Speak'}
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
              placeholder="Type in any language... (Enter to send)"
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
              onClick={() => sendMessage(input)}
              disabled={isLoading || !input.trim() || isListening}
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
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15);border-radius:2px}
      `}</style>
    </div>
  )
}

// ── Trial Expired Screen ─────────────────────────────────────────────────────
function TrialExpired({ onSignUp, onPricing }) {
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
          You've used your 15-minute free trial. Create an account to continue chatting with Kelion — no credit card required to start.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button
            onClick={onSignUp}
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '12px', color: '#fff',
              padding: '14px 28px', fontSize: '16px', fontWeight: '700', cursor: 'pointer',
            }}
          >
            Create Free Account
          </button>
          <button
            onClick={onPricing}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '12px', color: '#ccc',
              padding: '14px 28px', fontSize: '16px', cursor: 'pointer',
            }}
          >
            View Plans
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Already Used Screen ──────────────────────────────────────────────────────
function AlreadyUsed({ usedAt, onSignUp, onPricing }) {
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
            onClick={onSignUp}
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '12px', color: '#fff',
              padding: '14px 28px', fontSize: '16px', fontWeight: '700', cursor: 'pointer',
            }}
          >
            Sign Up / Log In
          </button>
          <button
            onClick={onPricing}
            style={{
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '12px', color: '#ccc',
              padding: '14px 28px', fontSize: '16px', cursor: 'pointer',
            }}
          >
            View Plans
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Landing Page ────────────────────────────────────────────────────────
export default function LandingPage({ onSignIn, onPricing }) {
  const [demoState, setDemoState] = useState('landing') // 'landing' | 'demo' | 'expired' | 'used'
  const [demoInfo, setDemoInfo] = useState(null)
  const [isTalking, setIsTalking] = useState(false)

  const handleStartDemo = () => {
    const check = checkDemoUsed()
    if (check.used) {
      setDemoInfo(check)
      setDemoState('used')
    } else {
      markDemoUsed(check.key)
      setDemoState('demo')
    }
  }

  if (demoState === 'demo') {
    return (
      <DemoChat
        onExpire={() => setDemoState('expired')}
        onSignUp={onSignIn}
      />
    )
  }

  if (demoState === 'expired') {
    return <TrialExpired onSignUp={onSignIn} onPricing={onPricing} />
  }

  if (demoState === 'used') {
    return <AlreadyUsed usedAt={demoInfo?.usedAt} onSignUp={onSignIn} onPricing={onPricing} />
  }

  // Landing page
  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0a0a0f', fontFamily: "'Inter', sans-serif", overflow: 'hidden',
    }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 40px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)',
        position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '22px', fontWeight: '800',
            background: 'linear-gradient(135deg, #a855f7, #f472b6)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>KelionAI</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: '600' }}>Online</span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={onPricing}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '8px', color: '#ccc', padding: '8px 18px',
              fontSize: '14px', cursor: 'pointer',
            }}
          >
            Pricing
          </button>
          <button
            onClick={onSignIn}
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '8px', color: '#fff',
              padding: '8px 18px', fontSize: '14px', fontWeight: '600', cursor: 'pointer',
            }}
          >
            Sign In
          </button>
        </div>
      </header>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Avatar */}
        <div style={{ flex: '0 0 52%', position: 'relative' }}>
          <Canvas camera={{ position: [0, 0.3, 3.5], fov: 45 }} style={{ width: '100%', height: '100%' }} gl={{ antialias: true }}>
            <color attach="background" args={['#0a0a0f']} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[2, 4, 2]} intensity={1.5} />
            <pointLight position={[0, 1, 2]} intensity={0.8} color="#a855f7" />
            <Environment preset="city" />
            <Suspense fallback={null}>
              <KelionModel isTalking={false} />
            </Suspense>
            <OrbitControls enableZoom={false} enablePan={false}
              minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
              minAzimuthAngle={-Math.PI / 5} maxAzimuthAngle={Math.PI / 5}
            />
          </Canvas>
          {/* Glow under avatar */}
          <div style={{
            position: 'absolute', bottom: '10%', left: '50%', transform: 'translateX(-50%)',
            width: '200px', height: '30px',
            background: 'radial-gradient(ellipse, rgba(168,85,247,0.4) 0%, transparent 70%)',
            filter: 'blur(10px)', pointerEvents: 'none',
          }} />
        </div>

        {/* Info panel */}
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
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            lineHeight: '1.1',
          }}>
            Kelion
          </h1>
          <p style={{ color: '#888', fontSize: '17px', lineHeight: '1.7', margin: '0 0 32px', maxWidth: '380px' }}>
            Intelligent, empathetic and always available. Speak naturally — Kelion understands, responds and helps you in real time.
          </p>

          {/* Features */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '36px' }}>
            {[
              { icon: '🎙', title: 'Natural Voice', desc: 'Advanced voice recognition in any language' },
              { icon: '👁', title: 'AI Vision', desc: 'Sees and understands your context' },
              { icon: '🌍', title: 'Any Language', desc: 'Speaks and understands all languages' },
            ].map(f => (
              <div key={f.title} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                  background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
                }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{ color: '#fff', fontWeight: '600', fontSize: '14px' }}>{f.title}</div>
                  <div style={{ color: '#666', fontSize: '13px' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '380px' }}>
            <button
              onClick={handleStartDemo}
              style={{
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                border: 'none', borderRadius: '14px', color: '#fff',
                padding: '16px 32px', fontSize: '17px', fontWeight: '700',
                cursor: 'pointer', transition: 'all 0.2s',
                boxShadow: '0 8px 30px rgba(168,85,247,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              }}
              onMouseEnter={e => e.target.style.transform = 'translateY(-2px)'}
              onMouseLeave={e => e.target.style.transform = 'translateY(0)'}
            >
              ▶ Start Free 15-min Demo
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
              <span style={{ color: '#555', fontSize: '12px' }}>or</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
            </div>
            <button
              onClick={onSignIn}
              style={{
                background: 'transparent', border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '14px', color: '#ccc',
                padding: '14px 32px', fontSize: '15px', cursor: 'pointer',
                textAlign: 'center',
              }}
            >
              Already have an account? Sign In
            </button>
          </div>

          <p style={{ color: '#444', fontSize: '12px', marginTop: '16px' }}>
            ✓ No credit card required &nbsp;·&nbsp; ✓ No account needed for demo &nbsp;·&nbsp; ✓ 15 minutes free
          </p>
        </div>
      </div>
    </div>
  )
}
