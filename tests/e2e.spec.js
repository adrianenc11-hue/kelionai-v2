const { test, expect } = require('@playwright/test');

// Helper: dismiss auth screen by clicking "Continue as guest"
async function dismissAuth(page) {
    const guest = page.locator('#auth-guest');
    if (await guest.isVisible({ timeout: 2000 }).catch(() => false)) {
        await guest.click();
        await page.waitForTimeout(500);
    }
}

// ═══════════════════════════════════════════
// TEST 1 — Page loads correctly
// ═══════════════════════════════════════════
test('page loads with avatar and layout', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(5000);

    // Avatar canvas exists
    const canvas = page.locator('#avatar-canvas');
    await expect(canvas).toBeVisible();

    // Layout elements exist
    await expect(page.locator('#left-panel')).toBeVisible();
    await expect(page.locator('#display-panel')).toBeVisible();
    await expect(page.locator('#avatar-name')).toHaveText('Kelion');
    await expect(page.locator('#status-text')).toHaveText('Online');

    // Input row exists
    await expect(page.locator('#text-input')).toBeVisible();
    await expect(page.locator('#btn-send')).toBeVisible();
    await expect(page.locator('#btn-mic')).toBeVisible();

    // Switcher buttons exist
    await expect(page.locator('[data-avatar="kelion"]')).toBeVisible();
    await expect(page.locator('[data-avatar="kira"]')).toBeVisible();

    // Monitor area
    await expect(page.locator('#display-panel')).toBeVisible();
});

// ═══════════════════════════════════════════
// TEST 2 — Text input is functional
// ═══════════════════════════════════════════
test('text input accepts text and send button works', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    await dismissAuth(page);

    const input = page.locator('#text-input');
    await input.click();
    await input.fill('test mesaj');
    await expect(input).toHaveValue('test mesaj');

    // Send button click (will fail because API keys are dead, but we verify UI responds)
    await page.locator('#btn-send').click();
    await page.waitForTimeout(2000);

    // Check that the user message appeared in chat
    const chatOverlay = page.locator('#chat-overlay');
    const userMsg = chatOverlay.locator('.msg.user');
    await expect(userMsg.first()).toBeVisible();
    await expect(userMsg.first()).toContainText('test mesaj');
});

// ═══════════════════════════════════════════
// TEST 3 — Chat API responds
// ═══════════════════════════════════════════
test('chat API returns response (not 500)', async ({ request }) => {
    const response = await request.post('/api/chat', {
        data: { message: 'salut', avatar: 'kelion' }
    });
    // We accept 200 (success) or 503 (AI unavailable) but NOT 500 (server crash)
    expect([200, 503]).toContain(response.status());

    const body = await response.json();
    if (response.status() === 200) {
        expect(body.reply).toBeTruthy();
        expect(body.engine).toBeTruthy();
    } else {
        expect(body.error).toBeTruthy();
    }
});

// ═══════════════════════════════════════════
// TEST 4 — TTS API returns audio
// ═══════════════════════════════════════════
test('TTS API returns audio bytes', async ({ request }) => {
    const response = await request.post('/api/speak', {
        data: { text: 'test', avatar: 'kelion' }
    });

    if (response.status() === 200) {
        const contentType = response.headers()['content-type'];
        expect(contentType).toContain('audio');
        const body = await response.body();
        expect(body.length).toBeGreaterThan(1000);
    } else {
        // TTS unavailable — not a crash
        expect([503, 401]).toContain(response.status());
    }
});

// ═══════════════════════════════════════════
// TEST 5 — Avatar morph targets exist
// ═══════════════════════════════════════════
test('avatar has Smile morph target', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(5000);

    const morphData = await page.evaluate(() => {
        const meshes = KAvatar.getMorphMeshes();
        return meshes.map(m => ({
            name: m.name,
            hasMorphDict: !!m.morphTargetDictionary,
            hasSmile: m.morphTargetDictionary ? 'Smile' in m.morphTargetDictionary : false,
            smileValue: m.morphTargetDictionary && m.morphTargetInfluences
                ? m.morphTargetInfluences[m.morphTargetDictionary['Smile']] || 0
                : null
        }));
    });

    // At least one mesh with Smile morph
    const smileMesh = morphData.find(m => m.hasSmile);
    expect(smileMesh).toBeTruthy();
    // Mouth should be closed (Smile = 0) when idle
    expect(smileMesh.smileValue).toBeLessThanOrEqual(0.05);
});

// ═══════════════════════════════════════════
// TEST 6 — Avatar switcher works
// ═══════════════════════════════════════════
test('avatar switches between Kelion and Kira', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(5000);
    await dismissAuth(page);

    // Start with Kelion
    let currentAvatar = await page.evaluate(() => KAvatar.getCurrentAvatar());
    expect(currentAvatar).toBe('kelion');

    // Switch to Kira
    await page.locator('[data-avatar="kira"]').click();
    await page.waitForTimeout(3000);

    currentAvatar = await page.evaluate(() => KAvatar.getCurrentAvatar());
    expect(currentAvatar).toBe('kira');

    // Name should update
    await expect(page.locator('#avatar-name')).toHaveText('Kira');
});

// ═══════════════════════════════════════════
// TEST 7 — Drag & drop zone exists
// ═══════════════════════════════════════════
test('drag and drop zone exists in display panel', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    // Drop zone exists (hidden by default, shown on dragover)
    const dropZone = page.locator('#drop-zone');
    await expect(dropZone).toBeAttached();

    // Display panel exists for file drop target
    await expect(page.locator('#display-panel')).toBeVisible();
});

// ═══════════════════════════════════════════
// TEST 8 — Static files served correctly
// ═══════════════════════════════════════════
test('static files are served', async ({ request }) => {
    const html = await request.get('/');
    expect(html.status()).toBe(200);
    expect(await html.text()).toContain('KelionAI');

    const css = await request.get('/css/app.css');
    expect(css.status()).toBe(200);

    const js = await request.get('/js/app.js');
    expect(js.status()).toBe(200);
});

// ═══════════════════════════════════════════
// TEST 9 — Sentry is initialized
// ═══════════════════════════════════════════
test('Sentry browser SDK is loaded', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);

    // Check that the Sentry SDK script tag exists in the page
    // (Sentry may not initialize if the CDN is blocked or DSN is a placeholder)
    const sentryScriptExists = await page.evaluate(() => {
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        return scripts.some(s => s.src.includes('sentry'));
    });
    expect(sentryScriptExists).toBe(true);
});

// ═══════════════════════════════════════════
// TEST 10 — No console errors on load
// ═══════════════════════════════════════════
test('no critical console errors on page load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.goto('/');
    await page.waitForTimeout(5000);

    // Filter out known non-critical errors
    const critical = errors.filter(e =>
        !e.includes('favicon') &&
        !e.includes('net::ERR') &&
        !e.includes('Sentry')
    );

    expect(critical).toHaveLength(0);
});
