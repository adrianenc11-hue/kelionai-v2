import { useRef, useLayoutEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { TUNING } from '../../lib/tuning'

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

export default function AvatarModel({ mouthOpen = 0, status = 'idle', emotion = null, presenting = false }) {
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
