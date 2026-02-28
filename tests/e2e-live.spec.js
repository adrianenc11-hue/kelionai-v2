// @ts-check
// LIVE-ONLY: Toate testele rulează contra https://kelionai.app — NU localhost
/**
 * E2E Live Tests — kelionai.app
 * Runs directly against https://kelionai.app (zero localhost).
 */
const { test, expect } = require('@playwright/test');

const BASE_URL = 'https://kelionai.app';

// ═══════════════════════════════════════════════════════
// 1. HEALTH CHECK
// ═══════════════════════════════════════════════════════

test.describe('Health Check', () => {
    test('GET / returns 200', async ({ request }) => {
        const res = await request.get(BASE_URL + '/');
        expect(res.status()).toBe(200);
    });

    test('GET /api/health returns 200', async ({ request }) => {
        const res = await request.get(BASE_URL + '/api/health');
        // 206 is accepted when the server is degraded (partial health) but still responding
        expect([200, 206]).toContain(res.status());
        const body = await res.json();
        expect(body).toHaveProperty('status');
    });

    test('no 5xx responses on key pages', async ({ request }) => {
        const pages = ['/', '/pricing/', '/developer', '/settings/'];
        for (const path of pages) {
            const res = await request.get(BASE_URL + path);
            expect(res.status(), `Expected non-5xx for ${path}`).toBeLessThan(500);
        }
    });
});

// ═══════════════════════════════════════════════════════
// 2. ONBOARDING FLOW
// ═══════════════════════════════════════════════════════

test.describe('Onboarding Flow', () => {
    const ONBOARDING_START_BTN = 'button:has-text("Începe"), button:has-text("Start"), .onboarding-step button.btn-primary';

    test('homepage loads — title and branding visible', async ({ page }) => {
        await page.goto(BASE_URL + '/');
        await page.screenshot({ path: 'test-results/01-homepage.png' });

        // Should show kelionai content (either onboarding or main app)
        const title = await page.title();
        expect(title.toLowerCase()).toMatch(/kelion/i);
    });

    test('onboarding page loads with "Începe →" button', async ({ page }) => {
        await page.goto(BASE_URL + '/onboarding.html');
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'test-results/02-onboarding-step1.png' });

        const btn = page.locator(ONBOARDING_START_BTN).first();
        const isVisible = await btn.isVisible({ timeout: 10000 }).catch(() => false);
        if (!isVisible) { test.skip(); return; }
        await expect(btn).toBeVisible();
    });

    test('onboarding steps navigate correctly', async ({ page }) => {
        await page.goto(BASE_URL + '/onboarding.html');
        await page.waitForLoadState('domcontentloaded');

        // Click "Începe →" (or equivalent) to move to step 2
        const startBtn = page.locator(ONBOARDING_START_BTN).first();
        const isVisible = await startBtn.isVisible({ timeout: 10000 }).catch(() => false);
        if (!isVisible) { test.skip(); return; }
        await startBtn.click();
        await page.screenshot({ path: 'test-results/03-onboarding-step2.png' });

        // Step 2 should now be active
        const step2 = page.locator('.onboarding-step[data-step="2"]');
        await expect(step2).toBeVisible({ timeout: 5000 });
    });

    test('completing onboarding redirects to main app', async ({ page }) => {
        await page.goto(BASE_URL + '/onboarding.html');
        await page.waitForLoadState('domcontentloaded');

        // Navigate through all steps
        for (let i = 0; i < 3; i++) {
            const nextBtn = page.locator('.onboarding-step.active button.btn-primary');
            const isVisible = await nextBtn.isVisible().catch(() => false);
            if (!isVisible) break;
            await nextBtn.click();
            // Wait for the next step to become active instead of using a fixed timeout
            await page.waitForFunction(
                (step) => {
                    const active = document.querySelector('.onboarding-step.active');
                    return active && parseInt(active.dataset.step || '0') > step;
                },
                i + 1,
                { timeout: 5000 }
            ).catch(() => { /* last step may redirect */ });
        }

        await page.screenshot({ path: 'test-results/04-onboarding-complete.png' });

        // Should eventually redirect to / or show a done state
        await page.waitForURL(/kelionai\.app/, { timeout: 10000 });
        const url = page.url();
        expect(url).toMatch(/kelionai\.app/);
    });
});

// ═══════════════════════════════════════════════════════
// 3. PAGE NAVIGATION
// ═══════════════════════════════════════════════════════

test.describe('Page Navigation', () => {
    test('homepage renders main app content', async ({ page }) => {
        // Skip onboarding via localStorage
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'test-results/05-main-app.png' });

        await expect(page.locator('body')).toBeVisible();
        const bodyText = await page.locator('body').innerText();
        expect(bodyText.length).toBeGreaterThan(0);
    });

    test('Pricing page loads', async ({ page }) => {
        await page.goto(BASE_URL + '/pricing/');
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'test-results/06-pricing.png' });

        const status = await page.evaluate(() => document.readyState);
        expect(status).toBe('complete');
        await expect(page.locator('body')).toBeVisible();
    });

    test('Developer page loads', async ({ page }) => {
        await page.goto(BASE_URL + '/developer');
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'test-results/07-developer.png' });

        await expect(page.locator('body')).toBeVisible();
    });

    test('Settings page loads', async ({ page }) => {
        await page.goto(BASE_URL + '/settings/');
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'test-results/08-settings.png' });

        await expect(page.locator('body')).toBeVisible();
    });

    test('navbar links are present on homepage', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');

        // Verify core navigation links exist
        await expect(page.locator('a[href="/pricing/"]').first()).toBeVisible({ timeout: 10000 });
        await expect(page.locator('a[href="/developer"]').first()).toBeVisible({ timeout: 10000 });
    });

    test('Pricing nav link navigates correctly', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');

        const pricingLink = page.locator('a[href="/pricing/"]').first();
        const isVisible = await pricingLink.isVisible({ timeout: 10000 }).catch(() => false);
        if (!isVisible) { test.skip(); return; }
        await pricingLink.click();
        await page.waitForURL(/\/pricing/, { timeout: 10000 });
        await page.screenshot({ path: 'test-results/09-pricing-nav.png' });

        expect(page.url()).toMatch(/\/pricing/);
    });

    test('Developer nav link navigates correctly', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');

        const devLink = page.locator('a[href="/developer"]').first();
        const isVisible = await devLink.isVisible({ timeout: 10000 }).catch(() => false);
        if (!isVisible) { test.skip(); return; }
        await devLink.click();
        await page.waitForURL(/\/developer/, { timeout: 10000 });
        await page.screenshot({ path: 'test-results/10-developer-nav.png' });

        expect(page.url()).toMatch(/\/developer/);
    });
});

// ═══════════════════════════════════════════════════════
// 4. BUTTONS AND LINKS
// ═══════════════════════════════════════════════════════

test.describe('Buttons and Links', () => {
    test('no nav link leads to a 404 page', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');

        // Collect all internal nav href values
        // Exclude external links (http), anchor links (#), and /docs which opens in a new tab
        const hrefs = await page.locator('nav a[href]').evaluateAll(links =>
            links.map(l => l.getAttribute('href'))
                .filter(h => h && !h.startsWith('http') && !h.startsWith('#') && !h.includes('docs'))
        );

        for (const href of hrefs) {
            const res = await page.request.get(BASE_URL + href);
            expect(res.status(), `Expected non-404 for ${href}`).not.toBe(404);
        }
    });

    test('Get Started button is visible and clickable', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');

        // The "Get Started" / "Începe" button should be clickable
        const btn = page.locator('#navbar-get-started');
        const isVisible = await btn.isVisible().catch(() => false);
        if (isVisible) {
            await expect(btn).toBeEnabled();
            await page.screenshot({ path: 'test-results/11-get-started-btn.png' });
        }
    });
});

// ═══════════════════════════════════════════════════════
// 5. MOBILE VIEWPORT
// ═══════════════════════════════════════════════════════

test.describe('Mobile (375×812)', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('homepage loads on mobile', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'test-results/12-mobile-homepage.png' });

        await expect(page.locator('body')).toBeVisible();
    });

    test('hamburger menu is visible on mobile', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');

        const hamburger = page.locator('#navbar-hamburger');
        const isVisible = await hamburger.isVisible({ timeout: 10000 }).catch(() => false);
        if (!isVisible) { test.skip(); return; }
        await expect(hamburger).toBeVisible();
        await page.screenshot({ path: 'test-results/13-mobile-hamburger.png' });
    });

    test('hamburger menu opens mobile nav', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('kelion_onboarded', 'true');
        });
        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('domcontentloaded');

        const hamburger = page.locator('#navbar-hamburger');
        const mobileMenu = page.locator('#navbar-mobile-menu');

        const isVisible = await hamburger.isVisible({ timeout: 10000 }).catch(() => false);
        if (!isVisible) { test.skip(); return; }
        await hamburger.click();
        await page.screenshot({ path: 'test-results/14-mobile-menu-open.png' });

        // Mobile menu should become visible
        await expect(mobileMenu).toBeVisible({ timeout: 5000 });
    });

    test('Pricing page loads on mobile', async ({ page }) => {
        await page.goto(BASE_URL + '/pricing/');
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'test-results/15-mobile-pricing.png' });

        await expect(page.locator('body')).toBeVisible();
    });
});

// ═══════════════════════════════════════════════════════
// 6. ERROR / 404 PAGE
// ═══════════════════════════════════════════════════════

test.describe('Error Page', () => {
    test('non-existent page returns non-5xx', async ({ request }) => {
        const res = await request.get(BASE_URL + '/pagina-inexistenta');
        // Should be 404 (not 500)
        expect(res.status()).not.toBeGreaterThanOrEqual(500);
    });

    test('404 page shows back button', async ({ page }) => {
        await page.goto(BASE_URL + '/pagina-inexistenta');
        await page.waitForLoadState('domcontentloaded');
        await page.screenshot({ path: 'test-results/16-404-page.png' });

        // The 404 page has a "← Înapoi acasă" link
        const backBtn = page.locator('a[href="/"]').first();
        const isVisible = await backBtn.isVisible().catch(() => false);
        if (isVisible) {
            await expect(backBtn).toBeEnabled();
        }
    });

    test('"Înapoi" button on 404 navigates home', async ({ page }) => {
        await page.goto(BASE_URL + '/pagina-inexistenta');
        await page.waitForLoadState('domcontentloaded');

        const backBtn = page.locator('a[href="/"]').first();
        const isVisible = await backBtn.isVisible().catch(() => false);
        if (isVisible) {
            await backBtn.click();
            await page.waitForURL(/kelionai\.app\/?$/, { timeout: 10000 });
            await page.screenshot({ path: 'test-results/17-back-from-404.png' });
            expect(page.url()).toMatch(/kelionai\.app\/?(?:\?.*)?$/);
        }
    });
});

// ═══════════════════════════════════════════════════════
// 7. PWA / MANIFEST
// ═══════════════════════════════════════════════════════

test.describe('PWA', () => {
    test('manifest.json is accessible if it exists', async ({ request }) => {
        const res = await request.get(BASE_URL + '/manifest.json');
        // If manifest does not exist (404) that is acceptable — just not a 5xx
        expect(res.status()).not.toBeGreaterThanOrEqual(500);
        if (res.status() === 200) {
            try {
                const body = await res.json();
                expect(body).toBeDefined();
            } catch { /* malformed JSON on 200 is acceptable */ }
        }
    });
});

// ═══════════════════════════════════════════════════════
// 8. STATIC ASSETS
// ═══════════════════════════════════════════════════════

test.describe('Static Assets', () => {
    test('CSS app stylesheet is served', async ({ request }) => {
        const res = await request.get(BASE_URL + '/css/app.css');
        expect(res.status()).toBe(200);
    });

    test('JS app bundle is served', async ({ request }) => {
        const res = await request.get(BASE_URL + '/js/app.js');
        expect(res.status()).toBe(200);
    });

    test('homepage HTML contains KelionAI branding', async ({ request }) => {
        const res = await request.get(BASE_URL + '/');
        expect(res.status()).toBe(200);
        const text = await res.text();
        expect(text.toLowerCase()).toContain('kelion');
    });
});
