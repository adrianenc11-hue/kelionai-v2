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

export default function LandingPage() {
  const navigate = useNavigate()
  const saved = getSavedArm()
  const [isAdmin, setIsAdmin] = useState(false)
  const [user, setUser] = useState(null)
  const [modal, setModal] = useState(null) // 'login' | 'register' | 'plans' | 'referral'
  const [formEmail, setFormEmail] = useState('')
  const [formPass, setFormPass] = useState('')
  const [formName, setFormName] = useState('')
  const [formError, setFormError] = useState('')
  const [formLoading, setFormLoading] = useState(false)
  const [plans, setPlans] = useState([])
  const [refCode, setRefCode] = useState('')
  const [refInput, setRefInput] = useState('')
  const [refMsg, setRefMsg] = useState('')

  useEffect(() => {
    api.get('/auth/me').then(u => {
      if (u) { setUser(u); if (u.role === 'admin') setIsAdmin(true) }
    }).catch(() => {})
  }, [])

  function resetForm() { setFormEmail(''); setFormPass(''); setFormName(''); setFormError('') }

  async function handleLogin(e) {
    e.preventDefault(); setFormError(''); setFormLoading(true)
    try {
      const data = await api.post('/auth/local/login', { email: formEmail, password: formPass })
      setUser(data.user); setModal(null); resetForm()
      api.get('/auth/me').then(u => { if (u?.role === 'admin') setIsAdmin(true) }).catch(() => {})
    } catch (err) { setFormError(err.message || 'Login eșuat') }
    finally { setFormLoading(false) }
  }

  async function handleRegister(e) {
    e.preventDefault(); setFormError(''); setFormLoading(true)
    try {
      const data = await api.post('/auth/local/register', { email: formEmail, password: formPass, name: formName })
      setUser(data.user); setModal(null); resetForm()
      api.get('/auth/me').then(u => { if (u?.role === 'admin') setIsAdmin(true) }).catch(() => {})
    } catch (err) { setFormError(err.message || 'Înregistrare eșuată') }
    finally { setFormLoading(false) }
  }

  async function handleLogout() {
    try { await api.post('/auth/logout') } catch {}
    setUser(null); setIsAdmin(false)
  }

  async function openPlans() {
    setModal('plans')
    try { const d = await api.get('/api/subscription/plans'); setPlans(d.plans || []) } catch {}
  }

  async function generateRef() {
    try { const d = await api.post('/api/referral/generate'); setRefCode(d.code) } catch (e) { setRefMsg(e.message) }
  }

  async function useRef_() {
    setRefMsg('')
    try { await api.post('/api/referral/use', { code: refInput }); setRefMsg('Cod aplicat cu succes!') }
    catch (e) { setRefMsg(e.message) }
  }

  function handleFreeTrial() {
    localStorage.setItem('kelion_free_trial', JSON.stringify({ start: Date.now(), limit: 15 * 60 * 1000 }))
    navigate('/chat')
  }

  const inp = {
    width: '100%', padding: '12px 16px', borderRadius: '10px', fontSize: '14px',
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', outline: 'none', marginBottom: '12px', boxSizing: 'border-box',
  }
  const btnPrimary = {
    width: '100%', padding: '13px', borderRadius: '10px', border: 'none',
    background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
    color: '#fff', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
  }
  const modalBg = {
    position: 'fixed', inset: 0, zIndex: 100,
    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const card = {
    background: '#16162a', border: '1px solid rgba(168,85,247,0.3)',
    borderRadius: '16px', padding: '32px', width: '400px', maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  }
  const modalTitle = {
    margin: '0 0 24px', fontSize: '22px', fontWeight: '800',
    background: 'linear-gradient(135deg, #a855f7, #f472b6)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
  }
  const errBox = {
    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: '8px', padding: '10px 14px', color: '#ef4444', fontSize: '13px', marginBottom: '16px',
  }
  const linkBtn = { background: 'none', border: 'none', color: '#a855f7', cursor: 'pointer', fontSize: '13px', padding: 0 }

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
          {isAdmin && (
            <button onClick={() => navigate('/admin')} style={{
              background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)',
              borderRadius: '8px', color: '#a855f7', padding: '6px 14px', cursor: 'pointer',
              fontSize: '13px', fontWeight: '600',
            }}>⚙ Admin</button>
          )}
          <button onClick={openPlans} style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '8px', color: '#ccc', padding: '6px 14px', cursor: 'pointer',
            fontSize: '13px', fontWeight: '500',
          }}>💎 Planuri</button>
          {user && (
            <button onClick={() => { setRefCode(''); setRefMsg(''); setRefInput(''); setModal('referral') }} style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '8px', color: '#ccc', padding: '6px 14px', cursor: 'pointer',
              fontSize: '13px', fontWeight: '500',
            }}>🎁 Recomandă</button>
          )}
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#aaa', fontSize: '13px' }}>{user.name || user.email}</span>
              <span style={{ color: '#555', fontSize: '11px' }}>({user.subscription_tier || 'free'})</span>
              <button onClick={handleLogout} style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: '8px', color: '#ef4444', padding: '6px 14px', cursor: 'pointer',
                fontSize: '13px', fontWeight: '600',
              }}>Deconectare</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { resetForm(); setModal('login') }} style={{
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                border: 'none', borderRadius: '8px', color: '#fff', padding: '6px 18px',
                cursor: 'pointer', fontSize: '13px', fontWeight: '600',
              }}>Conectare</button>
              <button onClick={() => { resetForm(); setModal('register') }} style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px', color: '#ccc', padding: '6px 14px', cursor: 'pointer',
                fontSize: '13px', fontWeight: '500',
              }}>Cont nou</button>
            </div>
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
            ASISTENTUL TĂU AI
          </div>
          <h1 style={{
            fontSize: '64px', fontWeight: '900', margin: '0 0 20px',
            background: 'linear-gradient(135deg, #ffffff, #a855f7)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: '1.1',
          }}>Kelion</h1>
          <p style={{ color: '#888', fontSize: '17px', lineHeight: '1.7', margin: '0 0 32px', maxWidth: '380px' }}>
            Inteligent, empatic și mereu disponibil. Vorbește natural — Kelion înțelege, răspunde și te ajută în timp real.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '36px' }}>
            {[
              { icon: '🎙', title: 'Voce naturală', desc: 'Detectare automată a vocii în orice limbă' },
              { icon: '🌍', title: 'Orice limbă', desc: 'Răspuns vocal nativ în limba ta' },
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
            <button onClick={() => user ? navigate('/chat') : setModal('login')} style={{
              width: '100%',
              background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
              border: 'none', borderRadius: '14px', color: '#fff',
              padding: '16px 32px', fontSize: '17px', fontWeight: '700',
              cursor: 'pointer', boxShadow: '0 8px 30px rgba(168,85,247,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
            }}>▶ Pornește chat</button>
            {!user && (
              <button onClick={handleFreeTrial} style={{
                width: '100%', background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '14px', color: '#aaa',
                padding: '14px 32px', fontSize: '15px', fontWeight: '600', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}>🆓 Încearcă gratuit 15 minute</button>
            )}
          </div>
        </div>
      </div>

      {/* LOGIN MODAL */}
      {modal === 'login' && (
        <div style={modalBg} onClick={() => setModal(null)}>
          <form onSubmit={handleLogin} onClick={e => e.stopPropagation()} style={card}>
            <h2 style={modalTitle}>Login</h2>
            {formError && <div style={errBox}>{formError}</div>}
            <input type="email" placeholder="Email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required style={inp} />
            <input type="password" placeholder="Parolă" value={formPass} onChange={e => setFormPass(e.target.value)} required style={{...inp, marginBottom: '20px'}} />
            <button type="submit" disabled={formLoading} style={{...btnPrimary, opacity: formLoading ? 0.7 : 1}}>
              {formLoading ? 'Se conectează...' : 'Conectare'}
            </button>
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <span style={{ color: '#666', fontSize: '13px' }}>Nu ai cont? </span>
              <button type="button" onClick={() => { resetForm(); setModal('register') }} style={linkBtn}>Creează cont</button>
            </div>
          </form>
        </div>
      )}

      {/* REGISTER MODAL */}
      {modal === 'register' && (
        <div style={modalBg} onClick={() => setModal(null)}>
          <form onSubmit={handleRegister} onClick={e => e.stopPropagation()} style={card}>
            <h2 style={modalTitle}>Cont nou</h2>
            {formError && <div style={errBox}>{formError}</div>}
            <input type="text" placeholder="Nume" value={formName} onChange={e => setFormName(e.target.value)} required style={inp} />
            <input type="email" placeholder="Email" value={formEmail} onChange={e => setFormEmail(e.target.value)} required style={inp} />
            <input type="password" placeholder="Parolă (min 8 caractere)" value={formPass} onChange={e => setFormPass(e.target.value)} required minLength={8} style={{...inp, marginBottom: '20px'}} />
            <button type="submit" disabled={formLoading} style={{...btnPrimary, opacity: formLoading ? 0.7 : 1}}>
              {formLoading ? 'Se creează...' : 'Creează cont'}
            </button>
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <span style={{ color: '#666', fontSize: '13px' }}>Ai deja cont? </span>
              <button type="button" onClick={() => { resetForm(); setModal('login') }} style={linkBtn}>Login</button>
            </div>
          </form>
        </div>
      )}

      {/* PLANS MODAL */}
      {modal === 'plans' && (
        <div style={modalBg} onClick={() => setModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{...card, width: '700px'}}>
            <h2 style={modalTitle}>Planuri & Abonamente</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
              {(plans.length ? plans : [
                { id: 'free', name: 'Free', price: 0, dailyLimit: 10, features: ['10 mesaje/zi', 'Avatare standard'] },
                { id: 'basic', name: 'Basic', price: 9.99, dailyLimit: 60, features: ['60 mesaje/zi', 'Toate avatarele', 'Suport prioritar'] },
                { id: 'premium', name: 'Premium', price: 29.99, dailyLimit: 180, features: ['180 mesaje/zi', 'Avatare custom', 'Funcții avansate'] },
                { id: 'enterprise', name: 'Enterprise', price: 99.99, dailyLimit: null, features: ['Nelimitat', 'Integrări custom', 'Suport dedicat'] },
              ]).map(p => {
                const isActive = user?.subscription_tier === p.id
                return (
                  <div key={p.id} style={{
                    background: isActive ? 'rgba(168,85,247,0.1)' : 'rgba(255,255,255,0.03)',
                    border: isActive ? '2px solid #a855f7' : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '12px', padding: '20px',
                  }}>
                    <div style={{ fontSize: '16px', fontWeight: '700', color: '#fff', marginBottom: '4px' }}>{p.name}</div>
                    <div style={{ fontSize: '28px', fontWeight: '800', color: '#a855f7', marginBottom: '12px' }}>
                      {p.price === 0 ? 'Gratuit' : `$${p.price}`}
                      {p.price > 0 && <span style={{ fontSize: '13px', color: '#666' }}>/lună</span>}
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
                      {(p.features || []).map(f => (
                        <li key={f} style={{ color: '#aaa', fontSize: '13px', padding: '3px 0' }}>✓ {f}</li>
                      ))}
                    </ul>
                    {isActive ? (
                      <div style={{ textAlign: 'center', color: '#a855f7', fontSize: '13px', fontWeight: '600' }}>Planul tău actual</div>
                    ) : p.id !== 'free' ? (
                      <button onClick={async () => {
                        if (!user) { setModal('register'); return }
                        try {
                          const d = await api.post('/api/payments/create-checkout-session', { planId: p.id })
                          if (d.url) window.location.href = d.url
                        } catch (e) { alert(e.message) }
                      }} style={{...btnPrimary, padding: '10px', fontSize: '13px'}}>Cumpără</button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* REFERRAL MODAL */}
      {modal === 'referral' && (
        <div style={modalBg} onClick={() => setModal(null)}>
          <div onClick={e => e.stopPropagation()} style={card}>
            <h2 style={modalTitle}>🎁 Recomandă un prieten</h2>
            <p style={{ color: '#888', fontSize: '14px', margin: '0 0 20px' }}>
              Trimite codul tău de referral prietenilor și primiți amândoi beneficii!
            </p>
            <div style={{ marginBottom: '24px' }}>
              <div style={{ color: '#ccc', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>Codul tău de referral:</div>
              {refCode ? (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <div style={{
                    flex: 1, padding: '12px 16px', borderRadius: '10px', fontSize: '18px', fontWeight: '700',
                    background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)',
                    color: '#a855f7', fontFamily: 'monospace', letterSpacing: '2px', textAlign: 'center',
                  }}>{refCode}</div>
                  <button onClick={() => { navigator.clipboard.writeText(refCode); setRefMsg('Copiat!') }} style={{
                    background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)',
                    borderRadius: '10px', color: '#a855f7', padding: '12px 16px', cursor: 'pointer', fontSize: '14px',
                  }}>📋</button>
                </div>
              ) : (
                <button onClick={generateRef} style={btnPrimary}>Generează cod</button>
              )}
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '20px' }}>
              <div style={{ color: '#ccc', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>Ai un cod de la cineva?</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input placeholder="Introdu codul" value={refInput} onChange={e => setRefInput(e.target.value)} style={{...inp, flex: 1, marginBottom: 0}} />
                <button onClick={useRef_} disabled={!refInput.trim()} style={{
                  ...btnPrimary, width: 'auto', padding: '12px 20px', fontSize: '13px',
                  opacity: !refInput.trim() ? 0.5 : 1,
                }}>Aplică</button>
              </div>
              {refMsg && <div style={{ color: refMsg.includes('succes') ? '#22c55e' : '#ef4444', fontSize: '13px', marginTop: '8px' }}>{refMsg}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
