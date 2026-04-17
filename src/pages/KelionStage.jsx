import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, Environment, ContactShadows, Float } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { useLipSync } from '../lib/lipSync'
import { STATUS_COLORS, STATUS_PULSE_HZ } from '../lib/kelionStatus'
import { useGeminiLive } from '../lib/geminiLive'

// ───── Avatar with idle animation + lipsync ─────
function AvatarModel({ mouthOpen = 0, status = 'idle' }) {
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

    for (const m of morphsRef.current) {
      const d = m.morphTargetDictionary
      if (!d) continue
      const mouthIdx = d['mouthOpen'] ?? d['viseme_aa'] ?? d['viseme_AA'] ?? d['jawOpen']
      if (mouthIdx !== undefined) {
        m.morphTargetInfluences[mouthIdx] = mouthOpen * 0.45
      }
      const smileIdx = d['mouthSmile'] ?? d['mouthSmileLeft']
      if (smileIdx !== undefined) {
        m.morphTargetInfluences[smileIdx] = status === 'listening' ? 0.08 : 0.04
      }
      const blinkLIdx = d['eyeBlinkLeft'] ?? d['eyesClosed']
      const blinkRIdx = d['eyeBlinkRight']
      if (blinkLIdx !== undefined) m.morphTargetInfluences[blinkLIdx] = blinkStrength
      if (blinkRIdx !== undefined) m.morphTargetInfluences[blinkRIdx] = blinkStrength
    }
  })

  return <primitive ref={root} object={scene} scale={1.65} position={[0, -1.65, 0]} />
}

// ───── Status halo — pulsating light behind avatar ─────
function Halo({ status = 'idle', voiceLevel = 0 }) {
  const mesh = useRef()
  const color = useMemo(() => new THREE.Color(STATUS_COLORS[status] || STATUS_COLORS.idle), [status])
  const colorTarget = useRef(color.clone())

  useEffect(() => { colorTarget.current = new THREE.Color(STATUS_COLORS[status] || STATUS_COLORS.idle) }, [status])

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

// ───── Luxury TV studio decor ─────
function StudioDecor() {
  // Backdrop — 5 vertical lit panels with gradient
  const panels = useMemo(() => {
    const arr = []
    const count = 7
    const width = 1.15
    const gap = 0.08
    const totalW = count * width + (count - 1) * gap
    for (let i = 0; i < count; i++) {
      const x = -totalW / 2 + i * (width + gap) + width / 2
      const hue = 0.72 + (i - count / 2) * 0.015
      const color = new THREE.Color().setHSL(hue, 0.7, 0.42)
      arr.push({ x, color, i })
    }
    return arr
  }, [])

  const panelRefs = useRef([])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    panelRefs.current.forEach((ref, i) => {
      if (!ref) return
      const breathe = 0.5 + Math.sin(t * 0.4 + i * 0.7) * 0.35
      ref.material.emissiveIntensity = 0.65 + breathe * 0.45
    })
  })

  return (
    <group>
      {/* Backdrop panels */}
      {panels.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => (panelRefs.current[i] = el)}
          position={[p.x, 0.4, -4.5]}
          castShadow={false}
          receiveShadow={false}
        >
          <planeGeometry args={[1.15, 4.2]} />
          <meshStandardMaterial
            color={'#0a0a14'}
            emissive={p.color}
            emissiveIntensity={0.9}
            roughness={0.35}
            metalness={0.2}
          />
        </mesh>
      ))}

      {/* Horizontal LED bar across top */}
      <mesh position={[0, 2.8, -4.45]}>
        <planeGeometry args={[10.5, 0.12]} />
        <meshBasicMaterial color={'#c084fc'} toneMapped={false} />
      </mesh>

      {/* Horizontal accent light bottom */}
      <mesh position={[0, -1.8, -4.45]}>
        <planeGeometry args={[10.5, 0.05]} />
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

  const mouthOpen = useLipSync(audioRef)

  const {
    status,
    error,
    start,
    stop,
    turns,
    userLevel,
  } = useGeminiLive({ audioRef })

  useEffect(() => { setVoiceLevel(userLevel || 0) }, [userLevel])

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
          <Halo status={status} voiceLevel={voiceLevel} />
          <AvatarModel mouthOpen={mouthOpen} status={status} />
          <ContactShadows position={[0, -1.65, 0]} opacity={0.55} scale={6} blur={2.6} far={2.5} />
        </Suspense>
      </Canvas>

      <audio ref={audioRef} autoPlay playsInline />

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
          animation: `pulse ${1 / (STATUS_PULSE_HZ[status] || 0.5)}s infinite ease-in-out`,
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
            position: 'absolute', top: 70, right: 18,
            minWidth: 200,
            background: 'rgba(14, 10, 28, 0.92)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(167, 139, 250, 0.2)',
            borderRadius: 14, padding: 6,
            color: '#ede9fe', fontSize: 14,
            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}
        >
          <MenuItem onClick={() => { setTranscriptOpen((v) => !v); setMenuOpen(false) }}>
            {transcriptOpen ? 'Hide transcript' : 'Show transcript'}
          </MenuItem>
          <MenuItem onClick={() => { stop(); setMenuOpen(false) }} disabled={status === 'idle'}>
            End chat
          </MenuItem>
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
