export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // ElevenLabs TTS & Voice Cloning
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? "",
  elevenLabsVoiceKelion: process.env.ELEVENLABS_VOICE_KELION ?? "VR6AewLTigWG4xSOukaG",
  elevenLabsVoiceKira: process.env.ELEVENLABS_VOICE_KIRA ?? "EXAVITQu4vr4xnSDxMaL",
  // OpenAI for GPT-5.4 vision + Whisper STT
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
};
