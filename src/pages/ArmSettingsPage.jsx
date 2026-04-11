import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment } from '@react-three/drei'
import { Suspense, useRef, useState } from 'react'

const KELION_MODEL = '/kelion-rpm_e27cb94d.glb'
const DEFAULT_ARM     = { x: 0.0, y: 0.0, z: 1.2 }
const DEFAULT_FOREARM = { x: 0.3, y: 0.0, z: 0.0 }
const STORAGE_KEY = 'arm_rot_kelion'

function AvatarModel({ armRot, forearmRot }) {
  const { scene } = useGLTF(KELION_MODEL)
  const bonesRef = useRef(null)

  useFrame(() => {
    if (!bonesRef.current) {
      const bones = {}
      scene.traverse((obj) => {
        if (obj.isBone || obj.type === 'Bone') bones[obj.name] = obj
        if (obj.isSkinnedMesh && obj.skeleton) {
          obj.skeleton.bones.forEach(b => { bones[b.name] = b })
        }
      })
      if (Object.keys(bones).length > 0) bonesRef.current = bones
    }
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

function Slider({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
      <span style={{ color: '#999', fontSize: '13px', width: '120px', flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={-3.14} max={3.14} step={0.01}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: '#a855f7', cursor: 'pointer' }}
      />
      <span style={{ color: '#ccc', fontSize: '13px', width: '50px', textAlign: 'right', fontFamily: 'monospace' }}>
        {value.toFixed(2)}
      </span>
    </div>
  )
}

export default function ArmSettingsPage({ onNavigate }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) } catch { return null } })()
  const [armRot, setArmRot]         = useState(saved?.arm     || { ...DEFAULT_ARM })
  const [forearmRot, setForearmRot] = useState(saved?.forearm || { ...DEFAULT_FOREARM })
  const [saved_, setSaved_]         = useState(false)

  const updateArm = (axis, val) => {
    setArmRot(prev => ({ ...prev, [axis]: val }))
    setSaved_(false)
  }
  const updateForearm = (axis, val) => {
    setForearmRot(prev => ({ ...prev, [axis]: val }))
    setSaved_(false)
  }

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ arm: armRot, forearm: forearmRot }))
    // Also save to the landing page key so it syncs
    localStorage.setItem('arm_rot_landing', JSON.stringify({ arm: armRot, forearm: forearmRot }))
    setSaved_(true)
  }

  const handleReset = () => {
    setArmRot({ ...DEFAULT_ARM })
    setForearmRot({ ...DEFAULT_FOREARM })
    setSaved_(false)
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex',
      background: '#0a0a0f', fontFamily: "'Inter', system-ui, sans-serif", overflow: 'hidden',
    }}>
      {/* Avatar — left side */}
      <div style={{ flex: '0 0 55%', height: '100%', position: 'relative' }}>
        <Canvas
          camera={{ position: [0, 0.3, 3.5], fov: 45 }}
          style={{ width: '100%', height: '100%' }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={['#0a0a0f']} />
          <ambientLight intensity={0.6} />
          <directionalLight position={[2, 4, 2]} intensity={1.5} />
          <pointLight position={[0, 1, 2]} intensity={0.8} color="#a855f7" />
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

        {/* Back button */}
        <button
          onClick={() => onNavigate('dashboard')}
          style={{
            position: 'absolute', top: '16px', left: '16px',
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '10px', color: '#ccc', padding: '8px 16px',
            fontSize: '13px', cursor: 'pointer', backdropFilter: 'blur(8px)', zIndex: 10,
          }}
        >
          ← Back
        </button>
      </div>

      {/* Sliders — right side */}
      <div style={{
        flex: '0 0 45%', height: '100%', padding: '40px',
        borderLeft: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        overflowY: 'auto',
      }}>
        <h2 style={{ fontSize: '24px', fontWeight: '800', color: '#fff', marginBottom: '8px' }}>
          Arm Settings
        </h2>
        <p style={{ color: '#666', fontSize: '14px', marginBottom: '28px' }}>
          Adjust the avatar arm positions. Changes are visible in real time. Press Save to apply everywhere.
        </p>

        <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
          Upper Arm
        </div>
        <Slider label="X (up/down)"    value={armRot.x} onChange={v => updateArm('x', v)} />
        <Slider label="Y (front/back)" value={armRot.y} onChange={v => updateArm('y', v)} />
        <Slider label="Z (body side)"  value={armRot.z} onChange={v => updateArm('z', v)} />

        <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '1.5px', margin: '20px 0 10px' }}>
          Forearm
        </div>
        <Slider label="X (bend)"    value={forearmRot.x} onChange={v => updateForearm('x', v)} />
        <Slider label="Y (twist)"   value={forearmRot.y} onChange={v => updateForearm('y', v)} />
        <Slider label="Z (lateral)" value={forearmRot.z} onChange={v => updateForearm('z', v)} />

        <div style={{ display: 'flex', gap: '12px', marginTop: '28px' }}>
          <button
            onClick={handleReset}
            style={{
              flex: 1, padding: '12px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#aaa', fontSize: '14px', cursor: 'pointer',
            }}
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 2, padding: '12px', borderRadius: '10px',
              background: saved_ ? 'linear-gradient(135deg, #16a34a, #22c55e)' : 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', color: '#fff', fontSize: '14px', fontWeight: '700', cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {saved_ ? 'Saved!' : 'Save'}
          </button>
        </div>

        {/* Current values display */}
        <div style={{
          marginTop: '20px', background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px',
          padding: '12px', fontFamily: 'monospace', fontSize: '11px', color: '#666',
        }}>
          Arm: x={armRot.x.toFixed(2)} y={armRot.y.toFixed(2)} z={armRot.z.toFixed(2)}<br/>
          Forearm: x={forearmRot.x.toFixed(2)} y={forearmRot.y.toFixed(2)} z={forearmRot.z.toFixed(2)}
        </div>
      </div>
    </div>
  )
}
