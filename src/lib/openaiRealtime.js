// OpenAI Realtime (GA) client hook — Plan C transport.
//
// Mirrors the public API surface of `useGeminiLive` so `KelionStage.jsx`
// can swap providers without touching component code (see PR3 of the
// Plan C series). Uses the GA-recommended **WebRTC** path for browser
// clients: an ephemeral `client_secret` minted by our server
// (/api/realtime/openai-live-token), an RTCPeerConnection for audio
// I/O, and a single `oai-events` DataChannel carrying JSON events
// (`session.update`, `response.output_audio_transcript.delta`,
// `response.function_call_arguments.done`, …).
//
// Why WebRTC instead of WebSocket? OpenAI's own guidance:
//   > For browser and mobile clients, we recommend connecting via WebRTC.
//   > It is possible to use WebSocket in browsers with an ephemeral API
//   > token, but WebRTC will be a more robust solution in most cases.
// Browsers can't set a custom Authorization header on a WebSocket
// handshake; the documented WS workaround is a subprotocol name
// containing the plaintext ephemeral key, which is officially
// discouraged. WebRTC posts the SDP offer with `Authorization: Bearer
// <ephemeral>` over plain HTTPS, then the media/event streams flow on
// an authenticated peer connection — no header-smuggling, and the
// browser handles audio codec, jitter buffer, NAT traversal, and
// barge-in muting natively.
//
// Kept the module dormant in this PR: nothing imports it yet. PR3
// wires it into KelionStage behind a provider flag.

import { useCallback, useEffect, useRef, useState } from 'react'
import { runTool } from './kelionTools'

// Public signature matches useGeminiLive exactly so swapping is a
// one-line change in KelionStage.
//
//   const live = useOpenAIRealtime({ audioRef, coords, onBalanceUpdate })
//
// Returned shape: { status, error, start, stop, turns, userLevel,
//                   cameraStream, screenStream, visionError,
//                   startCamera, stopCamera, startScreen, stopScreen,
//                   trial }
//
// Camera/screen-share are declared but no-op in this first transport
// cut: OpenAI Realtime GA does not yet accept live video over
// WebRTC the way Gemini does via `realtimeInput.video`. We keep the
// shape so KelionStage's vision buttons remain safe to press; PR4
// may wire it up via image attachments on `conversation.item.create`.
export function useOpenAIRealtime({ audioRef, coords = null, onBalanceUpdate = null }) {
  const onBalanceUpdateRef = useRef(onBalanceUpdate)
  onBalanceUpdateRef.current = onBalanceUpdate

  const [status, setStatus] = useState('idle')
  const [error, setError]   = useState(null)
  const [turns, setTurns]   = useState([])
  const [userLevel, setUserLevel] = useState(0)
  // Camera/screen are exposed for shape-compatibility with geminiLive.
  // Not streamed to OpenAI in this transport cut — see module header.
  const [cameraStream, setCameraStream] = useState(null)
  const [screenStream, setScreenStream] = useState(null)
  const [visionError, setVisionError]   = useState(null)
  const [trial, setTrial]               = useState(null)

  // In-flight lock identical in spirit to geminiLive — tap+wake-word
  // both call start() off stale closures. One openAI session at a time.
  const startInFlightRef = useRef(false)

  const pcRef         = useRef(null)          // RTCPeerConnection
  const dcRef         = useRef(null)          // oai-events DataChannel
  const micStreamRef  = useRef(null)
  const remoteStreamRef = useRef(null)
  const trialTimeoutRef = useRef(null)
  const creditsIntervalRef = useRef(null)
  const creditsStartedRef  = useRef(false)
  const creditsStartFnRef  = useRef(null)

  // Mic level meter (drives halo reactive glow). Own AudioContext so
  // we never clobber the playback context.
  const meterCtxRef  = useRef(null)
  const analyserRef  = useRef(null)
  const micLevelRafRef = useRef(null)

  // Turn bookkeeping — keyed by role so delta text from transcript
  // events gets appended to the currently-open turn instead of
  // starting a new bubble on every chunk.
  const turnActiveRef = useRef({ user: null, assistant: null })

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

  // Pending function-call accumulators keyed by OpenAI's call_id.
  // response.function_call_arguments.delta streams a JSON string one
  // fragment at a time; when .done arrives we parse + execute.
  const pendingToolArgsRef = useRef(new Map())
  const pendingToolNameRef = useRef(new Map())

  const sendEvent = useCallback((dc, event) => {
    if (!dc || dc.readyState !== 'open') return false
    try {
      dc.send(JSON.stringify(event))
      return true
    } catch (err) {
      console.error('[openaiRealtime] dc send failed', err)
      return false
    }
  }, [])

  const runToolAndRespond = useCallback(async (dc, callId, name, argsJson) => {
    let parsed = {}
    try { parsed = argsJson ? JSON.parse(argsJson) : {} } catch { /* keep {} */ }
    appendTurn('assistant', `[tool: ${name}]`, true)
    let output
    try {
      const result = await runTool(name, parsed)
      output = typeof result === 'string' ? result : JSON.stringify(result)
    } catch (err) {
      console.error('[openaiRealtime] tool execution failed', err)
      output = `Tool error: ${err.message || 'unknown'}. Tell the user honestly and move on.`
    }
    // Deliver the result the way OpenAI Realtime expects: a
    // `function_call_output` conversation item carrying the call_id,
    // then a fresh `response.create` so the model continues the turn
    // with the tool result folded in.
    sendEvent(dc, {
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    })
    sendEvent(dc, { type: 'response.create' })
  }, [appendTurn, sendEvent])

  // Main event pump. `dc` is the concrete DataChannel this message
  // arrived on — passing it in keeps us from using a stale ref if
  // start() gets called twice before the lock released (lock should
  // prevent that, belt + braces).
  const handleEvent = useCallback(async (event, dc) => {
    if (!event || !event.type) return

    // First proof the session is alive — safe to start charging.
    if (creditsStartFnRef.current) {
      try { creditsStartFnRef.current() } catch (_) { /* never break the pump */ }
    }

    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        // Initial handshake done. We flip to 'listening' here rather
        // than on dc.onopen because `session.created` is the first
        // event that proves the server actually accepted our
        // session.update.
        setStatus((s) => (s === 'speaking' ? s : 'listening'))
        return

      // User-speech VAD markers — interrupt any in-flight assistant audio.
      case 'input_audio_buffer.speech_started':
        // OpenAI's server handles interrupt_response automatically when
        // we enable it in session.update; the remote track goes silent
        // on its own. We just reflect state so the HUD shows the mic.
        setStatus('listening')
        return
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        return

      // User transcript (from whisper, async/approximate per OpenAI docs).
      case 'conversation.item.input_audio_transcription.delta':
        if (event.delta) appendTurn('user', event.delta, false)
        return
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript) appendTurn('user', event.transcript, true)
        turnActiveRef.current.user = null
        return

      // Assistant transcript of its own speech output.
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': // pre-GA alias, still seen in the wild
        if (event.delta) appendTurn('assistant', event.delta, false)
        setStatus('speaking')
        return
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        turnActiveRef.current.assistant = null
        return

      // Assistant plain-text output (no audio modality). Rare when the
      // session is configured for audio+text, but handle it so text
      // stays visible if the model chooses not to speak.
      case 'response.output_text.delta':
      case 'response.text.delta':
        if (event.delta) appendTurn('assistant', event.delta, false)
        return
      case 'response.output_text.done':
      case 'response.text.done':
        turnActiveRef.current.assistant = null
        return

      // Function/tool calls. Arguments arrive as JSON fragments across
      // many `.delta` events and are finalised in `.done`.
      case 'response.function_call_arguments.delta': {
        const id = event.call_id || event.id
        if (!id) return
        const prev = pendingToolArgsRef.current.get(id) || ''
        pendingToolArgsRef.current.set(id, prev + (event.delta || ''))
        if (event.name && !pendingToolNameRef.current.has(id)) {
          pendingToolNameRef.current.set(id, event.name)
        }
        return
      }
      case 'response.function_call_arguments.done': {
        const id = event.call_id || event.id
        if (!id) return
        const name = event.name || pendingToolNameRef.current.get(id)
        const argsJson = event.arguments ?? pendingToolArgsRef.current.get(id) ?? ''
        pendingToolArgsRef.current.delete(id)
        pendingToolNameRef.current.delete(id)
        if (name) await runToolAndRespond(dc, id, name, argsJson)
        return
      }
      // Some builds of the API emit output_item.done with a
      // function_call payload — handle it as a fallback.
      case 'response.output_item.done': {
        const it = event.item
        if (it?.type === 'function_call' && it.name && it.call_id) {
          await runToolAndRespond(dc, it.call_id, it.name, it.arguments || '')
        }
        return
      }

      case 'response.done':
        if (status !== 'error') setStatus('listening')
        return

      case 'error': {
        const msg = event.error?.message || 'Server error'
        console.error('[openaiRealtime] server error', event.error)
        setError(msg)
        setStatus('error')
        return
      }

      default:
        // Unknown/uninteresting — ignore. Keeps forward-compat with
        // future event types added by OpenAI.
        return
    }
  }, [appendTurn, runToolAndRespond, status])

  const start = useCallback(async () => {
    if (startInFlightRef.current) return
    // Tear down any residual peer connection before opening a new one.
    if (pcRef.current) {
      try { pcRef.current.close() } catch (_) { /* ignore */ }
      pcRef.current = null
    }
    startInFlightRef.current = true
    setError(null)
    setStatus('requesting')

    try {
      // 1. Mic
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        video: false,
      })
      micStreamRef.current = stream
      startMicLevel(stream)

      setStatus('connecting')

      // 2. Ephemeral token + first-frame session.update from our server.
      const langHint = navigator.language || 'en-US'
      const geoQuery = (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon))
        ? `&lat=${coords.lat.toFixed(6)}&lon=${coords.lon.toFixed(6)}&acc=${Math.round(coords.accuracy || 0)}`
        : ''
      const tokenRes = await fetch(
        `/api/realtime/openai-live-token?lang=${encodeURIComponent(langHint)}${geoQuery}`,
        { credentials: 'include' },
      )
      if (tokenRes.status === 429) {
        let body = null
        try { body = await tokenRes.json() } catch (_) { /* ignore */ }
        const msg = body?.error || 'Free trial used up for today. Sign in or buy credits to keep talking.'
        setTrial({ active: false, remainingMs: 0, expiresAt: 0, exhausted: true })
        throw new Error(msg)
      }
      if (tokenRes.status === 402) {
        let body = null
        try { body = await tokenRes.json() } catch (_) { /* ignore */ }
        throw new Error(body?.error || 'No credits left. Buy a package to keep talking.')
      }
      if (!tokenRes.ok) {
        const txt = await tokenRes.text()
        throw new Error(`Token fetch failed: ${tokenRes.status} ${txt}`)
      }
      const tokenBody = await tokenRes.json()
      const ephemeral = tokenBody?.token
      const firstFrame = tokenBody?.setup
      const model = tokenBody?.model
      if (!ephemeral) throw new Error('No ephemeral token returned')
      if (!firstFrame) throw new Error('No session.update payload returned')
      if (!model)      throw new Error('No model id returned')

      // Trial countdown — identical contract to /gemini-token.
      if (tokenBody.trial && tokenBody.trial.allowed) {
        const remainingMs = Math.max(0, Number(tokenBody.trial.remainingMs) || 0)
        const expiresAt = Date.now() + remainingMs
        setTrial({ active: true, remainingMs, expiresAt, exhausted: false })
        if (trialTimeoutRef.current) clearTimeout(trialTimeoutRef.current)
        trialTimeoutRef.current = setTimeout(() => {
          try { pcRef.current?.close() } catch (_) { /* ignore */ }
          setTrial((t) => (t ? { ...t, active: false, remainingMs: 0, exhausted: true } : t))
          setError('Free trial used up for today. Sign in or buy credits to keep talking.')
          setStatus('error')
        }, remainingMs)
      } else {
        setTrial(null)
      }

      // 3. RTCPeerConnection — mic track out, assistant audio track in.
      const pc = new RTCPeerConnection()
      pcRef.current = pc

      pc.ontrack = (e) => {
        // First inbound stream is the assistant's synthesised voice.
        // Wire it into the <audio> element so the avatar lip-sync
        // analyser reads from the same MediaStream it already uses
        // for Gemini (KelionStage passes the same audioRef).
        const [remote] = e.streams
        if (!remote) return
        remoteStreamRef.current = remote
        if (audioRef && audioRef.current) {
          audioRef.current.srcObject = remote
          audioRef.current.muted = false
          audioRef.current.play().catch(() => { /* autoplay blocked — user gesture will unblock */ })
        }
      }

      const micTrack = stream.getAudioTracks()[0]
      if (micTrack) pc.addTrack(micTrack, stream)

      // 4. Single DataChannel for events, label required by OpenAI.
      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc

      dc.addEventListener('open', () => {
        // First frame: session.update with persona / tools / audio
        // config. Built server-side and shipped inside the token
        // response so every provider detail (voice, VAD settings,
        // transcription model, language) stays in one place.
        sendEvent(dc, firstFrame)

        // Prime the credits heartbeat — same charge-on-proof model as
        // the Gemini transport. First /credits/consume only fires when
        // session.created arrives (see handleEvent), so aborted
        // handshakes don't burn credits.
        if (creditsIntervalRef.current) {
          clearInterval(creditsIntervalRef.current)
          creditsIntervalRef.current = null
        }
        creditsStartedRef.current = false
        const consumeCredits = async () => {
          try {
            const r = await fetch('/api/credits/consume', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ minutes: 1 }),
            })
            if (r.status === 401) {
              clearInterval(creditsIntervalRef.current)
              creditsIntervalRef.current = null
              return
            }
            if (r.status === 402) {
              clearInterval(creditsIntervalRef.current)
              creditsIntervalRef.current = null
              try { pcRef.current?.close() } catch (_) { /* ignore */ }
              setError('No credits left. Buy a package to keep talking.')
              setStatus('error')
              return
            }
            const body = await r.json().catch(() => null)
            if (body && typeof body.balance_minutes === 'number' && onBalanceUpdateRef.current) {
              try { onBalanceUpdateRef.current(body.balance_minutes) } catch (_) { /* ignore */ }
            }
            if (body && body.exhausted) {
              clearInterval(creditsIntervalRef.current)
              creditsIntervalRef.current = null
              try { pcRef.current?.close() } catch (_) { /* ignore */ }
              setError('Your last minute of credits was used. Buy more to keep talking.')
              setStatus('error')
            }
          } catch (err) {
            console.warn('[openaiRealtime] credits/consume failed', err && err.message)
          }
        }
        creditsStartFnRef.current = () => {
          if (creditsStartedRef.current) return
          creditsStartedRef.current = true
          consumeCredits()
          creditsIntervalRef.current = setInterval(consumeCredits, 60_000)
        }
      })

      dc.addEventListener('message', (e) => {
        let evt
        try { evt = JSON.parse(e.data) } catch { return }
        handleEvent(evt, dc)
      })

      dc.addEventListener('error', (e) => {
        console.error('[openaiRealtime] dc error', e)
      })

      dc.addEventListener('close', () => {
        // Peer connection closing is handled by pc.onconnectionstatechange
        // below; nothing to do here except log.
        console.warn('[openaiRealtime] dc close')
      })

      pc.addEventListener('connectionstatechange', () => {
        const st = pc.connectionState
        if (st === 'failed' || st === 'disconnected' || st === 'closed') {
          if (statusRef.current === 'idle' || statusRef.current === 'error') return
          const neverOpened = statusRef.current === 'connecting' || statusRef.current === 'requesting'
          // 'failed' is a hard peer-connection error (ICE failure, TURN
          // unreachable, signalling broken). Treat it like a protocol
          // failure on the Gemini side — surface the error and require a
          // manual tap to retry so the wake-word (armed on 'idle') can't
          // loop into the same underlying fault.
          if (neverOpened || st === 'failed') {
            setError(`Connection closed (${st})`)
            setStatus('error')
          } else {
            // Clean peer disconnect mid-session — mirror the Gemini
            // handler and drop back to idle so the HUD shows
            // "Tap to talk" again.
            setStatus('idle')
          }
        }
      })

      // 5. SDP offer → POST to OpenAI, get answer, apply.
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(model)}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ephemeral}`,
            'Content-Type':  'application/sdp',
          },
          body: offer.sdp,
        },
      )
      if (!sdpRes.ok) {
        const txt = await sdpRes.text().catch(() => '')
        throw new Error(`SDP exchange failed: ${sdpRes.status} ${txt}`)
      }
      const answer = { type: 'answer', sdp: await sdpRes.text() }
      await pc.setRemoteDescription(answer)

    } catch (e) {
      console.error('[openaiRealtime] start error', e)
      setError(e.message || String(e))
      setStatus('error')
    } finally {
      startInFlightRef.current = false
    }
  }, [audioRef, coords, handleEvent, sendEvent, startMicLevel])

  // Keep a ref of the live status so the connectionstatechange handler
  // (registered once on the pc) can read the latest value without
  // stale-closure issues.
  const statusRef = useRef(status)
  useEffect(() => { statusRef.current = status }, [status])

  const stop = useCallback(() => {
    if (dcRef.current) {
      try { dcRef.current.close() } catch (_) { /* ignore */ }
      dcRef.current = null
    }
    if (pcRef.current) {
      try { pcRef.current.close() } catch (_) { /* ignore */ }
      pcRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
    }
    if (audioRef && audioRef.current) {
      try { audioRef.current.pause() } catch (_) { /* ignore */ }
      try { audioRef.current.srcObject = null } catch (_) { /* ignore */ }
    }
    if (micLevelRafRef.current) cancelAnimationFrame(micLevelRafRef.current)
    analyserRef.current = null
    if (meterCtxRef.current) {
      try { meterCtxRef.current.close() } catch (_) { /* ignore */ }
      meterCtxRef.current = null
    }
    if (trialTimeoutRef.current) {
      clearTimeout(trialTimeoutRef.current)
      trialTimeoutRef.current = null
    }
    if (creditsIntervalRef.current) {
      clearInterval(creditsIntervalRef.current)
      creditsIntervalRef.current = null
    }
    creditsStartedRef.current = false
    creditsStartFnRef.current = null
    pendingToolArgsRef.current.clear()
    pendingToolNameRef.current.clear()
    remoteStreamRef.current = null
    setUserLevel(0)
    setStatus('idle')
    setError(null)
    setVisionError(null)
  }, [audioRef])

  useEffect(() => () => { stop() }, [stop])

  // Vision stubs — accepted but no-op so KelionStage's camera/screen
  // buttons don't throw when the OpenAI transport is active. See
  // module header.
  const startCamera = useCallback(async () => {
    setVisionError('Camera streaming is not available on the OpenAI transport yet.')
  }, [])
  const stopCamera  = useCallback(() => {
    setCameraStream(null)
    setVisionError(null)
  }, [])
  const startScreen = useCallback(async () => {
    setVisionError('Screen sharing is not available on the OpenAI transport yet.')
  }, [])
  const stopScreen  = useCallback(() => {
    setScreenStream(null)
    setVisionError(null)
  }, [])

  return {
    status, error, start, stop, turns, userLevel,
    cameraStream, screenStream, visionError,
    startCamera, stopCamera, startScreen, stopScreen,
    trial,
  }
}
