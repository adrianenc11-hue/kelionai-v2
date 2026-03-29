// ═══════════════════════════════════════════════════════════════
// KelionAI — ElevenLabs Voice Configuration (All World Languages)
// Native voices per language — highest-rated from ElevenLabs Voice Library
// ═══════════════════════════════════════════════════════════════
'use strict';

/**
 * ElevenLabs voice IDs per avatar + language.
 * Each language has a native male (kelion) and female (kira) voice.
 * Selected by highest usage count / best reviews on ElevenLabs.
 *
 * Override with env vars: ELEVENLABS_VOICE_KELION_RO, ELEVENLABS_VOICE_KIRA_RO, etc.
 */
const VOICES = {
  // ─── Romanian ────────────────────────────────────────────
  ro: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_RO || 'am5XuPVtut7uKJQKMja2', // Mike L — Soft, Clear, Charming (7.8K uses)
    kira: process.env.ELEVENLABS_VOICE_KIRA_RO || '3z9q8Y7plHbvhDZehEII', // Antonia — Mellow, Warm, Cute (12.3K uses)
    k1: process.env.ELEVENLABS_VOICE_K1_RO || 'TX3LPaxmHKxFdv7VOQHJ', // Liam — Deep, Direct, Authoritative (used for K1 brain)
  },
  // ─── English ─────────────────────────────────────────────
  en: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_EN || 'nPczCjzI2devNBz1zQrb', // Brian — Deep, warm (premade, top popular)
    kira: process.env.ELEVENLABS_VOICE_KIRA_EN || 'cgSgspJ2msm6clMCkdEU', // Jessica — Young, playful (premade, top popular)
  },
  // ─── Spanish ─────────────────────────────────────────────
  es: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_ES || 'PBaBRSRTvwmnK1PAq9e0', // JeiJo — Castilian, middle-aged
    kira: process.env.ELEVENLABS_VOICE_KIRA_ES || 'XB0fDUnXU5powFXDhCwa', // Charlotte — Professional, seductive
  },
  // ─── French ──────────────────────────────────────────────
  fr: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_FR || '1EmYoP3UnnnwhlJKovEy', // Anthony — Frank, energetic (~40yo)
    kira: process.env.ELEVENLABS_VOICE_KIRA_FR || 'glDtoWIoIgk38YbycCwG', // Clara Dupont — Warm, professional
  },
  // ─── German ──────────────────────────────────────────────
  de: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_DE || 'aduJlSmEKqbhRQAAMzV2', // Adrian — Deep, trustworthy TV voice
    kira: process.env.ELEVENLABS_VOICE_KIRA_DE || 'E0OS48T5F0KU7O2NInWS', // Lucy Fennek — Audiobook narrator
  },
  // ─── Italian ─────────────────────────────────────────────
  it: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_IT || 'slEjHpiFudesZaivDTNt', // Piero Italia — Confident, dynamic
    kira: process.env.ELEVENLABS_VOICE_KIRA_IT || 'jlhiuC3oLEP3JDAx1ECk', // Romans — Warm, fascinating
  },
  // ─── Portuguese ──────────────────────────────────────────
  pt: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_PT || '96cLX3dkyNUmTHwkNXeS', // Thiago Realista — Brazilian male
    kira: process.env.ELEVENLABS_VOICE_KIRA_PT || 'CZD4BJ803C6T0alQxsR7', // Andreia I — Brazilian female
  },
  // ─── Russian ─────────────────────────────────────────────
  ru: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_RU || 'X0jd19oPQ0cVJcbpmAuX', // Amid Hasan — Clear, professional
    kira: process.env.ELEVENLABS_VOICE_KIRA_RU || '8M81RK3MD7u4DOJpu2G5', // Viktoriia — Clear, resonant, enthusiastic
  },
  // ─── Japanese ────────────────────────────────────────────
  ja: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_JA || 'bqpOyYNUu11tjjvRUbKn', // Yamato — 20-30s, versatile
    kira: process.env.ELEVENLABS_VOICE_KIRA_JA || 'RBnMinrYKeccY3vaUxlZ', // Sakura Suzuki — Young, podcasts
  },
  // ─── Chinese (Mandarin) ──────────────────────────────────
  zh: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_ZH || 'Ixmp8zKRajBp10jLtsrq', // Lazarus Liew — Warm, neutral Mandarin
    kira: process.env.ELEVENLABS_VOICE_KIRA_ZH || 'FjfxJryh105iTLL4ktHB', // Liang — Youthful, calm, storytelling
  },
  // ─── Korean ──────────────────────────────────────────────
  ko: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_KO || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_KO || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Arabic ──────────────────────────────────────────────
  ar: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_AR || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_AR || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Hindi ───────────────────────────────────────────────
  hi: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_HI || 'nPczCjzI2devNBz1zQrb', // Premade Brian (multilingual v2 supports Hindi)
    kira: process.env.ELEVENLABS_VOICE_KIRA_HI || 'cgSgspJ2msm6clMCkdEU', // Premade Jessica (multilingual v2)
  },
  // ─── Turkish ─────────────────────────────────────────────
  tr: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_TR || 'PIruowkwLEfN2zUNymZm', // Ahmet Çiçek — Soft, pleasant
    kira: process.env.ELEVENLABS_VOICE_KIRA_TR || 'NsFK0aDGLbVusA7tQfOB', // Irem — Young, storytelling
  },
  // ─── Polish ──────────────────────────────────────────────
  pl: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_PL || 'C1DBnkwmDIzoLOPlBvSg', // Ignacius — Positive, marketing
    kira: process.env.ELEVENLABS_VOICE_KIRA_PL || 'NacdHGUYR1k3M0FAbAia', // Hanna — Calm, soothing, professional
  },
  // ─── Dutch ───────────────────────────────────────────────
  nl: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_NL || 'XSQQLeoHwWnBv8tjJ1T7', // Eric — Young, no accent, entertainment
    kira: process.env.ELEVENLABS_VOICE_KIRA_NL || 'gC9jy9VUxaXAswovchvQ', // Laura Peeters — Calm, enthusiastic
  },
  // ─── Swedish ─────────────────────────────────────────────
  sv: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_SV || 'ZMs9a3j1SLzirC7aygJQ', // Kim — Svenska Swedish male
    kira: process.env.ELEVENLABS_VOICE_KIRA_SV || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Norwegian ───────────────────────────────────────────
  no: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_NO || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_NO || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Danish ──────────────────────────────────────────────
  da: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_DA || 'V34B5u5UbLdNJVEkcgXp', // Noam — Young, energetic
    kira: process.env.ELEVENLABS_VOICE_KIRA_DA || '4RklGmuxoAskAbGXplXN', // Camilla — Light, clear, professional
  },
  // ─── Finnish ─────────────────────────────────────────────
  fi: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_FI || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_FI || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Czech ───────────────────────────────────────────────
  cs: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_CS || 'uYFJyGaibp4N2VwYQshk', // Adam — Velvety, conversational
    kira: process.env.ELEVENLABS_VOICE_KIRA_CS || 'OAAjJsQDvpg3sVjiLgyl', // Denisa — Soft, balanced, tender
  },
  // ─── Slovak ──────────────────────────────────────────────
  sk: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_SK || 'uYFJyGaibp4N2VwYQshk', // Czech Adam (very close languages)
    kira: process.env.ELEVENLABS_VOICE_KIRA_SK || 'OAAjJsQDvpg3sVjiLgyl', // Czech Denisa (very close languages)
  },
  // ─── Hungarian ───────────────────────────────────────────
  hu: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_HU || '3DRcczmb3qwp5aVD9M9E', // Attila — Calm Hungarian male
    kira: process.env.ELEVENLABS_VOICE_KIRA_HU || 'Dme3o25EiC1DfrBQd73f', // Aggie — Professional, young female
  },
  // ─── Croatian ────────────────────────────────────────────
  hr: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_HR || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_HR || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Bulgarian ───────────────────────────────────────────
  bg: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_BG || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_BG || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Greek ───────────────────────────────────────────────
  el: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_EL || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_EL || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Hebrew ──────────────────────────────────────────────
  he: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_HE || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_HE || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Ukrainian ───────────────────────────────────────────
  uk: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_UK || 'X0jd19oPQ0cVJcbpmAuX', // Russian Amid (close language)
    kira: process.env.ELEVENLABS_VOICE_KIRA_UK || '8M81RK3MD7u4DOJpu2G5', // Russian Viktoriia (close language)
  },
  // ─── Vietnamese ──────────────────────────────────────────
  vi: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_VI || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_VI || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Thai ────────────────────────────────────────────────
  th: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_TH || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_TH || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Indonesian ──────────────────────────────────────────
  id: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_ID || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_ID || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Malay ───────────────────────────────────────────────
  ms: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_MS || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_MS || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
  // ─── Swahili ─────────────────────────────────────────────
  sw: {
    kelion: process.env.ELEVENLABS_VOICE_KELION_SW || 'nPczCjzI2devNBz1zQrb', // Brian fallback (multilingual)
    kira: process.env.ELEVENLABS_VOICE_KIRA_SW || 'cgSgspJ2msm6clMCkdEU', // Jessica fallback (multilingual)
  },
};

// Legacy fallback IDs (used if language not found at all)
const LEGACY_VOICES = {
  kelion: process.env.ELEVENLABS_VOICE_KELION || VOICES.ro.kelion,
  kira: process.env.ELEVENLABS_VOICE_KIRA || VOICES.ro.kira,
};

/**
 * Returns the ElevenLabs voice ID for the given avatar and language.
 * Falls back: language-specific → Romanian → legacy env var
 * @param {string} avatar - 'kelion' | 'kira'
 * @param {string} [language='ro'] - ISO language code: 'ro', 'en', 'es', etc.
 * @returns {string} ElevenLabs voice ID
 */
function getVoiceId(avatar, language) {
  const av = (avatar || 'kelion').toLowerCase();
  const lang = (language || 'ro').toLowerCase().split('-')[0]; // 'ro-RO' → 'ro'

  // Try language-specific voice first
  if (VOICES[lang] && VOICES[lang][av]) {
    return VOICES[lang][av];
  }

  // Fallback to Romanian (default)
  if (VOICES.ro[av]) {
    return VOICES.ro[av];
  }

  // Legacy fallback
  return LEGACY_VOICES[av] || LEGACY_VOICES.kelion;
}

module.exports = { VOICES, LEGACY_VOICES, getVoiceId };
