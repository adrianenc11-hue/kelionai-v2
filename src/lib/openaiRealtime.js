// GPT-5.5 Full Pipeline voice client hook.
// Drop-in replacement for useGeminiLive — same interface.
// Voice pipeline: Mic → MediaRecorder → /api/realtime/pipeline
//   (Whisper STT → GPT-5.5 chat + tools → OpenAI TTS ash) → audio playback
// Vision: GPT-5.5 via camera frames sent with each pipeline call.

import { useEffect, useRef, useState, useCallback } from 'react'
import { runTool } from './kelionTools'
import { setCameraController, setCurrentFacingMode } from './cameraControl'
import { getCsrfToken } from './api'

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

  const statusRef = useRef('idle')
  const startInFlightRef = useRef(false)
  const micStreamRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const audioChunksRef = useRef([])
  const sessionActiveRef = useRef(false)
  const creditsIntervalRef = useRef(null)
  const lastActivityAtRef = useRef(Date.now())
  const trialTimeoutRef = useRef(null)
  const outputGainRef = useRef(null)
  const playbackCtxRef = useRef(null)
  const activeSourcesRef = useRef(new Set())
  const cameraStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const turnActiveRef = useRef({ user: null, assistant: null })
  const processingRef = useRef(false)
  // Rolling vision context — last 5 scene descriptions from continuous frame sender
  const visionContextRef = useRef([])
  const frameSenderRef = useRef(null)

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

  // ── Capture camera frame (max quality) ────────────────────────
  const captureFrame = useCallback(() => {
    const stream = cameraStreamRef.current
    if (!stream) return null
    try {
      const tracks = stream.getVideoTracks()
      if (!tracks.length) return null
      const settings = tracks[0].getSettings()
      const canvas = document.createElement('canvas')
      // Full resolution — no downscaling
      const w = settings.width || 1920
      const h = settings.height || 1080
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      const videos = document.querySelectorAll('video')
      for (const v of videos) {
        if (v.srcObject === stream && v.videoWidth > 0) {
          ctx.drawImage(v, 0, 0, w, h)
          return canvas.toDataURL('image/jpeg', 0.92).split(',')[1]
        }
      }
    } catch (_) {}
    return null
  }, [])

  // ── Continuous vision stream — real-time to GPT-5.5 ────────────
  const startFrameStream = useCallback((stream) => {
    if (frameSenderRef.current) return
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.play().catch(() => {})
    const canvas = document.createElement('canvas')
    const JPEG_Q = 0.92  // max quality
    let running = true
    let busy = false

    // Real-time loop — sends next frame immediately after previous completes
    const sendFrame = async () => {
      if (!running || busy) return
      if (!video.videoWidth) { setTimeout(sendFrame, 100); return }
      busy = true
      try {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0)
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', JPEG_Q))
        if (!blob || !running) { busy = false; return }
        const buf = await blob.arrayBuffer()
        const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)))

        const r = await fetch('/api/realtime/vision', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          body: JSON.stringify({ image: b64, mimeType: 'image/jpeg' }),
        })
        if (r.ok) {
          const data = await r.json()
          if (data.description) {
            const ctx = visionContextRef.current
            ctx.push({ ts: Date.now(), text: data.description })
            if (ctx.length > 10) ctx.shift()
          }
        }
      } catch (_) {}
      busy = false
      if (running) requestAnimationFrame(() => setTimeout(sendFrame, 50))
    }
    sendFrame()
    frameSenderRef.current = { stop: () => { running = false }, video }
  }, [])

  const stopFrameStream = useCallback(() => {
    if (!frameSenderRef.current) return
    frameSenderRef.current.stop()
    try { frameSenderRef.current.video.pause(); frameSenderRef.current.video.srcObject = null } catch (_) {}
    frameSenderRef.current = null
  }, [])

  // ── Process a single turn through the pipeline ────────────────
  const processTurn = useCallback(async (audioBlob) => {
    if (processingRef.current) return
    processingRef.current = true
    setStatus('thinking')
    statusRef.current = 'thinking'

    try {
      // Convert blob to base64
      const arrayBuf = await audioBlob.arrayBuffer()
      const b64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)))

      // Get conversation history for context
      let history = []
      setTurns(prev => { history = prev.slice(-20); return prev })

      // Capture current camera frame + rolling vision context
      const cameraFrame = captureFrame()
      const visionContext = visionContextRef.current.map(v => v.text).join(' | ')

      const lang = navigator.language || 'en-US'
      const params = new URLSearchParams({ lang })

      const r = await fetch('/api/realtime/pipeline?' + params.toString(), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({
          audio: b64,
          mimeType: audioBlob.type || 'audio/webm',
          history: history.map(t => ({ role: t.role, text: t.text })),
          cameraFrame,
          visionContext,
        }),
      })

      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${r.status}`)
      }

      const data = await r.json()

      // Add user turn
      if (data.userText) {
        appendTurn('user', data.userText, true)
      }

      // Execute client-side tool calls
      if (data.toolCalls && data.toolCalls.length) {
        for (const tc of data.toolCalls) {
          try { await runTool(tc.name, tc.args) } catch (_) {}
        }
      }

      // Add assistant turn
      if (data.assistantText) {
        appendTurn('assistant', data.assistantText, true)
      }

      // Play audio response
      if (data.audio) {
        setStatus('speaking')
        statusRef.current = 'speaking'
        await playMP3(data.audio)
      }

    } catch (err) {
      console.error('[pipeline] error:', err)
      setError(err.message || 'Pipeline failed')
    } finally {
      processingRef.current = false
      if (sessionActiveRef.current) {
        setStatus('listening')
        statusRef.current = 'listening'
      }
    }
  }, [appendTurn, captureFrame])

  // ── Play MP3 audio ────────────────────────────────────────────
  const playMP3 = useCallback(async (b64) => {
    return new Promise((resolve) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'audio/mp3' })
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)

      // Drive lipsync via audioRef
      if (audioRef?.current) {
        try {
          audioRef.current.src = url
          audioRef.current.play().catch(() => {})
        } catch (_) {}
      }

      audio.volume = outputGainRef.current?.value ?? 1
      audio.onended = () => {
        URL.revokeObjectURL(url)
        resolve()
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        resolve()
      }
      activeSourcesRef.current.add(audio)
      audio.play().catch(() => resolve())
    })
  }, [audioRef])

  // ── VAD — voice activity detection via energy ─────────────────
  const setupVAD = useCallback((stream) => {
    const audioCtx = new AudioContext()
    const source = audioCtx.createMediaStreamSource(stream)
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const data = new Float32Array(analyser.fftSize)

    let speaking = false
    let silenceStart = 0
    const SILENCE_THRESHOLD = 0.01
    const SILENCE_DURATION = 1200 // ms of silence before processing

    // Also set up MediaRecorder
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    })
    mediaRecorderRef.current = recorder
    audioChunksRef.current = []

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      if (audioChunksRef.current.length > 0 && sessionActiveRef.current) {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType })
        audioChunksRef.current = []
        processTurn(blob)
      }
    }

    // VAD loop
    const checkVAD = () => {
      if (!sessionActiveRef.current) return
      analyser.getFloatTimeDomainData(data)
      let energy = 0
      for (let i = 0; i < data.length; i++) energy += data[i] * data[i]
      energy = Math.sqrt(energy / data.length)
      setUserLevel(energy)

      if (energy > SILENCE_THRESHOLD) {
        lastActivityAtRef.current = Date.now()
        if (!speaking) {
          speaking = true
          // Start recording
          if (recorder.state === 'inactive' && !processingRef.current) {
            audioChunksRef.current = []
            try { recorder.start() } catch (_) {}
          }
        }
        silenceStart = 0
      } else {
        if (speaking) {
          if (!silenceStart) silenceStart = Date.now()
          if (Date.now() - silenceStart > SILENCE_DURATION) {
            speaking = false
            silenceStart = 0
            // Stop recording → triggers onstop → processTurn
            if (recorder.state === 'recording') {
              try { recorder.stop() } catch (_) {}
            }
          }
        }
      }
      requestAnimationFrame(checkVAD)
    }
    requestAnimationFrame(checkVAD)

    return audioCtx
  }, [processTurn])

  // ── Credits heartbeat ─────────────────────────────────────────
  const startCreditsHeartbeat = useCallback(() => {
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
          stop()
        }
      } catch (_) {}
    }
    tick()
    creditsIntervalRef.current = setInterval(tick, 60000)
  }, [])

  // ── Start ─────────────────────────────────────────────────────
  const start = useCallback(async (opts = {}) => {
    if (startInFlightRef.current) return
    startInFlightRef.current = true
    setError(null)
    setStatus('requesting')
    statusRef.current = 'requesting'

    try {
      // Check trial/credits by hitting the token endpoint
      const lang = navigator.language || 'en-US'
      const params = new URLSearchParams({ lang })
      if (coords) {
        if (coords.lat != null) params.set('lat', coords.lat)
        if (coords.lon != null) params.set('lon', coords.lon)
      }

      const tokenRes = await fetch('/api/realtime/openai-live-token?' + params.toString(), {
        credentials: 'include',
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
        setTrial({
          active: true,
          remainingMs: tokenData.trial.remainingMs,
          expiresAt: Date.now() + tokenData.trial.remainingMs,
        })
        if (trialTimeoutRef.current) clearTimeout(trialTimeoutRef.current)
        trialTimeoutRef.current = setTimeout(() => {
          stop()
          setError('Free trial for today is used up. Sign in or come back tomorrow.')
        }, tokenData.trial.remainingMs)
      } else {
        setTrial(null)
      }

      // Start mic if not text-only
      if (!opts.textOnly) {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        micStreamRef.current = micStream
        setupVAD(micStream)
      }

      sessionActiveRef.current = true

      // Start credits heartbeat if signed in
      if (tokenData.signedIn) {
        startCreditsHeartbeat()
      }

      setStatus('listening')
      statusRef.current = 'listening'

    } catch (err) {
      setError(err.message || 'Failed to start')
      setStatus('error')
      statusRef.current = 'error'
    } finally {
      startInFlightRef.current = false
    }
  }, [coords, setupVAD, startCreditsHeartbeat])

  // ── Stop ──────────────────────────────────────────────────────
  const stop = useCallback(() => {
    sessionActiveRef.current = false
    stopFrameStream()
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop() } catch (_) {}
    }
    mediaRecorderRef.current = null
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }
    if (trialTimeoutRef.current) {
      clearTimeout(trialTimeoutRef.current)
      trialTimeoutRef.current = null
    }
    if (creditsIntervalRef.current) {
      clearInterval(creditsIntervalRef.current)
      creditsIntervalRef.current = null
    }
    for (const src of activeSourcesRef.current) {
      try { src.pause(); src.src = '' } catch (_) {}
    }
    activeSourcesRef.current.clear()
    visionContextRef.current = []
    setUserLevel(0)
    setStatus('idle')
    statusRef.current = 'idle'
    setError(null)
    setVisionError(null)
  }, [stopFrameStream])

  useEffect(() => () => { stop() }, [stop])

  // ── Camera (max quality, continuous live video stream) ────────
  const startCamera = useCallback(async (opts = {}) => {
    setVisionError(null)
    if (cameraStreamRef.current) return
    const side = opts.side || 'back'
    const facing = side === 'front' ? 'user' : 'environment'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          // Request maximum device capability — each device gives its best
          width: { ideal: 4096 },
          height: { ideal: 2160 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      })
      cameraStreamRef.current = stream
      setCameraStream(stream)
      setCurrentFacingMode(facing)
      // Start continuous frame stream to GPT-5.5 vision
      startFrameStream(stream)
    } catch (e) {
      if (e.name !== 'NotAllowedError') {
        setVisionError(e.message || 'Camera failed')
      }
    }
  }, [startFrameStream])

  const stopCamera = useCallback(() => {
    stopFrameStream()
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach(t => t.stop())
      cameraStreamRef.current = null
      setCameraStream(null)
    }
    visionContextRef.current = []
  }, [stopFrameStream])

  const startScreen = useCallback(async () => {
    setVisionError(null)
    if (screenStreamRef.current) return
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      screenStreamRef.current = stream
      setScreenStream(stream)
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        screenStreamRef.current = null
        setScreenStream(null)
      })
    } catch (e) {
      if (e.name !== 'AbortError' && e.name !== 'NotAllowedError') {
        setVisionError(e.message || 'Screen share failed')
      }
    }
  }, [])

  const stopScreen = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
      setScreenStream(null)
    }
  }, [])

  // Camera controller
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
    return startInFlightRef.current || processingRef.current
  }, [])

  const setMuted = useCallback((muted) => {
    if (!outputGainRef.current) outputGainRef.current = { value: muted ? 0 : 1 }
    else outputGainRef.current.value = muted ? 0 : 1
  }, [])

  // ── sendText — typed message through the pipeline ─────────────
  const sendText = useCallback(async (text) => {
    if (!text || typeof text !== 'string') return
    const trimmed = text.trim()
    if (!trimmed) return
    appendTurn('user', trimmed, true)
    lastActivityAtRef.current = Date.now()

    // If not started, start first
    if (!sessionActiveRef.current) {
      await start({ textOnly: true })
    }

    setStatus('thinking')
    statusRef.current = 'thinking'

    try {
      let history = []
      setTurns(prev => { history = prev.slice(-20); return prev })
      const cameraFrame = captureFrame()
      const lang = navigator.language || 'en-US'

      const r = await fetch('/api/realtime/pipeline?' + new URLSearchParams({ lang }).toString(), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': getCsrfToken(),
        },
        body: JSON.stringify({
          audio: btoa('silence'),
          textOverride: trimmed,
          mimeType: 'text/plain',
          history: history.map(t => ({ role: t.role, text: t.text })),
          cameraFrame,
          visionContext: visionContextRef.current.map(v => v.text).join(' | '),
        }),
      })

      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${r.status}`)
      }

      const data = await r.json()

      if (data.toolCalls && data.toolCalls.length) {
        for (const tc of data.toolCalls) {
          try { await runTool(tc.name, tc.args) } catch (_) {}
        }
      }

      if (data.assistantText) {
        appendTurn('assistant', data.assistantText, true)
      }

      if (data.audio) {
        setStatus('speaking')
        statusRef.current = 'speaking'
        await playMP3(data.audio)
      }
    } catch (err) {
      setError(err.message || 'Failed')
    } finally {
      setStatus('listening')
      statusRef.current = 'listening'
    }
  }, [appendTurn, start, captureFrame, playMP3])

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
