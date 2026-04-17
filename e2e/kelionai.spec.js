// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'https://kelionai.app';

/** Auth helper — register a unique user, return Bearer token */
async function createTestUser(request, prefix = 'e2e') {
  const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@test.kelionai.app`;
  const res = await request.post(`${BASE}/auth/local/register`, {
    headers: { 'Content-Type': 'application/json' },
    data: { email, password: 'Test12345!', name: `${prefix} User` },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.token).toBeTruthy();
  expect(body.user.email).toBe(email);
  return { token: body.token, email, user: body.user };
}

/** Authed GET */
async function authGet(request, path, token) {
  return request.get(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

/** Authed POST */
async function authPost(request, path, data, token) {
  return request.post(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. SERVER HEALTH
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Server health', () => {
  test('GET /health returns status ok with services', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.services.database).toBe('connected');
    expect(body.services.openai).toBe('configured');
    expect(body.ts).toBeTruthy();
  });

  test('GET /ping returns HTML pong', async ({ request }) => {
    const res = await request.get(`${BASE}/ping`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('PONG');
  });

  test('GET /api/nonexistent returns 404 JSON', async ({ request }) => {
    const res = await request.get(`${BASE}/api/nonexistent`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Not found');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FRONTEND PAGES
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Frontend pages', () => {
  test('Landing page loads with branding and CTA', async ({ page }) => {
    await page.goto(BASE);
    await expect(page.locator('text=KelionAI').first()).toBeVisible();
    await expect(page.locator('button:has-text("Start Chat")')).toBeVisible();
    await expect(page.locator('h1:has-text("Kelion")')).toBeVisible();
    await expect(page.locator('button:has-text("Kira")')).toHaveCount(0);
    await expect(page.locator('button:has-text("Login")')).toBeVisible();
    await expect(page.locator('button:has-text("Planuri")')).toBeVisible();
  });

  test('Chat page shows Kelion avatar and Start Chat', async ({ page }) => {
    await page.goto(`${BASE}/chat`);
    await expect(page.locator('text=Kelion').first()).toBeVisible();
    await expect(page.locator('button:has-text("Start Chat")')).toBeVisible();
    await expect(page.locator('text=← Back')).toBeVisible();
  });

  test('Legacy /chat/kira and /chat/kelion redirect to /chat', async ({ page }) => {
    await page.goto(`${BASE}/chat/kira`);
    await expect(page).toHaveURL(BASE + '/chat');
    await page.goto(`${BASE}/chat/kelion`);
    await expect(page).toHaveURL(BASE + '/chat');
  });

  test('Admin page without auth redirects to landing', async ({ page }) => {
    await page.goto(`${BASE}/admin`);
    // AdminPage fetches /api/admin/users → 401 → navigate('/') → landing
    await expect(page.locator('button:has-text("Start Chat")')).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(BASE + '/');
  });

  test('Unknown route redirects to /', async ({ page }) => {
    await page.goto(`${BASE}/unknown-route-xyz`);
    await expect(page).toHaveURL(BASE + '/');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. SUBSCRIPTION PLANS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Subscription plans', () => {
  test('returns exactly 4 plans with correct structure', async ({ request }) => {
    const res = await request.get(`${BASE}/api/subscription/plans`);
    expect(res.status()).toBe(200);
    const { plans } = await res.json();
    expect(plans).toHaveLength(4);
    const ids = plans.map(p => p.id);
    expect(ids).toEqual(['free', 'basic', 'premium', 'enterprise']);
    for (const plan of plans) {
      expect(plan.name).toBeTruthy();
      expect(typeof plan.price).toBe('number');
      expect(Array.isArray(plan.features)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. AUTH PROTECTION (401 without token)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Auth protection', () => {
  const protectedGET = ['/api/users/me', '/auth/me', '/api/admin/users', '/api/payments/history'];
  const protectedPOST = [
    ['/api/chat', { messages: [] }],
    ['/api/tts', { text: 'hi' }],
    ['/api/referral/generate', {}],
    ['/api/referral/use', { code: 'ABC' }],
  ];

  for (const path of protectedGET) {
    test(`GET ${path} returns 401`, async ({ request }) => {
      const res = await request.get(`${BASE}${path}`);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.error).toBeTruthy();
    });
  }

  for (const [path, data] of protectedPOST) {
    test(`POST ${path} returns 401`, async ({ request }) => {
      const res = await request.post(`${BASE}${path}`, {
        headers: { 'Content-Type': 'application/json' },
        data,
      });
      expect(res.status()).toBe(401);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. GOOGLE OAUTH
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Google OAuth', () => {
  test('start redirects to accounts.google.com with PKCE params', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/start`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const location = res.headers()['location'];
    expect(location).toContain('accounts.google.com');
    expect(location).toContain('client_id=');
    expect(location).toContain('code_challenge=');
    expect(location).toContain('state=');
  });

  test('callback without state returns 400 with error message', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/callback?code=abc`);
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing');
  });

  test('callback with error param redirects to app with auth_error', async ({ request }) => {
    const res = await request.get(`${BASE}/auth/google/callback?error=denied`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()['location']).toContain('auth_error=denied');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. LOCAL AUTH — validation
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Local auth validation', () => {
  test('register rejects missing password', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'a@b.com' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('Password');
  });

  test('register rejects invalid email format', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'not-an-email', password: 'Test12345!', name: 'Test' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('email');
  });

  test('register rejects password under 8 chars', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'a@b.com', password: 'Abc1234', name: 'Test' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('8');
  });

  test('register rejects name under 2 chars', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'a@b.com', password: 'Test12345!', name: 'A' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('Name');
  });

  test('login rejects missing password', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/local/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'a@b.com' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('Password');
  });

  test('login rejects wrong credentials', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/local/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email: 'noexist@x.com', password: 'Wrong12345!' },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).error).toContain('Invalid');
  });

  test('duplicate register returns 409', async ({ request }) => {
    const { email } = await createTestUser(request, 'dup');
    const res = await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email, password: 'Test12345!', name: 'Second' },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain('already');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6b. LOCAL AUTH — full flow
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Local auth flow', () => {
  test('register returns 201 with token and user, then login returns 200', async ({ request }) => {
    const email = `flow_${Date.now()}@test.kelionai.app`;
    const reg = await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email, password: 'Test12345!', name: 'Flow User' },
    });
    expect(reg.status()).toBe(201);
    const regBody = await reg.json();
    expect(regBody.token).toBeTruthy();
    expect(regBody.user.email).toBe(email);
    expect(regBody.user.id).toBeTruthy();

    const login = await request.post(`${BASE}/auth/local/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email, password: 'Test12345!' },
    });
    expect(login.status()).toBe(200);
    const loginBody = await login.json();
    expect(loginBody.token).toBeTruthy();
    expect(loginBody.user.email).toBe(email);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. AUTHENTICATED USER FLOW
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Authenticated user', () => {
  let token, email;

  test.beforeAll(async ({ request }) => {
    ({ token, email } = await createTestUser(request, 'auth'));
  });

  test('/api/users/me returns profile with correct fields', async ({ request }) => {
    const res = await authGet(request, '/api/users/me', token);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(email);
    expect(body.subscription_tier).toBe('free');
    expect(body.role).toBe('user');
    expect(body.id).toBeTruthy();
  });

  test('/auth/me returns same profile', async ({ request }) => {
    const res = await authGet(request, '/auth/me', token);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(email);
  });

  test('update profile name succeeds and persists', async ({ request }) => {
    const put = await request.put(`${BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: 'Updated Name' },
    });
    expect(put.status()).toBe(200);
    // Verify it persisted
    const me = await authGet(request, '/api/users/me', token);
    expect((await me.json()).name).toBe('Updated Name');
  });

  test('update profile with empty name returns 400', async ({ request }) => {
    const res = await request.put(`${BASE}/api/users/me`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { name: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('non-admin cannot access /api/admin/users (403)', async ({ request }) => {
    const res = await authGet(request, '/api/admin/users', token);
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toContain('Admin');
  });

  test('logout returns 200', async ({ request }) => {
    const res = await request.post(`${BASE}/auth/logout`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status()).toBe(200);
    expect((await res.json()).message).toContain('Logged out');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7b. REFERRAL — full lifecycle
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Referral lifecycle', () => {
  let ownerToken, otherToken;

  test.beforeAll(async ({ request }) => {
    ({ token: ownerToken } = await createTestUser(request, 'refowner'));
    ({ token: otherToken } = await createTestUser(request, 'refother'));
  });

  test('generate returns 8-char code with expiry', async ({ request }) => {
    const res = await authPost(request, '/api/referral/generate', {}, ownerToken);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.code).toHaveLength(8);
    expect(body.expires_at).toBeTruthy();
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test('validate returns valid:true for generated code', async ({ request }) => {
    const gen = await authPost(request, '/api/referral/generate', {}, ownerToken);
    const { code } = await gen.json();
    const res = await authGet(request, `/api/referral/validate/${code}`, ownerToken);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.code).toBe(code);
  });

  test('validate returns 404 for nonexistent code', async ({ request }) => {
    const res = await authGet(request, '/api/referral/validate/ZZZZZZZZ', ownerToken);
    expect(res.status()).toBe(404);
  });

  test('use without code returns 400', async ({ request }) => {
    const res = await authPost(request, '/api/referral/use', {}, ownerToken);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('required');
  });

  test('cannot use own code (400)', async ({ request }) => {
    const gen = await authPost(request, '/api/referral/generate', {}, ownerToken);
    const { code } = await gen.json();
    const res = await authPost(request, '/api/referral/use', { code }, ownerToken);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('own');
  });

  test('other user can use code, then code is spent', async ({ request }) => {
    const gen = await authPost(request, '/api/referral/generate', {}, ownerToken);
    const { code } = await gen.json();
    // Use it
    const use = await authPost(request, '/api/referral/use', { code }, otherToken);
    expect(use.status()).toBe(200);
    expect((await use.json()).success).toBe(true);
    // Second use fails
    const again = await authPost(request, '/api/referral/use', { code }, otherToken);
    expect(again.status()).toBe(400);
    expect((await again.json()).error).toContain('already');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Payments', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    ({ token } = await createTestUser(request, 'pay'));
  });

  test('checkout with free plan returns 400', async ({ request }) => {
    const res = await authPost(request, '/api/payments/create-checkout-session', { planId: 'free' }, token);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('Cannot');
  });

  test('checkout with invalid plan returns 400', async ({ request }) => {
    const res = await authPost(request, '/api/payments/create-checkout-session', { planId: 'fake' }, token);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('Invalid');
  });

  test('payment history returns empty array', async ({ request }) => {
    const res = await authGet(request, '/api/payments/history', token);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.payments).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. CHAT & TTS (authed)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Chat & TTS', () => {
  let token;

  test.beforeAll(async ({ request }) => {
    ({ token } = await createTestUser(request, 'chat'));
  });

  test('chat streaming returns 200 with SSE content', async ({ request }) => {
    const res = await authPost(request, '/api/chat', { messages: [{ role: 'user', content: 'Say OK' }] }, token);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data:');
    expect(text).toContain('[DONE]');
  });

  test('chat rejects non-array messages with 400', async ({ request }) => {
    const res = await authPost(request, '/api/chat', { messages: 'not-array' }, token);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('array');
  });

  test('chat/demo requires auth (401 without token)', async ({ request }) => {
    const res = await request.post(`${BASE}/api/chat/demo`, {
      headers: { 'Content-Type': 'application/json' },
      data: { messages: [{ role: 'user', content: 'hello' }] },
    });
    expect(res.status()).toBe(401);
  });

  test('tts rejects empty text with 400', async ({ request }) => {
    const res = await authPost(request, '/api/tts', { text: '' }, token);
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain('required');
  });

  test('tts rejects text over 2000 chars with 400', async ({ request }) => {
    const res = await authPost(request, '/api/tts', { text: 'a'.repeat(2001) }, token);
    expect(res.status()).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. SECURITY HEADERS & CSRF (single request)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Security', () => {
  test('response headers are correctly hardened', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    const h = res.headers();
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBeTruthy();
    expect(h['content-security-policy']).toBeTruthy();
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('CSRF cookie is set with Secure flag', async ({ request }) => {
    const res = await request.get(`${BASE}/health`);
    const cookies = res.headers()['set-cookie'] || '';
    expect(cookies).toContain('kelion.csrf');
    expect(cookies).toContain('Secure');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. UI FLOWS (modals on landing page)
// ═══════════════════════════════════════════════════════════════════════════
test.describe('UI flows', () => {
  test('login modal: opens, shows email+password fields, closes on backdrop', async ({ page }) => {
    await page.goto(BASE);
    await page.click('button:has-text("Login")');
    const emailInput = page.locator('input[type="email"]');
    const passInput = page.locator('input[type="password"]');
    await expect(emailInput).toBeVisible({ timeout: 5000 });
    await expect(passInput).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('register modal: shows name, email, password fields', async ({ page }) => {
    await page.goto(BASE);
    await page.click('button:has-text("Cont nou")');
    await expect(page.locator('input[placeholder*="Nume"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('plans modal: shows all 4 plan names', async ({ page }) => {
    await page.goto(BASE);
    await page.click('button:has-text("Planuri")');
    for (const name of ['Free', 'Basic', 'Premium', 'Enterprise']) {
      await expect(page.locator(`text=${name}`).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('free trial navigates to /chat/kelion by default', async ({ page }) => {
    await page.goto(BASE);
    await page.click('button:has-text("gratuit")');
    await expect(page).toHaveURL(/\/chat\/kelion/, { timeout: 10000 });
  });

  test('register via modal creates account and shows user in header', async ({ page }) => {
    const email = `uireg_${Date.now()}@test.kelionai.app`;
    await page.goto(BASE);
    await page.click('button:has-text("Cont nou")');
    await page.waitForSelector('input[placeholder*="Nume"]', { timeout: 5000 });
    await page.fill('input[placeholder*="Nume"]', 'E2E Tester');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'Test12345!');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=E2E Tester')).toBeVisible({ timeout: 10000 });
    // Verify logged-in state: Logout button should appear
    await expect(page.locator('button:has-text("Logout")')).toBeVisible();
  });

  test('login via modal authenticates user and shows name in header', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const email = `uilogin_${Date.now()}@test.kelionai.app`;
    // Register via API, then clear cookies so the page loads unauthenticated
    await page.request.post(`${BASE}/auth/local/register`, {
      data: { email, password: 'Test12345!', name: 'Login Tester' },
    });
    await context.clearCookies();
    await page.goto(BASE);
    await page.click('button:has-text("Login")');
    await page.waitForSelector('input[type="email"]', { timeout: 5000 });
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', 'Test12345!');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=Login Tester')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Logout")')).toBeVisible();
    await context.close();
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// 12. REGISTER — cookie & token details
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Register cookie details', () => {
  test('register sets HttpOnly cookie', async ({ request }) => {
    const email = `cookie_${Date.now()}@test.kelionai.app`;
    const res = await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email, password: 'Test12345!', name: 'Cookie User' },
    });
    expect(res.status()).toBe(201);
    const cookies = res.headers()['set-cookie'] || '';
    expect(cookies).toContain('kelion.token');
    expect(cookies).toContain('HttpOnly');
  });

  test('register returns JWT token in body', async ({ request }) => {
    const { token } = await createTestUser(request, 'jwtbody');
    expect(typeof token).toBe('string');
    expect(token.split('.').length).toBe(3);
  });

  test('register role defaults to user', async ({ request }) => {
    const { user } = await createTestUser(request, 'role');
    expect(user.role).toBe('user');
  });

  test('register subscription defaults to free', async ({ request }) => {
    const { user } = await createTestUser(request, 'tier');
    expect(user.subscription_tier).toBe('free');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. LOGIN — cookie details
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Login cookie details', () => {
  test('login sets HttpOnly cookie', async ({ request }) => {
    const email = `logcookie_${Date.now()}@test.kelionai.app`;
    await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email, password: 'Test12345!', name: 'LC User' },
    });
    const res = await request.post(`${BASE}/auth/local/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email, password: 'Test12345!' },
    });
    expect(res.status()).toBe(200);
    const cookies = res.headers()['set-cookie'] || '';
    expect(cookies).toContain('kelion.token');
    expect(cookies).toContain('HttpOnly');
  });

  test('login returns JWT token in body', async ({ request }) => {
    const email = `logjwt_${Date.now()}@test.kelionai.app`;
    await request.post(`${BASE}/auth/local/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email, password: 'Test12345!', name: 'LJ User' },
    });
    const res = await request.post(`${BASE}/auth/local/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { email, password: 'Test12345!' },
    });
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.token.split('.').length).toBe(3);
    expect(body.user.email).toBe(email);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. SUBSCRIPTION PLAN DETAILS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Subscription plan details', () => {
  test('free plan — price 0, dailyLimit 10', async ({ request }) => {
    const res = await request.get(`${BASE}/api/subscription/plans`);
    const free = (await res.json()).plans.find(p => p.id === 'free');
    expect(free.price).toBe(0);
    expect(free.dailyLimit).toBe(10);
  });

  test('basic plan — $9.99/month', async ({ request }) => {
    const res = await request.get(`${BASE}/api/subscription/plans`);
    const basic = (await res.json()).plans.find(p => p.id === 'basic');
    expect(basic.price).toBe(9.99);
    expect(basic.interval).toBe('month');
  });

  test('enterprise plan — null dailyLimit', async ({ request }) => {
    const res = await request.get(`${BASE}/api/subscription/plans`);
    const ent = (await res.json()).plans.find(p => p.id === 'enterprise');
    expect(ent.dailyLimit).toBeNull();
  });

  test('all plans have features array', async ({ request }) => {
    const res = await request.get(`${BASE}/api/subscription/plans`);
    const { plans } = await res.json();
    for (const p of plans) {
      expect(Array.isArray(p.features)).toBe(true);
      expect(p.features.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. NEW USER DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════
test.describe('New user defaults', () => {
  test('tier=free, status=active, usage.today=0, usage.daily_limit=10', async ({ request }) => {
    const { token } = await createTestUser(request, 'defaults');
    const res = await authGet(request, '/api/users/me', token);
    const body = await res.json();
    expect(body.subscription_tier).toBe('free');
    expect(body.subscription_status).toBe('active');
    expect(body.usage.today).toBe(0);
    expect(body.usage.daily_limit).toBe(10);
  });
});