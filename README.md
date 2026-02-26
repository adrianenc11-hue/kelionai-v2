# KelionAI v2

AI-powered assistant with 3D avatars, voice interaction (STT/TTS), and multilingual support.

## Features

- 🤖 **Two AI personas** — Kelion (male) and Kira (female) with 3D GLB avatars
- 🗣️ **Voice interaction** — speech-to-text via OpenAI Whisper + Groq, text-to-speech via ElevenLabs
- 💬 **Streaming chat** — word-by-word responses via Server-Sent Events
- 🔍 **Web search** — real-time results via Tavily
- 🌤️ **Weather** — live weather data shown on the monitor panel
- 🖼️ **Image generation** — DALL-E 3
- 👁️ **Vision** — camera capture + image analysis
- 🔐 **Authentication** — Supabase Auth with guest mode
- 💾 **Conversation history** — stored in Supabase PostgreSQL
- 📊 **Monitoring** — Sentry error tracking + Prometheus metrics

## Project Structure

```
server/         Express.js backend (Node.js 20)
  index.js      API routes and server entry point
  brain.js      KelionBrain — AI reasoning engine
  persona.js    System prompt builder for AI personas
  supabase.js   Supabase client setup
  migrate.js    Database migration runner
  payments.js   Stripe payment routes
  legal.js      Legal/terms routes
  metrics.js    Prometheus metrics middleware
  schema.sql    Database schema
app/            Frontend (static HTML/CSS/JS + Three.js)
  index.html    Single-page app entry point
  js/           Frontend JavaScript modules
  css/          Stylesheets
  models/       3D GLB models (k-male.glb, k-female.glb)
tests/          Playwright end-to-end tests
```

## Setup

### 1. Clone and install

```bash
git clone https://github.com/adrianenc11-hue/kelionai-v2.git
cd kelionai-v2
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
# Edit .env and fill in your API keys
```

See [`.env.example`](.env.example) for all available options.

**Required:**
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` — at least one AI provider
- `ELEVENLABS_API_KEY` — text-to-speech
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_KEY` — database & auth

**Optional:**
- `TAVILY_API_KEY` — web search
- `SENTRY_DSN` — error monitoring
- `STRIPE_SECRET_KEY` — payments

### 3. Run

```bash
# Development
npm run dev

# Production
npm start
```

Server listens on `http://localhost:3000`.

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm start` | Start production server |
| `npm test` | Run Playwright E2E tests (Chromium) |
| `npm run test:all` | Run tests on all browsers |

## Database

Tables are created automatically on server startup via `server/migrate.js`.

To run manually in Supabase SQL Editor:
1. Open `https://supabase.com/dashboard/project/YOUR_PROJECT_REF/sql`
2. Copy contents of `server/schema.sql`
3. Click **Run**

## Tech Stack

- **Backend**: Node.js 20 + Express.js 4
- **Frontend**: Vanilla HTML/CSS/JS + Three.js r160
- **Database**: Supabase (PostgreSQL)
- **AI**: Claude 3.5 Sonnet (primary) + GPT-4o (fallback)
- **TTS**: ElevenLabs (primary) + OpenAI TTS (fallback)
- **STT**: OpenAI Whisper
- **Search**: Tavily
- **Images**: DALL-E 3
- **Payments**: Stripe
- **Monitoring**: Sentry + Prometheus
