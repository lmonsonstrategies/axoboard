import { expect, test } from '@playwright/test';
import { loadConfig, validateBaseUrl } from '../../src/config.mjs';
import { runPageAudit } from '../../src/page-audit.mjs';

const config = await loadConfig();
const baseOrigin = validateBaseUrl(process.env.AXOBOARD_BASE_URL, config.allowedBaseUrls);

for (const route of config.routes.filter((candidate) => candidate.checkpoint)) {
  test(`${route.id} meets hard quantitative gates`, async ({ page, request }, testInfo) => {
    test.skip(!route.viewports.includes(testInfo.project.name), `Route is not inventoried for ${testInfo.project.name}.`);
    const viewport = config.viewports.find((candidate) => candidate.id === testInfo.project.name);
    const theme = route.themes[0];
    const result = await runPageAudit({ page, requestContext: request, route, viewport, theme, config, baseOrigin });
    const blockers = result.findings.filter((finding) => config.failOn.includes(finding.severity));
    expect(blockers, JSON.stringify(blockers, null, 2)).toEqual([]);
  });
}
