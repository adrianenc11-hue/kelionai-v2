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
  GEMINI_CHAT: "gemini-2.0-flash",
  GEMINI_VISION: "gemini-2.0-flash",
  GEMINI_PRO: "gemini-2.0-flash",
  GEMINI_MULTIMODAL: "gemini-2.0-flash",
  DEEPSEEK: "deepseek-chat",
  OPENAI_TOOLS: "gpt-5.4",
  GEMINI_QA: "gemini-2.0-flash",
  GPT_REALTIME: "gpt-4o-realtime-preview", // Voice-First: audio→audio

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

// ── Centralized API Endpoints — NO hardcoding in routes ──
const API_ENDPOINTS = {
  OPENAI: "https://api.openai.com/v1",
  GROQ: "https://api.groq.com/openai/v1",
  DEEPSEEK: "https://api.deepseek.com/v1",
  GEMINI: "https://generativelanguage.googleapis.com/v1beta",
  ELEVENLABS: "https://api.elevenlabs.io/v1",
  PERPLEXITY: "https://api.perplexity.ai",
  TAVILY: "https://api.tavily.com",
  SERPER: "https://google.serper.dev",
  GRAPH_API: "https://graph.facebook.com/v21.0",
  NVIDIA_A2F: "https://grpc.nvcf.nvidia.com/nvidia/audio2face",
  OPEN_METEO: "https://api.open-meteo.com/v1",
  OPEN_METEO_GEO: "https://geocoding-api.open-meteo.com/v1",
  IP_API: "http://ip-api.com/json",
  MEDIASTACK: "http://api.mediastack.com/v1",
  CRYPTOPANIC: "https://cryptopanic.com/api/free/v1",
  BINANCE_FUTURES: "https://fapi.binance.com",
  YAHOO_FINANCE: "https://query1.finance.yahoo.com/v8/finance",
  COINGECKO: "https://api.coingecko.com/api/v3",
  FEAR_GREED: "https://api.alternative.me/fng",
  BLOCKCHAIN_INFO: "https://blockchain.info",
  TELEGRAM: "https://api.telegram.org",
  TOGETHER: "https://api.together.xyz/v1",
};

const PERSONAS = {
  kelion:
    "You are Kelion, a smart and professional AI assistant created by Adrian. Respond clearly and helpfully.",
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

module.exports = { MODELS, API_ENDPOINTS, PERSONAS, VOICE_DEFAULTS, VOICE_EMOTIONS };
