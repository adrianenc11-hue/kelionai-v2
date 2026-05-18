# KelionAI v2

KelionAI v2 is a React 19 + Node/Express application for a 3D voice/chat AI assistant with admin tooling, memory, credits, document tools, realtime routes, and an optional autonomous Agent Mode.

The production branch is `master`. Changes that go toward production must go through a Pull Request. Do not push directly to `master`.

## Stack

| Layer | Current technology |
| --- | --- |
| Frontend | React 19, Vite 5, React Router 7, Three.js, React Three Fiber, Monaco |
| Backend | Node.js 20+, Express 4 |
| Database | SQLite for local/dev, Postgres via `DATABASE_URL` for production |
| Auth | Local auth, Google OAuth, JWT/session cookies, admin gate |
| AI providers | OpenRouter, Google AI Studio fallback, optional model scan |
| Automation | Admin-only Agent Mode, file/shell/browser/GitHub/deploy tools |
| Deployment | Railway-compatible single service |

## Local Setup

```bash
npm ci
cd server
npm ci
cd ..
npm run build
cd server
npm test -- --runInBand --silent
```

Development servers:

```bash
npm run server:dev
npm run dev
```

Frontend default: `http://localhost:5173`

Backend default: `http://localhost:3001`

## Production Start

```bash
npm run server:start
```

This builds the frontend and starts `server/src/index.js`. In production the Express server serves the built `dist/` frontend.

## Required Environment

Core production variables:

```bash
NODE_ENV=production
APP_BASE_URL=https://kelionai.app
API_BASE_URL=https://kelionai.app
CORS_ORIGINS=https://kelionai.app
SESSION_SECRET=<long-random-secret>
JWT_SECRET=<different-long-random-secret>
ADMIN_EMAILS=<owner-admin-email>
DATABASE_URL=<postgres-url>
```

AI variables:

```bash
OPENROUTER_API_KEY=<openrouter-key>
GOOGLE_API_KEY=<google-ai-studio-key>
# or
GOOGLE_API_KEYS=<comma-separated-google-ai-studio-keys>
MODEL_CHAT=<optional-model-id>
MODEL_CODER=<optional-model-id>
MODEL_VISION=<optional-model-id>
```

OAuth and payments:

```bash
GOOGLE_CLIENT_ID=<google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>
GOOGLE_REDIRECT_URI=https://kelionai.app/auth/google/callback
STRIPE_SECRET_KEY=<stripe-secret>
STRIPE_WEBHOOK_SECRET=<stripe-webhook-secret>
```

Agent Mode:

```bash
AGENT_ENABLED=1
AGENT_SHELL_CWD=/app
GITHUB_TOKEN=<github-token-with-repo-access>
GITHUB_REPO_OWNER=adrianenc11-hue
GITHUB_REPO_NAME=kelionai-v2
AGENT_GOOGLE_API_KEY=<custom-search-key>
AGENT_GOOGLE_CX=<custom-search-cx>
AGENT_RAILWAY_TOKEN=<railway-token>
```

Only set `AGENT_ALLOW_PR_MERGE=1` after GitHub branch protection and required checks are enforced.

## Autonomy Readiness

Kelion has the code paths for an autonomous development agent, but it is intentionally gated.

Before enabling Agent Mode in production:

1. Protect `master` in GitHub.
2. Require Pull Requests for `master`.
3. Require status checks before merge.
4. Set `AGENT_SHELL_CWD` explicitly to the repo root in the runtime environment.
5. Use a scoped GitHub token.
6. Run the environment audit.

```bash
cd server
node scripts/verify-env.js
```

Admin endpoint:

```text
GET /api/admin/env-audit
```

The audit returns `autonomy.ready=false` until all autonomy-critical checks pass.

## Guardrails

Agent Mode is available only when `AGENT_ENABLED=1`.

Dangerous public tools are admin-gated. The developer agent requires explicit approval before commit, push, or PR steps.

Direct pushes to `master`, `main`, or `HEAD` are blocked in the agent shell/orchestrator path. GitHub PR creation requires a non-master feature branch.

## Main API Areas

| Area | Path |
| --- | --- |
| Health | `/health`, `/api/admin/health` |
| Auth | `/auth/*` |
| Chat | `/api/chat` |
| Realtime | `/api/realtime/*` |
| Tools | `/api/tools/*` |
| Admin | `/api/admin/*` |
| Agent Mode | `/api/agent/*` when `AGENT_ENABLED=1` |
| Docs/OCR | `/api/docs/*` |
| Credits | `/api/credits/*` |

## Verification

Known-good local verification commands:

```bash
npm run build
cd server
npm test -- --runInBand --silent
node --check src/routes/realtime.js
node --check src/services/agentShell.js
node --check src/services/agentGitHub.js
node --check src/services/agentOrchestrator.js
node --check src/services/envAudit.js
node --check scripts/verify-env.js
```

`RULES.md` and `RULES.sha256` are enforcement files. Do not edit them without the owner-approved process described in those files.
