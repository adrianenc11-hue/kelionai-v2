import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment } from '@react-three/drei'
import { Suspense, useRef, useState, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const KELION = {
  id: 'kelion',
  name: 'Kelion',
  model: '/kelion-rpm_e27cb94d.glb',
  color: '#7c3aed',
  glow: '#a855f7',
}

const DEFAULT_ARM     = { x: 1.3, y: 0.0, z: 0.15 }
const DEFAULT_FOREARM = { x: 0.4, y: 0.0, z: 0.0 }
const STORAGE_KEY = 'arm_rot_kelion'

function AvatarModel({ armRot, forearmRot }) {
  const { scene } = useGLTF(KELION.model)
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

    // Apply natural arms-down pose directly after bones are found
    // RPM model: LeftArm Z rotation brings arm down, RightArm mirrors it
    const b = bones
    const setRot = (names, x, y, z) => {
      for (const n of names) {
        if (b[n]) {
          b[n].rotation.set(x, y, z)
          break
        }
      }
    }
    // Bring arms down close to body
    setRot(['LeftArm', 'LeftUpperArm'],   0, 0,  1.4)   // left arm down
    setRot(['RightArm', 'RightUpperArm'], 0, 0, -1.4)   // right arm down (mirror)
    setRot(['LeftForeArm'],               0.3, 0, 0)    // slight forearm bend
    setRot(['RightForeArm'],              0.3, 0, 0)    // slight forearm bend
  }, [scene])

  useFrame(() => {
    const b = bonesRef.current
    if (!b) return
    const set = (names, rot) => {
      for (const n of names) {
        if (b[n]) { b[n].rotation.x = rot.x; b[n].rotation.y = rot.y; b[n].rotation.z = rot.z; break }
      }
    }
    set(['LeftArm','LeftUpperArm'],   { x: armRot.x, y:  armRot.y, z:  armRot.z })
    set(['RightArm','RightUpperArm'], { x: armRot.x, y: -armRot.y, z: -armRot.z })
    set(['LeftForeArm'],              { x: forearmRot.x, y:  forearmRot.y, z:  forearmRot.z })
    set(['RightForeArm'],             { x: forearmRot.x, y: -forearmRot.y, z: -forearmRot.z })
  })

  return <primitive object={scene} scale={2.0} position={[0, -2.2, 0]} rotation={[0, 0, 0]} />
}

function ArmPanel({ armRot, forearmRot, onChange, onSave, onClose }) {
  const [local, setLocal] = useState({ arm: { ...armRot }, forearm: { ...forearmRot } })

  const update = (part, axis, val) => {
    const next = { ...local, [part]: { ...local[part], [axis]: parseFloat(val) } }
    setLocal(next)
    onChange(next.arm, next.forearm)
  }

  const reset = () => {
    const r = { arm: { ...DEFAULT_ARM }, forearm: { ...DEFAULT_FOREARM } }
    setLocal(r)
    onChange(r.arm, r.forearm)
  }

  const Row = ({ label, part, axis }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
      <span style={{ color: '#888', fontSize: '11px', width: '95px', flexShrink: 0 }}>{label}</span>
      <input type="range" min={-3.14} max={3.14} step={0.01}
        value={local[part][axis]}
        onChange={e => update(part, axis, e.target.value)}
        style={{ flex: 1, accentColor: '#6366f1', cursor: 'pointer' }}
      />
      <span style={{ color: '#ccc', fontSize: '11px', width: '36px', textAlign: 'right', fontFamily: 'monospace' }}>
        {parseFloat(local[part][axis]).toFixed(2)}
      </span>
    </div>
  )

  return (
    <div style={{
      position: 'absolute', top: '50px', right: '12px',
      width: '280px', background: 'rgba(12,12,18,0.98)',
      backdropFilter: 'blur(20px)', borderRadius: '12px',
      padding: '14px', zIndex: 30,
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    }}>
      <div style={{ color: '#fff', fontWeight: '600', fontSize: '12px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>🦾 Control Brațe</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '16px' }}>✕</button>
      </div>
      <div style={{ color: '#6366f1', fontSize: '10px', fontWeight: '600', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Braț superior</div>
      <Row label="X (sus/jos)"    part="arm" axis="x" />
      <Row label="Y (față/spate)" part="arm" axis="y" />
      <Row label="Z (lângă corp)" part="arm" axis="z" />
      <div style={{ color: '#6366f1', fontSize: '10px', fontWeight: '600', margin: '8px 0 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Antebraț</div>
      <Row label="X (îndoire)"  part="forearm" axis="x" />
      <Row label="Y (răsucire)" part="forearm" axis="y" />
      <Row label="Z (lateral)"  part="forearm" axis="z" />
      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        <button onClick={reset} style={{
          flex: 1, padding: '7px', borderRadius: '8px',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          color: '#aaa', fontSize: '11px', cursor: 'pointer',
        }}>↺ Reset</button>
        <button onClick={() => { onSave(local.arm, local.forearm); onClose() }} style={{
          flex: 2, padding: '7px', borderRadius: '8px',
          background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
          border: 'none', color: '#fff', fontSize: '11px', fontWeight: '600', cursor: 'pointer',
        }}>✓ Salvează</button>
      </div>
    </div>
  )
}

export default function AvatarSelect() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null } })()
  const [armRot, setArmRot]         = useState(saved?.arm     || { ...DEFAULT_ARM })
  const [forearmRot, setForearmRot] = useState(saved?.forearm || { ...DEFAULT_FOREARM })
  const [showPanel, setShowPanel]   = useState(false)
  const [hoverBtn, setHoverBtn]     = useState(false)

  if (loading) return null
  if (!user) return <Navigate to="/login" replace />

  const handleSave = (arm, forearm) => {
    setArmRot(arm)
    setForearmRot(forearm)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ arm, forearm }))
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: '#0c0c12',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', position: 'relative', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>

      {/* Gradient subtil în spate */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse 60% 50% at 50% 30%, rgba(99,102,241,0.08) 0%, transparent 70%)',
      }} />

      {/* Linie orizontală decorativă sus */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
        background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.4), transparent)',
      }} />

      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '18px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '18px', fontWeight: '700', color: '#fff', letterSpacing: '-0.3px' }}>
          Kelion<span style={{ color: '#6366f1' }}>AI</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
          <span style={{ color: '#4b5563', fontSize: '12px' }}>Online</span>
        </div>
      </div>

      {/* Layout principal: avatar stânga, text dreapta */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '60px',
        maxWidth: '900px', width: '100%', padding: '0 40px',
      }}>

        {/* Avatar */}
        <div style={{
          position: 'relative', flexShrink: 0,
          width: '360px', height: '520px',
        }}>
          {/* Glow de podea */}
          <div style={{
            position: 'absolute', bottom: '10px', left: '50%', transform: 'translateX(-50%)',
            width: '180px', height: '30px',
            background: 'radial-gradient(ellipse, rgba(99,102,241,0.3) 0%, transparent 70%)',
            filter: 'blur(12px)', borderRadius: '50%',
          }} />

          <Canvas
            camera={{ position: [0, 0.6, 3.5], fov: 42 }}
            style={{ width: '100%', height: '100%' }}
            gl={{ antialias: true, alpha: true }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[2, 4, 3]} intensity={1.8} color="#ffffff" />
            <directionalLight position={[-2, 2, -1]} intensity={0.3} color="#8b9cf4" />
            <pointLight position={[0, 1.5, 2]} intensity={0.6} color="#6366f1" />
            <hemisphereLight skyColor="#b1e1ff" groundColor="#000000" intensity={0.6} />
            <Suspense fallback={null}>
              <AvatarModel armRot={armRot} forearmRot={forearmRot} />
            </Suspense>
            <OrbitControls
              enableZoom={false} enablePan={false}
              minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
              minAzimuthAngle={-Math.PI / 6} maxAzimuthAngle={Math.PI / 6}
            />
          </Canvas>

          {/* Buton brațe */}
          <button
            onClick={() => setShowPanel(p => !p)}
            style={{
              position: 'absolute', top: '12px', right: '12px',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              color: '#888', padding: '5px 10px', borderRadius: '8px',
              fontSize: '11px', cursor: 'pointer', backdropFilter: 'blur(8px)',
              zIndex: 10,
            }}
          >🦾</button>

          {showPanel && (
            <ArmPanel
              armRot={armRot} forearmRot={forearmRot}
              onChange={(a, f) => { setArmRot(a); setForearmRot(f) }}
              onSave={handleSave}
              onClose={() => setShowPanel(false)}
            />
          )}
        </div>

        {/* Text dreapta */}
        <div style={{ flex: 1 }}>
          <p style={{
            fontSize: '11px', fontWeight: '600', letterSpacing: '3px',
            textTransform: 'uppercase', color: '#6366f1', marginBottom: '14px',
          }}>Your AI Assistant</p>

          <h1 style={{
            fontSize: '56px', fontWeight: '800', color: '#fff',
            letterSpacing: '-2px', lineHeight: 1.05, marginBottom: '20px',
          }}>
            Kelion
          </h1>

          <p style={{
            fontSize: '16px', color: '#6b7280', lineHeight: '1.7',
            marginBottom: '32px', maxWidth: '320px',
          }}>
            Intelligent, empathetic and always available. Speak naturally — Kelion understands, responds and helps you in real time.
          </p>

          {/* Features */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '36px' }}>
            {[
              { icon: '🎙', label: 'Natural Voice', desc: 'Advanced speech recognition' },
              { icon: '👁', label: 'AI Vision',     desc: 'Sees and understands your context' },
              { icon: '🌍', label: 'Multilingual',  desc: 'RO, EN, FR, DE, ES, IT, PT, NL, PL, RU, ZH, JA, AR, HI' },
            ].map(f => (
              <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '10px',
                  background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '16px', flexShrink: 0,
                }}>{f.icon}</div>
                <div>
                  <div style={{ color: '#e5e7eb', fontSize: '13px', fontWeight: '600' }}>{f.label}</div>
                  <div style={{ color: '#4b5563', fontSize: '12px' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Avatar buttons */}
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => navigate('/chat/kelion')}
              onMouseEnter={() => setHoverBtn('kelion')}
              onMouseLeave={() => setHoverBtn(false)}
              style={{
                background: hoverBtn === 'kelion' ? '#4f46e5' : '#6366f1',
                border: 'none', borderRadius: '12px', color: '#fff',
                padding: '14px 28px', fontSize: '15px', fontWeight: '600',
                cursor: 'pointer', letterSpacing: '0.2px',
                transition: 'all 0.15s ease',
                boxShadow: hoverBtn === 'kelion' ? '0 8px 24px rgba(99,102,241,0.5)' : '0 4px 16px rgba(99,102,241,0.3)',
                transform: hoverBtn === 'kelion' ? 'translateY(-1px)' : 'translateY(0)',
              }}
            >
              Talk to Kelion →
            </button>
            <button
              onClick={() => navigate('/chat/kira')}
              onMouseEnter={() => setHoverBtn('kira')}
              onMouseLeave={() => setHoverBtn(false)}
              style={{
                background: hoverBtn === 'kira' ? '#db2777' : '#ec4899',
                border: 'none', borderRadius: '12px', color: '#fff',
                padding: '14px 28px', fontSize: '15px', fontWeight: '600',
                cursor: 'pointer', letterSpacing: '0.2px',
                transition: 'all 0.15s ease',
                boxShadow: hoverBtn === 'kira' ? '0 8px 24px rgba(236,72,153,0.5)' : '0 4px 16px rgba(236,72,153,0.3)',
                transform: hoverBtn === 'kira' ? 'translateY(-1px)' : 'translateY(0)',
              }}
            >
              Talk to Kira →
            </button>
          </div>
        </div>
      </div>

      {/* Linie orizontală decorativă jos */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px',
        background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.2), transparent)',
      }} />
    </div>
  )
}
