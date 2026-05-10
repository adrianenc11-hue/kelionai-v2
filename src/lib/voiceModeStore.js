// voiceModeStore.js — tracks whether Kelion uses ElevenLabs cloned voice or Gemini native.
// The language code (e.g. "ro", "en", "fr") is tracked so ElevenLabs TTS respects
// the same language Gemini is speaking in.

let mode = 'default'; // 'default' | 'cloned'
try {
  const savedMode = localStorage.getItem('kelion_voice_mode');
  if (savedMode === 'cloned' || savedMode === 'default') mode = savedMode;
} catch (e) {}

let detectedLang = 'ro'; // BCP-47 primary subtag from conversation

export function getVoiceMode() { return mode }
export function isClonedVoiceActive() { return mode === 'cloned' }

export function setVoiceMode(newMode) {
  if (newMode === 'cloned' || newMode === 'default') {
    mode = newMode;
    try { localStorage.setItem('kelion_voice_mode', mode); } catch (e) {}
  }
  return mode
}

export function setDetectedLang(lang) {
  if (lang && typeof lang === 'string') detectedLang = lang.split('-')[0].toLowerCase()
}

export function getDetectedLang() { return detectedLang }

// 🎙️ Selected voice from voice picker UI 🎙️
let selectedVoice = null;
try {
  const saved = localStorage.getItem('kelion_selected_voice');
  if (saved) selectedVoice = JSON.parse(saved);
} catch (e) {}

export function getSelectedVoice() { return selectedVoice }
export function setSelectedVoice(voice) {
  selectedVoice = voice; // { voiceId, voiceName, lang } or null
  try {
    if (voice) {
      localStorage.setItem('kelion_selected_voice', JSON.stringify(voice));
    } else {
      localStorage.removeItem('kelion_selected_voice');
    }
  } catch (e) {}
}
