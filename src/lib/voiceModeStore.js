// voiceModeStore.js — tracks whether Kelion uses ElevenLabs cloned voice or Claude Opus native.
// The language code (e.g. "ro", "en", "fr") is tracked so ElevenLabs TTS respects
// the same language Claude Opus is speaking in.

let mode = 'default' // 'default' | 'cloned'
let detectedLang = 'ro' // BCP-47 primary subtag from conversation

export function getVoiceMode() { return mode }
export function isClonedVoiceActive() { return mode === 'cloned' }

export function setVoiceMode(newMode) {
  if (newMode === 'cloned' || newMode === 'default') mode = newMode
  return mode
}

export function setDetectedLang(lang) {
  if (lang && typeof lang === 'string') detectedLang = lang.split('-')[0].toLowerCase()
}

export function getDetectedLang() { return detectedLang }

// ── Selected voice from voice picker UI ──
let selectedVoice = null // { voiceId, voiceName, lang } or null (auto)

export function getSelectedVoice() { return selectedVoice }
export function setSelectedVoice(voice) {
  selectedVoice = voice // { voiceId, voiceName, lang } or null
}
