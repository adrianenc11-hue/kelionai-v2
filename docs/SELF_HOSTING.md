# KelionAI — Self-Hosting Guide

## Quick Start (Docker)

```bash
# 1. Clone
git clone https://github.com/adrianenc11-hue/kelionai-v2.git
cd kelionai-v2

# 2. Configure
node scripts/setup-wizard.js    # Interactive .env generator
# OR copy .env.example and fill manually

# 3. Deploy
docker compose up -d

# 4. Verify
curl http://localhost:3000/health
```

## Requirements

| Requirement | Minimum                    |
| ----------- | -------------------------- |
| Node.js     | 20+                        |
| RAM         | 256 MB                     |
| Disk        | 500 MB                     |
| Database    | Supabase (free tier works) |

## Environment Variables

### Required

| Variable                    | Description               |
| --------------------------- | ------------------------- |
| `SUPABASE_URL`              | Your Supabase project URL |
| `SUPABASE_ANON_KEY`         | Supabase anon/public key  |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `SUPABASE_DB_PASSWORD`      | Database password         |

### AI (at least one required)

| Variable         | Description           |
| ---------------- | --------------------- |
| `OPENAI_API_KEY` | OpenAI / GPT-5.4      |
| `GOOGLE_AI_KEY`  | Google AI / Gemini    |
| `GROQ_API_KEY`   | Groq (fast inference) |

### Optional

| Variable             | Description                      |
| -------------------- | -------------------------------- |
| `ELEVENLABS_API_KEY` | Voice TTS                        |
| `TAVILY_API_KEY`     | Web search                       |
| `SERPER_API_KEY`     | Google search                    |
| `STRIPE_SECRET_KEY`  | Payments                         |
| `SENTRY_DSN`         | Error tracking                   |
| `ADMIN_SECRET_KEY`   | Admin panel auth                 |
| `MULTI_TENANT`       | Enable multi-tenant (true/false) |

## Deployment Options

### Railway (recommended)

```bash
# Push to master → auto-deploy
git push origin master
```

### Docker

```bash
docker compose up -d --build
```

### Manual VPS

```bash
npm ci --omit=dev
NODE_ENV=production node server/index.js
```

### Multi-tenant

Set `MULTI_TENANT=true` in `.env`. Tenants are resolved by:

1. `X-Tenant-ID` header
2. Subdomain (e.g., `acme.kelionai.app`)
3. JWT `tenant_id` claim

Configure tenants in the `tenants` table in Supabase.

## Health Checks

- `GET /health` — basic server health
- `GET /api/health` — detailed health + services
- `GET /api/admin/brain-health` — brain intelligence status (admin only)
