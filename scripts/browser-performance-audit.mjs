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
await send('Page.bringToFront');

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

const drivePicker = await evaluate(`(async () => {
  availableSpreadsheets = [
    { spreadsheetId: 'sheet-audit-1', title: 'Monthly Revenue', modifiedTime: new Date().toISOString() },
    { spreadsheetId: 'sheet-audit-2', title: 'Rep Scorecard Plan', modifiedTime: new Date(Date.now() - 86400000).toISOString() },
    { spreadsheetId: 'sheet-audit-3', title: 'Pipeline Archive', modifiedTime: new Date(Date.now() - 172800000).toISOString() }
  ];
  const select = document.querySelector('#sheetFile');
  select.replaceChildren(...availableSpreadsheets.map((spreadsheet) => new Option(spreadsheet.title, spreadsheet.spreadsheetId)));
  select.value = availableSpreadsheets[0].spreadsheetId;
  document.querySelector('#openSpreadsheetPicker').disabled = false;
  syncSpreadsheetTrigger();
  openSpreadsheetPicker();
  await new Promise((resolve) => setTimeout(resolve, 200));
  const modal = document.querySelector('.drive-picker-modal').getBoundingClientRect();
  const initialFiles = document.querySelectorAll('.drive-file-card').length;
  document.querySelector('#spreadsheetSearch').value = 'scorecard';
  renderSpreadsheetFiles('scorecard');
  const filteredFiles = document.querySelectorAll('.drive-file-card').length;
  const selectedName = document.querySelector('#selectedSpreadsheetName').textContent;
  closeSpreadsheetPicker();
  return { modal: { width: modal.width, height: modal.height }, initialFiles, filteredFiles, selectedName };
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
  setSheetSelection({ row: 1, column: 1 });
  for (let index = 1; index <= 80; index += 1) setSheetSelection({ row: 1, column: 1 }, { row: 1 + (index % 24), column: 1 + (index % 12) }, { selectionIndex: 0, writeInput: false });
  document.querySelector('#rangePickerInput').value = sheetSelectionsA1();
  const dragUpdateMs = performance.now() - dragStart;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  setSheetSelection({ row: 2, column: 1 });
  setSheetSelection({ row: 2, column: 3 }, undefined, { additive: true });
  setSheetSelection({ row: 2, column: 6 }, undefined, { additive: true });
  sheetSelectionRoles = ['header', 'metric', 'metric'];
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const modal = document.querySelector('.range-picker-modal').getBoundingClientRect();
  const button = document.querySelector('#selectRangeButton').getBoundingClientRect();
  return { renderMs, dragUpdateMs, batchedSelectionsMs: performance.now() - dragStart, cells: document.querySelectorAll('#sheetGrid [data-sheet-cell]').length, selectedCells: document.querySelectorAll('#sheetGrid [data-sheet-cell].is-selected').length, ranges: document.querySelector('#rangePickerInput').value, chips: document.querySelectorAll('#rangeSelectionChips > span').length, roleSelects: document.querySelectorAll('#rangeSelectionChips select').length, modal: { width: modal.width, height: modal.height }, button: { width: button.width, height: button.height } };
})()`);

await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
const laptopPicker = await evaluate(`(() => {
  const add = document.querySelector('#addRangeSelection').getBoundingClientRect();
  const grid = document.querySelector('#sheetGrid').getBoundingClientRect();
  const footer = document.querySelector('.range-picker-modal > footer').getBoundingClientRect();
  return { add: { top: add.top, bottom: add.bottom, width: add.width, height: add.height }, grid: { top: grid.top, bottom: grid.bottom, height: grid.height }, footer: { top: footer.top }, viewport: { width: innerWidth, height: innerHeight } };
})()`);
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

const visualizations = await evaluate(`(async () => {
  const base = { value: 42, comparisonValue: 40, comparisonDelta: 2, goalValue: 100, status: 'active', displayFormat: 'number', aggregation: 'single_value', spreadsheetId: 'sheet-audit-1', spreadsheetTitle: 'Monthly Revenue', sheetId: 1, sheetTitle: 'Audit', range: 'A1:B4', rangeRoles: [], includeHeaders: false, sourceRange: "'Audit'!A1:B4", fetchedAt: new Date().toISOString() };
  const paired = { kind: 'paired', orientation: 'columns', headers: { label: 'Rep', value: 'Sales' }, items: [{ label: 'Ava', value: 90 }, { label: 'Ben', value: 70 }] };
  liveKpis = [
    ['scorecard', { kind: 'scorecard', layout: 'rep_metric_goal', rep: { label: 'Rep', value: 'Ava' }, metric: { label: 'Monthly Revenue', value: 90 }, goal: { label: 'Goal', value: 100 } }], ['goal_pace', { kind: 'scalar', headers: { value: 'Revenue' } }], ['gauge', { kind: 'scalar', headers: { value: 'Revenue' } }],
    ['rep_cards', paired], ['leaderboard', paired], ['trend', paired], ['category_bar', paired], ['funnel', paired], ['pipeline', paired],
    ['activity_feed', { kind: 'activity_feed', columns: ['Timestamp','Event','Detail'], entries: [{ timestamp: 'Today', label: 'Closed won', detail: 'Ava', value: '90' }] }],
    ['heatmap', { kind: 'heatmap', cornerLabel: 'Rep / Day', xLabels: ['Mon','Tue'], yLabels: ['Ava','Ben'], cells: [[10,20],[30,40]], min: 10, max: 40 }],
    ['table', { kind: 'table', columns: ['Rep','Sales'], rows: [['Ava','90'],['Ben','70']] }]
  ].map(([displayType, displayPayload], index) => ({ ...base, id: 'audit-' + displayType, name: 'Audit ' + displayType, displayType, displayPayload, value: displayType === 'scorecard' ? 42 : base.value }));
  liveDashboardLayout = { kpiOrder: liveKpis.map((item) => item.id), hiddenSections: [] };
  renderLiveKpis();
  activeDisplayType = 'scorecard';
  renderStructuredPreview(liveKpis[0].displayPayload);
  loadedSpreadsheet = { input: 'sheet-audit-1', title: 'Monthly Revenue', sheets: [{ sheetId: 1, title: 'Audit' }] };
  document.querySelector('#sheetFile').value = 'sheet-audit-1';
  document.querySelector('#sheetTab').replaceChildren(new Option('Audit', '1'));
  document.querySelector('#comparisonSheet').replaceChildren(new Option('Audit', '1'));
  editingKpiId = liveKpis[0].id;
  await hydrateKpiBuilder(liveKpis[0]);
  showBuilderStep(3);
  return {
    cards: document.querySelectorAll('[data-live-kpi]').length,
    editButtons: document.querySelectorAll('[data-edit-live-kpi]').length,
    leaderboardHeaders: [...document.querySelectorAll('.leaderboard-head > *')].map((node) => node.textContent.trim()),
    heatmapCorner: document.querySelector('.heatmap-visual header span')?.textContent.trim(),
    scalarStructured: document.querySelector('[data-live-kpi="audit-scorecard"]')?.classList.contains('kpi-card-structured'),
    compositeText: document.querySelector('[data-live-kpi="audit-scorecard"]')?.textContent.replace(/\s+/g, ' ').trim(),
    sheetsGoalDisabled: document.querySelector('#kpiGoal').disabled,
    sheetsGoalHelp: document.querySelector('#kpiGoalHelp').textContent,
    comparisonHidden: document.querySelector('#comparisonModeField').hidden,
    tableHeaders: [...document.querySelectorAll('[data-live-kpi="audit-table"] th')].map((node) => node.textContent.trim()),
    editName: document.querySelector('#kpiName').value,
    editRange: document.querySelector('#sheetRange').value,
    editAction: document.querySelector('#builderNext').textContent
  };
})()`);

await evaluate('showBuilderStep(2)');

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
const mobile = await evaluate(`(() => {
  const modal = document.querySelector('.range-picker-modal').getBoundingClientRect();
  const button = document.querySelector('#selectRangeButton').getBoundingClientRect();
  openSpreadsheetPicker();
  const driveModal = document.querySelector('.drive-picker-modal').getBoundingClientRect();
  closeSpreadsheetPicker();
  return { modal: { width: modal.width, height: modal.height }, driveModal: { width: driveModal.width, height: driveModal.height }, button: { width: button.width, height: button.height }, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
})()`);

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Network.setCacheDisabled', { cacheDisabled: false });
await navigate(`${baseUrl}/app`);
const warmLoad = await evaluate(`(() => {
  const resources = performance.getEntriesByType('resource').map((entry) => ({ name: new URL(entry.name).pathname, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, duration: entry.duration }));
  return { assetBytes: resources.filter((entry) => ['/app.js','/styles.css'].includes(entry.name)).reduce((total, entry) => total + entry.transferSize, 0), assetBodyBytes: resources.filter((entry) => ['/app.js','/styles.css'].includes(entry.name)).reduce((total, entry) => total + entry.encodedBodySize, 0), resources };
})()`);

console.log(JSON.stringify({ firstLoad, warmLoad, drivePicker, picker, laptopPicker, visualizations, mobile }, null, 2));
assert.deepEqual(firstLoad.apiRequests, ['/api/axoboard/bootstrap'], 'app startup uses one product bootstrap request');
assert.ok(firstLoad.domInteractive < 1000, 'local app shell becomes interactive in under one second');
assert.ok(firstLoad.assetBodyBytes < 90_000, 'compressed core JS and CSS remain under 90 KB');
assert.equal(warmLoad.assetBodyBytes, 0, 'warm reload revalidates without retransferring core JS or CSS bodies');
assert.equal(drivePicker.initialFiles, 3, 'Drive-style chooser renders every recent spreadsheet');
assert.equal(drivePicker.filteredFiles, 1, 'Drive-style chooser filters files by name');
assert.equal(drivePicker.selectedName, 'Monthly Revenue', 'selected spreadsheet is summarized in the builder');
assert.ok(drivePicker.modal.width >= 1100 && drivePicker.modal.height >= 780, 'Drive-style chooser provides a large file-browsing workspace');
assert.equal(picker.cells, 288, 'picker renders only the bounded 24×12 window');
assert.ok(picker.renderMs < 100, 'bounded picker grid renders in under 100 ms');
assert.ok(picker.dragUpdateMs < 20, '80 drag updates complete synchronously in under 20 ms');
assert.ok(picker.batchedSelectionsMs < 250, 'batched drag selection paints within the headless-browser frame budget');
assert.equal(picker.ranges, 'A2,C2,F2', 'picker preserves ordered non-adjacent selections');
assert.equal(picker.chips, 3, 'picker exposes each selected range as a removable chip');
assert.equal(picker.roleSelects, 3, 'every selected range can be assigned as Headers or Metrics');
assert.equal(picker.selectedCells, 3, 'non-adjacent selected cells remain visibly selected');
assert.ok(picker.modal.width >= 1400, 'desktop picker uses the near-full-screen workspace');
assert.ok(picker.button.height >= 55, 'Choose Cells action is a prominent touch target');
assert.ok(laptopPicker.add.width >= 100 && laptopPicker.add.height >= 42, 'Add range control remains visible at 100% laptop scaling');
assert.ok(laptopPicker.add.top >= 0 && laptopPicker.add.bottom <= laptopPicker.viewport.height, 'Add range control stays inside the laptop viewport');
assert.ok(laptopPicker.grid.height >= 160 && laptopPicker.grid.bottom <= laptopPicker.footer.top, 'sheet canvas yields space to persistent controls without overlapping the footer');
assert.equal(visualizations.cards, 12, 'all card types render from their saved payload');
assert.equal(visualizations.editButtons, 12, 'every saved KPI exposes an edit action');
assert.deepEqual(visualizations.leaderboardHeaders, ['#', 'Rep', 'Sales'], 'leaderboard preserves source headers');
assert.equal(visualizations.heatmapCorner, 'Rep / Day', 'heatmap preserves its corner header');
assert.equal(visualizations.scalarStructured, false, 'scalar header metadata does not change scorecard rendering');
assert.match(visualizations.compositeText, /Ava.*Monthly Revenue.*90.*Goal.*100.*90\.0% of goal/, 'scorecard renders rep, metric, goal, and progress together');
assert.equal(visualizations.sheetsGoalDisabled, true, 'a Sheets-provided scorecard goal disables the redundant manual goal field');
assert.match(visualizations.sheetsGoalHelp, /Goal cell selected in Google Sheets/, 'scorecard explains where its live goal comes from');
assert.equal(visualizations.comparisonHidden, true, 'a composite scorecard hides redundant comparison controls');
assert.deepEqual(visualizations.tableHeaders, ['Rep', 'Sales'], 'table preserves source headers');
assert.equal(visualizations.editName, 'Audit scorecard', 'editing hydrates the saved KPI name');
assert.equal(visualizations.editRange, 'A1:B4', 'editing hydrates the saved Sheets range');
assert.equal(visualizations.editAction, 'Save KPI changes', 'editing uses an explicit update action');
assert.ok(mobile.modal.width <= mobile.viewportWidth && mobile.modal.height <= 844, 'mobile picker stays within the viewport');
assert.ok(mobile.driveModal.width <= mobile.viewportWidth && mobile.driveModal.height <= 844, 'mobile Drive chooser stays within the viewport');
assert.ok(mobile.button.height >= 55, 'mobile Choose Cells action remains a prominent touch target');
assert.equal(mobile.documentWidth, mobile.viewportWidth, 'mobile app has no page-level horizontal overflow');

socket.close();
