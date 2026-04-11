import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment } from '@react-three/drei'
import { Suspense, useRef, useState, useEffect } from 'react'

const KELION = {
  id: 'kelion',
  name: 'Kelion',
  model: '/kelion-rpm_e27cb94d.glb',
  color: '#7c3aed',
  glow: '#a855f7',
}

// Brațe lipite de corp — valori calibrate pentru modelul RPM
const DEFAULT_ARM     = { x: 0.0, y: 0.0, z: 1.2 }
const DEFAULT_FOREARM = { x: 0.3, y: 0.0, z: 0.0 }
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
  }, [scene])

  useFrame(() => {
    const b = bonesRef.current
    if (!b) return
    const set = (names, rot) => {
      for (const n of names) {
        if (b[n]) { b[n].rotation.x = rot.x; b[n].rotation.y = rot.y; b[n].rotation.z = rot.z; break }
      }
    }
    set(['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm'],   { x: armRot.x,  y:  armRot.y,  z:  armRot.z  })
    set(['RightArm','RightUpperArm','mixamorigRightArm'],   { x: armRot.x,  y: -armRot.y,  z: -armRot.z  })
    set(['LeftForeArm','mixamorigLeftForeArm'],             { x: forearmRot.x, y:  forearmRot.y, z:  forearmRot.z })
    set(['RightForeArm','mixamorigRightForeArm'],           { x: forearmRot.x, y: -forearmRot.y, z: -forearmRot.z })
  })

  return <primitive object={scene} scale={1.8} position={[0, -1.75, 0]} rotation={[0, 0, 0]} />
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
      <span style={{ color: '#999', fontSize: '11px', width: '95px', flexShrink: 0 }}>{label}</span>
      <input type="range" min={-3.14} max={3.14} step={0.01}
        value={local[part][axis]}
        onChange={e => update(part, axis, e.target.value)}
        style={{ flex: 1, accentColor: '#a855f7', cursor: 'pointer' }}
      />
      <span style={{ color: '#fff', fontSize: '11px', width: '36px', textAlign: 'right', fontFamily: 'monospace' }}>
        {parseFloat(local[part][axis]).toFixed(2)}
      </span>
    </div>
  )

  return (
    <div style={{
      position: 'absolute', top: '60px', right: '16px',
      width: '290px', background: 'rgba(10,10,20,0.97)',
      backdropFilter: 'blur(20px)', borderRadius: '16px',
      padding: '16px', zIndex: 30,
      border: '1px solid rgba(168,85,247,0.35)',
      boxShadow: '0 8px 40px rgba(168,85,247,0.15)',
    }}>
      <div style={{ color: '#fff', fontWeight: '700', fontSize: '13px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
        <span>🦾 Control Brațe <span style={{ color: '#555', fontWeight: 400, fontSize: '11px' }}>oglindă</span></span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px', lineHeight: 1 }}>✕</button>
      </div>
      <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: '600', marginBottom: '4px' }}>Braț superior</div>
      <Row label="X (sus/jos)"    part="arm" axis="x" />
      <Row label="Y (față/spate)" part="arm" axis="y" />
      <Row label="Z (lângă corp)" part="arm" axis="z" />
      <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: '600', margin: '8px 0 4px' }}>Antebraț</div>
      <Row label="X (îndoire)"  part="forearm" axis="x" />
      <Row label="Y (răsucire)" part="forearm" axis="y" />
      <Row label="Z (lateral)"  part="forearm" axis="z" />
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <button onClick={reset} style={{
          flex: 1, padding: '8px', borderRadius: '10px',
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)',
          color: '#bbb', fontSize: '12px', cursor: 'pointer',
        }}>↺ Reset</button>
        <button onClick={() => { onSave(local.arm, local.forearm); onClose() }} style={{
          flex: 2, padding: '8px', borderRadius: '10px',
          background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
          border: 'none', color: '#fff', fontSize: '12px', fontWeight: '600', cursor: 'pointer',
        }}>✓ Salvează & Închide</button>
      </div>
    </div>
  )
}

export default function AvatarSelect({ onSelect }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null } })()
  const [armRot, setArmRot]       = useState(saved?.arm     || { ...DEFAULT_ARM })
  const [forearmRot, setForearmRot] = useState(saved?.forearm || { ...DEFAULT_FOREARM })
  const [showPanel, setShowPanel] = useState(false)
  const [pulse, setPulse]         = useState(false)

  // Pulsare subtilă a glow-ului
  useEffect(() => {
    const id = setInterval(() => setPulse(p => !p), 2000)
    return () => clearInterval(id)
  }, [])

  const handleSave = (arm, forearm) => {
    setArmRot(arm)
    setForearmRot(forearm)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ arm, forearm }))
  }

  return (
    <div style={{
      width: '100vw', height: '100vh',
      background: 'radial-gradient(ellipse at 50% 0%, #1a0533 0%, #0d0d18 50%, #0a0a0f 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', position: 'relative',
    }}>

      {/* Particule de fundal decorative */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: `${[300,200,400,150,250,180][i]}px`,
            height: `${[300,200,400,150,250,180][i]}px`,
            borderRadius: '50%',
            background: `radial-gradient(circle, rgba(168,85,247,${[0.04,0.03,0.02,0.05,0.03,0.04][i]}) 0%, transparent 70%)`,
            left: `${[10,60,30,80,5,50][i]}%`,
            top: `${[20,60,80,10,50,30][i]}%`,
            transform: 'translate(-50%,-50%)',
          }} />
        ))}
      </div>

      {/* Header mic */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, transparent 100%)',
      }}>
        <span style={{
          fontSize: '20px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>KelionAI</span>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: '#22c55e',
            boxShadow: '0 0 8px #22c55e',
            animation: 'blink 2s infinite',
          }} />
          <span style={{ color: '#666', fontSize: '12px' }}>Online</span>
        </div>
      </div>

      {/* Conținut principal */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0px', zIndex: 1 }}>

        {/* Titlu */}
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <h1 style={{
            fontSize: '16px', fontWeight: '600', letterSpacing: '4px',
            textTransform: 'uppercase', color: '#a855f7', marginBottom: '6px',
          }}>Asistentul tău AI</h1>
        </div>

        {/* Container avatar cu glow */}
        <div style={{
          position: 'relative',
          width: '380px', height: '480px',
        }}>
          {/* Glow sub avatar */}
          <div style={{
            position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
            width: '200px', height: '40px',
            background: `radial-gradient(ellipse, rgba(168,85,247,${pulse ? 0.4 : 0.25}) 0%, transparent 70%)`,
            filter: 'blur(15px)',
            transition: 'all 2s ease',
            borderRadius: '50%',
          }} />

          {/* Canvas 3D */}
          <Canvas
            camera={{ position: [0, 0.3, 2.8], fov: 42 }}
            style={{ width: '100%', height: '100%' }}
            gl={{ antialias: true, alpha: true }}
          >
            <ambientLight intensity={0.5} />
            <directionalLight position={[3, 5, 3]} intensity={1.6} />
            <directionalLight position={[-2, 3, -1]} intensity={0.4} />
            <pointLight position={[0, 1, 2]} intensity={pulse ? 1.2 : 0.7} color="#a855f7" />
            <Environment preset="city" />
            <Suspense fallback={null}>
              <AvatarModel armRot={armRot} forearmRot={forearmRot} />
            </Suspense>
            <OrbitControls
              enableZoom={false} enablePan={false}
              minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
              minAzimuthAngle={-Math.PI / 5} maxAzimuthAngle={Math.PI / 5}
            />
          </Canvas>

          {/* Buton brațe */}
          <button
            onClick={() => setShowPanel(p => !p)}
            style={{
              position: 'absolute', top: '12px', right: '12px',
              background: showPanel ? 'rgba(168,85,247,0.3)' : 'rgba(0,0,0,0.5)',
              border: `1px solid ${showPanel ? '#a855f7' : 'rgba(255,255,255,0.15)'}`,
              color: '#fff', padding: '5px 12px', borderRadius: '20px',
              fontSize: '12px', cursor: 'pointer', backdropFilter: 'blur(10px)',
              zIndex: 10,
            }}
          >🦾 Brațe</button>

          {/* Panou control brațe */}
          {showPanel && (
            <ArmPanel
              armRot={armRot} forearmRot={forearmRot}
              onChange={(a, f) => { setArmRot(a); setForearmRot(f) }}
              onSave={handleSave}
              onClose={() => setShowPanel(false)}
            />
          )}
        </div>

        {/* Nume + descriere */}
        <div style={{ textAlign: 'center', marginTop: '-10px' }}>
          <h2 style={{
            fontSize: '42px', fontWeight: '800', letterSpacing: '-1px',
            background: 'linear-gradient(135deg, #e2c4ff, #a855f7, #f472b6)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: '10px',
          }}>Kelion</h2>

          <p style={{
            color: '#888', fontSize: '15px', lineHeight: '1.7',
            maxWidth: '340px', margin: '0 auto 24px',
          }}>
            Inteligent. Empatic. Mereu disponibil.<br />
            Vorbește natural — Kelion înțelege, răspunde și te ajută în timp real.
          </p>

          {/* Taguri */}
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '28px', flexWrap: 'wrap' }}>
            {['🎙 Voce naturală', '👁 Viziune AI', '🌍 Multilingv', '⚡ Timp real'].map(tag => (
              <span key={tag} style={{
                background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)',
                color: '#c084fc', fontSize: '12px', padding: '4px 12px', borderRadius: '20px',
              }}>{tag}</span>
            ))}
          </div>

          {/* Buton principal */}
          <button
            onClick={() => onSelect(KELION)}
            style={{
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '50px', color: '#fff',
              padding: '14px 48px', fontSize: '16px', fontWeight: '700',
              cursor: 'pointer', letterSpacing: '0.3px',
              boxShadow: '0 8px 32px rgba(168,85,247,0.4)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 12px 40px rgba(168,85,247,0.6)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(168,85,247,0.4)' }}
          >
            Vorbește cu Kelion
          </button>
        </div>
      </div>

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  )
}
