function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`[ENV] Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const ENV = {
  jwtSecret: required("JWT_SECRET"),

  databaseUrl: optional("DATABASE_URL"),
  supabaseUrl: optional("SUPABASE_URL"),
  supabaseAnonKey: optional("SUPABASE_ANON_KEY"),
  supabaseServiceKey: optional("SUPABASE_SERVICE_KEY"),

  // Google Gemini
  geminiApiKey: optional("GEMINI_API_KEY"),
  geminiFlashModel: optional("GEMINI_FLASH_MODEL", "gemini-2.5-flash"),
  geminiProModel: optional("GEMINI_PRO_MODEL", "gemini-2.5-pro"),
  geminiNativeAudioModel: optional("GEMINI_NATIVE_AUDIO_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025"),

  // OpenAI (backup video only)
  openaiApiKey: optional("OPENAI_API_KEY"),
  openaiModel: optional("OPENAI_MODEL", "gpt-5.4"),
  openaiBaseUrl: optional("OPENAI_BASE_URL", "https://api.openai.com/v1"),

  // ElevenLabs (voice cloning only)
  elevenLabsApiKey: optional("ELEVENLABS_API_KEY"),
  elevenLabsVoiceKelion: optional("ELEVENLABS_VOICE_KELION", "VR6AewLTigWG4xSOukaG"),
  elevenLabsVoiceKira: optional("ELEVENLABS_VOICE_KIRA", "EXAVITQu4vr4xnSDxMaL"),

  // Stripe
  stripeSecretKey: optional("STRIPE_SECRET_KEY"),
  stripeWebhookSecret: optional("STRIPE_WEBHOOK_SECRET"),

  // Frontend
  frontendUrl: optional("FRONTEND_URL", process.env.NODE_ENV === "production" ? "" : "http://localhost:5173"),

  // Supabase Storage
  supabaseStorageBucket: optional("SUPABASE_STORAGE_BUCKET", "kelionai-uploads"),

  // Legacy
  forgeApiUrl: optional("BUILT_IN_FORGE_API_URL"),
  forgeApiKey: optional("BUILT_IN_FORGE_API_KEY"),
  appId: optional("VITE_APP_ID"),
  ownerOpenId: optional("OWNER_OPEN_ID"),
  oAuthServerUrl: optional("OAUTH_SERVER_URL"),

  isProduction: process.env.NODE_ENV === "production",
  nodeEnv: optional("NODE_ENV", "development"),
};
