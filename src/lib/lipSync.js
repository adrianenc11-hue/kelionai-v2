import { useEffect, useRef, useState, useCallback } from 'react'
import { TUNING } from './tuning'

// Lip-sync driver. Listens to the audio element's MediaStream (the Gemini
// Live hook routes decoded PCM through a MediaStreamDestination and sets
// `audio.srcObject` to that stream), measures the voice-band energy, and
// returns a smoothed 0..1 mouth-open value.
//
// The old implementation took a raw low-band average and pushed it straight
// into state every frame. That looked jittery ("does not follow any rule")
// for three reasons:
//   1. No attack/release envelope — every FFT sample jumps the mouth.
//   2. Hard-coded gain `(avg - 30) / 120` — quiet voices never open the
//      mouth, loud voices stay pinned at 1.
//   3. Uniform bin weighting over 0–3.75 kHz — consonant sibilants compete
//      with vowel formants so the mouth opens during hissy frames too.
//
// This rewrite isolates the vowel-formant band (≈200–2000 Hz), normalises
// against a rolling peak so quiet voices still animate, and smooths with an
// asymmetric attack/release envelope (fast open, slow close) so the mouth
// reads as speech, not noise.

// Target formant region for vowels. F1 (open/close) and F2 (front/back) sit
// inside this range for every Kelion voice (Gemini Live "Kore", Charon,
// ElevenLabs). Bins outside this range still count but at half weight.
const SPEECH_LO_HZ = 100
const SPEECH_HI_HZ = 3500
const FORMANT_LO_HZ = 200
const FORMANT_HI_HZ = 2000

// Envelope shape. 60 fps => 16.7 ms per frame. ATTACK≈0.45 → 22 ms to
// reach 90% of target; RELEASE≈0.08 → 120 ms to decay to 10%. Feels like
// real speech: lips snap open on the vowel onset, close gradually.
// The actual attack/release/formant-weight/peak-decay values live in
// `TUNING` so the Leva debug panel can tweak them live without rebuild.

// Floor keeps the divisor strictly positive even when the stream is
// silent (e.g. between turns) — prevents NaN/∞ spikes on the first sample.
const PEAK_FLOOR = 8

export function useLipSync(audioRef) {
  const [mouthOpen, setMouthOpen] = useState(0)
  const ctxRef = useRef(null)
  const analyzerRef = useRef(null)
  const sourceRef = useRef(null)
  const animationRef = useRef(null)
  const lastStreamRef = useRef(null)
  const envelopeRef = useRef(0)
  const peakRef = useRef(PEAK_FLOOR)

  const startAnalyzing = useCallback((stream) => {
    if (!stream) return

    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') ctx.resume()

    if (sourceRef.current) {
      try { sourceRef.current.disconnect() } catch { /* ignore */ }
      sourceRef.current = null
    }

    const analyzer = ctx.createAnalyser()
    analyzer.fftSize = 1024                    // 4× the old resolution (≈23 Hz/bin at 24 kHz stream)
    analyzer.smoothingTimeConstant = 0.15      // a pinch of built-in smoothing before our envelope
    analyzerRef.current = analyzer

    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyzer)
    sourceRef.current = source
    lastStreamRef.current = stream

    // Bin planning based on this context's sample rate (NOT the stream's —
    // Web Audio resamples on import, and the analyser reads post-resample).
    const binHz = ctx.sampleRate / analyzer.fftSize
    const loBin = Math.max(1, Math.floor(SPEECH_LO_HZ / binHz))
    const hiBin = Math.min(analyzer.frequencyBinCount - 1, Math.ceil(SPEECH_HI_HZ / binHz))
    const data = new Uint8Array(analyzer.frequencyBinCount)

    const update = () => {
      if (!analyzerRef.current) return
      analyzerRef.current.getByteFrequencyData(data)

      // Weighted voice-band average. Formant region gets a multiplier
      // (TUNING.lipFormantWeight, default 1.5×) so vowel formants
      // dominate over sibilant / fricative energy. The rest of the
      // speech band stays at 1× so bass fundamentals and upper formants
      // still contribute.
      const formantW = TUNING.lipFormantWeight
      let sum = 0
      let weight = 0
      for (let i = loBin; i <= hiBin; i++) {
        const hz = i * binHz
        const w = hz >= FORMANT_LO_HZ && hz <= FORMANT_HI_HZ ? formantW : 1
        sum += data[i] * w
        weight += w
      }
      const avg = weight > 0 ? sum / weight : 0  // 0..255

      // Auto-gain: rolling peak, slow decay. Divide current sample by it to
      // get 0..1 range that adapts to the speaker's actual level.
      peakRef.current = Math.max(peakRef.current * TUNING.lipPeakDecay, avg, PEAK_FLOOR)
      const raw = Math.min(1, avg / peakRef.current)

      // Asymmetric envelope: fast attack (mouth snaps open on vowel onset),
      // slow release (closes gradually, like a real jaw).
      const prev = envelopeRef.current
      const k = raw > prev ? TUNING.lipAttack : TUNING.lipRelease
      const env = prev + (raw - prev) * k
      envelopeRef.current = env

      setMouthOpen(env)
      animationRef.current = requestAnimationFrame(update)
    }
    update()
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // MediaStream attachment is not an event — poll the audio element's
    // srcObject. 80 ms is tight enough that the first audible chunk of a
    // Gemini turn gets the analyser attached before the vowel onset, so
    // the mouth starts opening on the first word instead of ~0.5 s late.
    const tryAttach = () => {
      const stream = audio.srcObject
      if (stream && stream !== lastStreamRef.current) {
        startAnalyzing(stream)
      }
    }

    tryAttach()

    const onPlay = () => {
      const ctx = ctxRef.current
      if (ctx && ctx.state === 'suspended') ctx.resume()
      tryAttach()
    }
    const onReset = () => {
      envelopeRef.current = 0
      setMouthOpen(0)
    }

    audio.addEventListener('play', onPlay)
    audio.addEventListener('loadedmetadata', tryAttach)
    audio.addEventListener('pause', onReset)
    audio.addEventListener('ended', onReset)
    const interval = setInterval(tryAttach, 80)

    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('loadedmetadata', tryAttach)
      audio.removeEventListener('pause', onReset)
      audio.removeEventListener('ended', onReset)
      clearInterval(interval)
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
  }, [audioRef, startAnalyzing])

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
      if (sourceRef.current) {
        try { sourceRef.current.disconnect() } catch { /* ignore */ }
        sourceRef.current = null
      }
      if (ctxRef.current && ctxRef.current.state !== 'closed') {
        try { ctxRef.current.close() } catch { /* ignore */ }
      }
    }
  }, [])

  return mouthOpen
}
