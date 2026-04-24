// @ts-check
import { test, expect } from '@playwright/test';

/**
 * E2E spec for the Kelion product (Stages 1–6).
 *
 * Scope per Kelion spec: the UI is a single page — 3D avatar in a luxury TV
 * studio + a `⋯` menu. There is no landing page, no chat route, no admin,
 * no subscription plans, no Google OAuth button, no trial timer.
 *
 * This spec runs against `BASE_URL` (default: vite preview on 127.0.0.1:5173
 * proxied to the backend on :3001). It intentionally avoids asserting
 * features that are not in the product anymore — doing so would be what
 * RULES.md calls "teste triviale care verifica continut static".
 *
 * It asserts ONLY things a real user would notice:
 *   1. The server is alive (/health, /ping).
 *   2. The homepage HTML actually renders the Kelion shell (root div + JS).
 *   3. Old product routes do not leave the user on an admin/chat/plans page.
 *   4. The Gemini Live token endpoint responds with a structured JSON error
 *      when GEMINI_API_KEY is not set (the CI case) and does NOT crash the
 *      server or leak a stack trace.
 */

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';

test.describe('Server health', () => {
  test('GET /health returns 200 with status=ok', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('GET /ping returns a pong', async ({ request }) => {
    const res = await request.get(`${BASE}/ping`);
    expect(res.status()).toBe(200);
    const text = (await res.text()).toUpperCase();
    expect(text).toContain('PONG');
  });

  test('GET /api/nonexistent returns JSON 404', async ({ request }) => {
    const res = await request.get(`${BASE}/api/nonexistent-endpoint`);
    expect(res.status()).toBe(404);
    const body = await res.json().catch(() => null);
    expect(body).toBeTruthy();
  });
});

test.describe('Frontend shell', () => {
  test('GET / returns HTML with the Vite bundle and a root element', async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root"');
    // Vite preview ships a module script built from src/main.jsx
    expect(html).toMatch(/<script[^>]+type="module"/);
  });

  test('Unknown route serves the SPA shell (client-side router takes over)', async ({ request }) => {
    const res = await request.get(`${BASE}/definitely-not-a-route-xyz`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root"');
  });

  // DS-2 — Kelion Studio route must be served by the SPA shell so the
  // client router can mount <KelionStudio />. The Monaco bundle itself
  // is lazy-loaded and not worth asserting here; what we DO care about
  // is that a direct page-load of /studio (e.g. a bookmarked URL)
  // doesn't 404 or redirect away from the shell.
  test('GET /studio serves the SPA shell so client router can mount KelionStudio', async ({ request }) => {
    const res = await request.get(`${BASE}/studio`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain('<div id="root"');
    expect(html).toMatch(/<script[^>]+type="module"/);
  });
});

test.describe('Kelion Studio API (DS-1 / DS-3) wiring', () => {
  // All /api/studio/* routes sit behind requireAuth; with no session
  // cookie the server must 401 and (crucially) not leak a stack trace
  // via the JSON body. These tests guard against accidentally making
  // the router public or letting a handler throw on the unauth path.
  test('GET /api/studio/usage rejects anonymous callers with JSON 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/studio/usage`);
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => null);
    expect(body).toBeTruthy();
    // Error shape is stable — UI (KelionStudio.jsx) shows the message
    // verbatim in a toast, so changes here are user-visible.
    expect(typeof body.error).toBe('string');
    expect(body.error.length).toBeGreaterThan(0);
    // No stack trace should ever bleed through.
    expect(JSON.stringify(body)).not.toMatch(/\bat [A-Za-z]+\s*\([^)]*\.js:/);
  });

  test('GET /api/studio/workspaces rejects anonymous callers with JSON 401', async ({ request }) => {
    const res = await request.get(`${BASE}/api/studio/workspaces`);
    expect(res.status()).toBe(401);
    const body = await res.json().catch(() => null);
    expect(body).toBeTruthy();
    expect(typeof body.error).toBe('string');
  });
});

test.describe('Gemini Live token endpoint (Stage 1 precondition)', () => {
  test('Vertex default returns either a valid setup (prod) or an honest 503 (unconfigured CI)', async ({ request }) => {
    // The default backend is Vertex AI (see server/src/routes/realtime.js).
    // Vertex authenticates server-side via a GCP service account in the WS
    // proxy; the token endpoint intentionally returns `token: null` because
    // the browser does not need an ephemeral credential.
    //
    // Shape depends on deployment:
    //   - Production (has GOOGLE_CLOUD_PROJECT or project_id in
    //     GCP_SERVICE_ACCOUNT_JSON): 200 with backend='vertex', token=null,
    //     and a setup block whose model is the fully-qualified
    //     `projects/<P>/locations/<L>/publishers/google/models/<M>` path.
    //   - CI / fresh dev box (neither env): 503 with a clear message
    //     explaining that Vertex is unconfigured and how to escape-hatch
    //     via `?backend=aistudio`. This is the new guard added alongside
    //     the default flip — previously the handler would silently return
    //     200 with a bare `models/<M>` path that Vertex then rejects with
    //     close code 1007. Catching it here turns a silent misconfig into
    //     a loud, actionable error.
    const res = await request.get(`${BASE}/api/realtime/gemini-token?lang=en-US`);
    if (res.status() === 503) {
      const body = await res.json();
      expect(body.error).toMatch(/Vertex backend is unconfigured/i);
      return;
    }
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.backend).toBe('vertex');
    expect(body.token).toBeNull();
    expect(body.setup).toBeTruthy();
    expect(typeof body.setup.systemInstruction.parts[0].text).toBe('string');
    expect(body.setup.model).toMatch(
      /^projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/.+$/,
    );
  });

  test('Forcing ?backend=aistudio exercises the AI Studio ephemeral-token path', async ({ request }) => {
    const res = await request.get(`${BASE}/api/realtime/gemini-token?lang=en-US&backend=aistudio`);
    // On CI GEMINI_API_KEY is unset → 503 is the honest, documented response.
    // If a future CI configuration sets the key we accept a 200 with a token.
    if (res.status() === 503) {
      const body = await res.json();
      expect(body.error).toMatch(/GEMINI_API_KEY/i);
    } else {
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.backend).toBe('aistudio');
      expect(typeof body.token).toBe('string');
      expect(body.token.length).toBeGreaterThan(0);
    }
  });
});
