// ═══════════════════════════════════════════════════════════════
// KelionAI — ElevenLabs Voice Configuration
// Centralizes voice IDs for all TTS consumers (web, WhatsApp, etc.)
// ═══════════════════════════════════════════════════════════════
'use strict';

/**
 * ElevenLabs voice IDs per avatar persona.
 * Values are read from environment variables first, with hardcoded fallbacks
 * so the app can function without explicit env config.
 */
const VOICES = {
    kelion: process.env.ELEVENLABS_VOICE_KELION || 'VR6AewLTigWG4xSOukaG',
    kira: process.env.ELEVENLABS_VOICE_KIRA || 'EXAVITQu4vr4xnSDxMaL'
};

/**
 * Returns the ElevenLabs voice ID for the given avatar name.
 * Defaults to the Kelion voice for any unknown avatar.
 * @param {string} avatar - 'kelion' | 'kira'
 * @returns {string} ElevenLabs voice ID
 */
function getVoiceId(avatar) {
    return VOICES[(avatar || '').toLowerCase()] || VOICES.kelion;
}

module.exports = { VOICES, getVoiceId };
