import { useEffect, useRef, useState } from 'react'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'

// Componenta care expune oasele din model
export function AvatarModelDebug({ modelPath, debugConfig, onBonesReady }) {
  const { scene } = useGLTF(modelPath)
  const bonesRef = useRef({})

  useEffect(() => {
    const bones = {}
    scene.traverse((obj) => {
      if (obj.isBone || obj.type === 'Bone') {
        bones[obj.name] = obj
      }
      // RPM foloseste SkinnedMesh cu skeleton
      if (obj.isSkinnedMesh && obj.skeleton) {
        obj.skeleton.bones.forEach(b => {
          bones[b.name] = b
        })
      }
    })
    bonesRef.current = bones
    if (onBonesReady) onBonesReady(Object.keys(bones))
  }, [scene, onBonesReady])

  // Aplica rotatii din debugConfig
  useEffect(() => {
    if (!debugConfig) return
    const { leftArm, rightArm } = debugConfig

    // Nume comune RPM pentru brate
    const leftBoneNames = ['LeftArm', 'LeftUpperArm', 'mixamorigLeftArm', 'Left_Arm']
    const rightBoneNames = ['RightArm', 'RightUpperArm', 'mixamorigRightArm', 'Right_Arm']
    const leftForeNames = ['LeftForeArm', 'mixamorigLeftForeArm', 'Left_ForeArm']
    const rightForeNames = ['RightForeArm', 'mixamorigRightForeArm', 'Right_ForeArm']

    const applyRot = (names, rot) => {
      for (const name of names) {
        const bone = bonesRef.current[name]
        if (bone) {
          bone.rotation.x = rot.x
          bone.rotation.y = rot.y
          bone.rotation.z = rot.z
          break
        }
      }
    }

    applyRot(leftBoneNames, leftArm)
    applyRot(rightBoneNames, rightArm)
  }, [debugConfig])

  return (
    <primitive
      object={scene}
      scale={debugConfig?.scale || 1.8}
      position={[debugConfig?.posX || 0, debugConfig?.posY || -1.8, debugConfig?.posZ || 0]}
    />
  )
}

// Panoul de debug - randat in afara Canvas
export function DebugPanel({ visible, avatarColor, avatarGlow, onConfigChange, boneNames }) {
  const [scale, setScale] = useState(1.8)
  const [posX, setPosX] = useState(0)
  const [posY, setPosY] = useState(-1.8)
  const [posZ, setPosZ] = useState(0)
  const [selectedArm, setSelectedArm] = useState('left')
  const [leftArm, setLeftArm] = useState({ x: 0, y: 0, z: 0 })
  const [rightArm, setRightArm] = useState({ x: 0, y: 0, z: 0 })
  const [showBones, setShowBones] = useState(false)

  useEffect(() => {
    onConfigChange({ scale, posX, posY, posZ, leftArm, rightArm })
  }, [scale, posX, posY, posZ, leftArm, rightArm])

  if (!visible) return null

  const currentArm = selectedArm === 'left' ? leftArm : rightArm
  const setCurrentArm = selectedArm === 'left' ? setLeftArm : setRightArm

  const coordsText = `// Coordonate finale
scale: ${scale.toFixed(2)}
position: [${posX.toFixed(3)}, ${posY.toFixed(3)}, ${posZ.toFixed(3)}]
leftArm:  { x: ${leftArm.x.toFixed(3)}, y: ${leftArm.y.toFixed(3)}, z: ${leftArm.z.toFixed(3)} }
rightArm: { x: ${rightArm.x.toFixed(3)}, y: ${rightArm.y.toFixed(3)}, z: ${rightArm.z.toFixed(3)} }`

  const sliderStyle = (color) => ({
    width: '100%', accentColor: color, cursor: 'pointer',
  })

  const labelStyle = { color: '#aaa', fontSize: '11px', marginBottom: '2px' }

  const rowStyle = { marginBottom: '10px' }

  return (
    <div style={{
      position: 'absolute', top: '60px', left: '10px', zIndex: 100,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)',
      border: `1px solid ${avatarColor}66`,
      borderRadius: '14px', padding: '14px', width: '260px',
      color: '#fff', fontSize: '12px',
    }}>
      <div style={{ fontWeight: '700', marginBottom: '12px', color: avatarGlow, fontSize: '13px' }}>
        🔧 Debug Panel
      </div>

      {/* ZOOM / SCALE */}
      <div style={rowStyle}>
        <div style={labelStyle}>Zoom / Scale: <b>{scale.toFixed(2)}</b></div>
        <input type="range" min="0.5" max="4" step="0.05"
          value={scale} onChange={e => setScale(Number(e.target.value))}
          style={sliderStyle(avatarGlow)} />
      </div>

      {/* POZITIE */}
      <div style={{ marginBottom: '12px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px' }}>
        <div style={{ ...labelStyle, marginBottom: '6px', color: '#fff' }}>📍 Poziție Avatar</div>
        <div style={rowStyle}>
          <div style={labelStyle}>X: <b>{posX.toFixed(3)}</b></div>
          <input type="range" min="-3" max="3" step="0.01"
            value={posX} onChange={e => setPosX(Number(e.target.value))}
            style={sliderStyle('#60a5fa')} />
        </div>
        <div style={rowStyle}>
          <div style={labelStyle}>Y: <b>{posY.toFixed(3)}</b></div>
          <input type="range" min="-4" max="2" step="0.01"
            value={posY} onChange={e => setPosY(Number(e.target.value))}
            style={sliderStyle('#34d399')} />
        </div>
        <div style={rowStyle}>
          <div style={labelStyle}>Z: <b>{posZ.toFixed(3)}</b></div>
          <input type="range" min="-3" max="3" step="0.01"
            value={posZ} onChange={e => setPosZ(Number(e.target.value))}
            style={sliderStyle('#f87171')} />
        </div>
      </div>

      {/* BRATE */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px', marginBottom: '10px' }}>
        <div style={{ ...labelStyle, color: '#fff', marginBottom: '8px' }}>💪 Rotație Brațe</div>

        {/* Selector brat */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
          {['left', 'right'].map(side => (
            <button key={side}
              onClick={() => setSelectedArm(side)}
              style={{
                flex: 1, padding: '5px', borderRadius: '8px', border: 'none',
                cursor: 'pointer', fontSize: '11px', fontWeight: '600',
                background: selectedArm === side
                  ? `linear-gradient(135deg, ${avatarColor}, ${avatarGlow})`
                  : 'rgba(255,255,255,0.1)',
                color: '#fff',
              }}
            >
              {side === 'left' ? '← Stâng' : 'Drept →'}
            </button>
          ))}
        </div>

        {/* Slidere rotatie */}
        {['x', 'y', 'z'].map(axis => (
          <div key={axis} style={rowStyle}>
            <div style={labelStyle}>
              {axis.toUpperCase()} rot ({selectedArm}): <b>{currentArm[axis].toFixed(3)}</b>
              <span style={{ color: '#666', marginLeft: '4px' }}>
                ({(currentArm[axis] * 180 / Math.PI).toFixed(1)}°)
              </span>
            </div>
            <input type="range"
              min={-Math.PI} max={Math.PI} step="0.01"
              value={currentArm[axis]}
              onChange={e => setCurrentArm(prev => ({ ...prev, [axis]: Number(e.target.value) }))}
              style={sliderStyle(axis === 'x' ? '#60a5fa' : axis === 'y' ? '#34d399' : '#f87171')} />
          </div>
        ))}

        {/* Copiere valori stang→drept sau invers */}
        <button
          onClick={() => {
            if (selectedArm === 'left') setRightArm({ ...leftArm })
            else setLeftArm({ ...rightArm })
          }}
          style={{
            width: '100%', padding: '5px', borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.05)', color: '#aaa',
            cursor: 'pointer', fontSize: '11px', marginBottom: '6px',
          }}
        >
          Copiază {selectedArm === 'left' ? 'Stâng → Drept' : 'Drept → Stâng'}
        </button>

        {/* Reset brat curent */}
        <button
          onClick={() => setCurrentArm({ x: 0, y: 0, z: 0 })}
          style={{
            width: '100%', padding: '5px', borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.05)', color: '#aaa',
            cursor: 'pointer', fontSize: '11px',
          }}
        >
          Reset {selectedArm === 'left' ? 'Stâng' : 'Drept'}
        </button>
      </div>

      {/* Bones list toggle */}
      {boneNames && boneNames.length > 0 && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '8px', marginBottom: '10px' }}>
          <button
            onClick={() => setShowBones(!showBones)}
            style={{
              width: '100%', padding: '4px', borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.05)', color: '#888',
              cursor: 'pointer', fontSize: '10px',
            }}
          >
            {showBones ? '▲' : '▼'} Bones ({boneNames.length})
          </button>
          {showBones && (
            <div style={{
              maxHeight: '100px', overflowY: 'auto', marginTop: '6px',
              background: 'rgba(0,0,0,0.4)', borderRadius: '6px', padding: '6px',
            }}>
              {boneNames.map(b => (
                <div key={b} style={{ color: '#666', fontSize: '10px', lineHeight: '1.6' }}>{b}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Coordonate finale de copiat */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px' }}>
        <div style={{ ...labelStyle, marginBottom: '6px', color: avatarGlow }}>📋 Coordonate (copiază)</div>
        <pre style={{
          background: 'rgba(0,0,0,0.5)', padding: '8px', borderRadius: '8px',
          fontSize: '10px', color: '#86efac', lineHeight: '1.6',
          whiteSpace: 'pre-wrap', userSelect: 'all', cursor: 'text',
        }}>
          {coordsText}
        </pre>
        <button
          onClick={() => navigator.clipboard?.writeText(coordsText)}
          style={{
            width: '100%', marginTop: '6px', padding: '5px', borderRadius: '8px',
            border: 'none', background: `${avatarColor}88`,
            color: '#fff', cursor: 'pointer', fontSize: '11px',
          }}
        >
          📋 Copiază
        </button>
      </div>
    </div>
  )
}
