import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import pg from 'pg';
import { createVault } from '../lib/crypto-vault.mjs';
import { googleIntegrationInternals } from '../lib/google-integration.mjs';

const repPayload = googleIntegrationInternals.displayPayload(
  [['Andrew', 'Jacob'], ['10', '20'], ['5', '7']],
  'sum', true, 'rep_cards', [['100', '200']], false
);
assert.deepEqual(repPayload, {
  kind: 'rep_cards',
  items: [
    { label: 'Andrew', value: 15, comparisonValue: 100 },
    { label: 'Jacob', value: 27, comparisonValue: 200 }
  ]
});
assert.deepEqual(
  googleIntegrationInternals.displayPayload([['Rep', 'Sales'], ['Andrew', '$10']], 'count', true, 'table'),
  { kind: 'table', columns: ['Rep', 'Sales'], rows: [['Andrew', '$10']] }
);

if (!process.env.DATABASE_URL) {
  console.log('AxoBoard Google integration test skipped: DATABASE_URL is not configured.');
  process.exit(0);
}

const { Pool } = pg;
const appPort = 43222;
const providerPort = 43223;
const baseUrl = `http://127.0.0.1:${appPort}`;
const providerBaseUrl = `http://127.0.0.1:${providerPort}`;
const encryptionKey = randomBytes(32).toString('base64');
const vault = createVault(encryptionKey);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 2 });
const testEmails = [];
const workspaceIds = [];
let expectedChallenge = '';
let metadataCalls = 0;
let driveCalls = 0;
let valuesCalls = 0;
let refreshCalls = 0;
let revokeCalls = 0;

async function requestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

const fakeGoogle = createServer(async (req, res) => {
  const url = new URL(req.url, providerBaseUrl);
  const json = (status, payload, headers = {}) => {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers });
    res.end(body);
  };
  if (url.pathname === '/token' && req.method === 'POST') {
    const form = new URLSearchParams(await requestBody(req));
    assert.equal(form.get('client_id'), 'google-client-test');
    assert.equal(form.get('client_secret'), 'google-secret-test');
    if (form.get('grant_type') === 'authorization_code') {
      assert.equal(form.get('code'), 'valid-google-code');
      assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'), expectedChallenge, 'PKCE verifier matches challenge');
      return json(200, {
        access_token: 'google_access_initial', refresh_token: 'google_refresh_secret', expires_in: 3600,
        token_type: 'Bearer', scope: 'openid email https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets.readonly'
      });
    }
    assert.equal(form.get('grant_type'), 'refresh_token');
    assert.equal(form.get('refresh_token'), 'google_refresh_secret');
    refreshCalls += 1;
    return json(200, { access_token: 'google_access_refreshed', expires_in: 3600, token_type: 'Bearer' });
  }
  if (url.pathname === '/userinfo' && req.method === 'GET') {
    assert.equal(req.headers.authorization, 'Bearer google_access_initial');
    return json(200, { sub: 'google-user-001', email: 'sheets-owner@example.com', email_verified: true });
  }
  if (url.pathname === '/drive/v3/files' && req.method === 'GET') {
    assert.match(String(req.headers.authorization), /^Bearer google_access_(initial|refreshed)$/);
    assert.equal(url.searchParams.get('q'), "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
    assert.equal(url.searchParams.get('orderBy'), 'modifiedTime desc,name_natural');
    assert.equal(url.searchParams.get('pageSize'), '1000');
    assert.equal(url.searchParams.get('corpora'), 'user');
    assert.equal(url.searchParams.get('includeItemsFromAllDrives'), 'true');
    driveCalls += 1;
    if (!url.searchParams.get('pageToken')) {
      return json(200, {
        files: [
          { id: 'sheet_recent_123456789', name: 'Latest Revenue', modifiedTime: '2026-08-13T23:00:00.000Z', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet_recent_123456789/edit', starred: true, shared: false },
          { id: 'sheet_test_123456789', name: 'Revenue Scoreboard', modifiedTime: '2026-08-13T22:00:00.000Z', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet_test_123456789/edit', starred: false, shared: true }
        ],
        nextPageToken: 'drive-page-2', incompleteSearch: false
      }, { 'x-request-id': `drive-${driveCalls}` });
    }
    assert.equal(url.searchParams.get('pageToken'), 'drive-page-2');
    return json(200, {
      files: [{ id: 'sheet_older_123456789', name: 'Older Scorecard', modifiedTime: '2026-08-10T12:00:00.000Z', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet_older_123456789/edit', starred: false, shared: false }],
      incompleteSearch: false
    }, { 'x-request-id': `drive-${driveCalls}` });
  }
  if (url.pathname === '/sheets/v4/spreadsheets/sheet_test_123456789' && req.method === 'GET') {
    assert.match(String(req.headers.authorization), /^Bearer google_access_(initial|refreshed)$/);
    metadataCalls += 1;
    return json(200, {
      spreadsheetId: 'sheet_test_123456789', properties: { title: 'Revenue Scoreboard', locale: 'en_US', timeZone: 'America/Denver' },
      sheets: [
        { properties: { sheetId: 12345, title: 'Summary', index: 0, sheetType: 'GRID', gridProperties: { rowCount: 100, columnCount: 12 } } },
        { properties: { sheetId: 0, title: 'Baseline', index: 1, sheetType: 'GRID', gridProperties: { rowCount: 100, columnCount: 12 } } }
      ]
    }, { 'x-request-id': `metadata-${metadataCalls}` });
  }
  if (url.pathname.startsWith('/sheets/v4/spreadsheets/sheet_test_123456789/values/') && req.method === 'GET') {
    assert.match(String(req.headers.authorization), /^Bearer google_access_(initial|refreshed)$/);
    const requestedRange = decodeURIComponent(url.pathname.split('/values/')[1]);
    valuesCalls += 1;
    if (requestedRange === "'Summary'!A1:H12") {
      assert.equal(url.searchParams.get('valueRenderOption'), 'FORMATTED_VALUE');
      return json(200, {
        range: 'Summary!A1:H12', majorDimension: 'ROWS',
        values: [['Metric', 'Jan', 'Feb', 'Mar'], ['Revenue', '$10', '$20', '$30'], ['Orders', '1', '2', '3']]
      }, { 'x-request-id': `values-${valuesCalls}` });
    }
    if (requestedRange === "'Summary'!A1:L24") {
      assert.equal(url.searchParams.get('valueRenderOption'), 'FORMATTED_VALUE');
      return json(200, {
        range: 'Summary!A1:L24', majorDimension: 'ROWS',
        values: [['Metric', 'Jan', 'Feb', 'Mar'], ['Revenue', '$10', '$20', '$30']]
      }, { 'x-request-id': `values-${valuesCalls}` });
    }
    if (requestedRange === "'Baseline'!E8:E10") {
      assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
      return json(200, { range: 'Baseline!E8:E10', majorDimension: 'ROWS', values: [['Prior'], [10], [15]] }, { 'x-request-id': `values-${valuesCalls}` });
    }
    if (requestedRange === "'Summary'!G1:J2") {
      return json(200, { range: 'Summary!G1:J2', majorDimension: 'ROWS', values: [['Andrew', 'Jacob', 'Jaden', 'Xavier'], [46189, 13897, 64281, 21938]] }, { 'x-request-id': `values-${valuesCalls}` });
    }
    if (requestedRange === "'Baseline'!G3:J3") {
      return json(200, { range: 'Baseline!G3:J3', majorDimension: 'ROWS', values: [[50000, 40000, 60000, 50000]] }, { 'x-request-id': `values-${valuesCalls}` });
    }
    assert.equal(requestedRange, "'Summary'!D8:D10");
    assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    return json(200, { range: 'Summary!D8:D10', majorDimension: 'ROWS', values: [['Revenue'], [20], [30]] }, { 'x-request-id': `values-${valuesCalls}` });
  }
  if (url.pathname === '/revoke' && req.method === 'POST') {
    const form = new URLSearchParams(await requestBody(req));
    assert.equal(form.get('token'), 'google_refresh_secret');
    revokeCalls += 1;
    res.writeHead(200); return res.end();
  }
  return json(404, { error: { status: 'NOT_FOUND' } });
});

await new Promise((resolveListen) => fakeGoogle.listen(providerPort, '127.0.0.1', resolveListen));
const app = spawn(process.execPath, ['server.mjs'], {
  env: {
    ...process.env, PORT: String(appPort), NODE_ENV: 'test', APP_BASE_URL: baseUrl,
    AXOBOARD_GOOGLE_CLIENT_ID: 'google-client-test', AXOBOARD_GOOGLE_CLIENT_SECRET: 'google-secret-test',
    AXOBOARD_GOOGLE_REDIRECT_URI: `${baseUrl}/api/integrations/oauth/google/callback`,
    AXOBOARD_OAUTH_ENCRYPTION_KEY: encryptionKey,
    AXOBOARD_SYNC_INTERVAL_MS: '10000',
    AXOBOARD_GOOGLE_AUTHORIZATION_URL: `${providerBaseUrl}/authorize`,
    AXOBOARD_GOOGLE_TOKEN_URL: `${providerBaseUrl}/token`,
    AXOBOARD_GOOGLE_USERINFO_URL: `${providerBaseUrl}/userinfo`,
    AXOBOARD_GOOGLE_DRIVE_API_BASE_URL: `${providerBaseUrl}/drive/v3`,
    AXOBOARD_GOOGLE_SHEETS_API_BASE_URL: `${providerBaseUrl}/sheets/v4`,
    AXOBOARD_GOOGLE_REVOKE_URL: `${providerBaseUrl}/revoke`
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
app.stdout.on('data', (chunk) => { logs += chunk; });
app.stderr.on('data', (chunk) => { logs += chunk; });

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Google integration test server did not start\n${logs}`);
}

async function signup(label) {
  const email = `google-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  testEmails.push(email);
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ name: `Google ${label}`, email, password: 'AxoBoardQA123', workspaceName: `Google ${label}`, acceptTerms: true })
  });
  assert.equal(response.status, 201, await response.text());
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const session = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })).json();
  workspaceIds.push(session.user.workspace_id);
  await pool.query("UPDATE subscriptions SET status='active', updated_at=NOW() WHERE workspace_id=$1", [session.user.workspace_id]);
  return { cookie, workspaceId: session.user.workspace_id };
}

async function api(path, { method = 'GET', cookie, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method, redirect: 'manual', headers: { Cookie: cookie, ...(method === 'GET' ? {} : { Origin: baseUrl, 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

try {
  const health = await waitForHealth();
  assert.equal(health.googleSheets, 'configured');
  const first = await signup('Primary');
  const second = await signup('Isolated');

  const start = await api('/api/axoboard/integrations/oauth/start', { method: 'POST', cookie: first.cookie, body: { provider: 'google' } });
  const startText = await start.text();
  assert.equal(start.status, 200, startText);
  const authorizationUrl = new URL(JSON.parse(startText).authorizationUrl);
  assert.equal(authorizationUrl.origin, providerBaseUrl);
  assert.equal(authorizationUrl.searchParams.get('access_type'), 'offline');
  assert.equal(authorizationUrl.searchParams.get('prompt'), 'consent');
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.deepEqual(authorizationUrl.searchParams.get('scope').split(' '), ['openid', 'email', 'https://www.googleapis.com/auth/drive.metadata.readonly', 'https://www.googleapis.com/auth/spreadsheets.readonly']);
  expectedChallenge = authorizationUrl.searchParams.get('code_challenge');
  const state = authorizationUrl.searchParams.get('state');

  const callback = await api(`/api/integrations/oauth/google/callback?state=${encodeURIComponent(state)}&code=valid-google-code`, { cookie: first.cookie });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), '/app?integration=google&status=connected');
  const replay = await api(`/api/integrations/oauth/google/callback?state=${encodeURIComponent(state)}&code=valid-google-code`, { cookie: first.cookie });
  assert.equal(replay.headers.get('location'), '/app?integration=google&status=invalid_state', 'OAuth state is one-time');

  const connectionsResponse = await api('/api/axoboard/integrations/connections', { cookie: first.cookie });
  assert.equal(connectionsResponse.status, 200);
  const connectionsText = await connectionsResponse.text();
  assert.doesNotMatch(connectionsText, /google_access|google_refresh_secret/i, 'tokens never enter connection response');
  const connection = JSON.parse(connectionsText).connections[0];
  assert.equal(connection.accountEmail, 'sheets-owner@example.com');
  assert.equal(connection.status, 'healthy');
  assert.ok(connection.scopes.includes('https://www.googleapis.com/auth/drive.metadata.readonly'));

  const encrypted = await pool.query(`SELECT encode(token_ciphertext,'escape') AS ciphertext, token_iv, token_auth_tag
    FROM integration_connections WHERE id=$1 AND workspace_id=$2`, [connection.id, first.workspaceId]);
  assert.equal(encrypted.rowCount, 1);
  assert.doesNotMatch(encrypted.rows[0].ciphertext, /google_access|google_refresh_secret/i, 'database token ciphertext is encrypted');
  assert.equal(encrypted.rows[0].token_iv.length, 12);
  assert.equal(encrypted.rows[0].token_auth_tag.length, 16);

  const beforeIsolationCalls = driveCalls + metadataCalls + valuesCalls;
  const isolatedList = await api(`/api/axoboard/integrations/google/spreadsheets?connectionId=${connection.id}`, { cookie: second.cookie });
  assert.equal(isolatedList.status, 403);
  const isolated = await api(`/api/axoboard/integrations/google/spreadsheet?connectionId=${connection.id}&spreadsheet=sheet_test_123456789`, { cookie: second.cookie });
  assert.equal(isolated.status, 403);
  assert.equal(driveCalls + metadataCalls + valuesCalls, beforeIsolationCalls, 'swapped tenant ID makes zero provider calls');

  const firstFilePage = await api(`/api/axoboard/integrations/google/spreadsheets?connectionId=${connection.id}`, { cookie: first.cookie });
  const firstFilePageText = await firstFilePage.text();
  assert.equal(firstFilePage.status, 200, firstFilePageText);
  assert.doesNotMatch(firstFilePageText, /google_access|google_refresh_secret/i, 'tokens never enter spreadsheet list response');
  const firstFilePageBody = JSON.parse(firstFilePageText);
  assert.deepEqual(firstFilePageBody.spreadsheets.map((file) => file.title), ['Latest Revenue', 'Revenue Scoreboard']);
  assert.equal(firstFilePageBody.nextPageToken, 'drive-page-2');
  const secondFilePage = await api(`/api/axoboard/integrations/google/spreadsheets?connectionId=${connection.id}&pageToken=drive-page-2`, { cookie: first.cookie });
  const secondFilePageBody = await secondFilePage.json();
  assert.equal(secondFilePage.status, 200);
  assert.deepEqual(secondFilePageBody.spreadsheets.map((file) => file.title), ['Older Scorecard']);
  assert.equal(secondFilePageBody.nextPageToken, null);

  const metadata = await api(`/api/axoboard/integrations/google/spreadsheet?connectionId=${connection.id}&spreadsheet=https%3A%2F%2Fdocs.google.com%2Fspreadsheets%2Fd%2Fsheet_test_123456789%2Fedit`, { cookie: first.cookie });
  const metadataText = await metadata.text();
  assert.equal(metadata.status, 200, metadataText);
  const metadataBody = JSON.parse(metadataText);
  assert.equal(metadataBody.spreadsheet.title, 'Revenue Scoreboard');
  assert.deepEqual(metadataBody.spreadsheet.sheets.map((sheet) => sheet.title), ['Summary', 'Baseline']);

  const grid = await api(`/api/axoboard/integrations/google/grid?connectionId=${connection.id}&spreadsheet=sheet_test_123456789&sheetId=12345&row=1&column=1`, { cookie: first.cookie });
  const gridText = await grid.text();
  assert.equal(grid.status, 200, gridText);
  const gridPreview = JSON.parse(gridText).grid;
  assert.equal(gridPreview.range, 'A1:H12');
  assert.deepEqual(gridPreview.columns, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  assert.equal(gridPreview.values.length, 12);
  assert.deepEqual(gridPreview.values[0].slice(0, 4), ['Metric', 'Jan', 'Feb', 'Mar']);
  assert.equal(gridPreview.values[11].length, 8, 'sparse provider rows are padded for a stable grid');

  const scrollGrid = await api(`/api/axoboard/integrations/google/grid?connectionId=${connection.id}&spreadsheet=sheet_test_123456789&sheetId=12345&row=1&column=1&rows=24&columns=12`, { cookie: first.cookie });
  const scrollGridText = await scrollGrid.text();
  assert.equal(scrollGrid.status, 200, scrollGridText);
  const scrollGridPreview = JSON.parse(scrollGridText).grid;
  assert.equal(scrollGridPreview.range, 'A1:L24');
  assert.equal(scrollGridPreview.values.length, 24);
  assert.equal(scrollGridPreview.values[23].length, 12, 'virtual-scroll windows are padded to their requested shape');

  const selection = { connectionId: connection.id, spreadsheet: 'sheet_test_123456789', sheetId: 12345, range: 'D8:D10', aggregation: 'sum', includeHeaders: true, goalValue: 100, comparisonSheetId: 0, comparisonRange: 'E8:E10', comparisonAggregation: 'sum', comparisonIncludeHeaders: true };
  const preview = await api('/api/axoboard/kpis/google/preview', { method: 'POST', cookie: first.cookie, body: selection });
  const previewText = await preview.text();
  assert.equal(preview.status, 200, previewText);
  assert.equal(JSON.parse(previewText).preview.value, 50);
  assert.equal(JSON.parse(previewText).preview.sourceRowCount, 2);
  assert.equal(JSON.parse(previewText).preview.includeHeaders, true);
  assert.equal(JSON.parse(previewText).preview.comparison.value, 25);
  assert.equal(JSON.parse(previewText).preview.comparison.delta, 25);
  assert.equal(JSON.parse(previewText).preview.comparison.percentChange, 100);

  const repCardsPreview = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, range: 'G1:J2', aggregation: 'sum', includeHeaders: true, displayType: 'rep_cards', comparisonRange: 'G3:J3', comparisonAggregation: 'sum', comparisonIncludeHeaders: false }
  });
  const repCardsPreviewText = await repCardsPreview.text();
  assert.equal(repCardsPreview.status, 200, repCardsPreviewText);
  assert.deepEqual(JSON.parse(repCardsPreviewText).preview.displayPayload, {
    kind: 'rep_cards',
    items: [
      { label: 'Andrew', value: 46189, comparisonValue: 50000 },
      { label: 'Jacob', value: 13897, comparisonValue: 40000 },
      { label: 'Jaden', value: 64281, comparisonValue: 60000 },
      { label: 'Xavier', value: 21938, comparisonValue: 50000 }
    ]
  });

  const ambiguousRange = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, range: 'D8:D10', aggregation: 'single_value', includeHeaders: false, comparisonRange: '' }
  });
  const ambiguousRangeBody = await ambiguousRange.json();
  assert.equal(ambiguousRange.status, 422);
  assert.equal(ambiguousRangeBody.code, 'single_value_requires_one_cell', 'multi-cell ranges cannot silently collapse to the first value');

  const sameComparison = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, comparisonSheetId: 12345, comparisonRange: 'D8:D10' }
  });
  const sameComparisonBody = await sameComparison.json();
  assert.equal(sameComparison.status, 422);
  assert.equal(sameComparisonBody.code, 'comparison_matches_kpi_range', 'a KPI cannot compare against itself');

  const create = await api('/api/axoboard/kpis', { method: 'POST', cookie: first.cookie, body: { ...selection, name: 'Qualified pipeline', displayFormat: 'currency' } });
  const createText = await create.text();
  assert.equal(create.status, 201, createText);
  const createdKpi = JSON.parse(createText).kpi;
  assert.equal(createdKpi.value, 50);
  const list = await api('/api/axoboard/kpis', { cookie: first.cookie });
  const kpis = (await list.json()).kpis;
  assert.equal(kpis.length, 1);
  assert.equal(kpis[0].value, 50);
  assert.equal(kpis[0].sourceRange, "'Summary'!D8:D10");
  assert.equal(kpis[0].includeHeaders, true);
  assert.equal(kpis[0].goalValue, 100);
  assert.equal(kpis[0].comparisonRange, 'E8:E10');
  assert.equal(kpis[0].comparisonSheetId, 0);
  assert.equal(kpis[0].comparisonSheetTitle, 'Baseline');
  assert.equal(kpis[0].comparisonValue, 25);
  assert.equal(kpis[0].comparisonDelta, 25);

  const connectionRow = (await pool.query('SELECT * FROM integration_connections WHERE id=$1', [connection.id])).rows[0];
  const aad = `connection:${connection.id}:${first.workspaceId}:v1`;
  const tokens = vault.decryptJson({ ciphertext: connectionRow.token_ciphertext, iv: connectionRow.token_iv, authTag: connectionRow.token_auth_tag }, aad);
  tokens.expiresAt = Date.now() - 1;
  const expired = vault.encryptJson(tokens, aad);
  await pool.query('UPDATE integration_connections SET token_ciphertext=$1,token_iv=$2,token_auth_tag=$3,access_token_expires_at=NOW()-INTERVAL \'1 minute\' WHERE id=$4', [expired.ciphertext, expired.iv, expired.authTag, connection.id]);
  const sync = await api(`/api/axoboard/kpis/${createdKpi.id}/sync`, { method: 'POST', cookie: first.cookie });
  const syncText = await sync.text();
  assert.equal(sync.status, 200, syncText);
  assert.equal(JSON.parse(syncText).kpi.value, 50);
  assert.equal(JSON.parse(syncText).kpi.comparison.value, 25);
  assert.equal(refreshCalls, 1, 'expired access token is refreshed server-side');

  const valuesBeforeScheduledSync = valuesCalls;
  await pool.query('UPDATE kpi_mappings SET next_sync_at=NOW() WHERE id=$1', [createdKpi.id]);
  let successfulRuns;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    successfulRuns = await pool.query("SELECT COUNT(*)::int AS count FROM integration_sync_runs WHERE mapping_id=$1 AND status='succeeded'", [createdKpi.id]);
    if (successfulRuns.rows[0].count >= 3) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  assert.equal(valuesCalls, valuesBeforeScheduledSync + 2, 'due KPI refreshes its primary and comparison ranges exactly once');
  assert.equal(successfulRuns.rows[0].count, 3, 'initial, manual, and scheduled syncs are observable');

  const disconnected = await api(`/api/axoboard/integrations/connections/${connection.id}`, { method: 'DELETE', cookie: first.cookie });
  const disconnectedText = await disconnected.text();
  assert.equal(disconnected.status, 200, disconnectedText);
  assert.equal(revokeCalls, 1);
  const afterDisconnect = await api(`/api/axoboard/kpis/${createdKpi.id}/sync`, { method: 'POST', cookie: first.cookie });
  assert.equal(afterDisconnect.status, 409);
  const retained = await api('/api/axoboard/kpis', { cookie: first.cookie });
  const retainedKpi = (await retained.json()).kpis[0];
  assert.equal(retainedKpi.value, 50, 'disconnect preserves last known good value');
  assert.equal(retainedKpi.status, 'degraded');
  assert.equal(retainedKpi.lastErrorCode, 'connection_disconnected');

  console.log('AxoBoard Google integration test passed: OAuth, recent-first discovery, virtual-scroll grid preview, header-aware KPI and comparison ranges, sync, disconnect, and tenant isolation.');
} finally {
  app.kill('SIGTERM');
  await new Promise((resolveExit) => app.once('exit', resolveExit));
  await new Promise((resolveClose) => fakeGoogle.close(resolveClose));
  if (workspaceIds.length) await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [workspaceIds]);
  for (const email of testEmails) await pool.query('DELETE FROM users WHERE email=$1', [email]);
  await pool.end();
}
