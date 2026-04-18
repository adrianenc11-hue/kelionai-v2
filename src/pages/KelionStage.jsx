import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, Environment, ContactShadows, Float } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { useLipSync } from '../lib/lipSync'
import { STATUS_COLORS, STATUS_PULSE_HZ } from '../lib/kelionStatus'
import { useGeminiLive } from '../lib/geminiLive'
import {
  supportsPasskey,
  registerPasskey,
  authenticateWithPasskey,
  fetchMe,
  signOut,
} from '../lib/passkeyClient'
import {
  fetchMemory,
  extractAndStore,
  forgetAllMemory,
} from '../lib/memoryClient'
import {
  pushSupported,
  getPushStatus,
  enablePush,
  disablePush,
  sendTestPing,
} from '../lib/pushClient'
import { useEmotion } from '../lib/emotionStore'

// Stage 6 — M26 voice-style menu presets (labels match server VOICE_STYLES).
const VOICE_STYLE_OPTIONS = [
  { key: 'warm',    label: 'Warm' },
  { key: 'playful', label: 'Playful' },
  { key: 'calm',    label: 'Calm' },
  { key: 'focused', label: 'Focused' },
]
async function setVoiceStyle(style) {
  try {
    const r = await fetch('/api/realtime/voice-style', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ style }),
    })
    const j = await r.json().catch(() => ({}))
    return j?.ok ? j.style : null
  } catch { return null }
}
function readVoiceStyleCookie() {
  if (typeof document === 'undefined') return 'warm'
  const m = document.cookie.match(/(?:^|;\s*)kelion\.voice_style=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : 'warm'
}

// ───── Avatar with idle animation + lipsync + Stage 6 emotion morphs ─────
function AvatarModel({ mouthOpen = 0, status = 'idle', emotion = null }) {
  const { scene } = useGLTF('/kelion-rpm_e27cb94d.glb')
  const root = useRef()
  const bonesRef = useRef({})
  const morphsRef = useRef([])
  const blinkRef = useRef({ t: 0, nextBlinkAt: 2 + Math.random() * 4, duration: 0.18, phase: 0 })

  useEffect(() => {
    const bones = {}
    const morphs = []
    scene.traverse((o) => {
      if (o.isBone) bones[o.name] = o
      if (o.isSkinnedMesh && o.skeleton) {
        o.skeleton.bones.forEach((b) => { bones[b.name] = b })
      }
      if ((o.isMesh || o.isSkinnedMesh) && o.morphTargetDictionary) {
        morphs.push(o)
        if (o.material) {
          o.material.envMapIntensity = 0.85
        }
      }
      if (o.isMesh) o.castShadow = true
    })
    bonesRef.current = bones
    morphsRef.current = morphs

    // Natural arm rest pose
    const setRot = (names, x, y, z) => {
      for (const n of names) {
        if (bones[n]) { bones[n].rotation.set(x, y, z); return }
      }
    }
    setRot(['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm'], 1.3, 0, 0.18)
    setRot(['RightArm', 'RightUpperArm', 'mixamorigRightArm'], 1.3, 0, -0.18)
    setRot(['LeftForeArm', 'mixamorigLeftForeArm'], 0.35, 0, 0)
    setRot(['RightForeArm', 'mixamorigRightForeArm'], 0.35, 0, 0)
  }, [scene])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const b = bonesRef.current
    if (!b) return

    // Breathing — subtle chest rise
    const breath = Math.sin(t * 0.8) * 0.015
    const spine = b['Spine'] || b['mixamorigSpine'] || b['Spine1']
    if (spine) spine.rotation.x = -0.05 + breath

    // Micro head movement — never still
    const head = b['Head'] || b['mixamorigHead']
    if (head) {
      head.rotation.y = Math.sin(t * 0.45) * 0.025
      head.rotation.x = Math.sin(t * 0.62) * 0.02 - 0.02
      head.rotation.z = Math.cos(t * 0.38) * 0.015
    }

    // Lipsync — drive jaw + viseme morphs
    const jaw = b['Jaw'] || b['mixamorigJaw']
    if (jaw) jaw.rotation.x = mouthOpen * 0.08

    // Natural blink cycle
    const blink = blinkRef.current
    blink.t += delta
    if (blink.t >= blink.nextBlinkAt && blink.phase === 0) {
      blink.phase = 1
      blink.t = 0
    }
    let blinkStrength = 0
    if (blink.phase === 1) {
      const p = blink.t / blink.duration
      blinkStrength = p < 0.5 ? p * 2 : 2 - p * 2
      if (blink.t >= blink.duration) {
        blink.phase = 0
        blink.t = 0
        blink.nextBlinkAt = 2.5 + Math.random() * 4.5
      }
    }

    // Stage 6 — emotion morph weights (0..1 per ARKit/RPM morph name).
    // We multiply by the detected intensity so faint cues = subtle reaction.
    const emoMorphs = (emotion && emotion.state !== 'neutral' && emotion.profile?.morphs) || null
    const emoScale  = emotion ? emotion.intensity : 0

    for (const m of morphsRef.current) {
      const d = m.morphTargetDictionary
      if (!d) continue
      const mouthIdx = d['mouthOpen'] ?? d['viseme_aa'] ?? d['viseme_AA'] ?? d['jawOpen']
      if (mouthIdx !== undefined) {
        m.morphTargetInfluences[mouthIdx] = mouthOpen * 0.45
      }
      const baseSmile = status === 'listening' ? 0.08 : 0.04
      const emotionSmile = emoMorphs ? (emoMorphs.mouthSmile || emoMorphs.mouthSmileLeft || 0) * emoScale : 0
      const smileIdx = d['mouthSmile'] ?? d['mouthSmileLeft']
      if (smileIdx !== undefined) {
        m.morphTargetInfluences[smileIdx] = Math.min(0.9, baseSmile + emotionSmile)
      }
      const blinkLIdx = d['eyeBlinkLeft'] ?? d['eyesClosed']
      const blinkRIdx = d['eyeBlinkRight']
      const tiredBoost = emoMorphs && emoMorphs.eyeBlinkLeft ? emoMorphs.eyeBlinkLeft * emoScale : 0
      if (blinkLIdx !== undefined) m.morphTargetInfluences[blinkLIdx] = Math.max(blinkStrength, tiredBoost)
      if (blinkRIdx !== undefined) m.morphTargetInfluences[blinkRIdx] = Math.max(blinkStrength, tiredBoost)

      // Apply the rest of the emotion morph weights directly by name when
      // the mesh exposes them. Unknown keys silently no-op.
      if (emoMorphs) {
        for (const [key, weight] of Object.entries(emoMorphs)) {
          if (key === 'mouthSmile' || key === 'mouthSmileLeft' || key === 'eyeBlinkLeft' || key === 'eyeBlinkRight') continue
          const idx = d[key]
          if (idx !== undefined) m.morphTargetInfluences[idx] = weight * emoScale
        }
      }
    }
  })

  return <primitive ref={root} object={scene} scale={1.65} position={[0, -1.65, 0]} />
}

// ───── Status halo — pulsating light behind avatar ─────
function Halo({ status = 'idle', voiceLevel = 0, emotion = null }) {
  const mesh = useRef()
  // Stage 6 — blend status color toward emotion tint by intensity.
  const computeTarget = () => {
    const base = new THREE.Color(STATUS_COLORS[status] || STATUS_COLORS.idle)
    if (emotion && emotion.state !== 'neutral' && emotion.profile?.halo) {
      const emo = new THREE.Color(emotion.profile.halo)
      base.lerp(emo, Math.min(0.7, emotion.intensity * 0.8))
    }
    return base
  }
  const color = useMemo(computeTarget, [status, emotion?.state, emotion?.intensity])
  const colorTarget = useRef(color.clone())

  useEffect(() => { colorTarget.current = computeTarget() }, [status, emotion?.state, emotion?.intensity])

  useFrame((state) => {
    if (!mesh.current) return
    const t = state.clock.elapsedTime
    const hz = STATUS_PULSE_HZ[status] || STATUS_PULSE_HZ.idle
    const basePulse = 0.88 + Math.sin(t * hz * Math.PI * 2) * 0.08
    const voiceBoost = status === 'listening' ? voiceLevel * 0.4 : 0
    const scale = basePulse + voiceBoost
    mesh.current.scale.set(scale, scale, 1)
    mesh.current.material.color.lerp(colorTarget.current, 0.08)
    mesh.current.material.opacity = 0.55 + Math.sin(t * hz * Math.PI * 2) * 0.1
  })

  return (
    <mesh ref={mesh} position={[0, 0.2, -0.8]}>
      <circleGeometry args={[1.6, 64]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.6}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

// ───── Luxury studio decor — NYC skyline through panoramic windows ─────
// Adrian asked to swap the old animated color panels for a night-time New
// York skyline seen through floor-to-ceiling windows. We also killed the
// breathing-light animation because it was tiring.
function useNYCSkylineTexture() {
  return useMemo(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 2048
    canvas.height = 1024
    const ctx = canvas.getContext('2d')
    // Deep-night sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, 1024)
    sky.addColorStop(0, '#04060e')
    sky.addColorStop(0.45, '#0b1029')
    sky.addColorStop(0.72, '#1a1236')
    sky.addColorStop(1, '#2a1640')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, 2048, 1024)
    // Stars
    for (let i = 0; i < 140; i++) {
      const s = 0.3 + Math.random() * 0.6
      ctx.fillStyle = `rgba(255,255,255,${s})`
      ctx.fillRect(Math.random() * 2048, Math.random() * 350, 1, 1)
    }
    // Distant back layer of buildings
    let x = 0
    while (x < 2048) {
      const w = 50 + Math.random() * 70
      const h = 150 + Math.random() * 180
      const y = 1024 - h
      ctx.fillStyle = `rgb(${8 + Math.random() * 6}, ${10 + Math.random() * 8}, ${22 + Math.random() * 12})`
      ctx.fillRect(x, y, w, h)
      x += w
    }
    // Front layer — taller skyscrapers with bright windows
    x = 0
    while (x < 2048) {
      const w = 60 + Math.random() * 140
      const h = 280 + Math.random() * 460
      const y = 1024 - h
      ctx.fillStyle = `rgb(${14 + Math.random() * 8}, ${16 + Math.random() * 10}, ${28 + Math.random() * 14})`
      ctx.fillRect(x, y, w, h)
      // Antenna / spire on some taller ones
      if (h > 550 && Math.random() < 0.4) {
        ctx.fillStyle = '#1a1e32'
        ctx.fillRect(x + w / 2 - 1, y - 40 - Math.random() * 60, 2, 50)
      }
      // Windows grid
      const cellW = 10
      const cellH = 14
      for (let wx = x + 6; wx < x + w - 6; wx += cellW) {
        for (let wy = y + 10; wy < 1018; wy += cellH) {
          if (Math.random() < 0.52) {
            const warm = Math.random() < 0.65
            const flicker = 0.55 + Math.random() * 0.45
            ctx.fillStyle = warm
              ? `rgba(250, 215, 140, ${flicker})`
              : `rgba(170, 200, 255, ${flicker})`
            ctx.fillRect(wx, wy, 4, 6)
          }
        }
      }
      x += w
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }, [])
}

function StudioDecor() {
  const skylineTex = useNYCSkylineTexture()
  // Four windows divided by vertical mullions.
  const windowCount = 4
  const wallWidth = 12
  const wallHeight = 5.4
  const mullionW = 0.08
  const windowW = (wallWidth - mullionW * (windowCount + 1)) / windowCount

  return (
    <group>
      {/* Full back wall with the NYC skyline showing through */}
      <mesh position={[0, 0.4, -4.6]}>
        <planeGeometry args={[wallWidth, wallHeight]} />
        <meshBasicMaterial map={skylineTex} toneMapped={false} />
      </mesh>

      {/* Vertical mullions (window frames) over the wall */}
      {Array.from({ length: windowCount + 1 }).map((_, i) => {
        const x = -wallWidth / 2 + i * (windowW + mullionW) + mullionW / 2
        return (
          <mesh key={`mul-${i}`} position={[x, 0.4, -4.55]}>
            <planeGeometry args={[mullionW, wallHeight]} />
            <meshStandardMaterial color={'#0a0b12'} roughness={0.6} metalness={0.35} />
          </mesh>
        )
      })}

      {/* Horizontal top and bottom frames */}
      <mesh position={[0, 0.4 + wallHeight / 2 - 0.05, -4.55]}>
        <planeGeometry args={[wallWidth, 0.14]} />
        <meshStandardMaterial color={'#0a0b12'} roughness={0.6} metalness={0.35} />
      </mesh>
      <mesh position={[0, 0.4 - wallHeight / 2 + 0.05, -4.55]}>
        <planeGeometry args={[wallWidth, 0.14]} />
        <meshStandardMaterial color={'#0a0b12'} roughness={0.6} metalness={0.35} />
      </mesh>

      {/* Warm interior ceiling strip — static, no pulsing */}
      <mesh position={[0, 2.9, -4.5]}>
        <planeGeometry args={[10.5, 0.08]} />
        <meshBasicMaterial color={'#ffb27a'} toneMapped={false} />
      </mesh>

      {/* Cool floor LED strip */}
      <mesh position={[0, -1.9, -4.5]}>
        <planeGeometry args={[10.5, 0.04]} />
        <meshBasicMaterial color={'#60a5fa'} toneMapped={false} />
      </mesh>

      {/* Side wall slats — left */}
      {[-3.2, -3.0, -2.8].map((x, i) => (
        <mesh key={`sl-${i}`} position={[x, 0, -2 - i * 0.3]} rotation={[0, Math.PI / 6, 0]}>
          <planeGeometry args={[0.15, 4]} />
          <meshStandardMaterial
            color={'#1a1a2e'}
            emissive={'#7c3aed'}
            emissiveIntensity={0.35}
            roughness={0.5}
          />
        </mesh>
      ))}
      {/* Side wall slats — right */}
      {[3.2, 3.0, 2.8].map((x, i) => (
        <mesh key={`sr-${i}`} position={[x, 0, -2 - i * 0.3]} rotation={[0, -Math.PI / 6, 0]}>
          <planeGeometry args={[0.15, 4]} />
          <meshStandardMaterial
            color={'#1a1a2e'}
            emissive={'#2563eb'}
            emissiveIntensity={0.35}
            roughness={0.5}
          />
        </mesh>
      ))}

      {/* Reflective floor */}
      <mesh position={[0, -1.65, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial
          color={'#05060a'}
          metalness={0.92}
          roughness={0.18}
        />
      </mesh>

      {/* Subtle ground glow under avatar */}
      <mesh position={[0, -1.64, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.8, 64]} />
        <meshBasicMaterial color={'#7c3aed'} transparent opacity={0.18} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      {/* Key spotlights on avatar */}
      <spotLight
        position={[4, 5, 4]}
        angle={0.35}
        penumbra={0.6}
        intensity={1.8}
        color={'#fef3c7'}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />
      <spotLight
        position={[-4, 4, 3]}
        angle={0.4}
        penumbra={0.7}
        intensity={1.2}
        color={'#a78bfa'}
      />
      <spotLight
        position={[0, 4, -3]}
        angle={0.6}
        penumbra={0.8}
        intensity={0.9}
        color={'#60a5fa'}
        target-position={[0, 0, 0]}
      />
      {/* Rim light from behind */}
      <pointLight position={[0, 1.5, -3]} intensity={0.6} color={'#c084fc'} />

      {/* Ambient fill */}
      <ambientLight intensity={0.22} color={'#3b2a6b'} />
    </group>
  )
}

// ───── Camera slight parallax on pointer ─────
function CameraRig() {
  const { camera } = useThree()
  const target = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const onMove = (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      target.current = { x: nx * 0.15, y: -ny * 0.08 }
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])
  useFrame(() => {
    camera.position.x += (target.current.x - camera.position.x) * 0.03
    camera.position.y += (0.2 + target.current.y - camera.position.y) * 0.03
    camera.lookAt(0, 0.4, 0)
  })
  return null
}

// ───── Main page ─────
export default function KelionStage() {
  const audioRef = useRef(null)
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Stage 3 — auth + memory state
  const [authState, setAuthState] = useState({ signedIn: false, user: null })
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryItems, setMemoryItems] = useState([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [rememberPromptOpen, setRememberPromptOpen] = useState(false)
  const [rememberBusy, setRememberBusy] = useState(false)
  const [rememberError, setRememberError] = useState(null)
  const dismissedPromptRef = useRef(false)

  // Stage 5 — proactive pings state
  const [pushState, setPushState] = useState({ supported: false, enabled: false, permission: 'default' })
  const [pushBusy, setPushBusy] = useState(false)
  const [pushError, setPushError] = useState(null)

  // Admin-only — AI credits dashboard state (Stage 7 / monetization gate).
  // `creditsOpen` controls the overlay; `creditsCards` is the normalized
  // array returned by GET /api/admin/credits; `creditsLoading` shows a
  // skeleton while the server probes providers.
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [creditsCards, setCreditsCards] = useState([])
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState(null)
  const isAdmin = Boolean(authState.user && authState.user.isAdmin)
  const openCredits = useCallback(async () => {
    setCreditsOpen(true)
    setCreditsLoading(true)
    setCreditsError(null)
    try {
      const r = await fetch('/api/admin/credits', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setCreditsCards(Array.isArray(j.cards) ? j.cards : [])
    } catch (err) {
      setCreditsError(err.message || 'Could not load AI credits')
    } finally {
      setCreditsLoading(false)
    }
  }, [])

  // Stage 7 — monetization. User-facing top-up modal (Stripe Checkout)
  // and live balance. `buyOpen` shows the package picker; `buyBusy` is
  // true while we create the Stripe Checkout session; `balance` is
  // null until loaded so we can hide the chip until we know it.
  const [buyOpen, setBuyOpen] = useState(false)
  const [buyBusy, setBuyBusy] = useState(false)
  const [buyError, setBuyError] = useState(null)
  const [packages, setPackages] = useState([])
  const [balance, setBalance] = useState(null)
  const refreshBalance = useCallback(async () => {
    if (!authState.signedIn) { setBalance(null); return }
    try {
      const r = await fetch('/api/credits/balance', { credentials: 'include' })
      if (!r.ok) return
      const j = await r.json()
      if (typeof j.balance_minutes === 'number') setBalance(j.balance_minutes)
    } catch (_) { /* ignore */ }
  }, [authState.signedIn])
  useEffect(() => { refreshBalance() }, [refreshBalance])
  const openBuy = useCallback(async () => {
    setBuyOpen(true)
    setBuyError(null)
    if (packages.length === 0) {
      try {
        const r = await fetch('/api/credits/packages')
        const j = await r.json()
        setPackages(Array.isArray(j.packages) ? j.packages : [])
      } catch (err) {
        setBuyError('Could not load packages')
      }
    }
  }, [packages.length])
  const handleBuy = useCallback(async (pkgId) => {
    setBuyBusy(true)
    setBuyError(null)
    try {
      const r = await fetch('/api/credits/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkgId }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.url) {
        throw new Error(j.error || j.hint || `HTTP ${r.status}`)
      }
      window.location.href = j.url
    } catch (err) {
      setBuyError(err.message || 'Checkout failed')
      setBuyBusy(false)
    }
  }, [])

  // If we returned from Stripe Checkout with ?credits=ok, refresh the
  // balance once and scrub the query string so reloads don't re-trigger.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('credits') === 'ok') {
      refreshBalance()
      sp.delete('credits'); sp.delete('session_id')
      const q = sp.toString()
      const clean = window.location.pathname + (q ? `?${q}` : '') + window.location.hash
      window.history.replaceState(null, '', clean)
    }
  }, [refreshBalance])

  // PWA install prompt — Chrome / Edge / Android fire `beforeinstallprompt`
  // which we stash; iOS Safari has no such event, so we show instructions
  // inline in the modal instead.
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [installed, setInstalled] = useState(() =>
    typeof window !== 'undefined' && (
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    )
  )
  useEffect(() => {
    const onBip = (e) => { e.preventDefault(); setInstallPromptEvent(e) }
    const onInstalled = () => { setInstalled(true); setInstallPromptEvent(null) }
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  const handleInstall = useCallback(async () => {
    if (!installPromptEvent) return
    try {
      await installPromptEvent.prompt()
      setInstallPromptEvent(null)
    } catch (_) { /* user dismissed */ }
  }, [installPromptEvent])

  // Admin-only — live business metrics (revenue + minutes sold/consumed).
  const [businessOpen, setBusinessOpen] = useState(false)
  const [businessData, setBusinessData] = useState(null)
  const [businessLoading, setBusinessLoading] = useState(false)
  const [businessError, setBusinessError] = useState(null)
  const openBusiness = useCallback(async () => {
    setBusinessOpen(true)
    setBusinessLoading(true)
    setBusinessError(null)
    try {
      const r = await fetch('/api/admin/business?days=30', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setBusinessData(await r.json())
    } catch (err) {
      setBusinessError(err.message || 'Could not load business metrics')
    } finally {
      setBusinessLoading(false)
    }
  }, [])

  // Stage 6 — emotion mirroring + voice style
  const emotion = useEmotion()
  const [voiceStyle, setVoiceStyleState] = useState(() => readVoiceStyleCookie())
  const handleVoiceStyleChange = useCallback(async (style) => {
    const resolved = await setVoiceStyle(style)
    if (resolved) setVoiceStyleState(resolved)
  }, [])

  // Text chat — user-typed prompts in addition to voice. Talks to
  // /api/chat which streams assistant deltas via SSE. We keep the last
  // ~6 turns in memory so the model has short-term context; voice and
  // text share the same session but don't (yet) share a message log.
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState([]) // [{ role, content }]
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState(null)
  const sendTextMessage = useCallback(async () => {
    const text = chatInput.trim()
    if (!text || chatBusy) return
    setChatError(null)
    const next = [...chatMessages, { role: 'user', content: text }].slice(-12)
    setChatMessages(next)
    setChatInput('')
    setChatBusy(true)
    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next,
          datetime: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
      if (r.status === 401) {
        throw new Error('Sign in to chat (use the ⋯ menu).')
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      // Parse SSE stream: lines of form "data: {json}\n\n"
      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistant = ''
      setChatMessages((m) => [...m, { role: 'assistant', content: '' }])
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() || ''
        for (const chunk of chunks) {
          const line = chunk.replace(/^data:\s*/, '').trim()
          if (!line || line === '[DONE]') continue
          try {
            const obj = JSON.parse(line)
            if (obj.content) {
              assistant += obj.content
              setChatMessages((m) => {
                const copy = m.slice()
                copy[copy.length - 1] = { role: 'assistant', content: assistant }
                return copy
              })
            } else if (obj.error) {
              throw new Error(obj.error)
            }
          } catch (err) {
            if (err.message && err.message !== 'Unexpected end of JSON input') throw err
          }
        }
      }
    } catch (err) {
      setChatError(err.message || 'Chat failed')
      // Drop the empty assistant placeholder if we never got content.
      setChatMessages((m) => m[m.length - 1]?.role === 'assistant' && m[m.length - 1].content === ''
        ? m.slice(0, -1) : m)
    } finally {
      setChatBusy(false)
    }
  }, [chatInput, chatBusy, chatMessages])

  const mouthOpen = useLipSync(audioRef)

  const {
    status,
    error,
    start,
    stop,
    turns,
    userLevel,
    // Stage 2 — Kelion Sees
    cameraStream,
    screenStream,
    visionError,
    startCamera,
    stopCamera,
    startScreen,
    stopScreen,
  } = useGeminiLive({ audioRef })

  const cameraVideoRef = useRef(null)
  useEffect(() => {
    if (cameraVideoRef.current && cameraStream) {
      cameraVideoRef.current.srcObject = cameraStream
      cameraVideoRef.current.play().catch(() => {})
    }
  }, [cameraStream])

  useEffect(() => { setVoiceLevel(userLevel || 0) }, [userLevel])

  // Stage 3 — probe whether the user is already signed in (passkey cookie).
  useEffect(() => {
    let cancelled = false
    fetchMe().then((r) => {
      if (cancelled) return
      setAuthState({ signedIn: !!r.signedIn, user: r.user || null })
    }).catch(() => { /* fail silently */ })
    return () => { cancelled = true }
  }, [])

  // Stage 3 — after enough user turns, if not signed in, gently open the
  // "Remember me?" prompt ONCE. Dismissed permanently per-session on close.
  const userTurnCount = useMemo(
    () => turns.filter((t) => t && t.role === 'user' && t.text && t.text.trim()).length,
    [turns]
  )
  useEffect(() => {
    if (authState.signedIn) return
    if (dismissedPromptRef.current) return
    if (rememberPromptOpen) return
    if (userTurnCount >= 4 && supportsPasskey()) {
      setRememberPromptOpen(true)
    }
  }, [userTurnCount, authState.signedIn, rememberPromptOpen])

  // Stage 3 — when the user ends a session, extract facts (if signed in).
  const turnsRef = useRef(turns)
  useEffect(() => { turnsRef.current = turns }, [turns])
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    const justEnded = (prev && prev !== 'idle' && prev !== 'error') && (status === 'idle' || status === 'error')
    if (!justEnded) return
    if (!authState.signedIn) return
    const snapshot = turnsRef.current.filter((t) => t && t.role && t.text && t.text.trim())
    if (snapshot.length < 2) return
    extractAndStore(snapshot).catch((err) => {
      console.warn('[memory extract]', err.message)
    })
  }, [status, authState.signedIn])

  const openMemory = useCallback(async () => {
    setMemoryOpen(true)
    setMemoryLoading(true)
    try {
      const r = await fetchMemory()
      setMemoryItems(Array.isArray(r.items) ? r.items : [])
    } catch (err) {
      console.warn('[memory]', err.message)
    } finally {
      setMemoryLoading(false)
    }
  }, [])

  const handleRemember = useCallback(async () => {
    setRememberBusy(true)
    setRememberError(null)
    try {
      const nameGuess = '' // Kelion will discover the user's name over time
      const res = await registerPasskey(nameGuess)
      setAuthState({ signedIn: true, user: res.user })
      setRememberPromptOpen(false)
      // Immediately extract facts from what was said so far, so the next
      // session opens with real memory.
      const snapshot = turnsRef.current.filter((t) => t && t.role && t.text && t.text.trim())
      if (snapshot.length >= 2) {
        extractAndStore(snapshot).catch(() => {})
      }
    } catch (err) {
      setRememberError(err.message || 'Could not save the passkey')
    } finally {
      setRememberBusy(false)
    }
  }, [])

  const handleSignInExisting = useCallback(async () => {
    setRememberBusy(true)
    setRememberError(null)
    try {
      const res = await authenticateWithPasskey()
      setAuthState({ signedIn: true, user: res.user })
      setRememberPromptOpen(false)
    } catch (err) {
      setRememberError(err.message || 'Could not sign in')
    } finally {
      setRememberBusy(false)
    }
  }, [])

  const handleSignOut = useCallback(async () => {
    await signOut().catch(() => {})
    setAuthState({ signedIn: false, user: null })
    setMemoryItems([])
    setMemoryOpen(false)
  }, [])

  const handleForgetAll = useCallback(async () => {
    if (!authState.signedIn) return
    if (!window.confirm('Forget everything Kelion knows about you? This cannot be undone.')) return
    try {
      await forgetAllMemory()
      setMemoryItems([])
    } catch (err) {
      console.warn('[memory]', err.message)
    }
  }, [authState.signedIn])

  // Stage 5 — probe current push subscription state on mount + when auth changes
  useEffect(() => {
    let cancelled = false
    if (!pushSupported()) {
      setPushState({ supported: false, enabled: false, permission: 'unsupported' })
      return
    }
    getPushStatus().then((s) => { if (!cancelled) setPushState(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [authState.signedIn])

  const handleEnablePush = useCallback(async () => {
    setPushError(null)
    setPushBusy(true)
    try {
      await enablePush()
      const s = await getPushStatus()
      setPushState(s)
    } catch (err) {
      setPushError(err.message || 'Could not enable pings.')
    } finally {
      setPushBusy(false)
    }
  }, [])

  const handleDisablePush = useCallback(async () => {
    setPushError(null)
    setPushBusy(true)
    try {
      await disablePush()
      const s = await getPushStatus()
      setPushState(s)
    } catch (err) {
      setPushError(err.message || 'Could not disable pings.')
    } finally {
      setPushBusy(false)
    }
  }, [])

  const handleTestPing = useCallback(async () => {
    setPushError(null)
    try { await sendTestPing('This is Kelion testing the ping channel.') }
    catch (err) { setPushError(err.message || 'Test ping failed.') }
  }, [])

  const statusLabel = {
    idle:       'Tap to talk',
    requesting: 'Requesting mic…',
    connecting: 'Connecting…',
    listening:  'Listening',
    thinking:   'Thinking',
    speaking:   'Speaking',
    error:      error || 'Error',
  }[status] || 'Kelion'

  const onStageClick = useCallback(() => {
    if (menuOpen) return setMenuOpen(false)
    if (status === 'idle' || status === 'error') start()
  }, [menuOpen, status, start])

  return (
    <div
      onClick={onStageClick}
      style={{
        position: 'fixed', inset: 0,
        background: 'radial-gradient(ellipse at center top, #0d0b1e 0%, #05060a 70%)',
        color: '#e9d5ff',
        overflow: 'hidden',
        cursor: status === 'idle' || status === 'error' ? 'pointer' : 'default',
        userSelect: 'none',
      }}
    >
      <Canvas
        shadows
        camera={{ position: [0, 0.2, 4.2], fov: 36 }}
        dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
      >
        <color attach="background" args={['#05060a']} />
        <fog attach="fog" args={['#080614', 5.5, 12]} />
        <CameraRig />
        <Suspense fallback={null}>
          <Environment preset="city" environmentIntensity={0.35} />
          <StudioDecor />
          <Halo status={status} voiceLevel={voiceLevel} emotion={emotion} />
          <AvatarModel mouthOpen={mouthOpen} status={status} emotion={emotion} />
          <ContactShadows position={[0, -1.65, 0]} opacity={0.55} scale={6} blur={2.6} far={2.5} />
        </Suspense>
      </Canvas>

      <audio ref={audioRef} autoPlay playsInline />

      {/* Last assistant text reply (when chatting by typing) — fades
          above the input bar. Only the latest assistant message shows
          so we don't clutter the stage. */}
      {chatMessages.length > 0 && (() => {
        const last = chatMessages[chatMessages.length - 1]
        const userTurn = [...chatMessages].reverse().find((m) => m.role === 'user')
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 'calc(max(32px, env(safe-area-inset-bottom)) + 110px)',
              left: '50%', transform: 'translateX(-50%)',
              width: 'min(680px, 92vw)',
              maxHeight: '42vh', overflowY: 'auto',
              display: 'flex', flexDirection: 'column', gap: 8,
              padding: 14,
              borderRadius: 16,
              background: 'rgba(10, 8, 20, 0.72)',
              backdropFilter: 'blur(14px)',
              border: '1px solid rgba(167, 139, 250, 0.22)',
              color: '#ede9fe',
              fontSize: 14, lineHeight: 1.45,
              fontFamily: 'system-ui, -apple-system, sans-serif',
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          >
            {userTurn && (
              <div style={{
                alignSelf: 'flex-end', maxWidth: '88%',
                padding: '8px 12px', borderRadius: 12,
                background: 'rgba(124, 58, 237, 0.25)',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                fontSize: 13,
              }}>{userTurn.content}</div>
            )}
            {last.role === 'assistant' && (
              <div style={{
                alignSelf: 'flex-start', maxWidth: '92%',
                padding: '8px 12px', borderRadius: 12,
                background: 'rgba(167, 139, 250, 0.08)',
                border: '1px solid rgba(167, 139, 250, 0.18)',
                whiteSpace: 'pre-wrap',
              }}>
                {last.content || (chatBusy ? 'Kelion is thinking…' : '')}
              </div>
            )}
            {chatError && (
              <div style={{
                fontSize: 12, color: '#fecaca',
                background: 'rgba(80, 14, 14, 0.6)',
                padding: '6px 10px', borderRadius: 10,
              }}>{chatError}</div>
            )}
          </div>
        )
      })()}

      {/* Text chat composer — bottom center, above the status pill.
          Stops click propagation so typing doesn't toggle the voice
          session. Submit with Enter or the send button. */}
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); sendTextMessage() }}
        style={{
          position: 'absolute',
          bottom: 'calc(max(32px, env(safe-area-inset-bottom)) + 54px)',
          left: '50%', transform: 'translateX(-50%)',
          width: 'min(680px, 92vw)',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 10px 8px 16px',
          borderRadius: 999,
          background: 'rgba(10, 8, 20, 0.72)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
          zIndex: 5,
        }}
      >
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          placeholder="Type to Kelion…"
          disabled={chatBusy}
          autoComplete="off"
          style={{
            flex: 1,
            background: 'transparent', border: 'none', outline: 'none',
            color: '#ede9fe',
            fontSize: 15, fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '8px 2px',
          }}
        />
        <button
          type="submit"
          disabled={chatBusy || chatInput.trim().length === 0}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: chatInput.trim().length === 0
              ? 'rgba(167, 139, 250, 0.18)'
              : 'linear-gradient(135deg, #7c3aed, #a78bfa)',
            border: 'none', color: '#fff',
            cursor: chatBusy || chatInput.trim().length === 0 ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: chatBusy ? 0.6 : 1,
            fontSize: 16,
          }}
          aria-label="Send message"
        >↑</button>
      </form>

      {/* Status pill — bottom center */}
      <div style={{
        position: 'absolute', bottom: 'max(32px, env(safe-area-inset-bottom))',
        left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '10px 22px',
        borderRadius: 999,
        background: 'rgba(10, 8, 20, 0.65)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${STATUS_COLORS[status]}33`,
        color: '#ede9fe',
        fontSize: 14, fontFamily: 'system-ui, -apple-system, sans-serif',
        letterSpacing: '0.02em',
        pointerEvents: 'none',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: STATUS_COLORS[status],
          boxShadow: `0 0 12px ${STATUS_COLORS[status]}`,
          // No pulsing animation — Adrian found the blinking tiring.
        }} />
        {statusLabel}
      </div>

      {/* Menu trigger ⋯ top-right */}
      <button
        onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
        style={{
          position: 'absolute', top: 18, right: 18,
          width: 42, height: 42, borderRadius: 999,
          background: 'rgba(10, 8, 20, 0.5)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
          color: '#ede9fe', fontSize: 20, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        aria-label="Menu"
      >⋯</button>

      {menuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 70, right: 18, zIndex: 20,
            minWidth: 220,
            background: 'rgba(14, 10, 28, 0.92)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(167, 139, 250, 0.2)',
            borderRadius: 14, padding: 6,
            color: '#ede9fe', fontSize: 14,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
        >
          <MenuItem
            onClick={() => { cameraStream ? stopCamera() : startCamera(); setMenuOpen(false) }}
            disabled={status === 'idle' || status === 'error'}
          >
            {cameraStream ? 'Turn camera off' : 'Turn camera on'}
          </MenuItem>
          <MenuItem
            onClick={() => { screenStream ? stopScreen() : startScreen(); setMenuOpen(false) }}
            disabled={status === 'idle' || status === 'error'}
          >
            {screenStream ? 'Stop sharing screen' : 'Share screen'}
          </MenuItem>
          <MenuItem onClick={() => { setTranscriptOpen((v) => !v); setMenuOpen(false) }}>
            {transcriptOpen ? 'Hide transcript' : 'Show transcript'}
          </MenuItem>
          {/* Stage 6 — voice style submenu */}
          <div
            style={{
              padding: '6px 10px 4px',
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: 'rgba(237,233,254,0.45)',
              marginTop: 4,
            }}
          >
            Voice style
          </div>
          {VOICE_STYLE_OPTIONS.map((opt) => (
            <MenuItem
              key={opt.key}
              onClick={() => { handleVoiceStyleChange(opt.key); setMenuOpen(false) }}
            >
              <span style={{ opacity: voiceStyle === opt.key ? 1 : 0.75 }}>
                {voiceStyle === opt.key ? '● ' : '○ '}
                {opt.label}
              </span>
            </MenuItem>
          ))}
          <div style={{ height: 6 }} />
          {/* Stage 3 — memory + passkey */}
          {authState.signedIn ? (
            <>
              <MenuItem onClick={() => { openMemory(); setMenuOpen(false) }}>
                What do you know about me?
              </MenuItem>
              {/* Stage 5 — proactive pings */}
              {pushState.supported && (
                pushState.enabled ? (
                  <>
                    <MenuItem
                      onClick={() => { handleTestPing(); setMenuOpen(false) }}
                      disabled={pushBusy}
                    >
                      Send a test ping
                    </MenuItem>
                    <MenuItem
                      onClick={() => { handleDisablePush(); setMenuOpen(false) }}
                      disabled={pushBusy}
                    >
                      {pushBusy ? 'Disabling pings…' : 'Disable pings'}
                    </MenuItem>
                  </>
                ) : (
                  <MenuItem
                    onClick={() => { handleEnablePush(); setMenuOpen(false) }}
                    disabled={pushBusy}
                  >
                    {pushBusy ? 'Enabling pings…' : 'Enable pings'}
                  </MenuItem>
                )
              )}
              {/* User-facing top-up — Stripe Checkout for credit
                  packages. Visible to all signed-in users. */}
              <MenuItem onClick={() => { openBuy(); setMenuOpen(false) }}>
                Buy credits{balance != null ? ` (${balance} min left)` : ''}
              </MenuItem>
              {/* PWA install — only shows when the browser actually
                  fired beforeinstallprompt (Chrome/Edge/Android). iOS
                  users get instructions inside the Buy-credits modal. */}
              {!installed && installPromptEvent && (
                <MenuItem onClick={() => { handleInstall(); setMenuOpen(false) }}>
                  Install Kelion on this device
                </MenuItem>
              )}
              {/* Admin-only — AI credits dashboard (one button per AI we
                  spend on + Stripe revenue card + top-up links + email
                  alerts to contact@kelionai.app). */}
              {isAdmin && (
                <>
                  <MenuItem onClick={() => { openCredits(); setMenuOpen(false) }}>
                    AI credits (admin)
                  </MenuItem>
                  <MenuItem onClick={() => { openBusiness(); setMenuOpen(false) }}>
                    Business metrics (admin)
                  </MenuItem>
                </>
              )}
              <MenuItem onClick={() => { handleSignOut(); setMenuOpen(false) }}>
                Sign out
              </MenuItem>
            </>
          ) : (
            supportsPasskey() && (
              <MenuItem onClick={() => { setRememberPromptOpen(true); setMenuOpen(false) }}>
                Remember me
              </MenuItem>
            )
          )}
          <MenuItem onClick={() => { stop(); setMenuOpen(false) }} disabled={status === 'idle'}>
            End chat
          </MenuItem>
        </div>
      )}

      {/* Camera preview — visible confirmation Kelion sees you (M9) */}
      {cameraStream && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 18, left: 18,
            width: 180, height: 135,
            borderRadius: 14,
            overflow: 'hidden',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
            background: '#000',
            zIndex: 15,
          }}
        >
          <video
            ref={cameraVideoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: '100%', height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)', // mirrored like a selfie cam
            }}
          />
          <div style={{
            position: 'absolute', bottom: 6, left: 8,
            fontSize: 10, letterSpacing: '0.15em',
            color: '#ede9fe', opacity: 0.8,
            textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          }}>
            <span style={{
              display: 'inline-block', width: 6, height: 6,
              borderRadius: '50%', background: '#ef4444',
              marginRight: 6, boxShadow: '0 0 6px #ef4444',
            }} />
            LIVE
          </div>
        </div>
      )}

      {/* Screen share indicator — Kelion is watching your screen (M10) */}
      {screenStream && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 18, left: cameraStream ? 210 : 18,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(10, 8, 20, 0.65)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(96, 165, 250, 0.4)',
            color: '#bfdbfe', fontSize: 12, letterSpacing: '0.05em',
            display: 'flex', alignItems: 'center', gap: 8,
            zIndex: 15,
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: '#60a5fa',
            boxShadow: '0 0 8px #60a5fa',
          }} />
          Sharing screen
        </div>
      )}

      {visionError && !cameraStream && !screenStream && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 18, left: 18,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(80, 14, 14, 0.7)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(239, 68, 68, 0.45)',
            color: '#fecaca', fontSize: 12,
            zIndex: 15,
          }}
        >
          {visionError}
        </div>
      )}

      {/* Transcript drawer */}
      {transcriptOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(420px, 92vw)',
            background: 'rgba(10, 8, 20, 0.78)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 20px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em', marginBottom: 12 }}>TRANSCRIPT</div>
          {turns.length === 0 && (
            <div style={{ opacity: 0.5, fontSize: 14 }}>Conversation will appear here.</div>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{
              marginBottom: 14, padding: '10px 12px',
              borderRadius: 10,
              background: t.role === 'user' ? 'rgba(167, 139, 250, 0.08)' : 'rgba(96, 165, 250, 0.08)',
              borderLeft: `2px solid ${t.role === 'user' ? '#a78bfa' : '#60a5fa'}`,
              fontSize: 14, lineHeight: 1.5,
            }}>
              <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 4, letterSpacing: '0.1em' }}>
                {t.role === 'user' ? 'YOU' : 'KELION'}
              </div>
              {t.text || <i style={{ opacity: 0.4 }}>…</i>}
            </div>
          ))}
        </div>
      )}

      {/* Stage 3 — "Remember me" soft prompt */}
      {rememberPromptOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 'calc(env(safe-area-inset-bottom, 0px) + 88px)',
            transform: 'translateX(-50%)',
            width: 'min(420px, 92vw)',
            padding: '18px 20px 16px',
            borderRadius: 18,
            background: 'rgba(14, 10, 28, 0.92)',
            backdropFilter: 'blur(22px)',
            border: '1px solid rgba(167, 139, 250, 0.32)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.55)',
            color: '#ede9fe',
            zIndex: 25,
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          <div style={{ fontSize: 14, lineHeight: 1.45, marginBottom: 14 }}>
            I'd like to remember you next time.<br />
            <span style={{ opacity: 0.65, fontSize: 13 }}>
              Save a passkey on this device — no password, no email.
            </span>
          </div>
          {rememberError && (
            <div style={{
              fontSize: 12, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.6)',
              padding: '8px 10px', borderRadius: 8, marginBottom: 10,
            }}>{rememberError}</div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={handleRemember}
              disabled={rememberBusy}
              style={{
                flex: '1 1 auto',
                padding: '10px 14px',
                borderRadius: 10,
                background: 'linear-gradient(135deg, #a78bfa, #60a5fa)',
                color: '#0a0818',
                border: 'none',
                cursor: rememberBusy ? 'wait' : 'pointer',
                fontSize: 14, fontWeight: 600,
              }}
            >
              {rememberBusy ? 'Saving…' : 'Remember me'}
            </button>
            <button
              onClick={handleSignInExisting}
              disabled={rememberBusy}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                background: 'rgba(167, 139, 250, 0.12)',
                color: '#ede9fe',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                cursor: rememberBusy ? 'wait' : 'pointer',
                fontSize: 14,
              }}
            >
              I have a passkey
            </button>
            <button
              onClick={() => {
                dismissedPromptRef.current = true
                setRememberPromptOpen(false)
                setRememberError(null)
              }}
              disabled={rememberBusy}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                background: 'transparent',
                color: '#ede9fe',
                border: '1px solid rgba(167, 139, 250, 0.18)',
                cursor: 'pointer',
                fontSize: 14, opacity: 0.75,
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Stage 3 — memory drawer */}
      {memoryOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(440px, 92vw)',
            background: 'rgba(10, 8, 20, 0.82)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 20px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 24,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              WHAT I KNOW ABOUT YOU
            </div>
            <button
              onClick={() => setMemoryOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >✕</button>
          </div>

          {memoryLoading && (
            <div style={{ opacity: 0.5, fontSize: 14 }}>Loading…</div>
          )}
          {!memoryLoading && memoryItems.length === 0 && (
            <div style={{ opacity: 0.55, fontSize: 14, lineHeight: 1.5 }}>
              Nothing yet. Keep talking — I'll pick up on things worth remembering
              and save them here. You can review and delete anything.
            </div>
          )}
          {memoryItems.map((m) => (
            <div key={m.id} style={{
              marginBottom: 10, padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(167, 139, 250, 0.08)',
              borderLeft: '2px solid #a78bfa',
              fontSize: 14, lineHeight: 1.45,
              display: 'flex', flexDirection: 'column', gap: 4,
            }}>
              <div style={{
                fontSize: 10, opacity: 0.55, letterSpacing: '0.12em',
              }}>{(m.kind || 'fact').toUpperCase()}</div>
              <div>{m.fact}</div>
            </div>
          ))}

          {memoryItems.length > 0 && (
            <button
              onClick={handleForgetAll}
              style={{
                marginTop: 18,
                padding: '10px 14px',
                borderRadius: 10,
                background: 'transparent',
                color: '#fecaca',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                cursor: 'pointer', fontSize: 13,
              }}
            >Forget everything</button>
          )}
        </div>
      )}

      {/* User-facing Buy-credits modal — centered overlay with the
          three standard packages (starter / standard / pro). Clicking
          a package creates a Stripe Checkout session and redirects to
          Stripe's hosted page (3DS + VAT + chargebacks handled by
          Stripe). iOS users get PWA install instructions at the
          bottom since Safari has no beforeinstallprompt event. */}
      {buyOpen && (
        <div
          onClick={(e) => { e.stopPropagation(); setBuyOpen(false) }}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(3, 4, 10, 0.78)',
            backdropFilter: 'blur(14px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 30, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 96vw)',
              maxHeight: '90vh', overflowY: 'auto',
              background: 'rgba(14, 11, 26, 0.96)',
              borderRadius: 20,
              border: '1px solid rgba(167, 139, 250, 0.25)',
              padding: '22px 22px 26px 22px',
              color: '#ede9fe',
              fontFamily: 'system-ui, -apple-system, sans-serif',
              boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 14,
            }}>
              <div>
                <div style={{ fontSize: 11, opacity: 0.55, letterSpacing: '0.15em', marginBottom: 4 }}>
                  KELION CREDITS
                </div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>Buy credits</div>
              </div>
              <button
                onClick={() => setBuyOpen(false)}
                style={{
                  background: 'transparent', border: 'none', color: '#ede9fe',
                  fontSize: 22, cursor: 'pointer', opacity: 0.7,
                }}
                aria-label="Close"
              >✕</button>
            </div>

            {balance != null && (
              <div style={{
                fontSize: 13, opacity: 0.75, marginBottom: 14,
                padding: '8px 12px',
                background: 'rgba(167, 139, 250, 0.08)',
                borderRadius: 10,
              }}>
                Current balance: <strong>{balance} min</strong>
              </div>
            )}

            {buyError && (
              <div style={{
                fontSize: 13, color: '#fecaca',
                background: 'rgba(80, 14, 14, 0.6)',
                padding: '10px 12px', borderRadius: 10, marginBottom: 12,
              }}>{buyError}</div>
            )}

            <div style={{ display: 'grid', gap: 10 }}>
              {packages.map((pkg) => {
                const euros = (pkg.priceCents / 100).toFixed(2).replace(/\.00$/, '')
                const perMin = (pkg.priceCents / 100 / pkg.minutes).toFixed(2)
                return (
                  <button
                    key={pkg.id}
                    onClick={() => handleBuy(pkg.id)}
                    disabled={buyBusy}
                    style={{
                      display: 'block', textAlign: 'left', width: '100%',
                      padding: '16px 18px',
                      borderRadius: 14,
                      background: pkg.highlight
                        ? 'linear-gradient(135deg, rgba(167, 139, 250, 0.18), rgba(96, 165, 250, 0.12))'
                        : 'rgba(167, 139, 250, 0.06)',
                      border: pkg.highlight
                        ? '1px solid rgba(167, 139, 250, 0.55)'
                        : '1px solid rgba(167, 139, 250, 0.2)',
                      color: '#ede9fe',
                      cursor: buyBusy ? 'wait' : 'pointer',
                      opacity: buyBusy ? 0.6 : 1,
                      transition: 'transform 0.1s, background 0.15s',
                    }}
                  >
                    <div style={{
                      display: 'flex', alignItems: 'baseline',
                      justifyContent: 'space-between', marginBottom: 4,
                    }}>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{pkg.name}</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{euros} €</div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      {pkg.minutes} min · {perMin} €/min
                    </div>
                    {pkg.description && (
                      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
                        {pkg.description}
                      </div>
                    )}
                  </button>
                )
              })}
              {packages.length === 0 && !buyError && (
                <div style={{ opacity: 0.55, fontSize: 13 }}>Loading packages…</div>
              )}
            </div>

            <div style={{
              fontSize: 11, opacity: 0.5, marginTop: 16, lineHeight: 1.5,
            }}>
              You'll be redirected to Stripe's secure checkout. EU VAT is
              handled automatically. Credits never expire.
            </div>

            {!installed && !installPromptEvent && (
              <div style={{
                marginTop: 16, padding: '10px 12px',
                background: 'rgba(96, 165, 250, 0.08)',
                border: '1px solid rgba(96, 165, 250, 0.25)',
                borderRadius: 10, fontSize: 12, opacity: 0.85,
              }}>
                <strong>Add Kelion to your home screen:</strong>{' '}
                on iPhone, tap the Share button → <em>Add to Home Screen</em>.
                On Android Chrome, tap ⋮ → <em>Install app</em>.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Admin-only — live business metrics drawer. */}
      {businessOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(480px, 96vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 18,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              BUSINESS — LAST 30 DAYS
            </div>
            <button
              onClick={() => setBusinessOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >✕</button>
          </div>

          {businessLoading && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>Crunching numbers…</div>
          )}
          {businessError && !businessLoading && (
            <div style={{
              fontSize: 13, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.6)',
              padding: '10px 12px', borderRadius: 10,
            }}>{businessError}</div>
          )}

          {!businessLoading && businessData && (() => {
            const revenueEur = (businessData.ledger.revenueCents / 100).toFixed(2)
            // 50/50 split: half goes to AI vendors, half to us. This is a
            // gross estimate — actual AI spend is visible on the provider
            // cards. Stripe/tax fees will trim our half ~3%.
            const platformEstEur = (businessData.ledger.revenueCents / 200).toFixed(2)
            const minutesSold = businessData.ledger.minutesSold
            const minutesConsumed = businessData.ledger.minutesConsumed
            const topups = businessData.ledger.topups
            const rows = [
              { label: 'Credit top-ups', value: topups, hint: 'Stripe Checkout sessions completed' },
              { label: 'Gross revenue', value: `${revenueEur} €`, hint: 'Sum of paid Stripe sessions' },
              { label: 'Minutes sold', value: `${minutesSold} min`, hint: 'Credits granted to users' },
              { label: 'Minutes consumed', value: `${minutesConsumed} min`, hint: 'Live conversation time used' },
              { label: 'Platform share (est.)', value: `${platformEstEur} €`, hint: '50% of gross, before Stripe/VAT' },
            ]
            return (
              <>
                {rows.map((r) => (
                  <div
                    key={r.label}
                    style={{
                      padding: '12px 14px', marginBottom: 8,
                      background: 'rgba(167, 139, 250, 0.06)',
                      border: '1px solid rgba(167, 139, 250, 0.15)',
                      borderRadius: 12,
                    }}
                  >
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'baseline',
                    }}>
                      <div style={{ fontSize: 13, opacity: 0.75 }}>{r.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{r.value}</div>
                    </div>
                    {r.hint && (
                      <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{r.hint}</div>
                    )}
                  </div>
                ))}
                {businessData.stripe && (
                  <div style={{
                    padding: '12px 14px', marginTop: 10,
                    background: 'rgba(96, 165, 250, 0.06)',
                    border: '1px solid rgba(96, 165, 250, 0.25)',
                    borderRadius: 12,
                  }}>
                    <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.1em', marginBottom: 6 }}>
                      STRIPE BALANCE
                    </div>
                    <div style={{ fontSize: 15 }}>
                      {businessData.stripe.balanceDisplay || '—'}
                    </div>
                    {businessData.stripe.message && (
                      <div style={{ fontSize: 11, opacity: 0.55, marginTop: 4 }}>
                        {businessData.stripe.message}
                      </div>
                    )}
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* Admin-only — AI credits dashboard drawer. One card per provider
          showing real balance (where the provider exposes it) or a
          "configured" signal + a top-up link that deep-links into the
          provider's billing console. Clicking a card opens the top-up
          page in a new tab. */}
      {creditsOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(480px, 96vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 18,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              AI CREDITS — ADMIN
            </div>
            <button
              onClick={() => setCreditsOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >✕</button>
          </div>

          {creditsLoading && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>Fetching provider balances…</div>
          )}
          {creditsError && !creditsLoading && (
            <div style={{
              fontSize: 13, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.6)',
              padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            }}>{creditsError}</div>
          )}

          {!creditsLoading && creditsCards.map((c) => {
            const badge = {
              ok: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.55)', text: '#bbf7d0', label: 'OK' },
              low: { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.55)', text: '#fde68a', label: 'LOW' },
              error: { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.55)', text: '#fecaca', label: 'ERROR' },
              unknown: { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.4)', text: '#cbd5e1', label: '—' },
            }[c.status || 'unknown']
            return (
              <a
                key={c.id}
                href={c.topUpUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  marginBottom: 12,
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: 'rgba(167, 139, 250, 0.06)',
                  border: `1px solid ${badge.border}`,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'background 0.15s, transform 0.1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(167, 139, 250, 0.12)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(167, 139, 250, 0.06)' }}
              >
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 6,
                }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</div>
                  <span style={{
                    fontSize: 10, letterSpacing: '0.1em', fontWeight: 600,
                    padding: '3px 8px', borderRadius: 999,
                    background: badge.bg, color: badge.text, border: `1px solid ${badge.border}`,
                  }}>{badge.label}</span>
                </div>
                {c.subtitle && (
                  <div style={{ fontSize: 12, opacity: 0.55, marginBottom: 8 }}>{c.subtitle}</div>
                )}
                <div style={{ fontSize: 14, marginBottom: 4 }}>
                  {c.balanceDisplay || '—'}
                </div>
                {c.message && (
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                    {c.message}
                  </div>
                )}
                <div style={{
                  fontSize: 11, opacity: 0.55, marginTop: 8,
                  letterSpacing: '0.02em',
                }}>
                  Tap to open {c.kind === 'revenue' ? 'dashboard' : 'top-up'} →
                </div>
              </a>
            )
          })}

          {!creditsLoading && creditsCards.length === 0 && !creditsError && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>No providers configured.</div>
          )}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.55; transform: scale(0.85); }
        }
        html, body, #root { margin: 0; padding: 0; height: 100%; background: #05060a; overscroll-behavior: none; }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  )
}

function MenuItem({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'block', width: '100%',
        padding: '10px 14px', textAlign: 'left',
        background: 'transparent', border: 'none',
        color: disabled ? '#6b7280' : '#ede9fe',
        fontSize: 14, cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: 8,
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => !disabled && (e.currentTarget.style.background = 'rgba(167, 139, 250, 0.08)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >{children}</button>
  )
}

useGLTF.preload('/kelion-rpm_e27cb94d.glb')
