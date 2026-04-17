import { Suspense, useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { api } from '../lib/api'

const KELION_MODEL = '/kelion-rpm_e27cb94d.glb'
const DEFAULT_ARM     = { x: 1.3, y: 0.0, z: 0.15 }
const DEFAULT_FOREARM = { x: 0.4, y: 0.0, z: 0.0 }

function getSavedArm() {
  try {
    const data = JSON.parse(localStorage.getItem('arm_rot_kelion') || 'null')
    if (data && data.arm && data.forearm) return data
  } catch {}
  return { arm: { ...DEFAULT_ARM }, forearm: { ...DEFAULT_FOREARM } }
}

function KelionModel({ armRot, forearmRot }) {
  const { scene } = useGLTF(KELION_MODEL)
  const bonesRef = useRef(null)

  useEffect(() => {
    const bones = {}
    scene.traverse((obj) => {
      if (obj.isBone || obj.type === 'Bone') bones[obj.name] = obj
      if (obj.isSkinnedMesh && obj.skeleton) {
        obj.skeleton.bones.forEach(b => { bones[b.name] = b })
      }
    })
    bonesRef.current = bones
    const setRot = (names, x, y, z) => {
      for (const n of names) {
        if (bones[n]) { bones[n].rotation.set(x, y, z); break }
      }
    }
    setRot(['LeftArm', 'LeftUpperArm'],   armRot.x,  armRot.y,  armRot.z)
    setRot(['RightArm', 'RightUpperArm'], armRot.x, -armRot.y, -armRot.z)
    setRot(['LeftForeArm'],               forearmRot.x,  forearmRot.y,  forearmRot.z)
    setRot(['RightForeArm'],              forearmRot.x, -forearmRot.y, -forearmRot.z)
  }, [scene, armRot, forearmRot])

  useFrame(() => {
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

/**
 * Minimal landing page — stripped of demo/plans/referral/admin/email+pw
 * per product pivot. The product flow is:
 *   Landing → Try free 15 min → (trial expires) → Sign in with Google →
 *   (subscription system coming next) → continue using.
 *
 * Email+password login is still supported by the backend at
 * POST /auth/local/login but is intentionally not surfaced in this UI —
 * the product targets mobile-first auth (Google/Apple) for web+iOS+Android.
 */
export default function LandingPage() {
  const navigate = useNavigate()
  const saved = getSavedArm()
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.get('/auth/me').then(u => { if (u) setUser(u) }).catch(() => {})
  }, [])

  async function handleLogout() {
    try { await api.post('/auth/logout') } catch {}
    setUser(null)
  }

  function handleStartChat() {
    // No auth gate — anyone can start chat. If the user is signed in we
    // use their authenticated token (/api/realtime/token); if not, the
    // chat falls back to the public trial (/api/realtime/trial-token,
    // capped at 15 min server-side).
    navigate('/chat')
  }

  function handleSignIn() {
    // Full-page redirect so the OAuth callback can set cookies properly.
    window.location.href = '/auth/google/start?mode=web'
  }

  return (
    <div style={{
      width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0a0a0f', fontFamily: "'Inter', sans-serif", overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 40px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)',
        position: 'relative', zIndex: 10, flexShrink: 0,
      }}>
        <span style={{
          fontSize: '22px', fontWeight: '800',
          background: 'linear-gradient(135deg, #a855f7, #f472b6)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>KelionAI</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {user ? (
            <>
              <span style={{ color: '#aaa', fontSize: '13px' }}>{user.name || user.email}</span>
              <button onClick={handleLogout} style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: '8px', color: '#ef4444', padding: '6px 14px', cursor: 'pointer',
                fontSize: '13px', fontWeight: '600',
              }}>Sign out</button>
            </>
          ) : (
            <button onClick={handleSignIn} style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              background: '#fff', border: 'none',
              borderRadius: '8px', color: '#111', padding: '7px 16px',
              cursor: 'pointer', fontSize: '13px', fontWeight: '600',
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38z"/>
              </svg>
              Sign in with Google
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '4px' }}>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
            <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: '600' }}>Online</span>
          </div>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: '0 0 52%', position: 'relative' }}>
          <Canvas camera={{ position: [0, 0.3, 3.5], fov: 45 }} style={{ width: '100%', height: '100%' }} gl={{ antialias: true }}>
            <color attach="background" args={['#0a0a0f']} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[2, 4, 2]} intensity={1.5} />
            <pointLight position={[0, 1, 2]} intensity={0.8} color="#a855f7" />
            <Suspense fallback={null}>
              <hemisphereLight skyColor="#b1e1ff" groundColor="#000000" intensity={0.6} />
              <KelionModel armRot={saved.arm} forearmRot={saved.forearm} />
            </Suspense>
            <OrbitControls enableZoom={false} enablePan={false}
              minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 1.8}
              minAzimuthAngle={-Math.PI / 5} maxAzimuthAngle={Math.PI / 5}
            />
          </Canvas>
          <div style={{
            position: 'absolute', bottom: '10%', left: '50%', transform: 'translateX(-50%)',
            width: '200px', height: '30px',
            background: 'radial-gradient(ellipse, rgba(168,85,247,0.4) 0%, transparent 70%)',
            filter: 'blur(10px)', pointerEvents: 'none',
          }} />
        </div>

        <div style={{
          flex: '0 0 48%', display: 'flex', flexDirection: 'column',
          justifyContent: 'center', padding: '40px 48px',
          borderLeft: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ color: '#a855f7', fontSize: '12px', fontWeight: '700', letterSpacing: '3px', marginBottom: '16px', textTransform: 'uppercase' }}>
            Your AI companion
          </div>
          <h1 style={{
            fontSize: '64px', fontWeight: '900', margin: '0 0 20px',
            background: 'linear-gradient(135deg, #ffffff, #a855f7)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: '1.1',
          }}>Kelion</h1>
          <p style={{ color: '#888', fontSize: '17px', lineHeight: '1.7', margin: '0 0 32px', maxWidth: '380px' }}>
            Talk naturally. Kelion understands your language automatically and replies in a native voice — face to face, in real time.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '36px' }}>
            {[
              { icon: '🎙', title: 'Voice + camera', desc: 'One tap starts mic and camera together' },
              { icon: '🌍', title: 'Any language', desc: 'Automatic detection, native voice reply' },
              { icon: '⏱', title: '15 minutes free', desc: 'No sign-up required to try it out' },
            ].map(f => (
              <div key={f.title} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px', flexShrink: 0,
                  background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px',
                }}>{f.icon}</div>
                <div>
                  <div style={{ color: '#fff', fontWeight: '600', fontSize: '14px' }}>{f.title}</div>
                  <div style={{ color: '#666', fontSize: '13px' }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button onClick={handleStartChat} style={{
              width: '100%',
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '14px', color: '#fff',
              padding: '16px 32px', fontSize: '17px', fontWeight: '700',
              cursor: 'pointer', boxShadow: '0 8px 30px rgba(168,85,247,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
            }}>▶ {user ? 'Start chat' : 'Try free for 15 minutes'}</button>
            {!user && (
              <div style={{ color: '#555', fontSize: '12px', textAlign: 'center' }}>
                No sign-up required. After 15 minutes, sign in to keep talking.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
