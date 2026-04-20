// Gemini 3.1 Flash Live client hook.
// Manages: mic capture → WebSocket → audio playback → lipsync driver → transcript.
// Stage 1 modules: M3 (mic+VAD), M4 (Gemini Live loop), M5 (auto-language),
//   M6 (turn-taking via server VAD + interrupt), M8 (Kelion persona).
// Stage 2 modules: M9 (camera live stream w/ visible preview), M10 (screen share),
//   M11 (vision reasoning via multimodal frames), M12 (emotion mirror via persona).

import { useEffect, useRef, useState, useCallback } from 'react'
import { runTool } from './kelionTools'

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

export function useGeminiLive({ audioRef, coords = null }) {
  const [status, setStatus] = useState('idle') // idle, requesting, connecting, listening, thinking, speaking, error
  const [error, setError] = useState(null)
  const [turns, setTurns] = useState([]) // [{ role: 'user'|'assistant', text }]
  const [userLevel, setUserLevel] = useState(0) // mic level 0..1 for halo reactivity
  const [cameraStream, setCameraStream] = useState(null) // MediaStream for preview
  const [screenStream, setScreenStream] = useState(null) // MediaStream for screen share (no preview)
  const [visionError, setVisionError] = useState(null)
  // Guest trial state. Set from the token mint response on every start():
  //   - null    → signed-in / admin / no limit to display
  //   - object  → { active, remainingMs, expiresAt } for a non-signed-in IP
  //               (15-min countdown). Client auto-stops when it reaches 0.
  // `expiresAt` is a UTC ms timestamp computed from server-returned
  // remainingMs so the HUD can tick locally without a poll loop.
  const [trial, setTrial] = useState(null)
  const trialTimeoutRef = useRef(null)

  const wsRef = useRef(null)
  const audioCtxRef = useRef(null)       // 16kHz capture context for Gemini — MUST match SAMPLE_RATE_IN
  const meterCtxRef = useRef(null)       // Separate default-rate context for the level meter analyser
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
  // IMPORTANT: uses a SEPARATE AudioContext from the 16kHz capture context.
  // Sharing `audioCtxRef` here lazily created a 48kHz default-rate context
  // before the capture pipeline could create its 16kHz one, which caused the
  // mic to be captured at 48kHz but tagged as 16kHz on the wire to Gemini.
  const startMicLevel = useCallback((stream) => {
    if (!meterCtxRef.current) {
      meterCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = meterCtxRef.current
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

    // Stage 4 — Gemini Live asks us to run a function tool.
    // Each functionCall carries { id, name, args }. We route to the right
    // /api/tools/* backend endpoint, then send back a toolResponse with the
    // matching id so Gemini can continue the turn with the result.
    if (msg.toolCall?.functionCalls?.length) {
      const ws = wsRef.current
      const fcs = msg.toolCall.functionCalls
      // Narrate to the transcript so the user SEES what Kelion is doing
      // (audio narration is handled by the model itself per the persona).
      for (const fc of fcs) {
        appendTurn('assistant', `[tool: ${fc.name}]`, true)
      }
      try {
        const responses = await Promise.all(fcs.map(async (fc) => {
          const result = await runTool(fc.name, fc.args || {})
          return {
            id: fc.id,
            name: fc.name,
            response: { result },
          }
        }))
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }))
        }
      } catch (err) {
        console.error('[geminiLive] tool execution failed', err)
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            toolResponse: {
              functionResponses: fcs.map((fc) => ({
                id: fc.id,
                name: fc.name,
                response: { result: `Tool error: ${err.message || 'unknown'}. Tell the user honestly and move on.` },
              })),
            },
          }))
        }
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
      // Append real GPS coords if the client resolved them via
      // navigator.geolocation. The server prefers these over IP-geo when
      // building the persona, so Kelion gets 20-m accuracy instead of the
      // 25-50 km ipapi.co city centroid.
      const geoQuery = (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon))
        ? `&lat=${coords.lat.toFixed(6)}&lon=${coords.lon.toFixed(6)}&acc=${Math.round(coords.accuracy || 0)}`
        : ''
      const tokenRes = await fetch(`/api/realtime/gemini-token?lang=${encodeURIComponent(langHint)}${geoQuery}`, { credentials: 'include' })
      // Guest trial exhaustion — propagate a clean user-facing error so
      // the HUD can render "Sign in / buy credits" instead of a raw
      // "HTTP 429".
      if (tokenRes.status === 429) {
        let body = null
        try { body = await tokenRes.json() } catch (_) { /* fall through */ }
        const msg = body?.error || 'Free trial used up for today. Sign in or buy credits to keep talking.'
        setTrial({ active: false, remainingMs: 0, expiresAt: 0, exhausted: true })
        throw new Error(msg)
      }
      if (!tokenRes.ok) {
        const txt = await tokenRes.text()
        throw new Error(`Token fetch failed: ${tokenRes.status} ${txt}`)
      }
      const tokenBody = await tokenRes.json()
      const token = tokenBody?.token
      const setupPayload = tokenBody?.setup
      if (!token) throw new Error('No ephemeral token returned')
      if (!setupPayload) throw new Error('No live-connect setup returned')

      // Trial countdown. Server returns tokenBody.trial = null for
      // signed-in / admin users and { allowed, remainingMs, windowMs }
      // for guests. Store expiresAt (absolute ms) so the HUD can tick
      // locally via setInterval, and schedule an auto-stop at the
      // deadline so we never keep the WS open past the trial window.
      if (tokenBody.trial && tokenBody.trial.allowed) {
        const remainingMs = Math.max(0, Number(tokenBody.trial.remainingMs) || 0)
        const expiresAt = Date.now() + remainingMs
        setTrial({ active: true, remainingMs, expiresAt, exhausted: false })
        if (trialTimeoutRef.current) clearTimeout(trialTimeoutRef.current)
        trialTimeoutRef.current = setTimeout(() => {
          // stop() is defined below; use the ref path instead to avoid a
          // hoisting dance. We close the socket directly — the top-level
          // cleanup effect handles the rest when status flips.
          try {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.close(1000, 'trial-expired')
            }
          } catch (_) { /* swallow */ }
          setTrial((t) => (t ? { ...t, active: false, remainingMs: 0, exhausted: true } : t))
          setError('Free trial used up for today. Sign in or buy credits to keep talking.')
          setStatus('error')
        }, remainingMs)
      } else {
        setTrial(null)
      }

      // 3. Connect WebSocket on the `BidiGenerateContentConstrained` endpoint.
      // Verified against the official @google/genai SDK v1.37.0 source
      // (src/live.ts lines 164-179): whenever the apiKey starts with
      // "auth_tokens/" (i.e. an ephemeral token), the SDK switches to
      // `BidiGenerateContentConstrained` and passes it via
      // `?access_token=<token>`. The plain `BidiGenerateContent` endpoint
      // rejects ephemeral tokens with close code 1008 "Method doesn't allow
      // unregistered callers. Please use API Key." — it only accepts raw
      // API keys.
      //
      // The Constrained endpoint does NOT require the token to carry any
      // constraints. When minted without `bidiGenerateContentSetup` (as the
      // server now does after PR #68), the client-sent setup frame is
      // accepted verbatim with all the rich fields (systemInstruction,
      // tools, transcription, realtimeInputConfig, speechConfig) that used
      // to trigger close code 1007 when baked into the token.
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.binaryType = 'blob'

      ws.onopen = () => {
        // Google requires `setup` to be the FIRST and only setup message
        // on the wire. The worklet's realtimeInput chunks are posted via
        // MessageChannel (async), so this synchronous send(setup) always
        // lands before the first audio frame.
        try {
          ws.send(JSON.stringify({ setup: setupPayload }))
        } catch (err) {
          console.error('[geminiLive] failed to send setup frame', err)
        }
      }

      ws.onmessage = (event) => handleMessage(event.data)
      ws.onerror = (e) => {
        console.error('[geminiLive] ws error', e)
        setError('Connection error')
        setStatus('error')
      }
      ws.onclose = (e) => {
        // Surface Google's close code + reason so bad-endpoint or
        // expired-token failures show up in the console instead of being
        // silently flipped back to 'idle'. 1000 = normal, 1005/1006 = no
        // status / abnormal, 1008 = policy (wrong endpoint / bad token).
        console.warn('[geminiLive] ws close', { code: e?.code, reason: e?.reason, wasClean: e?.wasClean })
        if (statusRef.current === 'idle') return
        // If we never reached 'listening' (i.e. the session died before
        // setupComplete), keep the error visible rather than bouncing back
        // to the "Tap to talk" label — otherwise the user thinks nothing
        // happened.
        const neverOpened = statusRef.current === 'connecting' || statusRef.current === 'requesting'
        if (statusRef.current === 'error') return
        if (neverOpened) {
          setError(`Connection closed (${e?.code || 'unknown'})${e?.reason ? `: ${e.reason}` : ''}`)
          setStatus('error')
          return
        }
        setStatus('idle')
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
  // Streams a MediaStream to Gemini Live as a continuous sequence of JPEG
  // frames tagged with `realtimeInput.video` (the field Gemini Live treats
  // as a live video track, not isolated images). Adrian flagged 2026-04-19
  // that the previous 1-fps "snapshot" behavior made the avatar feel blind
  // between captures — now we stream at ~15 fps with a 480px short edge and
  // JPEG q≈0.55 so the wire cost stays reasonable while the model sees real
  // motion. If the socket back-pressures (bufferedAmount > 2 MB) we skip
  // the current frame instead of piling work.
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

    // ~15 fps target. We honor the spec in wall time rather than animation
    // frames so tab-visibility throttling does not pause the stream to the
    // AI (the user might be looking at a different window but we still want
    // Kelion to "see" the camera).
    const TARGET_FPS = kind === 'screen' ? 8 : 15
    const MIN_INTERVAL_MS = Math.floor(1000 / TARGET_FPS)
    const MAX_W = kind === 'screen' ? 960 : 480
    const JPEG_Q = kind === 'screen' ? 0.6 : 0.55
    const BACKPRESSURE_BYTES = 2_000_000

    let busy = false
    const send = async () => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      if (busy) return
      if (ws.bufferedAmount > BACKPRESSURE_BYTES) return
      if (!video.videoWidth || !video.videoHeight) return
      busy = true
      try {
        const scale = Math.min(1, MAX_W / video.videoWidth)
        canvas.width = Math.floor(video.videoWidth * scale)
        canvas.height = Math.floor(video.videoHeight * scale)
        const ctx = canvas.getContext('2d')
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        } catch {
          return
        }
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_Q))
        if (!blob) return
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        const b64 = base64FromBytes(bytes)
        ws.send(JSON.stringify({
          realtimeInput: {
            // `video` is the live-video channel (continuous). Previously we
            // used `mediaChunks` which Gemini Live treats as discrete image
            // attachments (snapshots), which is exactly what broke the
            // "live" feel Adrian reported.
            video: { data: b64, mimeType: 'image/jpeg' },
          },
        }))
      } catch (e) {
        console.warn('[geminiLive] frame send failed', e)
      } finally {
        busy = false
      }
    }

    const timerId = setInterval(send, MIN_INTERVAL_MS)
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
    if (meterCtxRef.current) {
      try { meterCtxRef.current.close() } catch {}
      meterCtxRef.current = null
    }
    // Cancel any pending trial auto-stop so it doesn't fire after the
    // user manually stopped the session. We keep the `trial` state so
    // the "used N of 15 min" HUD lingers until the next start().
    if (trialTimeoutRef.current) {
      clearTimeout(trialTimeoutRef.current)
      trialTimeoutRef.current = null
    }
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
    // Trial countdown (null for signed-in users, object for guests).
    trial,
  }
}
