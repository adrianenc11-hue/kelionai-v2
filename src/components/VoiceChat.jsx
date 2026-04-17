import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Suspense, useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLipSync } from '../lib/lipSync'

const AVATARS = {
  kelion: {
    model: '/kelion-rpm_e27cb94d.glb',
    color: '#7c3aed',
    glow:  '#a855f7',
  },
}

const ARM_ROT     = { x: 1.3, y: 0.0, z: 0.15 }
const FOREARM_ROT = { x: 0.4, y: 0.0, z: 0.0 }

function AvatarModel({ avatar = 'kelion', mouthOpen = 0 }) {
  const config = AVATARS.kelion
  const { scene } = useGLTF(config.model)
  const bonesRef = useRef({}); const morphsRef = useRef([])
  useEffect(() => {
    const bones = {}; const morphs = []
    scene.traverse((o) => {
      if (o.isBone || o.type === 'Bone') bones[o.name] = o
      if (o.isSkinnedMesh && o.skeleton) o.skeleton.bones.forEach(b => { bones[b.name] = b })
      if ((o.isMesh || o.isSkinnedMesh) && o.morphTargetDictionary) morphs.push(o)
    })
    bonesRef.current = bones; morphsRef.current = morphs
    const s = (n, x, y, z) => { for (const k of n) if (bones[k]) { bones[k].rotation.set(x, y, z); break } }
    s(['LeftArm','LeftUpperArm'], ARM_ROT.x, ARM_ROT.y, ARM_ROT.z)
    s(['RightArm','RightUpperArm'], ARM_ROT.x, -ARM_ROT.y, -ARM_ROT.z)
    s(['LeftForeArm'], FOREARM_ROT.x, FOREARM_ROT.y, FOREARM_ROT.z)
    s(['RightForeArm'], FOREARM_ROT.x, -FOREARM_ROT.y, -FOREARM_ROT.z)
  }, [scene])
  useFrame(() => {
    const b = bonesRef.current; if (!b) return
    const s = (n, x, y, z) => { for (const k of n) if (b[k]) { b[k].rotation.x=x; b[k].rotation.y=y; b[k].rotation.z=z; break } }
    s(['LeftArm','LeftUpperArm'], ARM_ROT.x, ARM_ROT.y, ARM_ROT.z)
    s(['RightArm','RightUpperArm'], ARM_ROT.x, -ARM_ROT.y, -ARM_ROT.z)
    s(['LeftForeArm'], FOREARM_ROT.x, FOREARM_ROT.y, FOREARM_ROT.z)
    s(['RightForeArm'], FOREARM_ROT.x, -FOREARM_ROT.y, -FOREARM_ROT.z)
    const jaw = b['Jaw']||b['mixamorigJaw']
    if (jaw) jaw.rotation.x = mouthOpen * 0.06
    for (const m of morphsRef.current) {
      const d = m.morphTargetDictionary; if (!d) continue
      const i = d['mouthOpen'] ?? d['viseme_AA'] ?? d['jawOpen']
      if (i !== undefined) m.morphTargetInfluences[i] = mouthOpen * 0.3
    }
  })
  return <primitive object={scene} scale={1.6} position={[0,-1.6,0]} rotation={[0,0,0]} />
}

const ST = {
  idle:       { text: 'Kelion',              color: '#a855f7' },
  connecting: { text: 'Connecting…',          color: '#f59e0b' },
  listening:  { text: 'Listening…',           color: '#22c55e' },
  thinking:   { text: 'Thinking…',            color: '#f59e0b' },
  speaking:   { text: 'Speaking…',            color: '#a855f7' },
  error:      { text: 'Error — tap to retry',  color: '#ef4444' },
}

export default function VoiceChat() {
  const navigate = useNavigate()
  const avatar = 'kelion'
  const config = AVATARS.kelion
  const [status, setStatus]       = useState('idle')
  const [aiText, setAiText]       = useState('')
  const [userText, setUserText]   = useState('')
  const [inputText, setInputText] = useState('')
  const audioRef  = useRef(null)
  const mouthOpen = useLipSync(audioRef)
  const pcRef     = useRef(null)
  const dcRef     = useRef(null)
  const streamRef = useRef(null)
  const timerRef  = useRef(null)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const [hasCamera, setHasCamera] = useState(false)
  const [timeLeft, setTimeLeft] = useState(null) // seconds left for trial

  const buildInstructions = () => {
    const now = new Date()
    const t = now.toLocaleString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    const lang = navigator.language || 'en'
    return `You are Kelion, a friendly and intelligent AI assistant. Calm, professional, empathetic.
Language rules (strict):
1. Detect the language of the MOST RECENT user utterance (voice or text) and reply ONLY in that language — voice AND on-screen transcript.
2. If the user switches languages mid-conversation, switch with them instantly on the very next reply.
3. Never default to any language. The browser hint "${lang}" is used only if the first utterance is truly ambiguous.
Be concise and natural — you are speaking out loud, keep responses short (1-3 sentences).
Current date/time: ${t} (${tz}).`
  }

  const handleEvent = useCallback((evt) => {
    switch (evt.type) {
      case 'conversation.item.input_audio_transcription.delta':
        setUserText(p => p + (evt.delta||'')); break
      case 'conversation.item.input_audio_transcription.completed':
        setUserText(evt.transcript||''); break
      case 'response.audio_transcript.delta':
        setStatus('speaking'); setAiText(p => p + (evt.delta||'')); break
      case 'response.audio_transcript.done':
        setAiText(evt.transcript||''); break
      case 'input_audio_buffer.speech_started':
        setStatus('listening'); setUserText(''); break
      case 'input_audio_buffer.speech_stopped':
        setStatus('thinking'); captureAndSendFrame(); break
      case 'response.created':
        setStatus('thinking'); setAiText(''); break
      case 'response.done':
        setStatus('listening'); break
      case 'error':
        console.error('[realtime]', evt.error); setStatus('error'); break
    }
  }, [])

  const captureAndSendFrame = useCallback(() => {
    const v = videoRef.current; const c = canvasRef.current; const dc = dcRef.current
    if (!v || !c || !dc || dc.readyState !== 'open' || v.videoWidth === 0) return
    try {
      c.width = 320; c.height = 240
      const ctx = c.getContext('2d')
      ctx.drawImage(v, 0, 0, 320, 240)
      const dataUrl = c.toDataURL('image/jpeg', 0.6)
      const b64 = dataUrl.split(',')[1]
      dc.send(JSON.stringify({ type:'conversation.item.create', item:{ type:'message', role:'user',
        content:[{ type:'input_image', image_url: `data:image/jpeg;base64,${b64}` }] } }))
    } catch (_e) { /* ignore capture errors */ }
  }, [])

  const connect = useCallback(async () => {
    if (pcRef.current) return
    setStatus('connecting'); setAiText(''); setUserText('')
    try {
      // Try auth token first, fallback to trial token
      let tokenData
      let r = await fetch(`/api/realtime/token?avatar=${encodeURIComponent(avatar)}`, { credentials:'include' })
      if (r.ok) {
        tokenData = await r.json()
      } else {
        // Not logged in — use free trial
        r = await fetch(`/api/realtime/trial-token?avatar=${encodeURIComponent(avatar)}`, { credentials:'include' })
        if (!r.ok) {
          const err = await r.json().catch(() => ({}))
          throw new Error(err.error || 'Could not obtain session token')
        }
        tokenData = await r.json()
      }
      const { token } = tokenData

      // Start 15 min timer for trial
      if (tokenData.trial) {
        const trial = JSON.parse(localStorage.getItem('kelion_free_trial') || '{}')
        const start = trial.start || Date.now()
        const limit = 15 * 60 * 1000
        if (!trial.start) localStorage.setItem('kelion_free_trial', JSON.stringify({ start, limit }))
        const elapsed = Date.now() - start
        const remaining = Math.max(0, Math.floor((limit - elapsed) / 1000))
        if (remaining <= 0) { setStatus('error'); setAiText('Your free trial has ended. Sign in to keep talking.'); return }
        setTimeLeft(remaining)
        timerRef.current = setInterval(() => {
          setTimeLeft(prev => {
            if (prev <= 1) { clearInterval(timerRef.current); disconnect(); setAiText('Your free trial has ended. Sign in to keep talking!'); return 0 }
            return prev - 1
          })
        }, 1000)
      }

      const pc = new RTCPeerConnection(); pcRef.current = pc
      pc.ontrack = (e) => { if (audioRef.current) { audioRef.current.srcObject = e.streams[0]; audioRef.current.play().catch(()=>{}) } }

      let media
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width:{ideal:640}, height:{ideal:480}, facingMode:'user' },
        })
        setHasCamera(media.getVideoTracks().length > 0)
      } catch (_e) {
        media = await navigator.mediaDevices.getUserMedia({ audio: true })
        setHasCamera(false)
      }
      streamRef.current = media
      const audioTrack = media.getAudioTracks()[0]
      if (audioTrack) pc.addTrack(audioTrack, media)
      if (videoRef.current && media.getVideoTracks().length > 0) {
        videoRef.current.srcObject = media
        videoRef.current.play().catch(()=>{})
      }

      const dc = pc.createDataChannel('oai-events'); dcRef.current = dc
      dc.onopen = () => {
        dc.send(JSON.stringify({ type:'session.update', session: {
          instructions: buildInstructions(),
          modalities:['text','audio'],
          turn_detection: { type:'server_vad', threshold:0.3, prefix_padding_ms:500, silence_duration_ms:1000 },
          input_audio_transcription: { model:'whisper-1' },
        }}))
        setStatus('listening')
      }
      dc.onmessage = (e) => { try { handleEvent(JSON.parse(e.data)) } catch(_){} }
      dc.onerror = () => setStatus('error')

      const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
      const sdp = await fetch('https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
        method:'POST', headers:{ 'Authorization':`Bearer ${token}`, 'Content-Type':'application/sdp' }, body: offer.sdp,
      })
      if (!sdp.ok) throw new Error('WebRTC handshake failed')
      await pc.setRemoteDescription({ type:'answer', sdp: await sdp.text() })
    } catch (err) { console.error(err); setStatus('error'); disconnect() }
  }, [handleEvent])

  const disconnect = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    dcRef.current?.close(); pcRef.current?.close()
    streamRef.current?.getTracks().forEach(t=>t.stop())
    if (audioRef.current) audioRef.current.srcObject = null
    if (videoRef.current) { try { videoRef.current.pause() } catch (_){}; videoRef.current.srcObject = null }
    dcRef.current=null; pcRef.current=null; streamRef.current=null
    setStatus('idle'); setAiText(''); setUserText(''); setTimeLeft(null); setHasCamera(false)
  }, [])

  useEffect(() => () => disconnect(), [disconnect])

  const sendText = (text) => {
    if (!text.trim() || !dcRef.current || dcRef.current.readyState !== 'open') return
    dcRef.current.send(JSON.stringify({ type:'conversation.item.create', item:{ type:'message', role:'user', content:[{type:'input_text', text}] } }))
    dcRef.current.send(JSON.stringify({ type:'response.create' }))
    setUserText(text); setInputText('')
  }

  const st = ST[status]||ST.idle
  const live = status !== 'idle' && status !== 'error' && status !== 'connecting'

  return (
    <div style={{ width:'100vw', height:'100vh', display:'flex', background:'#0a0a0f' }}>
      <audio ref={audioRef} style={{ display:'none' }} autoPlay />
      <canvas ref={canvasRef} style={{ display:'none' }} />
      <video ref={videoRef} playsInline muted style={{ display:'none' }} />
      <div style={{ flex:1, position:'relative' }}>
        <Canvas camera={{ position:[0,0.3,3.5], fov:45 }} style={{ width:'100%', height:'100%' }} gl={{ antialias:true }}>
          <color attach="background" args={['#0a0a0f']} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[2,4,2]} intensity={1.5} />
          <pointLight position={[0,1,2]} intensity={status==='speaking'?2:0.8} color={config.glow} />
          <Suspense fallback={null}>
            <hemisphereLight skyColor="#b1e1ff" groundColor="#000000" intensity={0.6} />
            <AvatarModel avatar={avatar} mouthOpen={mouthOpen} />
          </Suspense>
          <OrbitControls enableZoom={false} enablePan={false} minPolarAngle={Math.PI/4} maxPolarAngle={Math.PI/1.8} minAzimuthAngle={-Math.PI/5} maxAzimuthAngle={Math.PI/5} />
        </Canvas>
        <button onClick={()=>{disconnect();navigate('/')}} style={{ position:'absolute',top:20,left:20, background:'rgba(255,255,255,0.1)',border:'1px solid rgba(255,255,255,0.2)', color:'#fff',padding:'8px 16px',borderRadius:20,cursor:'pointer',fontSize:14,backdropFilter:'blur(10px)' }}>← Back</button>
        {timeLeft !== null && timeLeft > 0 && (
          <div style={{ position:'absolute',top:20,right:20, background:'rgba(0,0,0,0.7)',backdropFilter:'blur(10px)', border:'1px solid rgba(255,255,255,0.15)', borderRadius:12, padding:'8px 16px', color: timeLeft < 60 ? '#ef4444' : '#f59e0b', fontSize:14, fontWeight:700, fontFamily:'monospace' }}>
            🆓 Trial: {Math.floor(timeLeft/60)}:{String(timeLeft%60).padStart(2,'0')}
          </div>
        )}
        <div style={{ position:'absolute',bottom:30,left:'50%',transform:'translateX(-50%)', display:'flex',alignItems:'center',gap:8, background:'rgba(0,0,0,0.65)',backdropFilter:'blur(12px)', padding:'8px 22px',borderRadius:30,border:`1px solid ${st.color}44` }}>
          <span style={{ width:8,height:8,borderRadius:'50%',background:st.color,flexShrink:0, animation:status!=='idle'?'pulse 1s infinite':'none',boxShadow:`0 0 8px ${st.color}` }} />
          <span style={{ color:st.color,fontWeight:600,fontSize:14 }}>{st.text}</span>
        </div>
      </div>
      <div style={{ width:400,display:'flex',flexDirection:'column', background:'rgba(0,0,0,0.35)',borderLeft:'1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.07)', display:'flex',alignItems:'center',gap:10,flexShrink:0 }}>
          <div style={{ width:10,height:10,borderRadius:'50%',background:config.glow,boxShadow:`0 0 8px ${config.glow}` }} />
          <span style={{ fontWeight:600,color:'#fff',fontSize:15 }}>Kelion</span>
          <span style={{ marginLeft:'auto',fontSize:11,color:'#555' }}>🌍 any language</span>
        </div>
        <div style={{ flex:1,display:'flex',flexDirection:'column',justifyContent:'flex-end',padding:'24px 20px',gap:16 }}>
          {aiText ? (
            <div style={{ display:'flex',alignItems:'flex-start',gap:10 }}>
              <div style={{ width:32,height:32,borderRadius:'50%',flexShrink:0, background:`linear-gradient(135deg,${config.color},${config.glow})`, display:'flex',alignItems:'center',justifyContent:'center', fontSize:14,fontWeight:700,color:'#fff' }}>K</div>
              <div style={{ flex:1,background:'rgba(255,255,255,0.07)',borderRadius:'4px 18px 18px 18px', padding:'14px 16px',color:'#e5e7eb',fontSize:15,lineHeight:1.6, border:'1px solid rgba(255,255,255,0.06)' }}>
                {aiText}{status==='speaking'&&<span style={{opacity:0.4,marginLeft:4}}>▋</span>}
              </div>
            </div>
          ) : status==='idle' ? (
            <div style={{ textAlign:'center',color:'#444',fontSize:14 }}>Press <b style={{color:config.glow}}>Start chat</b> to begin</div>
          ) : null}
          {userText ? (
            <div style={{ display:'flex',justifyContent:'flex-end' }}>
              <div style={{ maxWidth:'80%',padding:'12px 16px',borderRadius:'18px 4px 18px 18px', fontSize:15,lineHeight:1.6,color:'#fff', background:`linear-gradient(135deg,${config.color},${config.glow})` }}>{userText}</div>
            </div>
          ) : null}
        </div>
        <div style={{ padding:'16px 20px',borderTop:'1px solid rgba(255,255,255,0.07)',flexShrink:0,display:'flex',flexDirection:'column',gap:10 }}>
          {!live ? (
            <button onClick={connect} disabled={status==='connecting'} style={{
              width:'100%',padding:15,borderRadius:14,border:'none',
              cursor:status==='connecting'?'wait':'pointer',
              background:`linear-gradient(135deg,${config.color},${config.glow})`,
              color:'#fff',fontSize:16,fontWeight:700,boxShadow:`0 0 24px ${config.glow}44`,
              opacity:status==='connecting'?0.7:1,
            }}>{status==='connecting'?'⏳ Connecting…':status==='error'?'🔄 Retry':'🎤 Start chat — mic + camera'}</button>
          ) : (
            <button onClick={disconnect} style={{
              width:'100%',padding:15,borderRadius:14,border:'none',cursor:'pointer',
              background:'linear-gradient(135deg,#dc2626,#ef4444)',
              color:'#fff',fontSize:16,fontWeight:700,boxShadow:'0 0 20px rgba(220,38,38,0.4)',
            }}>⏹ Stop chat</button>
          )}
          {live && (
            <div style={{ display:'flex',gap:8 }}>
              <textarea value={inputText} onChange={e=>setInputText(e.target.value)}
                onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendText(inputText)} }}
                placeholder="Or type here… (Enter to send)" rows={2}
                style={{ flex:1,background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)',borderRadius:12, color:'#fff',padding:'10px 14px',fontSize:14, resize:'none',outline:'none',fontFamily:'inherit' }} />
              <button onClick={()=>sendText(inputText)} disabled={!inputText.trim()} style={{
                background:`linear-gradient(135deg,${config.color},${config.glow})`,
                border:'none',borderRadius:12,color:'#fff',width:44,cursor:'pointer',fontSize:18,
                opacity:!inputText.trim()?0.4:1,
              }}>➤</button>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.6;transform:scale(1.3)}} textarea::placeholder{color:#555}`}</style>
    </div>
  )
}
