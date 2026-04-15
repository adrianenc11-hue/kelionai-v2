// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 0 : 1,
  workers: process.env.CI ? 1 : 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'e2e-results.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'https://kelionai.app',
    ignoreHTTPSErrors: false,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
