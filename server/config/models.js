// ═══════════════════════════════════════════════════════════════
// KelionAI — Centralized Model & Endpoint Configuration
// ALL model names și API endpoints într-un singur loc.
// PERSONAS și APP constants → server/config/app.js
// ═══════════════════════════════════════════════════════════════
'use strict';

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const MODELS = {
  // ── BRAIN (Chat + Reasoning) ──
  BRAIN_PRIMARY:    process.env.MODEL_BRAIN_PRIMARY    || 'gpt-4.1',
  BRAIN_FALLBACK:   process.env.MODEL_BRAIN_FALLBACK   || 'gpt-4o',
  OPENAI_CHAT:      process.env.MODEL_OPENAI_CHAT      || 'gpt-4.1',
  OPENAI_FALLBACK:  process.env.MODEL_OPENAI_FALLBACK  || 'gpt-4o-mini',

  // ── VISION ──
  OPENAI_VISION:    process.env.MODEL_OPENAI_VISION    || 'gpt-4.1',
  VISION_FALLBACK:  process.env.MODEL_VISION_FALLBACK  || 'gpt-4o',
  GPT_VISION:       process.env.MODEL_GPT_VISION       || 'gpt-4o',

  // ── VOICE REALTIME ──
  GPT_REALTIME:     process.env.MODEL_GPT_REALTIME     || 'gpt-4o-realtime-preview-2024-12-17',
  OPENAI_AUDIO:     process.env.MODEL_OPENAI_AUDIO     || 'gpt-4o-audio-preview',

  // ── CLAUDE ──
  CLAUDE:           process.env.MODEL_CLAUDE           || 'claude-sonnet-4-5',
  CLAUDE_FAST:      process.env.MODEL_CLAUDE_FAST      || 'claude-haiku-3-5-20241022',

  // ── STT ──
  OPENAI_WHISPER:   process.env.MODEL_OPENAI_WHISPER   || 'whisper-1',
  WHISPER:          process.env.MODEL_WHISPER          || 'whisper-large-v3-turbo',
  DEEPGRAM_STT:     process.env.MODEL_DEEPGRAM_STT     || 'nova-3',

  // ── TTS ──
  ELEVENLABS_MODEL: process.env.MODEL_ELEVENLABS       || 'eleven_v3',
  ELEVENLABS_FLASH: process.env.MODEL_ELEVENLABS_FLASH || 'eleven_v3_conversational',
  OPENAI_TTS:       process.env.MODEL_OPENAI_TTS       || 'gpt-4o-mini-tts',

  // ── SEARCH / LLM ──
  PERPLEXITY:       process.env.MODEL_PERPLEXITY       || 'sonar-pro',
  GROQ_PRIMARY:     process.env.MODEL_GROQ_PRIMARY     || 'llama-3.3-70b-versatile',
  DEEPSEEK:         process.env.MODEL_DEEPSEEK         || 'deepseek-chat',

  // ── GEMINI ──
  GEMINI_CHAT:      process.env.MODEL_GEMINI_CHAT      || 'gemini-2.5-flash',
  GEMINI_VISION:    process.env.MODEL_GEMINI_VISION    || 'gemini-2.5-flash',
  GEMINI_PRO:       process.env.MODEL_GEMINI_PRO       || 'gemini-2.5-pro',

  // ── IMAGE GENERATION ──
  FLUX:             process.env.MODEL_FLUX             || 'black-forest-labs/FLUX.1-schnell',
  DALL_E:           process.env.MODEL_DALL_E           || 'dall-e-3',
};

// ── Centralized API Endpoints — env vars cu safe defaults ──
const API_ENDPOINTS = {
  OPENAI:           process.env.OPENAI_ENDPOINT           || 'https://api.openai.com/v1',
  OPENAI_REALTIME:  process.env.OPENAI_REALTIME_ENDPOINT  || 'wss://api.openai.com/v1/realtime',
  GROQ:             process.env.GROQ_ENDPOINT             || 'https://api.groq.com/openai/v1',
  DEEPSEEK:         process.env.DEEPSEEK_ENDPOINT         || 'https://api.deepseek.com/v1',
  GEMINI:           process.env.GEMINI_ENDPOINT           || 'https://generativelanguage.googleapis.com/v1beta',
  ELEVENLABS:       process.env.ELEVENLABS_ENDPOINT       || 'https://api.elevenlabs.io/v1',
  ELEVENLABS_WS:    process.env.ELEVENLABS_WS_ENDPOINT    || 'wss://api.elevenlabs.io/v1',
  PERPLEXITY:       process.env.PERPLEXITY_ENDPOINT       || 'https://api.perplexity.ai',
  TAVILY:           process.env.TAVILY_ENDPOINT           || 'https://api.tavily.com',
  SERPER:           process.env.SERPER_ENDPOINT           || 'https://google.serper.dev',
  GRAPH_API:        process.env.GRAPH_API_ENDPOINT        || 'https://graph.facebook.com/v18.0',
  NVIDIA_A2F:       process.env.NVIDIA_A2F_ENDPOINT       || '',
  OPEN_METEO:       process.env.OPEN_METEO_ENDPOINT       || 'https://api.open-meteo.com/v1',
  OPEN_METEO_GEO:   process.env.OPEN_METEO_GEO_ENDPOINT  || 'https://geocoding-api.open-meteo.com/v1',
  IP_API:           process.env.IP_API_ENDPOINT           || 'https://ipapi.co',
  MEDIASTACK:       process.env.MEDIASTACK_ENDPOINT       || 'http://api.mediastack.com/v1',
  CRYPTOPANIC:      process.env.CRYPTOPANIC_ENDPOINT      || 'https://cryptopanic.com/api/v1',
  YAHOO_FINANCE:    process.env.YAHOO_FINANCE_ENDPOINT    || 'https://query1.finance.yahoo.com/v8',
  COINGECKO:        process.env.COINGECKO_ENDPOINT        || 'https://api.coingecko.com/api/v3',
  FEAR_GREED:       process.env.FEAR_GREED_ENDPOINT       || 'https://api.alternative.me/fng',
  BLOCKCHAIN_INFO:  process.env.BLOCKCHAIN_ENDPOINT       || 'https://blockchain.info',
  TOGETHER:         process.env.TOGETHER_ENDPOINT         || 'https://api.together.xyz/v1',
  ANTHROPIC:        process.env.ANTHROPIC_ENDPOINT        || 'https://api.anthropic.com/v1',
  DUCKDUCKGO:       process.env.DUCKDUCKGO_ENDPOINT       || 'https://api.duckduckgo.com',
  DEEPGRAM:         process.env.DEEPGRAM_ENDPOINT         || 'https://api.deepgram.com/v1',
  CARTESIA:         process.env.CARTESIA_ENDPOINT         || 'https://api.cartesia.ai',
  GOOGLE_TTS:       process.env.GOOGLE_TTS_ENDPOINT       || 'https://texttospeech.googleapis.com/v1',
  COUNTRY_IS:       process.env.COUNTRY_IS_ENDPOINT       || 'https://api.country.is',
  GMAIL:            process.env.GMAIL_ENDPOINT            || '',
  OPENFOODFACTS:    process.env.OPENFOODFACTS_ENDPOINT    || '',
  YOUTUBE:          process.env.YOUTUBE_ENDPOINT          || '',
  GOOGLE_MAPS:      process.env.GOOGLE_MAPS_ENDPOINT      || '',
  OSM:              process.env.OSM_ENDPOINT              || '',
  NEWSDATA:         process.env.NEWSDATA_ENDPOINT         || '',
  GOOGLE_SEARCH:    process.env.GOOGLE_SEARCH_ENDPOINT    || '',
  POLLINATIONS:     process.env.POLLINATIONS_ENDPOINT     || '',
  YOUTUBE_NOCOOKIE: process.env.YOUTUBE_NOCOOKIE_ENDPOINT || '',
  GOOGLE_MAPS_FULL: process.env.GOOGLE_MAPS_FULL_ENDPOINT || '',
  OSM_EXPORT:       process.env.OSM_EXPORT_ENDPOINT       || '',
  RESEND:           process.env.RESEND_ENDPOINT           || '',
  SENDGRID:         process.env.SENDGRID_ENDPOINT         || '',
  GITHUB_API:       process.env.GITHUB_API_ENDPOINT       || '',
  GOOGLE_CALENDAR:  process.env.GOOGLE_CALENDAR_ENDPOINT  || '',
  GOOGLE_OAUTH:     process.env.GOOGLE_OAUTH_ENDPOINT     || '',
  SPOTIFY:          process.env.SPOTIFY_ENDPOINT          || '',
  GOOGLE_MAPS_DOMAIN: process.env.GOOGLE_MAPS_DOMAIN      || '',
  // CDN / Font / ML (folosite în CSP headers)
  CDN_JSDELIVR:       process.env.CDN_JSDELIVR            || '',
  CDN_SENTRY:         process.env.CDN_SENTRY              || '',
  GOOGLE_FONTS_CSS:   process.env.GOOGLE_FONTS_CSS        || '',
  GOOGLE_FONTS_STATIC: process.env.GOOGLE_FONTS_STATIC   || '',
  GOOGLE_STORAGE:     process.env.GOOGLE_STORAGE          || '',
  TFHUB:              process.env.TFHUB                   || '',
  KAGGLE:             process.env.KAGGLE                  || '',
};

// Provider dashboard/pricing URLs (display-only, pentru admin panel)
const PROVIDER_URLS = {
  OPENAI_BILLING:    process.env.OPENAI_BILLING_URL    || '',
  GOOGLE_AI_KEYS:    process.env.GOOGLE_AI_KEYS_URL    || '',
  GROQ_USAGE:        process.env.GROQ_USAGE_URL        || '',
  PERPLEXITY_API:    process.env.PERPLEXITY_API_URL    || '',
  TOGETHER_BILLING:  process.env.TOGETHER_BILLING_URL  || '',
  ELEVENLABS_SUB:    process.env.ELEVENLABS_SUB_URL    || '',
  DEEPSEEK_USAGE:    process.env.DEEPSEEK_USAGE_URL    || '',
  TAVILY_PRICING:    process.env.TAVILY_PRICING_URL    || '',
  SERPER_DASHBOARD:  process.env.SERPER_DASHBOARD_URL  || '',
};

// PERSONAS importate din app.js — fără hardcode aici
const { PERSONAS } = require('./app');

const VOICE_DEFAULTS = {
  stability:        envInt('VOICE_STABILITY',        50) / 100,
  similarity_boost: envInt('VOICE_SIMILARITY_BOOST', 75) / 100,
  style:            envInt('VOICE_STYLE',            50) / 100,
};

const VOICE_EMOTIONS = {
  happy:     { stability: 0.4,  similarity_boost: 0.8,  style: 0.7 },
  sad:       { stability: 0.7,  similarity_boost: 0.9,  style: 0.3 },
  laughing:  { stability: 0.3,  similarity_boost: 0.7,  style: 0.9 },
  thinking:  { stability: 0.6,  similarity_boost: 0.8,  style: 0.4 },
  excited:   { stability: 0.3,  similarity_boost: 0.8,  style: 0.8 },
  concerned: { stability: 0.7,  similarity_boost: 0.9,  style: 0.4 },
  neutral:   { stability: 0.5,  similarity_boost: 0.75, style: 0.5 },
  angry:     { stability: 0.3,  similarity_boost: 0.9,  style: 0.8 },
  surprised: { stability: 0.35, similarity_boost: 0.8,  style: 0.7 },
  curious:   { stability: 0.45, similarity_boost: 0.8,  style: 0.6 },
  loving:    { stability: 0.5,  similarity_boost: 0.9,  style: 0.6 },
};

const K1_CONFIG = {
  DEFAULT_DOMAIN:           process.env.K1_DEFAULT_DOMAIN           || 'general',
  BASE_IMPORTANCE:          envInt('K1_BASE_IMPORTANCE',             5),
  LONG_MESSAGE_THRESHOLD:   envInt('K1_LONG_MESSAGE_THRESHOLD',      120),
  MAX_MESSAGE_INPUT_CHARS:  envInt('K1_MAX_MESSAGE_INPUT_CHARS',     1000),
  MAX_REPLY_CHARS:          envInt('K1_MAX_REPLY_CHARS',             1500),
  MAX_SAFE_TEXT_CHARS:      envInt('K1_MAX_SAFE_TEXT_CHARS',         600),
  CONTEXT_RECALL_LIMIT:     envInt('K1_CONTEXT_RECALL_LIMIT',        4),
  ALERTS_IN_CONTEXT_LIMIT:  envInt('K1_ALERTS_IN_CONTEXT_LIMIT',     3),
};

// ── KelionAI Master Orchestration Core: Mandatory Agents Registry ──
const ORCHESTRATION_AGENTS = {
  front_scout: {
    model:          process.env.MODEL_FRONT_SCOUT || 'meta-llama/llama-4-scout-17b-16e-instruct',
    provider:       'Groq',
    role:           'front_controller',
    mandatory_usage: true,
    skills:         ['fast_chat', 'intent_classification', 'quick_routing', 'light_reasoning', 'ux_latency_optimization'],
    allowed_for:    ['chat_simple', 'chat_general', 'light_triage'],
  },
  fallback_llama70b: {
    model:       process.env.MODEL_FALLBACK_LLAMA || 'llama-3.3-70b-versatile',
    provider:    'Groq',
    role:        'budget_fallback',
    skills:      ['general_generation', 'fallback_chat', 'secondary_processing'],
    allowed_for: ['fallback_execution', 'chat_general', 'non_critical_secondary_tasks'],
  },
  orchestrator_gpt54: {
    model:          process.env.MODEL_ORCHESTRATOR || 'gpt-4o',
    provider:       'OpenAI',
    role:           'strategic_orchestrator',
    mandatory_usage: true,
    skills:         ['planning', 'routing', 'complex_reasoning', 'final_judgment', 'high_complexity_code', 'cross_agent_synthesis'],
    allowed_for:    ['high_complexity_tasks', 'multi_agent_orchestration', 'critical_final_judgment', 'architecture', 'conflict_resolution'],
  },
  coder_claude: {
    model:       process.env.MODEL_CODER_CLAUDE || 'claude-sonnet-4-20250514',
    provider:    'Anthropic',
    role:        'code_engineer',
    skills:      ['coding', 'refactor', 'repo_analysis', 'long_context_reasoning', 'spec_to_code', 'code_review'],
    allowed_for: ['coding', 'debugging', 'architecture_support', 'qa_review'],
  },
  reasoner_deepseek: {
    model:       process.env.MODEL_REASONER_DEEPSEEK || 'deepseek-reasoner',
    provider:    'DeepSeek',
    role:        'logic_specialist',
    skills:      ['math', 'algorithms', 'formal_logic', 'hard_debugging', 'deep_reasoning'],
    allowed_for: ['math_logic', 'debugging', 'coding'],
  },
  coder_deepseek: {
    model:       process.env.MODEL_CODER_DEEPSEEK || 'deepseek-coder',
    provider:    'DeepSeek',
    role:        'code_specialist',
    skills:      ['coding', 'backend_logic', 'bug_fixing', 'algorithm_implementation'],
    allowed_for: ['coding', 'debugging'],
  },
  qa_gemini_flash: {
    model:       process.env.MODEL_GEMINI_FLASH || 'gemini-2.5-flash',
    provider:    'Google',
    role:        'fast_quality_gate',
    skills:      ['fast_review', 'bulk_summary', 'quick_multimodal_triage'],
    allowed_for: ['qa_review', 'document_analysis', 'multimodal'],
  },
  qa_gemini_pro: {
    model:       process.env.MODEL_GEMINI_PRO || 'gemini-2.5-pro',
    provider:    'Google',
    role:        'deep_quality_gate',
    skills:      ['deep_qa', 'cross_checking', 'multimodal_review', 'report_generation'],
    allowed_for: ['qa_review', 'multimodal', 'critical_secondary_review'],
  },
  web_sonar: {
    model:          process.env.MODEL_WEB_SONAR || 'sonar-pro',
    provider:       'Perplexity',
    role:           'web_search_agent',
    mandatory_usage: true,
    skills:         ['real_time_web_search', 'source_collection', 'fact_source_retrieval'],
    allowed_for:    ['web_search'],
  },
  vision_gpt54: {
    model:       process.env.MODEL_VISION_GPT || 'gpt-4o',
    provider:    'OpenAI',
    role:        'vision_agent',
    skills:      ['image_analysis', 'complex_visual_reasoning', 'visual_extraction'],
    allowed_for: ['vision_analysis', 'multimodal'],
  },
  vision_gemini: {
    model:       process.env.MODEL_VISION_GEMINI || 'gemini-2.5-flash',
    provider:    'Google',
    role:        'document_multimodal_agent',
    skills:      ['pdf_reading', 'document_understanding', 'video_audio_image_mixed_input'],
    allowed_for: ['document_analysis', 'multimodal'],
  },
  image_flux: {
    model:       process.env.MODEL_IMAGE_FLUX || 'FLUX.1-schnell',
    provider:    'Black Forest Labs',
    role:        'image_generator_fast',
    skills:      ['fast_image_generation', 'photorealism'],
    allowed_for: ['image_generation'],
  },
  image_dalle3: {
    model:       process.env.MODEL_IMAGE_DALLE || 'dall-e-3',
    provider:    'OpenAI',
    role:        'image_generator_premium',
    skills:      ['detailed_image_generation', 'high_prompt_alignment'],
    allowed_for: ['image_generation'],
  },
  stt_whisper: {
    model:       process.env.MODEL_STT_WHISPER || 'whisper-large-v3-turbo',
    provider:    'OpenAI/Groq',
    role:        'speech_to_text_primary',
    skills:      ['speech_to_text', 'voice_transcription'],
    allowed_for: ['speech_to_text'],
  },
  stt_nova3: {
    model:       process.env.MODEL_STT_NOVA || 'nova-3',
    provider:    'Deepgram',
    role:        'speech_to_text_backup',
    skills:      ['speech_to_text', 'fast_transcription'],
    allowed_for: ['speech_to_text'],
  },
  tts_eleven: {
    model:       process.env.MODEL_TTS_ELEVEN || 'eleven_v3',
    provider:    'ElevenLabs',
    role:        'text_to_speech_primary',
    skills:      ['text_to_speech', 'emotional_voice', 'avatar_voice'],
    allowed_for: ['text_to_speech'],
  },
  tts_sonic: {
    model:       process.env.MODEL_TTS_SONIC || 'sonic-2',
    provider:    'Cartesia',
    role:        'text_to_speech_secondary',
    skills:      ['text_to_speech', 'fast_voice_generation'],
    allowed_for: ['text_to_speech'],
  },
  tts_openai_fallback: {
    model:       process.env.MODEL_TTS_OPENAI || 'tts-1-hd',
    provider:    'OpenAI',
    role:        'text_to_speech_fallback',
    skills:      ['text_to_speech'],
    allowed_for: ['text_to_speech'],
  },
  voice_realtime_gpt4o: {
    model:       process.env.MODEL_VOICE_REALTIME || 'gpt-4o-realtime-preview',
    provider:    'OpenAI',
    role:        'realtime_voice_agent',
    skills:      ['voice_to_voice', 'low_latency_live_dialogue'],
    allowed_for: ['voice_realtime'],
  },
};

module.exports = {
  MODELS,
  API_ENDPOINTS,
  PROVIDER_URLS,
  PERSONAS,
  VOICE_DEFAULTS,
  VOICE_EMOTIONS,
  K1_CONFIG,
  ORCHESTRATION_AGENTS,
};