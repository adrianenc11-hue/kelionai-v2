# KelionAI Migration Notes

## Token Storage Migration (sessionStorage-first)

**Applies to:** All browser-side authentication (main app, settings, pricing, billing, developer portal)

### What changed

The auth token (`kelion_token`) is now stored in **`sessionStorage`** instead of `localStorage`.

- **`sessionStorage`** — token is cleared when the browser tab/window is closed (more secure, prevents token leakage via JS on other tabs).
- **`localStorage`** — token persists across browser sessions (less secure).

The main app (`KAuth`, `app/js/auth.js`) has always used `sessionStorage`. This change aligns `KShared.getToken()` (used by pricing/settings/billing pages) and the Developer Portal (`app/developer/developer.js`) with the same approach.

### Migration strategy (backward compatibility)

Both `KShared.getToken()` and the developer portal now read `sessionStorage` first, then fall back to `localStorage`. This means:

1. **Existing sessions in `localStorage`** will still work on first load — the token is read from `localStorage` and used transparently.
2. **New logins** write to `sessionStorage` only, and any old `localStorage` token is removed on login/logout.
3. **After the first logout/re-login**, the token is fully migrated to `sessionStorage`.

### Impact

- Users will need to re-login in the developer portal if they previously had a token in `localStorage` (it will still work until they close the tab, then they'll be prompted to log in again).
- No backend changes required.

---

## WhatsApp Verify Token (no default)

**Applies to:** `server/whatsapp.js` webhook verification

`WA_VERIFY_TOKEN` no longer has a predictable default value (`kelionai_wa_verify_2026`). You **must** set `WA_VERIFY_TOKEN` (or `WHATSAPP_VERIFY_TOKEN`) in your environment variables.

If the env var is not set, webhook verification will be **disabled** (all verification requests return 403) and a warning will be logged at startup.

**Action required:** Set `WA_VERIFY_TOKEN=<your-unique-string>` in your production environment (Railway, Render, etc.) and in your Meta App webhook configuration.

---

## Playwright / CI: `BASE_URL` env var

**Applies to:** `playwright.config.js`, GitHub Actions workflows

`playwright.config.js` now reads `BASE_URL` from the environment with fallback to `https://kelionai.app`. This allows running E2E tests against a local or staging server:

```bash
BASE_URL=http://localhost:3000 npx playwright test
```

GitHub Actions passes `BASE_URL` from repository variables (`vars.BASE_URL`). If not set, it defaults to the production URL.

E2E tests in CI are `continue-on-error: true` and do not block deploys.
