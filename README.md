# KelionAI v2

**Accessible AI Assistant with 3D Avatars**

KelionAI is a full-stack AI assistant featuring animated 3D avatars, multi-provider AI routing, voice synthesis, web search, image generation, and Stripe-based subscriptions.

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: Supabase (PostgreSQL)
- **AI**: Anthropic Claude, OpenAI, DeepSeek
- **Voice**: ElevenLabs
- **Search**: Perplexity, Tavily, Serper, DuckDuckGo (free fallback)
- **3D**: Three.js
- **Payments**: Stripe
- **Monitoring**: Sentry

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env and fill in your real API keys
   ```

3. **Run the server**
   ```bash
   npm run dev
   ```
   The app will be available at `http://localhost:3000`.

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the development server |
| `npm start` | Start the production server |
| `npm test` | Run Playwright tests (Chromium) |
| `npm run test:all` | Run Playwright tests (all browsers) |
| `npm run test:report` | Show last Playwright test report |

## Features

- 🤖 Multi-provider AI routing (Claude, GPT-4, DeepSeek)
- 🗣️ Voice synthesis via ElevenLabs
- 🌐 Web search with multiple providers
- 🖼️ AI image generation
- 👤 Animated 3D avatars (Three.js)
- 🔐 User authentication via Supabase
- 💳 Subscription payments via Stripe
- 📊 Usage tracking and rate limiting
- 🌍 GDPR-compliant data export and deletion

## Project Structure

```
kelionai-v2/
├── app/                  # Frontend assets
├── server/
│   ├── index.js          # Express app entry point
│   ├── brain.js          # AI routing logic
│   ├── supabase.js       # Database helpers
│   ├── payments.js       # Stripe integration
│   ├── legal.js          # GDPR / Terms / Privacy
│   └── migrate.js        # DB migration runner
├── tests/                # Playwright end-to-end tests
├── .env.example          # Environment variable template
├── package.json
└── README.md
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your values. See `.env.example` for all available options with descriptions.

At minimum you need:
- `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` (for AI responses)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (for storage)
