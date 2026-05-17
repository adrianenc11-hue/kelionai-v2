# Consolidation Audit — 2026-05-17

## Scope

Repository consolidated toward a single canonical project: `server/`.

## Archived

Archive folder created at `archive/removed-2026-05-17/` with:

- `archive/removed-2026-05-17/desktop/` (complete copy of prior `desktop/`)
- `archive/removed-2026-05-17/web-root/` (copy of root web/mobile source files):
  - `android/`
  - `ios/`
  - `src/`
  - `public/`
  - `extension/`
  - `index.html`
  - `vite.config.js`
  - `postcss.config.cjs`
  - `tailwind.config.js`
  - `capacitor.config.json`
  - `playwright.config.cjs`

## Removed from active tree

- `desktop/`
- `android/`
- `ios/`
- `src/`
- `public/`
- `extension/`
- `index.html`
- `vite.config.js`
- `postcss.config.cjs`
- `tailwind.config.js`
- `capacitor.config.json`
- `playwright.config.cjs`

## Build/deploy pipeline updates

- Root `npm run build` now builds from archived web snapshot (`archive/removed-2026-05-17/web-root`) and outputs to root `dist/` (still satisfies server runtime path `../../dist`).
- Added root script `npm run build:server-dist` to build and copy `dist/` into `server/dist`.
- Added `scripts/copy-dist-to-server.cjs` to sync `dist/` -> `server/dist`.
- Updated `.github/workflows/ci.yml` to remove desktop/e2e jobs and validate archived web dist + `server/dist` artifact.
- Added `.github/workflows/deploy-on-master.yml` (push to `master`) with build, server tests, non-blocking env sanity check, and deploy placeholder.

## Local start commands after merge

```bash
# repo root
npm ci
npm run build
npm run build:server-dist
npm --prefix server ci
npm --prefix server dev
# or production-style
npm --prefix server start
```

## Required environment variables / deployment secrets

Core runtime:

- `SESSION_SECRET`
- `JWT_SECRET`
- `DATABASE_URL` (optional but recommended for persistent Postgres)

Common integrations (from `server/scripts/verify-env.js`):

- `OPENROUTER_API_KEY`
- `ELEVENLABS_API_KEY`
- `STRIPE_SECRET_KEY`
- `GITHUB_TOKEN` or `AGENT_GITHUB_TOKEN`
- `AGENT_GOOGLE_API_KEY` + `AGENT_GOOGLE_CX` (or `GOOGLE_CUSTOM_SEARCH_API_KEY` + `GOOGLE_CUSTOM_SEARCH_CX`)
- `AGENT_RAILWAY_TOKEN` or `RAILWAY_API_TOKEN`
- `SENTRY_DSN` and/or `VITE_SENTRY_DSN`
- `AGENT_ENABLED=1` when agent routes should be active

Deploy workflow placeholder secrets:

- `RAILWAY_TOKEN` (or `AGENT_RAILWAY_TOKEN`)
- `RAILWAY_PROJECT_ID`
- `RAILWAY_SERVICE_ID`
- `GITHUB_TOKEN` (minimum required scopes)

## Rollback

Use the backup branch created before consolidation:

```bash
git fetch origin backup/pre-consolidation-2026-05-17
git checkout backup/pre-consolidation-2026-05-17
```

Or cherry-pick/checkout specific removed paths from that branch.
