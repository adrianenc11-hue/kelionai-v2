import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCsrfToken } from '../lib/api'
import { useLipSync } from '../lib/lipSync'

const AVATAR = {
  id: 'kelion',
  name: 'Kelion',
  model: '/kelion-rpm_e27cb94d.glb',
  color: '#7c3aed',
  glow: '#a855f7',
}

const ARM_ROT     = { x: 1.3, y: 0.0, z: 0.15 }
const FOREARM_ROT = { x: 0.4, y: 0.0, z: 0.0 }

function KelionModel({ modelPath, mouthOpen = 0 }) {
  const { scene } = useGLTF(modelPath)
  const bonesRef  = useRef({})
  const morphsRef = useRef([])

  useEffect(() => {
    const bones = {}; const morphs = []
    scene.traverse((obj) => {
      if (obj.isBone || obj.type === 'Bone') bones[obj.name] = obj
      if (obj.isSkinnedMesh && obj.skeleton)
        obj.skeleton.bones.forEach(b => { bones[b.name] = b })
      if ((obj.isMesh || obj.isSkinnedMesh) && obj.morphTargetDictionary)
        morphs.push(obj)
    })
    bonesRef.current = bones; morphsRef.current = morphs
    const setRot = (names, x, y, z) => {
      for (const n of names) { if (bones[n]) { bones[n].rotation.set(x, y, z); break } }
    }
    setRot(['LeftArm',  'LeftUpperArm'],  ARM_ROT.x,  ARM_ROT.y,  ARM_ROT.z)
    setRot(['RightArm', 'RightUpperArm'], ARM_ROT.x, -ARM_ROT.y, -ARM_ROT.z)
    setRot(['LeftForeArm'],               FOREARM_ROT.x,  FOREARM_ROT.y,  FOREARM_ROT.z)
    setRot(['RightForeArm'],              FOREARM_ROT.x, -FOREARM_ROT.y, -FOREARM_ROT.z)
  }, [scene])

  useFrame(() => {
    const b = bonesRef.current; if (!b) return
    const set = (names, x, y, z) => {
      for (const n of names) { if (b[n]) { b[n].rotation.x = x; b[n].rotation.y = y; b[n].rotation.z = z; break } }
    }
    set(['LeftArm',  'LeftUpperArm'],  ARM_ROT.x,  ARM_ROT.y,  ARM_ROT.z)
    set(['RightArm', 'RightUpperArm'], ARM_ROT.x, -ARM_ROT.y, -ARM_ROT.z)
    set(['LeftForeArm'],               FOREARM_ROT.x,  FOREARM_ROT.y,  FOREARM_ROT.z)
    set(['RightForeArm'],              FOREARM_ROT.x, -FOREARM_ROT.y, -FOREARM_ROT.z)

    // Lipsync — valori reduse pentru gură naturală
    const jaw = b['Jaw'] || b['mixamorigJaw']
    if (jaw) jaw.rotation.x = mouthOpen * 0.06
    for (const mesh of morphsRef.current) {
      const dict = mesh.morphTargetDictionary; if (!dict) continue
      const idx = dict['mouthOpen'] ?? dict['viseme_AA'] ?? dict['jawOpen']
      if (idx !== undefined) mesh.morphTargetInfluences[idx] = mouthOpen * 0.3
    }
  })

  return <primitive object={scene} scale={1.6} position={[0, -1.6, 0]} rotation={[0, 0, 0]} />
}

export default function VoiceChat() {
  const navigate = useNavigate()

  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Hi! I'm ${AVATAR.name}. How can I help you?` }
  ])
  const [inputText, setInputText]     = useState('')
  const [isListening, setIsListening] = useState(false)
  const [isTalking, setIsTalking]     = useState(false)
  const [isLoading, setIsLoading]     = useState(false)
  const [transcript, setTranscript]   = useState('')

  const messagesRef       = useRef(messages)
  const sendMessageRef    = useRef(null)
  const startListeningRef = useRef(null)
  const recognitionRef    = useRef(null)
  const wasListeningRef   = useRef(false)
  const isListeningRef    = useRef(false)
  const audioRef          = useRef(null)

  // Camera refs
  const videoRef  = useRef(null)
  const streamRef = useRef(null)

  // Real-time context refs
  const coordsRef   = useRef(null)   // { lat, lon }

  const mouthOpen = useLipSync(audioRef)

  useEffect(() => { messagesRef.current = messages }, [messages])
  useEffect(() => { isListeningRef.current = isListening }, [isListening])

  // ── Camera ──────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    if (streamRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
      })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (err) {
      console.warn('[camera]', err.message)
    }
  }, [])

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !streamRef.current) return null
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 320; canvas.height = 240
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0, 320, 240)
      return canvas.toDataURL('image/jpeg', 0.6)
    } catch { return null }
  }, [])

  // ── Geolocation (once on mount, no camera yet) ──────────────────────────────
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { coordsRef.current = { lat: pos.coords.latitude, lon: pos.coords.longitude } },
        () => {}
      )
    }
    return () => stopCamera()
  }, [stopCamera])

  // ── ElevenLabs TTS ──────────────────────────────────────────────────────────
  const speak = useCallback(async (text) => {
    if (!text) return
    setIsTalking(true)
    if (recognitionRef.current && isListeningRef.current) {
      wasListeningRef.current = true
      try { recognitionRef.current.stop() } catch (_) {}
    }
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ text }),
      })
      if (!response.ok) throw new Error('TTS failed')
      const url = URL.createObjectURL(await response.blob())
      if (audioRef.current) {
        audioRef.current.src = url
        audioRef.current.onended = () => {
          setIsTalking(false)
          if (wasListeningRef.current) {
            wasListeningRef.current = false
            setTimeout(() => startListeningRef.current?.(), 300)
          }
        }
        audioRef.current.play().catch(() => setIsTalking(false))
      }
    } catch { setIsTalking(false) }
  }, [])

  // ── Streaming chat ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (userText) => {
    if (!userText.trim()) return
    setIsLoading(true)
    const history = [...messagesRef.current, { role: 'user', content: userText }]
    setMessages(history)
    setInputText(''); setTranscript('')

    const frame    = captureFrame()
    const datetime = new Date().toISOString()
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const coords   = coordsRef.current

    try {
      let assistantText = ''
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])

      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({ messages: history, avatar: AVATAR.id, frame, datetime, timezone, coords }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') { speak(assistantText); break }
          try {
            const parsed = JSON.parse(data)
            if (parsed.content) {
              assistantText += parsed.content
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: assistantText }
                return updated
              })
            }
          } catch (_) {}
        }
      }
    } catch {
      setMessages(prev => {
        const u = [...prev]
        u[u.length - 1] = { role: 'assistant', content: 'Sorry, an error occurred. Please try again.' }
        return u
      })
    } finally { setIsLoading(false) }
  }, [speak, captureFrame])

  useEffect(() => { sendMessageRef.current = sendMessage }, [sendMessage])

  // ── Speech recognition ──────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    startCamera()  // pornește camera + mic împreună
    const rec = new SR()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true; rec.interimResults = true
    rec.onstart  = () => setIsListening(true)
    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1]
      const t = last[0].transcript
      setTranscript(t)
      if (last.isFinal && t.trim()) { setTranscript(''); sendMessageRef.current?.(t) }
    }
    rec.onerror = (e) => { if (e.error !== 'no-speech') setIsListening(false) }
    rec.onend   = () => {
      if (recognitionRef.current === rec && isListeningRef.current) {
        try { rec.start() } catch (_) {}
      } else setIsListening(false)
    }
    recognitionRef.current = rec; rec.start()
  }, [])

  useEffect(() => { startListeningRef.current = startListening }, [startListening])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) { const r = recognitionRef.current; recognitionRef.current = null; r.stop() }
    setIsListening(false)
    stopCamera()
  }, [stopCamera])

  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
  const lastUser      = [...messages].reverse().find(m => m.role === 'user')

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', background: '#0a0a0f' }}>
      <audio ref={audioRef} style={{ display: 'none' }} />
      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />

      {/* ── Avatar panel ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Canvas camera={{ position: [0, 0.3, 3.5], fov: 45 }} style={{ width: '100%', height: '100%' }} gl={{ antialias: true }}>
          <color attach="background" args={['#0a0a0f']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[2, 4, 2]} intensity={1.5} />
          <pointLight position={[0, 1, 2]} intensity={isTalking ? 2 : 0.8} color={AVATAR.glow} />
          <Suspense fallback={null}>
            <hemisphereLight skyColor="#b1e1ff" groundColor="#000000" intensity={0.6} />
            <KelionModel modelPath={AVATAR.model} mouthOpen={mouthOpen} />
          </Suspense>
          <OrbitControls enableZoom={false} enablePan={false}
            minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
            minAzimuthAngle={-Math.PI / 5} maxAzimuthAngle={Math.PI / 5}
          />
        </Canvas>

        <button onClick={() => navigate('/')} style={{
          position: 'absolute', top: '20px', left: '20px',
          background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
          color: '#fff', padding: '8px 16px', borderRadius: '20px',
          cursor: 'pointer', fontSize: '14px', backdropFilter: 'blur(10px)',
        }}>← Back</button>

        <div style={{
          position: 'absolute', bottom: '30px', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)',
          padding: '8px 20px', borderRadius: '30px', border: `1px solid ${AVATAR.color}44`,
        }}>
          {(isTalking || isListening) && (
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%',
              background: isTalking ? AVATAR.glow : '#22c55e',
              animation: 'pulse 0.8s infinite',
              boxShadow: `0 0 10px ${isTalking ? AVATAR.glow : '#22c55e'}`,
            }} />
          )}
          <span style={{ color: AVATAR.glow, fontWeight: '600' }}>{AVATAR.name}</span>
          {isTalking   && <span style={{ color: '#aaa', fontSize: '12px' }}>talking...</span>}
          {isListening && !isTalking && <span style={{ color: '#22c55e', fontSize: '12px' }}>listening...</span>}
          {isLoading   && !isTalking && <span style={{ color: '#f59e0b', fontSize: '12px' }}>thinking...</span>}
        </div>
      </div>

      {/* ── Chat panel ── */}
      <div style={{
        width: '400px', display: 'flex', flexDirection: 'column',
        background: 'rgba(0,0,0,0.35)', borderLeft: '1px solid rgba(255,255,255,0.07)',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
        }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: AVATAR.glow, boxShadow: `0 0 8px ${AVATAR.glow}` }} />
          <span style={{ fontWeight: '600', color: '#fff', fontSize: '15px' }}>Chat with {AVATAR.name}</span>
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#555' }}>🌍 any language</span>
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '24px 20px', gap: '16px' }}>
          {lastAssistant && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '50%', flexShrink: 0,
                background: `linear-gradient(135deg, ${AVATAR.color}, ${AVATAR.glow})`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '14px', fontWeight: '700', color: '#fff',
              }}>K</div>
              <div style={{
                flex: 1, background: 'rgba(255,255,255,0.07)', borderRadius: '4px 18px 18px 18px',
                padding: '14px 16px', color: '#e5e7eb', fontSize: '15px', lineHeight: '1.6',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                {lastAssistant.content || <span style={{ opacity: 0.4 }}>...</span>}
              </div>
            </div>
          )}

          {(lastUser || transcript) && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{
                maxWidth: '80%', padding: '12px 16px', borderRadius: '18px 4px 18px 18px',
                fontSize: '15px', lineHeight: '1.6', color: '#fff',
                background: transcript ? 'rgba(34,197,94,0.15)' : `linear-gradient(135deg, ${AVATAR.color}, ${AVATAR.glow})`,
                border: transcript ? '1px dashed rgba(34,197,94,0.5)' : 'none',
              }}>
                {transcript ? `🎤 ${transcript}` : lastUser?.content}
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          <button
            onClick={() => isListening ? stopListening() : startListening()}
            disabled={isLoading || isTalking}
            style={{
              width: '100%', padding: '14px', marginBottom: '10px',
              borderRadius: '14px', border: 'none',
              cursor: (isLoading || isTalking) ? 'not-allowed' : 'pointer',
              background: isListening ? 'linear-gradient(135deg, #dc2626, #ef4444)' : `linear-gradient(135deg, ${AVATAR.color}, ${AVATAR.glow})`,
              color: '#fff', fontSize: '16px', fontWeight: '600', transition: 'all 0.2s',
              boxShadow: isListening ? '0 0 20px rgba(220,38,38,0.4)' : `0 0 20px ${AVATAR.glow}33`,
              opacity: (isLoading || isTalking) ? 0.6 : 1,
            }}
          >
            {isListening ? '⏹ Stop' : '🎤 Speak'}
          </button>

          <div style={{ display: 'flex', gap: '8px' }}>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(inputText) } }}
              placeholder="Write in any language… (Enter = send)"
              disabled={isLoading || isListening || isTalking}
              rows={2}
              style={{
                flex: 1, background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px',
                color: '#fff', padding: '10px 14px', fontSize: '14px',
                resize: 'none', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => sendMessage(inputText)}
              disabled={isLoading || !inputText.trim() || isListening || isTalking}
              style={{
                background: `linear-gradient(135deg, ${AVATAR.color}, ${AVATAR.glow})`,
                border: 'none', borderRadius: '12px', color: '#fff',
                width: '44px', cursor: 'pointer', fontSize: '18px',
                opacity: (isLoading || !inputText.trim()) ? 0.4 : 1,
              }}
            >➤</button>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.4)} }
        textarea::placeholder { color: #555; }
      `}</style>
    </div>
  )
}
