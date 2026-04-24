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
import { setLatestCameraFrame, clearLatestCameraFrame, getLatestCameraFrame } from './cameraFrameBuffer'
import { subscribeNarrationMode, getNarrationMode, setNarrationMode } from './narrationMode'
import { setCameraController, setCurrentFacingMode } from "./cameraControl"
import { getCsrfToken } from './api'

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
// Camera is hybrid: OpenAI Realtime GA still doesn't accept live video
// over WebRTC, but Kelion's camera feature is implemented anyway —
// passively. While the camera is on we grab one JPEG per second into
// a module-level ring buffer (cameraFrameBuffer.js). Nothing is
// uploaded until the model calls the `what_do_you_see` tool; the
// tool handler then sends the latest frame to Gemini Vision via our
// /api/realtime/vision endpoint and returns the description to OpenAI
// as a function_call_output. Result: OpenAI owns voice + reasoning,
// Gemini owns vision, camera stays silent until the user asks.
// Screen sharing remains a no-op stub (future work).
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
  // Passive camera grabber refs. See startCamera/stopCamera at bottom of
  // file for rationale — the camera is *silent* under OpenAI Realtime;
  // frames land in cameraFrameBuffer.js and only get uploaded when the
  // `what_do_you_see` tool is invoked by the model.
  const cameraVideoRef      = useRef(null)
  const cameraCanvasRef     = useRef(null)
  const cameraGrabTimerRef  = useRef(null)
  // Current `facingMode` requested for the next/running getUserMedia.
  // Switched by the `switch_camera` tool through cameraControl.js — see
  // the registerController effect at the bottom of this hook. Defaults
  // to the selfie camera to match the pre-mobile-GPS behaviour.
  const cameraFacingRef     = useRef('user')
  // Narration-mode orchestration. Flags so the periodic tick knows
  // when it's safe to speak (don't interrupt user, don't stack on top
  // of an in-flight response). `lastNarrationHashRef` dedupes identical
  // descriptions so Kelion doesn't repeat "a laptop on the desk" every
  // 8 seconds when nothing's changed.
  const narrationTimerRef   = useRef(null)
  const narrationInflightRef = useRef(false)
  const assistantSpeakingRef = useRef(false)
  const userSpeakingRef      = useRef(false)
  // Timestamp (epoch ms) of the most recent VAD activity from either
  // side. The credits heartbeat uses it to decide when the session has
  // been silent long enough (>30 s) to skip a deduction — see the
  // `consumeCredits` loop and /api/credits/consume silent branch.
  const lastActivityAtRef    = useRef(Date.now())
  const lastNarrationTextRef = useRef('')
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
        userSpeakingRef.current = true
        lastActivityAtRef.current = Date.now()
        setStatus('listening')
        return
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        userSpeakingRef.current = false
        lastActivityAtRef.current = Date.now()
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
      case 'response.created':
        assistantSpeakingRef.current = true
        lastActivityAtRef.current = Date.now()
        return
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta': // pre-GA alias, still seen in the wild
        if (event.delta) appendTurn('assistant', event.delta, false)
        assistantSpeakingRef.current = true
        lastActivityAtRef.current = Date.now()
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
        assistantSpeakingRef.current = false
        if (status !== 'error') setStatus('listening')
        return
      case 'response.cancelled':
        assistantSpeakingRef.current = false
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

  const start = useCallback(async (opts = {}) => {
    if (startInFlightRef.current) return
    // F4 — auto-fallback from the other provider passes the accumulated
    // session transcript so Kelion continues the conversation rather than
    // re-greeting. We POST when we have a payload; a fresh session stays
    // on GET so existing callers and tests keep working unchanged.
    const priorTurns = Array.isArray(opts.priorTurns) ? opts.priorTurns : []
    // Tear down any residual peer connection before opening a new one.
    if (pcRef.current) {
      try { pcRef.current.close() } catch (_) { /* ignore */ }
      pcRef.current = null
    }
    startInFlightRef.current = true
    setError(null)
    setStatus('requesting')
    // Reset silence-idle timestamp on every new session — otherwise a stale
    // value from mount or a previous session makes the first heartbeat
    // wrongly silent-skip. Devin Review BUG_0003 on PR #133.
    lastActivityAtRef.current = Date.now()

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
      const tokenUrl = `/api/realtime/openai-live-token?lang=${encodeURIComponent(langHint)}${geoQuery}`
      const tokenRes = priorTurns.length
        ? await fetch(tokenUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
            body: JSON.stringify({ priorTurns }),
          })
        : await fetch(tokenUrl, { credentials: 'include' })
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
            // Silence-aware heartbeat — matches server /api/credits/consume.
            // If no VAD activity in the last 30 s (neither user nor
            // assistant spoke), send silent=true so the server skips the
            // deduction. Prevents the idle-drain Adrian reported
            // (-1 min x 28 min at idle).
            const silent = (Date.now() - lastActivityAtRef.current) > 30_000
            const r = await fetch('/api/credits/consume', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
              body: JSON.stringify({ minutes: 1, silent }),
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
          // Always tear down the credits heartbeat when the peer
          // connection goes down. Without this, the 60s interval kept
          // ticking after the pc died and fired stray
          // /api/credits/consume calls on tab wake — audit 2026-04-22
          // saw a -1 credit ledger entry 7 h after the session actually
          // ended. stop() handles the idle/error path; this handler is
          // the only one for abnormal closes where stop() is never
          // called by the UI.
          if (creditsIntervalRef.current) {
            clearInterval(creditsIntervalRef.current)
            creditsIntervalRef.current = null
          }
          creditsStartedRef.current = false
          creditsStartFnRef.current = null
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
    // Stopping the voice session also stops continuous narration — a
    // narration tick only makes sense while the data channel is live.
    try { setNarrationMode({ enabled: false }) } catch (_) { /* ignore */ }
    if (narrationTimerRef.current) {
      clearInterval(narrationTimerRef.current)
      narrationTimerRef.current = null
    }
    narrationInflightRef.current = false
    lastNarrationTextRef.current = ''
    assistantSpeakingRef.current = false
    userSpeakingRef.current = false
    pendingToolArgsRef.current.clear()
    pendingToolNameRef.current.clear()
    remoteStreamRef.current = null
    setUserLevel(0)
    setStatus('idle')
    setError(null)
    setVisionError(null)
  }, [audioRef])

  useEffect(() => () => { stop() }, [stop])

  // Unmount cleanup for the passive camera grabber. stop() above is for
  // the voice session only — users can keep the camera on across
  // taps — but we must release the MediaStream when the component goes
  // away or it leaks the underlying hardware + CPU timer.
  useEffect(() => () => {
    if (cameraGrabTimerRef.current) {
      clearInterval(cameraGrabTimerRef.current)
      cameraGrabTimerRef.current = null
    }
    if (cameraVideoRef.current) {
      try { cameraVideoRef.current.pause() } catch (_) { /* ignore */ }
      try { cameraVideoRef.current.srcObject = null } catch (_) { /* ignore */ }
    }
    clearLatestCameraFrame()
  }, [])

  // Continuous narration mode — accessibility for users who can't see the
  // screen. When enabled (voice-command-driven via `set_narration_mode`
  // tool), the hook ticks every N seconds, pulls the latest frame from
  // cameraFrameBuffer, asks Gemini Vision for a short description, and
  // injects that description into the OpenAI session as a user-turn
  // input_text followed by a response.create. The model then speaks the
  // narration in natural language in the user's language. We skip ticks
  // when:
  //   - the data channel is not open (no session);
  //   - the user is currently speaking (server VAD said so);
  //   - a response is already in flight (assistant is speaking);
  //   - no camera frame is available (camera off);
  //   - the latest frame is the same as the one we already narrated
  //     (dedup via vision description text).
  // Narration state lives in src/lib/narrationMode.js so the
  // `set_narration_mode` tool handler in src/lib/kelionTools.js can flip
  // it without re-entering React state.
  useEffect(() => {
    let cancelled = false

    const runTick = async () => {
      const mode = getNarrationMode()
      if (!mode.enabled) return
      const dc = dcRef.current
      if (!dc || dc.readyState !== 'open') return
      if (userSpeakingRef.current || assistantSpeakingRef.current) return
      if (narrationInflightRef.current) return

      const frame = getLatestCameraFrame()
      if (!frame?.dataUrl) return
      // Stale-frame guard mirrors the one-shot tool handler. If the
      // camera has been off for > 30s, don't speak a phantom scene.
      if (Date.now() - (frame.capturedAt || 0) > 30_000) return

      narrationInflightRef.current = true
      try {
        const r = await fetch('/api/realtime/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
          credentials: 'include',
          body: JSON.stringify({
            frame: frame.dataUrl,
            focus: mode.focus || '',
            mode: 'narration',
          }),
        })
        if (cancelled) return
        if (!r.ok) {
          // Swallow transient errors silently — narration is a running
          // background service, not a foreground request. Voice stays fine.
          return
        }
        const body = await r.json().catch(() => null)
        const description = (body?.description || '').trim()
        if (!description) return
        // Dedup: if the description is (roughly) what we just spoke,
        // don't speak it again. Exact-match is plenty; the vision model
        // almost always phrases a changed scene differently.
        if (description === lastNarrationTextRef.current) return
        lastNarrationTextRef.current = description

        // One last race check before we send — speech states may have
        // flipped while we were waiting on the vision API.
        if (userSpeakingRef.current || assistantSpeakingRef.current) return
        if (dc.readyState !== 'open') return

        const prompt = mode.focus
          ? `[Scene update, focus: ${mode.focus}] ${description}`
          : `[Scene update] ${description}`

        sendEvent(dc, {
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: prompt }],
          },
        })
        sendEvent(dc, {
          type: 'response.create',
          response: {
            instructions: "The user has continuous narration turned on for accessibility. Speak the scene update above as ONE short natural sentence in the user's language. Do not greet, do not preface, do not read brackets. If the scene has not meaningfully changed since the last narration, it is fine to stay silent (respond with an empty message) — do not repeat yourself.",
          },
        })
      } catch (_) {
        // Network blip, CORS flake, whatever — narration is best-effort.
      } finally {
        narrationInflightRef.current = false
      }
    }

    const arm = () => {
      if (narrationTimerRef.current) {
        clearInterval(narrationTimerRef.current)
        narrationTimerRef.current = null
      }
      const mode = getNarrationMode()
      if (!mode.enabled) return
      // Fire one shortly after enable so the first narration is prompt,
      // then tick on the configured cadence.
      setTimeout(runTick, 600)
      narrationTimerRef.current = setInterval(runTick, Math.max(4000, mode.intervalMs))
    }

    arm()
    const unsub = subscribeNarrationMode(() => {
      if (cancelled) return
      // Reset dedup so the first tick after re-enable always narrates.
      lastNarrationTextRef.current = ''
      arm()
    })

    return () => {
      cancelled = true
      if (narrationTimerRef.current) {
        clearInterval(narrationTimerRef.current)
        narrationTimerRef.current = null
      }
      unsub()
    }
  }, [sendEvent])

  // Force-disable narration on unmount so a stale flag doesn't survive
  // into the next mount of KelionStage.
  useEffect(() => () => {
    try { setNarrationMode({ enabled: false }) } catch (_) { /* ignore */ }
  }, [])

  // Passive camera grabber.
  //
  // OpenAI Realtime GA does not (yet) accept live video over WebRTC.
  // Instead of refusing camera access entirely (the previous stub),
  // we keep the camera on silently on the client: one JPEG every ~1s
  // is drawn to an off-screen canvas and stashed in the module-level
  // cameraFrameBuffer. Nothing is uploaded at this stage.
  //
  // When the user asks Kelion "what do you see?", the model calls the
  // `what_do_you_see` tool (declared in server/src/routes/realtime.js);
  // its handler in src/lib/kelionTools.js reads the latest frame and
  // POSTs it to /api/realtime/vision, which forwards to Gemini Vision
  // and returns a short description. OpenAI folds that description back
  // into the conversation and vocalises a natural reply. The camera
  // stays silent until the user asks.
  //
  // Why 1 Hz? Voice-triggered vision doesn't need motion; one recent
  // still is plenty and keeps CPU / memory near zero while the user is
  // just talking. MediaStream stays in cameraVideoRef so we return it
  // to KelionStage (for preview thumbnails) without re-requesting.
  const startCamera = useCallback(async (opts = {}) => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setVisionError('Camera not available in this browser.')
        return
      }
      // Resolve the requested side. `switch_camera` passes
      // `{ facingMode: 'environment' }`; the on-stage camera button calls
      // with no args so we keep whichever side was last active (default
      // 'user' on first open).
      if (opts.facingMode === 'user' || opts.facingMode === 'environment') {
        cameraFacingRef.current = opts.facingMode
      }
      const facingMode = cameraFacingRef.current || 'user'
      setCurrentFacingMode(facingMode)
      // Stop any prior capture first so start→stop→start is idempotent.
      if (cameraGrabTimerRef.current) {
        clearInterval(cameraGrabTimerRef.current)
        cameraGrabTimerRef.current = null
      }
      // Tear down any existing MediaStream before requesting a new one —
      // otherwise the browser can keep the previous track alive, and on
      // mobile that blocks the switch to the other camera ('device in
      // use'). We drop tracks synchronously; the new stream starts fresh.
      setCameraStream((prev) => {
        if (prev) {
          try { prev.getTracks().forEach((t) => t.stop()) } catch (_) { /* ignore */ }
        }
        return null
      })
      // When the `camera_on` / `switch_camera` voice tool picks a specific
      // rear lens (non-ultrawide, non-tele) we pass its deviceId here.
      // Without a deviceId the browser may default to the ultrawide lens
      // on phones with multiple rear cameras, which ruins the "see at
      // distance" use case (license plate at 5m reads as a blur).
      //
      // PR 5/N — high-quality live vision: ask for up to 4K first so the
      // camera opens at the best resolution the device advertises (the
      // previous 640×480 ceiling capped the downsample budget no matter
      // how high MAX_W was set in the snapshot loop). Fall through a
      // ladder so devices that only produce 720p, or webcams that reject
      // explicit resolutions entirely, still succeed on a later rung.
      const deviceId = opts.deviceId || null
      const selector = deviceId ? { deviceId: { exact: deviceId } } : { facingMode }
      const constraintLadder = [
        { video: { ...selector, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false },
        { video: { ...selector, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
        { video: { ...selector, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { ...selector }, audio: false },
        { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: true, audio: false },
      ]
      let stream = null
      let lastErr = null
      for (const constraints of constraintLadder) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          break
        } catch (e) {
          lastErr = e
        }
      }
      if (!stream) {
        throw (lastErr instanceof Error) ? lastErr : new Error('Camera request rejected.')
      }
      setCameraStream(stream)
      setVisionError(null)

      // Hidden <video> playing the stream + off-screen <canvas> to grab
      // JPEGs. We never attach the video to the DOM — it just acts as a
      // decode source for drawImage. The canvas is reused across ticks
      // to avoid allocating a new framebuffer each second.
      if (!cameraVideoRef.current) {
        const v = document.createElement('video')
        v.autoplay = true
        v.muted = true
        v.playsInline = true
        cameraVideoRef.current = v
      }
      if (!cameraCanvasRef.current) {
        cameraCanvasRef.current = document.createElement('canvas')
      }
      const video = cameraVideoRef.current
      video.srcObject = stream
      try { await video.play() } catch (_) { /* play failures fall through to grab loop */ }

      const canvas = cameraCanvasRef.current
      // High-quality snapshot pipeline (PR 5/N). Adrian 2026-04-20:
      // "fiind o aplicație profesională, camerele trebuie să trimită
      // către avatar imagini live de foarte bună calitate". These
      // frames feed the OpenAI + Gemini hybrid vision tool, so
      // legibility on distant license plates / small labels matters
      // more than wire cost. 1 snapshot/sec keeps the bandwidth
      // budget reasonable even at 1600 px + q=0.88. When camera_on /
      // switch_camera opened the camera at 4K on a modern rear lens,
      // this ceiling ensures we downsample to a sweet spot — not
      // upscale a weaker lens's native frame.
      const MAX_W = 1600
      const JPEG_Q = 0.88

      const grab = () => {
        if (!video.videoWidth || !video.videoHeight) return
        // Prefer the native track resolution when it's smaller than
        // our ceiling — upscaling from 720p to 1600 px just adds
        // pixels without adding information. `Math.min(1, …)` still
        // caps the scale at 1× so we never grow the frame.
        const scale = Math.min(1, MAX_W / video.videoWidth)
        canvas.width = Math.floor(video.videoWidth * scale)
        canvas.height = Math.floor(video.videoHeight * scale)
        const ctx = canvas.getContext('2d')
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        } catch (_) {
          return
        }
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_Q)
          setLatestCameraFrame(dataUrl)
        } catch (_) { /* best-effort; a miss here just means the buffer keeps its previous frame */ }
      }
      // Prime immediately (don't wait 1s for the first frame) then tick.
      setTimeout(grab, 250)
      cameraGrabTimerRef.current = setInterval(grab, 1000)
    } catch (err) {
      console.warn('[openaiRealtime] startCamera failed', err && err.message)
      const msg = err?.message || 'Unable to open the camera.'
      setVisionError(msg)
      // Propagate so the cameraControl.restart() wrapper used by the
      // switch_camera tool sees the failure. Without the rethrow the
      // tool returned ok:true on every call because the outer try block
      // swallowed getUserMedia rejections.
      throw (err instanceof Error) ? err : new Error(msg)
    }
  }, [])

  const stopCamera = useCallback(() => {
    if (cameraGrabTimerRef.current) {
      clearInterval(cameraGrabTimerRef.current)
      cameraGrabTimerRef.current = null
    }
    if (cameraVideoRef.current) {
      try { cameraVideoRef.current.pause() } catch (_) { /* ignore */ }
      try { cameraVideoRef.current.srcObject = null } catch (_) { /* ignore */ }
    }
    setCameraStream((prev) => {
      if (prev) {
        try { prev.getTracks().forEach((t) => t.stop()) } catch (_) { /* ignore */ }
      }
      return null
    })
    clearLatestCameraFrame()
    setVisionError(null)
  }, [])

  // Screen share stub — GA Realtime still has no video input path, and
  // screen-capture + vision tool would need a second grabber in parallel
  // with the camera one. Out of scope for the voice+camera delivery.
  const startScreen = useCallback(async () => {
    setVisionError('Screen sharing is not available on the OpenAI transport yet.')
  }, [])
  const stopScreen  = useCallback(() => {
    setScreenStream(null)
    setVisionError(null)
  }, [])

  // Apply a live zoom level to the active video track. Most Android
  // Chrome builds expose a `zoom` capability (min/max/step) through
  // MediaStreamTrack.getCapabilities(); iOS Safari does not yet. When
  // the capability is absent we report a clear error so Kelion can
  // tell the user their device doesn't support zoom — better than
  // claiming success silently.
  const applyZoom = useCallback(async (level) => {
    const stream = cameraVideoRef.current?.srcObject
    const track = stream && stream.getVideoTracks && stream.getVideoTracks()[0]
    if (!track) return { ok: false, error: 'Camera is not active.' }
    const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}
    const settings = typeof track.getSettings === 'function' ? track.getSettings() : {}
    if (!caps || caps.zoom == null) {
      return { ok: false, error: 'This camera does not support zoom.' }
    }
    const min = Number(caps.zoom.min) || 1
    const max = Number(caps.zoom.max) || min
    const step = Number(caps.zoom.step) || 0.1
    const current = Number(settings.zoom) || min
    let target
    const s = String(level || '').toLowerCase()
    if (s === 'in')         target = Math.min(max, current + Math.max(step, (max - min) / 6))
    else if (s === 'out')   target = Math.max(min, current - Math.max(step, (max - min) / 6))
    else if (s === 'reset') target = min
    else if (Number.isFinite(Number(level))) target = Math.max(min, Math.min(max, Number(level)))
    else return { ok: false, error: "Zoom level must be a number or 'in'/'out'/'reset'." }
    try {
      await track.applyConstraints({ advanced: [{ zoom: target }] })
      return { ok: true, zoom: target, min, max, step }
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Zoom constraint rejected.' }
    }
  }, [])

  // Pull a native-resolution JPEG for on-demand vision (what_do_you_see).
  // The 1-Hz passive buffer is 480 px wide which is hopeless for reading
  // a license plate at 5 m. Here we draw the full video frame at its
  // real resolution (typically 1280×720 after the constraint bump) and
  // return a data URL the tool handler can POST to /api/realtime/vision.
  const captureHighResSnapshot = useCallback(async (opts = {}) => {
    const video = cameraVideoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      return { ok: false, error: 'Camera is off.' }
    }
    const maxWidth = Number(opts.maxWidth) || 1600
    const scale = Math.min(1, maxWidth / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.floor(video.videoHeight * scale))
    try {
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    } catch (err) {
      return { ok: false, error: 'Snapshot draw failed.' }
    }
    try {
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      return { ok: true, dataUrl, width: canvas.width, height: canvas.height }
    } catch (err) {
      return { ok: false, error: 'Snapshot encode failed.' }
    }
  }, [])

  // Register the camera controller so the `switch_camera` tool handler
  // in kelionTools.js can flip front/back without reaching into this
  // hook directly. We re-register whenever startCamera's identity
  // changes (useCallback stable deps → once per mount in practice).
  useEffect(() => {
    setCameraController({
      start: (opts) => startCamera(opts),
      stop: () => stopCamera(),
      restart: (opts) => startCamera(opts),
      getFacingMode: () => cameraFacingRef.current || 'user',
      // camera_zoom tool needs the live MediaStreamTrack to call
      // applyConstraints({ advanced: [{ zoom }] }). Only the first
      // video track is meaningful for us (we never capture audio).
      getActiveTrack: () => {
        const v = cameraVideoRef.current
        const s = v && v.srcObject
        if (s && typeof s.getVideoTracks === 'function') {
          const tracks = s.getVideoTracks()
          return tracks && tracks[0] ? tracks[0] : null
        }
        return null
      },
      applyZoom,
      captureHighResSnapshot,
    })
    return () => setCameraController(null)
  }, [startCamera, stopCamera, applyZoom, captureHighResSnapshot])

  // Audit M6 — see lib/handoffGuard.js. True while `start()` is in
  // flight OR while the live RTCPeerConnection is anything other
  // than 'closed'. KelionStage's auto-fallback effect reads this to
  // avoid stepping on a session the user just manually opened.
  const isBusy = useCallback(() => {
    if (startInFlightRef.current) return true
    const pc = pcRef.current
    if (pc && pc.connectionState && pc.connectionState !== 'closed') return true
    return false
  }, [])

  return {
    status, error, start, stop, turns, userLevel,
    cameraStream, screenStream, visionError,
    startCamera, stopCamera, startScreen, stopScreen,
    trial,
    // Audit M6 — handoff double-start guard.
    isBusy,
  }
}
