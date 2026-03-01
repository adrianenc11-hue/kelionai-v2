// @ts-check
// LIVE-ONLY: All tests run against https://kelionai.app
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: 'https://kelionai.app',
    actionTimeout: 15000,
    navigationTimeout: 15000,
    screenshot: 'only-on-failure',
  },
  retries: 3,
  reporter: [['html'], ['list']],
  outputDir: 'test-results/',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
