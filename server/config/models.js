// ═══════════════════════════════════════════════════════════════
// KelionAI — Centralized Model Configuration
// ALL model names, API endpoints, and defaults in ONE place.
// No hardcoding in routes — import from here.
// ═══════════════════════════════════════════════════════════════
"use strict";

const MODELS = {
    // ── LLM ──
    GROQ_PRIMARY: "llama-3.3-70b-versatile",
    OPENAI_CHAT: "gpt-5.4",
    OPENAI_FALLBACK: "gpt-4o",
    OPENAI_VISION: "gpt-5.4",
    GEMINI_CHAT: "gemini-3.1-flash",
    GEMINI_VISION: "gemini-3.1-flash",
    DEEPSEEK: "deepseek-chat",

    // ── STT ──
    WHISPER: "whisper-large-v3-turbo",
    OPENAI_WHISPER: "whisper-1",
    DEEPGRAM_STT: "nova-3",

    // ── TTS ──
    ELEVENLABS_MODEL: "eleven_v3",
    ELEVENLABS_FLASH: "eleven_v3_conversational",
    CARTESIA_MODEL: "sonic-2",
    OPENAI_TTS: "tts-1-hd",

    // ── Image Generation ──
    FLUX: "black-forest-labs/FLUX.1-schnell",
    DALL_E: "dall-e-3",

    // ── Search ──
    PERPLEXITY: "sonar-pro",
};

const PERSONAS = {
    kelion: "You are Kelion, a smart and professional AI assistant created by Adrian. Respond clearly and helpfully.",
    kira: "You are Kira, a creative and empathic AI assistant. Respond naturally and warmly.",
};

const VOICE_DEFAULTS = {
    stability: 0.5,
    similarity_boost: 0.75,
    style: 0.5,
};

const VOICE_EMOTIONS = {
    happy: { stability: 0.4, similarity_boost: 0.8, style: 0.7 },
    sad: { stability: 0.7, similarity_boost: 0.9, style: 0.3 },
    laughing: { stability: 0.3, similarity_boost: 0.7, style: 0.9 },
    thinking: { stability: 0.6, similarity_boost: 0.8, style: 0.4 },
    excited: { stability: 0.3, similarity_boost: 0.8, style: 0.8 },
    concerned: { stability: 0.7, similarity_boost: 0.9, style: 0.4 },
    neutral: { stability: 0.5, similarity_boost: 0.75, style: 0.5 },
    angry: { stability: 0.3, similarity_boost: 0.9, style: 0.8 },
    surprised: { stability: 0.35, similarity_boost: 0.8, style: 0.7 },
    curious: { stability: 0.45, similarity_boost: 0.8, style: 0.6 },
    loving: { stability: 0.5, similarity_boost: 0.9, style: 0.6 },
};

module.exports = { MODELS, PERSONAS, VOICE_DEFAULTS, VOICE_EMOTIONS };
