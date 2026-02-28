# KelionAI v2

![Tests](https://github.com/adrianenc11-hue/kelionai-v2/actions/workflows/test.yml/badge.svg?branch=master)
![Build](https://github.com/adrianenc11-hue/kelionai-v2/actions/workflows/deploy.yml/badge.svg?branch=master)

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

## Setup rapid

```bash
# Configurare interactivă a cheilor API
npm run setup

# Setup complet automat (Railway + Supabase + deploy)
npm run setup:full
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
| `npm run dev` | Pornește serverul de dezvoltare |
| `npm start` | Pornește serverul de producție |
| `npm test` | Rulează testele Playwright E2E (Chromium) |
| `npm run test:all` | Rulează testele pe toate browserele |
| `npm run setup` | Configurare interactivă chei API (scrie .env) |
| `npm run setup:full` | Setup complet automat: Railway + Supabase + deploy |
| `npm run setup:db` | Configurare bază de date Supabase |
| `npm run deploy` | Redeploy rapid: git push + Railway + health check |
| `npm run health` | Verificare stare endpoint-uri kelionai.app |

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

## Auto-merge procedure

The repository includes a manual workflow that merges all open PRs in the optimal order, handles conflicts gracefully, and produces a Markdown summary.

### What the workflow does

1. Iterates through 14 PRs in a carefully ordered sequence (see table below).
2. For each PR:
   - If **draft** → marks it *Ready for Review* via the GitHub GraphQL API.
   - If **already merged / closed** → skips it.
   - If **Dependabot PR** → posts `@dependabot rebase` to trigger a rebase.
   - If **non-Dependabot PR** → calls the *update branch* REST API.
   - Waits 30 seconds for GitHub to recompute the `mergeable_state`.
   - If `mergeable` → merges with the `merge` method (creates a merge commit).
   - If `conflict` → logs details and moves on without stopping the run.
3. At the end, writes a full Markdown report to the **Actions step summary**.

### How to run manually

1. Go to **Actions → 🚀 Auto-Merge All Open PRs**.
2. Click **Run workflow** → **Run workflow** (no inputs required).
3. Once the run completes, open the run summary to read the report.

### Merge order

| # | PR | Title | Group |
|---|---|---|---|
| 1 | #136 | actions/checkout 4→6 | GitHub Actions bumps |
| 2 | #134 | actions/setup-node 4→6 | GitHub Actions bumps |
| 3 | #133 | actions/github-script 7→8 | GitHub Actions bumps |
| 4 | #138 | actions/upload-artifact 4→7 | GitHub Actions bumps |
| 5 | #135 | @supabase/supabase-js 2.97→2.98 | npm dependency bumps |
| 6 | #137 | stripe 20.3.1→20.4.0 | npm dependency bumps |
| 7 | #139 | @sentry/browser 10.39→10.40 | npm dependency bumps |
| 8 | #140 | @sentry/node 10.39→10.40 | npm dependency bumps |
| 9 | #141 | jest 29.7→30.2 | npm dependency bumps |
| 10 | #123 | Add full integration pipeline | Feature PRs |
| 11 | #128 | Add comprehensive Playwright E2E test suite | Feature PRs |
| 12 | #129 | Add HTTPS redirect, Lighthouse CI, uptime monitoring | Feature PRs |
| 13 | #142 | Fix onboarding flow (inline event handlers) | Feature PRs |
| 14 | #143 | Add live Work-In-Progress status page | Feature PRs |

### Reading the report

| Icon | Meaning |
|------|---------|
| ✅ | Merged successfully |
| ❌ | Merge failed (conflict or API error) |
| ⏭️ | Skipped — PR was already merged or closed |
| 📝 | Still in draft (could not be converted) |

### Standalone report script

You can also check PR states without running the workflow:

```bash
GITHUB_TOKEN=ghp_... node scripts/auto-merge-report.js
```

This writes a `auto-merge-report.md` file in the project root and prints the same Markdown table to stdout.
