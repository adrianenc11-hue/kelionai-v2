// @ts-check
// baseURL defaults to the live site but can be overridden via BASE_URL env var
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: process.env.BASE_URL || 'https://kelionai.app',
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
