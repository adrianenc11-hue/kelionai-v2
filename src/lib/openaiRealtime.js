// OpenAI Realtime voice client hook.
// Drop-in replacement for useGeminiLive — same interface, different transport.
// Voice: gpt-realtime-1.5 via WebRTC DataChannel.
// Vision: GPT-5.5 via /api/realtime/vision (camera frames described server-side).
//
// Architecture:
//   Browser mic → WebSocket (pcm16) → OpenAI Realtime → audio response → playback
//   Camera frames → /api/realtime/vision (GPT-5.5) → text injected into session

import { useEffect, useRef, useState, useCallback } from 'react'
import { runTool } from './kelionTools'
import { setCameraController, setCurrentFacingMode } from './cameraControl'
import { getCsrfToken } from './api'

const SAMPLE_RATE = 24000 // OpenAI Realtime uses 24kHz PCM16

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

export function useOpenAIRealtime({ audioRef, coords = null, onBalanceUpdate = null, active = true }) {
  const onBalanceUpdateRef = useRef(onBalanceUpdate)
  onBalanceUpdateRef.current = onBalanceUpdate

  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [turns, setTurns] = useState([])
  const [userLevel, setUserLevel] = useState(0)
  const [cameraStream, setCameraStream] = useState(null)
  const [screenStream, setScreenStream] = useState(null)
  const [visionError, setVisionError] = useState(null)
  const [trial, setTrial] = useState(null)

  const trialTimeoutRef = useRef(null)
  const lastActivityAtRef = useRef(Date.now())
  const creditsIntervalRef = useRef(null)
  const creditsStartedRef = useRef(false)
  const creditsStartFnRef = useRef(null)
  const startInFlightRef = useRef(false)
  const statusRef = useRef('idle')

  const wsRef = useRef(null)
  const audioCtxRef = useRef(null)
  const meterCtxRef = useRef(null)
  const workletNodeRef = useRef(null)
  const micStreamRef = useRef(null)
  const outputGainRef = useRef(null)
  const playbackCtxRef = useRef(null)
  const playbackQueueRef = useRef([])
  const playbackPlayingRef = useRef(false)
  const playbackEndTimeRef = useRef(0)
  const activeSourcesRef = useRef(new Set())
  const playbackGenerationRef = useRef(0)
  const turnActiveRef = useRef({ user: null, assistant: null })
  const analyserRef = useRef(null)
  const micLevelRafRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const frameSendersRef = useRef({})

  // ── Turn management ───────────────────────────────────────────
  const appendTurn = useCallback((role, text, forceNew = false) => {
    setTurns(prev => {
      const last = prev[prev.length - 1]
      if (!forceNew && last && last.role === role) {
        const updated = [...prev]
        updated[updated.length - 1] = { ...last, text: (last.text || '') + text }
        return updated
      }
      return [...prev, { role, text }]
    })
  }, [])

  // ── Audio playback ────────────────────────────────────────────
  const clearAudioQueue = useCallback(() => {
    playbackGenerationRef.current += 1
    for (const src of activeSourcesRef.current) {
      try { src.onended = null } catch (_) {}
      try { src.stop(0) } catch (_) {}
      try { src.disconnect() } catch (_) {}
    }
    activeSourcesRef.current.clear()
    if (playbackCtxRef.current) {
      playbackEndTimeRef.current = playbackCtxRef.current.currentTime
    }
    playbackPlayingRef.current = false
  }, [])

  const enqueueAudio = useCallback((pcm16Bytes) => {
    const gen = playbackGenerationRef.current
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new AudioContext({ sampleRate: SAMPLE_RATE })
    }
    const ctx = playbackCtxRef.current
    const samples = new Int16Array(pcm16Bytes.buffer, pcm16Bytes.byteOffset, pcm16Bytes.byteLength / 2)
    const float32 = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) float32[i] = samples[i] / 32768

    const buf = ctx.createBuffer(1, float32.length, SAMPLE_RATE)
    buf.getChannelData(0).set(float32)
    const src = ctx.createBufferSource()
    src.buffer = buf

    if (!outputGainRef.current) {
      outputGainRef.current = ctx.createGain()
      outputGainRef.current.connect(ctx.destination)
    }
    src.connect(outputGainRef.current)

    // Drive lipsync
    if (audioRef?.current) {
      try {
        if (!audioRef.current._mediaStreamDest) {
          audioRef.current._mediaStreamDest = ctx.createMediaStreamDestination()
        }
        src.connect(audioRef.current._mediaStreamDest)
      } catch (_) {}
    }

    activeSourcesRef.current.add(src)
    src.onended = () => { activeSourcesRef.current.delete(src) }

    const now = ctx.currentTime
    const startAt = Math.max(now, playbackEndTimeRef.current)
    if (gen !== playbackGenerationRef.current) return // stale
    src.start(startAt)
    playbackEndTimeRef.current = startAt + buf.duration
    playbackPlayingRef.current = true
  }, [audioRef])

  // ── Credits heartbeat ─────────────────────────────────────────
  const startCreditsHeartbeat = useCallback((userId) => {
    if (creditsIntervalRef.current) return
    const tick = async () => {
      const silent = (Date.now() - lastActivityAtRef.current) > 30000
      try {
        const r = await fetch('/api/credits/consume', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          body: JSON.stringify({ silent }),
        })
        const body = await r.json().catch(() => ({}))
        if (body.exempt) return
        if (body.balance_minutes != null && onBalanceUpdateRef.current) {
          onBalanceUpdateRef.current(body.balance_minutes)
        }
        if (body.exhausted || r.status === 402) {
          setError('No credits left. Buy a package to keep talking to Kelion.')
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, 'credits_exhausted')
        }
      } catch (_) {}
    }
    tick()
    creditsIntervalRef.current = setInterval(tick, 60000)
  }, [])

  // ── Handle incoming WS messages ───────────────────────────────
  const handleMessage = useCallback((event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }

    const type = msg.type

    // Session created — ready to receive audio
    if (type === 'session.created' || type === 'session.updated') {
      setStatus('listening')
      statusRef.current = 'listening'
      return
    }

    // User speech started
    if (type === 'input_audio_buffer.speech_started') {
      lastActivityAtRef.current = Date.now()
      clearAudioQueue()
      setStatus('listening')
      statusRef.current = 'listening'
      return
    }

    // User speech transcription
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = msg.transcript || ''
      if (text.trim()) appendTurn('user', text.trim(), true)
      return
    }

    // AI is generating response
    if (type === 'response.created') {
      setStatus('thinking')
      statusRef.current = 'thinking'
      lastActivityAtRef.current = Date.now()
      // Proof of service — start credits
      if (!creditsStartedRef.current && creditsStartFnRef.current) {
        creditsStartedRef.current = true
        creditsStartFnRef.current()
      }
      return
    }

    // Audio delta
    if (type === 'response.audio.delta') {
      setStatus('speaking')
      statusRef.current = 'speaking'
      const bytes = bytesFromBase64(msg.delta)
      enqueueAudio(bytes)
      return
    }

    // Text delta (transcript of AI speech)
    if (type === 'response.audio_transcript.delta') {
      const text = msg.delta || ''
      if (text) appendTurn('assistant', text)
      return
    }

    // Response done
    if (type === 'response.done') {
      setStatus('listening')
      statusRef.current = 'listening'
      return
    }

    // Tool call
    if (type === 'response.function_call_arguments.done') {
      const callId = msg.call_id
      const fnName = msg.name
      let args = {}
      try { args = JSON.parse(msg.arguments || '{}') } catch {}
      // Execute tool and send result back
      ;(async () => {
        try {
          const result = await runTool(fnName, args)
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify(result),
              },
            }))
            ws.send(JSON.stringify({ type: 'response.create' }))
          }
        } catch (err) {
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: callId,
                output: JSON.stringify({ error: err.message }),
              },
            }))
            ws.send(JSON.stringify({ type: 'response.create' }))
          }
        }
      })()
      return
    }

    // Error
    if (type === 'error') {
      console.error('[openaiRealtime] error event:', msg.error)
      return
    }
  }, [appendTurn, enqueueAudio, clearAudioQueue])

  // ── Camera frame sender ───────────────────────────────────────
  // Captures frames from camera/screen and sends them to GPT-5.5
  // vision endpoint for description, then injects text into session.
  const startFrameSender = useCallback((stream, label) => {
    if (frameSendersRef.current[label]) return
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.play().catch(() => {})
    const canvas = document.createElement('canvas')
    const MAX_W = 512
    const JPEG_Q = 0.6
    const INTERVAL = 4000 // send a frame every 4s to GPT-5.5
    const id = setInterval(async () => {
      if (!video.videoWidth) return
      const scale = Math.min(1, MAX_W / video.videoWidth)
      canvas.width = Math.floor(video.videoWidth * scale)
      canvas.height = Math.floor(video.videoHeight * scale)
      const ctx = canvas.getContext('2d')
      try { ctx.drawImage(video, 0, 0, canvas.width, canvas.height) } catch { return }
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', JPEG_Q))
      if (!blob) return
      const buf = await blob.arrayBuffer()
      const b64 = base64FromBytes(new Uint8Array(buf))

      // Send to GPT-5.5 vision on the server
      try {
        const r = await fetch('/api/realtime/vision', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          body: JSON.stringify({ image: b64, mimeType: 'image/jpeg' }),
        })
        if (!r.ok) return
        const data = await r.json()
        if (data.description && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          // Inject vision description into the realtime session
          wsRef.current.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{
                type: 'input_text',
                text: `[Camera observation: ${data.description}]`,
              }],
            },
          }))
        }
      } catch (_) {}
    }, INTERVAL)
    frameSendersRef.current[label] = { id, video }
  }, [])

  const stopFrameSender = useCallback((label) => {
    const entry = frameSendersRef.current[label]
    if (!entry) return
    clearInterval(entry.id)
    try { entry.video.pause(); entry.video.srcObject = null } catch (_) {}
    delete frameSendersRef.current[label]
  }, [])

  // ── Start full pipeline ───────────────────────────────────────
  const start = useCallback(async (opts = {}) => {
    const priorTurns = Array.isArray(opts.priorTurns) ? opts.priorTurns : []
    if (startInFlightRef.current) return
    const textOnly = !!opts.textOnly

    clearAudioQueue()
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      try { wsRef.current.close(1000, 'restart') } catch (_) {}
      wsRef.current = null
    }
    startInFlightRef.current = true
    setError(null)
    setStatus('requesting')
    statusRef.current = 'requesting'
    lastActivityAtRef.current = Date.now()

    try {
      // 1. Mic (skip for text-only)
      let micStream = null
      if (!textOnly) {
        const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE })
        audioCtxRef.current = audioCtx
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { sampleRate: { ideal: SAMPLE_RATE }, echoCancellation: true, noiseSuppression: true },
        })
        micStreamRef.current = micStream
      }

      // 2. Fetch ephemeral token from our server
      const lang = navigator.language || 'en-US'
      const params = new URLSearchParams({ lang })
      if (coords) {
        if (coords.lat != null) params.set('lat', coords.lat)
        if (coords.lon != null) params.set('lon', coords.lon)
        if (coords.accuracy != null) params.set('acc', coords.accuracy)
      }

      setStatus('connecting')
      statusRef.current = 'connecting'

      const tokenRes = await fetch('/api/realtime/openai-live-token?' + params.toString(), {
        method: priorTurns.length ? 'POST' : 'GET',
        credentials: 'include',
        headers: priorTurns.length ? { 'Content-Type': 'application/json' } : {},
        body: priorTurns.length ? JSON.stringify({ priorTurns }) : undefined,
      })

      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({}))
        if (tokenRes.status === 429 && body.trial) {
          setTrial({ active: true, remainingMs: 0, expiresAt: Date.now() })
        }
        throw new Error(body.error || `HTTP ${tokenRes.status}`)
      }

      const tokenData = await tokenRes.json()
      if (tokenData.trial) {
        const now = Date.now()
        setTrial({
          active: true,
          remainingMs: tokenData.trial.remainingMs,
          expiresAt: now + tokenData.trial.remainingMs,
        })
        if (trialTimeoutRef.current) clearTimeout(trialTimeoutRef.current)
        trialTimeoutRef.current = setTimeout(() => {
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, 'trial_expired')
          setError('Free trial for today is used up. Sign in or come back tomorrow.')
          setStatus('error')
          statusRef.current = 'error'
        }, tokenData.trial.remainingMs)
      } else {
        setTrial(null)
      }

      // 3. Open WebSocket to OpenAI Realtime
      const clientSecret = tokenData.clientSecret
      if (!clientSecret || !clientSecret.value) {
        throw new Error('No client secret received from server')
      }
      const model = tokenData.model || 'gpt-realtime-1.5'
      const wsUrl = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`
      const ws = new WebSocket(wsUrl, [
        'realtime',
        `openai-insecure-api-key.${clientSecret.value}`,
        'openai-beta.realtime-v1',
      ])
      wsRef.current = ws

      ws.onopen = () => {
        setStatus('listening')
        statusRef.current = 'listening'

        // Store credits start function for charge-on-proof
        if (tokenData.signedIn) {
          creditsStartFnRef.current = () => startCreditsHeartbeat()
        }

        // Start mic streaming if not text-only
        if (micStream && audioCtxRef.current) {
          const source = audioCtxRef.current.createMediaStreamSource(micStream)
          const processor = audioCtxRef.current.createScriptProcessor(4096, 1, 1)
          processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return
            const input = e.inputBuffer.getChannelData(0)
            const pcm16 = floatTo16BitPCM(input)
            const b64 = base64FromBytes(new Uint8Array(pcm16.buffer))
            ws.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: b64,
            }))
            // Mic level for halo
            let sum = 0
            for (let i = 0; i < input.length; i++) sum += input[i] * input[i]
            setUserLevel(Math.sqrt(sum / input.length))
          }
          source.connect(processor)
          processor.connect(audioCtxRef.current.destination)
          workletNodeRef.current = processor
        }

        // If handoff with prior turns, inject them
        if (priorTurns.length) {
          for (const t of priorTurns) {
            ws.send(JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: t.role === 'assistant' ? 'assistant' : 'user',
                content: [{ type: 'input_text', text: t.text || t.content || '' }],
              },
            }))
          }
        }

        // Camera auto-send if already streaming
        if (cameraStreamRef.current) {
          startFrameSender(cameraStreamRef.current, 'camera')
        }
      }

      ws.onmessage = handleMessage

      ws.onerror = () => {
        setError('Connection error')
        setStatus('error')
        statusRef.current = 'error'
      }

      ws.onclose = (e) => {
        if (statusRef.current !== 'error' && statusRef.current !== 'idle') {
          setStatus('idle')
          statusRef.current = 'idle'
        }
        if (creditsIntervalRef.current) {
          clearInterval(creditsIntervalRef.current)
          creditsIntervalRef.current = null
        }
        creditsStartedRef.current = false
        creditsStartFnRef.current = null
      }

    } catch (err) {
      setError(err.message || 'Failed to start')
      setStatus('error')
      statusRef.current = 'error'
    } finally {
      startInFlightRef.current = false
    }
  }, [clearAudioQueue, handleMessage, startCreditsHeartbeat, startFrameSender, coords])

  // ── Camera control ────────────────────────────────────────────
  const startCamera = useCallback(async (opts = {}) => {
    setVisionError(null)
    if (cameraStreamRef.current) return
    const side = opts.side || 'back'
    const facing = side === 'front' ? 'user' : 'environment'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      cameraStreamRef.current = stream
      setCameraStream(stream)
      setCurrentFacingMode(facing)
      // If WS is live, start sending frames
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        startFrameSender(stream, 'camera')
      }
    } catch (e) {
      if (e.name !== 'NotAllowedError') {
        setVisionError(e.message || 'Camera failed')
      }
    }
  }, [startFrameSender])

  const stopCamera = useCallback(() => {
    stopFrameSender('camera')
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop())
      cameraStreamRef.current = null
      setCameraStream(null)
    }
  }, [stopFrameSender])

  const startScreen = useCallback(async () => {
    setVisionError(null)
    if (screenStreamRef.current) return
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 2 } }, audio: false })
      screenStreamRef.current = stream
      setScreenStream(stream)
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        stopFrameSender('screen')
        screenStreamRef.current = null
        setScreenStream(null)
      })
      startFrameSender(stream, 'screen')
    } catch (e) {
      if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
        setVisionError(e.message || 'Screen share failed')
      }
    }
  }, [startFrameSender, stopFrameSender])

  const stopScreen = useCallback(() => {
    stopFrameSender('screen')
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
      setScreenStream(null)
    }
  }, [stopFrameSender])

  // ── Stop ──────────────────────────────────────────────────────
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
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }
    stopFrameSender('camera')
    stopFrameSender('screen')
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop())
      cameraStreamRef.current = null
      setCameraStream(null)
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
      setScreenStream(null)
    }
    if (trialTimeoutRef.current) {
      clearTimeout(trialTimeoutRef.current)
      trialTimeoutRef.current = null
    }
    if (creditsIntervalRef.current) {
      clearInterval(creditsIntervalRef.current)
      creditsIntervalRef.current = null
    }
    playbackGenerationRef.current += 1
    for (const src of activeSourcesRef.current) {
      try { src.onended = null } catch (_) {}
      try { src.stop(0) } catch (_) {}
      try { src.disconnect() } catch (_) {}
    }
    activeSourcesRef.current.clear()
    playbackPlayingRef.current = false
    creditsStartedRef.current = false
    creditsStartFnRef.current = null
    setUserLevel(0)
    setStatus('idle')
    statusRef.current = 'idle'
    setError(null)
    setVisionError(null)
  }, [stopFrameSender, clearAudioQueue])

  useEffect(() => () => { stop() }, [stop])

  // Camera controller registration
  useEffect(() => {
    if (!active) return undefined
    setCameraController({
      start: (opts) => startCamera(opts),
      stop: () => stopCamera(),
      getTrack: () => {
        const src = cameraStreamRef.current
        if (src && typeof src.getVideoTracks === 'function') {
          const tracks = src.getVideoTracks()
          return tracks && tracks[0] ? tracks[0] : null
        }
        return null
      },
    })
    return () => setCameraController(null)
  }, [active, startCamera, stopCamera])

  const isBusy = useCallback(() => {
    if (startInFlightRef.current) return true
    const ws = wsRef.current
    if (ws && ws.readyState !== WebSocket.CLOSED) return true
    return false
  }, [])

  const setMuted = useCallback((muted) => {
    if (outputGainRef.current) {
      outputGainRef.current.gain.value = muted ? 0 : 1
    }
  }, [])

  const sendText = useCallback(async (text) => {
    if (!text || typeof text !== 'string') return
    const trimmed = text.trim()
    if (!trimmed) return
    appendTurn('user', trimmed, true)
    lastActivityAtRef.current = Date.now()
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || statusRef.current === 'idle') {
      await start({ textOnly: true })
      const deadline = Date.now() + 8000
      while (Date.now() < deadline) {
        const s = statusRef.current
        if (s === 'listening') break
        if (s === 'error' || s === 'idle') break
        await new Promise(r => setTimeout(r, 150))
      }
    }
    const activeWs = wsRef.current
    if (activeWs && activeWs.readyState === WebSocket.OPEN && statusRef.current === 'listening') {
      activeWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: trimmed }],
        },
      }))
      activeWs.send(JSON.stringify({ type: 'response.create' }))
      setStatus('thinking')
      statusRef.current = 'thinking'
    }
  }, [appendTurn, start])

  const clearTurns = useCallback(() => {
    setTurns([])
    turnActiveRef.current = { user: null, assistant: null }
  }, [])

  const loadTurns = useCallback((entries) => {
    if (!Array.isArray(entries)) return
    setTurns(entries.map(e => ({ role: e.role, text: e.text || e.content || '' })))
    turnActiveRef.current = { user: null, assistant: null }
  }, [])

  return {
    status, error, start, stop, turns, userLevel,
    cameraStream, screenStream, visionError,
    startCamera, stopCamera, startScreen, stopScreen,
    trial,
    isBusy,
    setMuted,
    sendText,
    clearTurns,
    loadTurns,
  }
}
