import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment } from '@react-three/drei'
import { Suspense, useRef, useState } from 'react'

const KELION = {
  id: 'kelion',
  name: 'Kelion',
  model: '/kelion-rpm_e27cb94d.glb',
  description: 'Asistentul tău AI',
  color: '#7c3aed',
  glow: '#a855f7',
}

function AvatarModel({ modelPath, scale, posY }) {
  const { scene } = useGLTF(modelPath)
  return <primitive object={scene} scale={scale} position={[0, posY, 0]} rotation={[0, 0, 0]} />
}

function ZoomControls({ zoom, setZoom }) {
  const step = 0.15
  const min = 0.8
  const max = 2.8
  return (
    <div style={{
      position: 'absolute',
      bottom: '12px',
      right: '12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px',
      zIndex: 10,
    }}>
      <button
        onClick={e => { e.stopPropagation(); setZoom(z => Math.min(z + step, max)) }}
        style={btnStyle}
        title="Zoom in"
      >+</button>
      <button
        onClick={e => { e.stopPropagation(); setZoom(z => Math.max(z - step, min)) }}
        style={btnStyle}
        title="Zoom out"
      >−</button>
      <button
        onClick={e => { e.stopPropagation(); setZoom(1.6) }}
        style={{ ...btnStyle, fontSize: '10px', padding: '4px 6px' }}
        title="Reset zoom"
      >↺</button>
    </div>
  )
}

const btnStyle = {
  background: 'rgba(168,85,247,0.7)',
  border: '1px solid #a855f7',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '18px',
  fontWeight: '700',
  cursor: 'pointer',
  padding: '4px 10px',
  lineHeight: '1',
  backdropFilter: 'blur(4px)',
}

export default function AvatarSelect({ onSelect }) {
  const [zoom, setZoom] = useState(1.6)
  // scale și posY se calculează din zoom
  const scale = zoom
  const posY = -(zoom * 1.0)

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, #1a0533 0%, #0a0a0f 70%)',
      gap: '40px',
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          fontSize: '42px',
          fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          marginBottom: '10px',
          letterSpacing: '-1px',
        }}>
          Asistentul Tău AI
        </h1>
        <p style={{ color: '#666', fontSize: '16px' }}>
          Vorbește natural sau scrie — răspunsuri în timp real
        </p>
      </div>

      <div
        style={{
          cursor: 'pointer',
          border: `2px solid ${KELION.color}`,
          borderRadius: '20px',
          overflow: 'hidden',
          width: '320px',
          background: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(10px)',
          boxShadow: `0 0 30px ${KELION.glow}33`,
          position: 'relative',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.boxShadow = `0 0 60px ${KELION.glow}66`
        }}
        onMouseLeave={e => {
          e.currentTarget.style.boxShadow = `0 0 30px ${KELION.glow}33`
        }}
      >
        <div style={{ height: '380px', position: 'relative' }}>
          <Canvas camera={{ position: [0, 0.8, 2.8], fov: 40 }}>
            <ambientLight intensity={0.6} />
            <directionalLight position={[2, 4, 2]} intensity={1.8} />
            <directionalLight position={[-2, 2, -2]} intensity={0.5} />
            <Environment preset="city" />
            <Suspense fallback={null}>
              <AvatarModel modelPath={KELION.model} scale={scale} posY={posY} />
            </Suspense>
            <OrbitControls
              enableZoom={false}
              enablePan={false}
              autoRotate={false}
              enableRotate={true}
              minPolarAngle={Math.PI / 4}
              maxPolarAngle={Math.PI / 1.8}
            />
          </Canvas>
          <ZoomControls zoom={zoom} setZoom={setZoom} />
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
              border: 'none',
              borderRadius: '30px',
              color: '#fff',
              padding: '10px 32px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer',
              width: '100%',
            }}
          >
            Vorbește cu Kelion
          </button>
        </div>
      </div>
    </div>
  )
}
