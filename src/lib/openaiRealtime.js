// OpenAI Realtime WebRTC client — same technology as ChatGPT voice mode.
// Real-time bidirectional audio via WebRTC, events via data channel.
// Drop-in replacement for the old REST pipeline hook.

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
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)

  const statusRef = useRef('idle')
  const startInFlightRef = useRef(false)
  const pcRef = useRef(null)           // RTCPeerConnection
  const dcRef = useRef(null)           // data channel
  const micStreamRef = useRef(null)
  const sessionActiveRef = useRef(false)
  const creditsIntervalRef = useRef(null)
  const lastActivityAtRef = useRef(Date.now())
  const trialTimeoutRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const turnActiveRef = useRef({ user: null, assistant: null })
  const audioElRef = useRef(null)      // playback <audio> element
  const meterCtxRef = useRef(null)
  const analyserRef = useRef(null)
  const micLevelRafRef = useRef(null)
  // Pending tool calls accumulator — function_call_arguments arrive in
  // deltas; we accumulate per call_id and dispatch on .done.
  const pendingToolArgsRef = useRef({})
  // Vision: continuous frame sender for camera
  const frameSenderRef = useRef(null)
  const visionContextRef = useRef([])
  // Offline message queue — persisted in localStorage so messages survive
  // page reloads during network outages.
  const offlineQueueRef = useRef([])
  const OFFLINE_QUEUE_KEY = 'kelion_offline_queue'

  // ── Turn management ────────────────────────────────────────────
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

  // ── Mic level meter (halo reactivity) ──────────────────────────
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
      const v = Math.max(0, Math.min(1, (sum / 24 - 20) / 100))
      setUserLevel(v)
      micLevelRafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  // ── Data channel event handler ─────────────────────────────────
  const handleDCMessage = useCallback(async (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }

    const type = msg.type || ''

    // User started/stopped speaking (server VAD)
    if (type === 'input_audio_buffer.speech_started') {
      lastActivityAtRef.current = Date.now()
      setStatus('listening')
      statusRef.current = 'listening'
      return
    }
    if (type === 'input_audio_buffer.speech_stopped') {
      setStatus('thinking')
      statusRef.current = 'thinking'
      return
    }

    // User speech transcription
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = msg.transcript || ''
      if (text.trim()) {
        appendTurn('user', text.trim(), true)
        lastActivityAtRef.current = Date.now()
      }
      return
    }

    // Assistant audio transcript (streaming)
    if (type === 'response.audio_transcript.delta') {
      const delta = msg.delta || ''
      if (delta) {
        appendTurn('assistant', delta, false)
        lastActivityAtRef.current = Date.now()
        setStatus('speaking')
        statusRef.current = 'speaking'
      }
      return
    }

    // Assistant audio transcript done
    if (type === 'response.audio_transcript.done') {
      return
    }

    // Assistant text (non-audio) response
    if (type === 'response.text.delta') {
      const delta = msg.delta || ''
      if (delta) appendTurn('assistant', delta, false)
      return
    }

    // Function call arguments accumulate
    if (type === 'response.function_call_arguments.delta') {
      const callId = msg.call_id || ''
      if (!pendingToolArgsRef.current[callId]) pendingToolArgsRef.current[callId] = { name: '', args: '' }
      pendingToolArgsRef.current[callId].args += (msg.delta || '')
      return
    }

    // Function call ready to execute
    if (type === 'response.function_call_arguments.done') {
      const callId = msg.call_id || ''
      const name = msg.name || pendingToolArgsRef.current[callId]?.name || ''
      const argsStr = msg.arguments || pendingToolArgsRef.current[callId]?.args || '{}'
      delete pendingToolArgsRef.current[callId]

      let args = {}
      try { args = JSON.parse(argsStr) } catch {}

      appendTurn('assistant', `[tool: ${name}]`, true)

      // Execute tool
      let result = { error: 'tool not found' }
      try { result = await runTool(name, args) } catch (err) {
        result = { error: err.message || 'tool failed' }
      }

      // Send tool result back via data channel
      const dc = dcRef.current
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result),
          },
        }))
        dc.send(JSON.stringify({ type: 'response.create' }))
      }
      return
    }

    // Response output item added — capture function name for pending args
    if (type === 'response.output_item.added') {
      const item = msg.item || {}
      if (item.type === 'function_call' && item.call_id) {
        pendingToolArgsRef.current[item.call_id] = { name: item.name || '', args: '' }
      }
      return
    }

    // Response done
    if (type === 'response.done') {
      if (sessionActiveRef.current) {
        setStatus('listening')
        statusRef.current = 'listening'
      }
      return
    }

    // Session created/updated — connection is live
    if (type === 'session.created' || type === 'session.updated') {
      setStatus('listening')
      statusRef.current = 'listening'
      return
    }

    // Errors
    if (type === 'error') {
      console.error('[openai-rtc] error:', msg.error)
      const errMsg = msg.error?.message || 'Realtime error'
      setError(errMsg)
      return
    }
  }, [appendTurn])

  // ── Credits heartbeat ──────────────────────────────────────────
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

  // ── Stop ───────────────────────────────────────────────────────
  const stop = useCallback(() => {
    sessionActiveRef.current = false

    // Close data channel
    if (dcRef.current) {
      try { dcRef.current.close() } catch (_) {}
      dcRef.current = null
    }

    // Close peer connection
    if (pcRef.current) {
      try { pcRef.current.close() } catch (_) {}
      pcRef.current = null
    }

    // Stop mic
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }

    // Stop playback
    if (audioElRef.current) {
      try { audioElRef.current.pause(); audioElRef.current.srcObject = null } catch (_) {}
    }

    // Stop mic level meter
    if (micLevelRafRef.current) cancelAnimationFrame(micLevelRafRef.current)
    analyserRef.current = null
    if (meterCtxRef.current) {
      try { meterCtxRef.current.close() } catch (_) {}
      meterCtxRef.current = null
    }

    // Stop camera/screen
    stopFrameStream()
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

    // Clear timers
    if (trialTimeoutRef.current) {
      clearTimeout(trialTimeoutRef.current)
      trialTimeoutRef.current = null
    }
    if (creditsIntervalRef.current) {
      clearInterval(creditsIntervalRef.current)
      creditsIntervalRef.current = null
    }

    pendingToolArgsRef.current = {}
    visionContextRef.current = []
    setUserLevel(0)
    setStatus('idle')
    statusRef.current = 'idle'
    setError(null)
    setVisionError(null)
  }, [])

  // ── Start — WebRTC connection to OpenAI Realtime ───────────────
  const start = useCallback(async (opts = {}) => {
    if (startInFlightRef.current) return
    startInFlightRef.current = true
    setError(null)
    setStatus('requesting')
    statusRef.current = 'requesting'
    lastActivityAtRef.current = Date.now()

    try {
      // 1. Get ephemeral token from our server
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
      const ephemeralKey = tokenData.clientSecret?.value || tokenData.clientSecret
      const model = tokenData.model || 'gpt-4o-realtime-preview-2024-12-17'

      if (!ephemeralKey) throw new Error('No ephemeral key returned')

      // Trial handling
      if (tokenData.trial) {
        const remainingMs = Math.max(0, Number(tokenData.trial.remainingMs) || 0)
        setTrial({ active: true, remainingMs, expiresAt: Date.now() + remainingMs })
        if (trialTimeoutRef.current) clearTimeout(trialTimeoutRef.current)
        trialTimeoutRef.current = setTimeout(() => {
          stop()
          setError('Free trial for today is used up. Sign in or come back tomorrow.')
        }, remainingMs)
      } else {
        setTrial(null)
      }

      setStatus('connecting')
      statusRef.current = 'connecting'

      // 2. Create RTCPeerConnection
      const pc = new RTCPeerConnection()
      pcRef.current = pc

      // 3. Handle incoming audio from OpenAI
      if (!audioElRef.current) {
        audioElRef.current = document.createElement('audio')
        audioElRef.current.autoplay = true
      }
      const audioEl = audioElRef.current

      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0]
        audioEl.play().catch(() => {})
        // Connect to audioRef for lipsync
        if (audioRef?.current) {
          audioRef.current.srcObject = event.streams[0]
          audioRef.current.muted = true
          audioRef.current.play().catch(() => {})
        }
      }

      // 4. Create data channel for events
      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc

      dc.addEventListener('open', () => {
        console.log('[openai-rtc] data channel open')
      })
      dc.addEventListener('message', handleDCMessage)

      // 5. Add microphone audio (skip for text-only)
      if (!opts.textOnly) {
        const micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 24000,
          },
        })
        micStreamRef.current = micStream
        const audioTrack = micStream.getAudioTracks()[0]
        pc.addTrack(audioTrack, micStream)
        startMicLevel(micStream)
      } else {
        // Text-only: add a silent audio track (WebRTC requires at least one)
        const ctx = new AudioContext()
        const oscillator = ctx.createOscillator()
        const dst = ctx.createMediaStreamDestination()
        oscillator.connect(dst)
        oscillator.start()
        const silentTrack = dst.stream.getAudioTracks()[0]
        // Mute it
        silentTrack.enabled = false
        pc.addTrack(silentTrack, dst.stream)
      }

      // 6. SDP exchange — create offer, send to OpenAI, get answer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        body: offer.sdp,
        headers: {
          'Authorization': `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
      })

      if (!sdpResponse.ok) {
        const errText = await sdpResponse.text()
        throw new Error(`SDP exchange failed: ${sdpResponse.status} ${errText.slice(0, 200)}`)
      }

      const answerSdp = await sdpResponse.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      sessionActiveRef.current = true

      // ── Auto-reconnect on disconnection ──────────────────────────
      // Mobile networks frequently drop — reconnect automatically up to
      // 3 times with exponential backoff so the user doesn't notice
      // brief coverage gaps.
      let reconnectAttempts = 0
      const MAX_RECONNECT = 3
      let reconnectTimer = null

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState
        if (state === 'connected') {
          reconnectAttempts = 0  // reset on success
          setStatus('listening')
          statusRef.current = 'listening'
          if (tokenData.signedIn) startCreditsHeartbeat()
        }
        if (state === 'disconnected' || state === 'failed') {
          if (!sessionActiveRef.current) return

          if (reconnectAttempts < MAX_RECONNECT) {
            reconnectAttempts++
            const delay = Math.min(2000 * Math.pow(2, reconnectAttempts - 1), 10000)
            setStatus('reconnecting')
            statusRef.current = 'reconnecting'
            setError(`Connection lost. Reconnecting (${reconnectAttempts}/${MAX_RECONNECT})...`)
            console.warn(`[openai-rtc] disconnected, retry ${reconnectAttempts}/${MAX_RECONNECT} in ${delay}ms`)

            if (reconnectTimer) clearTimeout(reconnectTimer)
            reconnectTimer = setTimeout(() => {
              stop()
              start(opts).catch(() => {})
            }, delay)
          } else {
            // All retries exhausted — wait for browser 'online' event to
            // auto-reconnect (signal detector pattern). Setting status to
            // 'offline' ensures the handleOnline listener will call start().
            sessionActiveRef.current = false
            setStatus('offline')
            statusRef.current = 'offline'
            setError('Connection lost. Will reconnect automatically when signal returns.')
          }
        }
        if (state === 'closed') {
          if (reconnectTimer) clearTimeout(reconnectTimer)
          if (sessionActiveRef.current) {
            sessionActiveRef.current = false
            setStatus('idle')
            statusRef.current = 'idle'
          }
        }
      }

    } catch (err) {
      console.error('[openai-rtc] start error:', err)
      setError(err.message || 'Failed to start')
      setStatus('error')
      statusRef.current = 'error'
    } finally {
      startInFlightRef.current = false
    }
  }, [coords, handleDCMessage, startMicLevel, startCreditsHeartbeat, stop, audioRef])

  useEffect(() => () => { stop() }, [stop])

  // ── Offline / Online detection ──────────────────────────────────
  // Detect network state changes and auto-sync queued messages.
  useEffect(() => {
    // Load persisted offline queue on mount
    try {
      const saved = localStorage.getItem(OFFLINE_QUEUE_KEY)
      if (saved) offlineQueueRef.current = JSON.parse(saved)
    } catch (_) {}

    const handleOnline = () => {
      setIsOnline(true)
      setError(null)
      console.log('[kelion] Back online — flushing offline queue')
      // Auto-reconnect WebRTC if session was active
      if (statusRef.current === 'offline' || statusRef.current === 'reconnecting') {
        start().catch(() => {})
      }
      // Flush queued text messages
      flushOfflineQueue()
    }
    const handleOffline = () => {
      setIsOnline(false)
      setStatus('offline')
      statusRef.current = 'offline'
      setError('You are offline. Messages will be sent when connection returns.')
      console.warn('[kelion] Went offline')
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [start])

  // Persist offline queue to localStorage
  const saveOfflineQueue = useCallback((queue) => {
    offlineQueueRef.current = queue
    try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue)) } catch (_) {}
  }, [])

  // Flush queued messages once back online
  const flushOfflineQueue = useCallback(async () => {
    const queue = [...offlineQueueRef.current]
    if (!queue.length) return
    saveOfflineQueue([])
    for (const msg of queue) {
      try {
        // Re-send via sendText (will be defined below)
        const history = turns.map(t => ({ role: t.role, text: t.text })).slice(-20)
        const r = await fetch('/api/realtime/pipeline', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          body: JSON.stringify({
            textOverride: msg.text,
            history,
            visionContext: visionContextRef.current.join('; '),
          }),
        })
        if (r.ok) {
          const data = await r.json()
          if (data.assistantText) appendTurn('assistant', data.assistantText, true)
        }
      } catch (err) {
        console.warn('[kelion] offline flush failed for:', msg.text, err.message)
        // Put it back in queue if still offline
        if (!navigator.onLine) {
          saveOfflineQueue([...offlineQueueRef.current, msg])
          break
        }
      }
    }
  }, [turns, appendTurn, saveOfflineQueue])

  // ── sendText — typed message through the REST pipeline ──────────
  const sendText = useCallback(async (text) => {
    if (!text || typeof text !== 'string') return
    const trimmed = text.trim()
    if (!trimmed) return
    appendTurn('user', trimmed, true)
    lastActivityAtRef.current = Date.now()
    setStatus('thinking')
    statusRef.current = 'thinking'

    try {
      const history = turns.map(t => ({ role: t.role, text: t.text })).slice(-20)
      const r = await fetch('/api/realtime/pipeline', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        body: JSON.stringify({
          textOverride: trimmed,
          history,
          visionContext: visionContextRef.current.join('; '),
        }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${r.status}`)
      }
      const data = await r.json()
      if (data.assistantText) appendTurn('assistant', data.assistantText, true)
      if (data.audio) {
        if (!audioElRef.current) audioElRef.current = document.createElement('audio')
        const blob = new Blob(
          [Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))],
          { type: `audio/${data.audioFormat || 'mp3'}` }
        )
        const url = URL.createObjectURL(blob)
        audioElRef.current.src = url
        audioElRef.current.play().catch(() => {})
        if (audioRef?.current && audioRef.current !== audioElRef.current) {
          audioRef.current.src = url
          audioRef.current.play().catch(() => {})
        }
      }
      if (data.toolCalls?.length) {
        for (const tc of data.toolCalls) appendTurn('assistant', `[tool: ${tc.name}]`, true)
      }
    } catch (err) {
      console.error('[openai-rtc] sendText error:', err)
      // If offline or network error → queue the message for later sync
      if (!navigator.onLine || err.name === 'TypeError') {
        const queue = [...offlineQueueRef.current, { text: trimmed, ts: Date.now() }]
        saveOfflineQueue(queue)
        setError(`Offline — message queued (${queue.length} pending). Will send when connected.`)
        setStatus('offline')
        statusRef.current = 'offline'
        return
      }
      setError(err.message || 'Chat failed')
    } finally {
      if (statusRef.current !== 'offline') {
        setStatus(sessionActiveRef.current ? 'listening' : 'idle')
        statusRef.current = sessionActiveRef.current ? 'listening' : 'idle'
      }
    }
  }, [appendTurn, turns, audioRef, saveOfflineQueue])

  // ── Camera ─────────────────────────────────────────────────────
  // Vision frames go to /api/realtime/vision (GPT-5.5) since WebRTC
  // audio-only model doesn't accept video tracks.
  const startFrameStream = useCallback((stream, visionMode) => {
    if (frameSenderRef.current) return
    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    video.play().catch(() => {})
    const canvas = document.createElement('canvas')
    // Second canvas for motion detection (lower res)
    const motionCanvas = document.createElement('canvas')
    motionCanvas.width = 64
    motionCanvas.height = 48
    let running = true
    let busy = false
    let prevPixels = null

    // Vision modes:
    //   'eco'     → fixed 1fps, no motion detection (cheapest)
    //   'premium' → fixed 4fps continuous (best quality)
    //   default   → dynamic FPS via motion detection (balanced)
    const MODE = visionMode || 'dynamic'
    const FPS_STATIC = 1000   // 1fps
    const FPS_ACTIVE = 250    // 4fps
    const MOTION_THRESHOLD = 8 // pixel diff % to trigger active mode
    let currentInterval = MODE === 'premium' ? FPS_ACTIVE : FPS_STATIC
    let motionCooldown = 0     // frames of inactivity before dropping to 1fps

    function detectMotion(ctx) {
      const mCtx = motionCanvas.getContext('2d')
      if (!mCtx) return true // can't detect, assume motion
      mCtx.drawImage(video, 0, 0, 64, 48)
      const data = mCtx.getImageData(0, 0, 64, 48).data
      if (!prevPixels) { prevPixels = new Uint8Array(data); return true }
      let diffCount = 0
      const totalPixels = 64 * 48
      for (let i = 0; i < data.length; i += 16) { // sample every 4th pixel
        const diff = Math.abs(data[i] - prevPixels[i]) +
                     Math.abs(data[i+1] - prevPixels[i+1]) +
                     Math.abs(data[i+2] - prevPixels[i+2])
        if (diff > 60) diffCount++
      }
      prevPixels = new Uint8Array(data)
      const pct = (diffCount / (totalPixels / 4)) * 100
      return pct > MOTION_THRESHOLD
    }

    const sendFrame = async () => {
      if (!running || busy) return
      if (!video.videoWidth) return
      busy = true
      try {
        const scale = Math.min(1, 1024 / video.videoWidth)
        canvas.width = Math.floor(video.videoWidth * scale)
        canvas.height = Math.floor(video.videoHeight * scale)
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        // Motion detection — adjust FPS dynamically (skip if eco/premium)
        if (MODE === 'dynamic') {
          const hasMotion = detectMotion(ctx)
          if (hasMotion) {
            motionCooldown = 12 // stay at 4fps for ~3 sec after last motion
            if (currentInterval !== FPS_ACTIVE) {
              currentInterval = FPS_ACTIVE
              clearInterval(intervalId)
              intervalId = setInterval(sendFrame, currentInterval)
            }
          } else if (motionCooldown > 0) {
            motionCooldown--
          } else if (currentInterval !== FPS_STATIC) {
            currentInterval = FPS_STATIC
            clearInterval(intervalId)
            intervalId = setInterval(sendFrame, currentInterval)
          }
        }

        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.78))
        if (!blob || !running) { busy = false; return }
        const buf = await blob.arrayBuffer()
        // Safe base64 encoding (no stack overflow)
        const bytes = new Uint8Array(buf)
        let binary = ''
        const chunk = 0x8000
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
        }
        const b64 = btoa(binary)

        // Include date/time context so vision model knows when it is
        const now = new Date()
        const timeContext = {
          date: now.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
          time: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          timeOfDay: now.getHours() < 6 ? 'night' : now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening',
        }
        const r = await fetch('/api/realtime/vision', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          body: JSON.stringify({ image: b64, mimeType: 'image/jpeg', timeContext }),
        })
        if (r.ok) {
          const data = await r.json()
          if (data.description) {
            visionContextRef.current.push(data.description)
            if (visionContextRef.current.length > 10) visionContextRef.current.shift()
          }
        } else if (r.status === 402) {
          // Out of credits — stop vision completely (camera light off)
          console.warn('[vision] credits exhausted, stopping camera')
          running = false
          clearInterval(intervalId)
          try { video.pause(); video.srcObject?.getTracks().forEach(t => t.stop()); video.srcObject = null } catch (_) {}
        }
      } catch (_) {}
      busy = false
    }
    let intervalId = setInterval(sendFrame, currentInterval)
    sendFrame()
    frameSenderRef.current = { stop: () => { running = false; clearInterval(intervalId) }, video }
  }, [])

  const stopFrameStream = useCallback(() => {
    if (!frameSenderRef.current) return
    frameSenderRef.current.stop()
    try { frameSenderRef.current.video.pause(); frameSenderRef.current.video.srcObject = null } catch (_) {}
    frameSenderRef.current = null
  }, [])

  const startCamera = useCallback(async (opts = {}) => {
    setVisionError(null)
    if (cameraStreamRef.current) return
    const facing = (opts.side === 'front' || opts.facingMode === 'user') ? 'user' : 'environment'
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      cameraStreamRef.current = stream
      setCameraStream(stream)
      setCurrentFacingMode(facing)
      startFrameStream(stream, opts.visionMode || 'dynamic')
    } catch (e) {
      if (e.name !== 'NotAllowedError') setVisionError(e.message || 'Camera failed')
      throw e
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

  // Camera controller for voice tools
  useEffect(() => {
    if (!active) return undefined
    setCameraController({
      start: (opts) => startCamera(opts),
      stop: () => stopCamera(),
      restart: (opts) => startCamera(opts),
      getFacingMode: () => 'user',
      getActiveTrack: () => {
        const src = cameraStreamRef.current
        if (src && typeof src.getVideoTracks === 'function') {
          const tracks = src.getVideoTracks()
          return tracks?.[0] || null
        }
        return null
      },
    })
    return () => setCameraController(null)
  }, [active, startCamera, stopCamera])

  const isBusy = useCallback(() => {
    return startInFlightRef.current || (pcRef.current && pcRef.current.connectionState === 'connecting')
  }, [])

  const setMuted = useCallback((muted) => {
    if (audioElRef.current) audioElRef.current.muted = muted
  }, [])

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
    isOnline,
    pendingMessages: offlineQueueRef.current.length,
  }
}
