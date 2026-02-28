// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * KelionAI Playwright Config — LIVE ONLY
 * Toate testele rulează exclusiv contra https://kelionai.app
 * NU există mod local. NU porni server local.
 */
module.exports = defineConfig({
    testDir: './tests',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: [
        ['html', { open: 'never' }],
        ['list']
    ],
    use: {
        baseURL: 'https://kelionai.app',
        trace: 'on-first-retry',
        screenshot: 'on',
        video: 'on-first-retry',
        // Timeout generos pentru producție
        actionTimeout: 15000,
        navigationTimeout: 30000,
    },
    // Timeout global per test — 60s pentru live
    timeout: 60000,
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
