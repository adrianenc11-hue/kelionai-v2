# KelionAI v2 — Project Credentials & Details

## Stack
- **Frontend**: HTML/CSS/JS + Three.js r160 (3D avatars)
- **Backend**: Express.js 4 (Node.js 20)
- **Packaging**: Electron 28 (Windows) + Capacitor 6 (Android/iOS)
- **Database**: Supabase (PostgreSQL)
- **AI**: Claude 3.5 Sonnet + GPT-4o (fallback)
- **TTS**: ElevenLabs (primary) + OpenAI TTS (fallback)
- **STT**: Whisper (OpenAI)
- **Search**: Tavily
- **Images**: DALL-E 3

## API Keys (.env)
```
# ⚠️ NEVER commit real API keys to version control!
# Copy this template to .env and fill in your actual keys.
ANTHROPIC_API_KEY=your-anthropic-key-here
OPENAI_API_KEY=your-openai-key-here
ELEVENLABS_API_KEY=your-elevenlabs-key-here
TAVILY_API_KEY=your-tavily-key-here
SUPABASE_URL=your-supabase-url-here
SUPABASE_ANON_KEY=your-supabase-anon-key-here
SUPABASE_SERVICE_KEY=your-supabase-service-key-here
```

## Supabase Project
- **Name**: KelionAI
- **Organization**: kelion-memory
- **Project ID**: nqlobybfwmtkmsqadqqr
- **URL**: https://nqlobybfwmtkmsqadqqr.supabase.co
- **Dashboard**: https://supabase.com/dashboard/project/nqlobybfwmtkmsqadqqr
- **API Settings**: https://supabase.com/dashboard/project/nqlobybfwmtkmsqadqqr/settings/api
- **Region**: EU (user is in UK)
- **Plan**: Free (Nano)
- **DB Password**: (stored in .env, never commit)

## ElevenLabs
- **Dashboard**: https://elevenlabs.io/app/settings/api-keys
- **Voice Kelion**: VR6AewLTigWG4xSOukaG (Arnold — masculine)
- **Voice Kira**: EXAVITQu4vr4xnSDxMaL (Bella — feminine)
- **Model**: eleven_multilingual_v2

## Project Location
- **Local path**: C:\Users\adria\.gemini\antigravity\scratch\kelionai-v2
- **Server**: http://localhost:3000
- **3D Models**: app/models/k-male.glb, app/models/k-female.glb

## Features Implemented
- [x] 3D avatar rendering (Three.js)
- [x] Avatar switching (Kelion/Kira)
- [x] Chat with AI (Claude + GPT-4o fallback)
- [x] TTS (ElevenLabs + OpenAI fallback)
- [x] STT (Whisper)
- [x] Wake word detection ("Kelion", "Kira")
- [x] Auto-detect language (RO, EN, ES, FR, DE, IT)
- [x] Respond in detected language
- [x] Smart vision ("mă vezi?" triggers camera)
- [x] Drag & drop files on monitor
- [x] File in/out manager
- [x] Split layout (avatar left, monitor right)
- [x] Chat under avatar
- [x] Simple lip sync (Smile morph)
- [x] Idle sway + attention mode
- [x] Noise filtering on mic
- **Supabase integration** ✅ (keys configured)
- [ ] Supabase schema/tables
- [ ] Electron packaging
- [ ] Capacitor packaging
- [ ] User authentication
- [ ] Stripe payments
