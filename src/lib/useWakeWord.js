// useWakeWord — browser-side hotword listener for "Kelion".
//
// Adrian: "cind zic kelion se auto porneste butonul de chat"
//   → when the user says "Kelion" aloud the voice session should start
//     without a click, exactly as if they had tapped the stage.
//
// How it works:
//   * Uses the browser Web Speech API (`SpeechRecognition` /
//     `webkitSpeechRecognition`). Chrome / Edge / Android Chrome all
//     expose it. Safari / iOS coverage is partial; when the API is
//     unavailable the hook is a silent no-op and tap-to-talk keeps
//     working unchanged.
//   * Runs continuously in the background while `enabled` is true,
//     inspecting each interim transcript for a fuzzy match against a
//     small whitelist of phonetic variants ("kelion", "khelion",
//     "calion", …). Matching on interim results is important: on the
//     final result the user has usually already continued the sentence,
//     which would delay activation by 1–2 s.
//   * When a match lands we call `onDetect()` and stop the recogniser
//     so it releases the microphone — `useGeminiLive.start()` will then
//     open its own `getUserMedia` stream. The parent flips `enabled`
//     off (status leaves 'idle') so the effect below won't restart us
//     mid-session (which would race the live mic).
//   * `onend` auto-restarts the recogniser while `enabled` is still
//     true. Chrome cuts the session after ~60 s of silence and on some
//     errors; we transparently relaunch.
//
// Privacy note: the Web Speech API routes audio to the browser vendor
// (Google for Chrome) for transcription. We only listen for the wake
// word and never persist anything. The full conversation after the
// wake word runs through the normal Gemini Live path.
//
// Intentionally isolated from KelionStage / geminiLive — if this file
// breaks, delete the single `useWakeWord(...)` call in KelionStage.jsx
// and the existing tap-to-talk flow is untouched.

import { useEffect, useRef } from 'react'

// Accepted variants. Chrome's recogniser will often mis-transcribe
// "Kelion" as one of these on first utterance, especially when the
// ambient language is set to English. Keeping the list short avoids
// false triggers on unrelated speech.
const WAKE_WORDS = [
  'kelion',
  'khelion',
  'calion',
  'kelian',
  'kellion',
  'celion',
  'kellyon',
  'kelyon',
]

function matchesWakeWord(transcript) {
  const t = (transcript || '').toLowerCase()
  if (!t) return false
  return WAKE_WORDS.some((w) => t.includes(w))
}

export function useWakeWord({ enabled, onDetect }) {
  // Keep the latest onDetect in a ref so consumers can pass fresh
  // closures without tearing down the recogniser on every render.
  const onDetectRef = useRef(onDetect)
  onDetectRef.current = onDetect

  useEffect(() => {
    if (!enabled) return undefined
    if (typeof window === 'undefined') return undefined
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    // Silent no-op on unsupported browsers (Safari iOS, Firefox, older
    // WebViews). The user can still start the session with a tap.
    if (!SR) return undefined

    let rec = null
    let stopped = false
    let restartTimer = null

    const handleResult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const alt = ev.results[i][0]
        if (!alt) continue
        if (matchesWakeWord(alt.transcript)) {
          // Release the mic before the consumer opens its own stream.
          stopped = true
          try { rec && rec.stop() } catch (_) { /* already stopping */ }
          try { onDetectRef.current && onDetectRef.current() } catch (_) {
            // Never let a consumer exception kill the page.
          }
          return
        }
      }
    }

    const scheduleRestart = () => {
      if (stopped) return
      if (restartTimer) return
      // 400 ms backoff: Chrome sometimes throws InvalidStateError when
      // start() is called too quickly after the onend event.
      restartTimer = setTimeout(() => {
        restartTimer = null
        startRec()
      }, 400)
    }

    const startRec = () => {
      if (stopped) return
      try {
        rec = new SR()
        rec.continuous = true
        rec.interimResults = true
        // English transcription picks up "Kelion" reliably regardless
        // of the user's UI language, because the wake word is the same
        // phoneme sequence. We don't transcribe anything else here.
        rec.lang = 'en-US'
        rec.maxAlternatives = 3
        rec.onresult = handleResult
        rec.onend = () => { rec = null; scheduleRestart() }
        rec.onerror = (ev) => {
          // 'not-allowed' / 'service-not-allowed' → user denied mic or
          // browser policy blocks it. Stop permanently; retry would
          // just keep surfacing the same error popup.
          if (ev && (ev.error === 'not-allowed' || ev.error === 'service-not-allowed')) {
            stopped = true
          }
        }
        rec.start()
      } catch (_err) {
        // Most common case: .start() while a previous instance is still
        // in 'starting' state. The onend/scheduleRestart loop recovers.
        scheduleRestart()
      }
    }

    startRec()

    return () => {
      stopped = true
      if (restartTimer) { clearTimeout(restartTimer); restartTimer = null }
      if (rec) {
        try { rec.onresult = null; rec.onend = null; rec.onerror = null } catch (_) {}
        try { rec.stop() } catch (_) {}
        rec = null
      }
    }
  }, [enabled])
}
