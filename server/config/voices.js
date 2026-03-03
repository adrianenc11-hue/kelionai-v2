// ═══════════════════════════════════════════════════════════════
// KelionAI — ElevenLabs Voice Configuration (Multi-Language)
// Native voices per language — best-rated from ElevenLabs Voice Library
// ═══════════════════════════════════════════════════════════════
'use strict';

/**
 * ElevenLabs voice IDs per avatar + language.
 * Each language has a native male (kelion) and female (kira) voice.
 * Voices selected by highest usage/ratings on ElevenLabs Voice Library.
 * 
 * Environment variables override:
 *   ELEVENLABS_VOICE_KELION_RO, ELEVENLABS_VOICE_KIRA_RO, etc.
 *   ELEVENLABS_VOICE_KELION, ELEVENLABS_VOICE_KIRA (legacy fallback)
 */
const VOICES = {
    // ─── Romanian (native) ───────────────────────────────────
    ro: {
        kelion: process.env.ELEVENLABS_VOICE_KELION_RO || 'am5XuPVtut7uKJQKMja2',  // Mike L — Soft, Clear and Charming (7.8K uses)
        kira: process.env.ELEVENLABS_VOICE_KIRA_RO || '3z9q8Y7plHbvhDZehEII'   // Antonia — Mellow, Warm and Cute (12.3K uses)
    },
    // ─── English (native) ────────────────────────────────────
    en: {
        kelion: process.env.ELEVENLABS_VOICE_KELION_EN || 'nPczCjzI2devNBz1zQrb',  // Brian — Deep, warm narration (premade, top popular)
        kira: process.env.ELEVENLABS_VOICE_KIRA_EN || 'cgSgspJ2msm6clMCkdEU'   // Jessica — Young, playful, expressive (premade, top popular)
    },
    // ─── Spanish (native) ────────────────────────────────────
    es: {
        kelion: process.env.ELEVENLABS_VOICE_KELION_ES || 'PBaBRSRTvwmnK1PAq9e0',  // JeiJo — Castilian accent, middle-aged
        kira: process.env.ELEVENLABS_VOICE_KIRA_ES || 'XB0fDUnXU5powFXDhCwa'   // Charlotte — Seductive, professional
    },
    // ─── French (native) ─────────────────────────────────────
    fr: {
        kelion: process.env.ELEVENLABS_VOICE_KELION_FR || '1EmYoP3UnnnwhlJKovEy',  // Anthony — Frank, energetic, engaging (~40yo)
        kira: process.env.ELEVENLABS_VOICE_KIRA_FR || 'glDtoWIoIgk38YbycCwG'   // Clara Dupont — Warm, professional female
    },
    // ─── German (native) ─────────────────────────────────────
    de: {
        kelion: process.env.ELEVENLABS_VOICE_KELION_DE || 'aduJlSmEKqbhRQAAMzV2',  // Adrian — Deep, convincing, trustworthy TV voice
        kira: process.env.ELEVENLABS_VOICE_KIRA_DE || 'E0OS48T5F0KU7O2NInWS'   // Lucy Fennek — Professional audiobook narrator
    },
    // ─── Italian (native) ────────────────────────────────────
    it: {
        kelion: process.env.ELEVENLABS_VOICE_KELION_IT || 'slEjHpiFudesZaivDTNt',  // Piero Italia — Confident, dynamic narrator
        kira: process.env.ELEVENLABS_VOICE_KIRA_IT || 'jlhiuC3oLEP3JDAx1ECk'   // Romans — Warm, convincing, fascinating
    },
    // ─── Portuguese (native) ─────────────────────────────────
    pt: {
        kelion: process.env.ELEVENLABS_VOICE_KELION_PT || '96cLX3dkyNUmTHwkNXeS',  // Thiago Realista — Middle-aged Brazilian male
        kira: process.env.ELEVENLABS_VOICE_KIRA_PT || 'CZD4BJ803C6T0alQxsR7'   // Andreia I — Confident, enthusiastic Brazilian female
    }
};

// Legacy fallback IDs (used if language not found)
const LEGACY_VOICES = {
    kelion: process.env.ELEVENLABS_VOICE_KELION || VOICES.ro.kelion,
    kira: process.env.ELEVENLABS_VOICE_KIRA || VOICES.ro.kira
};

/**
 * Returns the ElevenLabs voice ID for the given avatar and language.
 * Falls back: language-specific → Romanian → legacy env var
 * @param {string} avatar - 'kelion' | 'kira'
 * @param {string} [language='ro'] - ISO language code: 'ro', 'en', 'es', 'fr', 'de', 'it', 'pt'
 * @returns {string} ElevenLabs voice ID
 */
function getVoiceId(avatar, language) {
    const av = (avatar || 'kelion').toLowerCase();
    const lang = (language || 'ro').toLowerCase().split('-')[0]; // 'ro-RO' → 'ro'

    // Try language-specific voice first
    if (VOICES[lang] && VOICES[lang][av]) {
        return VOICES[lang][av];
    }

    // Fallback to Romanian (default language)
    if (VOICES.ro[av]) {
        return VOICES.ro[av];
    }

    // Legacy fallback
    return LEGACY_VOICES[av] || LEGACY_VOICES.kelion;
}

module.exports = { VOICES, LEGACY_VOICES, getVoiceId };
