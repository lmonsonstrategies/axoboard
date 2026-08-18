import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createVisualQaBoard,
  createVisualQaKpis,
  visualQaAccess,
  visualQaFixtureContract,
  visualQaNow
} from '../lib/visual-qa-fixture.mjs';
import { createGoogleIntegration } from '../lib/google-integration.mjs';

const frozenNow = new Date('2026-08-18T15:00:00.000Z');
const workspace = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  workspaceName: 'AxoBoard Production QA'
};
const cards = createVisualQaKpis({ now: frozenNow });

assert.equal(cards.length, 20, 'visual QA exposes exactly 20 deterministic cards');
assert.deepEqual(cards.slice(0, 12).map((card) => card.displayType), visualQaFixtureContract.canonicalTypes,
  'the first 12 cards certify every canonical visualization type in a stable order');
assert.deepEqual(cards.slice(12).flatMap((card) => card.qa.cases), visualQaFixtureContract.edgeCases,
  'the last eight cards isolate the required edge cases in a stable order');
assert.equal(new Set(cards.map((card) => card.id)).size, cards.length, 'fixture IDs are unique');
assert.ok(cards.every((card, index) => card.qa.synthetic && card.qa.readOnly && card.qa.order === index + 1),
  'every card is explicitly synthetic, read only, and ordered');
assert.ok(cards.every((card) => card.fetchedAt === (card.qa.cases.includes('stale')
  ? '2026-08-16T14:00:00.000Z'
  : '2026-08-18T14:58:00.000Z')), 'fixture timestamps are frozen');

const byCase = new Map(cards.slice(12).map((card) => [card.qa.cases[0], card]));
const flatValues = byCase.get('flat').displayPayload.items.map((item) => item.value);
assert.equal(new Set(flatValues).size, 1, 'flat trend values remain identical');
const decliningValues = byCase.get('declining').displayPayload.items.map((item) => item.value);
assert.equal(byCase.get('declining').displayType, 'funnel', 'declining edge case exercises ordered funnel narrowing');
assert.ok(decliningValues.every((value, index) => index === 0 || value < decliningValues[index - 1]),
  'declining trend is strictly decreasing');
assert.deepEqual(byCase.get('negative').displayPayload.items.map((item) => item.value), [-25, 10, 40],
  'signed category values are preserved');
assert.equal(Math.max(...byCase.get('outlier').displayPayload.cells.flat()), 999, 'heatmap includes the 999 outlier');
assert.deepEqual(byCase.get('comparison').displayPayload.items.map((item) => item.value), [40, 40, 40, 40],
  'comparison fixture keeps the current series flat');
assert.deepEqual(byCase.get('comparison').displayPayload.items.map((item) => item.comparisonValue), [45, 42, 39, 36],
  'comparison fixture exposes the declining second series');
assert.ok(Math.max(...byCase.get('long-label').displayPayload.items.map((item) => item.label.length)) >= 80,
  'pipeline includes an 80+ character label');
assert.equal(byCase.get('stale').status, 'degraded', 'stale fixture cannot present as live');
assert.ok(frozenNow - new Date(byCase.get('stale').fetchedAt) > byCase.get('stale').staleAfterSeconds * 1000,
  'stale fixture exceeds its freshness policy');
assert.deepEqual(byCase.get('empty').displayPayload.entries, [], 'empty fixture is a real empty collection');

const activity = cards.find((card) => card.id === 'visual-qa-core-activity-feed');
assert.ok(activity.displayPayload.entries.some((entry) => entry.value === 0), 'activity fixture includes a literal numeric zero');
const leaderboard = cards.find((card) => card.id === 'visual-qa-core-leaderboard');
assert.deepEqual(leaderboard.displayPayload.items.map((item) => item.value), [70, 90, 80],
  'leaderboard fixture preserves intentionally unsorted input');
const table = cards.find((card) => card.id === 'visual-qa-core-table');
assert.equal(table.displayPayload.rows.length, 12, 'table contains 12 rows for scroll testing');
assert.equal(table.displayPayload.columns.length, 6, 'table contains six exact headers');
assert.ok(table.displayPayload.rows.flat().some((value) => String(value).length >= 60), 'table includes a long cell');
assert.equal(table.value, table.displayPayload.rows.reduce((total, row) => total + Number(String(row.at(-1)).replace(/[$,]/g, '')), 0),
  'table aggregate matches the displayed row values');

const enabledEnv = {
  AXOBOARD_VISUAL_QA_ENABLED: 'true',
  AXOBOARD_VISUAL_QA_WORKSPACE_ID: workspace.workspaceId,
  AXOBOARD_VISUAL_QA_WORKSPACE_NAME: workspace.workspaceName
};
const ownerSession = { workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, role: 'owner' };
assert.equal(visualQaAccess({}, ownerSession).allowed, false, 'visual QA defaults off');
assert.equal(visualQaAccess(enabledEnv, { ...ownerSession, workspace_id: '22222222-2222-4222-8222-222222222222' }).allowed, false,
  'a different tenant is denied');
assert.equal(visualQaAccess(enabledEnv, { ...ownerSession, workspace_name: 'Lookalike QA' }).allowed, false,
  'workspace name must also match exactly');
assert.equal(visualQaAccess(enabledEnv, { ...ownerSession, role: 'viewer' }).allowed, false,
  'viewer role is denied');
assert.equal(visualQaAccess(enabledEnv, ownerSession).allowed, true, 'allowlisted owner is accepted');
assert.equal(visualQaNow({ AXOBOARD_VISUAL_QA_FROZEN_AT: frozenNow.toISOString() }).toISOString(), frozenNow.toISOString(),
  'optional screenshot clock freeze is deterministic');
assert.equal(visualQaNow().toISOString(), visualQaNow().toISOString(), 'default visual QA clock is stable for the server process');
assert.throws(() => visualQaNow({ AXOBOARD_VISUAL_QA_FROZEN_AT: 'not-a-date' }), /valid ISO timestamp/,
  'invalid clock freezes fail closed during startup use');

const brand = { id: 'brand-1', version: 4, name: 'QA Brand', tokens: { primary: '#123456', secondary: '#654321', success: '#16803A' } };
const board = createVisualQaBoard({ ...workspace, brand, now: frozenNow });
assert.deepEqual(board.dashboard.layout.kpiOrder, cards.map((card) => card.id), 'saved board order matches fixture order');
assert.equal(board.visualQa.readOnly, true, 'board is marked read only');
assert.deepEqual(board.brand.tokens, brand.tokens, 'published customer brand tokens pass through unchanged');

const [pairedTvSource, authenticatedTvSource] = await Promise.all([
  readFile(new URL('../wireframes/tv.js', import.meta.url), 'utf8'),
  readFile(new URL('../wireframes/app.js', import.meta.url), 'utf8')
]);
assert.match(pairedTvSource, /class="trend-comparison"/, 'paired TV renders the comparison series');
assert.match(pairedTvSource, /entry\.value!==null&&entry\.value!==undefined&&entry\.value!==''/,
  'paired TV does not drop a numeric zero');
assert.match(pairedTvSource, /Stale fixture/, 'paired TV exposes stale fixture copy');
assert.match(authenticatedTvSource, /tv-trend-comparison/, 'authenticated TV renders the comparison series');
assert.match(authenticatedTvSource, /data-qa-empty-state/, 'authenticated surfaces expose explicit empty-state hooks');

function response() {
  return {
    status: 0,
    payload: null,
    writeHead(status) { this.status = status; },
    end(body = '') { this.payload = body ? JSON.parse(body) : null; }
  };
}
function sendJson(res, status, payload) {
  res.writeHead(status);
  res.end(JSON.stringify(payload));
  return payload;
}

const databaseCalls = [];
let providerCalls = 0;
const integration = createGoogleIntegration({
  pool: {
    async query(sql, values) {
      databaseCalls.push({ sql: String(sql), values });
      assert.match(String(sql).trim(), /^SELECT id,version,name,tokens,published_at FROM brand_packages/,
        'visual QA bootstrap performs only the published-brand read');
      return { rows: [{ id: 'brand-qa', version: 2, name: 'QA Brand', tokens: brand.tokens, published_at: frozenNow }] };
    }
  },
  vault: { ready: false },
  provider: new Proxy({}, { get() { providerCalls += 1; throw new Error('provider must not be used by visual QA'); } }),
  env: { ...enabledEnv, AXOBOARD_ENGAGEMENT_CORE_ENABLED: 'false', AXOBOARD_VISUAL_QA_FROZEN_AT: frozenNow.toISOString() },
  sendJson,
  readJson: async () => ({}),
  currentSession: async () => null,
  sameOrigin: () => true
});
const qaSession = {
  id: 'user-qa', full_name: 'Visual QA Owner', email: 'visual-qa@example.com',
  workspace_id: workspace.workspaceId, workspace_name: workspace.workspaceName, role: 'owner',
  billing_status: 'active', can_access_app: true
};
let res = response();
await integration.handleProductRequest({ method: 'GET' }, res, new URL('https://axoboard.test/api/axoboard/bootstrap?board=visual-qa'), qaSession);
assert.equal(res.status, 200, 'allowlisted authenticated bootstrap succeeds');
assert.equal(res.payload.kpis.kpis.length, 20, 'bootstrap returns the complete visual board');
assert.equal(res.payload.visualQa.readOnly, true, 'bootstrap labels the board read only');
assert.ok(res.payload.kpis.kpis.every((card) => card.fetchedAt === (card.qa.cases.includes('stale')
  ? '2026-08-16T14:00:00.000Z'
  : '2026-08-18T14:58:00.000Z')), 'route payload uses the configured certification clock');
assert.equal(res.payload.session.capabilities.viewSourceDetails, false, 'visual QA hides real integration/source workflows');
assert.ok(Object.entries(res.payload.session.capabilities).filter(([key]) => key.startsWith('manage') || key.startsWith('sync') || key.startsWith('browse') || key.startsWith('publish') || key.startsWith('retry')).every(([, value]) => value === false),
  'visual QA disables every mutation capability');
assert.equal(databaseCalls.length, 1, 'bootstrap performs one read-only brand query');
assert.equal(providerCalls, 0, 'bootstrap performs zero provider calls');

const deniedIntegration = createGoogleIntegration({
  pool: { async query() { throw new Error('denied visual QA must not query the database'); } },
  vault: { ready: false }, provider: {}, env: {}, sendJson, readJson: async () => ({}), currentSession: async () => null, sameOrigin: () => true
});
res = response();
await deniedIntegration.handleProductRequest({ method: 'GET' }, res, new URL('https://axoboard.test/api/axoboard/bootstrap?board=visual-qa'), qaSession);
assert.equal(res.status, 404, 'disabled visual QA is indistinguishable from a missing board');

console.log(JSON.stringify({
  ok: true,
  cards: cards.length,
  canonicalTypes: visualQaFixtureContract.canonicalTypes.length,
  edgeCases: visualQaFixtureContract.edgeCases.length,
  frozenAt: frozenNow.toISOString()
}, null, 2));
