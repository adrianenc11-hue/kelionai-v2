# KelionAI — Voice-to-Voice Pipeline

## Schema Completă: User → AI → User (voce la voce)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     VOICE-TO-VOICE PIPELINE                            │
│                                                                        │
│  🎤 USER VORBEȘTE                                                      │
│       │                                                                │
│       ▼                                                                │
│  ┌──────────────────────────────────┐                                  │
│  │  STT (Speech-to-Text)           │                                  │
│  │  ─────────────────────────────  │                                  │
│  │  Pipeline A: Deepgram Nova-3    │  ← streaming WebSocket, ~100ms   │
│  │  Pipeline B: OpenAI Whisper-1   │  ← batch, cu language detection  │
│  │  Pipeline C: gpt-audio-1.5     │  ← audio in/out nativ            │
│  │  Fallback:   Browser Web Speech │  ← fără server                   │
│  └──────────────┬───────────────────┘                                  │
│                 │ text                                                  │
│                 ▼                                                       │
│  ┌──────────────────────────────────┐                                  │
│  │  🧠 LLM (Brain — Gândire AI)    │                                  │
│  │  ─────────────────────────────  │                                  │
│  │  PRIMARY:  GPT-5.4              │  ← cel mai capabil model         │
│  │  VOICE:    Groq Llama-4-Scout   │  ← 460 tok/s, sub-1s latency    │
│  │  FALLBACK: GPT-4o              │                                  │
│  │  FALLBACK: Claude Sonnet 4     │                                  │
│  │  FALLBACK: Gemini 2.5 Flash    │                                  │
│  │  REASONING: DeepSeek R1        │  ← math/logică complexă          │
│  └──────────────┬───────────────────┘                                  │
│                 │ text răspuns                                          │
│                 ▼                                                       │
│  ┌──────────────────────────────────┐                                  │
│  │  TTS (Text-to-Speech)           │                                  │
│  │  ─────────────────────────────  │                                  │
│  │  PRIMARY:  ElevenLabs eleven_v3 │  ← voice cloning, alignment     │
│  │  STREAM:   Cartesia sonic-2     │  ← ~60ms, cel mai rapid          │
│  │  STREAM:   ElevenLabs v3_conv.  │  ← ~90ms, WebSocket streaming   │
│  │  FALLBACK: Google Cloud TTS     │  ← Neural2/Journey/Chirp3-HD    │
│  │  FALLBACK: OpenAI gpt-4o-mini-tts │                                │
│  └──────────────┬───────────────────┘                                  │
│                 │ audio (MP3/PCM)                                       │
│                 ▼                                                       │
│  🔊 USER AUDE RĂSPUNSUL + Avatar lip sync                             │
│                                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Pipeline A — Streaming Sub-1s (voice-stream.js)

**Cel mai rapid. WebSocket full-duplex.**

```
Mic (PCM16 24kHz)
  → WebSocket /api/voice-stream
    → Deepgram Nova-3 STT (~100ms)
      → Groq Llama-4-Scout LLM (streaming, ~400ms TTFT)
        → Cartesia sonic-2 TTS (~60ms) sau ElevenLabs v3_conversational (~90ms)
          → PCM audio chunks → AudioContext playback
            → Speaker
```

**Latență totală: ~560ms** (voce user → voce AI)

| Etapă | Model | Latență |
|-------|-------|---------|
| STT | Deepgram `nova-3` | ~100ms |
| LLM | Groq `llama-4-scout-17b` | ~400ms TTFT |
| TTS | Cartesia `sonic-2` | ~60ms TTFA |
| **TOTAL** | | **~560ms** |

---

## Pipeline B — OpenAI Realtime (voice-realtime.js)

**Voice-first. OpenAI face STT + TTS nativ, Brain GPT-5.4 gândește.**

```
Mic (PCM16)
  → Socket.io /voice-realtime
    → OpenAI Realtime API (gpt-4o-realtime-preview)
      → Whisper-1 STT (built-in, live transcription)
        → KelionBrain.think() cu GPT-5.4 (reasoning)
          → OpenAI Realtime TTS (echo/shimmer voices)
            → PCM16 audio chunks → Speaker
```

**Config critic**: `create_response: false` — OpenAI NU răspunde automat, Brain-ul GPT-5.4 decide.

---

## Pipeline C — Chat + Voice (voice.js — tradițional)

**POST requests. User scrie sau dictează, primește audio înapoi.**

```
Browser Recording / Text Input
  → POST /api/listen (STT: Whisper-1)
    → Chat UI (user vede/editează text)
      → POST /api/chat (Brain: GPT-5.4)
        → POST /api/speak (TTS cascade):
          1. ElevenLabs eleven_v3 (+ voice cloning dacă user are clonă activă)
          2. Google Cloud TTS (Neural2/Journey/Chirp3-HD)
          3. OpenAI gpt-4o-mini-tts
            → <audio> playback + avatar lip sync
```

---

## Voice Cloning — ElevenLabs

**User își clonează vocea proprie. Avatarul răspunde cu vocea userului.**

### Flux:
```
1. User uploadează sample audio → POST /api/voice/clone
2. ElevenLabs creează voice ID din sample
3. Voice ID salvat în Supabase: tabel `cloned_voices`
   - user_id
   - elevenlabs_voice_id
   - is_active: true
4. La fiecare POST /api/speak:
   - Verifică dacă user are cloned voice activă
   - Dacă DA → folosește voiceId din `cloned_voices`
   - Dacă NU → folosește vocea default (Kelion/Kira per limbă)
```

### Endpoints voice clone:
| Endpoint | Metoda | Ce face |
|----------|--------|---------|
| `POST /api/voice/clone` | Upload | Trimite audio sample la ElevenLabs, primește voice ID |
| `GET /api/voice/clone` | Status | `{hasClone: true/false}` |
| `DELETE /api/voice/clone` | Șterge | Dezactivează clona |
| `GET /api/voice-clone/list` | Listă | Toate vocile clonate ale userului |

### Cod relevant (server/routes/voice.js):
```javascript
// Verifică dacă user are voce clonată activă
const { data: cv } = await supabaseAdmin
  .from('cloned_voices')
  .select('elevenlabs_voice_id')
  .eq('user_id', user.id)
  .eq('is_active', true)
  .limit(1)
  .single();

if (cv?.elevenlabs_voice_id) {
  voiceId = cv.elevenlabs_voice_id;  // ← folosește vocea clonată
}
```

---

## Toate Modelele (server/config/models.js)

| Categorie | Cheie | Model | Folosit pentru |
|-----------|-------|-------|----------------|
| **LLM** | OPENAI_CHAT | `gpt-5.4` | Brain principal — reasoning, chat |
| **LLM** | GROQ_PRIMARY | `llama-4-scout-17b` | Voice stream — răspuns rapid |
| **LLM** | OPENAI_FALLBACK | `gpt-4o` | Fallback brain |
| **LLM** | CLAUDE | `claude-3-5-sonnet` | Fallback brain |
| **LLM** | GEMINI_CHAT | `gemini-2.5-flash` | Fallback brain |
| **LLM** | DEEPSEEK | `deepseek-reasoner` | Reasoning avansat |
| **Audio** | OPENAI_AUDIO | `gpt-audio-1.5` | Audio in/out nativ (Chat Completions) |
| **Realtime** | GPT_REALTIME | `gpt-4o-realtime-preview` | Voice-first mode |
| **STT** | DEEPGRAM_STT | `nova-3` | Streaming STT (~100ms) |
| **STT** | WHISPER | `whisper-large-v3-turbo` | Batch STT |
| **TTS** | ELEVENLABS_MODEL | `eleven_v3` | TTS principal + clonare |
| **TTS** | ELEVENLABS_FLASH | `eleven_v3_conversational` | TTS streaming (low latency) |
| **TTS** | CARTESIA_MODEL | `sonic-2` | TTS streaming cel mai rapid |
| **TTS** | OPENAI_TTS | `gpt-4o-mini-tts` | TTS fallback final |

---

## Fișiere Cheie

| Fișier | Rol |
|--------|-----|
| `server/config/models.js` | Toate modelele centralizate |
| `server/routes/voice-stream.js` | Pipeline A — Sub-1s streaming |
| `server/routes/voice-realtime.js` | Pipeline B — OpenAI Realtime |
| `server/routes/voice.js` | Pipeline C — Chat + Voice tradițional |
| `server/brain.js` | KelionBrain — AI reasoning (GPT-5.4) |
| `server/config/voices.js` | Voice IDs per avatar/limbă |
| `app/js/voice.js` | Frontend — recording, playback, lip sync |
| `app/js/voice-stream-client.js` | Frontend — streaming WebSocket client |
| `app/js/voice-realtime-client.js` | Frontend — Socket.io realtime client |
