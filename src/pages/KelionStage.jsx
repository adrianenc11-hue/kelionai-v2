import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, Environment, ContactShadows, Float, Html } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { useLipSync } from '../lib/lipSync'
import { subscribeMonitor } from '../lib/monitorStore'
import { STATUS_COLORS, STATUS_PULSE_HZ } from '../lib/kelionStatus'
import { useGeminiLive } from '../lib/geminiLive'
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

// StageMonitorContent — renders whatever `monitorStore` currently holds onto
// the inner-screen plane of the presentation monitor. drei's <Html transform>
// projects a real DOM subtree onto the 3D plane with correct perspective, so
// users see an actual live iframe / image from the AI's vantage. Kelion calls
// the `show_on_monitor` Gemini tool → monitorStore updates → this component
// re-renders with the new URL.
function StageMonitorContent() {
  // Idle default — identical shape to what monitorStore keeps internally.
  // We import only `subscribeMonitor` (not `getMonitorState`) and rely on
  // the store invoking the listener immediately on subscribe to catch any
  // state that was set before this component mounted. Keeps the surface
  // minimal and avoids cross-chunk reads at render time.
  const [m, setM] = useState({ kind: null, src: null, title: null, embedType: 'iframe', updatedAt: 0 })
  useEffect(() => subscribeMonitor((s) => setM({ ...s })), [])

  // Idle: faint grid + watermark, matches the previous static monitor look.
  if (!m.src) {
    return (
      <>
        {Array.from({ length: 6 }).map((_, i) => (
          <mesh key={`mh-${i}`} position={[0, -0.75 + i * 0.3, 0.001]}>
            <planeGeometry args={[2.9, 0.004]} />
            <meshBasicMaterial color={'#1f1b3a'} toneMapped={false} opacity={0.4} transparent />
          </mesh>
        ))}
        <mesh position={[0, 0, 0.002]}>
          <circleGeometry args={[0.07, 32]} />
          <meshBasicMaterial color={'#7c3aed'} toneMapped={false} opacity={0.55} transparent />
        </mesh>
      </>
    )
  }

  // Active: project a DOM iframe / image onto the screen plane. We downscale
  // the DOM with `distanceFactor` so 3.0 x 1.9 world units ≈ 960 x 600 px.
  const isImage = m.embedType === 'image'
  return (
    <Html
      transform
      occlude={false}
      position={[0, 0, 0.01]}
      distanceFactor={1.2}
      zIndexRange={[10, 0]}
      pointerEvents="none"
      style={{
        width: 960,
        height: 600,
        border: 'none',
        overflow: 'hidden',
        background: '#0d0b1d',
        borderRadius: 4,
        boxShadow: '0 0 40px rgba(124, 58, 237, 0.35) inset',
      }}
    >
      {isImage ? (
        <img
          src={m.src}
          alt={m.title || 'Monitor content'}
          referrerPolicy="no-referrer"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <iframe
          src={m.src}
          title={m.title || 'Kelion monitor'}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
          allow="fullscreen; geolocation; autoplay; encrypted-media"
          style={{ width: '100%', height: '100%', border: 'none', background: '#0d0b1d' }}
        />
      )}
    </Html>
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

      {/* Side wall slats were removed — Adrian found them distracting. The
          left half of the stage now holds the presentation monitor; the
          right half remains clean so the avatar is the focus. */}

      {/* ───── Presentation monitor ─────
          Positioned adjacent to the avatar as a presenter + screen pair.
          Adrian: "monitor mai spre el" — moved closer to center (-1.1 from
          -1.7) and slightly forward (-0.35 from -0.8) so the monitor reads
          as the avatar's screen, not a separate fixture on the wall.
          When Gemini Live calls the `show_on_monitor` tool, <StageMonitor/>
          renders an iframe / image on the inner plane via drei <Html transform>. */}
      <group position={[-1.1, 0.35, -0.35]} rotation={[0, Math.PI / 9, 0]}>
        {/* Bezel / outer frame */}
        <mesh position={[0, 0, -0.03]}>
          <planeGeometry args={[3.2, 2.1]} />
          <meshStandardMaterial color={'#0a0b14'} metalness={0.75} roughness={0.35} />
        </mesh>
        {/* Inner screen (idle state: dark purple with faint grid). */}
        <mesh position={[0, 0, 0]}>
          <planeGeometry args={[3.0, 1.9]} />
          <meshBasicMaterial color={'#0d0b1d'} toneMapped={false} />
        </mesh>
        <StageMonitorContent />
        {/* Stand leg */}
        <mesh position={[0, -1.3, -0.02]}>
          <planeGeometry args={[0.12, 0.7]} />
          <meshStandardMaterial color={'#0a0b14'} metalness={0.8} roughness={0.3} />
        </mesh>
      </group>

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

// ───── Main page ─────
export default function KelionStage() {
  const audioRef = useRef(null)
  // Real client GPS (falls back to null → server uses IP-geo instead).
  // The hook fires once on mount; if the browser remembers a previous
  // grant there is no prompt, otherwise the browser shows its standard
  // one-time permission dialog. Coords are cached in localStorage so
  // refreshes don't re-ping the OS.
  const clientGeo = useClientGeo()
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
    // Guest trial countdown (null for signed-in users).
    trial,
  } = useGeminiLive({ audioRef, coords: clientGeo })

  // Drive a live 1Hz tick for the trial HUD. We don't persist the tick
  // in the Gemini Live hook because the hook would re-render the whole
  // pipeline 15 × 60 times per session for nothing; here it only
  // re-renders the small countdown label.
  const [trialTick, setTrialTick] = useState(0)
  useEffect(() => {
    if (!trial || !trial.active) return undefined
    const id = setInterval(() => setTrialTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [trial])
  const trialRemainingMs = trial && trial.active
    ? Math.max(0, trial.expiresAt - Date.now())
    : 0
  // Silence react-hooks/exhaustive-deps: trialTick is read implicitly
  // via Date.now() on every render; we list it here so the compiler
  // doesn't complain about an unused state var.
  void trialTick

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
    // Some browsers gate getUserMedia to a user-gesture; attempt anyway
    // — startCamera's own error handling surfaces a visionError banner.
    try { startCamera() } catch (_) { /* swallowed; banner handles it */ }
  }, [cameraStream, startCamera])

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
      {/* Debug-only Leva tuning drawer. Renders null unless the URL
          carries ?debug=1 or ?tune=1; zero cost for real users. */}
      {isTuningEnabled() && <TuningPanel />}
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

      {/* Guest trial countdown — only rendered while the hook reports an
          active trial (signed-out users). Adrian: "free fara logare …
          trebuie sa aibe timer pe ecran 15 min/zi free". We show the
          remaining mm:ss, and when the window is exhausted the HUD
          flips to a sign-in / buy-credits nudge (the WS is already
          torn down by the hook's auto-stop). */}
      {trial && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            bottom: 'calc(max(32px, env(safe-area-inset-bottom)) + 56px)',
            left: '50%', transform: 'translateX(-50%)',
            padding: '6px 14px',
            borderRadius: 999,
            background: 'rgba(10, 8, 20, 0.6)',
            backdropFilter: 'blur(10px)',
            border: trial.exhausted
              ? '1px solid rgba(239, 68, 68, 0.55)'
              : '1px solid rgba(167, 139, 250, 0.35)',
            color: trial.exhausted ? '#fecaca' : '#e9d5ff',
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '0.02em',
            zIndex: 15,
          }}
          role="status"
          aria-live="polite"
        >
          {trial.exhausted
            ? <>Free trial used up — <button
                onClick={() => setSignInModalOpen(true)}
                style={{
                  background: 'transparent', border: 'none',
                  color: '#fca5a5', textDecoration: 'underline',
                  cursor: 'pointer', padding: 0, font: 'inherit',
                }}
              >sign in</button> to continue.</>
            : <>Free trial · {Math.floor(trialRemainingMs / 60000)}:{String(Math.floor((trialRemainingMs % 60000) / 1000)).padStart(2, '0')} left</>
          }
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
            onClick={() => openBusiness()}
            style={{
              height: 36, padding: '0 12px', borderRadius: 999,
              background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.18), rgba(167, 139, 250, 0.18))',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(250, 204, 21, 0.45)',
              color: '#fef3c7', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontWeight: 600,
            }}
            title="Admin — unlimited access"
            aria-label="Admin — unlimited access"
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
          <MenuItem onClick={() => { cameraStream ? stopCamera() : startCamera(); setMenuOpen(false) }}>
            {cameraStream ? '📹 Turn camera off' : '📹 Turn camera on'}
          </MenuItem>
          <MenuItem onClick={() => { screenStream ? stopScreen() : startScreen(); setMenuOpen(false) }}>
            {screenStream ? '🖥️ Stop sharing screen' : '🖥️ Share screen'}
          </MenuItem>
          <MenuItem onClick={() => { setTranscriptOpen((v) => !v); setMenuOpen(false) }}>
            {transcriptOpen ? '📝 Hide transcript' : '📝 Show transcript'}
          </MenuItem>
          <MenuItem onClick={() => { window.location.assign('/contact'); setMenuOpen(false) }}>
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
          top-bar entry calls window.location.assign('/contact') directly. */}

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
                const euros = (pkg.priceCents / 100).toFixed(2).replace(/\.00$/, '')
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
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{euros} €</div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      {pkg.minutes} credits · {perCredit} €/credit
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
