# KelionAI v2 - Developer Setup Guide

## Prerequisites

- Node.js 22+ 
- pnpm (package manager)
- Access to Manus platform (for OAuth, database, hosting)

---

## Quick Start

```bash
# 1. Clone/open the project
cd /home/ubuntu/kelionai-v2-web

# 2. Install dependencies
pnpm install

# 3. Start development server
pnpm dev
# Server runs on http://localhost:3000/
```

---

## Project Structure

```
kelionai-v2-web/
├── client/                  # Frontend (React 19 + Tailwind 4)
│   ├── src/
│   │   ├── pages/           # Page components (lazy loaded)
│   │   │   ├── Home.tsx     # Landing page with live avatars
│   │   │   ├── Chat.tsx     # Main chat interface
│   │   │   ├── Profile.tsx  # User profile
│   │   │   ├── Contact.tsx  # Contact form with AI auto-response
│   │   │   ├── Pricing.tsx  # Subscription plans
│   │   │   └── AdminDashboard.tsx # Admin panel
│   │   ├── components/      # Reusable UI components
│   │   │   ├── Avatar3D.tsx # 3D avatar with mouth control
│   │   │   └── ui/         # shadcn/ui components
│   │   ├── App.tsx          # Routes with auth guards
│   │   └── index.css        # Global styles & theme
│   └── index.html
├── server/                  # Backend (Express + tRPC)
│   ├── _core/              # Framework (DO NOT EDIT)
│   │   ├── index.ts        # Server entry + security headers
│   │   ├── env.ts          # Environment variables
│   │   ├── llm.ts          # LLM helper (invokeLLM)
│   │   └── oauth.ts        # Manus OAuth
│   ├── routers/            # tRPC routers
│   │   ├── chat.ts         # Chat with Brain v4
│   │   ├── voice.ts        # TTS + voice cloning
│   │   ├── admin.ts        # Admin dashboard
│   │   └── contact.ts      # Contact form
│   ├── brain-v4.ts         # AI Brain orchestrator
│   ├── characters.ts       # Kelion/Kira personalities
│   ├── elevenlabs.ts       # ElevenLabs TTS + cloning
│   ├── db.ts               # Database helpers
│   └── routers.ts          # Router aggregation
├── drizzle/                # Database schema & migrations
│   └── schema.ts           # Table definitions
├── docs/                   # Documentation
│   ├── API.md              # API reference
│   ├── DEPLOYMENT.md       # Deployment guide
│   └── DEVELOPER_SETUP.md  # This file
└── todo.md                 # Feature tracking
```

---

## Key Concepts

### Brain v4 (server/brain-v4.ts)
The AI orchestrator that processes all chat messages:
1. **Detects user level** (child, casual, professional, academic, technical)
2. **Detects language** automatically
3. **Selects tools** via function calling (weather, search, code, vision, etc.)
4. **Anti-hallucination** - never invents facts, says "I don't know" when uncertain
5. **Self-awareness** - detects missing capabilities and logs feature requests

### Characters (server/characters.ts)
- **Kelion**: Technical, analytical, precise, friendly
- **Kira**: Warm, creative, empathetic, energetic

### ElevenLabs (server/elevenlabs.ts)
- TTS with quality options (standard/high/ultra)
- Voice cloning from 30-60 second recordings
- Per-user cloned voice storage in database

---

## Database Migrations

```bash
# 1. Edit schema in drizzle/schema.ts
# 2. Generate migration SQL
pnpm drizzle-kit generate

# 3. Read the generated .sql file
# 4. Apply via webdev_execute_sql tool or Management UI > Database
```

---

## Testing

```bash
# Run all tests
pnpm test

# Run specific test file
npx vitest run server/brain-v4.test.ts

# Watch mode
npx vitest
```

Current test coverage:
- Brain v4: 27 tests (user level detection, language detection, tool selection, anti-hallucination, confidence scoring)
- Auth: 1 test (logout)

---

## Adding New Features

1. **New tRPC procedure:**
   - Add to `server/routers/<feature>.ts`
   - Wire in `server/routers.ts`
   - Call from frontend with `trpc.<feature>.useQuery/useMutation`

2. **New Brain tool:**
   - Add tool definition to `BRAIN_TOOLS` in `brain-v4.ts`
   - Add executor in `executeToolCall()`
   - Brain will automatically select it via function calling

3. **New page:**
   - Create in `client/src/pages/<Page>.tsx`
   - Add lazy import in `App.tsx`
   - Add route with appropriate guard (public/protected/admin)

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Server won't start | Check `pnpm install`, restart with `webdev_restart_server` |
| TypeScript errors | Run `npx tsc --noEmit` to find exact errors |
| Database errors | Check schema matches actual tables via Management UI > Database |
| ElevenLabs errors | Verify API key in Settings > Secrets, check plan limits |
| Auth not working | Clear cookies, check OAuth config in Management UI |
| Avatar not loading | Check 3D model URLs in Avatar3D.tsx |
