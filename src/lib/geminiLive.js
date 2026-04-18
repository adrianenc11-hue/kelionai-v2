// Gemini 3.1 Flash Live client hook.
// Manages: mic capture → WebSocket → audio playback → lipsync driver → transcript.
// Stage 1 modules: M3 (mic+VAD), M4 (Gemini Live loop), M5 (auto-language),
//   M6 (turn-taking via server VAD + interrupt), M8 (Kelion persona).
// Stage 2 modules: M9 (camera live stream w/ visible preview), M10 (screen share),
//   M11 (vision reasoning via multimodal frames), M12 (emotion mirror via persona).

import { useEffect, useRef, useState, useCallback } from 'react'

const SAMPLE_RATE_IN = 16000   // Gemini Live expects 16kHz PCM16 mic
const SAMPLE_RATE_OUT = 24000  // Gemini Live returns 24kHz PCM16 audio

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

function base64FromBytes(bytes) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function bytesFromBase64(b64) {
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export function useGeminiLive({ audioRef }) {
  const [status, setStatus] = useState('idle') // idle, requesting, connecting, listening, thinking, speaking, error
  const [error, setError] = useState(null)
  const [turns, setTurns] = useState([]) // [{ role: 'user'|'assistant', text }]
  const [userLevel, setUserLevel] = useState(0) // mic level 0..1 for halo reactivity
  const [cameraStream, setCameraStream] = useState(null) // MediaStream for preview
  const [screenStream, setScreenStream] = useState(null) // MediaStream for screen share (no preview)
  const [visionError, setVisionError] = useState(null)

  const wsRef = useRef(null)
  const audioCtxRef = useRef(null)
  const workletNodeRef = useRef(null)
  const micStreamRef = useRef(null)
  const outputGainRef = useRef(null)
  const playbackCtxRef = useRef(null)
  const playbackQueueRef = useRef([])
  const playbackPlayingRef = useRef(false)
  const playbackEndTimeRef = useRef(0)
  const mediaStreamDestRef = useRef(null)
  const turnActiveRef = useRef({ user: null, assistant: null })
  const analyserRef = useRef(null)
  const micLevelRafRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const cameraFrameTimerRef = useRef(null)
  const screenFrameTimerRef = useRef(null)
  const hiddenVideoCameraRef = useRef(null)
  const hiddenVideoScreenRef = useRef(null)
  const frameCanvasRef = useRef(null)

  const appendTurn = useCallback((role, delta, finalize = false) => {
    setTurns((prev) => {
      const active = turnActiveRef.current[role]
      if (active !== null && prev[active] && prev[active].role === role) {
        const next = [...prev]
        next[active] = { role, text: (next[active].text || '') + (delta || '') }
        if (finalize) turnActiveRef.current[role] = null
        return next
      }
      const next = [...prev, { role, text: delta || '' }]
      turnActiveRef.current[role] = next.length - 1
      if (finalize) turnActiveRef.current[role] = null
      return next
    })
  }, [])

  // ───── Mic level meter (drives halo voice-reactive glow) ─────
  const startMicLevel = useCallback((stream) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = audioCtxRef.current
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    src.connect(analyser)
    analyserRef.current = analyser
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteFrequencyData(data)
      let sum = 0
      for (let i = 0; i < 24; i++) sum += data[i]
      const avg = sum / 24
      const v = Math.max(0, Math.min(1, (avg - 20) / 100))
      setUserLevel(v)
      micLevelRafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  // ───── Audio playback queue — schedules PCM chunks back-to-back ─────
  const enqueueAudio = useCallback((pcmBytes) => {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE_OUT })
    }
    const ctx = playbackCtxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    // Convert PCM16 LE → Float32
    const samples = new Int16Array(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength / 2)
    const float = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) float[i] = samples[i] / 0x8000

    const buffer = ctx.createBuffer(1, float.length, SAMPLE_RATE_OUT)
    buffer.copyToChannel(float, 0)

    // Route through a gain → MediaStreamDestination so <audio> picks it up → lipsync hooks onto it
    if (!outputGainRef.current) {
      outputGainRef.current = ctx.createGain()
      const dest = ctx.createMediaStreamDestination()
      mediaStreamDestRef.current = dest
      outputGainRef.current.connect(dest)
      outputGainRef.current.connect(ctx.destination)
      if (audioRef.current) {
        audioRef.current.srcObject = dest.stream
        audioRef.current.muted = true // audible through ctx.destination; stream is for lipsync analyser
        audioRef.current.play().catch(() => {})
      }
    }

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(outputGainRef.current)

    const now = ctx.currentTime
    const startAt = Math.max(now, playbackEndTimeRef.current)
    src.start(startAt)
    playbackEndTimeRef.current = startAt + buffer.duration

    if (!playbackPlayingRef.current) {
      playbackPlayingRef.current = true
      setStatus('speaking')
    }
    src.onended = () => {
      if (ctx.currentTime >= playbackEndTimeRef.current - 0.05) {
        playbackPlayingRef.current = false
      }
    }
  }, [audioRef])

  const clearAudioQueue = useCallback(() => {
    // Server interrupted → reset playback clock to "now" so nothing queued plays further
    if (playbackCtxRef.current) {
      playbackEndTimeRef.current = playbackCtxRef.current.currentTime
    }
    playbackPlayingRef.current = false
  }, [])

  // ───── WebSocket handlers ─────
  const handleMessage = useCallback(async (raw) => {
    let msg
    try { msg = JSON.parse(typeof raw === 'string' ? raw : await raw.text()) }
    catch { return }

    // Server-sent audio chunk (inline_data) + transcripts
    if (msg.serverContent) {
      const sc = msg.serverContent

      // Interruption — user spoke over Kelion
      if (sc.interrupted) {
        clearAudioQueue()
        setStatus('listening')
        return
      }

      if (sc.inputTranscription?.text) {
        appendTurn('user', sc.inputTranscription.text, false)
      }
      if (sc.outputTranscription?.text) {
        appendTurn('assistant', sc.outputTranscription.text, false)
      }

      const parts = sc.modelTurn?.parts || []
      for (const part of parts) {
        const inline = part.inlineData || part.inline_data
        if (inline?.data && inline.mimeType?.startsWith('audio/')) {
          const bytes = bytesFromBase64(inline.data)
          enqueueAudio(bytes)
        }
        if (part.text) {
          appendTurn('assistant', part.text, false)
        }
      }

      if (sc.turnComplete) {
        turnActiveRef.current.user = null
        turnActiveRef.current.assistant = null
        if (!playbackPlayingRef.current) setStatus('listening')
      } else if (sc.generationComplete) {
        setStatus('speaking')
      }
    }

    if (msg.setupComplete) {
      setStatus('listening')
    }

    if (msg.error || msg.errorMessage) {
      console.error('[geminiLive] error from server:', msg.error || msg.errorMessage)
      setError(msg.error?.message || msg.errorMessage || 'Server error')
      setStatus('error')
    }
  }, [appendTurn, enqueueAudio, clearAudioQueue])

  // ───── Start full pipeline ─────
  const start = useCallback(async () => {
    setError(null)
    setStatus('requesting')
    try {
      // 1. Request mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: SAMPLE_RATE_IN },
        video: false,
      })
      micStreamRef.current = stream
      startMicLevel(stream)

      setStatus('connecting')

      // 2. Fetch ephemeral token from backend — full config (persona, voice,
      //    VAD, transcription) is baked into the token's liveConnectConstraints
      //    server-side, so the client does NOT send a setup message.
      const langHint = navigator.language || 'en-US'
      const tokenRes = await fetch(`/api/realtime/gemini-token?lang=${encodeURIComponent(langHint)}`, { credentials: 'include' })
      if (!tokenRes.ok) {
        const txt = await tokenRes.text()
        throw new Error(`Token fetch failed: ${tokenRes.status} ${txt}`)
      }
      const { token } = await tokenRes.json()
      if (!token) throw new Error('No ephemeral token returned')

      // 3. Connect WebSocket — constraints come from the token.
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?access_token=${encodeURIComponent(token)}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.binaryType = 'blob'

      ws.onopen = () => {
        // no-op — server-side constraints auto-initialize the session.
      }

      ws.onmessage = (event) => handleMessage(event.data)
      ws.onerror = (e) => {
        console.error('[geminiLive] ws error', e)
        setError('Connection error')
        setStatus('error')
      }
      ws.onclose = () => {
        if (statusRef.current !== 'idle') {
          setStatus((s) => s === 'error' ? 'error' : 'idle')
        }
      }

      // 4. Pipe mic → WS at 16kHz PCM16
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE_IN })
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()

      // Load AudioWorklet for sample-accurate capture
      try {
        await ctx.audioWorklet.addModule('/audio-capture-worklet.js')
      } catch (e) {
        console.error('[geminiLive] Worklet load failed:', e)
        throw new Error('Failed to load audio worklet')
      }

      const src = ctx.createMediaStreamSource(stream)
      const node = new AudioWorkletNode(ctx, 'kelion-capture', { numberOfInputs: 1, numberOfOutputs: 0 })
      node.port.onmessage = (e) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const float = e.data
        const pcm16 = floatTo16BitPCM(float)
        const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
        const b64 = base64FromBytes(bytes)
        ws.send(JSON.stringify({
          realtimeInput: {
            audio: { data: b64, mimeType: `audio/pcm;rate=${SAMPLE_RATE_IN}` },
          },
        }))
      }
      src.connect(node)
      workletNodeRef.current = node

    } catch (e) {
      console.error('[geminiLive] start error', e)
      setError(e.message || String(e))
      setStatus('error')
    }
  }, [handleMessage, startMicLevel])

  const statusRef = useRef(status)
  useEffect(() => { statusRef.current = status }, [status])

  // ───── Video frame sender (M9 camera + M10 screen share) ─────
  // Grabs a snapshot from a MediaStream at ~1 fps, encodes to JPEG, sends as realtimeInput.
  const startFrameSender = useCallback((stream, kind /* 'camera' | 'screen' */) => {
    if (!frameCanvasRef.current) {
      frameCanvasRef.current = document.createElement('canvas')
    }
    const canvas = frameCanvasRef.current
    const hiddenRef = kind === 'camera' ? hiddenVideoCameraRef : hiddenVideoScreenRef
    if (!hiddenRef.current) {
      const v = document.createElement('video')
      v.autoplay = true
      v.muted = true
      v.playsInline = true
      hiddenRef.current = v
    }
    const video = hiddenRef.current
    video.srcObject = stream
    video.play().catch(() => {})

    const send = async () => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (!video.videoWidth || !video.videoHeight) return
      const maxW = 640
      const scale = Math.min(1, maxW / video.videoWidth)
      canvas.width = Math.floor(video.videoWidth * scale)
      canvas.height = Math.floor(video.videoHeight * scale)
      const ctx = canvas.getContext('2d')
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      } catch {
        return
      }
      try {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.7))
        if (!blob) return
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        const b64 = base64FromBytes(bytes)
        ws.send(JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: 'image/jpeg', data: b64 }],
          },
        }))
      } catch (e) {
        console.warn('[geminiLive] frame send failed', e)
      }
    }

    const timerId = setInterval(send, 1000) // 1 fps — keeps token budget sane
    if (kind === 'camera') cameraFrameTimerRef.current = timerId
    else screenFrameTimerRef.current = timerId
  }, [])

  const stopFrameSender = useCallback((kind) => {
    const ref = kind === 'camera' ? cameraFrameTimerRef : screenFrameTimerRef
    if (ref.current) {
      clearInterval(ref.current)
      ref.current = null
    }
    const hiddenRef = kind === 'camera' ? hiddenVideoCameraRef : hiddenVideoScreenRef
    if (hiddenRef.current) {
      try { hiddenRef.current.pause() } catch {}
      hiddenRef.current.srcObject = null
    }
  }, [])

  const startCamera = useCallback(async () => {
    setVisionError(null)
    if (cameraStreamRef.current) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
      cameraStreamRef.current = stream
      setCameraStream(stream)
      startFrameSender(stream, 'camera')
    } catch (e) {
      console.error('[geminiLive] camera start failed', e)
      setVisionError(e.message || 'Camera access denied')
    }
  }, [startFrameSender])

  const stopCamera = useCallback(() => {
    stopFrameSender('camera')
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current = null
      setCameraStream(null)
    }
  }, [stopFrameSender])

  const startScreen = useCallback(async () => {
    setVisionError(null)
    if (screenStreamRef.current) return
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen share is not supported in this browser')
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 2 } },
        audio: false,
      })
      screenStreamRef.current = stream
      setScreenStream(stream)
      // If user stops share via browser UI, clean up.
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopFrameSender('screen')
        screenStreamRef.current = null
        setScreenStream(null)
      })
      startFrameSender(stream, 'screen')
    } catch (e) {
      // User canceling the picker throws AbortError — not a real error.
      if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
        console.error('[geminiLive] screen share failed', e)
        setVisionError(e.message || 'Screen share failed')
      }
    }
  }, [startFrameSender, stopFrameSender])

  const stopScreen = useCallback(() => {
    stopFrameSender('screen')
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
      setScreenStream(null)
    }
  }, [stopFrameSender])

  const stop = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try { wsRef.current.close(1000, 'user_stopped') } catch {}
    }
    wsRef.current = null
    if (workletNodeRef.current) {
      try { workletNodeRef.current.disconnect() } catch {}
      workletNodeRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
    }
    // Stage 2: also stop camera + screen
    stopFrameSender('camera')
    stopFrameSender('screen')
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current = null
      setCameraStream(null)
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop())
      screenStreamRef.current = null
      setScreenStream(null)
    }
    if (micLevelRafRef.current) cancelAnimationFrame(micLevelRafRef.current)
    analyserRef.current = null
    setUserLevel(0)
    setStatus('idle')
    setError(null)
    setVisionError(null)
  }, [stopFrameSender])

  useEffect(() => () => { stop() }, [stop])

  return {
    status, error, start, stop, turns, userLevel,
    // Stage 2
    cameraStream, screenStream, visionError,
    startCamera, stopCamera, startScreen, stopScreen,
  }
}
