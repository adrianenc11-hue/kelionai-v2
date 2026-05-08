/**
 * audioProcessor.js — Advanced noise suppression + transcript analyzer
 *
 * 1. NOISE SUPPRESSION: Uses Web Audio API with:
 *    - High-pass filter (removes low-frequency rumble < 85Hz)
 *    - Low-pass filter (removes high-frequency hiss > 8kHz)
 *    - Dynamic compressor (normalizes voice volume)
 *    - Noise gate (silences audio below threshold to kill ambient noise)
 *
 * 2. TRANSCRIPT ANALYZER: Cleans up SpeechRecognition output before
 *    sending to Kelion — fixes common transcription errors, removes
 *    filler words, normalizes punctuation, and handles multilingual input.
 *
 * Adrian 2026-05-08: "trebuie sa aplice scriptul creat de el sa scoata
 * zgomotul total si sa lase vocea, trebuie sa aibe un analizor in
 * aplicatie care vede ce spui in orice limba si corecteaza inainte
 * sa-l dea lui kelion"
 */

// ─────────────────────────────────────────────────────────────────────
// 1. NOISE SUPPRESSION — Web Audio API pipeline
// ─────────────────────────────────────────────────────────────────────

let noiseGateCtx = null
let noiseGateProcessor = null
let noiseGateEnabled = true

// Noise gate parameters — tuned for voice in noisy environments
const NOISE_GATE_THRESHOLD = -45   // dB — below this = silence
const NOISE_GATE_ATTACK = 0.003    // seconds — how fast gate opens
const NOISE_GATE_RELEASE = 0.25    // seconds — how fast gate closes
const NOISE_GATE_HOLD = 0.1        // seconds — minimum open time

/**
 * Create a noise-suppressed audio stream from a raw mic MediaStream.
 * Returns a new MediaStream that only contains clean voice audio.
 *
 * The pipeline:
 *   mic → highPass(85Hz) → lowPass(8kHz) → noiseGate → compressor → output
 *
 * @param {MediaStream} rawStream - The raw getUserMedia stream
 * @returns {{ cleanStream: MediaStream, ctx: AudioContext, cleanup: Function }}
 */
export function createNoiseSuppressedStream(rawStream) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)({
    sampleRate: 16000,
  })
  noiseGateCtx = ctx

  const source = ctx.createMediaStreamSource(rawStream)

  // Stage 1: High-pass filter — removes low-frequency rumble, AC hum,
  // traffic noise, HVAC drone. Cutoff at 85Hz preserves the fundamental
  // of the deepest male voices (85-180Hz) while killing everything below.
  const highPass = ctx.createBiquadFilter()
  highPass.type = 'highpass'
  highPass.frequency.value = 85
  highPass.Q.value = 0.7

  // Stage 2: Low-pass filter — removes high-frequency hiss, keyboard
  // clicks, mouse clicks, paper rustling. 8kHz is well above the
  // speech intelligibility band (300-3400Hz) so voice quality stays.
  const lowPass = ctx.createBiquadFilter()
  lowPass.type = 'lowpass'
  lowPass.frequency.value = 8000
  lowPass.Q.value = 0.7

  // Stage 3: Notch filter at 50/60Hz — kills AC power hum that
  // gets through cheap USB mics.
  const notch50 = ctx.createBiquadFilter()
  notch50.type = 'notch'
  notch50.frequency.value = 50
  notch50.Q.value = 10

  const notch60 = ctx.createBiquadFilter()
  notch60.type = 'notch'
  notch60.frequency.value = 60
  notch60.Q.value = 10

  // Stage 4: Dynamic compressor — normalizes volume so whispers and
  // shouts come through at similar levels. This helps SpeechRecognition
  // accuracy significantly.
  const compressor = ctx.createDynamicsCompressor()
  compressor.threshold.value = -24
  compressor.knee.value = 12
  compressor.ratio.value = 4
  compressor.attack.value = 0.003
  compressor.release.value = 0.25

  // Stage 5: Gain node for the noise gate
  const gateGain = ctx.createGain()
  gateGain.gain.value = 1.0

  // Output destination
  const dest = ctx.createMediaStreamDestination()

  // Wire the pipeline
  source.connect(highPass)
  highPass.connect(lowPass)
  lowPass.connect(notch50)
  notch50.connect(notch60)
  notch60.connect(gateGain)
  gateGain.connect(compressor)
  compressor.connect(dest)

  // Noise gate via AnalyserNode — monitors RMS level and controls
  // the gate gain node. Runs on requestAnimationFrame for low overhead.
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  analyser.smoothingTimeConstant = 0.3
  source.connect(analyser) // tap the raw source for level monitoring

  const dataArray = new Float32Array(analyser.fftSize)
  let gateOpen = false
  let holdTimer = 0
  let rafId = null

  function processNoiseGate() {
    if (!noiseGateEnabled || ctx.state === 'closed') return

    analyser.getFloatTimeDomainData(dataArray)

    // Calculate RMS in dB
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i]
    }
    const rms = Math.sqrt(sum / dataArray.length)
    const dB = rms > 0 ? 20 * Math.log10(rms) : -100

    const now = ctx.currentTime

    if (dB > NOISE_GATE_THRESHOLD) {
      // Signal is above threshold — open gate
      if (!gateOpen) {
        gateGain.gain.linearRampToValueAtTime(1.0, now + NOISE_GATE_ATTACK)
        gateOpen = true
      }
      holdTimer = now + NOISE_GATE_HOLD
    } else if (gateOpen && now > holdTimer) {
      // Signal fell below threshold and hold time expired — close gate
      gateGain.gain.linearRampToValueAtTime(0.0, now + NOISE_GATE_RELEASE)
      gateOpen = false
    }

    rafId = requestAnimationFrame(processNoiseGate)
  }

  // Start the noise gate
  processNoiseGate()

  // Store processor reference for cleanup
  noiseGateProcessor = { ctx, analyser, gateGain, rafId }

  const cleanup = () => {
    if (rafId) cancelAnimationFrame(rafId)
    try { source.disconnect() } catch (_) {}
    try { highPass.disconnect() } catch (_) {}
    try { lowPass.disconnect() } catch (_) {}
    try { notch50.disconnect() } catch (_) {}
    try { notch60.disconnect() } catch (_) {}
    try { gateGain.disconnect() } catch (_) {}
    try { compressor.disconnect() } catch (_) {}
    try { analyser.disconnect() } catch (_) {}
    if (ctx.state !== 'closed') {
      try { ctx.close() } catch (_) {}
    }
    noiseGateCtx = null
    noiseGateProcessor = null
  }

  return {
    cleanStream: dest.stream,
    ctx,
    cleanup,
  }
}

/**
 * Toggle noise suppression on/off at runtime.
 */
export function setNoiseSuppression(enabled) {
  noiseGateEnabled = enabled
  if (noiseGateProcessor && noiseGateProcessor.gateGain) {
    if (!enabled) {
      // Bypass — set gate to fully open
      noiseGateProcessor.gateGain.gain.value = 1.0
    }
  }
  console.log(`[audioProcessor] noise suppression: ${enabled ? 'ON' : 'OFF'}`)
}

export function isNoiseSuppressionEnabled() {
  return noiseGateEnabled
}


// ─────────────────────────────────────────────────────────────────────
// 2. TRANSCRIPT ANALYZER — cleans and corrects speech-to-text output
// ─────────────────────────────────────────────────────────────────────

// Common SpeechRecognition errors by language
const CORRECTIONS = {
  // Romanian common misrecognitions
  ro: [
    [/\bporneste\b/gi, 'pornește'],
    [/\bopreste\b/gi, 'oprește'],
    [/\bkelion\s*ai\b/gi, 'Kelion'],
    [/\bkelion ey\b/gi, 'Kelion'],
    [/\bkel ion\b/gi, 'Kelion'],
    [/\bkelion a i\b/gi, 'Kelion AI'],
    [/\bintelepciune\b/gi, 'înțelepciune'],
    [/\bhaidauti\b/gi, 'haiduți'],
    [/\bfata\b/gi, 'față'],
    [/\btara\b/gi, 'țară'],
    [/\btaran\b/gi, 'țăran'],
    [/\bstiinta\b/gi, 'știință'],
    [/\bstiu\b/gi, 'știu'],
    [/\bce faci\s*\?\s*$/gi, 'Ce faci?'],
  ],
  // English common misrecognitions
  en: [
    [/\bkelion\s*ai\b/gi, 'Kelion'],
    [/\bkel ion\b/gi, 'Kelion'],
    [/\bkelly on\b/gi, 'Kelion'],
    [/\bkillian\b/gi, 'Kelion'],
    [/\bkilleen\b/gi, 'Kelion'],
    [/\bgonna\b/gi, 'going to'],
    [/\bwanna\b/gi, 'want to'],
  ],
  // French
  fr: [
    [/\bkelion\s*ai\b/gi, 'Kelion'],
    [/\bkel ion\b/gi, 'Kelion'],
  ],
  // Spanish
  es: [
    [/\bkelion\s*ai\b/gi, 'Kelion'],
  ],
  // German
  de: [
    [/\bkelion\s*ai\b/gi, 'Kelion'],
  ],
  // Italian
  it: [
    [/\bkelion\s*ai\b/gi, 'Kelion'],
  ],
}

// Universal filler words/sounds to strip (language-agnostic)
const FILLER_PATTERNS = [
  /^\s*(um+|uh+|hmm+|eh+|ah+|eee+|aaa+|ooo+)\s*$/gi,  // standalone fillers = skip entirely
  /\b(um+|uh+)\b\s*/gi,  // inline fillers = remove
]

// Detect language from text (simple heuristic, 2-char code)
function detectLang(text) {
  const lower = text.toLowerCase()
  // Romanian markers
  if (/[ăîâșț]/.test(lower)) return 'ro'
  if (/\b(și|este|pentru|unde|cum|bine|salut|bună|dar|sau|nu)\b/.test(lower)) return 'ro'
  // French markers
  if (/\b(je|tu|nous|vous|est|sont|les|des|une|avec|pour|dans|que|qui)\b/.test(lower)) return 'fr'
  // Spanish markers
  if (/\b(yo|tú|es|son|los|las|una|con|para|que|en|del)\b/.test(lower)) return 'es'
  // German markers
  if (/\b(ich|du|ist|sind|die|das|ein|mit|für|und|nicht|haben)\b/.test(lower)) return 'de'
  // Italian markers
  if (/\b(io|tu|è|sono|il|la|un|con|per|che|non|come)\b/.test(lower)) return 'it'
  // Default to English
  return 'en'
}

/**
 * Analyze and correct a SpeechRecognition transcript before sending
 * to Kelion. Handles:
 * - Language detection
 * - Filler word removal
 * - Common misrecognition fixes
 * - Punctuation normalization
 * - Whitespace cleanup
 *
 * @param {string} rawTranscript - Raw SpeechRecognition output
 * @param {string} [langHint] - Optional language hint (2-char code)
 * @returns {{ text: string, lang: string, corrections: string[], original: string }}
 */
export function analyzeTranscript(rawTranscript, langHint = null) {
  const original = rawTranscript || ''
  let text = original.trim()
  const corrections = []

  if (!text) return { text: '', lang: langHint || 'en', corrections, original }

  // 1. Remove standalone filler-only utterances
  for (const pattern of FILLER_PATTERNS) {
    const before = text
    text = text.replace(pattern, '')
    if (text !== before) corrections.push('removed filler sounds')
  }
  text = text.trim()
  if (!text) return { text: '', lang: langHint || 'en', corrections: ['filler-only utterance skipped'], original }

  // 2. Detect language
  const lang = langHint || detectLang(text)

  // 3. Apply language-specific corrections
  const langRules = CORRECTIONS[lang] || []
  for (const [pattern, replacement] of langRules) {
    const before = text
    text = text.replace(pattern, replacement)
    if (text !== before) corrections.push(`corrected: ${pattern.source} → ${replacement}`)
  }

  // 4. Fix double spaces and trailing whitespace
  text = text.replace(/\s{2,}/g, ' ').trim()

  // 5. Capitalize first letter if missing
  if (text.length > 0 && text[0] === text[0].toLowerCase() && /^[a-zA-Zăîâșțéèêëàùûüïöäüßñ]/.test(text)) {
    text = text[0].toUpperCase() + text.slice(1)
    corrections.push('capitalized first letter')
  }

  // 6. Add period at end if no punctuation present and text is long enough
  if (text.length > 3 && !/[.!?…]$/.test(text)) {
    // Don't add period to questions
    if (/\b(ce|cum|unde|cine|când|cât|de ce|care|who|what|where|when|why|how|which|quoi|comment|où|qui|quand|was|wer|wo|wann|warum|wie|qué|quién|dónde|cuándo|por qué|cómo|cosa|chi|dove|quando|perché|come)\b/i.test(text)) {
      if (!/\?$/.test(text)) {
        text += '?'
        corrections.push('added question mark')
      }
    }
  }

  if (corrections.length > 0) {
    console.log(`[transcriptAnalyzer] ${lang}: "${original}" → "${text}" [${corrections.join(', ')}]`)
  }

  return { text, lang, corrections, original }
}

/**
 * Check if a transcript is worth sending (not just noise/filler).
 * @param {string} text - The analyzed transcript text
 * @returns {boolean}
 */
export function isValidUtterance(text) {
  if (!text || typeof text !== 'string') return false
  const clean = text.trim()
  if (clean.length < 1) return false
  // Skip if it's just punctuation
  if (/^[.!?,;:…]+$/.test(clean)) return false
  return true
}


// ─────────────────────────────────────────────────────────────────────
// 3. AUDIO OUTPUT RESILIENCE — auto-restart if audio element dies
// ─────────────────────────────────────────────────────────────────────

/**
 * Ensure an audio element is in a playable state. If it's in a broken
 * state (e.g. speaker was disabled and re-enabled), reset it.
 *
 * @param {HTMLAudioElement} audioEl - The audio element to check
 * @returns {boolean} true if the element is ready to play
 */
export function ensureAudioReady(audioEl) {
  if (!audioEl) return false

  // Check if the audio context is suspended (browser autoplay policy)
  // and resume it
  try {
    if (audioEl.error) {
      console.warn('[audioProcessor] audio element in error state, resetting:', audioEl.error.message)
      audioEl.src = ''
      audioEl.load()
      return true
    }
  } catch (_) {}

  return true
}

/**
 * Create a fresh AudioContext with speaker output guaranteed.
 * If the existing context is in a broken state, close it and create new.
 *
 * @param {AudioContext} existingCtx - The potentially broken context
 * @param {number} sampleRate - Desired sample rate
 * @returns {AudioContext}
 */
export function ensureAudioContext(existingCtx, sampleRate = 24000) {
  if (existingCtx) {
    if (existingCtx.state === 'running') return existingCtx
    if (existingCtx.state === 'suspended') {
      existingCtx.resume().catch(() => {})
      return existingCtx
    }
    // 'closed' — need a new one
    try { existingCtx.close() } catch (_) {}
  }

  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate })
  // Auto-resume on user interaction if browser suspends it
  const resumeOnInteraction = () => {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
  }
  document.addEventListener('click', resumeOnInteraction, { once: true })
  document.addEventListener('keydown', resumeOnInteraction, { once: true })

  return ctx
}
