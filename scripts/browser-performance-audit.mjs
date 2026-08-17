import assert from 'node:assert/strict';

const baseUrl = String(process.env.BASE_URL || 'http://127.0.0.1:43230').replace(/\/$/, '');
const email = String(process.env.AUDIT_EMAIL || '');
const password = String(process.env.AUDIT_PASSWORD || '');
const cdpPort = Number(process.env.CDP_PORT || 9227);
assert.ok(email && password, 'Set AUDIT_EMAIL and AUDIT_PASSWORD for an active test workspace.');

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: baseUrl },
  body: JSON.stringify({ email, password })
});
assert.equal(login.status, 200, await login.text());
const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
const [cookieName, cookieValue] = cookie.split('=');
assert.ok(cookieName && cookieValue, 'Login did not return a session cookie.');

const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(`${baseUrl}/app`)}`, { method: 'PUT' })).json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let commandId = 0;
const pending = new Map();
const events = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result || {});
    return;
  }
  const waiters = events.get(message.method) || [];
  events.delete(message.method);
  waiters.forEach((resolve) => resolve(message.params || {}));
});

function send(method, params = {}) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function once(method) {
  return new Promise((resolve) => events.set(method, [...(events.get(method) || []), resolve]));
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result?.value;
}

async function navigate(url) {
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  await loaded;
  await evaluate('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Network.setCookie', { name: cookieName, value: decodeURIComponent(cookieValue), url: baseUrl, httpOnly: true, sameSite: 'Lax' });
await navigate(`${baseUrl}/app`);

const firstLoad = await evaluate(`(async () => {
  const deadline = performance.now() + 5000;
  while (!performance.getEntriesByName(location.origin + '/api/axoboard/bootstrap').length && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  const resources = performance.getEntriesByType('resource').map((entry) => ({ name: new URL(entry.name).pathname, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, duration: entry.duration }));
  return {
    domInteractive: performance.getEntriesByType('navigation')[0]?.domInteractive || null,
    apiRequests: resources.filter((entry) => entry.name.startsWith('/api/')).map((entry) => entry.name),
    assetBytes: resources.filter((entry) => ['/app.js','/styles.css'].includes(entry.name)).reduce((total, entry) => total + entry.transferSize, 0),
    assetBodyBytes: resources.filter((entry) => ['/app.js','/styles.css'].includes(entry.name)).reduce((total, entry) => total + entry.encodedBodySize, 0),
    resources
  };
})()`);

const picker = await evaluate(`(async () => {
  document.querySelector('#kpiBuilderModal').classList.add('is-visible');
  document.querySelectorAll('.builder-step').forEach((step) => step.classList.toggle('is-active', step.dataset.builderStep === '2'));
  const values = Array.from({ length: 24 }, (_, row) => Array.from({ length: 12 }, (_, column) => row === 0 ? 'Header ' + (column + 1) : String((row + 1) * (column + 1))));
  sheetGridState = { spreadsheetTitle: 'Audit', sheet: { sheetId: 1, title: 'Performance' }, range: 'A1:L24', sourceRange: "'Performance'!A1:L24", startRow: 1, startColumn: 1, rowCount: 24, columnCount: 12, maxRows: 1000, maxColumns: 100, columns: Array.from({length:12},(_,index)=>sheetColumnLabel(index+1)), values };
  document.querySelector('#rangePickerModal').classList.add('is-visible');
  document.querySelector('#rangePickerModal').setAttribute('aria-hidden','false');
  await new Promise((resolve) => setTimeout(resolve, 250));
  const renderStart = performance.now();
  renderSheetGrid();
  const renderMs = performance.now() - renderStart;
  const dragStart = performance.now();
  for (let index = 1; index <= 80; index += 1) setSheetSelection({ row: 1, column: 1 }, { row: 1 + (index % 24), column: 1 + (index % 12) });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const modal = document.querySelector('.range-picker-modal').getBoundingClientRect();
  const button = document.querySelector('#selectRangeButton').getBoundingClientRect();
  return { renderMs, batchedSelectionsMs: performance.now() - dragStart, cells: document.querySelectorAll('#sheetGrid [data-sheet-cell]').length, modal: { width: modal.width, height: modal.height }, button: { width: button.width, height: button.height } };
})()`);

const visualizations = await evaluate(`(() => {
  const base = { value: 42, comparisonValue: 40, comparisonDelta: 2, goalValue: 100, status: 'active', displayFormat: 'number', aggregation: 'single_value', sheetTitle: 'Audit', range: 'A1:B4', sourceRange: "'Audit'!A1:B4", fetchedAt: new Date().toISOString() };
  const paired = { kind: 'paired', orientation: 'columns', headers: { label: 'Rep', value: 'Sales' }, items: [{ label: 'Ava', value: 90 }, { label: 'Ben', value: 70 }] };
  liveKpis = [
    ['scorecard', { kind: 'scalar', headers: { value: 'Revenue' } }], ['goal_pace', { kind: 'scalar', headers: { value: 'Revenue' } }], ['gauge', { kind: 'scalar', headers: { value: 'Revenue' } }],
    ['rep_cards', paired], ['leaderboard', paired], ['trend', paired], ['category_bar', paired], ['funnel', paired], ['pipeline', paired],
    ['activity_feed', { kind: 'activity_feed', columns: ['Timestamp','Event','Detail'], entries: [{ timestamp: 'Today', label: 'Closed won', detail: 'Ava', value: '90' }] }],
    ['heatmap', { kind: 'heatmap', cornerLabel: 'Rep / Day', xLabels: ['Mon','Tue'], yLabels: ['Ava','Ben'], cells: [[10,20],[30,40]], min: 10, max: 40 }],
    ['table', { kind: 'table', columns: ['Rep','Sales'], rows: [['Ava','90'],['Ben','70']] }]
  ].map(([displayType, displayPayload], index) => ({ ...base, id: 'audit-' + displayType, name: 'Audit ' + displayType, displayType, displayPayload, value: displayType === 'scorecard' ? 42 : base.value }));
  liveDashboardLayout = { kpiOrder: liveKpis.map((item) => item.id), hiddenSections: [] };
  renderLiveKpis();
  return {
    cards: document.querySelectorAll('[data-live-kpi]').length,
    leaderboardHeaders: [...document.querySelectorAll('.leaderboard-head > *')].map((node) => node.textContent.trim()),
    heatmapCorner: document.querySelector('.heatmap-visual header span')?.textContent.trim(),
    scalarStructured: document.querySelector('[data-live-kpi="audit-scorecard"]')?.classList.contains('kpi-card-structured'),
    tableHeaders: [...document.querySelectorAll('[data-live-kpi="audit-table"] th')].map((node) => node.textContent.trim())
  };
})()`);

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const mobile = await evaluate(`(() => {
  const modal = document.querySelector('.range-picker-modal').getBoundingClientRect();
  const button = document.querySelector('#selectRangeButton').getBoundingClientRect();
  return { modal: { width: modal.width, height: modal.height }, button: { width: button.width, height: button.height }, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
})()`);

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: false });
await navigate(`${baseUrl}/app`);
const warmLoad = await evaluate(`(() => {
  const resources = performance.getEntriesByType('resource').map((entry) => ({ name: new URL(entry.name).pathname, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, duration: entry.duration }));
  return { assetBytes: resources.filter((entry) => ['/app.js','/styles.css'].includes(entry.name)).reduce((total, entry) => total + entry.transferSize, 0), assetBodyBytes: resources.filter((entry) => ['/app.js','/styles.css'].includes(entry.name)).reduce((total, entry) => total + entry.encodedBodySize, 0), resources };
})()`);

console.log(JSON.stringify({ firstLoad, warmLoad, picker, visualizations, mobile }, null, 2));
assert.deepEqual(firstLoad.apiRequests, ['/api/axoboard/bootstrap'], 'app startup uses one product bootstrap request');
assert.ok(firstLoad.domInteractive < 1000, 'local app shell becomes interactive in under one second');
assert.ok(firstLoad.assetBodyBytes < 90_000, 'compressed core JS and CSS remain under 90 KB');
assert.equal(warmLoad.assetBodyBytes, 0, 'warm reload revalidates without retransferring core JS or CSS bodies');
assert.equal(picker.cells, 288, 'picker renders only the bounded 24×12 window');
assert.ok(picker.renderMs < 100, 'bounded picker grid renders in under 100 ms');
assert.ok(picker.batchedSelectionsMs < 100, 'batched drag selection settles in under 100 ms');
assert.ok(picker.modal.width >= 1000, 'desktop picker uses the expanded workspace');
assert.ok(picker.button.height >= 55, 'Choose Cells action is a prominent touch target');
assert.equal(visualizations.cards, 12, 'all card types render from their saved payload');
assert.deepEqual(visualizations.leaderboardHeaders, ['#', 'Rep', 'Sales'], 'leaderboard preserves source headers');
assert.equal(visualizations.heatmapCorner, 'Rep / Day', 'heatmap preserves its corner header');
assert.equal(visualizations.scalarStructured, false, 'scalar header metadata does not change scorecard rendering');
assert.deepEqual(visualizations.tableHeaders, ['Rep', 'Sales'], 'table preserves source headers');
assert.ok(mobile.modal.width <= mobile.viewportWidth && mobile.modal.height <= 844, 'mobile picker stays within the viewport');
assert.ok(mobile.button.height >= 55, 'mobile Choose Cells action remains a prominent touch target');
assert.equal(mobile.documentWidth, mobile.viewportWidth, 'mobile app has no page-level horizontal overflow');

socket.close();
