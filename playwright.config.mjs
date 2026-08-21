import { defineConfig } from '@playwright/test';
import { loadConfig, resolveChromiumExecutable } from './src/config.mjs';

const quality = await loadConfig();
const baseURL = process.env.AXOBOARD_BASE_URL || 'https://axoboard.io';
const executablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.mjs/,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 3 : 2,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    browserName: 'chromium',
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    },
    actionTimeout: 7_500,
    navigationTimeout: 20_000,
    ignoreHTTPSErrors: false,
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    locale: 'en-US',
    timezoneId: 'America/Denver'
  },
  projects: quality.viewports.map((viewport) => ({
    name: viewport.id,
    use: {
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.dpr,
      isMobile: viewport.width < 640,
      hasTouch: viewport.width < 1024
    }
  }))
});

