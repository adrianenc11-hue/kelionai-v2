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
 *   4. The voice token endpoint responds with a structured JSON response
 *      containing the Claude Opus model info for REST Voice Mode.
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

test.describe('Voice session token endpoint (Configured Model)', () => {
  test('Returns configured model and backend information', async ({ request }) => {
    // The voice token endpoint returns the configured chat model info for
    // REST Voice Mode (SpeechRecognition → REST → TTS).
    // No ephemeral token is minted — the client uses REST mode.
    const res = await request.get(`${BASE}/api/realtime/voice-token?lang=en-US`);
    if ([401, 402, 403, 503].includes(res.status())) {
      // E2E environments often exhaust free usage limits (401/402/403) or
      // miss the Google API key (503). That's not a failure of the contract.
      return;
    }
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(['openrouter', 'google-ai-studio']).toContain(body.backend);
    expect(typeof body.model).toBe('string');
    expect(body.model.length).toBeGreaterThan(0);
    // OpenRouter models have a slash, Google ones do not necessarily
    if (body.backend === 'openrouter') {
      expect(body.model).toMatch(/\//); // OpenRouter uses "vendor/model" slugs
    }
    expect(body.token).toBeNull();
  });
});
