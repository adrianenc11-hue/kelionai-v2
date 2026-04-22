import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, Environment, ContactShadows, Float } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import * as THREE from 'three'
import { useLipSync } from '../lib/lipSync'
import { subscribeMonitor, handleShowOnMonitor, setMonitorGeoProvider } from '../lib/monitorStore'
import { setClientGeoProvider } from '../lib/clientGeoProvider'
import { STATUS_COLORS, STATUS_PULSE_HZ } from '../lib/kelionStatus'
import { useGeminiLive } from '../lib/geminiLive'
import { useOpenAIRealtime } from '../lib/openaiRealtime'
import { useWakeWord } from '../lib/useWakeWord'
import { useTrial } from '../lib/useTrial'
import { useClientGeo } from '../lib/useClientGeo'
import { TUNING, isTuningEnabled } from '../lib/tuning'
import TuningPanel from '../components/TuningPanel'
import SignInModal from '../components/SignInModal'
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
  configureConversationStore,
  appendMessage as appendConversationMessage,
  listConversations as listConversationsApi,
  loadConversation as loadConversationApi,
  deleteConversation as deleteConversationApi,
  startNewConversation,
  getActiveConversationId,
  setActiveConversationId,
} from '../lib/conversationStore'
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
// Arm rest pose. Values derived empirically from the shipped RPM GLB
// (`kelion-rpm_e27cb94d.glb`). The GLB bind pose stores LeftArm as a pure Z
// rotation of ~+1.20 rad (≈69°) and RightArm as −1.20 rad, which renders
// visually as a T-pose (arms horizontal). To reach a natural A-pose (arms
// hanging along the sides with a small outward splay) we rotate further in
// the same direction — z ≈ ±2.6 rad (≈ ±149°). Forearms get a slight X
// bend so elbows look relaxed. These are ABSOLUTE final rotations, not
// offsets, to avoid any Euler composition surprises.
const ARM_BONE_NAMES = {
  LeftArm:      ['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm'],
  RightArm:     ['RightArm', 'RightUpperArm', 'mixamorigRightArm'],
  LeftForeArm:  ['LeftForeArm', 'mixamorigLeftForeArm'],
  RightForeArm: ['RightForeArm', 'mixamorigRightForeArm'],
}
// GLB bind pose has upper-arms reaching FORWARD (not T-pose as first assumed).
// Bone length direction = local +Y. LeftArm world-dir at bind = (0.37, 0.07, 0.93),
// i.e. forward and slightly lateral. To hang the arms DOWN (world -Y) we solved
// for the local rotation that maps the bone's +Y axis to (0,-1,0), then backed
// off 10° for a natural A-pose (shoulders relaxed, small outward splay).
// Computed via three.js in /tmp/compute-pose.mjs from the actual GLB skeleton.
const ARM_REST_ABS = {
  LeftArm:      { x:  1.477, y:  0.973, z: -0.147 },
  RightArm:     { x:  1.477, y: -0.973, z:  0.147 },
  LeftForeArm:  { x:  0.200, y:  0,     z:  0 },
  RightForeArm: { x:  0.200, y:  0,     z:  0 },
}

// Curated gesture palette — each entry is a small additive delta (radians)
// layered on top of the captured bind-pose baseline while Kelion is speaking/presenting. Kept
// intentionally subtle so the hands never drift into weird poses, and the
// return-to-baseline invariant is preserved as long as envelope weight → 0.
const GESTURE_PALETTE = [
  // "open palm" — slight outward rotation of the left forearm
  { LeftArm: { x: -0.08, y: 0, z: 0.10 }, LeftForeArm: { x: -0.12, y: 0, z: 0.05 } },
  // "point toward monitor" (monitor is on camera-left / avatar's right-front)
  { RightArm: { x: -0.18, y: -0.22, z: -0.08 }, RightForeArm: { x: -0.20, y: 0, z: 0 } },
  // "both-hand emphasis" — small symmetric raise
  { LeftArm: { x: -0.10, y: 0, z: 0.06 }, RightArm: { x: -0.10, y: 0, z: -0.06 } },
  // "lean in / thoughtful" — forearms only
  { LeftForeArm: { x: -0.14, y: 0, z: 0 }, RightForeArm: { x: -0.14, y: 0, z: 0 } },
  // "counting off" — right hand raises with a tilt
  { RightArm: { x: -0.12, y: 0, z: -0.14 }, RightForeArm: { x: -0.22, y: 0.05, z: 0 } },
]

function AvatarModel({ mouthOpen = 0, status = 'idle', emotion = null, presenting = false }) {
  const { scene } = useGLTF('/kelion-rpm_e27cb94d.glb')
  const root = useRef()
  const bonesRef = useRef({})
  const morphsRef = useRef([])
  const blinkRef = useRef({ t: 0, nextBlinkAt: 2 + Math.random() * 4, duration: 0.18, phase: 0 })
  // Absolute rest-pose rotations for the four arm bones. Initialised from
  // ARM_REST_ABS; gestures are additive deltas on top (with envelope weight).
  const armBaselineRef = useRef({
    LeftArm:      { ...ARM_REST_ABS.LeftArm },
    RightArm:     { ...ARM_REST_ABS.RightArm },
    LeftForeArm:  { ...ARM_REST_ABS.LeftForeArm },
    RightForeArm: { ...ARM_REST_ABS.RightForeArm },
  })
  // Gesture scheduler — one gesture at a time, fade-in → hold → fade-out,
  // with a quiet window between gestures so speaking looks measured, not twitchy.
  const gestureRef = useRef({
    active: false,
    delta: null,
    startedAt: 0,
    duration: 0,
    nextAt: 2.5,     // first gesture can fire ~2.5s after mount (only if speaking)
    weight: 0,
  })
  // Current body yaw, lerped every frame toward the target (0 normally, -0.14
  // ≈ -8° when `presenting` so the avatar turns toward the monitor on the left).
  const bodyYawRef = useRef(0)

  // Bug A fix: use useLayoutEffect so arms are at baseline BEFORE the first
  // paint. Previously useEffect ran after the first frame was rendered, so
  // Adrian saw the model briefly in its GLB import pose (hands forward /
  // T-pose) before snapping down — "la pornire pleacă cu mâinile în față și
  // după le duce jos". With useLayoutEffect there is no intermediate frame.
  useLayoutEffect(() => {
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

    // Immediately snap each arm bone to the absolute rest rotation so the
    // very first rendered frame is in A-pose (no T-pose flash). useFrame
    // keeps the bones at this baseline every frame thereafter.
    const snapArm = (names, target) => {
      for (const n of names) {
        const bone = bones[n]
        if (bone) {
          bone.rotation.set(target.x, target.y, target.z, bone.rotation.order || 'XYZ')
          break
        }
      }
    }
    snapArm(ARM_BONE_NAMES.LeftArm,      ARM_REST_ABS.LeftArm)
    snapArm(ARM_BONE_NAMES.RightArm,     ARM_REST_ABS.RightArm)
    snapArm(ARM_BONE_NAMES.LeftForeArm,  ARM_REST_ABS.LeftForeArm)
    snapArm(ARM_BONE_NAMES.RightForeArm, ARM_REST_ABS.RightForeArm)
  }, [scene])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const b = bonesRef.current
    if (!b) return

    // Breathing — visible chest rise + upper-body sway. Adrian reported
    // the avatar looked frozen ("nu mai respiră"), so we bump the spine
    // amplitude and also drive spine1/chest for a compound rise. With
    // `Math.sin(t * 0.8)`, the breathing rate is 0.8 rad/s, so the cycle
    // period is 2π / 0.8 ≈ 7.85 s (roughly an 8-second breath cycle).
    const breath = Math.sin(t * 0.8) * 0.032
    const spine = b['Spine'] || b['mixamorigSpine'] || b['Spine1']
    const spine1 = b['Spine1'] || b['mixamorigSpine1']
    const chest = b['Chest'] || b['mixamorigChest']
    if (spine) spine.rotation.x = -0.05 + breath
    if (spine1) spine1.rotation.x = breath * 0.6
    if (chest) chest.rotation.x = breath * 0.4

    // Micro head movement — never still
    const head = b['Head'] || b['mixamorigHead']
    if (head) {
      head.rotation.y = Math.sin(t * 0.45) * 0.035
      head.rotation.x = Math.sin(t * 0.62) * 0.028 - 0.02
      head.rotation.z = Math.cos(t * 0.38) * 0.02
    }

    // Lip-sync — drive jaw + viseme morphs. `mouthOpen` is the smoothed
    // 0..1 envelope from useLipSync; scaling here is tuned so a mid-level
    // vowel (envelope ≈ 0.5) reads as a clearly visible open mouth rather
    // than the previous almost-imperceptible 0.04 rad jaw nudge. Both the
    // bone rotation and the viseme morph are driven because some RPM /
    // Mixamo exports only expose one or the other.
    const jaw = b['Jaw'] || b['mixamorigJaw']
    if (jaw) jaw.rotation.x = mouthOpen * TUNING.jawAmplitude

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
        m.morphTargetInfluences[mouthIdx] = Math.min(1, mouthOpen * TUNING.morphAmplitude)
      }
      const baseSmile = status === 'listening' ? 0.08 : 0.04
      const emotionSmile = emoMorphs ? (emoMorphs.mouthSmile || emoMorphs.mouthSmileLeft || 0) * emoScale : 0
      const smileIdx = d['mouthSmile'] ?? d['mouthSmileLeft']
      if (smileIdx !== undefined) {
        m.morphTargetInfluences[smileIdx] = Math.min(0.9, baseSmile + emotionSmile)
      }
      // Blink — try every common morph name variant exposed by RPM / ARKit
      // / mixamo exports. The "eyesClosed" fallback fires if only the
      // grouped target exists. This is the fix for F6 (avatar not blinking).
      const blinkLIdx = d['eyeBlinkLeft'] ?? d['eyeBlink_L'] ?? d['EyeBlinkLeft']
      const blinkRIdx = d['eyeBlinkRight'] ?? d['eyeBlink_R'] ?? d['EyeBlinkRight']
      const eyesClosedIdx = d['eyesClosed'] ?? d['EyesClosed'] ?? d['eyes_closed']
      const tiredBoost = emoMorphs && emoMorphs.eyeBlinkLeft ? emoMorphs.eyeBlinkLeft * emoScale : 0
      const eyeWeight = Math.max(blinkStrength, tiredBoost)
      if (blinkLIdx !== undefined) m.morphTargetInfluences[blinkLIdx] = eyeWeight
      if (blinkRIdx !== undefined) m.morphTargetInfluences[blinkRIdx] = eyeWeight
      if (eyesClosedIdx !== undefined) m.morphTargetInfluences[eyesClosedIdx] = eyeWeight

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

    // ───── Presenting body yaw ─────
    // When Kelion is presenting (or speaking and content is on the monitor),
    // rotate the whole body toward the monitor on the left. Smooth lerp so
    // transitions in/out of the presenting state are never snappy. Base
    // offset + presenting swing both read from the TUNING store so the
    // Leva debug panel can tweak them live. Defaults match the values
    // Adrian approved in PR #62: -3° idle (so Kelion faces the camera
    // directly, not the rig's natural right-of-center forward), -8°
    // additional when presenting.
    const yawTarget = (presenting ? TUNING.avatarPresentingYaw : 0) + TUNING.avatarBaseYaw
    const yawK = 1 - Math.exp(-delta * 2.5)  // frame-independent easing (~2.5 Hz)
    bodyYawRef.current += (yawTarget - bodyYawRef.current) * yawK
    if (root.current) root.current.rotation.y = bodyYawRef.current

    // ───── Additive hand gestures ─────
    // Invariant: when no gesture is active, final arm rotation === the captured
    // GLB bind-pose baseline exactly. Gestures add a delta scaled by an envelope
    // that always ends at 0, so arms always return to rest pose.
    const g = gestureRef.current
    const speaking = status === 'speaking' || presenting

    if (speaking && !g.active && t >= g.nextAt) {
      g.active = true
      g.startedAt = t
      g.duration = 1.4 + Math.random() * 1.0 // 1.4..2.4s total gesture life
      g.delta = GESTURE_PALETTE[Math.floor(Math.random() * GESTURE_PALETTE.length)]
    }

    // Compute envelope weight (0..1). Shape: quick fade-in, hold, gentle fade-out.
    let gestureWeight = 0
    if (g.active && g.delta) {
      const u = (t - g.startedAt) / g.duration
      if (u >= 1) {
        // Gesture finished — return to baseline and schedule the next one.
        g.active = false
        g.delta = null
        g.weight = 0
        g.nextAt = t + 1.6 + Math.random() * 2.4 // 1.6..4.0s quiet window
      } else if (u < 0.18) {
        gestureWeight = u / 0.18          // fade-in 0..1 over first 18%
      } else if (u > 0.62) {
        gestureWeight = (1 - u) / 0.38    // fade-out 1..0 over last 38%
      } else {
        gestureWeight = 1
      }
    }
    // Hard invariant: if we are NOT in a speaking/presenting state, drag
    // the envelope to 0 immediately so hands snap back to baseline even
    // mid-gesture (fast enough to be invisible; still frame-independent).
    if (!speaking) {
      g.active = false
      g.delta = null
      gestureWeight = 0
    }
    g.weight = gestureWeight

    const delta4 = g.delta // may be null if no gesture right now
    const applyArm = (names, base, d) => {
      for (const n of names) {
        const bone = b[n]
        if (!bone) continue
        bone.rotation.x = base.x + (d?.x || 0) * gestureWeight
        bone.rotation.y = base.y + (d?.y || 0) * gestureWeight
        bone.rotation.z = base.z + (d?.z || 0) * gestureWeight
        return
      }
    }
    const baseline = armBaselineRef.current
    applyArm(ARM_BONE_NAMES.LeftArm,      baseline.LeftArm,      delta4?.LeftArm)
    applyArm(ARM_BONE_NAMES.RightArm,     baseline.RightArm,     delta4?.RightArm)
    applyArm(ARM_BONE_NAMES.LeftForeArm,  baseline.LeftForeArm,  delta4?.LeftForeArm)
    applyArm(ARM_BONE_NAMES.RightForeArm, baseline.RightForeArm, delta4?.RightForeArm)
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

// MonitorOverlay — half-page 2D panel that renders whatever `monitorStore`
// currently holds. Anchored to the left 50vw of the viewport on desktop, or
// as a bottom sheet (100vw × 55vh) on narrow screens so the avatar — which
// sits on the right half of the stage — always stays visible and can keep
// talking / listening while the content is on screen. Hidden entirely when
// there is nothing to display.
function MonitorOverlay() {
  const [m, setM] = useState({ kind: null, src: null, title: null, embedType: 'iframe', updatedAt: 0 })
  const [isNarrow, setIsNarrow] = useState(() => (
    typeof window !== 'undefined' && window.innerWidth < 900
  ))

  useEffect(() => subscribeMonitor((s) => setM({ ...s })), [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onResize = () => setIsNarrow(window.innerWidth < 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!m.src) return null

  const isImage = m.embedType === 'image'
  const isExternal = m.embedType === 'external'
  const onClose = (e) => {
    e.stopPropagation()
    handleShowOnMonitor({ kind: 'clear' })
  }

  const desktopStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '50vw',
    height: '100vh',
  }
  const mobileStyle = {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100vw',
    height: '55vh',
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        ...(isNarrow ? mobileStyle : desktopStyle),
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(10, 8, 20, 0.96)',
        backdropFilter: 'blur(14px)',
        borderRight: isNarrow ? 'none' : '1px solid rgba(167, 139, 250, 0.28)',
        borderTop: isNarrow ? '1px solid rgba(167, 139, 250, 0.28)' : 'none',
        boxShadow: '0 0 40px rgba(0,0,0,0.55)',
        color: '#ede9fe',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: '1px solid rgba(167, 139, 250, 0.18)',
          background: 'rgba(17, 12, 38, 0.7)',
          flex: '0 0 auto',
        }}
      >
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: 0.3,
          color: '#c4b5fd',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {m.title || 'Monitor'}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close monitor"
          style={{
            appearance: 'none',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            background: 'rgba(124, 58, 237, 0.18)',
            color: '#ede9fe',
            width: 32,
            height: 32,
            borderRadius: 999,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ×
        </button>
      </div>
      <div style={{ flex: '1 1 auto', minHeight: 0, background: '#0d0b1d' }}>
        {isImage ? (
          <img
            src={m.src}
            alt={m.title || 'Monitor content'}
            referrerPolicy="no-referrer"
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', background: '#0d0b1d' }}
          />
        ) : isExternal ? (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 18,
              padding: 24,
              textAlign: 'center',
              color: '#ede9fe',
              background: 'radial-gradient(ellipse at center, #1a1230 0%, #0d0b1d 70%)',
            }}
          >
            <div style={{ fontSize: 40, lineHeight: 1 }}>🖥️</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#c4b5fd', maxWidth: 360 }}>
              {m.title || 'External app'} needs its own tab
            </div>
            <div style={{ fontSize: 13, opacity: 0.75, maxWidth: 360, lineHeight: 1.5 }}>
              This Linux-in-the-browser requires cross-origin isolation that the embedded
              frame cannot provide. Open it in a new tab — files persist in your browser.
            </div>
            <a
              href={m.src}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                appearance: 'none',
                textDecoration: 'none',
                border: '1px solid rgba(167, 139, 250, 0.55)',
                background: 'rgba(124, 58, 237, 0.28)',
                color: '#ede9fe',
                padding: '10px 20px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                letterSpacing: 0.2,
              }}
            >
              Open {m.title || 'app'} in new tab ↗
            </a>
          </div>
        ) : (
          <iframe
            src={m.src}
            title={m.title || 'Kelion monitor'}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
            allow="fullscreen; geolocation; autoplay; encrypted-media"
            style={{ width: '100%', height: '100%', border: 'none', background: '#0d0b1d', display: 'block' }}
          />
        )}
      </div>
    </div>
  )
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

      {/* Ceiling strip removed — Adrian flagged the warm #ffb27a line as
          a distracting "brown bar" at the top of the stage. */}

      {/* Cool floor LED strip */}
      <mesh position={[0, -1.9, -4.5]}>
        <planeGeometry args={[10.5, 0.04]} />
        <meshBasicMaterial color={'#60a5fa'} toneMapped={false} />
      </mesh>

      {/* The in-scene 3D presentation monitor was removed so that the stage
          stays clean when no content is loaded. All monitor payloads now
          render exclusively in the half-page <MonitorOverlay/> (left 50vw
          on desktop, bottom 55vh on mobile). An empty dark bezel sitting
          next to the avatar at all times was confusing — users expected it
          to be the promised half-page screen. */}

      {/* Reflective floor */}
      <mesh position={[0, -1.65, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial
          color={'#05060a'}
          metalness={0.92}
          roughness={0.18}
        />
      </mesh>

      {/* Subtle ground glow under avatar — follows avatar's new offset. */}
      <mesh position={[1.6, -1.64, 0]} rotation={[-Math.PI / 2, 0, 0]}>
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
        position={[1.6, 4, -3]}
        angle={0.6}
        penumbra={0.8}
        intensity={0.9}
        color={'#60a5fa'}
        target-position={[1.6, 0, 0]}
      />
      {/* Rim light from behind */}
      <pointLight position={[0, 1.5, -3]} intensity={0.6} color={'#c084fc'} />

      {/* Ambient fill */}
      <ambientLight intensity={0.22} color={'#3b2a6b'} />
    </group>
  )
}

// ───── Camera: responsive framing + slight parallax on pointer ─────
// Adrian: "trebuie sa aplici in funtie de tipul monitorului afisat ,
// telefon tableta ,zoom corect sa incadreze pagina corect pe verticala
// si daca il pui orizontal pe orizontala". The stage was authored for a
// wide desktop (aspect ≈ 1.6+) with a 36° fov; on a phone in portrait
// (aspect ≈ 0.45) the avatar at x=1.6 falls off the right edge and the
// monitor clips on the left. We now derive camera fov, z-distance, and
// horizontal offset from the live viewport aspect so the same scene
// stays framed — "pe verticala" in portrait, "pe orizontala" in
// landscape — without the user having to scroll or pinch-zoom.
//
// The parallax-on-pointermove stays on pointer devices only; on touch
// devices (phones / tablets) pointermove never fires so the effect is
// a no-op by design.
function computeFrame(aspect) {
  // Bands chosen empirically against the avatar at [1.6,0,0] and the
  // wall monitor at ~[-1.4,0.8,-1]. Higher fov + farther z + smaller
  // lookAt-x = more of both sides visible on narrow viewports.
  if (aspect >= 1.45) {
    // Desktop / landscape tablet — original tuning.
    return { fov: 36, z: 4.2, x: 0.3, lookAtX: 0.3, lookAtY: 0.4 }
  }
  if (aspect >= 1.05) {
    // Square-ish / small landscape laptop.
    return { fov: 42, z: 4.8, x: 0.5, lookAtX: 0.5, lookAtY: 0.5 }
  }
  if (aspect >= 0.75) {
    // Tablet portrait / large phone landscape.
    return { fov: 50, z: 5.6, x: 0.9, lookAtX: 0.9, lookAtY: 0.55 }
  }
  // Phone portrait (< 0.75) — center on the avatar, pull way back.
  return { fov: 58, z: 6.8, x: 1.3, lookAtX: 1.3, lookAtY: 0.6 }
}

function CameraRig() {
  const { camera, size } = useThree()
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
  // Recompute frame constants when the viewport resizes (orientation
  // change, window resize, dev-tools toggle). `size` is already reactive
  // in react-three-fiber; no manual listener needed.
  const frame = useMemo(() => computeFrame(size.width / Math.max(1, size.height)), [size.width, size.height])
  // Apply fov once per frame-config change. Must update the projection
  // matrix or the fov change has no visible effect.
  useEffect(() => {
    if (camera.isPerspectiveCamera) {
      camera.fov = frame.fov
      camera.updateProjectionMatrix()
    }
  }, [camera, frame.fov])
  useFrame(() => {
    camera.position.x += (frame.x + target.current.x - camera.position.x) * 0.03
    camera.position.y += (0.2 + target.current.y - camera.position.y) * 0.03
    camera.position.z += (frame.z - camera.position.z) * 0.03
    camera.lookAt(frame.lookAtX, frame.lookAtY, 0)
  })
  return null
}

// PR E5 — reusable pill-style action button for the user-management
// drawer. Accepts a disabled flag and optional text/border colours so
// destructive actions (ban) stand out from neutral ones (grant credits).
function actionBtnStyle(disabled, color, borderColor) {
  return {
    padding: '7px 12px', borderRadius: 8,
    background: 'rgba(167, 139, 250, 0.1)',
    border: '1px solid ' + (borderColor || 'rgba(167, 139, 250, 0.3)'),
    color: color || '#ede9fe',
    fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  }
}

// ───── Main page ─────
export default function KelionStage() {
  // React-router navigator. Used for in-app route changes (e.g. the
  // "Contact us" menu item) so we stay inside the SPA and preserve
  // auth state, mic state, etc. — full-page reloads via
  // `window.location.assign` discarded the React tree and the browser
  // back button then returned to a freshly-mounted, effectively
  // logged-out-looking page until `/api/auth/me` re-resolved. Adrian
  // 2026-04-20: "cind esti logat si folosesti butonul back, te
  // intorci in pagina anterioara, dar logat".
  const navigate = useNavigate()
  const audioRef = useRef(null)
  // Real client GPS (falls back to null → server uses IP-geo instead).
  // The hook fires once on mount; if the browser remembers a previous
  // grant there is no prompt, otherwise the browser shows its standard
  // one-time permission dialog. Coords are cached in localStorage so
  // refreshes don't re-ping the OS.
  // useClientGeo v2 exposes { coords, permission, lastError, requestNow }.
  // Alias to the names already used elsewhere in this file (clientGeo /
  // geoPermission / requestGeo).
  const { coords: clientGeo, permission: geoPermission, requestNow: requestGeo } = useClientGeo()
  // Register a geo provider so monitorStore can fall back to the user's
  // current coords when the model calls show_on_monitor({kind:'map'}) without
  // a query (e.g. "arată-mi harta" / "show me a map" without a place name).
  const clientGeoRef = useRef(null)
  const geoPermissionRef = useRef('unknown')
  const requestGeoRef = useRef(null)
  useEffect(() => { clientGeoRef.current = clientGeo }, [clientGeo])
  useEffect(() => { geoPermissionRef.current = geoPermission }, [geoPermission])
  useEffect(() => { requestGeoRef.current = requestGeo }, [requestGeo])
  useEffect(() => {
    setMonitorGeoProvider(() => clientGeoRef.current)
    return () => setMonitorGeoProvider(null)
  }, [])
  // Also publish the geo state to clientGeoProvider so the voice-side
  // `get_my_location` tool handler (in src/lib/kelionTools.js) can read
  // coords / permission / request-on-gesture without reaching into the
  // React tree. Tool handlers run outside React so they need a module-
  // level registry just like monitorGeoProvider above.
  useEffect(() => {
    setClientGeoProvider({
      getCoords:     () => clientGeoRef.current,
      getPermission: () => geoPermissionRef.current,
      requestNow:    () => {
        if (typeof requestGeoRef.current === 'function') requestGeoRef.current()
      },
    })
    return () => setClientGeoProvider(null)
  }, [])
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Stage 3 — auth + memory state
  const [authState, setAuthState] = useState({ signedIn: false, user: null })
  // JWT bearer-token fallback. register/login return a `token` in the body
  // and also set the httpOnly `kelion.token` cookie. In some browsers the
  // cookie may not make it back on the very next request (adblockers
  // stripping Set-Cookie, Safari ITP, strict privacy extensions, corporate
  // proxies rewriting headers). When that happens, the next authenticated
  // call (e.g. POST /api/chat) returns 401 and the UI flips to
  // "Session expired" seconds after the user signed in. Storing the token
  // in-memory and attaching it as `Authorization: Bearer …` on authenticated
  // fetches closes that gap — the server middleware already reads either
  // the header or the cookie, whichever is present.
  const authTokenRef = useRef(null)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [memoryItems, setMemoryItems] = useState([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [rememberPromptOpen, setRememberPromptOpen] = useState(false)
  const [rememberBusy, setRememberBusy] = useState(false)
  const [rememberError, setRememberError] = useState(null)
  // Full sign-in modal (email+password primary, Google, passkey) — opened
  // from the top-bar "Sign in" button. Separate from the soft passkey prompt
  // above which auto-opens mid-conversation after several turns.
  const [signInModalOpen, setSignInModalOpen] = useState(false)
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
  // PR E2 — auto-topup configuration snapshot returned alongside the
  // provider cards (threshold, amount, last-run history). Drives the
  // info strip at the top of the AI tab so the admin can see at a
  // glance whether auto-refill is armed and when it last fired.
  const [autoTopupStatus, setAutoTopupStatus] = useState(null)
  // Revenue-split snapshot (50/50 by default between AI provider spend
  // and owner net). Loaded from /api/admin/revenue-split in parallel
  // with the raw provider cards so the overlay can show both without
  // a waterfall. null = not loaded yet; populated object after success.
  const [revenueSplit, setRevenueSplit] = useState(null)
  const [revenueSplitLoading, setRevenueSplitLoading] = useState(false)
  const [revenueSplitError, setRevenueSplitError] = useState(null)
  // Live usage ledger — most recent credit transactions across all
  // users. Auto-refreshed every 5s while the credits overlay is open
  // so Adrian can watch consumption tick in real time. Added after
  // the 2026-04-20 charge-on-open bug drained a £10 pack in seconds;
  // visibility is now a standing requirement ("permanent la toti
  // userii").
  const [ledgerRows, setLedgerRows] = useState([])
  const [ledgerError, setLedgerError] = useState(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  // Grant / refund form — hits POST /api/admin/credits/grant.
  // Added so Adrian can refund compromised accounts (e.g. Kelion's
  // 33-credit loss from the 2026-04-20 charge-on-open incident)
  // without having to touch the browser console or a raw curl.
  const [grantEmail, setGrantEmail] = useState('')
  const [grantMinutes, setGrantMinutes] = useState('')
  const [grantNote, setGrantNote] = useState('')
  const [grantBusy, setGrantBusy] = useState(false)
  const [grantMessage, setGrantMessage] = useState(null) // { ok: bool, text: string }
  const isAdmin = Boolean(authState.user && authState.user.isAdmin)
  const refreshLedger = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/credits/ledger?limit=50', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setLedgerRows(Array.isArray(j.rows) ? j.rows : [])
      setLedgerError(null)
    } catch (err) {
      setLedgerError(err.message || 'Could not load ledger')
    }
  }, [])
  // Submit handler for the Grant Credits form. Validates the inputs
  // client-side (the server validates again), POSTs to the admin
  // endpoint, and refreshes the ledger on success so the new
  // admin_grant row appears immediately in Live Usage.
  const doGrant = useCallback(async () => {
    const email = grantEmail.trim().toLowerCase()
    const minutes = Number(grantMinutes)
    if (!email || !/.+@.+\..+/.test(email)) {
      setGrantMessage({ ok: false, text: 'Enter a valid email.' })
      return
    }
    if (!Number.isFinite(minutes) || minutes === 0) {
      setGrantMessage({ ok: false, text: 'Enter a non-zero number of minutes (negative = clawback).' })
      return
    }
    setGrantBusy(true)
    setGrantMessage(null)
    try {
      const r = await fetch('/api/admin/credits/grant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          minutes: Math.trunc(minutes),
          note: grantNote.trim() || undefined,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(j.error || `HTTP ${r.status}`)
      }
      setGrantMessage({
        ok: true,
        text: `Granted ${j.deltaMinutes} min to ${j.email}. New balance: ${j.balanceMinutes} min.`,
      })
      setGrantEmail('')
      setGrantMinutes('')
      setGrantNote('')
      refreshLedger().catch(() => {})
    } catch (err) {
      setGrantMessage({ ok: false, text: err.message || 'Grant failed.' })
    } finally {
      setGrantBusy(false)
    }
  }, [grantEmail, grantMinutes, grantNote, refreshLedger])
  const openCredits = useCallback(async () => {
    setCreditsOpen(true)
    setCreditsLoading(true)
    setCreditsError(null)
    setRevenueSplitLoading(true)
    setRevenueSplitError(null)
    setLedgerLoading(true)
    const cardsPromise = fetch('/api/admin/credits', { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => {
        setCreditsCards(Array.isArray(j.cards) ? j.cards : [])
        setAutoTopupStatus(j.autoTopup || null)
      })
      .catch((err) => setCreditsError(err.message || 'Could not load AI credits'))
      .finally(() => setCreditsLoading(false))
    const splitPromise = fetch('/api/admin/revenue-split?days=30', { credentials: 'include' })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then((j) => setRevenueSplit(j))
      .catch((err) => setRevenueSplitError(err.message || 'Could not load revenue split'))
      .finally(() => setRevenueSplitLoading(false))
    const ledgerPromise = refreshLedger().finally(() => setLedgerLoading(false))
    await Promise.allSettled([cardsPromise, splitPromise, ledgerPromise])
  }, [refreshLedger])

  // Poll ledger every 5s while overlay is open. Cleared on close /
  // unmount so we never leak an interval.
  useEffect(() => {
    if (!creditsOpen || !isAdmin) return undefined
    const id = setInterval(() => { refreshLedger() }, 5000)
    return () => clearInterval(id)
  }, [creditsOpen, isAdmin, refreshLedger])

  // Admin-only — Visitors overlay. One row per SPA page load recorded by
  // the server-side `visitorLog` middleware. Shows IP, country, UA,
  // referer, path, user email (if signed in), timestamp. Auto-refresh
  // every 10s while open so Adrian can watch the live flow.
  const [visitorsOpen, setVisitorsOpen] = useState(false)
  const [visitorsRows, setVisitorsRows] = useState([])
  const [visitorsStats, setVisitorsStats] = useState(null)
  const [visitorsLoading, setVisitorsLoading] = useState(false)
  const [visitorsError, setVisitorsError] = useState(null)
  const refreshVisitors = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/visitors?limit=200&windowHours=24', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setVisitorsRows(Array.isArray(j.visits) ? j.visits : [])
      setVisitorsStats(j.stats || null)
      setVisitorsError(null)
    } catch (err) {
      setVisitorsError(err.message || 'Could not load visitors')
    }
  }, [])
  const openVisitors = useCallback(async () => {
    setVisitorsOpen(true)
    setVisitorsLoading(true)
    await refreshVisitors()
    setVisitorsLoading(false)
  }, [refreshVisitors])
  useEffect(() => {
    if (!visitorsOpen || !isAdmin) return undefined
    const id = setInterval(() => { refreshVisitors() }, 10000)
    return () => clearInterval(id)
  }, [visitorsOpen, isAdmin, refreshVisitors])

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

  // Global ESC handler — closes any open overlay / drawer so the user is
  // never stuck with a side panel they cannot dismiss. Also closes the ⋯
  // menu. The Buy-credits modal has its own backdrop so it also closes
  // on click-outside; this just adds keyboard parity.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      setTranscriptOpen(false)
      setMemoryOpen(false)
      setCreditsOpen(false)
      setBusinessOpen(false)
      setBuyOpen(false)
      setRememberPromptOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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

  // PR E1 — unified admin shell. Two new tab panels (Users, Payouts)
  // replace the scattered overflow-menu entries; Business / AI / Visitors
  // keep their existing open*() data fetchers but now share a tab bar at
  // the top. switchAdminTab is the single entry point the top-bar
  // "Admin · ∞" button and the tab bar both call — it closes whichever
  // tab is currently visible and opens the target one, re-using the
  // existing fetcher so the data is always fresh.
  const [usersOpen, setUsersOpen] = useState(false)
  const [payoutsOpen, setPayoutsOpen] = useState(false)

  // PR E5 — Users drawer state. `usersData` holds the last list
  // response; `usersQuery`/`usersStatus` are the current filters;
  // `selectedUserId` opens a detail sub-drawer with per-user actions
  // (grant credits, ban/unban, reset password, ledger history). The
  // list re-fetches every 15s while the drawer is open so fresh
  // top-ups show up without a manual reload. All mutating calls hit
  // existing admin endpoints gated by `requireAuth` + `requireAdmin`.
  const [usersData, setUsersData] = useState(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState(null)
  const [usersQuery, setUsersQuery] = useState('')
  const [usersStatus, setUsersStatus] = useState('all')
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedHistory, setSelectedHistory] = useState(null)
  const [selectedBusy, setSelectedBusy] = useState(false)
  const [selectedResult, setSelectedResult] = useState(null)

  const refreshUsersList = useCallback(async (q = usersQuery, status = usersStatus) => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      const params = new URLSearchParams()
      if (q && q.trim()) params.set('q', q.trim())
      if (status && status !== 'all') params.set('status', status)
      params.set('limit', '200')
      const r = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setUsersData(await r.json())
    } catch (err) {
      setUsersError(err.message || 'Nu am putut încărca lista de useri')
    } finally {
      setUsersLoading(false)
    }
  }, [usersQuery, usersStatus])

  const openUsers = useCallback(async () => {
    setUsersOpen(true)
    setSelectedUserId(null)
    setSelectedUser(null)
    setSelectedHistory(null)
    setSelectedResult(null)
    await refreshUsersList('', 'all')
  }, [refreshUsersList])

  const loadUserDetail = useCallback(async (userId) => {
    setSelectedUserId(userId)
    setSelectedUser(null)
    setSelectedHistory(null)
    setSelectedResult(null)
    try {
      const [userRes, histRes] = await Promise.all([
        fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { credentials: 'include' }),
        fetch(`/api/admin/users/${encodeURIComponent(userId)}/history?limit=50`, { credentials: 'include' }),
      ])
      if (userRes.ok) setSelectedUser(await userRes.json())
      if (histRes.ok) setSelectedHistory(await histRes.json())
    } catch (err) {
      setSelectedResult({ ok: false, error: err.message || 'Nu am putut citi detaliile' })
    }
  }, [])

  const closeUserDetail = useCallback(() => {
    setSelectedUserId(null)
    setSelectedUser(null)
    setSelectedHistory(null)
    setSelectedResult(null)
  }, [])

  const banSelectedUser = useCallback(async (banned) => {
    if (!selectedUserId || selectedBusy) return
    let reason = null
    if (banned) {
      reason = window.prompt('Motiv suspendare (opțional):', '') || ''
    } else if (!window.confirm('Reactivezi contul?')) {
      return
    }
    setSelectedBusy(true)
    setSelectedResult(null)
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selectedUserId)}/ban`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banned, reason }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setSelectedResult({ ok: true, message: banned ? 'Cont suspendat' : 'Cont reactivat' })
      await Promise.all([loadUserDetail(selectedUserId), refreshUsersList()])
    } catch (err) {
      setSelectedResult({ ok: false, error: err.message || 'Acțiunea a eșuat' })
    } finally {
      setSelectedBusy(false)
    }
  }, [selectedUserId, selectedBusy, loadUserDetail, refreshUsersList])

  const grantCreditsToSelected = useCallback(async () => {
    if (!selectedUserId || selectedBusy) return
    const raw = window.prompt('Câte minute adaugi? (negativ = retragi)', '10')
    if (raw == null) return
    const minutes = Number(raw)
    if (!Number.isFinite(minutes) || minutes === 0) {
      setSelectedResult({ ok: false, error: 'Introduceți un număr diferit de 0' })
      return
    }
    const note = window.prompt('Notă (opțional):', '') || ''
    setSelectedBusy(true)
    setSelectedResult(null)
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selectedUserId)}/credits/grant`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: Math.trunc(minutes), note }),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setSelectedResult({
        ok: true,
        message: `${minutes > 0 ? 'Adăugate' : 'Retrase'} ${Math.abs(Math.trunc(minutes))} minute · sold nou ${body.balance}`,
      })
      await Promise.all([loadUserDetail(selectedUserId), refreshUsersList()])
    } catch (err) {
      setSelectedResult({ ok: false, error: err.message || 'Acțiunea a eșuat' })
    } finally {
      setSelectedBusy(false)
    }
  }, [selectedUserId, selectedBusy, loadUserDetail, refreshUsersList])

  const resetSelectedPassword = useCallback(async () => {
    if (!selectedUserId || selectedBusy) return
    if (!window.confirm('Șterg parola + passkey-ul? Userul va trebui să se reloghează cu Google sau passkey nou.')) {
      return
    }
    setSelectedBusy(true)
    setSelectedResult(null)
    try {
      const r = await fetch(`/api/admin/users/${encodeURIComponent(selectedUserId)}/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
      setSelectedResult({ ok: true, message: 'Parola + passkey șterse. Contactează userul.' })
      await loadUserDetail(selectedUserId)
    } catch (err) {
      setSelectedResult({ ok: false, error: err.message || 'Acțiunea a eșuat' })
    } finally {
      setSelectedBusy(false)
    }
  }, [selectedUserId, selectedBusy, loadUserDetail])

  // 15s live refresh of the users list while the drawer is open.
  useEffect(() => {
    if (!usersOpen) return undefined
    const id = setInterval(() => { refreshUsersList() }, 15000)
    return () => clearInterval(id)
  }, [usersOpen, refreshUsersList])

  // PR E3 — Payouts drawer pulls a live snapshot from Stripe (balance,
  // linked external account, next-payout schedule, last ~10 payouts)
  // plus the 50/50 AI-vs-profit split over the last 30 days. The
  // snapshot aggregator on the server never throws; partial failures
  // land in `payoutsData.errors` and the UI renders whatever did load.
  const [payoutsData, setPayoutsData] = useState(null)
  const [payoutsLoading, setPayoutsLoading] = useState(false)
  const [payoutsError, setPayoutsError] = useState(null)
  const [payoutBusy, setPayoutBusy] = useState(false)
  const [payoutResult, setPayoutResult] = useState(null)
  // `refreshPayoutsData` pulls a fresh snapshot without touching
  // `payoutResult`; that way the "OK — 50.00 EUR · status in_transit"
  // banner survives the refresh triggered right after a successful
  // instant payout. `openPayouts` wraps it and additionally clears the
  // previous result so opening the drawer from scratch feels clean.
  const refreshPayoutsData = useCallback(async () => {
    setPayoutsLoading(true)
    setPayoutsError(null)
    try {
      const r = await fetch('/api/admin/payouts?days=30', { credentials: 'include' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setPayoutsData(await r.json())
    } catch (err) {
      setPayoutsError(err.message || 'Could not load payouts dashboard')
    } finally {
      setPayoutsLoading(false)
    }
  }, [])
  const openPayouts = useCallback(async () => {
    setPayoutsOpen(true)
    setPayoutResult(null)
    await refreshPayoutsData()
  }, [refreshPayoutsData])
  const triggerInstantPayout = useCallback(async () => {
    if (payoutBusy) return
    // A confirm() keeps this honest — an instant payout cannot be
    // undone, and the Stripe fee (~1% + €0.25) is real money.
    if (!window.confirm('Instant payout: transferă soldul disponibil pe cardul legat acum. Taxa Stripe ~1% + 0.25 EUR. Continuăm?')) {
      return
    }
    setPayoutBusy(true)
    setPayoutResult(null)
    try {
      const r = await fetch('/api/admin/payouts/instant', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        // Empty body → Stripe pays out the full instant-available balance.
        body: JSON.stringify({}),
      })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error((body && body.error) || `HTTP ${r.status}`)
      }
      setPayoutResult({ ok: true, ...body })
      // Refresh the snapshot so the new payout shows up in recent list.
      // Must use `refreshPayoutsData` (not `openPayouts`) so the success
      // banner we just set isn't immediately wiped.
      refreshPayoutsData()
    } catch (err) {
      setPayoutResult({ ok: false, error: err.message || 'Instant payout failed' })
    } finally {
      setPayoutBusy(false)
    }
  }, [payoutBusy, refreshPayoutsData])

  const switchAdminTab = useCallback((tab) => {
    // Close non-target tabs first so only one panel is on screen at a
    // time. Each open*() call on the target flips its own state to true.
    if (tab !== 'business') setBusinessOpen(false)
    if (tab !== 'ai')       setCreditsOpen(false)
    if (tab !== 'visitors') setVisitorsOpen(false)
    if (tab !== 'users')    setUsersOpen(false)
    if (tab !== 'payouts')  setPayoutsOpen(false)
    if (tab === 'business') { openBusiness() }
    else if (tab === 'ai')       { openCredits() }
    else if (tab === 'visitors') { openVisitors() }
    else if (tab === 'users')    { openUsers() }
    else if (tab === 'payouts')  { openPayouts() }
  }, [openBusiness, openCredits, openVisitors, openUsers, openPayouts])

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
  // Conversation history — user-requested ("sa aiba optiune de save").
  // Signed-in users get server persistence via /api/conversations; guests
  // fall back to localStorage. See src/lib/conversationStore.js.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyItems, setHistoryItems] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(null)
  // Track how many messages we've already persisted so the save-effect
  // only appends deltas (not the whole transcript on every turn).
  const savedUpToRef = useRef(0)
  // F2 — "+" attach. Adrian: "lipseste + de introdus date". Accepts
  // images, PDFs and text files. For MVP we only surface the filename to
  // the model (as a bracketed note) and preview-pill it in the composer
  // so the user gets visual confirmation of the attachment. Full upload
  // + embedding support lands in a follow-up PR.
  const [attachedFile, setAttachedFile] = useState(null)
  const fileInputRef = useRef(null)
  const sendTextMessage = useCallback(async () => {
    const text = chatInput.trim()
    if (!text && !attachedFile) return
    if (chatBusy) return
    setChatError(null)
    const attachNote = attachedFile
      ? `\n\n[attached file: ${attachedFile.name}${attachedFile.size ? ` (${Math.round(attachedFile.size / 1024)} KB)` : ''}]`
      : ''
    const combined = (text + attachNote).trim()
    const next = [...chatMessages, { role: 'user', content: combined }].slice(-12)
    setChatMessages(next)
    setChatInput('')
    setAttachedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setChatBusy(true)
    try {
      const chatHeaders = { 'Content-Type': 'application/json' }
      if (authTokenRef.current) {
        chatHeaders['Authorization'] = `Bearer ${authTokenRef.current}`
      }
      // ───── Vision: capture a frame from the user's webcam ─────
      // Adrian: "viziunea nu merge, gpt 5.4 trebuie sa capteze si sa-i dea
      // avatarului detaliile cind este intrebat". The backend `/api/chat`
      // route already accepts an optional `frame` (base64 data URL) and
      // attaches it to the last user message as an image_url part; we just
      // weren't ever sending one from the text composer. Grab the latest
      // frame from the hidden <video> that mirrors `cameraStream` whenever
      // the camera is live — if the user is on trial / camera off / grant
      // denied, we skip the frame and fall back to text-only chat.
      let frame = null
      try {
        const v = cameraVideoRef.current
        if (
          v && !v.paused && v.readyState >= 2 &&
          v.videoWidth > 0 && v.videoHeight > 0
        ) {
          // Downscale to 512px on the long edge: vision models only need a
          // rough view, and keeping the payload small avoids slow uploads
          // from the user's home uplink.
          const maxDim = 512
          const scale = Math.min(1, maxDim / Math.max(v.videoWidth, v.videoHeight))
          const w = Math.max(1, Math.round(v.videoWidth * scale))
          const h = Math.max(1, Math.round(v.videoHeight * scale))
          const c = document.createElement('canvas')
          c.width = w; c.height = h
          const ctx = c.getContext('2d')
          if (ctx) {
            ctx.drawImage(v, 0, 0, w, h)
            // JPEG at q=0.7 keeps a 512-px frame at ~25-40 KB — small
            // enough to send inline without blocking the request.
            frame = c.toDataURL('image/jpeg', 0.7)
          }
        }
      } catch (_) { frame = null }
      const r = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: chatHeaders,
        body: JSON.stringify({
          messages: next,
          datetime: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          ...(frame ? { frame } : {}),
        }),
      })
      if (r.status === 401) {
        // Stale JWT or expired session — server already cleared the cookie.
        // Drop local auth state so the UI reverts to the Sign-in button and
        // trial flow instead of looking "signed in" with a dead session.
        setAuthState({ signedIn: false, user: null })
        throw new Error('Session expired — please sign in again (⋯ menu).')
      }
      if (r.status === 402) {
        // Signed-in user out of credits (Adrian: "daca ti-ai facut user nu
        // trebuie sa functioneze daca nu ai cumparat credit"). Pop the
        // buy-credits modal and surface a clear message. The modal is
        // already wired below; we just trigger it here.
        const body = await r.json().catch(() => ({}))
        try { setBuyOpen(true) } catch (_) {}
        throw new Error(body.error || 'No credits left — please buy a package to continue.')
      }
      if (r.status === 429) {
        // Guest trial exhausted. `reason` distinguishes the daily 15-min
        // window from the 7-day lifetime cap. For lifetime_expired we show
        // a "create account" message so the user knows free access is
        // permanently gone from this IP.
        const body = await r.json().catch(() => ({}))
        const lifetime = body && body.trial && body.trial.reason === 'lifetime_expired'
        trialHud.refresh()
        if (lifetime) {
          try { setSignInModalOpen(true) } catch (_) {}
          throw new Error(body.error || 'Your 7-day free trial has ended — create an account and buy credits to continue.')
        }
        throw new Error(body.error || 'Free trial used up — sign in or buy credits to continue.')
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      // First successful POST as a guest stamps the shared 15-min
      // window on the server — refresh the HUD so the top-right timer
      // starts counting down without waiting for the next poll.
      if (!authState.signedIn) {
        trialHud.refresh()
      }
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
            } else if (obj.tool === 'show_on_monitor' && obj.arguments) {
              // Server streamed a tool-call frame — the model decided to
              // open something on the monitor. Invoke the same handler
              // the voice path uses; a natural-language confirmation
              // ("Here's Cluj-Napoca on the monitor.") streams next.
              try { handleShowOnMonitor(obj.arguments) } catch (e) {
                console.warn('[chat] show_on_monitor failed', e && e.message)
              }
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
  }, [chatInput, chatBusy, chatMessages, attachedFile])

  const micMouthOpen = useLipSync(audioRef)

  // ───── Text-chat TTS (server-side ElevenLabs, male native voice) ─────
  // Adrian: "vocea nu este elevenlab, nativa, barbateasca, voce de femeie acum".
  // Previously this path used `window.speechSynthesis` which defaults to the
  // OS voice (on Windows/Chrome that's typically a female English voice).
  // We now POST the assistant's reply to /api/tts — the server synthesizes
  // with ElevenLabs (Adam — male, multilingual) or Gemini "Charon" (male)
  // and returns an audio/mpeg or audio/wav blob. We play it via an offscreen
  // <audio> element; a cosine envelope drives the mouth while it plays so
  // the avatar lip-flaps along (no real-time analyser on CORS-restricted
  // HTMLMediaElement is needed for coarse correlation).
  const [ttsMouthOpen, setTtsMouthOpen] = useState(0)
  const lastSpokenRef = useRef('')
  const ttsRafRef = useRef(null)
  const ttsAudioRef = useRef(null)
  const ttsAbortRef = useRef(null)
  useEffect(() => {
    if (chatBusy) return
    const last = chatMessages[chatMessages.length - 1]
    if (!last || last.role !== 'assistant' || !last.content) return
    if (last.content === lastSpokenRef.current) return
    lastSpokenRef.current = last.content

    // Cancel any in-flight TTS from the previous message.
    if (ttsAbortRef.current) { try { ttsAbortRef.current.abort() } catch (_) {} }
    if (ttsAudioRef.current) { try { ttsAudioRef.current.pause() } catch (_) {} ttsAudioRef.current = null }
    try { if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel() } catch (_) {}

    const controller = new AbortController()
    ttsAbortRef.current = controller

    const drive = () => {
      // 4 Hz cosine envelope, 0..0.9, approximates jaw motion during speech.
      const t = performance.now() / 1000
      const v = 0.45 + 0.45 * Math.abs(Math.sin(t * 4 * Math.PI))
      setTtsMouthOpen(v)
      ttsRafRef.current = requestAnimationFrame(drive)
    }
    const stopDrive = () => {
      if (ttsRafRef.current) { cancelAnimationFrame(ttsRafRef.current); ttsRafRef.current = null }
      setTtsMouthOpen(0)
    }

    const ttsHeaders = { 'Content-Type': 'application/json' }
    if (authTokenRef.current) ttsHeaders['Authorization'] = `Bearer ${authTokenRef.current}`

    // Browser locale is a highly reliable signal for which language the user
    // types in — we forward it as a hint so short replies still route to a
    // native voice (server falls back to text-based detection otherwise).
    const hint = (typeof navigator !== 'undefined' && navigator.language)
      ? String(navigator.language).toLowerCase().slice(0, 2) : ''

    ;(async () => {
      let audioUrl = null
      try {
        const r = await fetch('/api/tts', {
          method: 'POST',
          credentials: 'include',
          headers: ttsHeaders,
          body: JSON.stringify({ text: last.content, lang: hint }),
          signal: controller.signal,
        })
        if (!r.ok) throw new Error(`TTS ${r.status}`)
        const blob = await r.blob()
        audioUrl = URL.createObjectURL(blob)
        const audio = new Audio(audioUrl)
        ttsAudioRef.current = audio
        audio.onplay = () => {
          if (ttsRafRef.current) cancelAnimationFrame(ttsRafRef.current)
          drive()
        }
        const cleanup = () => {
          stopDrive()
          if (audioUrl) { try { URL.revokeObjectURL(audioUrl) } catch (_) {} audioUrl = null }
        }
        audio.onended = cleanup
        audio.onerror = cleanup
        audio.onpause = () => { stopDrive() }
        await audio.play()
      } catch (err) {
        if (err.name === 'AbortError') return
        // Hard fallback: if /api/tts fails (no key configured, rate limit,
        // network), speak with the browser synth so the user still hears
        // *something*. This is the old behaviour and intentionally a last
        // resort — the voice on Windows may be female.
        try {
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            const utt = new SpeechSynthesisUtterance(last.content)
            utt.rate = 1.0; utt.pitch = 1.0; utt.volume = 1.0
            try {
              const voices = window.speechSynthesis.getVoices()
              // Best-effort male voice pick + locale match.
              const pref = voices.find((v) =>
                v.lang && v.lang.toLowerCase().startsWith(hint) &&
                /male|daniel|alex|george|david|mark/i.test(v.name))
                || voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(hint))
                || voices.find((v) => /male|daniel|alex|george|david|mark/i.test(v.name))
              if (pref) utt.voice = pref
            } catch (_) { /* best-effort */ }
            utt.onstart = () => { if (ttsRafRef.current) cancelAnimationFrame(ttsRafRef.current); drive() }
            utt.onend = stopDrive
            utt.onerror = stopDrive
            window.speechSynthesis.speak(utt)
          }
        } catch (_) { stopDrive() }
      }
    })()

    return () => {
      try { controller.abort() } catch (_) {}
      if (ttsAudioRef.current) { try { ttsAudioRef.current.pause() } catch (_) {} ttsAudioRef.current = null }
      stopDrive()
    }
  }, [chatMessages, chatBusy])

  // Max of voice-chat lipsync and text-chat TTS envelope feeds the avatar.
  const mouthOpen = Math.max(micMouthOpen || 0, ttsMouthOpen || 0)

  // Chat bubble auto-hide — Adrian: "chatul trebuie sa dispara dupa ce s-a
  // spus ramine doar in istoric, se afiseaza doar curent ce scrie user sau
  // avatar". We keep chatMessages as the persistent history (for context +
  // transcript panel), but fade the on-stage bubble out after 8s of quiet
  // so the avatar isn't cluttered. The timer resets on every new message
  // or when streaming resumes (chatBusy).
  const [bubbleVisible, setBubbleVisible] = useState(true)
  const bubbleHideTimerRef = useRef(null)
  useEffect(() => {
    if (chatMessages.length === 0) { setBubbleVisible(false); return }
    setBubbleVisible(true)
    if (bubbleHideTimerRef.current) clearTimeout(bubbleHideTimerRef.current)
    if (chatBusy) return
    bubbleHideTimerRef.current = setTimeout(() => setBubbleVisible(false), 8000)
    return () => { if (bubbleHideTimerRef.current) clearTimeout(bubbleHideTimerRef.current) }
  }, [chatMessages, chatBusy])

  // Plan C — provider switch. Two stable transports are mounted in
  // parallel (both hooks allocate refs/state only; neither opens a
  // network connection until the user taps mic), and the HUD routes
  // start/stop to whichever is currently selected. Default is the
  // OpenAI Realtime GA transport — it does not depend on the Gemini
  // Live preview keep-alive that Google closes at ~2 min on our key.
  //
  // Selection precedence (highest wins):
  //   1. ?provider=openai | gemini query param (useful for A/B testing)
  //   2. localStorage.kelion_live_provider (persisted user choice)
  //   3. 'openai'                           (Plan C default)
  const [liveProvider, setLiveProvider] = useState(() => {
    try {
      const q = new URL(window.location.href).searchParams.get('provider')
      if (q === 'openai' || q === 'gemini') return q
      const saved = window.localStorage.getItem('kelion_live_provider')
      if (saved === 'openai' || saved === 'gemini') return saved
    } catch (_) { /* no window in SSR / sandboxed iframes — fall through */ }
    return 'openai'
  })
  useEffect(() => {
    try { window.localStorage.setItem('kelion_live_provider', liveProvider) }
    catch (_) { /* storage disabled — best-effort */ }
  }, [liveProvider])

  const geminiHook = useGeminiLive({
    audioRef,
    coords: clientGeo,
    // Live HUD: every successful consume response carries the
    // post-deduction balance. Pipe it straight into the top-right
    // "Credits · N" chip so users see the credit tick down per minute
    // without a page refresh. Admins get `null` (exempt) and the
    // hook skips the update — chip stays on whatever /balance loaded.
    onBalanceUpdate: (minutes) => setBalance(minutes),
  })
  const openaiHook = useOpenAIRealtime({
    audioRef,
    coords: clientGeo,
    onBalanceUpdate: (minutes) => setBalance(minutes),
  })
  // Active transport — rest of the component destructures from this.
  // Both hooks return the same shape (see lib/openaiRealtime.js
  // "Public signature matches useGeminiLive exactly").
  const liveHook = liveProvider === 'openai' ? openaiHook : geminiHook
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
    // Voice-chat trial countdown returned by the active transport's
    // token mint. We no longer drive the HUD off this — the HUD
    // pulls from the shared /api/trial/status endpoint so the timer
    // also ticks for text-chat-only guests who never touch the mic.
    trial: voiceTrial,
  } = liveHook
  // Hook refs — both useOpenAIRealtime and useGeminiLive return plain
  // object literals without useMemo (geminiLive.js ~l.971, openaiRealtime.js
  // ~l.575), so their identity changes every render. Holding them in refs
  // and reading inside effects keeps the effects from re-firing on every
  // keystroke and was the other half of why the #117 setTimeout-cleanup
  // bug bit (Devin Review Info on #118, comment id 3116094529 also notes
  // the prevProviderRef effect below shares this wart — same refs now).
  const openaiHookRef = useRef(openaiHook)
  const geminiHookRef = useRef(geminiHook)
  openaiHookRef.current = openaiHook
  geminiHookRef.current = geminiHook

  // Flip providers cleanly: stop whatever's live on the old provider
  // before the next tap spins up the new one. No-op when the switched-
  // away provider is idle.
  const prevProviderRef = useRef(liveProvider)
  useEffect(() => {
    if (prevProviderRef.current === liveProvider) return
    const outgoing = prevProviderRef.current === 'openai' ? openaiHookRef.current : geminiHookRef.current
    try { outgoing.stop() } catch (_) { /* hooks unmount-safe */ }
    prevProviderRef.current = liveProvider
  }, [liveProvider])

  // Auto-fallback — silent provider swap on terminal transport error.
  //
  // Original #117 nested `start()` inside a setTimeout whose cleanup
  // lived on the same effect that flipped `liveProvider`. `liveProvider`
  // was a dep, so setLiveProvider immediately re-ran the effect; cleanup
  // clear()ed the timer before the 120 ms budget elapsed and start()
  // never fired. Codex / Copilot / Devin Review all flagged it P1.
  //
  // Fix (PR #118, refined here): split into two effects, no setTimeout.
  //   1. On transport-level status='error', set pendingFallbackRef and
  //      flip liveProvider.
  //   2. A separate effect on [liveProvider] sees the flag and calls
  //      .start() on the now-active hook. Because React runs effects
  //      in declaration order within one component, the prevProviderRef
  //      effect (declared just above) has already stopped the outgoing
  //      transport on the same commit — no timer race.
  //
  // Latch: the one-shot `autoFallbackTriedRef` is intentionally reset
  // ONLY on 'listening'. PR #118 also reset it on 'requesting' — but
  // both transport hooks flip status to 'requesting' synchronously
  // inside their own start() (openaiRealtime.js:290, geminiLive.js:411),
  // which means the fallback's own start() call in effect (2) would
  // clear the latch before the second provider's outcome is known.
  // If that second attempt also errored, the error effect would see
  // latch=false and flip providers again — infinite ping-pong between
  // OpenAI and Gemini when both are genuinely down (Codex P1 +
  // Devin Review P1 on #118). If a user is stuck after a double-failure,
  // refreshing the page recreates the ref fresh (ref state doesn't
  // survive unmount), so localStorage's last-persisted provider still
  // gets one fresh fallback attempt on the next load.
  //
  // Account-level errors (credits / trial / auth) bypass fallback —
  // swapping providers can't help those and doing so would race the
  // Buy Credits modal / reauth redirect. The match list is aligned with
  // setError(...) strings in src/lib/geminiLive.js + openaiRealtime.js;
  // Devin Review (Info) flagged substring matching as fragile — a
  // structured error code on the hook would be cleaner, but that's a
  // cross-cutting refactor of both transport libs and out of scope.
  const autoFallbackTriedRef = useRef(false)
  const pendingFallbackRef = useRef(false)
  useEffect(() => {
    if (status === 'listening') autoFallbackTriedRef.current = false
  }, [status])
  useEffect(() => {
    if (status !== 'error' || !error) return
    if (autoFallbackTriedRef.current) return
    const msg = typeof error === 'string' ? error.toLowerCase() : String(error || '').toLowerCase()
    // Account-level failures — not something another provider can fix.
    // Keep this list aligned with the user-facing strings in
    // src/lib/geminiLive.js + src/lib/openaiRealtime.js.
    if (
      msg.includes('no credits') ||
      msg.includes('buy a package') ||
      msg.includes('buy credits') ||
      msg.includes('buy more') ||
      msg.includes('free trial') ||
      msg.includes('trial has ended') ||
      msg.includes('session expired') ||
      msg.includes('sign in again')
    ) {
      return
    }
    autoFallbackTriedRef.current = true
    pendingFallbackRef.current = true
    const nextProvider = liveProvider === 'openai' ? 'gemini' : 'openai'
    console.warn('[kelionStage] live provider', liveProvider, 'terminal — switching to', nextProvider, '·', msg)
    setLiveProvider(nextProvider)
  }, [status, error, liveProvider])
  useEffect(() => {
    if (!pendingFallbackRef.current) return
    pendingFallbackRef.current = false
    // prevProviderRef effect (declared earlier) already stop()-ed the
    // outgoing transport on this same commit; it's safe to start the
    // new one synchronously now. Effect declaration order is the
    // coordination mechanism here — if this block is ever moved above
    // prevProviderRef, the invariant breaks silently (Devin Review Info
    // on #118). Keep this block below that effect.
    try {
      const active = liveProvider === 'openai' ? openaiHookRef.current : geminiHookRef.current
      active.start()
    } catch (e) {
      console.warn('[kelionStage] auto-fallback start() threw', e)
    }
  }, [liveProvider])

  // Unified trial HUD source of truth. Applies to both voice AND text
  // chat via the shared 15-min/day IP window on the server. Collapses
  // (`applicable: false`) the moment the user signs in.
  const trialHud = useTrial({ signedIn: !!authState.signedIn })
  const trialRemainingMs = trialHud.remainingMs
  // Tap-to-talk schedules a 600 ms setTimeout to refresh the HUD; we
  // keep the id in a ref and clear it on unmount so we don't setState
  // on an unmounted component (Copilot review pr-74).
  const trialRefreshTimerRef = useRef(null)
  useEffect(() => () => {
    if (trialRefreshTimerRef.current) {
      clearTimeout(trialRefreshTimerRef.current)
      trialRefreshTimerRef.current = null
    }
  }, [])
  // Kick the Gemini Live hook's local trial state when the server flips
  // to exhausted on either surface — prevents a just-started voice
  // session from running past the shared quota that a text-chat user
  // might have burned down first.
  useEffect(() => {
    if (trialHud.applicable && !trialHud.allowed && voiceTrial && voiceTrial.active) {
      // eslint-disable-next-line no-console
      console.log('[trial] server quota exhausted — voice session will stop')
    }
  }, [trialHud.applicable, trialHud.allowed, voiceTrial])

  // Auto-open the Buy Credits modal when the voice session errors out
  // with a credit-exhausted message (Adrian: "cind ajunge iar la 0 se
  // trimite mesaj reincarca"). The Gemini Live hook already surfaces a
  // clean message from the 402 token response; we match on it so a
  // typical credit-gate trip surfaces the package picker immediately
  // instead of leaving the user to find the Credits pill.
  useEffect(() => {
    if (!error || typeof error !== 'string') return
    const low = error.toLowerCase()
    if (low.includes('no credits') || low.includes('buy a package') || low.includes('buy credits')) {
      setBuyOpen(true)
    }
  }, [error])

  const cameraVideoRef = useRef(null)
  useEffect(() => {
    if (cameraVideoRef.current && cameraStream) {
      cameraVideoRef.current.srcObject = cameraStream
      cameraVideoRef.current.play().catch(() => {})
    }
  }, [cameraStream])

  useEffect(() => { setVoiceLevel(userLevel || 0) }, [userLevel])

  // F16 — camera ON from the moment the user enters the interface,
  // OFF only at sign-out / unmount. Adrian: "camera este on din momentul
  // intrarii pe interfata pina la inchidere la logoff sau iesire
  // accidentala din aplicatie". No debounce-off, no gating on keystroke
  // or VAD — the camera is a persistent ambient sensor for as long as
  // the stage is mounted. Manual toggle via ⋯ menu still works for users
  // who explicitly turn it off.
  // F16 — camera auto-start once per mount. Runs for trial (not signed
  // in) AND signed-in users per spec ("camera este on din momentul
  // intrarii pe interfata"). The guard is set true on first run and
  // deliberately NEVER cleared for the lifetime of this mount — that
  // way, once the user has signed out (see stop effect below), the
  // camera will not auto-restart in the same tab without a page
  // reload. Re-engagement on re-sign-in is a reload, not an in-tab
  // flip, which matches Adrian's F16 wording "pina la inchidere".
  const cameraAutoStartedRef = useRef(false)
  // Tracks whether we've ever seen authState.signedIn === true during
  // this mount. Used to distinguish "user just signed out" from "user
  // never signed in (trial)". We only react to the sign-out transition,
  // not to the initial false-on-mount state.
  const hasBeenSignedInRef = useRef(false)
  useEffect(() => {
    if (cameraAutoStartedRef.current) return
    if (cameraStream) return // already running (manual toggle or prior mount)
    if (typeof startCamera !== 'function') return
    cameraAutoStartedRef.current = true
    // First-visit Chrome/Safari gate getUserMedia behind a user-gesture,
    // so the bare mount-time attempt below can fail silently (the user
    // never clicked yet). We attempt immediately for return visitors who
    // already granted permission, and install a one-shot gesture listener
    // that retries on the very first pointer/key/touch so the camera lights
    // up without the user ever seeing a "turn camera on" button.
    let calledOnce = false
    const tryOnce = () => {
      if (calledOnce) return
      calledOnce = true
      // startCamera is async and now rejects on getUserMedia failure — use
      // .catch() so an unhandled rejection doesn't crash the page. The
      // visionError banner already surfaces the human-readable reason.
      try { const p = startCamera(); if (p && typeof p.catch === 'function') p.catch(() => {}) } catch (_) { /* sync guard — same banner */ }
    }
    const onGesture = () => {
      tryOnce()
      // One-shot: remove listeners whether the call succeeded or not; if
      // it failed because permission was explicitly denied, retrying on
      // every click would be user-hostile.
      window.removeEventListener('pointerdown', onGesture, true)
      window.removeEventListener('keydown', onGesture, true)
      window.removeEventListener('touchstart', onGesture, true)
    }
    window.addEventListener('pointerdown', onGesture, true)
    window.addEventListener('keydown', onGesture, true)
    window.addEventListener('touchstart', onGesture, true)
    // Initial attempt for returning users where permission is remembered.
    // If it fails for lack of a user-gesture, the listeners above take over.
    tryOnce()
    return () => {
      window.removeEventListener('pointerdown', onGesture, true)
      window.removeEventListener('keydown', onGesture, true)
      window.removeEventListener('touchstart', onGesture, true)
    }
    // We intentionally depend on `startCamera` only; cameraStream transitions
    // reset the guard path through the early returns above, so adding it here
    // would spin up a second attempt every time the stream object changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startCamera])

  // Stop the camera reactively when the user signs out. handleSignOut
  // only resets authState; it does NOT unmount KelionStage, so without
  // this effect the camera would keep streaming after sign-out (Codex
  // P1 on PR #42). We intentionally do NOT reset cameraAutoStartedRef
  // here (Codex P1 on PR #43): leaving the guard set prevents the
  // auto-start effect above from immediately re-firing when
  // cameraStream transitions to null.
  useEffect(() => {
    if (authState.signedIn) {
      hasBeenSignedInRef.current = true
      return
    }
    // Only stop on the signed-in → signed-out transition, not on the
    // initial { signedIn: false } mount state (trial users).
    if (!hasBeenSignedInRef.current) return
    if (typeof stopCamera === 'function') {
      try { stopCamera() } catch (_) {}
    }
  }, [authState.signedIn, stopCamera])

  // Belt-and-braces unmount cleanup (navigation away, tab close).
  useEffect(() => {
    return () => {
      if (typeof stopCamera === 'function') {
        try { stopCamera() } catch (_) {}
      }
    }
  }, [stopCamera])

  // Adrian's spec ("cind intru pe aplicatie sa fie default delogat"):
  // every fresh page load must start in the signed-out trial state, even
  // if the user has a valid kelion.token cookie from a previous visit.
  // We intentionally do NOT hydrate auth from /api/auth/passkey/me here;
  // instead we best-effort clear the server cookie on mount so the user
  // must explicitly click "Sign in" and re-enter credentials. Auth still
  // works normally after they click through the modal — handleSignIn in
  // the modal onSuccess path does its own fetchMe + setAuthState below.
  useEffect(() => {
    let cancelled = false
    signOut().catch(() => { /* best-effort; modal will still work */ })
    if (!cancelled) setAuthState({ signedIn: false, user: null })
    return () => { cancelled = true }
  }, [])

  // Wire conversation-history store to live auth state. authTokenRef is
  // a ref so passing it lazily avoids re-wiring on every render. The
  // store picks server vs localStorage based on `signedIn`; this
  // effect is intentionally a one-time configuration, the getters stay
  // live across auth transitions.
  useEffect(() => {
    configureConversationStore({
      getAuthToken: () => authTokenRef.current,
      getIsSignedIn: () => !!authState.signedIn,
    })
  }, [authState.signedIn])

  // Auto-save new chat messages to the conversation history backend.
  // `savedUpToRef` tracks the prefix of `chatMessages` that has already
  // been persisted so we only POST the delta.
  //
  // Two subtleties this effect MUST handle correctly, both of which
  // the previous implementation got wrong (zero setItem calls on prod
  // during streaming):
  //
  //   1. While `chatBusy` is true the last assistant message is a
  //      half-streamed chunk (e.g. "Par" before "Paris"). Persisting
  //      it now would save garbage and advance the cursor past the
  //      final content — so we hold off on the tail until streaming
  //      finishes (chatBusy flips back to false, which re-runs this
  //      effect via the dep array).
  //
  //   2. SSE chunks fire many setChatMessages calls per second. Each
  //      one triggers this effect and cancels the previous run's
  //      closure. If we only advance `savedUpToRef` at the end of the
  //      loop, rapid cancellations mean the ref never advances and
  //      work repeats. We advance it incrementally, inside the loop,
  //      the moment each message is actually persisted — cancellation
  //      then just halts future iterations, it doesn't roll back
  //      progress already made.
  useEffect(() => {
    const total = chatMessages.length
    const start = savedUpToRef.current
    if (total <= start) {
      if (total < start) savedUpToRef.current = total // transcript was cleared
      return
    }
    let cancelled = false
    ;(async () => {
      for (let i = start; i < chatMessages.length; i++) {
        if (cancelled) return
        const m = chatMessages[i]
        if (!m || !m.content || !String(m.content).trim()) break
        const isLast = i === chatMessages.length - 1
        // Hold off on the still-streaming assistant tail — we'll pick
        // it up once chatBusy flips back to false.
        if (isLast && chatBusy && (m.role || 'user') === 'assistant') break
        try {
          await appendConversationMessage({ role: m.role || 'user', content: m.content })
          if (!cancelled) savedUpToRef.current = i + 1
        } catch { /* next change will retry from the unchanged cursor */ }
      }
    })()
    return () => { cancelled = true }
  }, [chatMessages, chatBusy])

  // Load history list whenever the panel opens.
  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true)
    setHistoryError(null)
    try {
      const items = await listConversationsApi()
      setHistoryItems(Array.isArray(items) ? items : [])
    } catch (err) {
      setHistoryError(err.message || 'Could not load history')
    } finally {
      setHistoryLoading(false)
    }
  }, [])
  useEffect(() => {
    if (!historyOpen) return
    refreshHistory()
  }, [historyOpen, refreshHistory, authState.signedIn])

  // Actions invoked from the history panel.
  const handleNewChat = useCallback(() => {
    startNewConversation()
    savedUpToRef.current = 0
    setChatMessages([])
    setChatError(null)
    setHistoryOpen(false)
  }, [])
  const handleLoadHistory = useCallback(async (id) => {
    setHistoryError(null)
    try {
      const conv = await loadConversationApi(id)
      if (!conv) { setHistoryError('Conversation not found'); return }
      const msgs = Array.isArray(conv.messages) ? conv.messages : []
      setActiveConversationId(id)
      // Mark the full loaded transcript as "already saved" so the
      // auto-save effect doesn't re-append it as new turns.
      savedUpToRef.current = msgs.length
      setChatMessages(msgs.map((m) => ({ role: m.role, content: m.content })))
      setHistoryOpen(false)
    } catch (err) {
      setHistoryError(err.message || 'Could not load conversation')
    }
  }, [])
  const handleDeleteHistory = useCallback(async (id) => {
    try {
      await deleteConversationApi(id)
    } finally {
      if (getActiveConversationId() === id) {
        setActiveConversationId(null)
        savedUpToRef.current = 0
        setChatMessages([])
      }
      refreshHistory()
    }
  }, [refreshHistory])

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
    authTokenRef.current = null
    setAuthState({ signedIn: false, user: null })
    setMemoryItems([])
    setMemoryOpen(false)
    // Don't leak the previous user's server conversation into the
    // now-signed-out guest session. Clear the active id, on-screen
    // transcript, loaded history list, and the autosave cursor.
    try { startNewConversation() } catch { /* ignore */ }
    setChatMessages([])
    setHistoryItems([])
    setHistoryOpen(false)
    savedUpToRef.current = 0
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
    // First user gesture → kick the geolocation permission prompt.
    // iOS Safari silently skips `getCurrentPosition` called outside a
    // real gesture, so the passive on-mount request in useClientGeo
    // often never shows a dialog on iPhone/iPad. Calling it from this
    // click handler makes iOS render the permission dialog reliably.
    // No-op once permission is already 'granted' (requestNow short-
    // circuits on repeat).
    if (geoPermission !== 'granted') {
      try { requestGeo() } catch { /* ignore — hook logs internally */ }
    }
    if (status === 'idle' || status === 'error') {
      start()
      // Tap-to-talk is a gated guest action — refresh the trial HUD so
      // the top-right countdown starts ticking immediately once the
      // token mint stamps the 15-min window server-side. No-op for
      // signed-in users (applicable: false).
      if (!authState.signedIn) {
        // Small delay so the server has time to stamp on the token mint
        // request before we poll. 600 ms is well under the first audio
        // chunk, so the HUD update feels instant. Tracked in a ref so
        // we can clear it on unmount (Copilot review pr-74) — otherwise
        // a quick navigation mid-delay would setState on an unmounted
        // useTrial consumer.
        if (trialRefreshTimerRef.current) clearTimeout(trialRefreshTimerRef.current)
        trialRefreshTimerRef.current = setTimeout(() => {
          trialRefreshTimerRef.current = null
          trialHud.refresh()
        }, 600)
      }
    }
  }, [menuOpen, status, start, geoPermission, requestGeo, authState.signedIn, trialHud])

  // ───── Wake-word "Kelion" ─────
  // Adrian: "cind zic kelion se auto porneste butonul de chat".
  // When the status is idle (no live session yet, or a previous error
  // cleared the state), run a background recogniser that listens for
  // the hotword and triggers the same entry point as the tap-to-talk
  // click. The hook is a no-op on browsers without the Web Speech API
  // (Safari iOS, Firefox), so the manual tap flow stays untouched for
  // those users.
  // Wake-word is armed ONLY on 'idle' — not on 'error'. After a
  // protocol failure (1007/1008/1011) the user must tap the stage to
  // explicitly retry. Auto-retrying from 'error' re-opens a WS against
  // the same failing token / quota / model and loops the same error,
  // which is exactly the "crapa dupa 2 min de funtionare 1007" Adrian
  // reported on 2026-04-20.
  useWakeWord({
    enabled: status === 'idle',
    onDetect: () => {
      if (status === 'idle') {
        try { start() } catch (_) { /* banner surfaces failure */ }
        if (!authState.signedIn) {
          if (trialRefreshTimerRef.current) clearTimeout(trialRefreshTimerRef.current)
          trialRefreshTimerRef.current = setTimeout(() => {
            trialRefreshTimerRef.current = null
            trialHud.refresh()
          }, 600)
        }
      }
    },
  })

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
      {/* Debug-only Leva tuning drawer. Renders null unless the URL
          carries ?debug=1 or ?tune=1; zero cost for real users. */}
      {isTuningEnabled() && <TuningPanel />}
      <Canvas
        /* THREE 0.183 deprecated PCFSoftShadowMap (the r3f default when
           `shadows` is passed bare). Switch to VSMShadowMap — softer
           results and no console warning. */
        shadows={{ type: THREE.VSMShadowMap }}
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
          {/* Halo removed — Adrian asked to stop the pulsating circle behind
              the avatar; it was too busy. Status color is still conveyed
              through the spotlights + status-dot in the HUD. */}
          <group position={[1.6, 0, 0]}>
            {/* `presenting` flips true whenever Kelion is speaking an answer
                — that's when we have (or will have) content on the monitor
                and want the body to rotate ~8° toward it. When we wire the
                tool-use pipeline, this will be driven by an explicit
                "content on monitor" signal instead. */}
            <AvatarModel
              mouthOpen={mouthOpen}
              status={status}
              emotion={emotion}
              // Adrian: "avatarul nu priveste catre user" — previously the
              // body yawed ~8° toward the on-stage monitor whenever Kelion
              // spoke, which left the avatar glancing away from the webcam.
              // We always face the user now; hand gestures still fire while
              // speaking (see AvatarModel below where we key them off
              // status === 'speaking').
              presenting={false}
            />
          </group>
          <ContactShadows position={[1.6, -1.65, 0]} opacity={0.55} scale={5} blur={2.6} far={2.5} />
        </Suspense>
      </Canvas>

      {/* Half-page monitor overlay — when Kelion calls show_on_monitor (map /
          video / image / wiki / web), the content is rendered here as a 2D
          panel covering the LEFT half of the viewport on desktop (bottom
          sheet on mobile). Adrian: "inlocuirea monitorului cu jumate de
          pagina … avatarul pe dreapta". The small 3D monitor in the scene
          stays as decor. */}
      <MonitorOverlay />

      <audio ref={audioRef} autoPlay playsInline />

      {/* Last assistant text reply (when chatting by typing) — fades
          above the input bar. Only the latest assistant message shows
          so we don't clutter the stage. The bubble auto-hides 8s after
          the reply finishes (kept in history/transcript). */}
      {chatMessages.length > 0 && bubbleVisible && (() => {
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

      {/* Live voice chat bubble — mirrors the text-chat bubble above but
          reads from `turns` (populated by useGeminiLive from the Gemini Live
          inputTranscription / outputTranscription stream). Adrian: "logat
          vocea e cea corecta dar nu e chat live, nu afiseaza absolut nimic
          pe ecran". Previously the turns only rendered inside the transcript
          panel (closed by default) — so live voice users heard Kelion but
          saw nothing. This bubble shows the last user utterance + the
          streaming assistant reply while a voice session is active. It is
          hidden when the text-chat bubble is shown to avoid two overlapping
          panels. */}
      {status !== 'idle' && status !== 'error' && turns.length > 0 && !(chatMessages.length > 0 && bubbleVisible) && (() => {
        const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
        const lastUser = [...turns].reverse().find((t) => t.role === 'user')
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
              zIndex: 4,
            }}
          >
            {lastUser && lastUser.text && (
              <div style={{
                alignSelf: 'flex-end', maxWidth: '88%',
                padding: '8px 12px', borderRadius: 12,
                background: 'rgba(124, 58, 237, 0.25)',
                border: '1px solid rgba(167, 139, 250, 0.3)',
                fontSize: 13,
              }}>{lastUser.text}</div>
            )}
            {lastAssistant && lastAssistant.text && (
              <div style={{
                alignSelf: 'flex-start', maxWidth: '92%',
                padding: '8px 12px', borderRadius: 12,
                background: 'rgba(167, 139, 250, 0.08)',
                border: '1px solid rgba(167, 139, 250, 0.18)',
                whiteSpace: 'pre-wrap',
              }}>{lastAssistant.text}</div>
            )}
            {!lastAssistant && status === 'thinking' && (
              <div style={{
                alignSelf: 'flex-start', fontSize: 13, opacity: 0.7,
                padding: '8px 12px',
              }}>Kelion is thinking…</div>
            )}
            {!lastUser && !lastAssistant && status === 'listening' && (
              <div style={{
                alignSelf: 'center', fontSize: 13, opacity: 0.7,
                padding: '8px 12px',
              }}>Listening…</div>
            )}
          </div>
        )
      })()}

      {/* Text chat composer — bottom center, above the status pill.
          Narrower (420px) than the old 680px because the wider pill was
          overlapping the stage monitor on the left. Stops click
          propagation so typing doesn't toggle the voice session.
          Submit with Enter or the send button. */}
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); sendTextMessage() }}
        style={{
          position: 'absolute',
          bottom: 'calc(max(32px, env(safe-area-inset-bottom)) + 54px)',
          left: '50%', transform: 'translateX(-50%)',
          width: 'min(420px, 92vw)',
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 8px 6px 14px',
          borderRadius: 999,
          background: 'rgba(10, 8, 20, 0.72)',
          backdropFilter: 'blur(14px)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
          zIndex: 5,
        }}
      >
        {/* F2 — hidden native file picker driving the "+" button below.
            Accepts images, PDFs and text files. The selected file shows
            as a dismissible pill and its filename + size land in the
            outgoing message as a bracketed note. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf,text/plain,.txt,.md,.csv,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files && e.target.files[0]
            if (f) setAttachedFile(f)
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          disabled={chatBusy}
          style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'rgba(167, 139, 250, 0.18)',
            border: '1px solid rgba(167, 139, 250, 0.3)',
            color: '#ede9fe',
            cursor: chatBusy ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, lineHeight: 1, flexShrink: 0, padding: 0,
          }}
          title="Attach file"
          aria-label="Attach file"
        >+</button>
        {attachedFile && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '3px 8px',
            borderRadius: 999,
            background: 'rgba(124, 58, 237, 0.22)',
            border: '1px solid rgba(167, 139, 250, 0.35)',
            color: '#ede9fe', fontSize: 11,
            maxWidth: 130, overflow: 'hidden',
            whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            flexShrink: 0,
          }} title={attachedFile.name}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              📎 {attachedFile.name}
            </span>
            <button
              type="button"
              onClick={() => {
                setAttachedFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              style={{
                background: 'transparent', border: 'none',
                color: '#ede9fe', cursor: 'pointer', padding: '0 2px',
                fontSize: 13, lineHeight: 1,
              }}
              aria-label="Remove attachment"
              title="Remove attachment"
            >×</button>
          </div>
        )}
        <input
          type="text"
          value={chatInput}
          onChange={(e) => setChatInput(e.target.value)}
          // Explicit paste handler — Adrian 2026-04-20: "trebuie sa
          // pot face paste la orice in tab de scris". On some
          // Capacitor / WebView builds (and occasionally on Chrome
          // when a focused 3D canvas sibling intercepts the keyboard
          // shortcut), the native `input` event from Ctrl+V never
          // fires and the input stays empty. We read the clipboard
          // directly from the event, splice it into the current
          // value at the caret position, and call setState so React
          // renders the new text. `preventDefault` blocks any
          // duplicate insertion from the browser's default handler.
          // Right-click → Paste from the browser menu also fires
          // this event, so both paths work.
          onPaste={(e) => {
            try {
              const text = (e.clipboardData || window.clipboardData)?.getData('text')
              if (text == null || text === '') return
              e.preventDefault()
              const el = e.currentTarget
              const start = typeof el.selectionStart === 'number' ? el.selectionStart : chatInput.length
              const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : chatInput.length
              const next = chatInput.slice(0, start) + text + chatInput.slice(end)
              setChatInput(next)
              // Restore caret right after the pasted text so the user
              // can keep typing without clicking again.
              requestAnimationFrame(() => {
                try { el.setSelectionRange(start + text.length, start + text.length) } catch (_) { /* ignore */ }
              })
            } catch (_) {
              // If anything goes wrong, fall back to the browser's
              // default paste handler so we never make things worse
              // than before.
            }
          }}
          placeholder="Type to Kelion…"
          disabled={chatBusy}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={{
            flex: 1,
            background: 'transparent', border: 'none', outline: 'none',
            color: '#ede9fe',
            fontSize: 15, fontFamily: 'system-ui, -apple-system, sans-serif',
            padding: '8px 2px',
            // Allow text selection / right-click menu on the input
            // itself even though the surrounding stage uses
            // `user-select: none`. Without this, some Chromium
            // builds disable the clipboard context menu on nested
            // inputs.
            userSelect: 'text',
            WebkitUserSelect: 'text',
          }}
        />
        <button
          type="submit"
          disabled={chatBusy || (chatInput.trim().length === 0 && !attachedFile)}
          style={{
            width: 40, height: 40, borderRadius: '50%',
            background: (chatInput.trim().length === 0 && !attachedFile)
              ? 'rgba(167, 139, 250, 0.18)'
              : 'linear-gradient(135deg, #7c3aed, #a78bfa)',
            border: 'none', color: '#fff',
            cursor: chatBusy || (chatInput.trim().length === 0 && !attachedFile) ? 'default' : 'pointer',
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

      {/* Guest trial countdown — Adrian: "timer se afiseaza dreapta sus
          vizibil". Renders top-right, above the action bar, only while
          the server reports `applicable: true` (guests only — signed-in
          and admin users never see it). Shows MM:SS once the 15-min
          window is stamped (first gated interaction); before that it
          shows "15:00 free" as a preview. When exhausted it turns red
          and prompts sign-in. */}
      {trialHud.applicable && trialHud.loaded && !authState.signedIn && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(max(18px, env(safe-area-inset-top)) + 62px)',
            right: 18,
            padding: '8px 14px',
            borderRadius: 999,
            background: 'rgba(10, 8, 20, 0.72)',
            backdropFilter: 'blur(12px)',
            border: !trialHud.allowed
              ? '1px solid rgba(239, 68, 68, 0.6)'
              : trialHud.stamped
                ? '1px solid rgba(167, 139, 250, 0.55)'
                : '1px solid rgba(167, 139, 250, 0.3)',
            color: !trialHud.allowed ? '#fecaca' : '#e9d5ff',
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 600,
            letterSpacing: '0.03em',
            zIndex: 25,
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
          }}
          role="status"
          aria-live="polite"
          title={trialHud.stamped
            ? 'Free trial is counting down. Sign in or buy credits to keep using Kelion after it expires.'
            : '15 free minutes — the timer starts on your first message or Tap-to-talk.'}
        >
          <span aria-hidden style={{ fontSize: 13 }}>⏱</span>
          {!trialHud.allowed ? (
            <>Free trial used up — <button
              onClick={() => setSignInModalOpen(true)}
              style={{
                background: 'transparent', border: 'none',
                color: '#fca5a5', textDecoration: 'underline',
                cursor: 'pointer', padding: 0, font: 'inherit',
              }}
            >sign in</button></>
          ) : (
            <>Free trial · {Math.floor(trialRemainingMs / 60000)}:{String(Math.floor((trialRemainingMs % 60000) / 1000)).padStart(2, '0')} left</>
          )}
        </div>
      )}

      {/* Top-right action bar — Adrian: "panoul cu butoane e gândit
          greșit". Simplified to: Credits/Admin pill + Sign in/out + ⋯.
          Camera, screen, transcript, contact all moved into the ⋯
          overflow menu. Camera also now auto-starts when the user types
          or speaks and auto-stops after idle (F15). */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 18, right: 18, zIndex: 20,
          display: 'flex', alignItems: 'center', gap: 8,
        }}
      >
        {/* Plan C — voice-transport selection. Previously surfaced as a
            "🎙️ GPT / Gem" pill next to the Credits chip so the active
            provider could be flipped without DevTools. Adrian's feedback
            ("de ce am 2 butoane de mic ... poate face functia asta dar
            in spate automat, fara user sa vada, el vede doar butonul de
            jos, de mic") asked for a single visible mic — the provider
            swap is now done automatically on terminal failure (see the
            auto-fallback effect where `liveProvider` is declared) and
            persisted in localStorage so the next session starts on the
            provider that last worked. Keyboard-quiet. */}
        {/* Credits pill — hidden for admins (they have unlimited access and
            no billing; showing "0 min" confused Adrian in testing). For
            regular signed-in users we still show balance + open the Stripe
            Checkout flow on click. */}
        {authState.signedIn && !isAdmin && (
          <button
            onClick={() => openBuy()}
            style={{
              height: 36, padding: '0 12px', borderRadius: 999,
              background: 'rgba(10, 8, 20, 0.5)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(167, 139, 250, 0.25)',
              color: '#ede9fe', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
            title="Buy credits"
            aria-label="Buy credits"
          >
            <span style={{ fontSize: 14 }}>💳</span>
            {/* Adrian: "creditul nu trebuie sa arate minute, trebuie sa fie
                o unitate x credite". 1 credit = 1 min of Kelion Live kept
                internally (backend still tracks balance_minutes), but the
                UI shows the neutral unit label so users think in "credits"
                not "minutes". */}
            <span>Credits{balance != null ? ` · ${balance}` : ''}</span>
          </button>
        )}
        {/* Unlimited pill — admin-only, replaces Credits pill. Visual cue
            that the current account is not gated. Click opens the business
            metrics overlay, same as the overflow menu entry. */}
        {authState.signedIn && isAdmin && (
          <button
            onClick={() => switchAdminTab('business')}
            style={{
              height: 36, padding: '0 12px', borderRadius: 999,
              background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.18), rgba(167, 139, 250, 0.18))',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(250, 204, 21, 0.45)',
              color: '#fef3c7', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontWeight: 600,
            }}
            title="Admin dashboard — Business, AI credits, Visitors, Users, Payouts"
            aria-label="Open admin dashboard"
          >
            <span style={{ fontSize: 14 }}>🛡️</span>
            <span>Admin · ∞</span>
          </button>
        )}
        <button
          onClick={() => {
            if (authState.signedIn) {
              handleSignOut()
            } else {
              // Full sign-in modal: email+password first, Google SSO, passkey
              // as a 1-tap alternative. Admins who need to log in with
              // credentials land here directly instead of bouncing off the
              // passkey-only prompt.
              setSignInModalOpen(true)
            }
          }}
          style={{
            height: 36, padding: '0 14px', borderRadius: 999,
            background: authState.signedIn
              ? 'rgba(239, 68, 68, 0.18)'
              : 'linear-gradient(135deg, #a78bfa, #60a5fa)',
            border: authState.signedIn
              ? '1px solid rgba(239, 68, 68, 0.45)'
              : '1px solid rgba(167, 139, 250, 0.5)',
            color: authState.signedIn ? '#fecaca' : '#0b0716',
            fontSize: 12, fontWeight: 600, letterSpacing: '0.03em',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
          title={authState.signedIn ? 'Sign out' : 'Sign in'}
          aria-label={authState.signedIn ? 'Sign out' : 'Sign in'}
        >
          {authState.signedIn
            ? `Sign out${authState.user?.name ? ` · ${authState.user.name}` : ''}`
            : 'Sign in'}
        </button>
        <TopBarIconButton
          onClick={() => setMenuOpen((v) => !v)}
          active={menuOpen}
          title="More"
          ariaLabel="More options"
        >⋯</TopBarIconButton>
      </div>

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
          {/* Camera / Screen share / Transcript — tools moved back into
              the overflow menu so the top bar stays clean (Adrian: "panoul
              e gândit greșit"). Camera also now auto-starts on speech/
              typing, so the explicit toggle here is for manual override. */}
          <div
            style={{
              padding: '6px 10px 4px',
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: 'rgba(237,233,254,0.45)',
            }}
          >
            Tools
          </div>
          <MenuItem onClick={() => {
            if (cameraStream) { stopCamera() }
            else { startCamera().catch(() => { /* banner surfaces the error */ }) }
            setMenuOpen(false)
          }}>
            {cameraStream ? '📹 Turn camera off' : '📹 Turn camera on'}
          </MenuItem>
          <MenuItem onClick={() => { screenStream ? stopScreen() : startScreen(); setMenuOpen(false) }}>
            {screenStream ? '🖥️ Stop sharing screen' : '🖥️ Share screen'}
          </MenuItem>
          <MenuItem onClick={() => { setTranscriptOpen((v) => !v); setMenuOpen(false) }}>
            {transcriptOpen ? '📝 Hide transcript' : '📝 Show transcript'}
          </MenuItem>
          <MenuItem onClick={() => { navigate('/contact'); setMenuOpen(false) }}>
            ✉️ Contact us
          </MenuItem>
          <div
            style={{
              height: 1,
              background: 'rgba(167, 139, 250, 0.15)',
              margin: '6px 8px',
            }}
          />
          {/* Stage 6 — voice style submenu */}
          <div
            style={{
              padding: '6px 10px 4px',
              fontSize: 11,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              color: 'rgba(237,233,254,0.45)',
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
          {/* Conversation history — works for guests (localStorage)
              and signed-in users (server). Above the auth gate so guests
              can find their saved threads too. */}
          <MenuItem onClick={() => { setHistoryOpen(true); setMenuOpen(false) }}>
            Conversation history
          </MenuItem>
          <MenuItem onClick={() => { handleNewChat(); setMenuOpen(false) }}>
            New chat
          </MenuItem>
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
              {/* Buy credits moved to the top-right action bar. */}
              {/* PWA install — only shows when the browser actually
                  fired beforeinstallprompt (Chrome/Edge/Android). iOS
                  users get instructions inside the Buy-credits modal. */}
              {!installed && installPromptEvent && (
                <MenuItem onClick={() => { handleInstall(); setMenuOpen(false) }}>
                  Install Kelion on this device
                </MenuItem>
              )}
              {/* Admin-only — unified dashboard. One entry that opens the
                  admin shell with tabs for Business, AI credits, Visitors,
                  Users, and Payouts. Replaces the three separate menu
                  entries that used to live here (2026-04-20 Adrian:
                  "management de admin integrat intr-un singur buton"). */}
              {isAdmin && (
                <MenuItem onClick={() => { switchAdminTab('business'); setMenuOpen(false) }}>
                  Admin dashboard
                </MenuItem>
              )}
              {/* Sign out moved to the top-right action bar. */}
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
          <div
            style={{
              height: 1,
              background: 'rgba(167, 139, 250, 0.15)',
              margin: '6px 8px',
            }}
          />
          {/* Contact duplicated in the Tools section above. */}
        </div>
      )}

      {/* Contact moved to the top-bar as an icon (✉️) per Adrian's
          request — the old bottom-strip was cluttering the stage. The
          menu entry now routes via react-router `navigate('/contact')`
          so the SPA stays mounted and auth state survives the browser
          back button. */}

      {/* F17 — camera self-view removed from the page per Adrian's request:
          "am cerut sa nu fie vizibila informatia pe pagina". The camera
          stream still runs (frames feed the vision pipeline for Kelion),
          but there is no visible preview thumbnail. We still mount a
          hidden <video> element so the MediaStream attachment lifecycle
          (srcObject assignment + play() trigger) works the same way it
          did with a visible preview — some browsers stall the track if
          no element ever consumes the stream. Hidden via display:none. */}
      {cameraStream && (
        <video
          ref={cameraVideoRef}
          autoPlay
          muted
          playsInline
          style={{ display: 'none' }}
        />
      )}

      {/* Screen share indicator — Kelion is watching your screen (M10) */}
      {screenStream && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 18, left: 18,
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

      {/* Transcript drawer — opt-in, has X + backdrop + ESC to close.
          Previously the only way to close it was to re-open the ⋯ menu
          and pick "Hide transcript", which was not discoverable. */}
      {transcriptOpen && (
        <div
          onClick={() => setTranscriptOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 23,
          }}
        />
      )}
      {transcriptOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(420px, 92vw)',
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
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>TRANSCRIPT</div>
            <button
              onClick={() => setTranscriptOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close transcript"
            >✕</button>
          </div>
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

      {/* Full sign-in modal — triggered by the top-bar Sign in button.
          Email+password primary, Google SSO, passkey as 1-tap. */}
      <SignInModal
        open={signInModalOpen}
        onClose={() => setSignInModalOpen(false)}
        passkeySupported={supportsPasskey()}
        onAuthenticated={async (user, token) => {
          // Login succeeded. Stash the JWT in memory so subsequent calls
          // (chat, TTS, etc.) can fall back to Bearer-header auth if the
          // httpOnly cookie doesn't make it back (adblockers / privacy
          // extensions / Safari ITP). The server's requireAuth middleware
          // accepts either the header or the cookie.
          if (token) authTokenRef.current = token
          // Re-fetch /api/auth/passkey/me so we get the canonical
          // { isAdmin } flag computed server-side (covers the admin email
          // allow-list). Fall back to the raw response if the probe fails
          // — at worst the admin-only UI pieces won't render until next
          // reload.
          setSignInModalOpen(false)
          try {
            const me = await fetchMe()
            if (me && me.signedIn) {
              setAuthState({ signedIn: true, user: me.user || user || null })
              return
            }
          } catch (_) { /* ignore */ }
          setAuthState({ signedIn: true, user: user || null })
        }}
        onUsePasskey={async () => {
          // Reuse the existing WebAuthn flow. Close the modal first so the
          // OS-level passkey sheet appears in front.
          setSignInModalOpen(false)
          try {
            const res = await authenticateWithPasskey()
            setAuthState({ signedIn: true, user: res.user })
          } catch (err) {
            // Re-open with the error surfaced — but the modal has its own
            // state now, so just log; user can retry.
            console.warn('[passkey auth]', err && err.message)
          }
        }}
      />

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
          onClick={() => setMemoryOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 23,
          }}
        />
      )}
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

      {/* Conversation history drawer — lists saved threads for both
          guests (localStorage) and signed-in users (server). Clicking a
          row replays that transcript into the chat log. */}
      {historyOpen && (
        <div
          onClick={() => setHistoryOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 23,
          }}
        />
      )}
      {historyOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(460px, 94vw)',
            background: 'rgba(10, 8, 20, 0.82)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 20px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 24,
            color: '#ede9fe',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 14,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              CONVERSATION HISTORY
            </div>
            <button
              onClick={() => setHistoryOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >✕</button>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={handleNewChat}
              style={{
                padding: '8px 12px', borderRadius: 10,
                background: 'rgba(167, 139, 250, 0.18)',
                border: '1px solid rgba(167, 139, 250, 0.35)',
                color: '#ede9fe', cursor: 'pointer', fontSize: 13,
              }}
            >+ New chat</button>
            <button
              onClick={refreshHistory}
              style={{
                padding: '8px 12px', borderRadius: 10,
                background: 'transparent',
                border: '1px solid rgba(167, 139, 250, 0.25)',
                color: '#ede9fe', cursor: 'pointer', fontSize: 13, opacity: 0.85,
              }}
            >Refresh</button>
          </div>

          {!authState.signedIn && (
            <div style={{
              marginBottom: 12, padding: '8px 12px', borderRadius: 10,
              background: 'rgba(250, 204, 21, 0.08)',
              border: '1px solid rgba(250, 204, 21, 0.25)',
              fontSize: 12, lineHeight: 1.5, opacity: 0.9,
            }}>
              Signed-out — history is saved locally on this browser only. Sign in
              to keep it across devices.
            </div>
          )}

          {historyLoading && (
            <div style={{ opacity: 0.5, fontSize: 14 }}>Loading…</div>
          )}
          {historyError && (
            <div style={{
              marginBottom: 10, padding: '8px 12px', borderRadius: 10,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#fecaca', fontSize: 13,
            }}>{historyError}</div>
          )}
          {!historyLoading && historyItems.length === 0 && !historyError && (
            <div style={{ opacity: 0.55, fontSize: 14, lineHeight: 1.5 }}>
              No saved conversations yet. Your chat will be saved here
              automatically as you talk.
            </div>
          )}
          {historyItems.map((c) => {
            const ts = c.updated_at ? new Date(c.updated_at) : null
            const tsLabel = ts && !Number.isNaN(ts.getTime())
              ? ts.toLocaleString()
              : ''
            return (
              <div
                key={c.id}
                style={{
                  marginBottom: 10, padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(167, 139, 250, 0.08)',
                  borderLeft: '2px solid #a78bfa',
                  fontSize: 14, lineHeight: 1.45,
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                }}
              >
                <button
                  onClick={() => handleLoadHistory(c.id)}
                  style={{
                    flex: 1, textAlign: 'left', background: 'transparent',
                    border: 'none', color: '#ede9fe', cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  <div style={{ fontWeight: 500, marginBottom: 2 }}>
                    {c.title || '(untitled)'}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.55 }}>
                    {c.message_count} {c.message_count === 1 ? 'message' : 'messages'}
                    {tsLabel ? ` · ${tsLabel}` : ''}
                  </div>
                </button>
                <button
                  onClick={() => handleDeleteHistory(c.id)}
                  style={{
                    background: 'transparent',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#fecaca', cursor: 'pointer', fontSize: 12,
                    padding: '4px 8px', borderRadius: 8,
                  }}
                  aria-label="Delete conversation"
                >Delete</button>
              </div>
            )
          })}
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
                Current balance: <strong>{balance} credits</strong>
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
                const amount = (pkg.priceCents / 100).toFixed(2).replace(/\.00$/, '')
                const perCredit = (pkg.priceCents / 100 / pkg.minutes).toFixed(2)
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
                      <div style={{ fontSize: 18, fontWeight: 700 }}>£{amount}</div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      {pkg.minutes} credits · £{perCredit}/credit
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
              You'll be redirected to Stripe's secure checkout.
              Credits never expire.
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
          onClick={() => setBusinessOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
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
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · BUSINESS — LAST 30 DAYS
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
          <AdminTabBar active="business" onSelect={switchAdminTab} />

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
            const revenueGbp = (businessData.ledger.revenueCents / 100).toFixed(2)
            // 50/50 split: half goes to AI vendors, half to us. This is a
            // gross estimate — actual AI spend is visible on the provider
            // cards. Stripe/tax fees will trim our half ~3%.
            const platformEstGbp = (businessData.ledger.revenueCents / 200).toFixed(2)
            const minutesSold = businessData.ledger.minutesSold
            const minutesConsumed = businessData.ledger.minutesConsumed
            const topups = businessData.ledger.topups
            const rows = [
              { label: 'Credit top-ups', value: topups, hint: 'Stripe Checkout sessions completed' },
              { label: 'Gross revenue', value: `£${revenueGbp}`, hint: 'Sum of paid Stripe sessions' },
              { label: 'Minutes sold', value: `${minutesSold} min`, hint: 'Credits granted to users' },
              { label: 'Minutes consumed', value: `${minutesConsumed} min`, hint: 'Live conversation time used' },
              { label: 'Platform share (est.)', value: `£${platformEstGbp}`, hint: '50% of gross, before Stripe fees' },
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
          onClick={() => setCreditsOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
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
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · AI CREDITS
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
          <AdminTabBar active="ai" onSelect={switchAdminTab} />

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

          {/* Revenue-split panel — shows how much of the last 30 days of
              top-up revenue is earmarked for AI provider spend vs owner
              net, and compares against the known portion of that spend
              (ElevenLabs via API; Gemini is manual). Renders above the
              provider cards so the admin sees the budget context first.
              */}
          {revenueSplitLoading && (
            <div style={{
              marginBottom: 16, padding: '12px 14px',
              borderRadius: 12, border: '1px solid rgba(167, 139, 250, 0.25)',
              background: 'rgba(167, 139, 250, 0.05)',
              fontSize: 12, opacity: 0.6,
            }}>Computing revenue split…</div>
          )}
          {!revenueSplitLoading && revenueSplitError && (
            <div style={{
              marginBottom: 16, padding: '10px 12px',
              borderRadius: 10, background: 'rgba(80, 14, 14, 0.6)',
              color: '#fecaca', fontSize: 12,
            }}>Revenue split: {revenueSplitError}</div>
          )}
          {!revenueSplitLoading && revenueSplit && (() => {
            const pct = Math.round((revenueSplit.fraction || 0.5) * 100)
            const deltaStatus = revenueSplit.delta?.status || 'ok'
            const deltaPalette = {
              ok:   { bg: 'rgba(34, 197, 94, 0.10)',  border: 'rgba(34, 197, 94, 0.45)',  text: '#bbf7d0' },
              warn: { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.5)',  text: '#fde68a' },
              over: { bg: 'rgba(239, 68, 68, 0.12)',  border: 'rgba(239, 68, 68, 0.55)',  text: '#fecaca' },
            }[deltaStatus] || { bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.4)', text: '#cbd5e1' }
            const row = (label, value, opts = {}) => (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                gap: 10, padding: '4px 0',
                fontSize: 13,
                opacity: opts.dim ? 0.7 : 1,
                fontWeight: opts.bold ? 600 : 400,
              }}>
                <span style={{ opacity: 0.75 }}>{label}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: opts.color }}>
                  {value}
                </span>
              </div>
            )
            return (
              <div style={{
                marginBottom: 18,
                padding: '14px 16px',
                borderRadius: 14,
                background: 'rgba(167, 139, 250, 0.06)',
                border: '1px solid rgba(167, 139, 250, 0.25)',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 8,
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Revenue split ({pct}% → AI)</div>
                  <span style={{
                    fontSize: 10, letterSpacing: '0.1em', fontWeight: 600,
                    padding: '3px 8px', borderRadius: 999,
                    background: deltaPalette.bg,
                    color: deltaPalette.text,
                    border: `1px solid ${deltaPalette.border}`,
                  }}>
                    {deltaStatus === 'ok' ? 'IN BUDGET'
                      : deltaStatus === 'warn' ? '80% USED'
                      : 'OVER BUDGET'}
                  </span>
                </div>
                <div style={{ fontSize: 11, opacity: 0.55, marginBottom: 10 }}>
                  Last {revenueSplit.window?.days ?? 30} days · {revenueSplit.revenue?.topups ?? 0} top-ups
                </div>
                {row('Gross revenue', revenueSplit.revenue?.grossDisplay || '—', { bold: true })}
                {row(`AI allocation (${pct}%)`, revenueSplit.allocation?.display || '—', { color: '#c4b5fd' })}
                {row('Owner net', revenueSplit.allocation?.ownerDisplay || '—', { dim: true })}
                <div style={{
                  height: 1, background: 'rgba(167, 139, 250, 0.2)',
                  margin: '8px 0',
                }} />
                <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Known AI spend (auto-measured):</div>
                {row('  ElevenLabs (est.)',
                  revenueSplit.spend?.elevenlabs?.configured
                    ? (revenueSplit.spend?.elevenlabs?.estSpendDisplay || '—')
                    : 'not configured',
                  { dim: true })}
                {row('  Gemini',
                  'manual — open GCP Billing',
                  { dim: true })}
                <div style={{
                  height: 1, background: 'rgba(167, 139, 250, 0.2)',
                  margin: '8px 0',
                }} />
                {row('Remaining AI budget',
                  revenueSplit.delta?.display || '—',
                  { bold: true, color: deltaPalette.text })}
                <a
                  href="https://console.cloud.google.com/billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-block',
                    marginTop: 10,
                    fontSize: 11,
                    color: '#c4b5fd',
                    textDecoration: 'none',
                    opacity: 0.8,
                  }}
                >
                  Open GCP Billing dashboard →
                </a>
              </div>
            )
          })()}

          {/* ───── Grant Credits — refund / comp / promo. Hits
               POST /api/admin/credits/grant. Added on 2026-04-20 so
               Adrian can refund the 33 credits lost by
               contact@kelionai.app in the charge-on-open incident
               without dropping into the browser console. Negative
               minutes = clawback. Every submission creates an
               admin_grant row in the ledger tagged with the admin's
               email for audit. ───── */}
          <div style={{
            marginBottom: 16, padding: 14,
            borderRadius: 14,
            background: 'rgba(34, 197, 94, 0.06)',
            border: '1px solid rgba(34, 197, 94, 0.28)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              Grant credits
            </div>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 10 }}>
              Refund, comp or clawback. Minutes = credits (1 min = 1 credit). Negative = remove.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="email"
                placeholder="user email (e.g. contact@kelionai.app)"
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                disabled={grantBusy}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.12)',
                  background: 'rgba(0,0,0,0.28)',
                  color: '#f8fafc',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  placeholder="minutes (e.g. 33)"
                  value={grantMinutes}
                  onChange={(e) => setGrantMinutes(e.target.value)}
                  disabled={grantBusy}
                  style={{
                    flex: '0 0 120px',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(0,0,0,0.28)',
                    color: '#f8fafc',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
                <input
                  type="text"
                  placeholder="note (optional — visible in ledger)"
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  disabled={grantBusy}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(0,0,0,0.28)',
                    color: '#f8fafc',
                    fontSize: 13,
                    outline: 'none',
                  }}
                />
              </div>
              <button
                type="button"
                onClick={doGrant}
                disabled={grantBusy || !grantEmail.trim() || !grantMinutes}
                style={{
                  padding: '9px 14px',
                  borderRadius: 8,
                  border: '1px solid rgba(34,197,94,0.5)',
                  background: grantBusy ? 'rgba(34,197,94,0.15)' : 'rgba(34,197,94,0.25)',
                  color: '#ecfdf5',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: grantBusy ? 'progress' : 'pointer',
                  opacity: (grantBusy || !grantEmail.trim() || !grantMinutes) ? 0.55 : 1,
                }}
              >
                {grantBusy ? 'Granting…' : 'Grant'}
              </button>
              {grantMessage && (
                <div style={{
                  fontSize: 12,
                  padding: '7px 10px',
                  borderRadius: 8,
                  background: grantMessage.ok
                    ? 'rgba(34, 197, 94, 0.12)'
                    : 'rgba(239, 68, 68, 0.12)',
                  color: grantMessage.ok ? '#bbf7d0' : '#fecaca',
                  border: `1px solid ${grantMessage.ok ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
                }}>
                  {grantMessage.text}
                </div>
              )}
            </div>
          </div>

          {/* ───── Live Usage — Adrian: "analiza pe consum credite in timp
               real permanent la toti userii". Flat feed of the most
               recent ledger entries across every user, auto-refreshed
               every 5 s. Added after the 2026-04-20 charge-on-open
               incident so consumption is now observable the moment it
               happens, not post-mortem. ───── */}
          <div style={{
            marginBottom: 16, padding: 14,
            borderRadius: 14,
            background: 'rgba(167, 139, 250, 0.05)',
            border: '1px solid rgba(167, 139, 250, 0.22)',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: 8,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: 0.1 }}>
                Live Usage
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 10, opacity: 0.65,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#22c55e',
                  boxShadow: '0 0 6px rgba(34,197,94,0.9)',
                }} />
                auto-refresh 5 s
              </div>
            </div>
            {ledgerError && (
              <div style={{
                fontSize: 11, color: '#fca5a5',
                padding: '6px 10px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: 8,
                marginBottom: 8,
              }}>{ledgerError}</div>
            )}
            {ledgerLoading && ledgerRows.length === 0 && (
              <div style={{ fontSize: 12, opacity: 0.5 }}>Loading ledger…</div>
            )}
            {!ledgerLoading && ledgerRows.length === 0 && !ledgerError && (
              <div style={{ fontSize: 12, opacity: 0.5 }}>No transactions yet.</div>
            )}
            {ledgerRows.length > 0 && (() => {
              // Abuse heuristic: flag any user who burned >5 credits
              // in the last 5 minutes via plain consumption. Clean
              // finish-of-session is 1 credit / 60 s, so >5/5 min
              // means either a bug or tampering — exactly the fraud
              // path that hit user Kelion on 2026-04-20.
              const now = Date.now()
              const windowMs = 5 * 60 * 1000
              const byUser = new Map()
              for (const row of ledgerRows) {
                if (row.kind !== 'consumption') continue
                const ts = row.created_at ? Date.parse(row.created_at) : 0
                if (!ts || now - ts > windowMs) continue
                const key = row.user_email || `user-${row.user_id}`
                const agg = byUser.get(key) || { drained: 0, last: 0 }
                agg.drained += Math.abs(Number(row.delta_minutes) || 0)
                if (ts > agg.last) agg.last = ts
                byUser.set(key, agg)
              }
              const suspects = [...byUser.entries()]
                .filter(([, v]) => v.drained > 5)
                .sort((a, b) => b[1].drained - a[1].drained)
              return (
                <>
                  {suspects.length > 0 && (
                    <div style={{
                      padding: '8px 10px', marginBottom: 10,
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.12)',
                      border: '1px solid rgba(239, 68, 68, 0.5)',
                      color: '#fecaca',
                      fontSize: 12,
                    }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        ⚠ Abnormal drain in last 5 min
                      </div>
                      {suspects.slice(0, 3).map(([who, v]) => (
                        <div key={who} style={{ opacity: 0.9 }}>
                          {who} — {v.drained} credits
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{
                    maxHeight: 220, overflowY: 'auto',
                    borderRadius: 8,
                    background: 'rgba(0, 0, 0, 0.22)',
                  }}>
                    {ledgerRows.slice(0, 30).map((row) => {
                      const delta = Number(row.delta_minutes) || 0
                      const positive = delta > 0
                      const color = positive
                        ? '#bbf7d0'
                        : row.kind === 'admin_grant'
                          ? '#c4b5fd'
                          : '#fecaca'
                      const ts = row.created_at ? new Date(row.created_at) : null
                      const tsLabel = ts
                        ? `${ts.getHours().toString().padStart(2, '0')}:${ts.getMinutes().toString().padStart(2, '0')}:${ts.getSeconds().toString().padStart(2, '0')}`
                        : ''
                      return (
                        <div key={row.id} style={{
                          display: 'grid',
                          gridTemplateColumns: '60px 1fr 70px 60px',
                          gap: 8, alignItems: 'center',
                          padding: '6px 10px',
                          fontSize: 11,
                          borderBottom: '1px solid rgba(167, 139, 250, 0.08)',
                        }}>
                          <span style={{ opacity: 0.55, fontFamily: 'monospace' }}>{tsLabel}</span>
                          <span style={{ opacity: 0.85, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.user_email || `user-${row.user_id}`}
                          </span>
                          <span style={{ opacity: 0.65, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.05 }}>
                            {row.kind}
                          </span>
                          <span style={{ color, fontWeight: 600, textAlign: 'right', fontFamily: 'monospace' }}>
                            {positive ? '+' : ''}{delta}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )
            })()}
          </div>

          {/* PR E2 — auto-topup info strip. Shows the admin at a glance
              whether the saved card is wired, what threshold triggers
              a refill, and when we last ran. Sits above the provider
              cards so the friendly copy on each card is consistent
              with the refill policy. */}
          {!creditsLoading && autoTopupStatus && (() => {
            const s = autoTopupStatus
            const armed = s.configured && s.enabled
            const tone = armed
              ? { bg: 'rgba(34, 197, 94, 0.08)', border: 'rgba(34, 197, 94, 0.35)', text: '#bbf7d0' }
              : { bg: 'rgba(245, 158, 11, 0.08)', border: 'rgba(245, 158, 11, 0.35)', text: '#fde68a' }
            const thresholdPct = Math.round((s.threshold || 0.2) * 100)
            const lastRunLabel = (() => {
              const hist = s.history || {}
              const entries = Object.entries(hist)
              if (entries.length === 0) return null
              const latest = entries.reduce((a, b) => ((a[1]?.ts || 0) > (b[1]?.ts || 0) ? a : b))
              const [id, e] = latest
              if (!e || !e.ts) return null
              const when = new Date(e.ts).toLocaleString()
              if (e.status === 'ok') {
                return `Ultima reîncărcare: ${id} · ${e.amountEur} ${String(e.currency || 'eur').toUpperCase()} · ${when}`
              }
              return `Ultima încercare: ${id} · eșuată (${e.error || 'eroare necunoscută'}) · ${when}`
            })()
            return (
              <div style={{
                marginBottom: 14, padding: '12px 14px',
                borderRadius: 12,
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                color: tone.text,
                fontSize: 13, lineHeight: 1.5,
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {armed
                    ? `Auto-topup armat — sub ${thresholdPct}% cardul tău Stripe e taxat cu ${s.amountEur} ${String(s.currency || 'eur').toUpperCase()}.`
                    : 'Auto-topup inactiv — leagă un card salvat în Stripe ca să activezi.'}
                </div>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  {armed
                    ? `Verificăm la fiecare deschidere a panoului. Cooldown ${s.cooldownHours || 24}h ca să nu se încarce de două ori. Primim email de confirmare sau eroare.`
                    : 'Setează OWNER_STRIPE_CUSTOMER_ID + OWNER_STRIPE_PAYMENT_METHOD_ID în Railway, apoi refresh. Cardul îl salvezi o dată în Stripe.'}
                </div>
                {lastRunLabel && (
                  <div style={{ fontSize: 11, opacity: 0.75, marginTop: 6 }}>
                    {lastRunLabel}
                  </div>
                )}
                {!armed && (
                  <a
                    href={s.setupUrl || 'https://dashboard.stripe.com/customers'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block', marginTop: 8,
                      fontSize: 12, color: '#fde68a',
                      textDecoration: 'underline',
                    }}
                  >Deschide Stripe — Customers →</a>
                )}
              </div>
            )
          })()}

          {!creditsLoading && creditsCards.map((c) => {
            const badge = ({
              ok: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.55)', text: '#bbf7d0', label: 'OK' },
              low: { bg: 'rgba(245, 158, 11, 0.12)', border: 'rgba(245, 158, 11, 0.55)', text: '#fde68a', label: 'LOW' },
              error: { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.55)', text: '#fecaca', label: 'ERROR' },
              // `unconfigured` = opt-in provider (Groq) intentionally left unset.
              // Muted slate styling (not red) so the admin sees the state
              // at-a-glance without thinking something is broken.
              unconfigured: { bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.5)', text: '#e2e8f0', label: 'NOT SET' },
              unknown: { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.4)', text: '#cbd5e1', label: '—' },
            })[c.status] || { bg: 'rgba(148, 163, 184, 0.1)', border: 'rgba(148, 163, 184, 0.4)', text: '#cbd5e1', label: '—' }
            // PR E2 — friendly headline sits above the raw balance so
            // admins scanning the grid read "credit suficient" /
            // "credit aproape terminat" / "cheie lipsă" instead of
            // parsing `123,456 / 500,000 chars` every time.
            const friendly = friendlyCreditStatus(c)
            const headlineColor = ({
              ok: '#bbf7d0', warn: '#fde68a', error: '#fecaca', muted: '#e2e8f0',
            })[friendly.tone] || '#ede9fe'
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
                <div style={{
                  fontSize: 14, fontWeight: 600,
                  color: headlineColor, marginBottom: friendly.sub ? 2 : 6,
                }}>
                  {friendly.headline}
                </div>
                {friendly.sub && (
                  <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 6 }}>
                    {friendly.sub}
                  </div>
                )}
                {c.subtitle && (
                  <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6 }}>{c.subtitle}</div>
                )}
                {/* Raw numbers kept small so the admin can cross-check
                    against the provider dashboard without drowning the
                    friendly headline. */}
                {c.balanceDisplay && c.balanceDisplay !== '—' && (
                  <div style={{ fontSize: 11, opacity: 0.6 }}>
                    {c.balanceDisplay}
                  </div>
                )}
                {c.message && c.status !== 'ok' && (
                  <div style={{ fontSize: 10, opacity: 0.55, marginTop: 4 }}>
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

      {/* Admin-only — Visitors drawer. Shows one row per SPA page load
          (IP, country, user-agent, referer, path, user email if signed
          in, timestamp). Auto-refresh 10s. Adrian 2026-04-20: "nu vad
          buton vizite reale cine a vizitat situl, ip tara restul
          datelor lor". */}
      {visitorsOpen && (
        <div
          onClick={() => setVisitorsOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
      {visitorsOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(640px, 98vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
            color: '#ede9fe',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · VISITORS
            </div>
            <button
              onClick={() => setVisitorsOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >✕</button>
          </div>
          <AdminTabBar active="visitors" onSelect={switchAdminTab} />

          {/* Stats header — last 24h summary. */}
          {visitorsStats && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 8,
              marginBottom: 16,
            }}>
              <div style={{
                padding: '10px 12px', borderRadius: 10,
                background: 'rgba(167, 139, 250, 0.06)',
                border: '1px solid rgba(167, 139, 250, 0.2)',
              }}>
                <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: '0.1em' }}>
                  VISITS ({visitorsStats.windowHours}H)
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {visitorsStats.totalVisits}
                </div>
              </div>
              <div style={{
                padding: '10px 12px', borderRadius: 10,
                background: 'rgba(167, 139, 250, 0.06)',
                border: '1px solid rgba(167, 139, 250, 0.2)',
              }}>
                <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: '0.1em' }}>
                  UNIQUE IPS
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {visitorsStats.uniqueIps}
                </div>
              </div>
              <div style={{
                padding: '10px 12px', borderRadius: 10,
                background: 'rgba(167, 139, 250, 0.06)',
                border: '1px solid rgba(167, 139, 250, 0.2)',
              }}>
                <div style={{ fontSize: 10, opacity: 0.6, letterSpacing: '0.1em' }}>
                  TOP COUNTRIES
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {Array.isArray(visitorsStats.topCountries) && visitorsStats.topCountries.length > 0
                    ? visitorsStats.topCountries.map((c) => `${c.country} (${c.n})`).join(', ')
                    : <span style={{ opacity: 0.55 }}>—</span>}
                </div>
              </div>
            </div>
          )}

          {visitorsLoading && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>Loading visitors…</div>
          )}
          {visitorsError && !visitorsLoading && (
            <div style={{
              fontSize: 13, color: '#fecaca',
              background: 'rgba(80, 14, 14, 0.6)',
              padding: '10px 12px', borderRadius: 10, marginBottom: 12,
            }}>{visitorsError}</div>
          )}

          {!visitorsLoading && visitorsRows.length === 0 && !visitorsError && (
            <div style={{ opacity: 0.55, fontSize: 14 }}>
              No visits recorded yet. This panel starts filling up as soon as
              the middleware sees a real HTML page load (not API calls).
            </div>
          )}

          {/* Scrollable table. Fixed-width font for IP and timestamp so
              columns align. */}
          {!visitorsLoading && visitorsRows.length > 0 && (
            <div style={{
              borderRadius: 12,
              border: '1px solid rgba(167, 139, 250, 0.18)',
              overflow: 'hidden',
            }}>
              {visitorsRows.map((v) => {
                const when = v.ts ? new Date(v.ts) : null
                const whenShort = when && !Number.isNaN(when.getTime())
                  ? when.toLocaleString('en-GB', { hour12: false })
                  : '—'
                const uaShort = (v.userAgent || '').slice(0, 80)
                return (
                  <div
                    key={v.id}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid rgba(167, 139, 250, 0.08)',
                      fontSize: 12,
                      lineHeight: 1.45,
                    }}
                  >
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      gap: 10, marginBottom: 2,
                    }}>
                      <div style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                        fontVariantNumeric: 'tabular-nums',
                        opacity: 0.75,
                      }}>{whenShort}</div>
                      <div style={{
                        fontSize: 11, opacity: 0.55, letterSpacing: '0.05em',
                      }}>
                        {v.country || '??'} · {v.ip || '—'}
                      </div>
                    </div>
                    <div style={{ marginBottom: 2 }}>
                      <span style={{ opacity: 0.55, marginRight: 6 }}>path</span>
                      <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                        {v.path || '/'}
                      </span>
                      {v.userEmail && (
                        <span style={{
                          marginLeft: 8, padding: '1px 6px',
                          borderRadius: 6,
                          background: 'rgba(167, 139, 250, 0.15)',
                          fontSize: 11,
                        }}>{v.userEmail}</span>
                      )}
                    </div>
                    {uaShort && (
                      <div style={{ opacity: 0.55, fontSize: 11 }}>
                        {uaShort}{v.userAgent && v.userAgent.length > 80 ? '…' : ''}
                      </div>
                    )}
                    {v.referer && (
                      <div style={{ opacity: 0.45, fontSize: 11 }}>
                        ← {v.referer.slice(0, 100)}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Admin — Users tab. Placeholder panel for now; the unified shell
          gives the tab a permanent home so it doesn't drift around the
          overflow menu, and a future PR will wire up /api/admin/users
          (list, search by email, grant credits, ban, reset password,
          view ledger). Adrian 2026-04-20: "Users list, search email,
          grant credits, ban, reset password, view history". Marked
          "nu acum" for the mutating actions — they land in PR E5. */}
      {usersOpen && (
        <div
          onClick={() => setUsersOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
      {usersOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(560px, 98vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
            color: '#ede9fe',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · USERS
            </div>
            <button
              onClick={() => setUsersOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >✕</button>
          </div>
          <AdminTabBar active="users" onSelect={switchAdminTab} />

          {/* Search + status filter. Submit search on Enter or blur. */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              value={usersQuery}
              onChange={(e) => setUsersQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') refreshUsersList(usersQuery, usersStatus) }}
              onBlur={() => refreshUsersList(usersQuery, usersStatus)}
              placeholder="Caută după email, nume sau ID…"
              style={{
                flex: '1 1 180px', minWidth: 160,
                padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(167, 139, 250, 0.25)',
                color: '#ede9fe', fontSize: 13, outline: 'none',
              }}
            />
            <select
              value={usersStatus}
              onChange={(e) => { setUsersStatus(e.target.value); refreshUsersList(usersQuery, e.target.value) }}
              style={{
                padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(167, 139, 250, 0.25)',
                color: '#ede9fe', fontSize: 13, outline: 'none',
              }}
            >
              <option value="all">Toți</option>
              <option value="active">Activi</option>
              <option value="banned">Suspendați</option>
              <option value="admin">Admini</option>
            </select>
            <button
              onClick={() => refreshUsersList(usersQuery, usersStatus)}
              disabled={usersLoading}
              style={{
                padding: '8px 12px', borderRadius: 8,
                background: 'rgba(167, 139, 250, 0.15)',
                border: '1px solid rgba(167, 139, 250, 0.35)',
                color: '#ede9fe', fontSize: 13, cursor: 'pointer',
                opacity: usersLoading ? 0.5 : 1,
              }}
            >
              {usersLoading ? 'Se încarcă…' : 'Reîncarcă'}
            </button>
          </div>

          {usersError && (
            <div style={{
              marginBottom: 10, padding: '10px 12px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.35)',
              borderRadius: 8, fontSize: 13, color: '#fecaca',
            }}>
              {usersError}
            </div>
          )}

          {usersData && (
            <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 8 }}>
              {usersData.total} din {usersData.totalAll} useri
              {usersData.query ? ` · filtrat după „${usersData.query}"` : ''}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(usersData?.users || []).map((u) => {
              const isBanned = Boolean(u.banned)
              const isAdminRow = u.role === 'admin'
              return (
                <button
                  key={u.id}
                  onClick={() => loadUserDetail(u.id)}
                  style={{
                    textAlign: 'left', cursor: 'pointer',
                    padding: '10px 12px', borderRadius: 10,
                    background: selectedUserId === u.id
                      ? 'rgba(167, 139, 250, 0.15)'
                      : 'rgba(255,255,255,0.04)',
                    border: '1px solid ' + (isBanned
                      ? 'rgba(239, 68, 68, 0.35)'
                      : 'rgba(167, 139, 250, 0.18)'),
                    color: '#ede9fe', fontSize: 13,
                    display: 'flex', flexDirection: 'column', gap: 3,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{u.email || '(fără email)'}</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>
                      {Number.isFinite(u.credits_balance_minutes)
                        ? `${u.credits_balance_minutes} min`
                        : '—'}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span>{u.name || '—'}</span>
                    {isAdminRow && <span style={{ color: '#fde68a' }}>admin</span>}
                    {isBanned && <span style={{ color: '#fca5a5' }}>suspendat</span>}
                    {!isBanned && !isAdminRow && <span style={{ opacity: 0.75 }}>activ</span>}
                    <span style={{ opacity: 0.55 }}>· id {String(u.id).slice(0, 10)}</span>
                  </div>
                </button>
              )
            })}
            {usersData && (usersData.users || []).length === 0 && !usersLoading && (
              <div style={{ opacity: 0.6, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
                Niciun user pentru filtrul curent.
              </div>
            )}
          </div>

          {/* User detail sub-drawer — overlays the list when a row is
              clicked. Close via "← Înapoi la listă" or by picking
              another row (loadUserDetail replaces state). */}
          {selectedUserId && (
            <div style={{
              marginTop: 16, padding: '14px 14px',
              background: 'rgba(10, 8, 20, 0.6)',
              border: '1px solid rgba(167, 139, 250, 0.3)',
              borderRadius: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <button
                  onClick={closeUserDetail}
                  style={{
                    background: 'transparent', border: 'none',
                    color: '#c4b5fd', cursor: 'pointer', fontSize: 12,
                  }}
                >← Înapoi la listă</button>
                <span style={{ fontSize: 11, opacity: 0.6 }}>
                  {selectedUser?.email || selectedUserId}
                </span>
              </div>

              {!selectedUser && (
                <div style={{ opacity: 0.6, fontSize: 13 }}>Se încarcă detaliile…</div>
              )}

              {selectedUser && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12, marginBottom: 12 }}>
                    <div><span style={{ opacity: 0.6 }}>Email: </span>{selectedUser.email}</div>
                    <div><span style={{ opacity: 0.6 }}>Rol: </span>{selectedUser.role}</div>
                    <div><span style={{ opacity: 0.6 }}>Credite: </span>{selectedUser.credits_balance_minutes ?? 0} min</div>
                    <div><span style={{ opacity: 0.6 }}>Status: </span>{selectedUser.banned ? 'Suspendat' : 'Activ'}</div>
                    <div><span style={{ opacity: 0.6 }}>Creat: </span>{selectedUser.created_at?.slice(0, 10) || '—'}</div>
                    <div><span style={{ opacity: 0.6 }}>Tier: </span>{selectedUser.subscription_tier || 'free'}</div>
                  </div>

                  {selectedUser.banned && selectedUser.banned_reason && (
                    <div style={{
                      fontSize: 12, padding: '8px 10px', marginBottom: 10,
                      background: 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: 8, color: '#fecaca',
                    }}>
                      Motiv: {selectedUser.banned_reason}
                    </div>
                  )}

                  {selectedResult && (
                    <div style={{
                      fontSize: 12, padding: '8px 10px', marginBottom: 10,
                      background: selectedResult.ok
                        ? 'rgba(34, 197, 94, 0.08)'
                        : 'rgba(239, 68, 68, 0.08)',
                      border: '1px solid ' + (selectedResult.ok
                        ? 'rgba(34, 197, 94, 0.35)'
                        : 'rgba(239, 68, 68, 0.35)'),
                      borderRadius: 8,
                      color: selectedResult.ok ? '#bbf7d0' : '#fecaca',
                    }}>
                      {selectedResult.ok ? selectedResult.message : selectedResult.error}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                    <button
                      onClick={grantCreditsToSelected}
                      disabled={selectedBusy}
                      style={actionBtnStyle(selectedBusy)}
                    >+/− Credite</button>
                    {selectedUser.banned ? (
                      <button
                        onClick={() => banSelectedUser(false)}
                        disabled={selectedBusy}
                        style={actionBtnStyle(selectedBusy, '#bbf7d0', 'rgba(34,197,94,0.35)')}
                      >Reactivează contul</button>
                    ) : (
                      <button
                        onClick={() => banSelectedUser(true)}
                        disabled={selectedBusy || selectedUser.role === 'admin'}
                        style={actionBtnStyle(selectedBusy || selectedUser.role === 'admin', '#fecaca', 'rgba(239,68,68,0.35)')}
                      >Suspendă contul</button>
                    )}
                    <button
                      onClick={resetSelectedPassword}
                      disabled={selectedBusy}
                      style={actionBtnStyle(selectedBusy)}
                    >Resetează parola</button>
                  </div>

                  {/* History panel */}
                  <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6, letterSpacing: '0.1em' }}>
                    ISTORIC · ULTIMELE {selectedHistory?.rows?.length || 0} TRANZACȚII
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto' }}>
                    {(selectedHistory?.rows || []).map((row) => (
                      <div key={row.id} style={{
                        display: 'flex', justifyContent: 'space-between',
                        padding: '6px 8px', borderRadius: 6,
                        background: 'rgba(255,255,255,0.03)',
                        fontSize: 11,
                      }}>
                        <span style={{ opacity: 0.75 }}>
                          {row.kind} · {row.created_at?.slice(0, 16)?.replace('T', ' ')}
                        </span>
                        <span style={{
                          color: row.delta_minutes >= 0 ? '#bbf7d0' : '#fca5a5',
                          fontWeight: 600,
                        }}>
                          {row.delta_minutes >= 0 ? '+' : ''}{row.delta_minutes} min
                        </span>
                      </div>
                    ))}
                    {(!selectedHistory?.rows || selectedHistory.rows.length === 0) && (
                      <div style={{ opacity: 0.5, fontSize: 12, textAlign: 'center', padding: 10 }}>
                        Fără tranzacții.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Admin — Payouts tab. Shows where the owner's half of each
          top-up ends up. Stripe already runs the automatic payout
          schedule (set once in the Stripe Dashboard); this panel is a
          read-only view into what Stripe is about to pay + a link to
          the dashboard. Future iteration (PR E3) will add the 50/50
          ledger split view and an on-demand "Instant payout" button.
          Adrian 2026-04-20: "A pot da cardul unde sa se faca payouut?"
          — answered via the "Set up payout destination" link, which
          deep-links to Stripe's external-account settings. */}
      {payoutsOpen && (
        <div
          onClick={() => setPayoutsOpen(false)}
          style={{
            position: 'absolute', inset: 0,
            background: 'rgba(3, 4, 10, 0.35)',
            zIndex: 25,
          }}
        />
      )}
      {payoutsOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', top: 0, right: 0, bottom: 0,
            width: 'min(560px, 98vw)',
            background: 'rgba(10, 8, 20, 0.92)',
            backdropFilter: 'blur(22px)',
            borderLeft: '1px solid rgba(167, 139, 250, 0.2)',
            padding: '70px 20px 24px 20px',
            overflowY: 'auto',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            zIndex: 26,
            color: '#ede9fe',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, letterSpacing: '0.15em' }}>
              ADMIN · PAYOUTS
            </div>
            <button
              onClick={() => setPayoutsOpen(false)}
              style={{
                background: 'transparent', border: 'none', color: '#ede9fe',
                fontSize: 20, cursor: 'pointer', opacity: 0.7,
              }}
              aria-label="Close"
            >✕</button>
          </div>
          <AdminTabBar active="payouts" onSelect={switchAdminTab} />

          <div style={{
            padding: '14px 16px',
            background: 'rgba(96, 165, 250, 0.06)',
            border: '1px solid rgba(96, 165, 250, 0.25)',
            borderRadius: 12,
            fontSize: 13, lineHeight: 1.55,
            marginBottom: 14,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
              Cum ajung banii la tine
            </div>
            <div style={{ opacity: 0.82 }}>
              Stripe varsă automat soldul în contul/ cardul pe care l-ai
              conectat ca "external account". Nu trebuie să inițiezi tu
              nimic — odată configurat, fiecare top-up al unui user trece
              prin: Stripe Checkout → Stripe balance → payout automat (zilnic
              sau săptămânal, după setarea ta). Jumătate din fiecare top-up
              e deja rezervată intern pentru costurile AI (OpenAI, Groq,
              ElevenLabs), cealaltă jumătate e profitul net.
            </div>
          </div>

          <a
            href="https://dashboard.stripe.com/settings/payouts"
            target="_blank" rel="noopener noreferrer"
            style={{
              display: 'block',
              padding: '12px 14px',
              marginBottom: 10,
              background: 'rgba(167, 139, 250, 0.12)',
              border: '1px solid rgba(167, 139, 250, 0.35)',
              borderRadius: 12,
              color: '#ede9fe',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Setează destinația payout-urilor</span>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Stripe ↗</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
              Adaugi un IBAN sau un card de debit o singură dată. Recomandat:
              Visa/Mastercard Debit (Revolut, Wise, Starling) pentru plăți
              instant în 30 min.
            </div>
          </a>

          <a
            href="https://dashboard.stripe.com/payouts"
            target="_blank" rel="noopener noreferrer"
            style={{
              display: 'block',
              padding: '12px 14px',
              marginBottom: 10,
              background: 'rgba(167, 139, 250, 0.06)',
              border: '1px solid rgba(167, 139, 250, 0.15)',
              borderRadius: 12,
              color: '#ede9fe',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Istoric payout-uri</span>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Stripe ↗</span>
            </div>
            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
              Fiecare plată către banca/cardul tău, cu data și suma.
            </div>
          </a>

          <PayoutsPanel
            data={payoutsData}
            loading={payoutsLoading}
            error={payoutsError}
            onInstantPayout={triggerInstantPayout}
            busy={payoutBusy}
            result={payoutResult}
          />
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

// Compact pill button used on the top-right action bar. Keeps a consistent
// look with the ⋯ overflow button — an accent ring appears when `active`
// so camera/screen/transcript toggles read as "on".
function TopBarIconButton({ children, onClick, disabled, active, title, ariaLabel }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel || title}
      style={{
        width: 36, height: 36, borderRadius: 999,
        background: active
          ? 'rgba(167, 139, 250, 0.25)'
          : 'rgba(10, 8, 20, 0.5)',
        backdropFilter: 'blur(12px)',
        border: active
          ? '1px solid rgba(167, 139, 250, 0.75)'
          : '1px solid rgba(167, 139, 250, 0.25)',
        color: disabled ? '#6b7280' : '#ede9fe',
        fontSize: 16,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s, border-color 0.15s',
      }}
    >{children}</button>
  )
}

// Admin shell — single entry point behaves like a dashboard with tabs.
// Each tab maps 1:1 to an existing modal drawer (Business / AI / Visitors)
// or a new placeholder panel (Users / Payouts). The parent component owns
// one open state per tab; this bar only issues `onSelect(key)` and lets
// the parent do the routing so the existing open*() data-fetch helpers
// are reused without duplication.
//
// 2026-04-20 Adrian: "gindeste o structura informationala de admin adevarata,
// un management integrat intru-un singur buton acolo cu subutoane".
const ADMIN_TABS = [
  { key: 'business', label: 'Business', emoji: '💼' },
  { key: 'ai',       label: 'AI',       emoji: '🧠' },
  { key: 'visitors', label: 'Visitors', emoji: '👥' },
  { key: 'users',    label: 'Users',    emoji: '🧑‍🤝‍🧑' },
  { key: 'payouts',  label: 'Payouts',  emoji: '💸' },
];

function AdminTabBar({ active, onSelect }) {
  return (
    <div
      style={{
        display: 'flex', gap: 4, flexWrap: 'wrap',
        marginBottom: 14, paddingBottom: 10,
        borderBottom: '1px solid rgba(167, 139, 250, 0.15)',
      }}
    >
      {ADMIN_TABS.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => onSelect(t.key)}
            style={{
              padding: '6px 11px',
              fontSize: 12,
              background: isActive
                ? 'rgba(167, 139, 250, 0.25)'
                : 'rgba(167, 139, 250, 0.06)',
              border: isActive
                ? '1px solid rgba(167, 139, 250, 0.55)'
                : '1px solid rgba(167, 139, 250, 0.12)',
              color: isActive ? '#fff' : 'rgba(237, 233, 254, 0.72)',
              borderRadius: 999,
              cursor: 'pointer',
              fontWeight: isActive ? 600 : 400,
              display: 'flex', alignItems: 'center', gap: 5,
              transition: 'background 0.12s, border-color 0.12s',
            }}
            aria-pressed={isActive}
            aria-label={`Admin tab: ${t.label}`}
          >
            <span aria-hidden="true">{t.emoji}</span>
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// PR E3 — Payouts panel. Live Stripe balance + destination + recent
// payouts + 50/50 split over the last 30 days. The server aggregator
// never throws; partial failures come back in `data.errors` and we
// render whatever did load.
function PayoutsPanel({ data, loading, error, onInstantPayout, busy, result }) {
  if (loading && !data) {
    return <div style={{ fontSize: 13, opacity: 0.7, padding: '14px 4px' }}>Se încarcă…</div>
  }
  if (error) {
    return (
      <div style={{
        marginTop: 14, padding: '12px 14px',
        background: 'rgba(248, 113, 113, 0.08)',
        border: '1px solid rgba(248, 113, 113, 0.35)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.5,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Nu pot încărca payout-urile</div>
        <div style={{ opacity: 0.85 }}>{error}</div>
      </div>
    )
  }
  if (!data) return null
  if (!data.configured) {
    return (
      <div style={{
        marginTop: 14, padding: '12px 14px',
        background: 'rgba(250, 204, 21, 0.08)',
        border: '1px solid rgba(250, 204, 21, 0.35)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Stripe nu e încă legat</div>
        <div style={{ opacity: 0.85 }}>
          Setează STRIPE_SECRET_KEY pe server ca să vezi soldul real aici.
        </div>
      </div>
    )
  }

  const fmt = (bucket) => (bucket && bucket.display) || '—'
  // `buildRevenueSplit` returns { window, fraction, revenue, allocation, ... };
  // the earlier draft guessed the shape and the 50/50 card silently rendered
  // three "—" values on prod. Pull the fields from their real paths.
  const split = data.split || {}
  const days = (split.window && split.window.days) || 30
  const gross = split.revenue && split.revenue.grossDisplay
  const reserved = split.allocation && split.allocation.display
  const profit = split.allocation && split.allocation.ownerDisplay
  const recent = Array.isArray(data.recentPayouts) ? data.recentPayouts : []
  const destination = data.destination
  const canInstant = Boolean(data.instantEligible) && (data.balance && data.balance.instantAvailable && data.balance.instantAvailable.amount > 0)

  return (
    <div>
      {/* Live balance */}
      <div style={{
        marginTop: 4, padding: '14px 16px',
        background: 'rgba(16, 185, 129, 0.08)',
        border: '1px solid rgba(16, 185, 129, 0.25)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>Sold Stripe</div>
        <PayoutsRow label="Disponibil acum" value={fmt(data.balance && data.balance.available)} />
        <PayoutsRow label="În tranzit (pending)" value={fmt(data.balance && data.balance.pending)} />
        <PayoutsRow label="Eligibil pentru instant" value={fmt(data.balance && data.balance.instantAvailable)} />
      </div>

      {/* Destination + schedule */}
      {destination && (
        <div style={{
          marginTop: 10, padding: '12px 14px',
          background: 'rgba(96, 165, 250, 0.06)',
          border: '1px solid rgba(96, 165, 250, 0.22)',
          borderRadius: 12, fontSize: 13, lineHeight: 1.55,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Destinație payout</div>
          <PayoutsRow
            label="Tip"
            value={
              destination.type === 'card'
                ? `Card ${destination.brand || ''} •••• ${destination.last4 || '????'}`
                : destination.type === 'bank_account'
                  ? `IBAN •••• ${destination.last4 || '????'} (${destination.country || ''})`
                  : destination.type || 'nesetat'
            }
          />
          <PayoutsRow label="Program" value={formatSchedule(data.schedule)} />
        </div>
      )}

      {/* 50/50 split */}
      <div style={{
        marginTop: 10, padding: '12px 14px',
        background: 'rgba(167, 139, 250, 0.06)',
        border: '1px solid rgba(167, 139, 250, 0.22)',
        borderRadius: 12, fontSize: 13, lineHeight: 1.55,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Split 50/50 · ultimele {days} zile</div>
        <PayoutsRow label="Venit brut" value={gross || '—'} />
        <PayoutsRow label="Rezervat pentru AI" value={reserved || '—'} />
        <PayoutsRow label="Profit net (al tău)" value={profit || '—'} bold />
      </div>

      {/* Instant payout CTA */}
      <button
        onClick={onInstantPayout}
        disabled={busy || !canInstant}
        style={{
          marginTop: 10, width: '100%',
          padding: '12px 14px',
          background: canInstant
            ? 'linear-gradient(180deg, rgba(167, 139, 250, 0.32), rgba(139, 92, 246, 0.22))'
            : 'rgba(167, 139, 250, 0.08)',
          color: canInstant ? '#fff' : 'rgba(237, 233, 254, 0.5)',
          border: '1px solid rgba(167, 139, 250, 0.35)',
          borderRadius: 12,
          fontSize: 14, fontWeight: 600,
          cursor: canInstant && !busy ? 'pointer' : 'not-allowed',
        }}
      >
        {busy ? 'Trimit…' : canInstant ? 'Instant payout pe card (~30 min, taxa ~1% + 0.25 EUR)' : 'Instant payout indisponibil (nimic eligibil acum)'}
      </button>

      {/* Result of the last trigger */}
      {result && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: result.ok ? 'rgba(16, 185, 129, 0.08)' : 'rgba(248, 113, 113, 0.08)',
          border: result.ok ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(248, 113, 113, 0.35)',
          borderRadius: 10, fontSize: 12, lineHeight: 1.5,
        }}>
          {result.ok
            ? `OK — ${result.display} · status ${result.status}${result.arrivalDateMs ? ' · ETA ' + new Date(result.arrivalDateMs).toLocaleString() : ''}`
            : `Eroare: ${result.error}`}
        </div>
      )}

      {/* Recent payouts */}
      {recent.length > 0 && (
        <div style={{
          marginTop: 10, padding: '12px 14px',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 12, fontSize: 12, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 13 }}>Ultimele payout-uri</div>
          {recent.slice(0, 10).map((p) => (
            <div key={p.id} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.04)',
              gap: 8,
            }}>
              <span style={{ opacity: 0.72 }}>
                {p.createdMs ? new Date(p.createdMs).toLocaleDateString() : '—'} · {p.method || 'standard'}
              </span>
              <span style={{ textAlign: 'right' }}>
                {p.display || '—'} <span style={{ opacity: 0.55 }}>· {p.status}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Partial-failure hints (balance loaded but account failed, etc) */}
      {Array.isArray(data.errors) && data.errors.length > 0 && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: 'rgba(250, 204, 21, 0.06)',
          border: '1px solid rgba(250, 204, 21, 0.2)',
          borderRadius: 10, fontSize: 11, lineHeight: 1.5, opacity: 0.85,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 3 }}>Avertismente Stripe</div>
          {data.errors.map((e, i) => (
            <div key={i} style={{ opacity: 0.8 }}>{e.source}: {e.message}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function PayoutsRow({ label, value, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span style={{ fontWeight: bold ? 700 : 500 }}>{value}</span>
    </div>
  )
}

function formatSchedule(schedule) {
  if (!schedule || !schedule.interval) return '—'
  const { interval, delayDays, monthlyAnchor, weeklyAnchor } = schedule
  if (interval === 'manual') return 'Manual (doar instant)'
  if (interval === 'daily') return `Zilnic (T+${delayDays ?? '?'} zile)`
  if (interval === 'weekly') return `Săptămânal${weeklyAnchor ? ' · ' + weeklyAnchor : ''}`
  if (interval === 'monthly') return `Lunar${monthlyAnchor ? ' · ziua ' + monthlyAnchor : ''}`
  return interval
}

// PR E2 — translate raw provider card state into human-friendly copy
// the admin actually wants to read ("credit suficient ✓" / "credit
// scăzut — reîncarcă aici →" / "cheie lipsă"). The technical message
// and balance string stay as a small secondary line for when the admin
// needs to debug, but the big headline is always in plain Romanian.
//
// Adrian 2026-04-20: "poti schimba stilul de comunicare, la ai ex
// credit suficient, atentie la ai .. x.. trebuie credit".
function friendlyCreditStatus(card) {
  if (!card) return { headline: '—', tone: 'muted', sub: null };
  const isRevenue = card.kind === 'revenue';
  switch (card.status) {
    case 'ok':
      return {
        headline: isRevenue ? 'Venit — în cont' : 'Credit suficient ✓',
        tone: 'ok',
        sub: isRevenue ? 'Banii așteaptă payout-ul automat.' : null,
      };
    case 'low':
      return {
        headline: 'Credit aproape terminat — reîncarcă aici →',
        tone: 'warn',
        sub: 'Atingi cardul ca să deschizi pagina de top-up a providerului.',
      };
    case 'error':
      return {
        headline: 'Problemă cu cheia — deschide providerul →',
        tone: 'error',
        sub: 'Cheia nu răspunde; verifică-o sau rotește-o din dashboard-ul providerului.',
      };
    case 'unconfigured':
      return {
        headline: 'Opțional — nesetat',
        tone: 'muted',
        sub: 'Providerul nu-i obligatoriu; adaugă cheia dacă vrei să-l activezi.',
      };
    default:
      return {
        headline: card.balanceDisplay || 'Stare necunoscută',
        tone: 'muted',
        sub: null,
      };
  }
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
