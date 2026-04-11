import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment } from '@react-three/drei'
import { Suspense, useRef, useState, useEffect } from 'react'

const KELION = {
  id: 'kelion',
  name: 'Kelion',
  model: '/kelion-rpm_e27cb94d.glb',
  description: 'Asistentul tău AI',
  color: '#7c3aed',
  glow: '#a855f7',
}

const DEFAULT_ARM = { x: 0.0, y: 0.0, z: 1.2 }
const DEFAULT_FOREARM = { x: 0.3, y: 0.0, z: 0.0 }
const STORAGE_KEY = 'arm_rot_kelion'

function AvatarModel({ modelPath, armRot, forearmRot }) {
  const { scene } = useGLTF(modelPath)
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
    const bones = bonesRef.current
    if (!bones) return
    const applyRot = (nameList, rot) => {
      for (const name of nameList) {
        const bone = bones[name]
        if (bone) { bone.rotation.x = rot.x; bone.rotation.y = rot.y; bone.rotation.z = rot.z; break }
      }
    }
    applyRot(['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm'], { x: armRot.x, y: armRot.y, z: armRot.z })
    applyRot(['RightArm', 'RightUpperArm', 'mixamorigRightArm'], { x: armRot.x, y: -armRot.y, z: -armRot.z })
    applyRot(['LeftForeArm', 'mixamorigLeftForeArm'], { x: forearmRot.x, y: forearmRot.y, z: forearmRot.z })
    applyRot(['RightForeArm', 'mixamorigRightForeArm'], { x: forearmRot.x, y: -forearmRot.y, z: -forearmRot.z })
  })

  return <primitive object={scene} scale={1.6} position={[0, -1.6, 0]} rotation={[0, 0, 0]} />
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

  const SliderRow = ({ label, part, axis }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
      <span style={{ color: '#999', fontSize: '11px', width: '90px', flexShrink: 0 }}>{label}</span>
      <input
        type="range" min={-3.14} max={3.14} step={0.01}
        value={local[part][axis]}
        onChange={e => update(part, axis, e.target.value)}
        style={{ flex: 1, accentColor: '#a855f7', cursor: 'pointer' }}
      />
      <span style={{ color: '#fff', fontSize: '11px', width: '38px', textAlign: 'right', fontFamily: 'monospace' }}>
        {parseFloat(local[part][axis]).toFixed(2)}
      </span>
    </div>
  )

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(16px)',
      borderRadius: '18px', padding: '18px', zIndex: 20,
      display: 'flex', flexDirection: 'column', gap: '6px',
    }}>
      <div style={{ color: '#fff', fontWeight: '700', fontSize: '14px', marginBottom: '4px' }}>
        🦾 Control Brațe
        <span style={{ color: '#666', fontWeight: '400', fontSize: '11px', marginLeft: '8px' }}>oglindă automată</span>
      </div>

      <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: '600', marginBottom: '2px' }}>Braț superior</div>
      <SliderRow label="X (sus/jos)" part="arm" axis="x" />
      <SliderRow label="Y (față/spate)" part="arm" axis="y" />
      <SliderRow label="Z (lângă corp)" part="arm" axis="z" />

      <div style={{ color: '#a855f7', fontSize: '11px', fontWeight: '600', margin: '6px 0 2px' }}>Antebraț</div>
      <SliderRow label="X (îndoire)" part="forearm" axis="x" />
      <SliderRow label="Y (răsucire)" part="forearm" axis="y" />
      <SliderRow label="Z (lateral)" part="forearm" axis="z" />

      <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
        <button onClick={reset} style={{
          flex: 1, padding: '8px', borderRadius: '10px',
          background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
          color: '#ccc', fontSize: '12px', cursor: 'pointer',
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
  const [armRot, setArmRot] = useState(saved?.arm || { ...DEFAULT_ARM })
  const [forearmRot, setForearmRot] = useState(saved?.forearm || { ...DEFAULT_FOREARM })
  const [showPanel, setShowPanel] = useState(false)

  const handleSave = (arm, forearm) => {
    setArmRot(arm)
    setForearmRot(forearm)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ arm, forearm }))
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex',
      flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #1a0533 0%, #0a0a0f 70%)', gap: '40px',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          fontSize: '42px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          marginBottom: '10px', letterSpacing: '-1px',
        }}>Asistentul Tău AI</h1>
        <p style={{ color: '#666', fontSize: '16px' }}>Vorbește natural sau scrie — răspunsuri în timp real</p>
      </div>

      <div style={{
        border: `2px solid ${KELION.color}`, borderRadius: '20px', overflow: 'hidden',
        width: '320px', background: 'rgba(255,255,255,0.04)', backdropFilter: 'blur(10px)',
        boxShadow: `0 0 30px ${KELION.glow}33`, position: 'relative',
      }}>
        <div style={{ height: '380px', position: 'relative' }}>
          <Canvas camera={{ position: [0, 0.5, 3.0], fov: 45 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[2, 4, 2]} intensity={1.8} />
            <directionalLight position={[-2, 2, -2]} intensity={0.5} />
            <Environment preset="city" />
            <Suspense fallback={null}>
              <AvatarModel modelPath={KELION.model} armRot={armRot} forearmRot={forearmRot} />
            </Suspense>
            <OrbitControls
              enableZoom={false} enablePan={false} autoRotate={false}
              enableRotate={true}
              minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
            />
          </Canvas>

          {/* Buton Brațe */}
          {!showPanel && (
            <button
              onClick={() => setShowPanel(true)}
              style={{
                position: 'absolute', top: '10px', right: '10px', zIndex: 10,
                background: 'rgba(124,58,237,0.8)', border: '1px solid #a855f7',
                borderRadius: '20px', color: '#fff', padding: '6px 14px',
                fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                backdropFilter: 'blur(8px)',
              }}
            >🦾 Brațe</button>
          )}

          {/* Panou control brațe */}
          {showPanel && (
            <ArmPanel
              armRot={armRot}
              forearmRot={forearmRot}
              onChange={(arm, forearm) => { setArmRot(arm); setForearmRot(forearm) }}
              onSave={handleSave}
              onClose={() => setShowPanel(false)}
            />
          )}
        </div>

        <div style={{ padding: '16px 20px 20px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '28px', fontWeight: '700', color: KELION.glow, marginBottom: '6px' }}>
            {KELION.name}
          </h2>
          <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '16px' }}>
            {KELION.description}
          </p>
          <button
            onClick={() => onSelect(KELION)}
            style={{
              background: `linear-gradient(135deg, ${KELION.color}, ${KELION.glow})`,
              border: 'none', borderRadius: '30px', color: '#fff',
              padding: '10px 32px', fontSize: '15px', fontWeight: '600',
              cursor: 'pointer', width: '100%',
            }}
          >Vorbește cu Kelion</button>
        </div>
      </div>
    </div>
  )
}
