import { Canvas } from '@react-three/fiber'
import { OrbitControls, useGLTF, Environment } from '@react-three/drei'
import { Suspense } from 'react'

const AVATARS = [
  {
    id: 'kelion',
    name: 'Kelion',
    model: '/kelion-rpm_e27cb94d.glb',
    description: 'Asistent AI masculin',
    color: '#7c3aed',
    glow: '#a855f7',
  },
  {
    id: 'kira',
    name: 'Kira',
    model: '/kira-rpm_54d82b66.glb',
    description: 'Asistent AI feminin',
    color: '#db2777',
    glow: '#f472b6',
  },
]

function AvatarModel({ modelPath }) {
  const { scene } = useGLTF(modelPath)
  return <primitive object={scene} scale={1.8} position={[0, -1.8, 0]} />
}

function AvatarCard({ avatar, onSelect }) {
  return (
    <div
      onClick={() => onSelect(avatar)}
      style={{
        cursor: 'pointer',
        border: `2px solid ${avatar.color}`,
        borderRadius: '20px',
        overflow: 'hidden',
        width: '280px',
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(10px)',
        transition: 'all 0.3s ease',
        boxShadow: `0 0 30px ${avatar.glow}33`,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'scale(1.05)'
        e.currentTarget.style.boxShadow = `0 0 60px ${avatar.glow}66`
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'scale(1)'
        e.currentTarget.style.boxShadow = `0 0 30px ${avatar.glow}33`
      }}
    >
      <div style={{ height: '340px' }}>
        <Canvas camera={{ position: [0, 0.5, 3], fov: 45 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[2, 4, 2]} intensity={1.5} />
          <Environment preset="city" />
          <Suspense fallback={null}>
            <AvatarModel modelPath={avatar.model} />
          </Suspense>
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            autoRotate
            autoRotateSpeed={2}
            minPolarAngle={Math.PI / 3}
            maxPolarAngle={Math.PI / 2}
          />
        </Canvas>
      </div>
      <div style={{ padding: '16px 20px 20px', textAlign: 'center' }}>
        <h2 style={{ fontSize: '28px', fontWeight: '700', color: avatar.glow, marginBottom: '6px' }}>
          {avatar.name}
        </h2>
        <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '16px' }}>
          {avatar.description}
        </p>
        <button
          style={{
            background: `linear-gradient(135deg, ${avatar.color}, ${avatar.glow})`,
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
          Vorbește cu {avatar.name}
        </button>
      </div>
    </div>
  )
}

export default function AvatarSelect({ onSelect }) {
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
          Alege Asistentul Tău AI
        </h1>
        <p style={{ color: '#666', fontSize: '16px' }}>
          Vorbește natural sau scrie — răspunsuri în timp real
        </p>
      </div>

      <div style={{ display: 'flex', gap: '40px', flexWrap: 'wrap', justifyContent: 'center' }}>
        {AVATARS.map(avatar => (
          <AvatarCard key={avatar.id} avatar={avatar} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
