// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'https://kelionai.app';

// ─── API helpers ────────────────────────────────────────────────────────────

async function apiGet(request, path) {
  return request.get(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function apiPost(request, path, body = {}) {
  return request.post(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    data: body,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. SERVER HEALTH
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Server health', () => {
  test('GET /health returns 200 and status:ok', async ({ request }) => {
    const res = await apiGet(request, '/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.ts).toBeTruthy();
  });

  test('GET /ping returns 200', async ({ request }) => {
    const res = await apiGet(request, '/ping');
    expect(res.status()).toBe(200);
  });

  test('GET /nonexistent returns 404', async ({ request }) => {
    const res = await apiGet(request, '/api/nonexistent-route-xyz');
    expect(res.status()).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FRONTEND PAGES
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Frontend pages', () => {
  test('Landing page loads and shows KelionAI', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/kelion/i);
    await expect(page.locator('text=KelionAI').first()).toBeVisible();
  });

  test('Landing page has Sign In and Pricing buttons', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /sign in/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /pricing/i }).first()).toBeVisible();
  });

  test('Landing page has Start Free Demo button', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /demo/i }).first()).toBeVisible();
  });

  test('Pricing page loads via button', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /pricing/i }).first().click();
    await expect(page.locator('text=/planuri|pricing|plans/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('Login page loads via Sign In', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('Login page has Google Sign In button', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await expect(page.locator('text=/google/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('Login page has Register toggle', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await expect(page.locator('text=/register|create account/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('No JS console errors on landing page', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    expect(errors.filter(e => !e.includes('ResizeObserver') && !e.includes('non-passive'))).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. API — SUBSCRIPTION PLANS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('API /api/subscription/plans', () => {
  test('returns 200 with plan array', async ({ request }) => {
    const res = await apiGet(request, '/api/subscription/plans');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.plans)).toBe(true);
    expect(body.plans.length).toBeGreaterThanOrEqual(4);
  });

  test('plans include free, basic, premium, enterprise', async ({ request }) => {
    const res = await apiGet(request, '/api/subscription/plans');
    const { plans } = await res.json();
    const ids = plans.map(p => p.id);
    expect(ids).toContain('free');
    expect(ids).toContain('basic');
    expect(ids).toContain('premium');
    expect(ids).toContain('enterprise');
  });

  test('enterprise plan has null dailyLimit', async ({ request }) => {
    const res = await apiGet(request, '/api/subscription/plans');
    const { plans } = await res.json();
    const enterprise = plans.find(p => p.id === 'enterprise');
    expect(enterprise).toBeTruthy();
    expect(enterprise.dailyLimit).toBeNull();
  });

  test('free plan has price 0', async ({ request }) => {
    const res = await apiGet(request, '/api/subscription/plans');
    const { plans } = await res.json();
    const free = plans.find(p => p.id === 'free');
    expect(free.price).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. API — AUTH PROTECTION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('API auth protection', () => {
  test('GET /api/users/me returns 401 when unauthenticated', async ({ request }) => {
    const res = await apiGet(request, '/api/users/me');
    expect(res.status()).toBe(401);
  });

  test('GET /auth/me returns 401 when unauthenticated', async ({ request }) => {
    const res = await apiGet(request, '/auth/me');
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/users returns 401 when unauthenticated', async ({ request }) => {
    const res = await apiGet(request, '/api/admin/users');
    expect(res.status()).toBe(401);
  });

  test('GET /api/payments/history returns 401 when unauthenticated', async ({ request }) => {
    const res = await apiGet(request, '/api/payments/history');
    expect(res.status()).toBe(401);
  });

  test('POST /api/chat returns 401 when unauthenticated', async ({ request }) => {
    const res = await apiPost(request, '/api/chat', { messages: [] });
    expect(res.status()).toBe(401);
  });

  test('POST /api/tts returns 401 when unauthenticated', async ({ request }) => {
    const res = await apiPost(request, '/api/tts', { text: 'hello' });
    expect(res.status()).toBe(401);
  });

  test('POST /api/referral/generate returns 401 when unauthenticated', async ({ request }) => {
    const res = await apiPost(request, '/api/referral/generate');
    expect(res.status()).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. API — GOOGLE OAUTH FLOW
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Google OAuth', () => {
  test('GET /auth/google/start redirects to Google', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/start`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'];
    expect(location).toContain('accounts.google.com');
  });

  test('OAuth start sets oauth_state cookie', async ({ page }) => {
    const res = await page.request.get(`${BASE}/auth/google/start`, { maxRedirects: 0 });
    const cookies = res.headers()['set-cookie'] || '';
    expect(cookies).toContain('oauth_state');
  });

  test('OAuth callback with no state returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/callback?code=abc`);
    expect(res.status()).toBe(400);
  });

  test('OAuth callback with wrong state returns 400', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/callback?code=abc&state=wrong`);
    expect(res.status()).toBe(400);
  });

  test('OAuth callback with error param redirects with auth_error', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/callback?error=access_denied`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'] || '';
    expect(location).toContain('auth_error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. API — LOCAL AUTH
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Local auth', () => {
  test('POST /auth/local/register returns 400 with missing fields', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/register', { email: 'test@test.com' });
    expect(res.status()).toBe(400);
  });

  test('POST /auth/local/register returns 400 with invalid email', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/register', {
      email: 'not-an-email', password: 'password123', name: 'Test',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email/i);
  });

  test('POST /auth/local/register returns 400 with short password', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/register', {
      email: 'test@example.com', password: '123', name: 'Test',
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/password/i);
  });

  test('POST /auth/local/login returns 401 with wrong credentials', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/login', {
      email: 'nobody@nowhere.com', password: 'wrongpassword123',
    });
    expect(res.status()).toBe(401);
  });

  test('POST /auth/local/login returns 400 with missing fields', async ({ request }) => {
    const res = await apiPost(request, '/auth/local/login', { email: 'test@test.com' });
    expect(res.status()).toBe(400);
  });

  test('Full register → login flow', async ({ request }) => {
    const unique = `e2e_${Date.now()}@test.kelionai.app`;

    // Register
    const regRes = await apiPost(request, '/auth/local/register', {
      email: unique, password: 'TestPass123!', name: 'E2E Test',
    });
    expect(regRes.status()).toBe(201);
    const regBody = await regRes.json();
    expect(regBody.token).toBeTruthy();
    expect(regBody.user.email).toBe(unique);

    // Login
    const loginRes = await apiPost(request, '/auth/local/login', {
      email: unique, password: 'TestPass123!',
    });
    expect(loginRes.status()).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.token).toBeTruthy();
  });

  test('Duplicate register returns 409', async ({ request }) => {
    const unique = `dup_${Date.now()}@test.kelionai.app`;

    await apiPost(request, '/auth/local/register', {
      email: unique, password: 'TestPass123!', name: 'First',
    });

    const res2 = await apiPost(request, '/auth/local/register', {
      email: unique, password: 'TestPass123!', name: 'Second',
    });
    expect(res2.status()).toBe(409);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. API — AUTHENTICATED USER FLOW
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Authenticated user flow', () => {
  let authToken;
  let userId;

  test.beforeAll(async ({ request }) => {
    const unique = `auth_flow_${Date.now()}@test.kelionai.app`;
    const res = await apiPost(request, '/auth/local/register', {
      email: unique, password: 'AuthFlow123!', name: 'Auth Flow User',
    });
    const body = await res.json();
    authToken = body.token;
    userId = body.user?.id;
  });

  test('GET /api/users/me returns user profile', async ({ request }) => {
    const res = await request.get(`${BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.email).toContain('@test.kelionai.app');
    expect(body.subscription_tier).toBe('free');
    expect(body.usage).toBeDefined();
    expect(typeof body.usage.today).toBe('number');
    expect(body.usage.daily_limit).toBe(10);
  });

  test('PUT /api/users/me updates name', async ({ request }) => {
    const res = await request.put(`${BASE}/api/users/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: { name: 'Updated E2E Name' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated E2E Name');
  });

  test('PUT /api/users/me returns 400 with empty name', async ({ request }) => {
    const res = await request.put(`${BASE}/api/users/me`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      data: { name: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/admin/users returns 403 for non-admin', async ({ request }) => {
    const res = await request.get(`${BASE}/api/admin/users`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /api/referral/generate creates a code', async ({ request }) => {
    const res = await request.post(`${BASE}/api/referral/generate`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code).toBeTruthy();
    expect(body.code.length).toBe(8);
    expect(body.expires_at).toBeTruthy();
  });

  test('GET /api/referral/validate/:code validates the generated code', async ({ request }) => {
    // Generate a code first
    const genRes = await request.post(`${BASE}/api/referral/generate`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const { code } = await genRes.json();

    // Validate it
    const valRes = await request.get(`${BASE}/api/referral/validate/${code}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(valRes.status()).toBe(200);
    const body = await valRes.json();
    expect(body.valid).toBe(true);
  });

  test('GET /api/referral/validate/INVALID returns 404', async ({ request }) => {
    const res = await request.get(`${BASE}/api/referral/validate/XXXXXXXX`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status()).toBe(404);
  });

  test('POST /auth/logout clears session', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/logout`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toContain('Logged out');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. API — PAYMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Payment endpoints', () => {
  let authToken;

  test.beforeAll(async ({ request }) => {
    const unique = `pay_${Date.now()}@test.kelionai.app`;
    const res = await apiPost(request, '/auth/local/register', {
      email: unique, password: 'PayTest123!', name: 'Pay Test',
    });
    const body = await res.json();
    authToken = body.token;
  });

  test('POST /api/payments/create-checkout-session returns 400 for free plan', async ({ request }) => {
    const res = await request.post(`${BASE}/api/payments/create-checkout-session`, {
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      data: { planId: 'free' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/payments/create-checkout-session returns 400 for invalid plan', async ({ request }) => {
    const res = await request.post(`${BASE}/api/payments/create-checkout-session`, {
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      data: { planId: 'invalid-plan' },
    });
    expect(res.status()).toBe(400);
  });

  test('GET /api/payments/history returns empty array for new user', async ({ request }) => {
    const res = await request.get(`${BASE}/api/payments/history`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.payments)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. CHAT & TTS — USAGE LIMIT (free plan = 10/day)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Chat & TTS guards', () => {
  test('POST /api/chat returns 503 if OpenAI not configured (or 200 stream)', async ({ request }) => {
    const unique = `chat_${Date.now()}@test.kelionai.app`;
    const reg = await apiPost(request, '/auth/local/register', {
      email: unique, password: 'ChatTest123!', name: 'Chat Test',
    });
    const { token } = await reg.json();

    const res = await request.post(`${BASE}/api/chat`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { messages: [{ role: 'user', content: 'hello' }], avatar: 'kelion' },
    });
    // Either works (200 stream) or AI not configured (503) — both are valid
    expect([200, 503]).toContain(res.status());
  });

  test('POST /api/tts returns 400 for empty text', async ({ request }) => {
    const unique = `tts_${Date.now()}@test.kelionai.app`;
    const reg = await apiPost(request, '/auth/local/register', {
      email: unique, password: 'TtsTest123!', name: 'TTS Test',
    });
    const { token } = await reg.json();

    const res = await request.post(`${BASE}/api/tts`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { text: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /api/tts returns 400 for text over 2000 chars', async ({ request }) => {
    const unique = `tts2_${Date.now()}@test.kelionai.app`;
    const reg = await apiPost(request, '/auth/local/register', {
      email: unique, password: 'TtsTest123!', name: 'TTS Test2',
    });
    const { token } = await reg.json();

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
  test('Response has X-Content-Type-Options header', async ({ request }) => {
    const res = await apiGet(request, '/health');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('Response has X-Frame-Options header', async ({ request }) => {
    const res = await apiGet(request, '/health');
    const xfo = res.headers()['x-frame-options'];
    expect(xfo).toBeTruthy();
  });

  test('API does not expose x-powered-by Express header', async ({ request }) => {
    const res = await apiGet(request, '/health');
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });
});
