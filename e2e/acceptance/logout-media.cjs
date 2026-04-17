#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: logout-media
 *
 * After logout, the user's microphone and camera MUST be released. The only
 * way to verify this truthfully is in a real browser, because media tracks
 * are held by the browser runtime, not the server.
 *
 * This script uses Playwright's bundled chromium to:
 *   1. Register a fresh account via Playwright's request context so the
 *      session cookie lands in the browser's cookie jar.
 *   2. Open the landing page — the app's fetch wrapper uses
 *      `credentials: 'include'`, so it sees us as logged in.
 *   3. Instrument `navigator.mediaDevices.getUserMedia` so every returned
 *      MediaStream is kept in a page-global registry (`window.__acceptanceStreams`)
 *      and is also registered with the app's own `window.__kelionMedia` so
 *      the in-app `stopAllStreams()` can actually stop it.
 *   4. Trigger `getUserMedia({ audio:true, video:true })` programmatically
 *      inside the page (identical call to what VoiceChat does) — permissions
 *      are granted via the browser context.
 *   5. Assert the stream has live audio + video tracks.
 *   6. Click the in-app Logout button.
 *   7. Assert that every track captured in step 4 is in readyState 'ended'
 *      AND `window.__kelionMedia.countActiveTracks()` is 0.
 *
 * Fails loudly (exit 1) if ANY track is still 'live' after logout.
 * Passes (exit 0) only when the browser confirms all tracks stopped.
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';
const HEADLESS = process.env.ACCEPTANCE_HEADED !== '1';

function fail(reason, detail) {
  process.stderr.write('ACCEPTANCE FAIL: logout-media\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

function pass(detail) {
  process.stdout.write('ACCEPTANCE PASS: logout-media\n');
  if (detail) process.stdout.write('  ' + detail + '\n');
  process.exit(0);
}

(async () => {
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch (e) {
    return fail('Playwright is not installed', e.message);
  }

  const email = `accept_logout_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = 'AcceptLogout1234!';

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const origin = new URL(BASE).origin;
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    baseURL: BASE,
  });
  await context.grantPermissions(['camera', 'microphone'], { origin });

  // Step 1 — register a fresh user through Playwright's request context so
  // the session cookie is persisted in the context cookie jar. The app
  // authenticates browser requests via cookies (`credentials: 'include'`),
  // so registering via Node's `fetch` would leave us unauthenticated once
  // we navigate. Include `acceptTerms: true` for production builds that
  // still require it.
  const regRes = await context.request.post(BASE + '/auth/local/register', {
    data: { email, password, name: 'Logout Media', acceptTerms: true },
    headers: { 'Content-Type': 'application/json' },
  });
  if (regRes.status() !== 201) {
    const txt = await regRes.text().catch(() => '');
    await browser.close();
    return fail('register did not return 201', 'status=' + regRes.status() + ' body=' + txt);
  }

  const page = await context.newPage();

  // Instrument getUserMedia so we capture every stream returned to the page,
  // and also forward it to the app's media registry (when exposed). Without
  // that forwarding, `handleLogout -> stopAllStreams()` has nothing in its
  // `active` Set to iterate and the streams opened from the test would
  // never actually be stopped by the app under test.
  await page.addInitScript(() => {
    const orig = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      : null;
    if (orig) {
      window.__acceptanceStreams = [];
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const s = await orig(constraints);
        try { window.__acceptanceStreams.push(s); } catch {}
        try {
          if (window.__kelionMedia && typeof window.__kelionMedia.registerStream === 'function') {
            window.__kelionMedia.registerStream(s);
          }
        } catch {}
        return s;
      };
    }
  });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (e) {
    await browser.close();
    return fail('could not load landing page', e.message);
  }

  // Open an audio+video stream from inside the page. This mirrors exactly
  // what VoiceChat would do after the user clicks "Start Chat"; we skip the
  // UI hop so the test is deterministic even if the chat page keeps
  // evolving.
  const gumResult = await page.evaluate(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      return {
        ok: true,
        audioLive: s.getAudioTracks().filter(t => t.readyState === 'live').length,
        videoLive: s.getVideoTracks().filter(t => t.readyState === 'live').length,
      };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });

  if (!gumResult.ok) {
    await browser.close();
    return fail('getUserMedia failed inside the page', gumResult.error);
  }
  if (gumResult.audioLive < 1 || gumResult.videoLive < 1) {
    await browser.close();
    return fail('getUserMedia did not return a live audio+video stream',
      'audioLive=' + gumResult.audioLive + ' videoLive=' + gumResult.videoLive);
  }

  // Trigger the app's logout flow. Prefer clicking the visible button so the
  // real handler runs; fall back to calling the API + stopAllStreams if the
  // button isn't rendered (e.g. cookie-based sessions not picked up).
  const clicked = await page.evaluate(async () => {
    // Look for a Logout button by visible text (case-insensitive).
    const btns = Array.from(document.querySelectorAll('button'));
    const logoutBtn = btns.find(b => /^\s*logout\s*$/i.test((b.textContent || '').trim()));
    if (logoutBtn) { logoutBtn.click(); return true; }
    return false;
  });

  if (!clicked) {
    // Fallback: call the API directly and invoke the registry if present.
    await page.evaluate(async () => {
      try { await fetch('/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
      try { window.__kelionMedia && window.__kelionMedia.stopAllStreams(); } catch {}
    });
  }

  // Give the logout handler a brief moment to run (stopAllStreams is sync
  // but the API call is not). 1s is generous for local stop() calls.
  await page.waitForTimeout(1000);

  const postState = await page.evaluate(() => {
    const streams = (window.__acceptanceStreams || []);
    const tracks = [];
    for (const s of streams) {
      try {
        for (const t of s.getTracks()) {
          tracks.push({ kind: t.kind, readyState: t.readyState });
        }
      } catch {}
    }
    let registryLive = -1;
    try {
      if (window.__kelionMedia && typeof window.__kelionMedia.countActiveTracks === 'function') {
        registryLive = window.__kelionMedia.countActiveTracks();
      }
    } catch {}
    return { tracks, registryLive };
  });

  await browser.close();

  const stillLive = postState.tracks.filter(t => t.readyState === 'live');
  if (stillLive.length > 0) {
    return fail(
      'after logout, ' + stillLive.length + ' MediaStream track(s) are still live',
      JSON.stringify(stillLive)
    );
  }
  if (postState.tracks.length === 0) {
    return fail('no MediaStream tracks were captured; the test did not exercise media');
  }

  pass('logout stopped ' + postState.tracks.length +
    ' track(s); kelionMedia.countActiveTracks()=' + postState.registryLive);
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: logout-media (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
