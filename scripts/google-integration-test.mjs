import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import pg from 'pg';
import { createVault } from '../lib/crypto-vault.mjs';
import { googleIntegrationInternals } from '../lib/google-integration.mjs';

const repPayload = googleIntegrationInternals.displayPayload(
  [['Rep', 'Sales'], ['Andrew', '10'], ['Jacob', '20']],
  'sum', true, 'rep_cards', [['100'], ['200']], false
);
assert.deepEqual(googleIntegrationInternals.normalizeRanges('A2, C2, F2'), ['A2', 'C2', 'F2']);
assert.throws(() => googleIntegrationInternals.normalizeRanges('A2,A2'), /must be different/, 'duplicate ranges are rejected before calling Google');
assert.throws(() => googleIntegrationInternals.normalizeRanges(Array.from({ length: 13 }, (_, index) => `A${index + 1}`).join(',')), /between 1 and 12/, 'multi-range selections have a bounded request count');
assert.deepEqual(
  googleIntegrationInternals.combineSelectedValues(['A2', 'C2', 'F2'], [{ values: [['Andrew']] }, { values: [[46189]] }, { values: [[50000]] }]),
  [['Andrew', 46189, 50000]],
  'non-adjacent one-cell ranges preserve selection order as one logical row'
);
assert.deepEqual(
  googleIntegrationInternals.combineSelectedValues(['A1:A2', 'C1:C2', 'F1:F2'], [
    { values: [['Rep'], ['Andrew']] }, { values: [['Monthly Revenue'], [46189]] }, { values: [['Goal'], [50000]] }
  ]),
  [['Rep', 'Monthly Revenue', 'Goal'], ['Andrew', 46189, 50000]],
  'equal-height ranges combine as logical columns'
);
assert.throws(() => googleIntegrationInternals.combineSelectedValues(['A1:A2', 'C1:D3'], [{ values: [] }, { values: [] }]), /same number of rows or the same number of columns/);
assert.deepEqual(
  googleIntegrationInternals.displayPayload([['Rep', 'Monthly Revenue', 'Goal'], ['Andrew', 46189, 50000]], 'single_value', true, 'scorecard'),
  {
    kind: 'scorecard', layout: 'rep_metric_goal',
    rep: { label: 'Rep', value: 'Andrew' },
    metric: { label: 'Monthly Revenue', value: 46189 },
    goal: { label: 'Goal', value: 50000 }
  },
  'scorecards retain a rep, prepared metric, and live goal from separate logical fields'
);
assert.deepEqual(repPayload, {
  kind: 'rep_cards',
  orientation: 'columns',
  headers: { label: 'Rep', value: 'Sales' },
  items: [
    { label: 'Andrew', value: 10, comparisonValue: 100 },
    { label: 'Jacob', value: 20, comparisonValue: 200 }
  ]
});
assert.deepEqual(
  googleIntegrationInternals.displayPayload([['Rep', 'Sales'], ['Andrew', 10], ['Jacob', 20]], 'sum', true, 'leaderboard'),
  {
    kind: 'leaderboard', orientation: 'columns', headers: { label: 'Rep', value: 'Sales' },
    items: [{ label: 'Andrew', value: 10, comparisonValue: null }, { label: 'Jacob', value: 20, comparisonValue: null }]
  },
  'leaderboards preserve both source headers for card rendering'
);
assert.deepEqual(
  googleIntegrationInternals.displayPayload([['Andrew', 'Jacob', 'Jaden'], [10, 20, 30]], 'sum', true, 'leaderboard'),
  {
    kind: 'leaderboard', orientation: 'rows', headers: { label: 'Label', value: 'Value' },
    items: [{ label: 'Andrew', value: 10, comparisonValue: null }, { label: 'Jacob', value: 20, comparisonValue: null }, { label: 'Jaden', value: 30, comparisonValue: null }]
  },
  'two-row leaderboards preserve their orientation and all prepared values'
);
assert.throws(
  () => googleIntegrationInternals.displayPayload([['Andrew', 10]], 'sum', false, 'leaderboard'),
  /Use first row as headers/,
  'ranked displays require an explicit header row'
);
assert.deepEqual(
  googleIntegrationInternals.displayPayload([['Rep', 'Sales'], ['Andrew', '$10']], 'count', true, 'table'),
  { kind: 'table', columns: ['Rep', 'Sales'], rows: [['Andrew', '$10']] }
);
assert.equal(
  googleIntegrationInternals.displayPayload([[82]], 'single_value', false, 'goal_pace'),
  null,
  'goal pace uses the prepared scalar value and optional goal'
);
assert.deepEqual(
  googleIntegrationInternals.displayPayload([['Revenue'], [82]], 'single_value', true, 'scorecard', [['Prior revenue'], [75]], true),
  { kind: 'scorecard', headers: { value: 'Revenue', comparison: 'Prior revenue' } },
  'scalar displays retain source and comparison headers without changing their prepared value contract'
);
assert.equal(
  googleIntegrationInternals.displayPayload([[82]], 'single_value', false, 'gauge'),
  null,
  'gauge uses the prepared scalar value and optional goal'
);
for (const displayType of ['trend', 'category_bar', 'funnel', 'pipeline']) {
  assert.deepEqual(
    googleIntegrationInternals.displayPayload([['Period', 'Value'], ['Mon', 10], ['Tue', 20]], 'sum', true, displayType),
    { kind: displayType, orientation: 'columns', headers: { label: 'Period', value: 'Value' }, items: [{ label: 'Mon', value: 10, comparisonValue: null }, { label: 'Tue', value: 20, comparisonValue: null }] },
    `${displayType} preserves ordered labels and prepared values`
  );
}
assert.deepEqual(
  googleIntegrationInternals.displayPayload(
    [['Time', 'Event', 'Detail', 'Value'], ['09:00', 'Deal won', 'Andrew', '$1,200'], ['10:15', 'Goal crossed', 'Team', '100%']],
    'sum', true, 'activity_feed'
  ),
  {
    kind: 'activity_feed', columns: ['Time', 'Event', 'Detail', 'Value'],
    entries: [
      { timestamp: '09:00', label: 'Deal won', detail: 'Andrew', value: '$1,200' },
      { timestamp: '10:15', label: 'Goal crossed', detail: 'Team', value: '100%' }
    ]
  }
);
assert.deepEqual(
  googleIntegrationInternals.displayPayload(
    [['Rep', 'Mon', 'Tue'], ['Andrew', 2, 5], ['Jacob', 8, 4]],
    'sum', true, 'heatmap'
  ),
  { kind: 'heatmap', cornerLabel: 'Rep', xLabels: ['Mon', 'Tue'], yLabels: ['Andrew', 'Jacob'], cells: [[2, 5], [8, 4]], min: 2, max: 8 }
);
assert.throws(
  () => googleIntegrationInternals.displayPayload([['Time'], ['09:00']], 'sum', true, 'activity_feed'),
  /2–4 columns/,
  'activity feeds require a useful event shape'
);
assert.throws(
  () => googleIntegrationInternals.displayPayload([['Rep', 'Sales'], ['Andrew', 10], ['Jacob', 20]], 'sum', true, 'leaderboard', [[9]], false),
  /2 value rows/,
  'paired comparisons must contain one prepared value for every displayed label'
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
  if (url.pathname === '/sheets/v4/spreadsheets/sheet_test_123456789/values:batchGet' && req.method === 'GET') {
    assert.match(String(req.headers.authorization), /^Bearer google_access_(initial|refreshed)$/);
    const ranges = url.searchParams.getAll('ranges');
    valuesCalls += 1;
    assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    const selectedValues = new Map([
      ["'Summary'!A2", [['Andrew']]],
      ["'Summary'!C2", [[46189]]],
      ["'Summary'!F2", [[50000]]],
      ["'Summary'!A1:A2", [['Rep'], ['Andrew']]],
      ["'Summary'!C1:C2", [['Monthly Revenue'], [46189]]],
      ["'Summary'!F1:F2", [['Goal'], [50000]]],
      ["'Summary'!G1:J1", [['Andrew', 'Jacob', 'Jaden', 'Xavier']]],
      ["'Summary'!G4:J4", [[46189, 13897, 64281, 21938]]],
      ["'Summary'!G5:J5", [[50000, 40000, 60000, 50000]]],
      ["'Summary'!D9", [[20]]]
    ]);
    assert.ok(ranges.every((range) => selectedValues.has(range)), `unexpected batch ranges: ${ranges.join(',')}`);
    return json(200, {
      spreadsheetId: 'sheet_test_123456789',
      valueRanges: ranges.map((range) => ({ range, majorDimension: 'ROWS', values: selectedValues.get(range) }))
    }, { 'x-request-id': `values-${valuesCalls}` });
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
    if (requestedRange === "'Baseline'!E8:E9") {
      assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
      return json(200, { range: 'Baseline!E8:E9', majorDimension: 'ROWS', values: [['Prior'], [10]] }, { 'x-request-id': `values-${valuesCalls}` });
    }
    if (requestedRange === "'Summary'!G1:J2") {
      return json(200, { range: 'Summary!G1:J2', majorDimension: 'ROWS', values: [['Andrew', 'Jacob', 'Jaden', 'Xavier'], [46189, 13897, 64281, 21938]] }, { 'x-request-id': `values-${valuesCalls}` });
    }
    if (requestedRange === "'Baseline'!G3:J3") {
      return json(200, { range: 'Baseline!G3:J3', majorDimension: 'ROWS', values: [[50000, 40000, 60000, 50000]] }, { 'x-request-id': `values-${valuesCalls}` });
    }
    if (requestedRange === "'Summary'!D8:D10") {
      assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
      return json(200, { range: 'Summary!D8:D10', majorDimension: 'ROWS', values: [['Revenue'], [20], [30]] }, { 'x-request-id': `values-${valuesCalls}` });
    }
    assert.equal(requestedRange, "'Summary'!D8:D9");
    assert.equal(url.searchParams.get('valueRenderOption'), 'UNFORMATTED_VALUE');
    return json(200, { range: 'Summary!D8:D9', majorDimension: 'ROWS', values: [['Revenue'], [20]] }, { 'x-request-id': `values-${valuesCalls}` });
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
  return { cookie, workspaceId: session.user.workspace_id, userId: session.user.id };
}

async function attachRole(account, workspaceId, role) {
  await pool.query('INSERT INTO memberships (id,workspace_id,user_id,role) VALUES ($1,$2,$3,$4)', [randomUUID(), workspaceId, account.userId, role]);
  await pool.query('UPDATE sessions SET workspace_id=$1 WHERE user_id=$2', [workspaceId, account.userId]);
  return { ...account, workspaceId, role };
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
  const admin = await attachRole(await signup('Admin'), first.workspaceId, 'admin');
  const editor = await attachRole(await signup('Editor'), first.workspaceId, 'editor');
  const viewer = await attachRole(await signup('Viewer'), first.workspaceId, 'viewer');

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

  const adminOAuth = await api('/api/axoboard/integrations/oauth/start', { method: 'POST', cookie: admin.cookie, body: { provider: 'google' } });
  assert.equal(adminOAuth.status, 200, 'admins can connect data sources');
  for (const denied of [editor, viewer]) {
    const deniedOAuth = await api('/api/axoboard/integrations/oauth/start', { method: 'POST', cookie: denied.cookie, body: { provider: 'google' } });
    const deniedOAuthBody = await deniedOAuth.json();
    assert.equal(deniedOAuth.status, 403);
    assert.equal(deniedOAuthBody.code, 'admin_required', `${denied.role} cannot connect data sources`);
  }
  const editorDisconnect = await api(`/api/axoboard/integrations/connections/${connection.id}`, { method: 'DELETE', cookie: editor.cookie });
  assert.equal(editorDisconnect.status, 403, 'editors cannot disconnect workspace data sources');
  assert.equal((await editorDisconnect.json()).code, 'admin_required');
  const editorConnections = await api('/api/axoboard/integrations/connections', { cookie: editor.cookie });
  assert.equal(editorConnections.status, 200, 'editors can use existing workspace connections');
  assert.equal((await editorConnections.json()).connections.length, 1);
  const viewerConnections = await api('/api/axoboard/integrations/connections', { cookie: viewer.cookie });
  assert.equal(viewerConnections.status, 403, 'viewers cannot enumerate admin connection records');
  assert.equal((await viewerConnections.json()).code, 'editor_required');

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

  const metadataBeforeGridBrowsing = metadataCalls;
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
  assert.equal(metadataCalls, metadataBeforeGridBrowsing, 'scrolling reuses bounded spreadsheet metadata instead of making a second provider request per window');

  const selection = { connectionId: connection.id, spreadsheet: 'sheet_test_123456789', sheetId: 12345, range: 'D8:D9', includeHeaders: true, goalValue: 100, comparisonSheetId: 0, comparisonRange: 'E8:E9', comparisonIncludeHeaders: true };
  const preview = await api('/api/axoboard/kpis/google/preview', { method: 'POST', cookie: first.cookie, body: selection });
  const previewText = await preview.text();
  assert.equal(preview.status, 200, previewText);
  assert.equal(JSON.parse(previewText).preview.value, 20);
  assert.equal(JSON.parse(previewText).preview.sourceRowCount, 1);
  assert.equal(JSON.parse(previewText).preview.includeHeaders, true);
  assert.equal(JSON.parse(previewText).preview.comparison.value, 10);
  assert.equal(JSON.parse(previewText).preview.comparison.delta, 10);
  assert.equal(JSON.parse(previewText).preview.comparison.percentChange, 100);
  assert.deepEqual(JSON.parse(previewText).preview.displayPayload, { kind: 'scorecard', headers: { value: 'Revenue', comparison: 'Prior' } });

  const repCardsPreview = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, range: 'G1:J2', aggregation: 'sum', includeHeaders: true, displayType: 'rep_cards', comparisonRange: 'G3:J3', comparisonAggregation: 'sum', comparisonIncludeHeaders: false }
  });
  const repCardsPreviewText = await repCardsPreview.text();
  assert.equal(repCardsPreview.status, 200, repCardsPreviewText);
  assert.deepEqual(JSON.parse(repCardsPreviewText).preview.displayPayload, {
    kind: 'rep_cards',
    orientation: 'rows',
    headers: { label: 'Label', value: 'Value' },
    items: [
      { label: 'Andrew', value: 46189, comparisonValue: 50000 },
      { label: 'Jacob', value: 13897, comparisonValue: 40000 },
      { label: 'Jaden', value: 64281, comparisonValue: 60000 },
      { label: 'Xavier', value: 21938, comparisonValue: 50000 }
    ]
  });

  const compositeScorecard = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, range: 'A2,C2,F2', includeHeaders: false, displayType: 'scorecard', comparisonRange: '' }
  });
  const compositeScorecardText = await compositeScorecard.text();
  assert.equal(compositeScorecard.status, 200, compositeScorecardText);
  const compositePreview = JSON.parse(compositeScorecardText).preview;
  assert.equal(compositePreview.value, 46189);
  assert.equal(compositePreview.sourceRowCount, 3);
  assert.equal(compositePreview.range, 'A2,C2,F2');
  assert.equal(compositePreview.sourceRange, "'Summary'!A2, 'Summary'!C2, 'Summary'!F2");
  assert.deepEqual(compositePreview.displayPayload, {
    kind: 'scorecard', layout: 'rep_metric_goal',
    rep: { label: 'Rep', value: 'Andrew' }, metric: { label: 'Metric', value: 46189 }, goal: { label: 'Goal', value: 50000 }
  });

  const valuesBeforeHeaderComposite = valuesCalls;
  const headerCompositeScorecard = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, range: 'A1:A2,C1:C2,F1:F2', includeHeaders: true, displayType: 'scorecard', comparisonRange: '' }
  });
  const headerCompositeText = await headerCompositeScorecard.text();
  assert.equal(headerCompositeScorecard.status, 200, headerCompositeText);
  assert.equal(valuesCalls, valuesBeforeHeaderComposite + 1, 'separate scorecard fields use one Sheets batch request');
  assert.deepEqual(JSON.parse(headerCompositeText).preview.displayPayload, {
    kind: 'scorecard', layout: 'rep_metric_goal',
    rep: { label: 'Rep', value: 'Andrew' }, metric: { label: 'Monthly Revenue', value: 46189 }, goal: { label: 'Goal', value: 50000 }
  }, 'scorecard headers provide the rep, metric, and goal labels shown on the card');

  const roleBasedLeaderboard = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: {
      ...selection, range: 'G1:J1,G4:J4', includeHeaders: false, displayType: 'leaderboard', comparisonRange: '',
      rangeRoles: [{ range: 'G1:J1', role: 'header' }, { range: 'G4:J4', role: 'metric' }]
    }
  });
  const roleBasedLeaderboardText = await roleBasedLeaderboard.text();
  assert.equal(roleBasedLeaderboard.status, 200, roleBasedLeaderboardText);
  const rolePreview = JSON.parse(roleBasedLeaderboardText).preview;
  assert.equal(rolePreview.includeHeaders, true, 'a separate header range enables headers without an inline header row');
  assert.deepEqual(rolePreview.rangeRoles, [{ range: 'G1:J1', role: 'header' }, { range: 'G4:J4', role: 'metric' }]);
  assert.deepEqual(rolePreview.displayPayload.items.map((item) => [item.label, item.value]), [
    ['Andrew', 46189], ['Jacob', 13897], ['Jaden', 64281], ['Xavier', 21938]
  ], 'one header range aligns with a separate metrics range');

  const sheetGoalPreview = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: {
      ...selection, range: 'G1:J1,G4:J4,G5:J5', includeHeaders: false, displayType: 'rep_cards', comparisonRange: '', goalValue: '',
      rangeRoles: [{ range: 'G1:J1', role: 'header' }, { range: 'G4:J4', role: 'metric' }, { range: 'G5:J5', role: 'goal' }]
    }
  });
  const sheetGoalBody = await sheetGoalPreview.json();
  assert.equal(sheetGoalPreview.status, 200, JSON.stringify(sheetGoalBody));
  assert.equal(sheetGoalBody.preview.goalSource, 'google_sheets');
  assert.equal(sheetGoalBody.preview.goalValue, null, 'a per-item goal range stays in the structured payload rather than collapsing to one scalar');
  assert.deepEqual(sheetGoalBody.preview.displayPayload.items.map((item) => [item.label, item.value, item.goalValue]), [
    ['Andrew', 46189, 50000], ['Jacob', 13897, 40000], ['Jaden', 64281, 60000], ['Xavier', 21938, 50000]
  ], 'matching goal ranges attach one live goal to every rep card');

  const scalarSheetGoal = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: {
      ...selection, range: 'D9,F2', includeHeaders: false, displayType: 'goal_pace', comparisonRange: '', goalValue: '',
      rangeRoles: [{ range: 'D9', role: 'metric' }, { range: 'F2', role: 'goal' }]
    }
  });
  const scalarSheetGoalBody = await scalarSheetGoal.json();
  assert.equal(scalarSheetGoal.status, 200, JSON.stringify(scalarSheetGoalBody));
  assert.equal(scalarSheetGoalBody.preview.value, 20);
  assert.equal(scalarSheetGoalBody.preview.goalValue, 50000);
  assert.equal(scalarSheetGoalBody.preview.goalSource, 'google_sheets');

  const createGoalMetric = await api('/api/axoboard/kpis', {
    method: 'POST', cookie: first.cookie,
    body: {
      ...selection, comparisonRange: '', comparisonSheetId: null, name: 'Certified monthly revenue', displayFormat: 'currency',
      displayType: 'goal_pace', goalValue: 25, periodGranularity: 'month', goalDirection: 'higher_is_better',
      goalCalendarType: 'weekdays', goalTimezone: 'America/Denver'
    }
  });
  const createGoalText = await createGoalMetric.text();
  assert.equal(createGoalMetric.status, 201, createGoalText);
  const goalKpi = JSON.parse(createGoalText).kpi;
  const goalKpiList = await api('/api/axoboard/kpis', { cookie: first.cookie });
  const persistedGoalKpi = (await goalKpiList.json()).kpis.find((kpi) => kpi.id === goalKpi.id);
  assert.equal(persistedGoalKpi.certification.status, 'certified');
  assert.equal(persistedGoalKpi.certification.method, 'source_contract_v1');
  assert.equal(persistedGoalKpi.goal.periodGranularity, 'month');
  assert.equal(persistedGoalKpi.goalCalendarType, 'weekdays');
  assert.equal(persistedGoalKpi.goalTimezone, 'America/Denver');
  assert.ok(persistedGoalKpi.intelligence.projectedFinish > 0);
  assert.equal(persistedGoalKpi.intelligence.nextMilestone, 90);

  const trustResponse = await api(`/api/axoboard/metrics/${goalKpi.id}/trust`, { cookie: first.cookie });
  const trustBody = await trustResponse.json();
  assert.equal(trustResponse.status, 200, JSON.stringify(trustBody));
  assert.equal(trustBody.metric.mappingId, goalKpi.id);
  assert.equal(trustBody.metric.source.range, 'D8:D9');
  assert.equal(trustBody.metric.freshness.staleAfterSeconds, 900);
  assert.equal(trustBody.metric.lineageHash.length, 64);
  const foreignTrust = await api(`/api/axoboard/metrics/${goalKpi.id}/trust`, { cookie: second.cookie });
  assert.equal(foreignTrust.status, 404, 'another workspace cannot discover certified metric trust details');

  const firstEvents = await api('/api/axoboard/events', { cookie: first.cookie });
  const firstEventBody = await firstEvents.json();
  assert.equal(firstEvents.status, 200, JSON.stringify(firstEventBody));
  const firstMilestones = firstEventBody.events.filter((event) => event.type.startsWith('goal.milestone.'));
  const firstSnapshots = firstEventBody.events.filter((event) => event.type === 'metric.snapshot.recorded.v1');
  assert.deepEqual(firstMilestones.map((event) => event.payload.milestone).sort((a, b) => a - b), [25, 50, 75]);
  assert.equal(firstSnapshots.length, 1, 'each accepted certified snapshot emits one normalized event');
  assert.equal(firstSnapshots[0].payload.schemaVersion, 1);
  assert.equal(firstSnapshots[0].payload.metricId, persistedGoalKpi.metricId);
  assert.equal(firstSnapshots[0].payload.value, 20);
  assert.equal(firstSnapshots[0].payload.certification.status, 'certified');
  assert.equal(firstSnapshots[0].payload.freshness.status, 'fresh');
  assert.doesNotMatch(JSON.stringify(firstSnapshots[0].payload), /google|spreadsheet|sheets-owner@example\.com/i, 'snapshot events are provider-neutral and credential-free');
  assert.ok(firstEventBody.events.every((event) => event.delivery.status === 'pending'));
  const sourceSnapshotId = firstSnapshots[0].payload.snapshotId;
  const snapshotContext = (await pool.query(`SELECT s.*,m.* FROM metric_snapshots s
    JOIN kpi_mappings m ON m.workspace_id=s.workspace_id AND m.id=s.mapping_id
    WHERE s.workspace_id=$1 AND s.id=$2`, [first.workspaceId, sourceSnapshotId])).rows[0];
  const metricContext = (await pool.query('SELECT * FROM metric_definitions WHERE workspace_id=$1 AND mapping_id=$2', [first.workspaceId, goalKpi.id])).rows[0];
  const goalContext = (await pool.query("SELECT * FROM goal_configs WHERE workspace_id=$1 AND metric_id=$2 AND status='active'", [first.workspaceId, metricContext.id])).rows[0];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await googleIntegrationInternals.recordMetricSnapshotEvent(pool, {
      mapping: snapshotContext, snapshotId: sourceSnapshotId, value: snapshotContext.value, goalValue: snapshotContext.snapshot_goal_value,
      fetchedAt: snapshotContext.fetched_at, engagement: { metric: metricContext, goal: goalContext, intelligence: null }
    });
  }
  const idempotentSnapshotEvent = await pool.query(`SELECT e.id,o.status,o.attempt_count,o.processed_at FROM domain_events e
    JOIN event_outbox o ON o.workspace_id=e.workspace_id AND o.event_id=e.id
    WHERE e.workspace_id=$1 AND e.idempotency_key=$2`, [first.workspaceId, `metric_snapshot:${sourceSnapshotId}:v1`]);
  assert.equal(idempotentSnapshotEvent.rowCount, 1, 'retries cannot duplicate a snapshot event or outbox row');
  assert.equal(idempotentSnapshotEvent.rows[0].status, 'pending');
  assert.equal(idempotentSnapshotEvent.rows[0].attempt_count, 0);
  assert.equal(idempotentSnapshotEvent.rows[0].processed_at, null, 'recording an event does not imply external delivery');
  const isolatedEvents = await api('/api/axoboard/events', { cookie: second.cookie });
  assert.deepEqual((await isolatedEvents.json()).events, [], 'milestone ledger is workspace scoped');
  const viewerEvents = await api('/api/axoboard/events', { cookie: viewer.cookie });
  const viewerEventBody = await viewerEvents.json();
  assert.equal(viewerEvents.status, 403, 'viewers cannot read event control-plane records');
  assert.equal(viewerEventBody.code, 'editor_required');
  const editorEvents = await api('/api/axoboard/events', { cookie: editor.cookie });
  assert.equal(editorEvents.status, 200, 'editors can read workspace event records');
  assert.equal((await editorEvents.json()).events.length, firstEventBody.events.length);
  const viewerTrust = await api(`/api/axoboard/metrics/${goalKpi.id}/trust`, { cookie: viewer.cookie });
  const viewerTrustBody = await viewerTrust.json();
  assert.equal(viewerTrust.status, 200);
  assert.equal('source' in viewerTrustBody.metric, false, 'viewer trust payload excludes source identity');
  assert.equal('lineageHash' in viewerTrustBody.metric, false, 'viewer trust payload excludes internal lineage');
  assert.equal('definition' in viewerTrustBody.metric, false, 'viewer trust payload excludes provider-specific definitions');
  assert.equal('errorCode' in viewerTrustBody.metric.freshness, false, 'viewer trust payload excludes internal sync errors');
  const repeatGoalSync = await api(`/api/axoboard/kpis/${goalKpi.id}/sync`, { method: 'POST', cookie: first.cookie });
  assert.equal(repeatGoalSync.status, 200, await repeatGoalSync.text());
  const repeatedEvents = await api('/api/axoboard/events', { cookie: first.cookie });
  const repeatedEventBody = await repeatedEvents.json();
  assert.equal(repeatedEventBody.events.filter((event) => event.type.startsWith('goal.milestone.')).length, 3, 'repeated snapshots cannot duplicate milestone events in one goal period');
  assert.equal(repeatedEventBody.events.filter((event) => event.type === 'metric.snapshot.recorded.v1').length, 2, 'a new accepted snapshot emits its own event');
  const goalBootstrap = await api('/api/axoboard/bootstrap', { cookie: first.cookie });
  const goalBootstrapBody = await goalBootstrap.json();
  assert.equal(goalBootstrapBody.brand.name, 'Google Primary');
  assert.equal(goalBootstrapBody.brand.version, 1);
  assert.ok(goalBootstrapBody.engagement.summary.certified >= 1);
  assert.equal(goalBootstrapBody.engagement.events.length, 5);
  const deleteGoalMetric = await api(`/api/axoboard/kpis/${goalKpi.id}`, { method: 'DELETE', cookie: first.cookie });
  assert.equal(deleteGoalMetric.status, 200);

  const ambiguousRange = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, range: 'D8:D10', includeHeaders: false, comparisonRange: '' }
  });
  const ambiguousRangeBody = await ambiguousRange.json();
  assert.equal(ambiguousRange.status, 200, 'preview validation is a successful API response so expected builder feedback does not create failed-resource noise');
  assert.equal(ambiguousRangeBody.preview, null);
  assert.equal(ambiguousRangeBody.validation.valid, false);
  assert.equal(ambiguousRangeBody.validation.code, 'single_value_requires_one_cell', 'multi-cell ranges cannot silently collapse to the first value');

  const sameComparison = await api('/api/axoboard/kpis/google/preview', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, comparisonSheetId: 12345, comparisonRange: 'D8:D9' }
  });
  const sameComparisonBody = await sameComparison.json();
  assert.equal(sameComparison.status, 200);
  assert.equal(sameComparisonBody.preview, null);
  assert.equal(sameComparisonBody.validation.valid, false);
  assert.equal(sameComparisonBody.validation.code, 'comparison_matches_kpi_range', 'a KPI cannot compare against itself');

  const rejectedCreate = await api('/api/axoboard/kpis', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, range: 'D8:D10', includeHeaders: false, comparisonRange: '', name: 'Invalid multi-cell scorecard', displayFormat: 'number' }
  });
  const rejectedCreateBody = await rejectedCreate.json();
  assert.equal(rejectedCreate.status, 422, 'creation remains strict when preview validation fails');
  assert.equal(rejectedCreateBody.code, 'single_value_requires_one_cell');

  const createComposite = await api('/api/axoboard/kpis', {
    method: 'POST', cookie: first.cookie,
    body: { ...selection, range: 'A2,C2,F2', includeHeaders: false, comparisonRange: '', name: 'Andrew monthly revenue', displayFormat: 'currency', displayType: 'scorecard' }
  });
  const createCompositeText = await createComposite.text();
  assert.equal(createComposite.status, 201, createCompositeText);
  const compositeKpi = JSON.parse(createCompositeText).kpi;
  const compositeList = await api('/api/axoboard/kpis', { cookie: first.cookie });
  const persistedComposite = (await compositeList.json()).kpis.find((kpi) => kpi.id === compositeKpi.id);
  assert.equal(persistedComposite.range, 'A2,C2,F2');
  assert.equal(persistedComposite.value, 46189);
  assert.equal(persistedComposite.displayPayload.layout, 'rep_metric_goal');
  assert.equal(persistedComposite.displayPayload.rep.value, 'Andrew');
  assert.equal(persistedComposite.displayPayload.goal.value, 50000);
  const syncComposite = await api(`/api/axoboard/kpis/${compositeKpi.id}/sync`, { method: 'POST', cookie: first.cookie });
  assert.equal(syncComposite.status, 200, await syncComposite.text());
  const deleteComposite = await api(`/api/axoboard/kpis/${compositeKpi.id}`, { method: 'DELETE', cookie: first.cookie });
  assert.equal(deleteComposite.status, 200);

  const createRoleKpi = await api('/api/axoboard/kpis', {
    method: 'POST', cookie: first.cookie,
    body: {
      ...selection, range: 'G1:J1,G4:J4,G5:J5', includeHeaders: false, displayType: 'leaderboard', comparisonRange: '',
      rangeRoles: [{ range: 'G1:J1', role: 'header' }, { range: 'G4:J4', role: 'metric' }, { range: 'G5:J5', role: 'goal' }],
      name: 'Revenue leaderboard', displayFormat: 'currency'
    }
  });
  const createRoleText = await createRoleKpi.text();
  assert.equal(createRoleKpi.status, 201, createRoleText);
  const roleKpi = JSON.parse(createRoleText).kpi;
  const editRoleKpi = await api(`/api/axoboard/kpis/${roleKpi.id}`, {
    method: 'PUT', cookie: first.cookie,
    body: {
      ...selection, range: 'G1:J1,G4:J4,G5:J5', includeHeaders: false, displayType: 'leaderboard', comparisonRange: '',
      rangeRoles: [{ range: 'G1:J1', role: 'header' }, { range: 'G4:J4', role: 'metric' }, { range: 'G5:J5', role: 'goal' }],
      name: 'Monthly revenue leaderboard', displayFormat: 'number'
    }
  });
  const editRoleText = await editRoleKpi.text();
  assert.equal(editRoleKpi.status, 200, editRoleText);
  const editedList = await api('/api/axoboard/kpis', { cookie: first.cookie });
  const editedRoleKpi = (await editedList.json()).kpis.find((kpi) => kpi.id === roleKpi.id);
  assert.equal(editedRoleKpi.name, 'Monthly revenue leaderboard');
  assert.equal(editedRoleKpi.displayFormat, 'number');
  assert.equal(editedRoleKpi.spreadsheetId, 'sheet_test_123456789');
  assert.deepEqual(editedRoleKpi.rangeRoles, [{ range: 'G1:J1', role: 'header' }, { range: 'G4:J4', role: 'metric' }, { range: 'G5:J5', role: 'goal' }]);
  assert.equal(editedRoleKpi.goalSource, 'google_sheets');
  assert.deepEqual(editedRoleKpi.displayPayload.items.map((item) => item.goalValue), [50000, 40000, 60000, 50000]);
  const crossTenantEdit = await api(`/api/axoboard/kpis/${roleKpi.id}`, { method: 'PUT', cookie: second.cookie, body: {} });
  assert.equal(crossTenantEdit.status, 404, 'another workspace cannot discover or edit the KPI');
  const deleteRoleKpi = await api(`/api/axoboard/kpis/${roleKpi.id}`, { method: 'DELETE', cookie: first.cookie });
  assert.equal(deleteRoleKpi.status, 200);

  const create = await api('/api/axoboard/kpis', { method: 'POST', cookie: first.cookie, body: { ...selection, name: 'Qualified pipeline', displayFormat: 'currency' } });
  const createText = await create.text();
  assert.equal(create.status, 201, createText);
  const createdKpi = JSON.parse(createText).kpi;
  assert.equal(createdKpi.value, 20);
  assert.ok(createdKpi.metricId, 'new KPIs expose their certified metric identity for automation setup');
  const destinationResponse = await api('/api/axoboard/automation-destinations', {
    method: 'POST', cookie: first.cookie,
    body: { name: 'Restore-safe TVs', type: 'internal_tv_celebration', config: {} }
  });
  const destinationText = await destinationResponse.text();
  assert.equal(destinationResponse.status, 201, destinationText);
  const destinationId = JSON.parse(destinationText).destination.id;
  const automationResponse = await api('/api/axoboard/automations', {
    method: 'POST', cookie: first.cookie,
    body: {
      name: 'Qualified pipeline threshold', metricId: createdKpi.metricId,
      trigger: { type: 'metric_threshold', operator: 'gte', thresholdMode: 'absolute', thresholdValue: 20, behavior: 'edge', durationSeconds: 0 },
      guardrails: { freshnessSeconds: 900, cooldownSeconds: 0, maxRunsPerDay: 20, timezone: 'America/Denver' },
      actions: [{ type: 'internal_tv_celebration', destinationId, config: { title: 'Pipeline target reached', message: 'Qualified pipeline reached its target.', durationSeconds: 6, theme: 'brand' } }]
    }
  });
  const automationText = await automationResponse.text();
  assert.equal(automationResponse.status, 201, automationText);
  const automationId = JSON.parse(automationText).automation.id;
  const list = await api('/api/axoboard/kpis', { cookie: first.cookie });
  const kpis = (await list.json()).kpis;
  assert.equal(kpis.length, 1);
  assert.equal(kpis[0].value, 20);
  assert.equal(kpis[0].sourceRange, "'Summary'!D8:D9");
  assert.equal(kpis[0].includeHeaders, true);
  assert.equal(kpis[0].goalValue, 100);
  assert.equal(kpis[0].comparisonRange, 'E8:E9');
  assert.equal(kpis[0].comparisonSheetId, 0);
  assert.equal(kpis[0].comparisonSheetTitle, 'Baseline');
  assert.equal(kpis[0].comparisonValue, 10);
  assert.equal(kpis[0].comparisonDelta, 10);
  assert.deepEqual(kpis[0].displayPayload, { kind: 'scorecard', headers: { value: 'Revenue', comparison: 'Prior' } });

  const bootstrap = await api('/api/axoboard/bootstrap', { cookie: first.cookie });
  const bootstrapBody = await bootstrap.json();
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrapBody.session.user.workspace_id, first.workspaceId);
  assert.equal(bootstrapBody.connections.connections.length, 1);
  assert.equal(bootstrapBody.kpis.kpis.length, 1);
  assert.deepEqual(bootstrapBody.dashboard.dashboard.layout.kpiOrder, [createdKpi.id]);

  const adminBootstrap = await api('/api/axoboard/bootstrap', { cookie: admin.cookie });
  const adminBootstrapBody = await adminBootstrap.json();
  assert.equal(adminBootstrap.status, 200);
  assert.equal(adminBootstrapBody.session.capabilities.manageAutomationDrafts, true);
  assert.equal(adminBootstrapBody.session.capabilities.publishAutomations, true);
  assert.equal(adminBootstrapBody.session.capabilities.manageAutomationDestinations, true);
  assert.equal(adminBootstrapBody.session.capabilities.retryAutomationActions, true);

  const editorBootstrap = await api('/api/axoboard/bootstrap', { cookie: editor.cookie });
  const editorBootstrapBody = await editorBootstrap.json();
  assert.equal(editorBootstrap.status, 200);
  assert.equal(editorBootstrapBody.session.capabilities.manageKpis, true);
  assert.equal(editorBootstrapBody.session.capabilities.readDisplays, false);
  assert.equal(editorBootstrapBody.session.capabilities.readEvents, true);
  assert.equal(editorBootstrapBody.session.capabilities.manageDisplays, false);
  assert.equal(editorBootstrapBody.session.capabilities.readAutomations, true);
  assert.equal(editorBootstrapBody.session.capabilities.manageAutomationDrafts, true);
  assert.equal(editorBootstrapBody.session.capabilities.publishAutomations, false);
  assert.equal(editorBootstrapBody.session.capabilities.manageAutomationDestinations, false);
  assert.equal(editorBootstrapBody.session.capabilities.retryAutomationActions, false);
  assert.equal(editorBootstrapBody.connections.connections.length, 1);
  assert.equal(editorBootstrapBody.kpis.kpis[0].connectionId, connection.id, 'editors retain source details needed to manage KPI drafts');
  const editorDashboardSave = await api('/api/axoboard/dashboard', {
    method: 'PUT', cookie: editor.cookie, body: { layout: { preset: 'balanced', kpiOrder: [createdKpi.id] } }
  });
  assert.equal(editorDashboardSave.status, 200, 'editors retain dashboard draft management');

  const viewerBootstrap = await api('/api/axoboard/bootstrap', { cookie: viewer.cookie });
  const viewerBootstrapText = await viewerBootstrap.text();
  const viewerBootstrapBody = JSON.parse(viewerBootstrapText);
  assert.equal(viewerBootstrap.status, 200);
  assert.equal(viewerBootstrapBody.session.capabilities.readKpis, true);
  assert.equal(viewerBootstrapBody.session.capabilities.manageKpis, false);
  assert.equal(viewerBootstrapBody.session.capabilities.readDisplays, false);
  assert.equal(viewerBootstrapBody.session.capabilities.manageDisplays, false);
  assert.equal(viewerBootstrapBody.session.capabilities.readEvents, false);
  assert.equal(viewerBootstrapBody.session.capabilities.readAutomations, false);
  assert.equal(viewerBootstrapBody.session.capabilities.manageAutomationDrafts, false);
  assert.equal(viewerBootstrapBody.session.capabilities.publishAutomations, false);
  assert.equal(viewerBootstrapBody.session.capabilities.manageAutomationDestinations, false);
  assert.equal(viewerBootstrapBody.session.capabilities.retryAutomationActions, false);
  assert.equal(viewerBootstrapBody.connections.restricted, true);
  assert.deepEqual(viewerBootstrapBody.connections.connections, []);
  assert.deepEqual(viewerBootstrapBody.engagement.events, [], 'viewer bootstrap excludes event IDs, payloads, idempotency keys, and outbox state');
  assert.ok(viewerBootstrapBody.engagement.summary.certified >= 1, 'viewer retains safe aggregate certification health');
  assert.ok(viewerBootstrapBody.engagement.summary.latestVerifiedAt, 'viewer retains safe aggregate freshness');
  assert.equal(viewerBootstrapBody.kpis.kpis.length, 1);
  for (const sensitiveField of ['provider', 'connectionId', 'spreadsheetId', 'spreadsheetTitle', 'sheetId', 'sheetTitle', 'sourceRange', 'lastErrorCode', 'lineageHash']) {
    assert.equal(sensitiveField in viewerBootstrapBody.kpis.kpis[0], false, `viewer KPI excludes ${sensitiveField}`);
  }
  assert.doesNotMatch(viewerBootstrapText, /google sheets|sheet_test_123456789|summary!d8:d9|sheets-owner@example\.com/i, 'viewer bootstrap excludes provider account and source identity');

  const viewerKpis = await api('/api/axoboard/kpis', { cookie: viewer.cookie });
  const viewerKpiText = await viewerKpis.text();
  assert.equal(viewerKpis.status, 200);
  assert.doesNotMatch(viewerKpiText, /google sheets|sheet_test_123456789|summary!d8:d9|sheets-owner@example\.com/i, 'viewer KPI list is source-redacted');

  const viewerMutationCases = [
    ['/api/axoboard/kpis/google/preview', { method: 'POST', body: selection }, 'editor_required'],
    ['/api/axoboard/kpis', { method: 'POST', body: { ...selection, name: 'Forbidden KPI' } }, 'editor_required'],
    ['/api/axoboard/dashboard', { method: 'PUT', body: { layout: { kpiOrder: [createdKpi.id] } } }, 'editor_required'],
    [`/api/axoboard/kpis/${createdKpi.id}/sync`, { method: 'POST' }, 'editor_required'],
    [`/api/axoboard/kpis/${createdKpi.id}`, { method: 'PUT', body: {} }, 'editor_required'],
    [`/api/axoboard/kpis/${createdKpi.id}`, { method: 'DELETE' }, 'editor_required'],
    [`/api/axoboard/integrations/connections/${connection.id}`, { method: 'DELETE' }, 'admin_required']
  ];
  for (const [path, options, code] of viewerMutationCases) {
    const denied = await api(path, { ...options, cookie: viewer.cookie });
    const deniedBody = await denied.json();
    assert.equal(denied.status, 403, `viewer mutation is denied: ${options.method} ${path}`);
    assert.equal(deniedBody.code, code);
  }

  const initialDashboard = await api('/api/axoboard/dashboard', { cookie: first.cookie });
  assert.equal(initialDashboard.status, 200);
  assert.deepEqual((await initialDashboard.json()).dashboard.layout.kpiOrder, [createdKpi.id], 'dashboard order is derived only from the authenticated workspace');
  const isolatedDashboard = await api('/api/axoboard/dashboard', { method: 'PUT', cookie: second.cookie, body: { layout: { preset: 'compact', kpiOrder: [createdKpi.id] } } });
  assert.equal(isolatedDashboard.status, 200);
  assert.deepEqual((await isolatedDashboard.json()).dashboard.layout.kpiOrder, [], 'foreign KPI IDs are removed from another workspace layout');

  const connectionRow = (await pool.query('SELECT * FROM integration_connections WHERE id=$1', [connection.id])).rows[0];
  const aad = `connection:${connection.id}:${first.workspaceId}:v1`;
  const tokens = vault.decryptJson({ ciphertext: connectionRow.token_ciphertext, iv: connectionRow.token_iv, authTag: connectionRow.token_auth_tag }, aad);
  tokens.expiresAt = Date.now() - 1;
  const expired = vault.encryptJson(tokens, aad);
  await pool.query('UPDATE integration_connections SET token_ciphertext=$1,token_iv=$2,token_auth_tag=$3,access_token_expires_at=NOW()-INTERVAL \'1 minute\' WHERE id=$4', [expired.ciphertext, expired.iv, expired.authTag, connection.id]);
  const sync = await api(`/api/axoboard/kpis/${createdKpi.id}/sync`, { method: 'POST', cookie: first.cookie });
  const syncText = await sync.text();
  assert.equal(sync.status, 200, syncText);
  assert.equal(JSON.parse(syncText).kpi.value, 20);
  assert.equal(JSON.parse(syncText).kpi.comparison.value, 10);
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

  const createSecond = await api('/api/axoboard/kpis', { method: 'POST', cookie: first.cookie, body: { ...selection, name: 'Revenue pacing', displayFormat: 'currency' } });
  const createSecondText = await createSecond.text();
  assert.equal(createSecond.status, 201, createSecondText);
  const secondKpi = JSON.parse(createSecondText).kpi;
  const savedDashboard = await api('/api/axoboard/dashboard', {
    method: 'PUT', cookie: first.cookie,
    body: { layout: { preset: 'compact', showTrend: false, showActionCenter: true, kpiOrder: [secondKpi.id, createdKpi.id] } }
  });
  const savedDashboardBody = await savedDashboard.json();
  assert.equal(savedDashboard.status, 200);
  assert.deepEqual(savedDashboardBody.dashboard.layout.kpiOrder, [secondKpi.id, createdKpi.id], 'workspace KPI order is persisted');
  assert.equal(savedDashboardBody.dashboard.layout.preset, 'compact');
  assert.equal(savedDashboardBody.dashboard.layout.showTrend, false);

  const disconnected = await api(`/api/axoboard/integrations/connections/${connection.id}`, { method: 'DELETE', cookie: first.cookie });
  const disconnectedText = await disconnected.text();
  assert.equal(disconnected.status, 200, disconnectedText);
  assert.equal(revokeCalls, 1);
  const afterDisconnect = await api(`/api/axoboard/kpis/${createdKpi.id}/sync`, { method: 'POST', cookie: first.cookie });
  assert.equal(afterDisconnect.status, 409);
  const retained = await api('/api/axoboard/kpis', { cookie: first.cookie });
  const retainedKpi = (await retained.json()).kpis.find((kpi) => kpi.id === createdKpi.id);
  assert.equal(retainedKpi.value, 20, 'disconnect preserves last known good value');
  assert.equal(retainedKpi.status, 'degraded');
  assert.equal(retainedKpi.lastErrorCode, 'connection_disconnected');

  const crossTenantDelete = await api(`/api/axoboard/kpis/${createdKpi.id}`, { method: 'DELETE', cookie: second.cookie });
  assert.equal(crossTenantDelete.status, 404, 'another workspace cannot discover or delete the KPI');
  const blockedDelete = await api(`/api/axoboard/kpis/${createdKpi.id}`, { method: 'DELETE', cookie: first.cookie });
  const blockedDeleteBody = await blockedDelete.json();
  assert.equal(blockedDelete.status, 409, 'KPIs with linked automations cannot be deleted');
  assert.equal(blockedDeleteBody.code, 'kpi_has_linked_automations');
  assert.equal(blockedDeleteBody.details.count, 1);
  assert.equal(blockedDeleteBody.details.automations[0].id, automationId);
  const archivedAutomation = await api(`/api/axoboard/automations/${automationId}/archive`, { method: 'POST', cookie: first.cookie, body: {} });
  assert.equal(archivedAutomation.status, 200, await archivedAutomation.text());
  const deleteFirst = await api(`/api/axoboard/kpis/${createdKpi.id}`, { method: 'DELETE', cookie: first.cookie });
  assert.equal(deleteFirst.status, 200);
  const layoutAfterDelete = await api('/api/axoboard/dashboard', { cookie: first.cookie });
  assert.deepEqual((await layoutAfterDelete.json()).dashboard.layout.kpiOrder, [secondKpi.id], 'deleted KPI is removed from the saved layout');
  const deleteSecond = await api(`/api/axoboard/kpis/${secondKpi.id}`, { method: 'DELETE', cookie: first.cookie });
  assert.equal(deleteSecond.status, 200);
  const emptyList = await api('/api/axoboard/kpis', { cookie: first.cookie });
  assert.deepEqual((await emptyList.json()).kpis, [], 'soft-deleted KPIs no longer render on the workspace dashboard');

  console.log('AxoBoard Google integration test passed: OAuth, recent-first discovery, virtual-scroll grid preview, non-adjacent ranges, rep-metric-goal scorecards, header-aware comparisons, workspace layout, delete, sync, disconnect, and tenant isolation.');
} finally {
  app.kill('SIGTERM');
  await new Promise((resolveExit) => app.once('exit', resolveExit));
  await new Promise((resolveClose) => fakeGoogle.close(resolveClose));
  if (workspaceIds.length) await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [workspaceIds]);
  for (const email of testEmails) await pool.query('DELETE FROM users WHERE email=$1', [email]);
  await pool.end();
}
