// @ts-check
// baseURL defaults to the live site but can be overridden via BASE_URL env var
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  globalSetup: './tests/global-setup.js',
  testDir: './tests',
  timeout: 180000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list'], ['json', { outputFile: 'test-results/results.json' }]],
  outputDir: 'test-results/',
  use: {
    baseURL: process.env.BASE_URL || process.env.APP_URL || 'http://localhost:3000',
    actionTimeout: 20000,
    navigationTimeout: 120000,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-gl=swiftshader',
            '--disable-gpu',
            '--disable-gpu-compositing',
            '--disable-software-rasterizer',
            '--disable-dev-shm-usage',
            '--no-sandbox',
            '--js-flags=--max-old-space-size=512',
          ],
        },
        permissions: ['microphone'],
      },
    },
  ],
});
