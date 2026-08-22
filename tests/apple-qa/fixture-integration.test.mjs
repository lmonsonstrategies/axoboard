import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium, firefox, webkit } from '@playwright/test';
import { loadConfig, resolveChromiumExecutable } from '../../src/config.mjs';
import { startFixtureServer } from '../../src/fixture-server.mjs';
import { runPageAudit } from '../../src/page-audit.mjs';

const browserTypes = { chromium, firefox, webkit };

test('shared audit engine passes the good fixture and rejects deliberate hard failures in every required browser', { timeout: 120_000 }, async () => {
  const config = await loadConfig();
  const server = await startFixtureServer();
  const executablePath = resolveChromiumExecutable();
  try {
    for (const browserEngine of config.browserEngines) {
      const browser = await browserTypes[browserEngine].launch(browserEngine === 'chromium'
        ? { ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
        : { headless: true });
      try {
        const viewport = config.viewports.find((item) => item.id === 'phone-375');
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(browserEngine === 'firefox' ? {} : { isMobile: true }), reducedMotion: 'no-preference' });
        const goodPage = await context.newPage();
        const good = await runPageAudit({ page: goodPage, requestContext: context.request, route: { ...config.fixtureRoutes[0], path: '/fixtures/good?state=landing&theme=light' }, viewport, theme: 'light', browserEngine, config, baseOrigin: server.origin });
        assert.equal(good.browserEngine, browserEngine);
        assert.deepEqual(good.findings.filter((finding) => ['P0', 'P1'].includes(finding.severity)), []);
        const badPage = await context.newPage();
        const bad = await runPageAudit({ page: badPage, requestContext: context.request, route: config.badFixtureRoutes[0], viewport, theme: 'light', browserEngine, config, baseOrigin: server.origin });
        const badRules = new Set(bad.findings.map((finding) => finding.rule));
        for (const rule of ['layout.horizontal-overflow', 'interaction.touch-target', 'accessibility.missing-name', 'motion.reduced-motion-parity', 'structure.main-landmark', 'runtime.console-error', 'safety.mutation-attempt']) assert.ok(badRules.has(rule), `${browserEngine} missing deliberate failure ${rule}`);
        await context.close();
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
});
