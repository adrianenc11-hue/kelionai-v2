# Testing Kelion (kelionai-v2)

Scope: running the full local stack, proving passkey-gated flows without a real
authenticator, and proving server-side persona / tool-call injection without a
real `GEMINI_API_KEY`.

## Devin Secrets Needed

For local adversarial testing, **none of the live API keys are required** — the
secret shortcuts below substitute the LLM and the WebAuthn client. For *live*
verification on `kelionai.app` after merge, the following must be set in
Railway:

- `GEMINI_API_KEY` — live voice + fact extraction
- `APP_BASE_URL=https://kelionai.app` — drives WebAuthn RP ID
- `JWT_SECRET` — any 32+ char string, must match what signs the session cookie
- `SESSION_SECRET` — any 32+ char string

## Local stack startup

```bash
# Backend
cd server
APP_BASE_URL=http://localhost:5173 \
JWT_SECRET=test-jwt-secret-at-least-32-chars-aa \
SESSION_SECRET=test-session-secret-32-chars-longxx \
PORT=4100 \
DATABASE_URL="sqlite://./data/kelion.db" \
node src/index.js

# Frontend (in another shell)
cd /path/to/kelionai-v2
echo 'VITE_API_BASE_URL=http://localhost:4100' > .env.local
npm run dev -- --port 5173 --host
```

The frontend **must** have `VITE_API_BASE_URL` set or the Vite proxy defaults to
`:3001` and every `/api` call will hang.

## Simulating a signed-in passkey user (WebAuthn workaround)

`navigator.credentials.create()` does not reliably complete when a CDP Virtual
Authenticator is attached (Chromium 137; same symptom as Playwright issue
#32112 and Chrome DevTools MCP feature request #1004). In the future this may
be fixed — try a plain `addVirtualAuthenticator` + click-through first and fall
back to the workaround below if `create()` hangs indefinitely.

**Workaround** — mint the exact JWT that `/api/auth/passkey/register/verify`
issues on success, using the server's own `signAppToken` helper:

1. Call `POST /api/auth/passkey/register/options` with `{name: "friend"}` to
   get a real `userId` and create the DB row.
2. Mint the cookie:

   ```bash
   cd server
   node -e "
     const { signAppToken } = require('./src/middleware/auth');
     const t = signAppToken({ id: <userId>, name: 'friend', email: 'passkey-test@kelion.local' });
     console.log(t);
   "
   ```

3. Set the cookie into the Chromium session via CDP `Network.setCookie`
   (`httpOnly:true`, `sameSite:'Lax'`, `domain:'localhost'`).
4. Reload the page so React re-probes `/api/auth/passkey/me`.

This exercises the same `requireAuth` middleware and downstream code paths as
the real flow. The only thing NOT proven is the
`navigator.credentials.create/get` client roundtrip and the WebAuthn
cryptographic verify — those must be verified on a real device on
`kelionai.app`.

## Proving server-side persona / tool injection (captor pattern)

`GET /api/realtime/gemini-token` builds the Kelion persona string and POSTs it
to `generativelanguage.googleapis.com`. To prove the persona actually contains
the signed-in user's memory without a real Gemini key:

1. Temporarily make the outbound URL honor `process.env.GEMINI_API_BASE`:

   ```js
   // server/src/routes/realtime.js
   const url = (process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com')
     + '/v1beta/auth_tokens?key=' + encodeURIComponent(apiKey);
   ```

2. Run a captor on `127.0.0.1:4399` that writes the body to a tempfile and
   responds `{name: 'authTokens/captured-fake-token'}`.
3. Start the backend with `GEMINI_API_KEY=fake-for-test
   GEMINI_API_BASE=http://127.0.0.1:4399`.
4. `curl -b "kelion.token=<jwt>"
   http://localhost:4100/api/realtime/gemini-token?lang=en-US` and grep the
   captured body for your expected substrings.
5. Revert the `realtime.js` edit and restart before committing anything.

This is the only reliable way to catch the
"drawer-shows-facts-but-Gemini-never-gets-them" silent failure.

## Menu assertions per auth state

The `⋯` menu is the single source of truth for auth state in the UI:

| State | Rows (top→bottom) |
|-------|-------------------|
| Unsigned | `Turn camera on` · `Share screen` · `Show transcript` · `Remember me` · `End chat` |
| Signed | `Turn camera on` · `Share screen` · `Show transcript` · `What do you know about me?` · `Sign out` · `End chat` |

Camera/screen/end-chat are `disabled=true` when no session is active.

## Memory drawer invariants

- Header: `WHAT I KNOW ABOUT YOU`
- Empty-state body: `Nothing yet. Keep talking — I'll pick up on things worth remembering and save them here. You can review and delete anything.`
- Fact cards: kind tag rendered uppercased (`GOAL`, `PREFERENCE`, `ROUTINE`, etc.)
- `Forget everything` button only appears when `items.length > 0`
- `GET /api/memory?limit=200` is `ORDER BY created_at DESC`; for identical
  timestamps SQLite resolves ties by rowid ASC (known, not a bug).

## Seeding test facts via SQL (bypass LLM extraction)

```bash
sqlite3 server/data/kelion.db \
  "INSERT INTO memory_items (user_id, kind, fact) VALUES (<userId>, 'goal', 'Adrian is learning Spanish');"
```

Valid `kind` values the persona formatter accepts: `identity`, `preference`,
`goal`, `routine`, `relationship`, `skill`, `context`.

## CI expectations

- When a Stage-N PR targets the Stage-(N-1) branch (chain PRs) GitHub Actions
  does **not** dispatch. That is expected. Do not block on 0/0/0/0. CI
  hard-gates only when the chain collapses into master.
- Skip-able failing jobs from earlier stages are pre-existing UI acceptance
  tests for screens that no longer exist (admin/plans/referral were removed
  in Stage 1). Those are expected failures until someone rewrites them.

## Things to watch for in the future

- **Chromium WebAuthn automation may start working** — retest periodically;
  once `navigator.credentials.create()` resolves under CDP, the JWT-minting
  workaround can be dropped in favor of full E2E.
- **If `/api` requests hang from the page but work from curl on :4100** check
  `.env.local` has `VITE_API_BASE_URL=http://localhost:4100`.
- **If `/me` always returns `signedIn:false`** the JWT was signed with a
  different secret than the one the backend started with — re-run `mint.js`
  with `JWT_SECRET` matching the running server's env.
