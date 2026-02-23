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
ANTHROPIC_API_KEY=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
OPENAI_API_KEY=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
ELEVENLABS_API_KEY=sk_efc8ed68faf56c39f7badcaac4d42a57d61852931ef147a2
TAVILY_API_KEY=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
SUPABASE_URL=https://nqlobybfwmtkmsqadqqr.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbG9ieWJmd210a21zcWFkcXFyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NzMwMjIsImV4cCI6MjA4NzQ0OTAyMn0.JEZJyCH6zO8RPVvSpsy9BMW92BuopprZPSSI2jB8CK0
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xbG9ieWJmd210a21zcWFkcXFyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTg3MzAyMiwiZXhwIjoyMDg3NDQ5MDIyfQ.AngYdhgIOXas4UssEP1ENLiZCW9CYPgecvYej3PvLOQ
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
- **DB Password**: K3l10n-AI-2026!

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
