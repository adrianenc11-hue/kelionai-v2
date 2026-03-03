// @ts-check
// baseURL defaults to the live site but can be overridden via BASE_URL env var
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 180000,
  expect: { timeout: 20000 },
  fullyParallel: true,
  retries: 1,
  workers: 5,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  outputDir: 'test-results/',
  use: {
    baseURL: process.env.BASE_URL || 'https://kelionai.app',
    actionTimeout: 20000,
    navigationTimeout: 120000,
    screenshot: 'on',
    video: 'on',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
