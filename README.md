# KelionAI v2.5.1

**KelionAI** — Asistent AI accesibil cu avatari 3D (Accessible AI Assistant with 3D Avatars)

[![Version](https://img.shields.io/badge/version-2.5.1-blue.svg)](https://github.com/adrianenc11-hue/kelionai-v2)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)

## 🌟 Features

- **🤖 Multi-AI Brain** — Intelligent routing between GPT-4, Gemini, Groq, Claude, and DeepSeek
- **🗣️ Voice Interaction** — Real-time speech-to-text and text-to-speech with multiple providers
- **👤 3D Avatars** — Animated characters with lip-sync technology (Kelion & Kira)
- **📱 Mobile Apps** — Native Android & iOS builds via Capacitor
- **🔐 Authentication** — Secure user management with Supabase
- **💳 Payments** — Stripe integration for premium subscriptions
- **🌐 Multi-language** — Support for multiple languages
- **📊 Admin Dashboard** — Comprehensive analytics and user management
- **🏢 Multi-tenant** — Support for multiple organizations
- **🛡️ Security** — Code shield, rate limiting, CSP headers, and more

## 🚀 Quick Start

### Prerequisites

- Node.js 20+
- npm or yarn
- Supabase account (free tier works)
- API keys for at least one AI provider

### Installation

```bash
# Clone the repository
git clone https://github.com/adrianenc11-hue/kelionai-v2.git
cd kelionai-v2

# Install dependencies
npm install

# Setup environment variables
node scripts/setup-wizard.js
# OR copy and edit manually
cp .env.example .env

# Start development server
npm run dev
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker compose up -d

# Verify health
curl http://localhost:3000/api/health
```

## 🏗️ Architecture

```
kelionai-v2/
├── app/                    # Frontend web application
│   ├── index.html         # Main entry point
│   ├── js/                # Client-side JavaScript
│   ├── styles/            # CSS styles
│   ├── models/            # 3D avatar models
│   └── ...
├── server/                 # Backend API
│   ├── index.js           # Server entry point
│   ├── brain.js           # AI orchestration engine
│   ├── config/            # Configuration files
│   ├── routes/            # API routes
│   └── ...
├── config/                 # App configuration
├── docs/                   # Documentation
├── scripts/                # Deployment & setup scripts
├── android/                # Android app (Capacitor)
├── ios/                    # iOS app (Capacitor)
└── public/                 # Static assets
```

## ⚙️ Configuration

### Required Environment Variables

```env
# Supabase (Database & Auth)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-role-key

# Session Security
SESSION_SECRET=your-random-secret-key

# AI Providers (at least one required)
OPENAI_API_KEY=sk-...
GOOGLE_AI_KEY=...
GROQ_API_KEY=gsk_...
```

### Optional Features

```env
# Voice (TTS/STT)
ELEVENLABS_API_KEY=...
DEEPGRAM_API_KEY=...

# Payments
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Search
TAVILY_API_KEY=...

# Monitoring
SENTRY_DSN=...
```

## 🧠 AI Providers

| Provider | Models | Use Case |
|----------|--------|----------|
| **OpenAI** | GPT-4.1, GPT-4o, Whisper | Primary chat, vision, STT |
| **Google** | Gemini 2.5 Flash/Pro | Fast responses, vision |
| **Groq** | Llama 3.3 70B | Ultra-fast inference |
| **Anthropic** | Claude 3.5 Sonnet | Code generation |
| **DeepSeek** | DeepSeek Chat | Fallback reasoning |

## 📝 API Endpoints

### Public Endpoints
- `GET /health` — Health check
- `GET /api/health` — Detailed health status
- `POST /api/auth/*` — Authentication
- `POST /api/chat` — Chat with AI
- `POST /api/voice/*` — Voice processing

### Admin Endpoints (Protected)
- `GET /api/admin/users` — User management
- `GET /api/admin/revenue` — Revenue analytics
- `GET /api/admin/visitors` — Visitor tracking
- `GET /api/admin/monitor` — System monitoring

## 🛠️ Development

```bash
# Run in development mode
npm run dev

# Run security audit
npm run security

# Format code
npm run format

# Health check
npm run health

# Deploy to Railway
npm run deploy
```

## 📱 Mobile Builds

```bash
# Add Android platform
npx cap add android

# Add iOS platform
npx cap add ios

# Sync web assets
npx cap sync

# Open in Android Studio
npx cap open android

# Open in Xcode
npx cap open ios
```

## 🐳 Docker

```bash
# Build image
docker build -t kelionai .

# Run container
docker run -p 3000:3000 --env-file .env kelionai

# Docker Compose (with Redis)
docker compose up -d
```

## 🧪 Testing

```bash
# Smoke test
npm run smoke

# Gate check (verify critical files)
npm run gate

# Check deploy readiness
npm run check:deploy
```

## 📚 Documentation

- [User Manual](docs/USER_MANUAL.md) — Complete user guide
- [Self-Hosting Guide](docs/SELF_HOSTING.md) — Deployment instructions
- [Mobile Build Guide](MOBILE-BUILD-GUIDE.md) — iOS/Android setup
- [Developer Accounts](docs/DEVELOPER_ACCOUNTS.md) — API key setup

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## 👨‍💻 Author

**Adrian Enciulescu** — AE Studio

---

<p align="center">
  <sub>Built with ❤️ by AE Design</sub>
</p>
