// Kelion voice client hook (Gemini via OpenRouter REST + Browser SpeechRecognition).
// Manages: mic capture → SpeechRecognition → OpenRouter → TTS playback → lipsync → transcript.
// Stage 1 modules: M3 (mic+VAD), M4 (voice loop), M5 (auto-language),
//   M6 (turn-taking), M8 (Kelion persona).
// Stage 2 modules: M9 (camera live stream w/ visible preview), M10 (screen share),
//   M11 (vision reasoning via multimodal frames), M12 (emotion mirror via persona).

import { useEffect, useRef, useState, useCallback } from 'react'
import { correctTranscript } from './transcriptProcessor'
import { runTool } from './kelionTools'
import { isClonedVoiceActive, setDetectedLang, getDetectedLang, getSelectedVoice } from './voiceModeStore'
import { setCameraController, setCurrentFacingMode } from './cameraControl'
import { getCsrfToken } from './api'
import { subscribeNarrationMode, getNarrationMode } from './narrationMode'
import { logAiEvent } from './aiEventLog'
import { setTaskStatus as _setTaskStatus, completeTask as _completeTask, failTask as _failTask, clearTaskStatus as _clearTaskStatus } from './taskStatusStore'

const SAMPLE_RATE_IN = 16000   // Mic capture rate for SpeechRecognition
const SAMPLE_RATE_OUT = 24000  // TTS playback rate (ElevenLabs REST TTS)

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

export function useKelionVoice({ audioRef, coords = null, onBalanceUpdate = null, active = true }) {
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
  // Credits heartbeat (signed-in non-admin only). While a voice
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
  // the system instruction and the model would re-greet anyway, defeating F4.
  // handleMessage reads this ref to decide whether to skip the kickstart.
  const handoffSessionRef = useRef(false)
  // Anti-double-greeting guard. The model sometimes generates
  // an unsolicited greeting even when the system prompt says "don't
  // speak first". We suppress ALL model audio/text until the user has
  // spoken at least once. Becomes true on first inputTranscription.
  const userHasSpokenRef = useRef(false)
  // Narration-pending guard — set true right before sending a synthetic
  // narration prompt so the returning inputTranscription (which the model
  // echoes back as the 'user' turn) is NOT shown in the transcript.
  const narrationPendingRef = useRef(false)
  // Narration cooldown — epoch ms of the last real user interaction
  // (voice, text, tool call). The narration loop won't fire within 5s
  // of this timestamp so Kelion's voice response has time to complete
  // before the narrator speaks. Without this, status briefly returns
  // to 'listening' between tool calls and the narrator fires in the gap,
  // producing overlapping voices ("naratorul intra peste kelion").
  const narrationCooldownRef = useRef(0)
  // translatorModeRef — set in start() before the WS opens so handleMessage
  // can read it inside setupComplete without a closure/scope issue.
  const translatorModeRef = useRef(false)
  const initialTextRef = useRef(null)
  const sessionIdRef = useRef(null)

  const wsRef = useRef(null)
  const audioCtxRef = useRef(null)       // 16kHz capture context for voice — MUST match SAMPLE_RATE_IN
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

  // ───── Chunked TTS Queue ─────
  const ttsBlobQueueRef = useRef([])
  const ttsIsPlayingRef = useRef(false)
  const ttsAbortControllerRef = useRef(null)

  // VOICE UNIQUENESS: central ref for ANY audio element currently
  // playing TTS (audioRef blob, standalone new Audio(), etc.).
  // clearAudioQueue stops it so only ONE voice speaks at a time.
  // Adrian 2026-05-08: "sa fie doar el, unicitate e nevoie".
  const activeAudioElRef = useRef(null)
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
  // Smart Vision (M9 adaptive FPS): dynamic target 2..10 FPS based on
  // motion detection + conversational context.
  const visionFPSRef = useRef(2)
  const visionLastBoostAtRef = useRef(0)
  const visionLastMotionDataRef = useRef(null)
  const motionCanvasRef = useRef(null)
  const voiceBufferRef = useRef([]) // Array of Float32Arrays for Auto-Vox
  const toolExecutingRef = useRef(false)

  // Auto-Vox Flush: when we return to 'listening', pour the buffer.
  useEffect(() => {
    if (status === 'listening' && voiceBufferRef.current.length > 0 && wsRef.current?.readyState === WebSocket.OPEN) {
      console.log(`[autovox] pouring buffer: ${voiceBufferRef.current.length} chunks`);
      voiceBufferRef.current.forEach(float => {
        const pcm16 = floatTo16BitPCM(float)
        const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
        const b64 = base64FromBytes(bytes)
        try {
          wsRef.current.send(JSON.stringify({
            realtimeInput: {
              audio: { data: b64, mimeType: `audio/pcm;rate=${SAMPLE_RATE_IN}` },
            },
          }))
        } catch (_) { }
      });
      voiceBufferRef.current = [];
    }
  }, [status]);

  // Tool-call loop guard — detects when the model repeatedly calls the same
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

  const playNextTtsBlob = useCallback(() => {
    if (ttsIsPlayingRef.current || ttsBlobQueueRef.current.length === 0) return;
    ttsIsPlayingRef.current = true;

    const blobUrl = ttsBlobQueueRef.current.shift();
    const audioEl = audioRef?.current || new window.Audio();
    if (audioEl === audioRef?.current) {
      audioEl.srcObject = null;
      audioEl.muted = false;
    }
    audioEl.src = blobUrl;
    audioEl.volume = 1.0;
    activeAudioElRef.current = audioEl;

    const onComplete = () => {
      URL.revokeObjectURL(blobUrl);
      activeAudioElRef.current = null;
      ttsIsPlayingRef.current = false;
      playNextTtsBlob();

      // If queue is empty and we are speaking, flip to listening
      if (ttsBlobQueueRef.current.length === 0 && statusRef.current === 'speaking') {
        setStatus(window.__restRecRef ? 'listening' : 'idle');
      }
    };
    audioEl.onended = onComplete;
    audioEl.onerror = onComplete;
    audioEl.play().catch(onComplete);
  }, [audioRef]);

  const processTtsChunk = useCallback(async (textChunk) => {
    if (!textChunk.trim()) return;
    const isNative = !isClonedVoiceActive();
    const ttsUrl = isNative ? '/api/voice/clone/tts?native=true' : '/api/voice/clone/tts';

    if (!ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current = new AbortController();
    }

    setStatus('speaking');
    try {
      const r = await fetch(ttsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
        credentials: 'include',
        body: JSON.stringify({ text: textChunk, lang: getDetectedLang(), voiceId: getSelectedVoice()?.voiceId || undefined }),
        signal: ttsAbortControllerRef.current.signal
      });
      if (r.ok) {
        const audioData = await r.arrayBuffer();
        if (audioData.byteLength > 100) {
          const blob = new Blob([audioData], { type: 'audio/mpeg' });
          ttsBlobQueueRef.current.push(URL.createObjectURL(blob));
          playNextTtsBlob();
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') console.error('[kelionVoice] Chunked TTS fetch failed:', e);
    }
  }, [playNextTtsBlob]);

  // ───── Mic level meter (drives halo voice-reactive glow) ─────
  // IMPORTANT: uses a SEPARATE AudioContext from the 16kHz capture context.
  // Sharing `audioCtxRef` here lazily created a 48kHz default-rate context
  // before the capture pipeline could create its 16kHz one, which caused the
  // mic to be captured at 48kHz but tagged as 16kHz on the wire to the model.
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
        audioRef.current.play().catch(() => { })
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
    // VOICE UNIQUENESS: also stop any TTS audio element (blob-based)
    // that may be playing from a previous turn. This covers both the
    // audioRef TTS path and standalone new Audio() fallbacks.
    const prevAudio = activeAudioElRef.current
    if (prevAudio) {
      try { prevAudio.pause() } catch (_) { }
      try { prevAudio.onended = null } catch (_) { }
      try { if (prevAudio.src && prevAudio.src.startsWith('blob:')) URL.revokeObjectURL(prevAudio.src) } catch (_) { }
      try { prevAudio.src = '' } catch (_) { }
      activeAudioElRef.current = null
    }
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
  const turnHasAudioRef = useRef(false)
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
        turnHasAudioRef.current = false
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
          if (sc.inputTranscription.text.trim()) {
            const rawIn = sc.inputTranscription.text;
            const correctedIn = correctTranscript(rawIn);
            appendTurn('user', correctedIn, false, '🎤 Voice (Mic)')
            logAiEvent('transcript_in', { text: correctedIn })
          }
          lastActivityAtRef.current = Date.now()
          narrationCooldownRef.current = Date.now()
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
          logAiEvent('transcript_out', { text: sc.outputTranscription.text, source: 'voice-live' })

          // Chunked TTS: Accumulate and flush on sentence boundaries
          cloneTranscriptBufRef.current += sc.outputTranscription.text;
          const match = cloneTranscriptBufRef.current.match(/([.!?\n]\s*)/);
          if (match) {
            const splitIndex = match.index + match[0].length;
            const sentence = cloneTranscriptBufRef.current.substring(0, splitIndex).trim();
            cloneTranscriptBufRef.current = cloneTranscriptBufRef.current.substring(splitIndex);
            if (sentence) {
              processTtsChunk(sentence);
            }
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
          logAiEvent('audio_skipped', { reason: 'migrated-to-rest-tts' })
          console.log('[kelionVoice] skipped native PCM chunk (migrated to REST TTS)')
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
          cloneTranscriptBufRef.current += partText
          console.log('[tts] using partText fallback:', partText.slice(0, 80))
        } else if (!hadTranscript && !partText && turnHasAudioRef.current) {
          // API sometimes streams audio chunks but never fires outputTranscription or part.text
          appendTurn('assistant', '[Audio - Fără transcript text returnat de API]', false, '🔊 Audio Only (No Text)')
        }
        // Reset all per-turn buffers
        turnHasTranscriptRef.current = false
        turnHasAudioRef.current = false
        partTextBufRef.current = ''
        // Voice: flush accumulated transcript to REST TTS
        if (cloneTranscriptBufRef.current.trim()) {
          const textToSpeak = cloneTranscriptBufRef.current.trim()
          cloneTranscriptBufRef.current = ''
          processTtsChunk(textToSpeak)
        } else {
          cloneTranscriptBufRef.current = ''
          if (!playbackPlayingRef.current && !ttsIsPlayingRef.current) setStatus('listening')
        }
      } else if (sc.generationComplete) {
        setStatus('speaking')
      }
    }

    // Stage 4 — The model asks us to run a function tool.
    // Each functionCall carries { id, name, args }. We route to the right
    // /api/tools/* backend endpoint, then send back a toolResponse with the
    // matching id so the model can continue the turn with the result.
    if (msg.toolCall?.functionCalls?.length) {
      toolExecutingRef.current = true
      setStatus('working')
      const fcs = msg.toolCall.functionCalls
      // Suppress narration during tool execution — the cooldown prevents
      // the narrator from jumping in between chained tool calls.
      narrationCooldownRef.current = Date.now()
      for (const fc of fcs) {
        logAiEvent('tool_call', { name: fc.name, args: fc.args })
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
            console.warn(`[kelionVoice] tool loop detected: ${fc.name} called ${toolCallLoopRef.current.count}x — breaking`)
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
          toolExecutingRef.current = false
        }
      } catch (err) {
        console.error('[kelionVoice] tool execution failed', err)
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            toolResponse: {
              functionResponses: fcs.map((fc) => ({
                id: fc.id,
                name: fc.name,
                response: { result: `Tool error: ${err.message || 'unknown'}. Explain briefly to the user WHY this failed, what is missing or broken, and suggest an alternative if possible.` },
              })),
            },
          }))
          toolExecutingRef.current = false
        }
      }
    }

    if (msg.setupComplete) {
      logAiEvent('setup_complete', {})
      setStatus('listening')
      if (initialTextRef.current && ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: initialTextRef.current }] }], turnComplete: true } }))
          setStatus('thinking')
          initialTextRef.current = null
        } catch (_) { }
      }
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
      console.error('[kelionVoice] error from server:', msg.error || msg.errorMessage)
      setError(msg.error?.message || msg.errorMessage || 'Server error')
      setStatus('error')
    }
  }, [appendTurn, enqueueAudio, clearAudioQueue])

  // ───── Start full pipeline ─────
  // textOnly: true → open WS without mic (text chat). Voice (tap-to-talk)
  // calls start() without textOnly so the mic opens as before.
  const start = useCallback(async (opts = {}) => {
    // F4 — KelionStage passes the current
    // session transcript so the model continues rather than re-greeting.
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
    initialTextRef.current = opts.initialText || null
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

    // Clear Chunked TTS Queue
    ttsBlobQueueRef.current = []
    ttsIsPlayingRef.current = false
    if (activeAudioElRef.current) {
      try { activeAudioElRef.current.pause(); activeAudioElRef.current.src = ''; } catch (_) { }
      activeAudioElRef.current = null;
    }
    if (ttsAbortControllerRef.current) {
      ttsAbortControllerRef.current.abort();
      ttsAbortControllerRef.current = null;
    }
    if (httpAbortRef.current) {
      httpAbortRef.current.abort();
      httpAbortRef.current = null;
    }

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
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            voiceIsolation: true,
            sampleRate: SAMPLE_RATE_IN
          },
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
      // Backend selector. Default is `aistudio` — legacy path.
      // Current production uses OpenRouter. Matches the server default
      // (realtime.js). `?liveBackend=vertex` (or
      // `localStorage.kelion_live_backend = 'vertex'`) forces the Vertex AI
      // proxy path — requires GCP billing to be enabled.
      let liveBackend = 'aistudio'
      try {
        const fromUrl = new URL(window.location.href).searchParams.get('liveBackend')
        const fromStorage = window.localStorage?.getItem('kelion_live_backend')
        const raw = (fromUrl || fromStorage || '').toString().toLowerCase()
        if (raw === 'vertex') liveBackend = 'vertex'
        if (raw === 'aistudio') liveBackend = 'aistudio'
      } catch (_) { /* window/localStorage missing in SSR — default stays */ }
      const backendQuery = liveBackend === 'aistudio' ? '&backend=aistudio' : '&backend=vertex'
      // Send client's real timezone so Kelion knows the actual time of day
      const clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
      const clientLocalTime = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
      const tzQuery = `&tz=${encodeURIComponent(clientTz)}&localTime=${encodeURIComponent(clientLocalTime)}`
      const tokenUrl = `/api/realtime/voice-token?lang=${encodeURIComponent(langHint)}${geoQuery}${backendQuery}${tzQuery}`
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
      const resolvedBackend = tokenBody?.backend === 'vertex' ? 'vertex'
        : tokenBody?.backend === 'openrouter' ? 'openrouter'
          : 'aistudio'
      // Vertex and OpenRouter paths don't return a token (Vertex auth
      // lives on the server-side proxy; OpenRouter uses REST Voice Mode).
      // Only enforce the token presence for AI Studio.
      if (resolvedBackend === 'aistudio' && !token) throw new Error('No ephemeral token returned')
      if (resolvedBackend === 'aistudio' && !setupPayload) throw new Error('No live-connect setup returned')

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

      if (resolvedBackend === 'openrouter' || (!token && !setupPayload)) {
        // REST Voice Mode — server returned no ephemeral token (OpenRouter, Claude, etc.)
        console.log('[kelionVoice] OpenRouter model detected, switching to REST Voice Mode');
        // We MUST NOT stop micStreamRef.current here because if the soundbars are flat,
        // the user thinks the app is dead and clicks the button again!

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
          throw new Error('Browserul tău nu suportă recunoașterea vocală (Speech-to-Text). Vă rugăm să folosiți Chrome.');
        }

        const rec = new SR();
        window.__restRecRef = rec; // Keep a reference to stop it properly later
        rec.continuous = false;
        rec.interimResults = true; // Use interim results to animate soundbars
        rec.lang = navigator.language || 'ro-RO';

        let fakeAnimFrame = null;
        const startFakeAnim = () => {
          if (statusRef.current === 'listening') {
            setUserLevel(0.2 + Math.random() * 0.4);
            fakeAnimFrame = requestAnimationFrame(() => setTimeout(startFakeAnim, 100));
          } else {
            setUserLevel(0);
          }
        };
        startFakeAnim();

        rec.onresult = async (ev) => {
          setUserLevel(0.6 + Math.random() * 0.4);

          if (!ev.results[ev.results.length - 1].isFinal) {
            // Barge-in: immediately stop TTS when user starts speaking
            clearAudioQueue();
            return; // Wait for final transcript
          }

          const rawTranscript = ev.results[ev.results.length - 1][0].transcript;
          if (!rawTranscript) return;
          const transcript = correctTranscript(rawTranscript);

          // ── Stop Word Detection ──────────────────────────────────────
          // If user says "oprește-te", "taci", "stop", "gata" etc.,
          // immediately silence Kelion and return to listening.
          // Do NOT send these commands to Claude (he'd respond with another paragraph).
          const STOP_WORDS = /\b(opreste|opri|oprit|taci|stop|gata|ajunge|destul|lasa|las[aă]|shut\s*up|quiet|enough|silence|termina|termin[aă])\b/i;
          if (STOP_WORDS.test(transcript)) {
            console.log('[kelionVoice] Stop word detected:', transcript);
            clearAudioQueue();
            // Stop any active TTS
            if (activeAudioElRef.current) {
              try { activeAudioElRef.current.pause(); activeAudioElRef.current.src = ''; } catch (_) {}
              activeAudioElRef.current = null;
            }
            if (ttsAbortControllerRef.current) {
              ttsAbortControllerRef.current.abort();
              ttsAbortControllerRef.current = null;
            }
            ttsBlobQueueRef.current = [];
            ttsIsPlayingRef.current = false;
            setStatus('listening');
            setUserLevel(0);
            startFakeAnim();
            return; // Do NOT send to Claude
          }

          setStatus('thinking');
          setUserLevel(0);
          if (fakeAnimFrame) cancelAnimationFrame(fakeAnimFrame);

          let base64Image = null;
          if (cameraStreamRef.current) {
            try {
              const track = cameraStreamRef.current.getVideoTracks()[0];
              const imageCapture = new ImageCapture(track);
              const bitmap = await imageCapture.grabFrame();
              const canvas = document.createElement('canvas');
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(bitmap, 0, 0);
              base64Image = canvas.toDataURL('image/jpeg');
            } catch (e) { console.error('[kelionVoice] Vision frame error', e); }
          }

          // Use the enhanced sendText which supports images and audio playback!
          await sendText(transcript, base64Image, true);
        };

        rec.onerror = (ev) => {
          if (fakeAnimFrame) cancelAnimationFrame(fakeAnimFrame);
          setUserLevel(0);
          // 'no-speech' and 'aborted' are normal operational events:
          // - no-speech: user was silent during the recognition window
          // - aborted: recognition was stopped/restarted during a status transition
          // Both should just restart the recognizer, not show an error badge.
          const harmless = ['no-speech', 'aborted'];
          if (!harmless.includes(ev.error)) {
            console.warn('[kelionVoice] SpeechRecognition error:', ev.error);
            setError('Microphone error: ' + ev.error);
            setStatus('error');
          } else {
            // Keep listening permanently unless stopped
            if (statusRef.current !== 'stopped' && statusRef.current !== 'error' && statusRef.current !== 'idle') {
              try { rec.start(); } catch (e) { }
              if (statusRef.current === 'listening') startFakeAnim();
            }
          }
        };

        rec.onend = () => {
          if (fakeAnimFrame) cancelAnimationFrame(fakeAnimFrame);
          setUserLevel(0);
          // Keep listening permanently unless stopped or returned to idle by user
          if (statusRef.current !== 'stopped' && statusRef.current !== 'error' && statusRef.current !== 'idle') {
            try { rec.start(); } catch (e) { }
            // Always transition back to 'listening' when we restart the recognizer
            // (sendText sets 'idle' after TTS completes; we need to go back to 'listening'
            // so the status badge shows the correct state and the animation runs)
            setStatus('listening');
            startFakeAnim();
          }
        };

        setStatus('listening');
        rec.start();
        return;
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
          console.error('[kelionVoice] failed to send setup frame', err)
        }

        // NOTE: the greet-first `clientContent` kickstart used to live here,
        // sent synchronously right after `setup`. That caused the API to
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
            console.warn('[kelionVoice] credits/consume failed', err && err.message)
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
        console.error('[kelionVoice] ws error', e)
        setError('Connection error')
        setStatus('error')
      }
      ws.onclose = (e) => {
        // Surface Google's close code + reason so bad-endpoint or
        // expired-token failures show up in the console instead of being
        // silently flipped back to 'idle'. 1000 = normal, 1005/1006 = no
        // status / abnormal, 1008 = policy (wrong endpoint / bad token),
        // 1007 = protocol (double setup), 1011 = server / quota.
        console.warn('[kelionVoice] ws close', { code: e?.code, reason: e?.reason, wasClean: e?.wasClean })
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
        // Protocol / auth / quota / billing failures must never silently
        // bounce to 'idle' — the wake-word and auto-start are armed on
        // 'idle' and will re-fire start(), creating a reconnection loop.
        // Only specific fatal codes stay on 'error'. Codes like 1005 (no
        // status) and 1006 (abnormal / idle timeout) are normal — Google
        // sends these on idle timeout or network blip and should allow
        // reconnection via tap-to-talk.
        const FATAL_CODES = new Set([1007, 1008, 1011])
        if (neverOpened || FATAL_CODES.has(e?.code)) {
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
          console.error('[kelionVoice] Worklet load failed:', e)
          throw new Error('Failed to load audio worklet')
        }

        const src = ctx.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(ctx, 'kelion-capture', { numberOfInputs: 1, numberOfOutputs: 0 })
        node.port.onmessage = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return
          const float = e.data

          // Auto-Vox: if thinking or working, buffer it instead of sending.
          // Allows user to keep talking while tools run/model thinks.
          const currentStatus = statusRef.current;
          if (currentStatus === 'thinking' || currentStatus === 'working') {
            voiceBufferRef.current.push(float);
            return;
          }

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
      console.error('[kelionVoice] start error', e)
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
  // Streams a MediaStream to the Live API as a continuous sequence of JPEG
  // frames tagged with `realtimeInput.video` (the field the Live API treats
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
    video.play().catch(() => { })

    // Smart Vision (M9 adaptive FPS): dynamic target 2..8 FPS based on
    // motion detection + conversational context. Screen share stays at 2 FPS.
    const MAX_W = 1280
    const JPEG_Q = kind === 'screen' ? 0.75 : 0.85
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
        const ctx = canvas.getContext('2d', { alpha: false }) // Optimisation
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        } catch {
          return
        }

        // --- Motion Detection (Lightweight 16x16 thumbnail) ---
        if (kind === 'camera') {
          if (!motionCanvasRef.current) motionCanvasRef.current = document.createElement('canvas')
          const mc = motionCanvasRef.current
          mc.width = 16; mc.height = 16
          const mctx = mc.getContext('2d', { willReadFrequently: true })
          mctx.drawImage(video, 0, 0, 16, 16)
          const currentData = mctx.getImageData(0, 0, 16, 16).data

          if (visionLastMotionDataRef.current) {
            let diff = 0
            const prevData = visionLastMotionDataRef.current
            // Sample red channel every pixel for speed
            for (let i = 0; i < currentData.length; i += 4) {
              diff += Math.abs(currentData[i] - prevData[i])
            }
            // If significant change (> 5% avg pixel diff), boost vision
            if (diff > 800) {
              visionLastBoostAtRef.current = Date.now()
            }
          }
          visionLastMotionDataRef.current = currentData
        }

        const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_Q))
        if (!blob) return
        const buf = await blob.arrayBuffer()
        const bytes = new Uint8Array(buf)
        const b64 = base64FromBytes(bytes)
        ws.send(JSON.stringify({
          realtimeInput: {
            video: { data: b64, mimeType: 'image/jpeg' },
          },
        }))
      } catch (e) {
        console.warn('[kelionVoice] frame send failed', e)
      } finally {
        busy = true // Wait for small delay before next frame
        busy = false
      }
    }

    const loop = async () => {
      // Decide FPS
      let fps = 2
      const now = Date.now()
      if (kind === 'camera') {
        // If the AI is busy executing a tool (writing code, running commands),
        // we don't need a high-FPS video feed. Slow down to 1 frame every 2s
        // to maximize cost savings while keeping the session alive.
        if (toolExecutingRef.current) fps = 0.5
        // Boost if recently moved (Smart Vision)
        else if (now < visionLastBoostAtRef.current + 4000) fps = 8
        // Boost if AI is active/talking (Attention Mode)
        else if (statusRef.current === 'speaking' || statusRef.current === 'thinking') fps = 4
      }

      await send()

      const delay = Math.max(50, 1000 / fps)
      const timerId = setTimeout(loop, delay)
      if (kind === 'camera') cameraFrameTimerRef.current = timerId
      else screenFrameTimerRef.current = timerId
    }
    loop()
  }, [])

  const stopFrameSender = useCallback((kind) => {
    const ref = kind === 'camera' ? cameraFrameTimerRef : screenFrameTimerRef
    if (ref.current) {
      clearTimeout(ref.current)
      ref.current = null
    }
    const hiddenRef = kind === 'camera' ? hiddenVideoCameraRef : hiddenVideoScreenRef
    if (hiddenRef.current) {
      try { hiddenRef.current.pause() } catch { }
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
    // 2026-05-06: Reduced from 4K → 720p. We downscale to 480px in the
    // frame sender anyway, so capturing at 4K wastes memory and GPU
    // (camera driver allocates 4K buffers that we never use at full res).
    // 720p gives enough headroom for the 480px downscale while keeping
    // resource usage sane.
    const constraintLadder = [
      { video: { ...baseSelector, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { ...baseSelector, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
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
    console.error('[kelionVoice] camera start failed', lastError)
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
        console.error('[kelionVoice] screen share failed', e)
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
      try { wsRef.current.close(1000, 'user_stopped') } catch { }
    }
    wsRef.current = null
    if (workletNodeRef.current) {
      try { workletNodeRef.current.disconnect() } catch { }
      workletNodeRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
    }
    if (window.__restRecRef) {
      try { window.__restRecRef.stop() } catch { }
      window.__restRecRef = null
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
      try { meterCtxRef.current.close() } catch { }
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

  // ───── Narration loop — DISABLED ─────
  // Adrian (2026-05-08): "ideal ar fi sa fie doar kelion in toate ipostazele,
  // fara narator, el sa caute el sa dea raspunsul, unicitate e nevoie."
  //
  // The autonomous narration timer has been removed. Kelion is the SOLE voice
  // — when the user asks him to describe what he sees, he does it as himself
  // (through the normal voice turn flow), not via a separate "narrator" that
  // fires synthetic prompts on a timer. The timer approach caused overlapping
  // voices because it injected prompts in the brief 'listening' gaps between
  // tool calls and user interactions.
  //
  // The narrationMode store + set_narration_mode tool declaration still exist
  // for forward compatibility. If re-enabled in the future, the loop MUST
  // coordinate with Kelion's turn-taking — never fire while a tool chain is
  // in progress, and cancel immediately when the user speaks.

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
      // and applies a native zoom constraint where supported. The
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

  // setMicEnabled — disables/enables the microphone audio tracks without
  // tearing down the WebSocket. When mic is off the session stays alive
  // for text chat; re-enabling resumes voice input instantly.
  const setMicEnabled = useCallback((enabled) => {
    const stream = micStreamRef.current
    if (stream) {
      stream.getAudioTracks().forEach((t) => { t.enabled = !!enabled })
    }
  }, [])

  // sendText — sends a typed message through the live WebSocket as a
  // clientContent turn. The model responds with voice + transcript just
  // like a spoken turn. Enables the chat panel (⌨ button) to work.
  // AbortController and message buffer for HTTP chat mode
  const httpAbortRef = useRef(null);
  const httpMsgBufferRef = useRef([]);
  const httpBusyRef = useRef(false);

  const sendText = useCallback(async (text, image = null, playAudio = false, fastMode = false) => {
    const clean = (text || '').trim()
    if (!clean && !image) return

    // Immediate STOP intercept
    if (['stop', 'oprește', 'gata', 'oprește-te', 'stop it'].includes(clean.toLowerCase().replace(/[.,!]/g, ''))) {
      clearAudioQueue()
      if (httpAbortRef.current) {
        httpAbortRef.current.abort()
        httpAbortRef.current = null
      }
      setStatus('listening')
      httpBusyRef.current = false
      return
    }

    userHasSpokenRef.current = true
    narrationCooldownRef.current = Date.now()
    if (clean) appendTurn('user', clean, true, playAudio ? '🎤 Voice' : '⌨️ Keyboard')
    if (clean) logAiEvent('text_sent', { text: clean })

    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN && !playAudio) {
      // Live WebSocket path
      try {
        ws.send(JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text: clean }] }],
            turnComplete: true,
          },
        }))
        setStatus('thinking')
      } catch (err) {
        console.error('[kelionVoice] sendText failed', err)
      }
    } else {
      // HTTP fallback — Gemini text/voice chat via /api/chat
      // If a loop is already running, queue the message and let the active loop pick it up
      if (httpBusyRef.current) {
        httpMsgBufferRef.current.push({ clean, image })
        return
      }

      httpBusyRef.current = true
      setStatus('thinking')
      _setTaskStatus({ tool: 'chat', progress: 5, label: '📩 Mesaj primit...', phase: 'thinking' });
      try {
        let currentMessage = clean;
        let currentImage = image;
        let toolResponses = undefined;
        let maxLoops = 50; // Increased to allow long autonomous audits
        let finalReply = '';
        let finalModel = '';

        if (!sessionIdRef.current) {
          sessionIdRef.current = 'ses_' + Math.random().toString(36).substring(2, 10);
        }

        // Global timeout: if the entire chat loop takes >10m, bail out
        const _chatDeadline = Date.now() + 600_000;
        const _seenTools = new Map(); // circuit breaker: track repeated tool calls

        while (maxLoops-- > 0) {
          // ── Deadline check ──
          if (Date.now() > _chatDeadline) {
            _failTask('⏰ Timeout — prea mult timp, opresc bucla');
            finalReply = 'Am depășit limita de timp. Încearcă din nou cu o cerere mai simplă.';
            break;
          }
          // If buffered messages arrived while tools were running, append them
          while (httpMsgBufferRef.current.length > 0) {
            const next = httpMsgBufferRef.current.shift()
            currentMessage = currentMessage ? currentMessage + '\n' + next.clean : next.clean
            if (next.image) currentImage = next.image
          }

          httpAbortRef.current = new AbortController()
          const currentAbortSignal = httpAbortRef.current.signal;
          let data;

          // ── Puter.js PRIMARY path (Claude Opus 4.7 — free, fast, NO POPUP) ──
          try {
            // Load Puter.js via CDN if not already loaded
            if (!window.puter) {
              const existing = document.querySelector('script[src*="puter.com"]');
              if (!existing) {
                const s = document.createElement('script');
                s.src = 'https://js.puter.com/v2/';
                document.head.appendChild(s);
                await new Promise(r => setTimeout(r, 2000));
              }
            }
            const puter = window.puter;
            // ONLY proceed if already authenticated (no popup trigger)
            const isAuthed = puter && puter.authToken;
            if (puter && puter.ai && isAuthed && (!toolResponses || toolResponses.length === 0)) {
              _setTaskStatus({ tool: 'puter-opus', progress: 20, label: '🧠 Opus 4.7 (Puter)...', phase: 'thinking' });
              const sysPrompt = "You are KelionAI, a genius expert coder and architect. You speak Romanian natively. Do your best to help the user immediately. Output the response in raw text.";
              const puterResp = await puter.ai.chat([{ role: 'system', content: sysPrompt }, { role: 'user', content: currentMessage }], { model: 'claude-opus-4-7' });
              const replyText = typeof puterResp === 'string' ? puterResp : (puterResp?.message?.content?.[0]?.text || puterResp?.message?.content || puterResp?.toString() || '');
              if (replyText) {
                data = { reply: replyText, model: 'claude-opus-4-7 (Puter)' };
              }
              _setTaskStatus({ tool: 'puter-opus', progress: 80, label: '✅ Răspuns Opus primit', phase: 'working' });
            }
          } catch (e) {
            console.log('[kelionVoice] Puter fallback to backend:', e?.message || e);
          }

          // ── Backend API call ──
          if (!data) {
            _setTaskStatus({ tool: 'work', progress: 20, label: 'Kelion lucreaza...', phase: 'thinking' });
            const r = await fetch('/api/chat', {
              method: 'POST',
              signal: currentAbortSignal,
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfToken() },
              credentials: 'include',
              body: JSON.stringify({
                message: currentMessage,
                toolResponses,
                image: currentImage,
                sessionId: sessionIdRef.current,
                fastMode,
                lat: coords?.lat,
                lon: coords?.lon,
                clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                clientLocalTime: new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
              }),
            })
            if (!r.ok) {
              const rawError = await r.text().catch(() => '');
              let err = {};
              try {
                err = rawError ? JSON.parse(rawError) : {};
              } catch {
                err = {};
              }
              const edgeHtmlError = /^\s*<!doctype html/i.test(rawError) || /^\s*<html/i.test(rawError);
              const serverError = err.code === 'AI_PROVIDER_NOT_CONFIGURED'
                ? 'Nu exista provider AI configurat pe server. Seteaza OPENROUTER_API_KEY in Railway pentru kelionai.app.'
                : err.code === 'OPENROUTER_INSUFFICIENT_CREDITS'
                  ? 'AI/OpenRouter nu are credit. Adauga credit in OpenRouter, apoi testeaza din nou Kelion.'
                : err.code === 'CHAT_AI_TIMEOUT'
                  ? 'AI request timeout pe server. Incearca din nou dupa redeploy.'
                  : edgeHtmlError
                    ? `Server ${r.status}: edge/proxy a returnat HTML in loc de JSON. Verifica Railway deployment si logurile /api/chat.`
                    : (err.error || (rawError ? `Server ${r.status}: ${rawError.slice(0, 180)}` : `Server ${r.status}`));
              _setTaskStatus({ tool: 'work', progress: 100, label: serverError, phase: 'error' });
              finalReply = serverError;
              break;
            }
            data = await r.json()
            if (data.needsFastModeDecision) {
              httpBusyRef.current = false;
              return data;
            }
            _setTaskStatus({ tool: 'work', progress: 60, label: 'Kelion lucreaza...', phase: 'working' });
          }

          if (currentAbortSignal.aborted) break;

          // ── Tool execution loop ──
          if (data.toolCalls && data.toolCalls.length > 0) {
            setStatus('working')
            const results = [];
            const totalTools = data.toolCalls.length;
            
            // Circuit breaker: detect repeated tool calls
            let loopDetected = false;
            for (const tc of data.toolCalls) {
              const key = tc.name + ':' + (tc.args?.path || tc.args?.command || '').slice(0, 50);
              _seenTools.set(key, (_seenTools.get(key) || 0) + 1);
              if (_seenTools.get(key) > 4) {
                loopDetected = true;
                break;
              }
            }
            
            if (loopDetected) {
              _failTask(`🔄 Buclă detectată. Cer AI-ului să schimbe strategia...`);
              toolResponses = data.toolCalls.map(tc => ({
                name: tc.name,
                response: { ok: false, error: 'SYSTEM ALERT: You are stuck in an infinite loop repeating the exact same tool call! YOU MUST STOP using this tool with these arguments. Read the previous errors carefully. Try a completely different approach, think outside the box, or ask the user for help.' },
                id: tc.id
              }));
              currentMessage = undefined;
              currentImage = undefined;
              _setTaskStatus({ tool: 'work', progress: 30, label: 'Kelion lucreaza...', phase: 'thinking' });
              continue;
            }

            _setTaskStatus({ tool: 'work', progress: 0, label: 'Kelion lucreaza...', phase: 'working' });
            for (let ti = 0; ti < totalTools; ti++) {
              if (currentAbortSignal.aborted) break;
              
              const call = data.toolCalls[ti];
              _setTaskStatus({
                tool: 'work',
                file: null,
                progress: Math.round(((ti) / totalTools) * 100),
                label: 'Kelion lucreaza...',
                phase: 'working',
              });
              const res = await runTool(call.name, call.args);
              results.push({ name: call.name, response: res, id: call.id });
              _setTaskStatus({
                tool: 'work',
                file: null,
                progress: Math.round(((ti + 1) / totalTools) * 100),
                label: 'Kelion lucreaza...',
                phase: 'working',
              });
            }
            
            if (currentAbortSignal.aborted) break;

            _setTaskStatus({ tool: 'work', progress: 100, label: 'Kelion lucreaza...', phase: 'working' });
            toolResponses = results;
            currentMessage = undefined;
            currentImage = undefined;
            _setTaskStatus({ tool: 'work', progress: 30, label: 'Kelion lucreaza...', phase: 'thinking' });
            continue;
          }

          finalReply = data.reply || '';
          finalModel = data.model;
          break;
        }

        // Prevent empty bubbles
        if (finalReply) {
          _completeTask(`✅ Răspuns generat (${finalModel || 'AI'})`);
          appendTurn('assistant', finalReply, true, finalModel ? `🤖 ${finalModel}` : undefined)
        } else {
          _clearTaskStatus();
        }


        // Skip TTS if there is actually nothing to say
        if (playAudio && finalReply.trim() !== '') {
          clearAudioQueue()
          setStatus('speaking')
          _setTaskStatus({ tool: 'tts', progress: 10, label: '🔊 Generez vocea...', phase: 'working' });

          // Split full reply into sentences and enqueue them sequentially
          const sentences = finalReply.match(/[^.!?\n]+[.!?\n]+/g) || [finalReply];
          for (let si = 0; si < sentences.length; si++) {
            if (sentences[si].trim()) {
              _setTaskStatus({ tool: 'tts', progress: Math.round(((si + 1) / sentences.length) * 100), label: `🔊 TTS propoziția ${si + 1}/${sentences.length}`, phase: 'working' });
              await processTtsChunk(sentences[si].trim());
            }
          }
          _completeTask('🔊 Voce redată ✓');
        } else {
          setStatus(window.__restRecRef ? 'listening' : 'idle')
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          _clearTaskStatus();
          console.log('[kelionVoice] HTTP chat aborted by user stop command')
          return
        }
        _failTask(err?.message || 'Eroare de conexiune');
        console.error('[kelionVoice] HTTP chat fallback failed', err)
        appendTurn('assistant', 'Connection error. Please try again.', true)
        setStatus(window.__restRecRef ? 'listening' : 'idle')
      } finally {
        httpBusyRef.current = false
        // Drain any messages that were buffered while we were busy.
        if (httpMsgBufferRef.current.length > 0) {
          const next = httpMsgBufferRef.current.shift()
          setTimeout(() => sendText(next.clean, next.image, true), 50)
        }
      }
    }
  }, [appendTurn, audioRef])

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
    setMicEnabled,
    sendText,
    clearTurns,
    loadTurns,
  }
}

