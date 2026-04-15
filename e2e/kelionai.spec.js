// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://kelionai.app';

async function apiGet(request, path) {
  return request.get(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' } });
}

async function apiPost(request, path, body = {}) {
  return request.post(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, data: body });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. SERVER HEALTH
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Server health', () => {
  test('GET /health returns 200', async ({ request }) => {
    const res = await apiGet(request, '/health');
    expect(res.status()).toBe(200);
  });

  test('GET /ping returns 200', async ({ request }) => {
    const res = await apiGet(request, '/ping');
    expect(res.status()).toBe(200);
  });

  test('GET /nonexistent returns 404', async ({ request }) => {
    const res = await apiGet(request, '/api/nonexistent');
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FRONTEND PAGES
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Frontend pages', () => {
  test('Landing page loads', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('text=KelionAI').first()).toBeVisible();
  });

  test('Login page loads', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test('Pricing page loads', async ({ page }) => {
    await page.goto(`${BASE}/pricing`);
    await expect(page.locator('text=/free|basic|premium/i').first()).toBeVisible();
  });

  test('Unknown route redirects to /', async ({ page }) => {
    await page.goto(`${BASE}/unknown-route-xyz`);
    await expect(page).toHaveURL(BASE + '/');
  });

  test('Dashboard redirects to login when unauthenticated', async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await expect(page).toHaveURL(/login/);
  });

  test('Profile redirects to login when unauthenticated', async ({ page }) => {
    await page.goto(`${BASE}/profile`);
    await expect(page).toHaveURL(/login/);
  });

  test('Referral redirects to login when unauthenticated', async ({ page }) => {
    await page.goto(`${BASE}/referral`);
    await expect(page).toHaveURL(/login/);
  });

  test('Chat redirects to login when unauthenticated', async ({ page }) => {
    await page.goto(`${BASE}/chat`);
    await expect(page).toHaveURL(/login/);
  });

  test('Admin page shows access denied for non-admin', async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    await expect(page.locator('text=/denied|admin|login/i').first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SUBSCRIPTION PLANS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Subscription plans', () => {
  test('GET /api/subscription/plans returns 200', async ({ request }) => {
    const res = await apiGet(request, '/api/subscription/plans');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.plans.length).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. AUTH PROTECTION (401 unauthenticated)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Auth protection', () => {
  test('GET /api/users/me returns 401', async ({ request }) => {
    expect((await apiGet(request, '/api/users/me')).status()).toBe(401);
  });
  test('GET /auth/me returns 401', async ({ request }) => {
    expect((await apiGet(request, '/auth/me')).status()).toBe(401);
  });
  test('GET /api/admin/users returns 401', async ({ request }) => {
    expect((await apiGet(request, '/api/admin/users')).status()).toBe(401);
  });
  test('GET /api/payments/history returns 401', async ({ request }) => {
    expect((await apiGet(request, '/api/payments/history')).status()).toBe(401);
  });
  test('POST /api/chat returns 401', async ({ request }) => {
    expect((await apiPost(request, '/api/chat', { messages: [] })).status()).toBe(401);
  });
  test('POST /api/tts returns 401', async ({ request }) => {
    expect((await apiPost(request, '/api/tts', { text: 'hi' })).status()).toBe(401);
  });
  test('POST /api/referral/generate returns 401', async ({ request }) => {
    expect((await apiPost(request, '/api/referral/generate')).status()).toBe(401);
  });
  test('POST /api/referral/use returns 401', async ({ request }) => {
    expect((await apiPost(request, '/api/referral/use', { code: 'ABC' })).status()).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. GOOGLE OAUTH
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Google OAuth', () => {
  test('GET /auth/google/start redirects to Google', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/start`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toContain('accounts.google.com');
  });

  test('OAuth callback without state returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/callback?code=abc`);
    expect(res.status()).toBe(400);
  });

  test('OAuth callback with error redirects', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/callback?error=denied`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LOCAL AUTH
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Local auth', () => {
  test('Register returns 400 with missing fields', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/register', { email: 'a@b.com' });
    expect(res.status()).toBe(400);
  });

  test('Register returns 400 with invalid email', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/register', { email: 'bad', password: 'Test1234!', name: 'Test' });
    expect(res.status()).toBe(400);
  });

  test('Register returns 400 with short password', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/register', { email: 'a@b.com', password: '123', name: 'Test' });
    expect(res.status()).toBe(400);
  });

  test('Register returns 400 with weak password', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/register', { email: 'a@b.com', password: 'testtest', name: 'Test' });
    expect(res.status()).toBe(400);
  });

  test('Register returns 400 with short name', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/register', { email: 'a@b.com', password: 'Test1234!', name: 'A' });
    expect(res.status()).toBe(400);
  });

  test('Login returns 400 with missing fields', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/login', { email: 'a@b.com' });
    expect(res.status()).toBe(400);
  });

  test('Login returns 401 with wrong credentials', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/login', { email: 'no@one.com', password: 'Wrong123!' });
    expect(res.status()).toBe(401);
  });

  test('Full register and login flow returns 201 and 200', async ({ request }) => {
    const email = `e2e_${Date.now()}@test.kelionai.app`;
    const reg = await apiPost(request, '/auth/local/register', { email, password: 'Test1234!', name: 'E2E User' });
    expect(reg.status()).toBe(201);
    const regBody = await reg.json();
    expect(regBody.token).toBeTruthy();

    const login = await apiPost(request, '/auth/local/login', { email, password: 'Test1234!' });
    expect(login.status()).toBe(200);
    const loginBody = await login.json();
    expect(loginBody.token).toBeTruthy();
  });

  test('Duplicate register returns 409', async ({ request }) => {
    const email = `dup_${Date.now()}@test.kelionai.app`;
    const first = await apiPost(request, '/auth/local/register', { email, password: 'Test1234!', name: 'First' });
    expect(first.status()).toBe(201);
    const res = await apiPost(request, '/auth/local/register', { email, password: 'Test1234!', name: 'Second' });
    expect(res.status()).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. AUTHENTICATED USER FLOW
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Authenticated user', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    const email = `auth_${Date.now()}@test.kelionai.app`;
    const res = await apiPost(request, '/auth/local/register', { email, password: 'Auth1234!', name: 'Auth User' });
    token = (await res.json()).token;
  });

  test('GET /api/users/me returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/users/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.email).toContain('@test.kelionai.app');
    expect(body.subscription_tier).toBe('free');
  });

  test('GET /auth/me returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
  });

  test('PUT /api/users/me returns 200', async ({ request }) => {
    const res = await request.put(`${BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'New Name' },
    });
    expect(res.status()).toBe(200);
  });

  test('PUT /api/users/me returns 400 with empty name', async ({ request }) => {
    const res = await request.put(`${BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/admin/users returns 403 for non-admin', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(403);
  });

  test('POST /api/referral/generate returns 200', async ({ request }) => {
    const res = await request.post(`${BASE}/api/referral/generate`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code.length).toBe(8);
  });

  test('GET /api/referral/validate/:code returns 200', async ({ request }) => {
    const gen = await request.post(`${BASE}/api/referral/generate`, { headers: { Authorization: `Bearer ${token}` } });
    const { code } = await gen.json();
    const res = await request.get(`${BASE}/api/referral/validate/${code}`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
  });

  test('GET /api/referral/validate/INVALID returns 404', async ({ request }) => {
    const res = await request.get(`${BASE}/api/referral/validate/XXXXXXXX`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(404);
  });

  test('POST /api/referral/use without code returns 400', async ({ request }) => {
    const res = await request.post(`${BASE}/api/referral/use`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {},
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/referral/use with own code returns 400', async ({ request }) => {
    const gen = await request.post(`${BASE}/api/referral/generate`, { headers: { Authorization: `Bearer ${token}` } });
    const { code } = await gen.json();
    const res = await request.post(`${BASE}/api/referral/use`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { code },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /auth/logout returns 200', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/logout`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Payments', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    const email = `pay_${Date.now()}@test.kelionai.app`;
    const res = await apiPost(request, '/auth/local/register', { email, password: 'Pay12345!', name: 'Pay User' });
    token = (await res.json()).token;
  });

  test('POST /api/payments/create-checkout-session returns 400 for free plan', async ({ request }) => {
    const res = await request.post(`${BASE}/api/payments/create-checkout-session`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { planId: 'free' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/payments/create-checkout-session returns 400 for invalid plan', async ({ request }) => {
    const res = await request.post(`${BASE}/api/payments/create-checkout-session`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { planId: 'invalid' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/payments/history returns 200', async ({ request }) => {
    const res = await request.get(`${BASE}/api/payments/history`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
  });

  test('POST /api/payments/webhook returns 400 with invalid signature', async ({ request }) => {
    const res = await request.post(`${BASE}/api/payments/webhook`, {
      headers: { 'Content-Type': 'application/json', 'stripe-signature': 'invalid' },
      data: {},
    });
    expect(res.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. CHAT & TTS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Chat & TTS', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    const email = `chat_${Date.now()}@test.kelionai.app`;
    const res = await apiPost(request, '/auth/local/register', { email, password: 'Chat1234!', name: 'Chat User' });
    token = (await res.json()).token;
  });

  test('POST /api/chat returns 200 or 503', async ({ request }) => {
    const res = await request.post(`${BASE}/api/chat`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect([200, 503]).toContain(res.status());
  });

  test('POST /api/chat returns 400 for non-array messages', async ({ request }) => {
    const res = await request.post(`${BASE}/api/chat`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { messages: 'not-array' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/chat/demo returns 200 or 503', async ({ request }) => {
    const res = await apiPost(request, '/api/chat/demo', { messages: [{ role: 'user', content: 'hello' }] });
    expect([200, 503]).toContain(res.status());
  });

  test('POST /api/chat/demo returns 400 for non-array messages', async ({ request }) => {
    const res = await apiPost(request, '/api/chat/demo', { messages: 'bad' });
    expect(res.status()).toBe(400);
  });

  test('POST /api/tts returns 400 for empty text', async ({ request }) => {
    const res = await request.post(`${BASE}/api/tts`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { text: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/tts returns 400 for text over 2000 chars', async ({ request }) => {
    const res = await request.post(`${BASE}/api/tts`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { text: 'a'.repeat(2001) },
    });
    expect(res.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. SECURITY HEADERS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Security headers', () => {
  test('X-Content-Type-Options is nosniff', async ({ request }) => {
    const res = await apiGet(request, '/health');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('X-Frame-Options is set', async ({ request }) => {
    const res = await apiGet(request, '/health');
    expect(res.headers()['x-frame-options']).toBeTruthy();
  });

  test('x-powered-by is not exposed', async ({ request }) => {
    const res = await apiGet(request, '/health');
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });

  test('Content-Security-Policy is set', async ({ request }) => {
    const res = await apiGet(request, '/health');
    expect(res.headers()['content-security-policy']).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. CSRF COOKIE
// ═══════════════════════════════════════════════════════════════════════════
test.describe('CSRF', () => {
  test('GET /health sets kelion.csrf cookie', async ({ request }) => {
    const res = await apiGet(request, '/health');
    const cookies = res.headers()['set-cookie'] || '';
    expect(cookies).toContain('kelion.csrf');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. REAL UI FLOWS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Real UI flows', () => {
  test('UI register flow', async ({ page }) => {
    const email = `uireg_${Date.now()}@test.kelionai.app`;
    await page.goto(`${BASE}/login`);
    await page.click('text=/register|create account|sign up/i');
    await page.waitForSelector('input[name="name"], input[placeholder*="name" i]', { timeout: 5000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'Test1234!');
    await page.fill('input[name="name"], input[placeholder*="name" i]', 'UI Test');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|chat/, { timeout: 10000 });
  });

  test('UI login and access protected pages', async ({ page }) => {
    const email = `uilogin_${Date.now()}@test.kelionai.app`;
    // Register first via API
    await page.request.post(`${BASE}/auth/local/register`, {
      data: { email, password: 'Test1234!', name: 'UI Login' },
    });
    // Login via UI
    await page.goto(`${BASE}/login`);
    await page.locator('button[type="submit"]').waitFor({ state: 'visible' });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'Test1234!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/dashboard|chat/, { timeout: 10000 });
    // Access protected pages
    await page.goto(`${BASE}/dashboard`);
    await expect(page.locator('text=/dashboard|welcome|chat/i').first()).toBeVisible();
    await page.goto(`${BASE}/profile`);
    await expect(page.locator('input[type="text"]').first()).toBeVisible();
    await page.goto(`${BASE}/chat`);
    await expect(page.locator('text=/kelion|kira|avatar/i').first()).toBeVisible();
  });
});
