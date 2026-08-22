import { defineConfig } from '@playwright/test';
import { loadConfig, resolveChromiumExecutable } from './src/config.mjs';

const quality = await loadConfig();
const baseURL = process.env.AXOBOARD_BASE_URL;
if (!baseURL) throw new Error('AXOBOARD_BASE_URL is required for Playwright candidate tests. Use npm run qa:apple for an isolated local run.');
const executablePath = resolveChromiumExecutable();

function launchOptions(browserEngine) {
  if (browserEngine !== 'chromium') return {};
  return {
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  };
}

export default defineConfig({
  testDir: './tests/apple-qa',
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
  projects: quality.browserEngines.flatMap((browserEngine) => quality.viewports.map((viewport) => ({
    name: `${browserEngine}-${viewport.id}`,
    metadata: { browserEngine, viewportId: viewport.id },
    use: {
      browserName: browserEngine,
      launchOptions: launchOptions(browserEngine),
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.dpr,
      ...(browserEngine === 'firefox' ? {} : { isMobile: viewport.width < 640 }),
      hasTouch: viewport.width < 1024
    }
  })))
});
