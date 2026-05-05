// aiEventLog.js — Real-time AI diagnostics event logger.
// Tracks every AI interaction: which model responds, audio source,
// tool calls, transcriptions, and timing. Exposed globally as
// window.__kelionDiag so it can be inspected from browser DevTools
// or rendered in a debug panel.

const MAX_EVENTS = 500

const events = []
let listeners = []

export function logAiEvent(type, data = {}) {
  const entry = {
    id: events.length,
    ts: Date.now(),
    time: new Date().toISOString().slice(11, 23), // HH:mm:ss.SSS
    type,
    ...data,
  }
  events.push(entry)
  if (events.length > MAX_EVENTS) events.shift()
  for (const fn of listeners) {
    try { fn(entry, events) } catch (_) { /* never break caller */ }
  }
  // Also log to console with a distinctive prefix for quick DevTools filtering
  const label = `[AI-DIAG][${entry.time}]`
  const summary = (() => {
    switch (type) {
      case 'ws_open':        return `WebSocket opened → ${data.backend || '?'}`
      case 'ws_close':       return `WebSocket closed (${data.code}) ${data.reason || ''}`
      case 'setup_sent':     return `Setup frame sent → model: ${data.model || '?'}`
      case 'setup_complete': return `Session ready`
      case 'audio_out':      return `🔊 AI native audio chunk (${data.bytes || 0} bytes)`
      case 'audio_skipped':  return `🔇 Audio skipped (cloned voice active)`
      case 'clone_tts_req':  return `🎤 ElevenLabs TTS request: "${(data.text || '').slice(0, 60)}..."`
      case 'clone_tts_ok':   return `✅ ElevenLabs TTS played (${data.durationMs || 0}ms)`
      case 'clone_tts_err':  return `❌ ElevenLabs TTS failed: ${data.error || '?'}`
      case 'transcript_in':  return `👤 User: "${(data.text || '').slice(0, 80)}"`
      case 'transcript_out': return `🤖 Kelion: "${(data.text || '').slice(0, 80)}"`
      case 'tool_call':      return `🔧 Tool: ${data.name}(${JSON.stringify(data.args || {}).slice(0, 60)})`
      case 'tool_result':    return `📋 Result: ${(data.result || '').slice(0, 80)}`
      case 'voice_mode':     return `🎙️ Voice mode → ${data.mode}`
      case 'model_info':     return `📡 Model: ${data.model} | Backend: ${data.backend}`
      case 'turn_complete':  return `✓ Turn complete (hadTranscript: ${data.hadTranscript})`
      case 'greeting':       return `👋 GREETING detected: "${(data.text || '').slice(0, 80)}"`
      case 'status':         return `Status → ${data.status}`
      default:               return JSON.stringify(data).slice(0, 100)
    }
  })()
  // Suppress console output for high-frequency events that fire dozens of
  // times per second during active sessions. They're still captured in the
  // in-memory `events` array for __kelionDiag access from DevTools.
  const QUIET_TYPES = new Set(['audio_out', 'audio_skipped', 'status'])
  if (!QUIET_TYPES.has(type)) {
    console.log(`${label} ${summary}`)
  }
}

export function onAiEvent(fn) {
  listeners.push(fn)
  return () => { listeners = listeners.filter(f => f !== fn) }
}

export function getAiEvents() {
  return [...events]
}

export function clearAiEvents() {
  events.length = 0
}

// Expose globally for DevTools access
if (typeof window !== 'undefined') {
  window.__kelionDiag = {
    events,
    getEvents: getAiEvents,
    clear: clearAiEvents,
    on: onAiEvent,
  }
}
