// Gemini 3.1 Flash Live client hook.
// Manages: mic capture → WebSocket → audio playback → lipsync driver → transcript.
// Stage 1 modules: M3 (mic+VAD), M4 (Gemini Live loop), M5 (auto-language),
//   M6 (turn-taking via server VAD + interrupt), M8 (Kelion persona).
// Stage 2 modules: M9 (camera live stream w/ visible preview), M10 (screen share),
//   M11 (vision reasoning via multimodal frames), M12 (emotion mirror via persona).

import { useEffect, useRef, useState, useCallback } from 'react'
import { runTool } from './kelionTools'
import { isClonedVoiceActive, setDetectedLang } from './voiceModeStore'
import { setCameraController, setCurrentFacingMode } from './cameraControl'
import { getCsrfToken } from './api'
import { subscribeNarrationMode, getNarrationMode } from './narrationMode'
import { logAiEvent } from './aiEventLog'

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

export function useGeminiLive({ audioRef, coords = null, onBalanceUpdate = null, active = true }) {
  // Kept in a ref so the parent can pass a fresh closure (e.g. a useState
  // setter wrapped in useCallback) without tearing down the WS or the
  // credits heartbeat every render.
  const onBalanceUpdateRef = useRef(onBalanceUpdate)
  onBalanceUpdateRef.current = onBalanceUpdate
  const [status, _setStatus] = useState('idle') // idle, requesting, connecting, listening, thinking, speaking, error
  const setStatus = useCallback((s) => { logAiEvent('status', { status: s }); _setStatus(s) }, [])
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
  // Timestamp (epoch ms) of the most recent VAD activity from either
  // side. Used by the credits heartbeat below to send silent=true on
  // /api/credits/consume when the session has been idle >30 s — the
  // server then skips the deduction, preventing the idle drain Adrian
  // reported (-1 min x 28 min at idle).
  const lastActivityAtRef = useRef(Date.now())
  // Credits heartbeat (signed-in non-admin only). While a Gemini Live
  // session is open we POST /api/credits/consume every 60s to deduct
  // one minute from the user's balance. When the server reports
  // `exhausted: true` (balance hit 0) or returns 402 we close the
  // socket and surface a friendly "buy credits" error. Admins get
  // `exempt: true` on every response and stay unlimited.
  const creditsIntervalRef = useRef(null)
  // Charge-on-proof: set to true the first time Google sends real
  // `serverContent` (audio / transcript / turn complete) for this
  // session. Only then do we deduct the first credit and start the
  // per-minute heartbeat. Prevents the catastrophic refund case where
  // Google 1011s immediately after `onopen`: previously every retry
  // was -1 credit with zero minutes of AI served → 33 retries burned
  // an entire £10 pack with no actual service delivered. The charge
  // only fires when Kelion has demonstrably served something.
  const creditsStartedRef = useRef(false)
  const creditsStartFnRef = useRef(null)

  // In-flight lock for start(). Tap-to-talk and wake-word both call start()
  // from click/voice handlers that read `status` from a stale closure —
  // React hasn't re-rendered between setStatus('requesting') and the second
  // caller's check, so both can slip through and open TWO WebSockets in
  // parallel. When that happens `wsRef.current` is overwritten by the
  // second ws while the first ws's `setupComplete` handler still runs,
  // and the greet-first `clientContent` kickstart lands on a ws that has
  // NOT yet received its own setupComplete ack — Google kills it with
  // 1007 "setup must be the first message and only the first". This lock
  // gates the entire start() body and is released on completion or error.
  // Adrian 2026-04-20: "problema apare doar pe admin" — admin's extra
  // post-sign-in re-renders widen the stale-closure window that lets two
  // concurrent starts slip past the status check.
  const startInFlightRef = useRef(false)
  // F5 — when start() is called on a handoff (priorTurns.length > 0), the
  // persona already tells Kelion to continue the conversation rather than
  // re-greet. We must NOT fire the setupComplete kickstart ("Greet me with
  // a short hello…") in that case — an explicit user turn would override
  // the system instruction and Gemini would re-greet anyway, defeating F4.
  // handleMessage reads this ref to decide whether to skip the kickstart.
  const handoffSessionRef = useRef(false)
  // Anti-double-greeting guard. Gemini Live models sometimes generate
  // an unsolicited greeting even when the system prompt says "don't
  // speak first". We suppress ALL model audio/text until the user has
  // spoken at least once. Becomes true on first inputTranscription.
  const userHasSpokenRef = useRef(false)
  // Narration-pending guard — set true right before sending a synthetic
  // narration prompt so the returning inputTranscription (which Gemini
  // echoes back as the 'user' turn) is NOT shown in the transcript.
  const narrationPendingRef = useRef(false)
  // translatorModeRef — set in start() before the WS opens so handleMessage
  // can read it inside setupComplete without a closure/scope issue.
  const translatorModeRef = useRef(false)

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
  // Live AudioBufferSourceNodes that have been `start()`-ed but not
  // ended yet. On interrupt (user speaks over Kelion) we must call
  // `.stop()` on every one of them — simply resetting the playback
  // clock doesn't actually stop audio already on the output graph, so
  // the old voice keeps playing while the new turn's chunks start on
  // top of it. See `clearAudioQueue` for the cleanup path. Adrian
  // 2026-04-20: "vocea ai este unica nu pot fi mai multe voci ai in
  // acelasi timp".
  const activeSourcesRef = useRef(new Set())
  // Generation counter — bumped on every interrupt. Audio chunks that
  // arrive over the WebSocket carry the generation they belong to
  // (closure-captured in the enqueue call); if their generation is
  // older than the current one by the time they're actually scheduled,
  // we drop them. Prevents late-arriving chunks from the interrupted
  // turn (still in flight over the wire) from resuming playback after
  // we've already called `.stop()` on the active sources.
  const playbackGenerationRef = useRef(0)
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
  // Tool-call loop guard — detects when Gemini repeatedly calls the same
  // tool with the same args (infinite loop). After MAX_REPEATS identical
  // calls within WINDOW_MS, we return an error telling the model to stop.
  const toolCallLoopRef = useRef({ key: '', count: 0, firstAt: 0 })
  const TOOL_LOOP_MAX = 3
  const TOOL_LOOP_WINDOW_MS = 5000

  const appendTurn = useCallback((role, delta, finalize = false, source = null) => {
    // When a role speaks, finalize the OTHER role's bubble so they don't merge infinitely.
    turnActiveRef.current[role === 'user' ? 'assistant' : 'user'] = null;
    
    setTurns((prev) => {
      const active = turnActiveRef.current[role]
      if (active !== null && prev[active] && prev[active].role === role) {
        const next = [...prev]
        next[active] = { role, text: (next[active].text || '') + (delta || '') }
        if (source && !next[active].source) next[active].source = source
        if (finalize) turnActiveRef.current[role] = null
        return next
      }
      const next = [...prev, { role, text: delta || '', source }]
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
    } else if (audioRef.current) {
      // Subsequent chunks: ensure muted stays true even if cloned TTS
      // left it false (race between onended restore and next enqueue).
      audioRef.current.muted = true
    }

    // Drop any chunk that belongs to a superseded generation. See the
    // comment on `playbackGenerationRef` above — protects against
    // late-arriving chunks of an interrupted turn landing here after
    // we've already stopped the audio graph for that turn.
    const myGeneration = playbackGenerationRef.current

    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(outputGainRef.current)

    // Drive bargraph from AI playback audio — compute RMS of the PCM chunk
    let sum = 0
    for (let i = 0; i < float.length; i++) sum += float[i] * float[i]
    const rms = Math.sqrt(sum / float.length)
    const aiLvl = Math.max(0, Math.min(1, rms * 4))
    setUserLevel(aiLvl)

    const now = ctx.currentTime
    const startAt = Math.max(now, playbackEndTimeRef.current)
    src.start(startAt)
    playbackEndTimeRef.current = startAt + buffer.duration
    activeSourcesRef.current.add(src)

    if (!playbackPlayingRef.current) {
      playbackPlayingRef.current = true
      setStatus('speaking')
    }
    src.onended = () => {
      activeSourcesRef.current.delete(src)
      if (myGeneration !== playbackGenerationRef.current) return
      if (ctx.currentTime >= playbackEndTimeRef.current - 0.05) {
        playbackPlayingRef.current = false
      }
    }
  }, [audioRef])

  const clearAudioQueue = useCallback(() => {
    // Server interrupted (user spoke over Kelion) → hard-stop every
    // AudioBufferSourceNode we've already scheduled. Resetting the
    // playback clock alone is NOT enough: sources that have been
    // `start()`-ed continue to play until their buffer is exhausted,
    // which produces the "two AI voices at once" bug when the next
    // turn's chunks start arriving. We also bump the generation
    // counter so any chunk still in flight from the interrupted turn
    // is dropped on arrival (see `enqueueAudio`). Adrian 2026-04-20.
    playbackGenerationRef.current += 1
    for (const src of activeSourcesRef.current) {
      try { src.onended = null } catch (_) { /* ignore */ }
      try { src.stop(0) } catch (_) { /* already stopped */ }
      try { src.disconnect() } catch (_) { /* already disconnected */ }
    }
    activeSourcesRef.current.clear()
    if (playbackCtxRef.current) {
      playbackEndTimeRef.current = playbackCtxRef.current.currentTime
    }
    playbackPlayingRef.current = false
  }, [])

  // ───── WebSocket handlers ─────
  //
  // `ws` is the concrete WebSocket instance that delivered this message.
  // Previously we read `wsRef.current` to send toolResponses and the
  // greet-first kickstart, which races when two starts overlap: the
  // orphaned ws's setupComplete handler would target the LIVE ws (via
  // the shared ref) before IT had received its own setupComplete ack,
  // triggering 1007. Binding sends to the local ws keeps each session
  // talking to itself.
  // Per-turn flag: has this assistant turn already received an
  // outputTranscription? Persists across WS frames (unlike a local var)
  // so that modelTurn.parts[].text arriving in a LATER frame is not
  // appended a second time. Reset on turnComplete.
  const turnHasTranscriptRef = useRef(false)
  // Buffer for cloned-voice TTS: accumulates outputTranscription chunks
  // across frames; flushed to ElevenLabs on turnComplete.
  const cloneTranscriptBufRef = useRef('')
  // Accumulates part.text silently across frames. Resolved at turnComplete:
  // if outputTranscription arrived → discard (prevents narration doubling);
  // if not → show in chat and use for cloned TTS.
  const partTextBufRef = useRef('')

  const handleMessage = useCallback(async (raw, ws) => {
    let msg
    try { msg = JSON.parse(typeof raw === 'string' ? raw : await raw.text()) }
    catch { return }

    // Server-sent audio chunk (inline_data) + transcripts
    if (msg.serverContent) {
      const sc = msg.serverContent

      // Charge-on-proof — this is the first moment we KNOW Google
      // accepted the session and is serving content back. Before this
      // point, every `onopen` could be a dead session (1011 quota,
      // 1008 bad token, 1006 abnormal close) and charging there burns
      // credits for zero service delivered. Safe to call multiple
      // times: the ref is idempotent (returns early after the first
      // run). No-op on `idle`/post-stop, because stop() nukes the
      // callback ref.
      if (creditsStartFnRef.current) {
        try { creditsStartFnRef.current() } catch (_) { /* never break the message pump */ }
      }

      // Interruption — user spoke over Kelion
      if (sc.interrupted) {
        clearAudioQueue()
        // Clear all per-turn buffers on interrupt so stale text from the
        // interrupted turn doesn't leak into the next turn's cloned TTS
        // or partText fallback.
        cloneTranscriptBufRef.current = ''
        partTextBufRef.current = ''
        turnHasTranscriptRef.current = false
        lastActivityAtRef.current = Date.now()
        setStatus('listening')
        return
      }

      if (sc.inputTranscription?.text) {
        // Skip synthetic narration prompts — they echo back as
        // inputTranscription but are NOT real user speech.
        if (narrationPendingRef.current) {
          narrationPendingRef.current = false
          logAiEvent('transcript_in', { text: sc.inputTranscription.text, source: 'narration-synthetic-skipped' })
        } else {
          userHasSpokenRef.current = true
          appendTurn('user', sc.inputTranscription.text, false, '🎤 Voice (Mic)')
          logAiEvent('transcript_in', { text: sc.inputTranscription.text })
          lastActivityAtRef.current = Date.now()
          // Detect language from what the user says (first word heuristic)
          // so ElevenLabs TTS speaks in the right language.
          const langHint = sc.inputTranscription.lang || sc.inputTranscription.languageCode
          if (langHint) setDetectedLang(langHint)
        }
      }
      if (sc.outputTranscription?.text) {
        // Suppress model output before the user has spoken — prevents
        // unsolicited greetings from appearing in the transcript.
        if (!userHasSpokenRef.current) {
          logAiEvent('transcript_out', { text: sc.outputTranscription.text, source: 'suppressed-pre-user' })
          // Do NOT appendTurn or buffer for cloned TTS — the suppressed
          // turn must be invisible in the UI.
        } else {
          appendTurn('assistant', sc.outputTranscription.text, false, '🔊 AI Voice')
          logAiEvent('transcript_out', { text: sc.outputTranscription.text, source: 'gemini-live' })
          // Accumulate for cloned TTS flush on turnComplete
          if (isClonedVoiceActive()) {
            cloneTranscriptBufRef.current += sc.outputTranscription.text
            console.log('[clonedTTS] buffered outputTranscription:', sc.outputTranscription.text.slice(0, 80))
          }
        }
        // ALWAYS mark that we received a transcript for this turn —
        // even for suppressed turns. This prevents the partText fallback
        // at turnComplete from leaking the suppressed text back into the
        // transcript (partTextBufRef accumulates part.text regardless of
        // userHasSpokenRef, so without this flag the fallback would show it).
        turnHasTranscriptRef.current = true
        lastActivityAtRef.current = Date.now()
      }

      const parts = sc.modelTurn?.parts || []
      for (const part of parts) {
        const inline = part.inlineData || part.inline_data
        if (inline?.data && inline.mimeType?.startsWith('audio/')) {
          if (!isClonedVoiceActive()) {
            // Suppress audio before the user has spoken — prevents
            // unsolicited model greetings from playing.
            if (!userHasSpokenRef.current) {
              logAiEvent('audio_skipped', { reason: 'pre-user-greeting-suppressed' })
            } else {
              const bytes = bytesFromBase64(inline.data)
              logAiEvent('audio_out', { bytes: bytes.length, source: 'gemini-native' })
              enqueueAudio(bytes)
            }
          } else {
            logAiEvent('audio_skipped', { reason: 'cloned-voice-active' })
            console.log('[clonedTTS] skipped Gemini PCM chunk (cloned voice active)')
          }
        }
        // DO NOT append part.text immediately — accumulate silently.
        // outputTranscription is the clean, post-processed version and
        // always arrives for voice turns. We resolve which one to show
        // at turnComplete to prevent both paths from displaying the same
        // content (narration doubling).
        if (part.text) {
          partTextBufRef.current += part.text
        }
      }

      if (sc.turnComplete) {
        logAiEvent('turn_complete', { hadTranscript: turnHasTranscriptRef.current })
        const hadTranscript = turnHasTranscriptRef.current
        const partText = partTextBufRef.current.trim()
        // Resolve: if outputTranscription came → partText is redundant (no doubling).
        // If not → partText is the only text we have; show it + use for TTS.
        if (!hadTranscript && partText) {
          appendTurn('assistant', partText, false, '💬 AI Text')
          if (isClonedVoiceActive()) {
            cloneTranscriptBufRef.current += partText
            console.log('[clonedTTS] using partText fallback:', partText.slice(0, 80))
          }
        }
        // Reset all per-turn buffers
        turnHasTranscriptRef.current = false
        partTextBufRef.current = ''
        // Cloned voice: flush accumulated transcript to ElevenLabs TTS
         if (isClonedVoiceActive() && cloneTranscriptBufRef.current.trim()) {
          const textToSpeak = cloneTranscriptBufRef.current.trim()
          cloneTranscriptBufRef.current = ''
          ;(async () => {
            try {
              setStatus('speaking')
              logAiEvent('clone_tts_req', { text: textToSpeak })
              const ttsStart = Date.now()
              const r = await fetch('/api/voice/clone/tts', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-CSRF-Token': getCsrfToken(),
                },
                credentials: 'include',
                body: JSON.stringify({ text: textToSpeak }),
              })
              if (!r.ok) {
                const errText = await r.text().catch(() => '')
                logAiEvent('clone_tts_err', { error: `HTTP ${r.status}: ${errText}` })
                console.error('[geminiLive] cloned TTS error', r.status, errText)
                // Show error visibly so user knows why cloned voice failed
                let reason = errText
                try { reason = JSON.parse(errText)?.error || errText } catch {}
                appendTurn('assistant', `⚠️ Voce clonată: ${reason || 'eroare necunoscută (HTTP ' + r.status + ')'}`, true, '⚙️ System')
                setStatus('listening')
                return
              }
              const audioData = await r.arrayBuffer()
              logAiEvent('clone_tts_ok', { durationMs: Date.now() - ttsStart, bytes: audioData.byteLength })
              console.log(`[clonedTTS] received ${audioData.byteLength} bytes in ${Date.now() - ttsStart}ms`)

              if (audioData.byteLength < 100) {
                console.warn('[clonedTTS] audio response too small, likely empty')
                appendTurn('assistant', `⚠️ Voce clonată: răspuns audio gol (${audioData.byteLength} bytes)`, true, '⚙️ System')
                setStatus('listening')
                return
              }

              // Play through the avatar's <audio> element so lip-sync works.
              // The audio element is connected to the lip-sync analyser via
              // audioRef in KelionStage → useLipSync. Using a blob URL ensures
              // the browser treats it as a normal media source.
              const blob = new Blob([audioData], { type: 'audio/mpeg' })
              const blobUrl = URL.createObjectURL(blob)

              // Try to use the main audioRef element first (enables lip-sync)
              const audioEl = audioRef?.current
              if (audioEl) {
                // Temporarily detach the MediaStream so the <audio> element
                // plays the blob instead of the (now-silent) Gemini stream.
                const prevSrcObject = audioEl.srcObject
                const prevMuted = audioEl.muted
                audioEl.srcObject = null
                audioEl.src = blobUrl
                // CRITICAL: enqueueAudio() sets audioEl.muted = true because
                // Gemini native audio is routed through AudioContext.destination
                // and the <audio> element only carries the stream for lip-sync.
                // For cloned voice the blob IS the primary audio source, so we
                // MUST unmute it or the user hears nothing.
                audioEl.muted = false
                audioEl.volume = 1.0
                console.log(`[clonedTTS] playing via main audioEl, muted=${audioEl.muted}, volume=${audioEl.volume}`)
                audioEl.onended = () => {
                  URL.revokeObjectURL(blobUrl)
                  audioEl.src = ''
                  audioEl.srcObject = prevSrcObject // restore Gemini stream
                  audioEl.muted = prevMuted         // restore muted state
                  setStatus('listening')
                }
                audioEl.onerror = (e) => {
                  console.error('[clonedTTS] audioEl error:', e)
                  appendTurn('assistant', `⚠️ Voce clonată: eroare la redare audio`, true, '⚙️ System')
                  URL.revokeObjectURL(blobUrl)
                  audioEl.src = ''
                  audioEl.srcObject = prevSrcObject
                  audioEl.muted = prevMuted
                  setStatus('listening')
                }
                await audioEl.play().catch((playErr) => {
                  // Fallback: play via a new Audio() if the main element fails
                  console.warn('[clonedTTS] main audioEl play failed:', playErr?.message, 'using fallback')
                  audioEl.srcObject = prevSrcObject
                  audioEl.muted = prevMuted
                  const fallback = new Audio(blobUrl)
                  fallback.volume = 1.0
                  fallback.onended = () => { URL.revokeObjectURL(blobUrl); setStatus('listening') }
                  fallback.play().catch((e2) => {
                    console.error('[clonedTTS] fallback play also failed:', e2?.message)
                    appendTurn('assistant', `⚠️ Voce clonată: browser blochează redarea (${e2?.message})`, true, '⚙️ System')
                    setStatus('listening')
                  })
                })
              } else {
                // No audioRef — fallback to standalone Audio element
                const fallback = new Audio(blobUrl)
                fallback.onended = () => { URL.revokeObjectURL(blobUrl); setStatus('listening') }
                fallback.play().catch(() => setStatus('listening'))
              }
            } catch (err) {
              console.error('[geminiLive] cloned TTS failed', err)
              appendTurn('assistant', `⚠️ Voce clonată: ${err?.message || 'eroare de rețea'}`, true, '⚙️ System')
              setStatus('listening')
            }
          })()
        } else {
          cloneTranscriptBufRef.current = ''
          if (!playbackPlayingRef.current) setStatus('listening')
        }
      } else if (sc.generationComplete) {
        setStatus('speaking')
      }
    }

    // Stage 4 — Gemini Live asks us to run a function tool.
    // Each functionCall carries { id, name, args }. We route to the right
    // /api/tools/* backend endpoint, then send back a toolResponse with the
    // matching id so Gemini can continue the turn with the result.
    if (msg.toolCall?.functionCalls?.length) {
      const fcs = msg.toolCall.functionCalls
      // Narrate to the transcript so the user SEES what Kelion is doing
      // (audio narration is handled by the model itself per the persona).
      for (const fc of fcs) {
        logAiEvent('tool_call', { name: fc.name, args: fc.args })
        appendTurn('assistant', `[tool: ${fc.name}]`, true, '⚙️ Tool Call')
      }
      try {
        const responses = await Promise.all(fcs.map(async (fc) => {
          // Loop guard — detect repeated identical tool calls
          const loopKey = `${fc.name}:${JSON.stringify(fc.args || {})}`
          const now = Date.now()
          const loop = toolCallLoopRef.current
          if (loop.key === loopKey && (now - loop.firstAt) < TOOL_LOOP_WINDOW_MS) {
            loop.count++
          } else {
            toolCallLoopRef.current = { key: loopKey, count: 1, firstAt: now }
          }
          if (toolCallLoopRef.current.count > TOOL_LOOP_MAX) {
            console.warn(`[geminiLive] tool loop detected: ${fc.name} called ${toolCallLoopRef.current.count}x — breaking`)
            logAiEvent('tool_loop_break', { name: fc.name, count: toolCallLoopRef.current.count })
            return {
              id: fc.id,
              name: fc.name,
              response: { result: `STOP: you already called ${fc.name} ${toolCallLoopRef.current.count} times with the same arguments. Do NOT call it again. Move on and speak to the user.` },
            }
          }
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
      logAiEvent('setup_complete', {})
      setStatus('listening')
      // Translator mode kickstart — only fires when the user explicitly
      // selected translator mode from the menu. Normal sessions start
      // silent: Kelion listens and detects the user's language.
      if (translatorModeRef.current && ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({
            clientContent: {
              turns: [{
                role: 'user',
                parts: [{ text: 'You are now in LIVE TRANSLATOR mode. Listen carefully to everything I say in ANY language. Translate it immediately and naturally into my locked language (the one in your system instructions). Do NOT respond with your own words — just translate what you hear. Acknowledge by saying only "Translator mode active" in my language, then wait and translate.' }],
              }],
              turnComplete: true,
            },
          }))
        } catch (_) { /* best-effort */ }
      }
      handoffSessionRef.current = false
    }

    if (msg.error || msg.errorMessage) {
      console.error('[geminiLive] error from server:', msg.error || msg.errorMessage)
      setError(msg.error?.message || msg.errorMessage || 'Server error')
      setStatus('error')
    }
  }, [appendTurn, enqueueAudio, clearAudioQueue])

  // ───── Start full pipeline ─────
  // textOnly: true → open WS without mic (text chat). Voice (tap-to-talk)
  // calls start() without textOnly so the mic opens as before.
  const start = useCallback(async (opts = {}) => {
    // F4 — KelionStage passes the current
    // session transcript so Gemini continues rather than re-greeting.
    // Fresh sessions call start() with no args and stay on GET.
    const priorTurns = Array.isArray(opts.priorTurns) ? opts.priorTurns : []
    // Concurrent-call guard — see comment on `startInFlightRef`. Tap and
    // wake-word both call start() off stale closures; without this lock
    // two WebSockets open in parallel, wsRef gets clobbered, and the
    // orphaned ws's setupComplete handler fires clientContent on the
    // live ws BEFORE its own setup ack arrives → 1007.
    //
    // F6 — the guard MUST run before we touch `handoffSessionRef`.
    // Otherwise a rejected concurrent start() (a tap firing while a
    // handoff is still in-flight) would clobber the flag for the
    // session that is actually opening the socket. Reject-first,
    // mutate-after.
    if (startInFlightRef.current) return
    // F5 — stash the handoff flag AFTER the concurrent guard so only
    // the winning call writes it. The setupComplete handler reads it
    // on the next microtask; fresh sessions explicitly reset to false
    // so the kickstart greeting keeps firing as before.
    handoffSessionRef.current = priorTurns.length > 0
    // Translator mode — store in ref so handleMessage's setupComplete handler
    // can read it (handleMessage is defined outside start(), so local vars
    // declared here are not in its closure).
    translatorModeRef.current = opts.translatorMode || false
    const textOnly = !!opts.textOnly
    // If a previous ws is still live (or in CONNECTING), tear it down
    // before opening a new one — otherwise the old handlers keep firing
    // against `wsRef.current` after we reassign it below.
    // VOICE UNIQUENESS: also hard-stop any audio still playing from the
    // previous session. Without this, scheduled AudioBufferSourceNodes
    // keep playing after the ws is closed, so the old voice bleeds into
    // (or alternates with) the new session's audio. clearAudioQueue()
    // stops all active sources and bumps the generation counter so
    // any late-arriving chunks from the old ws are dropped on arrival.
    clearAudioQueue()
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      try { wsRef.current.close(1000, 'restart') } catch (_) { /* ignore */ }
      wsRef.current = null
    }
    startInFlightRef.current = true
    userHasSpokenRef.current = false // Reset for new session
    setError(null)
    setStatus('requesting')
    // Reset silence-idle timestamp on every new session — otherwise a stale
    // value from component mount (or a previous session) makes the first
    // heartbeat wrongly mark the session silent and skip a billable minute.
    // Devin Review BUG_0003 on PR #133.
    lastActivityAtRef.current = Date.now()
    try {
      // 1. Request mic (skipped for text-only sessions — the user typed
      //    a message, we don't want ambient mic audio creating spurious
      //    inputTranscription entries alongside the typed text).
      let stream = null
      if (!textOnly) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, sampleRate: SAMPLE_RATE_IN },
          video: false,
        })
        micStreamRef.current = stream
        startMicLevel(stream)
      }

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
      // Backend selector. Default is `vertex` — GA `gemini-live-2.5-flash-
      // native-audio` on Vertex AI via the same-origin proxy at
      // `/api/realtime/vertex-live-ws`. `?liveBackend=aistudio` (or
      // `localStorage.kelion_live_backend = 'aistudio'`) forces the legacy
      // preview AI Studio ephemeral-token path — kept as an operator-only
      // escape hatch in case the Vertex proxy is unreachable.
      let liveBackend = 'vertex'
      try {
        const fromUrl = new URL(window.location.href).searchParams.get('liveBackend')
        const fromStorage = window.localStorage?.getItem('kelion_live_backend')
        const raw = (fromUrl || fromStorage || '').toString().toLowerCase()
        if (raw === 'aistudio') liveBackend = 'aistudio'
      } catch (_) { /* window/localStorage missing in SSR — default stays */ }
      const backendQuery = liveBackend === 'aistudio' ? '&backend=aistudio' : '&backend=vertex'
      const tokenUrl = `/api/realtime/gemini-token?lang=${encodeURIComponent(langHint)}${geoQuery}${backendQuery}`
      const tokenRes = priorTurns.length
        ? await fetch(tokenUrl, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
            body: JSON.stringify({ priorTurns, backend: liveBackend }),
          })
        : await fetch(tokenUrl, { credentials: 'include' })
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
      // Signed-in non-admin with 0 credits — server gates the mint with
      // 402 so we never even open the WS. Surface a clean "buy credits"
      // message; the HUD already renders a "0 min left" pill from the
      // credits endpoint.
      if (tokenRes.status === 402) {
        let body = null
        try { body = await tokenRes.json() } catch (_) { /* fall through */ }
        const msg = body?.error || 'No credits left. Buy a package to keep talking.'
        throw new Error(msg)
      }
      if (!tokenRes.ok) {
        const txt = await tokenRes.text()
        throw new Error(`Token fetch failed: ${tokenRes.status} ${txt}`)
      }
      const tokenBody = await tokenRes.json()
      const token = tokenBody?.token
      const setupPayload = tokenBody?.setup
      const resolvedBackend = tokenBody?.backend === 'vertex' ? 'vertex' : 'aistudio'
      // Vertex path doesn't return a token (auth lives on the server-side
      // proxy). Only enforce the token presence for AI Studio.
      if (resolvedBackend !== 'vertex' && !token) throw new Error('No ephemeral token returned')
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
      // Vertex backend: connect to our same-origin proxy. The proxy
      // holds a GCP service-account access token server-side and opens
      // an upstream WebSocket to `<region>-aiplatform.googleapis.com`
      // with the correct Bearer header — a step the browser WebSocket
      // API cannot perform itself (no custom headers allowed). The
      // JSON frame format on the client-facing side is identical to
      // the AI Studio path, so nothing below this line needs to care
      // which backend the session is on.
      let wsUrl
      if (resolvedBackend === 'vertex') {
        const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        wsUrl = `${scheme}//${window.location.host}/api/realtime/vertex-live-ws`
      } else {
        wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token)}`
      }
      logAiEvent('ws_open', { backend: resolvedBackend, url: wsUrl.slice(0, 80) })
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.binaryType = 'blob'

      ws.onopen = () => {
        // Google requires `setup` to be the FIRST and only setup message
        // on the wire. The worklet's realtimeInput chunks are posted via
        // MessageChannel (async), so this synchronous send(setup) always
        // lands before the first audio frame.
        try {
          logAiEvent('setup_sent', { model: setupPayload?.model || 'from-server', voice: setupPayload?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName || '?' })
          ws.send(JSON.stringify({ setup: setupPayload }))
        } catch (err) {
          console.error('[geminiLive] failed to send setup frame', err)
        }

        // NOTE: the greet-first `clientContent` kickstart used to live here,
        // sent synchronously right after `setup`. That caused Gemini to
        // close the socket with 1007 "setup must be the first message and
        // only the first" because Google treats any non-setup frame
        // arriving before its own `setupComplete` ack as a protocol
        // violation. We now defer the kickstart into the `setupComplete`
        // branch of `handleMessage` below, which is the documented moment
        // the session is ready for turns. Adrian 2026-04-20: "crapa
        // chatul — Connection closed (1007): setup must be the first
        // message and only the first".

        // Prepare the credits heartbeat but DO NOT start it yet.
        //
        // Previous design deducted 1 credit here on `onopen`. That was a
        // fraud-grade bug: when Google closed the WS with 1011 (quota
        // exceeded, auth, etc.) microseconds after `onopen`, the user
        // had already been charged. Every retry burned another credit
        // for zero minutes of served AI. A £10 pack (33 credits) could
        // drain to 0 with 33 clicks and not a single second of Kelion
        // ever responding. We now defer the first charge until the
        // first real `serverContent` frame arrives (`markSessionActive`
        // called from handleMessage), proving Google accepted the
        // session and is serving content. If the WS dies before that,
        // no credit is ever taken — Adrian: "ne duce la frauda si
        // amenzi colosale".
        if (creditsIntervalRef.current) {
          clearInterval(creditsIntervalRef.current)
          creditsIntervalRef.current = null
        }
        creditsStartedRef.current = false
        const consumeCredits = async () => {
          try {
            // Silence-aware heartbeat — matches server /api/credits/consume.
            // If no VAD activity in the last 30 s, send silent=true so the
            // server skips the deduction. Prevents the idle-drain Adrian
            // reported (-1 min x 28 min at idle).
            const silent = (Date.now() - lastActivityAtRef.current) > 30_000
            const r = await fetch('/api/credits/consume', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
              body: JSON.stringify({ minutes: 1, silent }),
            })
            if (r.status === 401) {
              // Guest (no JWT) — nothing to deduct, stop polling.
              if (creditsIntervalRef.current) {
                clearInterval(creditsIntervalRef.current)
                creditsIntervalRef.current = null
              }
              return
            }
            if (r.status === 402) {
              // Zero balance. Close the session cleanly and tell the HUD.
              if (creditsIntervalRef.current) {
                clearInterval(creditsIntervalRef.current)
                creditsIntervalRef.current = null
              }
              try {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.close(1000, 'credits-exhausted')
                }
              } catch (_) { /* swallow */ }
              setError('No credits left. Buy a package to keep talking.')
              setStatus('error')
              return
            }
            const body = await r.json().catch(() => null)
            // Live HUD refresh — Adrian: "actualizarea creditului pe
            // interfata user se actualizeaza in timp real". The server
            // returns the post-deduction balance in every successful
            // consume response; pipe it to the parent so the top-right
            // chip ticks down without a page refresh or extra GET.
            // Admins get `balance_minutes: null` (exempt) so we skip
            // those — otherwise the HUD would flash blank every 60 s.
            if (body && typeof body.balance_minutes === 'number' && onBalanceUpdateRef.current) {
              try { onBalanceUpdateRef.current(body.balance_minutes) } catch (_) { /* never let consumer kill the heartbeat */ }
            }
            if (body && body.exhausted) {
              if (creditsIntervalRef.current) {
                clearInterval(creditsIntervalRef.current)
                creditsIntervalRef.current = null
              }
              try {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                  wsRef.current.close(1000, 'credits-exhausted')
                }
              } catch (_) { /* swallow */ }
              setError('Your last minute of credits was used. Buy more to keep talking.')
              setStatus('error')
            }
          } catch (err) {
            // Network hiccup — keep ticking; we'll try again in 60 s.
            console.warn('[geminiLive] credits/consume failed', err && err.message)
          }
        }
        // Expose the starter to handleMessage via a ref so the first
        // real serverContent frame can flip us live. Kept in a ref so
        // handleMessage (defined with useCallback higher up) captures
        // the same closure across re-renders.
        creditsStartFnRef.current = () => {
          if (creditsStartedRef.current) return
          creditsStartedRef.current = true
          consumeCredits()
          creditsIntervalRef.current = setInterval(consumeCredits, 60_000)
        }
      }

      ws.onmessage = (event) => handleMessage(event.data, ws)
      ws.onerror = (e) => {
        console.error('[geminiLive] ws error', e)
        setError('Connection error')
        setStatus('error')
      }
      ws.onclose = (e) => {
        // Surface Google's close code + reason so bad-endpoint or
        // expired-token failures show up in the console instead of being
        // silently flipped back to 'idle'. 1000 = normal, 1005/1006 = no
        // status / abnormal, 1008 = policy (wrong endpoint / bad token),
        // 1007 = protocol (double setup), 1011 = server / quota.
        console.warn('[geminiLive] ws close', { code: e?.code, reason: e?.reason, wasClean: e?.wasClean })
        // Always tear down the credits heartbeat on socket close. Without
        // this guard the 60s interval kept ticking after the ws died and
        // fired a stray /api/credits/consume on tab wake hours later —
        // audit 2026-04-22 saw a -1 credit ledger entry 7 h after the
        // session actually ended. stop() handles the idle/error path;
        // this handler is the only one for abnormal closes where stop()
        // is never called by the UI.
        if (creditsIntervalRef.current) {
          clearInterval(creditsIntervalRef.current)
          creditsIntervalRef.current = null
        }
        creditsStartedRef.current = false
        creditsStartFnRef.current = null
        if (statusRef.current === 'idle') return
        if (statusRef.current === 'error') return
        // If we never reached 'listening' (i.e. the session died before
        // setupComplete), keep the error visible rather than bouncing back
        // to the "Tap to talk" label — otherwise the user thinks nothing
        // happened.
        const neverOpened = statusRef.current === 'connecting' || statusRef.current === 'requesting'
        // Protocol / auth / quota failures must never silently bounce to
        // 'idle' — the wake-word is armed on 'idle' and will re-fire
        // start(), which opens a new WS that hits the same 1007/1008/1011
        // in a loop (Adrian 2026-04-20, "crapa dupa 2 min de funtionare
        // 1007"). Surface the error and require a manual tap to retry.
        const PROTOCOL_FAILURES = new Set([1007, 1008, 1011])
        if (neverOpened || PROTOCOL_FAILURES.has(e?.code)) {
          setError(`Connection closed (${e?.code || 'unknown'})${e?.reason ? `: ${e.reason}` : ''}`)
          setStatus('error')
          return
        }
        // Clean close mid-session (Google's idle timeout, user-initiated
        // stop) — flip to idle so the HUD shows "Tap to talk" again.
        setStatus('idle')
      }

      // 4. Pipe mic → WS at 16kHz PCM16 (skipped for text-only sessions)
      if (stream) {
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
      }

    } catch (e) {
      console.error('[geminiLive] start error', e)
      setError(e.message || String(e))
      setStatus('error')
    } finally {
      // Always release the in-flight lock so a subsequent tap/wake-word
      // can start a fresh session. Pairs with the guard at the top.
      startInFlightRef.current = false
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
    // PR 5/N — high-quality live vision. Adrian 2026-04-20: "fiind o
    // aplicație profesională, camerele trebuie să trimită către avatar
    // imagini live de foarte bună calitate". Camera short-edge goes
    // 480 → 1024 (4.5× pixel area) and JPEG_Q 0.55 → 0.78 — still well
    // inside the 2 MB back-pressure budget at 15 fps because the
    // existing `bufferedAmount > BACKPRESSURE_BYTES` guard already
    // drops frames when the socket is full. Screen share keeps its
    // higher ceiling (was already 960).
    const MAX_W = kind === 'screen' ? 1280 : 1024
    const JPEG_Q = kind === 'screen' ? 0.75 : 0.78
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

  const cameraFacingRef = useRef('user')
  const startCamera = useCallback(async (opts = {}) => {
    setVisionError(null)
    // If a side was explicitly requested (e.g. by the `switch_camera`
    // tool) we tear down the existing stream first so the new call to
    // getUserMedia can open the opposite lens. Without the teardown
    // mobile browsers keep the current track live and silently ignore
    // the new constraint.
    const nextFacing = (opts.facingMode === 'user' || opts.facingMode === 'environment')
      ? opts.facingMode
      : cameraFacingRef.current
    if (opts.facingMode && cameraStreamRef.current && nextFacing !== cameraFacingRef.current) {
      try {
        stopFrameSender('camera')
        cameraStreamRef.current.getTracks().forEach((t) => t.stop())
      } catch (_) { /* ignore */ }
      cameraStreamRef.current = null
      setCameraStream(null)
    }
    if (cameraStreamRef.current) return
    cameraFacingRef.current = nextFacing
    setCurrentFacingMode(nextFacing)
    // Ladder of progressively looser constraints. The first rung is what
    // we actually want (requested camera at 640×480); the fallbacks exist
    // because Chromium on Windows/Edge throws NotReadableError with
    // the unhelpful message "Could not start video source" when the
    // *constraint set* is incompatible with the specific camera
    // driver — e.g. a laptop with a shared front/back camera that
    // doesn't advertise `facingMode`, or a virtual camera (OBS,
    // NVIDIA Broadcast) that only honours default constraints. Trying
    // `facingMode: 'user'` explicitly is a known offender on
    // external webcams. Dropping constraints almost always recovers.
    // When the voice model picks a specific rear lens via camera_on /
    // switch_camera (non-ultrawide, non-tele) we forward the deviceId
    // so getUserMedia can lock to that lens instead of the default
    // rear camera (which on multi-lens phones is often ultrawide).
    // PR 5/N — high-quality live vision: ask the browser for up to 4K
    // first so the camera opens at the best resolution the device
    // advertises (previous 640×480 ceiling capped the downsample
    // budget no matter how high MAX_W was set in the frame sender).
    // Every rung is wrapped in try/catch below, so a phone that can
    // only produce 720p still succeeds on a lower rung, and anything
    // that rejects explicit resolutions still falls back to the
    // permissive `video: true`.
    const deviceId = opts.deviceId || null
    const baseSelector = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: nextFacing }
    const constraintLadder = [
      { video: { ...baseSelector, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false },
      { video: { ...baseSelector, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { ...baseSelector, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { ...baseSelector, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
      { video: true, audio: false },
    ]
    let lastError = null
    for (const constraints of constraintLadder) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        cameraStreamRef.current = stream
        setCameraStream(stream)
        startFrameSender(stream, 'camera')
        return
      } catch (e) {
        lastError = e
        // NotAllowedError = user denied permission → no point retrying.
        // SecurityError   = not a secure context / feature policy → same.
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break
      }
    }
    console.error('[geminiLive] camera start failed', lastError)
    // Translate Chromium's opaque errors into something the user can
    // act on. The raw DOMException messages ("Could not start video
    // source") aren't helpful; map them to a concrete remedy.
    const name = lastError && lastError.name
    let friendly = lastError && lastError.message ? lastError.message : 'Camera access denied'
    if (name === 'NotAllowedError') {
      friendly = 'Camera blocked. Click the camera icon in the address bar and allow access.'
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      friendly = 'No camera detected on this device.'
    } else if (name === 'NotReadableError' || /could not start video source/i.test(friendly)) {
      friendly = 'Camera is in use by another app (Teams, Zoom, OBS…). Close it and try again.'
    }
    setVisionError(friendly)
    // Propagate so the cameraControl.restart() wrapper used by the
    // switch_camera tool sees the failure. Without the rethrow the
    // tool returned ok:true on every call because the ladder caught
    // every getUserMedia rejection without re-signalling it upward.
    throw (lastError instanceof Error) ? lastError : new Error(friendly)
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
    if (creditsIntervalRef.current) {
      clearInterval(creditsIntervalRef.current)
      creditsIntervalRef.current = null
    }
    // Hard-stop any audio still scheduled on the playback graph. Same
    // reasoning as `clearAudioQueue` on interrupt: sources that have
    // already been `start()`-ed keep playing until their buffer drains
    // unless we call `.stop()` explicitly. Without this path, hitting
    // the stop button mid-sentence leaves Kelion's voice trailing for
    // a second or two after the session is visibly closed.
    playbackGenerationRef.current += 1
    for (const src of activeSourcesRef.current) {
      try { src.onended = null } catch (_) { /* ignore */ }
      try { src.stop(0) } catch (_) { /* already stopped */ }
      try { src.disconnect() } catch (_) { /* already disconnected */ }
    }
    activeSourcesRef.current.clear()
    playbackPlayingRef.current = false
    if (playbackCtxRef.current) {
      playbackEndTimeRef.current = playbackCtxRef.current.currentTime
    }
    // Reset charge-on-proof guards. Without this, a stop() followed by
    // a fresh start() would see `creditsStartedRef=true` from the prior
    // session and never start the heartbeat on the new one.
    creditsStartedRef.current = false
    creditsStartFnRef.current = null
    setUserLevel(0)
    setStatus('idle')
    setError(null)
    setVisionError(null)
  }, [stopFrameSender, clearAudioQueue])

  useEffect(() => () => { stop() }, [stop])

  // ───── Narration loop (accessibility — visually-impaired users) ─────
  // When set_narration_mode is enabled (via the voice tool), periodically
  // inject a short text prompt into the live WebSocket asking the model to
  // describe what it sees from the camera frames it is already receiving.
  // Gemini Live sees the video track natively — we just need to nudge it
  // with a text turn on a timer so it speaks the description out loud.
  const narrationTimerRef = useRef(null)
  useEffect(() => {
    if (!active) return undefined
    const clearNarrationTimer = () => {
      if (narrationTimerRef.current) {
        clearInterval(narrationTimerRef.current)
        narrationTimerRef.current = null
      }
    }
    const startNarrationLoop = (snap) => {
      clearNarrationTimer()
      if (!snap.enabled) return
      const intervalMs = snap.intervalMs || 8000
      let lastSentAt = 0
      narrationTimerRef.current = setInterval(() => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        // Don't narrate while Kelion is speaking/thinking — wait for silence
        if (statusRef.current !== 'listening') return
        // Debounce: skip if we sent a narration prompt less than (intervalMs - 2s) ago.
        // This prevents the loop from firing immediately after Kelion finishes
        // speaking the previous description (status flips to 'listening' and the
        // next interval tick fires within milliseconds).
        const now = Date.now()
        if (now - lastSentAt < intervalMs - 2000) return
        lastSentAt = now
        const focus = snap.focus
          ? `Focus on: ${snap.focus}. `
          : ''
        const prompt = `${focus}Describe briefly what you see right now from the camera. Be natural, concise (2-3 sentences). Mention any changes since your last description.`
        try {
          // Mark as synthetic so the echoed inputTranscription is suppressed
          narrationPendingRef.current = true
          ws.send(JSON.stringify({
            clientContent: {
              turns: [{ role: 'user', parts: [{ text: prompt }] }],
              turnComplete: true,
            },
          }))
        } catch (_) { /* best-effort */ }
      }, intervalMs)
    }
    // Subscribe to narration mode changes
    const unsub = subscribeNarrationMode((snap) => {
      startNarrationLoop(snap)
    })
    // Check initial state
    const initial = getNarrationMode()
    if (initial.enabled) startNarrationLoop(initial)
    return () => {
      clearNarrationTimer()
      unsub()
    }
  }, [active])

  // Register the camera controller so the `switch_camera` / camera_on /
  // camera_off / zoom_camera voice tools can drive this hook. Only the
  // ACTIVE transport registers — the `active` gate prevents
  // setCameraController from being committed by an inactive instance
  // in the same render pass. That caused verbal camera commands to land
  // on the wrong transport whenever the user picked the "losing"
  // provider (user-visible symptom: "camera nu merge corect" because
  // the stream opened on the inactive hook and the UI reads
  // liveHook.cameraStream from the active one).
  useEffect(() => {
    if (!active) return undefined
    setCameraController({
      start: (opts) => startCamera(opts),
      stop: () => stopCamera(),
      restart: (opts) => startCamera(opts),
      getFacingMode: () => cameraFacingRef.current || 'user',
      // camera_zoom tool reaches through to the live MediaStreamTrack
      // and applies a native zoom constraint where supported. Gemini's
      // hidden <video> element is tracked on hiddenVideoCameraRef; fall
      // back to cameraStreamRef when the hidden video hasn't attached
      // yet (first frame hasn't fired).
      getActiveTrack: () => {
        const v = hiddenVideoCameraRef.current
        const src = (v && v.srcObject) || cameraStreamRef.current
        if (src && typeof src.getVideoTracks === 'function') {
          const tracks = src.getVideoTracks()
          return tracks && tracks[0] ? tracks[0] : null
        }
        return null
      },
    })
    return () => setCameraController(null)
  }, [active, startCamera, stopCamera])

  // Audit M6 — `isBusy()` lets KelionStage's auto-fallback effect
  // (2) detect whether the user already kicked off a manual
  // start() between the provider flip and the handoff call.
  // Returns true while `start()` is in flight OR while the live
  // ws is anything other than CLOSED. Reading refs directly so a
  // caller sees the latest value without waiting for a re-render.
  const isBusy = useCallback(() => {
    if (startInFlightRef.current) return true
    const ws = wsRef.current
    if (ws && ws.readyState !== WebSocket.CLOSED) return true
    return false
  }, [])

  // setMuted — instantly silences or restores Kelion's voice output by
  // controlling the Web Audio gain node. Works without restarting the session.
  const setMuted = useCallback((muted) => {
    if (outputGainRef.current) {
      outputGainRef.current.gain.value = muted ? 0 : 1
    }
  }, [])

  // sendText — sends a typed message through the live WebSocket as a
  // clientContent turn. The model responds with voice + transcript just
  // like a spoken turn. Enables the chat panel (⌨ button) to work.
  const sendText = useCallback(async (text) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[geminiLive] sendText: no open WebSocket')
      return
    }
    const clean = (text || '').trim()
    if (!clean) return
    userHasSpokenRef.current = true
    appendTurn('user', clean, true, '⌨️ Keyboard')
    logAiEvent('text_sent', { text: clean })
    try {
      ws.send(JSON.stringify({
        clientContent: {
          turns: [{ role: 'user', parts: [{ text: clean }] }],
          turnComplete: true,
        },
      }))
      setStatus('thinking')
    } catch (err) {
      console.error('[geminiLive] sendText failed', err)
    }
  }, [appendTurn])

  // Allow the parent to clear or seed the transcript (used by history
  // load, new-conversation, sign-out). Avoids duplicating state.
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
    // Stage 2
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
