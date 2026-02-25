# Copilot Instructions for KelionAI v2

## Project Overview
KelionAI v2 is an AI-powered assistant with 3D avatars. It features voice interaction (STT/TTS), multilingual support, and two avatar personas (Kelion — male, Kira — female).

## Tech Stack
- **Backend**: Node.js 20 + Express.js 4 (`server/`)
- **Frontend**: Vanilla HTML/CSS/JS + Three.js r160 (`app/`)
- **Database**: Supabase (PostgreSQL)
- **AI**: Claude 3.5 Sonnet (primary) with GPT-4o fallback
- **TTS**: ElevenLabs (primary) with OpenAI TTS fallback
- **STT**: OpenAI Whisper
- **Search**: Tavily
- **Image generation**: DALL-E 3
- **Payments**: Stripe
- **Monitoring**: Sentry + Prometheus (`prom-client`)

## Repository Structure
```
server/         Express.js backend
  index.js      Main server, all API routes
  brain.js      KelionBrain — AI reasoning engine (autonomous thinking, self-repair)
  persona.js    System prompt builder for AI personas
  supabase.js   Supabase client setup
  migrate.js    Database migration runner
  payments.js   Stripe payment routes
  legal.js      Legal/terms routes
  metrics.js    Prometheus metrics middleware
  schema.sql    Database schema
app/            Frontend (static, served by Express)
  index.html    Single-page app entry point
  js/           Frontend JavaScript modules
  css/          Stylesheets
  models/       3D GLB models (k-male.glb, k-female.glb)
tests/          Playwright end-to-end tests
```

## Development
- **Start server**: `npm run dev` (runs `node server/index.js`, listens on port 3000)
- **Run tests**: `npm test` (Playwright, Chromium only) or `npm run test:all` (all browsers)
- **Environment**: Copy `.env.example` to `.env` and fill in API keys. Never commit `.env`.

## Coding Conventions
- Use `require()` (CommonJS) — the project does not use ES modules.
- Follow existing patterns in `server/index.js` for new API routes: use Express Router, apply appropriate rate limiters, and wrap async handlers in try/catch.
- Keep frontend code in vanilla JS; do not introduce build tools or bundlers.
- Rate-limit all new API endpoints using `express-rate-limit`.
- Always call `checkUsage` / `incrementUsage` on AI endpoints to enforce per-user quotas.
- Log important operations with the `[Component]` prefix pattern (e.g., `[Brain]`, `[Auth]`).
- Error responses must use `{ error: '...' }` JSON format.
- Do not hard-code API keys or credentials; always read from `process.env`.

## Testing
- Tests use **Playwright** (`@playwright/test`). Test files live in `tests/`.
- The web server is started automatically by the Playwright config (`playwright.config.js`).
- Write E2E tests that use `page.goto('/')` and interact with the UI via locators.
- Keep tests deterministic — mock external API calls where possible.

## Key Behaviours
- The `KelionBrain` class (`server/brain.js`) handles all AI interactions, tool use, and self-repair logic. Extend it there rather than adding new AI calls in routes.
- Language is auto-detected from user input; responses must be in the same language as the user's message.
- Avatar persona (Kelion / Kira) is controlled via the `buildSystemPrompt` function in `server/persona.js`.
- Supabase is used for user memory, preferences, and usage tracking. Use `supabaseAdmin` for server-side operations and `supabase` for user-scoped operations.
