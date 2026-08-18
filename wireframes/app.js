const navButtons = [...document.querySelectorAll('[data-screen]')];
const screens = [...document.querySelectorAll('[data-screen-panel]')];
const toast = document.querySelector('#toast');
const overlay = document.querySelector('#celebrationOverlay');
let toastTimer;
const betaStateKey = 'axoboard.beta.service.v2';
const dashboardKpiKeys = ['net-sales', 'pipeline', 'deals-won', 'team-track'];
const defaultDashboardLayout = { preset: 'balanced', showTrend: true, showActionCenter: true, kpiOrder: [...dashboardKpiKeys] };
const defaultBetaState = { activeWorkspace: 'sample-empty', workspaceName: 'New workspace', brandColor: '#E96F98', celebrationLanguage: 'Big win!', teamOne: 'Team One', teamTwo: 'Team Two', sampleDemoData: false, completedWorkflows: [], draftCount: 0, dashboardLayout: defaultDashboardLayout, lastSavedAt: null };
let betaState = { ...defaultBetaState };
let oauthAttempt = 0;
let activeOauthProvider = null;
let layoutEditSnapshot = null;
let layoutDraft = null;
const dedicatedTvRuntime = location.pathname === '/tv';

function currentDashboardCardKeys() {
  const cards = [...document.querySelectorAll('#dashboardKpiGrid .kpi-card')];
  const keys = cards.map((card) => card.dataset.cardKey || card.dataset.liveKpi || card.dataset.drilldown).filter(Boolean);
  return keys.length ? keys : [...dashboardKpiKeys];
}

function normalizeDashboardLayout(layout = {}, validKeys = currentDashboardCardKeys()) {
  const suppliedOrder = Array.isArray(layout.kpiOrder) ? layout.kpiOrder : [];
  const validKeySet = new Set(validKeys);
  const kpiOrder = [...new Set([...suppliedOrder.filter((key) => validKeySet.has(key)), ...validKeys])];
  return {
    preset: ['balanced', 'kpi-focus', 'compact'].includes(layout.preset) ? layout.preset : defaultDashboardLayout.preset,
    showTrend: layout.showTrend !== false,
    showActionCenter: layout.showActionCenter !== false,
    kpiOrder
  };
}

function cloneDashboardLayout(layout) {
  const normalized = normalizeDashboardLayout(layout);
  return { ...normalized, kpiOrder: [...normalized.kpiOrder] };
}

try {
  betaState = { ...defaultBetaState, ...JSON.parse(localStorage.getItem(betaStateKey) || '{}') };
} catch {
  betaState = { ...defaultBetaState };
}
betaState.dashboardLayout = normalizeDashboardLayout(betaState.dashboardLayout);

function persistBetaState(patch = {}) {
  betaState = { ...betaState, ...patch, lastSavedAt: new Date().toISOString() };
  try { localStorage.setItem(betaStateKey, JSON.stringify(betaState)); } catch { /* private-mode fallback */ }
}

const workspaceProfiles = {
  'sample-empty': { name: 'New workspace', avatar: 'N', game: 'Blank competition', teamOne: 'Team One', teamTwo: 'Team Two' },
  acme: { name: 'Acme Sales', avatar: 'A', game: 'Team Challenge', teamOne: 'Bluefin', teamTwo: 'Coral Crew' }
};

function insertWorkspaceSandboxStates() {
  const states = {
    dashboard: '<span class="empty-axo">•ᴗ•</span><small>BLANK CUSTOMER WORKSPACE</small><h2>No KPIs yet</h2><p>Choose a responsive layout above, connect a source through a fresh OAuth consent flow, or load clearly labeled synthetic KPIs to test the product safely.</p><div><button class="button button-primary" type="button" data-screen="integrations">Connect a source</button><button class="button button-soft" type="button" data-load-demo>Load synthetic demo KPIs</button></div>',
    integrations: '<span class="empty-axo">⌁</span><small>0 CONNECTIONS · FRESH OAUTH ONLY</small><h2>Connect your first source</h2><p>No accounts, tokens, service accounts, portals, or credentials are included in this sample workspace. Every connection begins with a new provider consent request.</p><div class="blank-connector-grid"><article><span class="integration-logo google">G</span><strong>Google Sheets</strong><small>Choose a spreadsheet, sheet, cell, or range after authorization.</small><button class="button button-primary" type="button" data-fresh-oauth="google">Start fresh Google OAuth</button></article><article><span class="integration-logo hubspot">H</span><strong>HubSpot</strong><small>Pick CRM objects and specific standard or custom properties.</small><button class="button button-primary" type="button" data-fresh-oauth="hubspot">Start fresh HubSpot OAuth</button></article></div><aside class="credential-boundary"><b>Credential boundary</b><span>Credentials must be newly authorized and tenant-scoped. Live redirects remain disabled until AxoBoard-owned OAuth apps and callbacks are configured.</span></aside>',
    displays: '<span class="empty-axo">▣</span><small>BLANK CUSTOMER WORKSPACE</small><h2>No screens paired</h2><p>Pair a test display after a dashboard exists. Device tokens will be scoped to this workspace.</p><div><button class="button button-primary" type="button" data-empty-workflow="screen">Pair first screen</button></div>',
    automations: '<span class="empty-axo">ϟ</span><small>BLANK CUSTOMER WORKSPACE</small><h2>No automation rules</h2><p>Create a rule only after a trusted or synthetic KPI exists. Dry runs stay separated from production events.</p><div><button class="button button-primary" type="button" data-empty-workflow="automation">Create first rule</button></div>',
    workspace: '<span class="empty-axo">N</span><small>NEW WORKSPACE · SAFE SAMPLE</small><h2>Clean onboarding state</h2><p>0 members · 0 connections · 0 dashboards · 0 displays. This sample intentionally starts empty for repeatable signup testing.</p><div><button class="button button-primary" type="button" data-screen="integrations">Begin with an integration</button><button class="button button-ghost" type="button" data-reset-sample>Reset to blank</button></div>',
    celebrations: '<span class="empty-axo">✦</span><small>BLANK CUSTOMER WORKSPACE</small><h2>No wins recorded</h2><p>Celebrations appear only after a test event or connected KPI rule produces one.</p><div><button class="button button-primary" type="button" data-empty-workflow="celebration">Configure a test celebration</button></div>',
    sounds: '<span class="empty-axo">♫</span><small>BLANK CUSTOMER WORKSPACE</small><h2>No custom sounds</h2><p>Upload tenant-owned audio and assign it after validation. AxoBoard samples are not copied into this customer workspace.</p><div><button class="button button-primary" type="button" data-empty-workflow="sound">Upload first sound</button></div>'
  };
  Object.entries(states).forEach(([route, html]) => {
    const panel = document.querySelector(`[data-screen-panel="${route}"]`);
    if (!panel || panel.querySelector('.workspace-empty-state')) return;
    panel.querySelector('.page-header').insertAdjacentHTML('afterend', `<section class="surface workspace-empty-state" data-empty-route="${route}">${html}</section>`);
  });
  ['competitions', 'brand'].forEach((route) => {
    const panel = document.querySelector(`[data-screen-panel="${route}"]`);
    panel.querySelector('.page-header').insertAdjacentHTML('afterend', '<aside class="surface blank-tenant-note"><b>Safe sample workspace</b><span>This starts as an unpublished, tenant-local draft with no inherited assets or settings.</span><button type="button" data-reset-sample>Reset workspace</button></aside>');
  });
  document.querySelector('[data-screen-panel="dashboard"] .page-header').insertAdjacentHTML('afterend', '<aside class="surface synthetic-data-banner"><b>SYNTHETIC TEST DATA</b><span>These KPI values are fixtures for visibility testing—not live customer, Google, or HubSpot data.</span><button type="button" data-reset-sample>Remove demo data</button></aside>');
}

function applyWorkspaceMode() {
  const id = workspaceProfiles[betaState.activeWorkspace] ? betaState.activeWorkspace : 'sample-empty';
  const profile = workspaceProfiles[id];
  const isSample = id === 'sample-empty';
  document.body.dataset.activeWorkspace = id;
  document.body.dataset.demoData = isSample && betaState.sampleDemoData ? 'true' : 'false';
  document.querySelectorAll('.workspace-switcher .workspace-avatar, .mobile-workspace-switch .workspace-avatar').forEach((avatar) => { avatar.textContent = profile.avatar; });
  document.querySelector('.workspace-switcher strong').textContent = profile.name;
  document.querySelector('.mobile-workspace-switch')?.setAttribute('aria-label', `Switch workspace. Current workspace: ${profile.name}`);
  workspaceName.value = profile.name;
  document.querySelector('#serviceWorkspaceName').textContent = profile.name;
  document.querySelector('#gameNameInput').value = profile.game;
  teamOneInput.value = isSample ? 'Team One' : betaState.teamOne || profile.teamOne;
  teamTwoInput.value = isSample ? 'Team Two' : betaState.teamTwo || profile.teamTwo;
  document.querySelector('#dashboardTitle').textContent = isSample ? 'Your first dashboard' : 'Sales command pond';
  syncGamePreview();
  syncBrandPreview();
}

function resetSampleWorkspace() {
  oauthAttempt = 0;
  activeOauthProvider = null;
  persistBetaState({ activeWorkspace: 'sample-empty', workspaceName: 'New workspace', sampleDemoData: false, teamOne: 'Team One', teamTwo: 'Team Two' });
  applyWorkspaceMode();
  showToast('Sample workspace reset', '0 KPIs, connections, members, screens, rules, sounds, and stored OAuth test sessions.');
}

function showToast(title, detail) {
  toast.querySelector('strong').textContent = title;
  toast.querySelector('small').textContent = detail;
  toast.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function showScreen(name) {
  name = name === 'kombat' ? 'competitions' : name;
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screenPanel === name));
  navButtons.forEach((button) => {
    const active = button.dataset.screen === name;
    button.classList.toggle('is-active', active);
    if (button.classList.contains('nav-item')) {
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  });
  const activeNav = navButtons.find((button) => button.dataset.screen === name && button.classList.contains('nav-item'));
  if (activeNav && window.matchMedia('(max-width: 700px)').matches) activeNav.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  history.replaceState(null, '', `#${name}`);
  const title = screens.find((screen) => screen.dataset.screenPanel === name)?.querySelector('h1')?.textContent.trim() || 'AxoBoard';
  document.title = `AxoBoard — ${title}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navButtons.forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.screen)));

const dashboardPanel = document.querySelector('[data-screen-panel="dashboard"]');
const dashboardKpiGrid = document.querySelector('#dashboardKpiGrid');
const dashboardTrendPanel = document.querySelector('#dashboardTrendPanel');
const dashboardActionCenter = document.querySelector('#dashboardActionCenter');
const dashboardLowerGrid = document.querySelector('#dashboardLowerGrid');

function kpiLabel(key) {
  const card = [...dashboardKpiGrid.querySelectorAll('.kpi-card')].find((item) => (item.dataset.cardKey || item.dataset.liveKpi || item.dataset.drilldown) === key);
  return card?.querySelector(':scope > p, .structured-kpi-title > strong')?.textContent.trim() || key;
}

function applyDashboardLayout(layout = betaState.dashboardLayout) {
  [...dashboardKpiGrid.querySelectorAll('.kpi-card')].forEach((card) => { card.dataset.cardKey ||= card.dataset.liveKpi || card.dataset.drilldown; });
  const normalized = normalizeDashboardLayout(layout);
  dashboardPanel.dataset.layoutPreset = normalized.preset;
  normalized.kpiOrder.forEach((key) => {
    const card = [...dashboardKpiGrid.querySelectorAll('.kpi-card')].find((item) => item.dataset.cardKey === key);
    if (card) dashboardKpiGrid.append(card);
  });
  const liveDataUnavailable = Boolean(liveWorkspaceId);
  dashboardTrendPanel.hidden = liveDataUnavailable || !normalized.showTrend;
  dashboardActionCenter.hidden = liveDataUnavailable || !normalized.showActionCenter;
  const visiblePanels = liveDataUnavailable ? 0 : Number(normalized.showTrend) + Number(normalized.showActionCenter);
  dashboardLowerGrid.hidden = visiblePanels === 0;
  dashboardLowerGrid.dataset.visiblePanels = visiblePanels === 1 ? 'one' : 'two';
  const presetName = { balanced: 'Balanced', 'kpi-focus': 'KPI focus', compact: 'Compact' }[normalized.preset];
  document.querySelector('#editLayoutButton').setAttribute('aria-label', `Change layout. Current preset: ${presetName}`);
}

function renderLayoutOrder(focusKey = '', focusDirection = '') {
  const list = document.querySelector('#layoutKpiOrder');
  if (!list || !layoutDraft) return;
  list.replaceChildren(...layoutDraft.kpiOrder.map((key, index) => {
    const item = document.createElement('li');
    item.dataset.layoutKpi = key;
    item.draggable = true;
    item.innerHTML = `<button class="layout-drag-handle" type="button" aria-label="Drag ${escapeHtml(kpiLabel(key))} to reorder" title="Drag to reorder">⠿</button><span class="layout-order-position" aria-hidden="true">${index + 1}</span><div><strong>${escapeHtml(kpiLabel(key))}</strong><small>Dashboard KPI ${index + 1}</small></div><div class="layout-order-actions"><button type="button" data-layout-move="up" data-interaction-status="working" aria-label="Move ${escapeHtml(kpiLabel(key))} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-layout-move="down" data-interaction-status="working" aria-label="Move ${escapeHtml(kpiLabel(key))} down" ${index === layoutDraft.kpiOrder.length - 1 ? 'disabled' : ''}>↓</button>${liveWorkspaceId ? `<button class="layout-delete" type="button" data-layout-delete="${escapeHtml(key)}" data-interaction-status="working" aria-label="Delete ${escapeHtml(kpiLabel(key))}">Delete</button>` : ''}</div>`;
    return item;
  }));
  if (focusKey && focusDirection) list.querySelector(`[data-layout-kpi="${focusKey}"] [data-layout-move="${focusDirection}"]`)?.focus();
}

function syncLayoutWorkflowPreview() {
  if (!layoutDraft) return;
  const preview = document.querySelector('[data-layout-preview]');
  if (!preview) return;
  preview.dataset.previewPreset = layoutDraft.preset;
  preview.querySelector('[data-layout-preview-kpis]').replaceChildren(...layoutDraft.kpiOrder.map((key) => {
    const item = document.createElement('span');
    item.textContent = kpiLabel(key);
    return item;
  }));
  const trend = preview.querySelector('[data-layout-preview-trend]');
  const actions = preview.querySelector('[data-layout-preview-actions]');
  trend.hidden = !layoutDraft.showTrend;
  actions.hidden = !layoutDraft.showActionCenter;
  preview.querySelector('[data-layout-preview-empty]').hidden = layoutDraft.showTrend || layoutDraft.showActionCenter;
}

function previewLayoutDraft() {
  if (!layoutDraft) return;
  applyDashboardLayout(layoutDraft);
  syncLayoutWorkflowPreview();
  document.querySelector('#workflowStatus').textContent = 'Previewing locally · save to keep after refresh';
}

function wireLayoutWorkflow() {
  if (!layoutDraft) return;
  document.querySelectorAll('[name="layoutPreset"]').forEach((input) => { input.checked = input.value === layoutDraft.preset; });
  document.querySelector('#layoutShowTrend').checked = layoutDraft.showTrend;
  document.querySelector('#layoutShowActionCenter').checked = layoutDraft.showActionCenter;
  renderLayoutOrder();
  syncLayoutWorkflowPreview();
  document.querySelector('#workflowCanvas').onchange = (event) => {
    if (event.target.matches('[name="layoutPreset"]')) layoutDraft.preset = event.target.value;
    if (event.target.id === 'layoutShowTrend') layoutDraft.showTrend = event.target.checked;
    if (event.target.id === 'layoutShowActionCenter') layoutDraft.showActionCenter = event.target.checked;
    previewLayoutDraft();
  };
  document.querySelector('#layoutKpiOrder').addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-layout-delete]');
    if (deleteButton) {
      deleteLiveKpi(deleteButton.dataset.layoutDelete, deleteButton);
      return;
    }
    const button = event.target.closest('[data-layout-move]');
    if (!button || button.disabled) return;
    const item = button.closest('[data-layout-kpi]');
    const key = item.dataset.layoutKpi;
    const currentIndex = layoutDraft.kpiOrder.indexOf(key);
    const nextIndex = currentIndex + (button.dataset.layoutMove === 'up' ? -1 : 1);
    if (nextIndex < 0 || nextIndex >= layoutDraft.kpiOrder.length) return;
    [layoutDraft.kpiOrder[currentIndex], layoutDraft.kpiOrder[nextIndex]] = [layoutDraft.kpiOrder[nextIndex], layoutDraft.kpiOrder[currentIndex]];
    renderLayoutOrder(key, button.dataset.layoutMove);
    previewLayoutDraft();
  });
  const orderList = document.querySelector('#layoutKpiOrder');
  let draggedKey = '';
  orderList.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-layout-kpi]');
    if (!item) return;
    draggedKey = item.dataset.layoutKpi;
    item.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
  });
  orderList.addEventListener('dragover', (event) => {
    if (!draggedKey) return;
    event.preventDefault();
    const target = event.target.closest('[data-layout-kpi]');
    if (!target || target.dataset.layoutKpi === draggedKey) return;
    const fromIndex = layoutDraft.kpiOrder.indexOf(draggedKey);
    const toIndex = layoutDraft.kpiOrder.indexOf(target.dataset.layoutKpi);
    layoutDraft.kpiOrder.splice(toIndex, 0, layoutDraft.kpiOrder.splice(fromIndex, 1)[0]);
    renderLayoutOrder();
    previewLayoutDraft();
  });
  orderList.addEventListener('dragend', () => {
    draggedKey = '';
    orderList.querySelector('.is-dragging')?.classList.remove('is-dragging');
  });
}

const celebrationViewButtons = [...document.querySelectorAll('[data-celebration-view]')];
const celebrationViewPanels = [...document.querySelectorAll('[data-celebration-panel]')];

celebrationViewButtons.forEach((button) => button.addEventListener('click', () => {
  celebrationViewButtons.forEach((item) => item.classList.toggle('is-active', item === button));
  celebrationViewPanels.forEach((panel) => { panel.hidden = panel.dataset.celebrationPanel !== button.dataset.celebrationView; });
}));

document.querySelector('#exportEventLedger').addEventListener('click', () => showToast('Audit export prepared', 'The wireframe includes source IDs, decisions, destinations, brand versions, and delivery attempts.'));
document.querySelectorAll('[data-ledger-replay]').forEach((button) => button.addEventListener('click', openCelebration));
document.querySelectorAll('[data-ledger-inspect]').forEach((button) => button.addEventListener('click', () => showToast('Source event inspected', 'The duplicate references evt_8F3A and created no new score or delivery.')));
document.querySelectorAll('[data-ledger-release]').forEach((button) => button.addEventListener('click', () => showToast('Held delivery previewed', 'Production would create a new destination attempt while preserving the immutable source event.')));
document.querySelector('#openEventContract').addEventListener('click', (event) => openWorkflow('runs', event.currentTarget, 'Celebration event contract'));
document.querySelector('#testDeliveryPolicy').addEventListener('click', () => showToast('Delivery policy passed', 'TV visual, silent captions, quiet hours, and destination retry behavior are compatible.'));

const styleButtons = [...document.querySelectorAll('[data-celebration-style]')];
const activeStyle = document.querySelector('#activeStyle');
const activeSound = document.querySelector('#activeSound');
const activeHype = document.querySelector('#activeHype');
const celebrationSound = document.querySelector('#celebrationSound');
const hypeRange = document.querySelector('#hypeRange');
const hypeOutput = document.querySelector('#hypeOutput');
const hypeLabels = ['Low', 'Medium', 'High', 'MAX'];

function syncCelebrationPreview() {
  const selectedStyle = styleButtons.find((button) => button.classList.contains('is-active'))?.dataset.celebrationStyle || 'Confetti';
  const hype = hypeLabels[Number(hypeRange.value) - 1];
  activeStyle.textContent = selectedStyle;
  activeSound.textContent = celebrationSound.value;
  activeHype.textContent = `${hype} hype`;
  hypeOutput.textContent = hype;
  overlay.dataset.style = selectedStyle;
}

function openCelebration() {
  syncCelebrationPreview();
  overlay.inert = false;
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('is-visible');
  document.querySelector('#closeWin').focus();
}

function closeCelebration() {
  overlay.classList.remove('is-visible');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  document.querySelector('#previewCelebration').focus();
}

styleButtons.forEach((button) => button.addEventListener('click', () => {
  styleButtons.forEach((item) => item.classList.toggle('is-active', item === button));
  syncCelebrationPreview();
  showToast(`${button.dataset.celebrationStyle} selected`, 'The preview updated instantly.');
}));

hypeRange.addEventListener('input', syncCelebrationPreview);
celebrationSound.addEventListener('change', syncCelebrationPreview);
document.querySelector('#celebrateButton').addEventListener('click', openCelebration);
document.querySelector('#previewCelebration').addEventListener('click', openCelebration);
document.querySelectorAll('.replay-mini').forEach((button) => button.addEventListener('click', openCelebration));
document.querySelector('#replayWin').addEventListener('click', () => {
  overlay.classList.remove('is-visible');
  window.setTimeout(() => overlay.classList.add('is-visible'), 80);
});
document.querySelector('#closeWin').addEventListener('click', closeCelebration);
overlay.addEventListener('click', (event) => { if (event.target === overlay) closeCelebration(); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay.classList.contains('is-visible')) closeCelebration(); });

const soundRows = [...document.querySelectorAll('.sound-row')];
const soundName = document.querySelector('#soundName');
const soundDuration = document.querySelector('#soundDuration');
const soundDurationSecondary = document.querySelector('#soundDurationSecondary');
const soundPreviewButton = document.querySelector('#soundPreviewButton');
const wavePlay = document.querySelector('#wavePlay');
let soundTimer;

function selectSound(row) {
  soundRows.forEach((item) => item.classList.toggle('is-selected', item === row));
  soundName.textContent = row.dataset.sound;
  soundDuration.textContent = row.dataset.duration;
  soundDurationSecondary.textContent = row.dataset.duration;
  showToast(`${row.dataset.sound} selected`, `${row.dataset.tags} · ${row.dataset.duration}`);
}

function previewSound(button) {
  window.clearTimeout(soundTimer);
  if (button === wavePlay) button.textContent = '■';
  else button.childNodes[0].nodeValue = '■ Playing ';
  showToast(`Playing ${soundName.textContent}`, 'Prototype preview—audio playback is simulated.');
  soundTimer = window.setTimeout(() => {
    if (button === wavePlay) button.textContent = '▶';
    else button.childNodes[0].nodeValue = '▶ Preview ';
  }, 1500);
}

soundRows.forEach((row) => row.addEventListener('click', () => selectSound(row)));
soundPreviewButton.addEventListener('click', () => previewSound(soundPreviewButton));
wavePlay.addEventListener('click', () => previewSound(wavePlay));
document.querySelector('#volumeRange').addEventListener('input', (event) => { document.querySelector('#volumeOutput').textContent = `${event.target.value}%`; });
document.querySelector('#saveSound').addEventListener('click', () => showToast('Sound saved', `${soundName.textContent} is ready for your team.`));
document.querySelector('#uploadZone').addEventListener('click', () => showToast('Upload ready', 'Choose an MP3, WAV, or M4A file up to 25MB.'));
document.querySelector('#uploadSoundButton').addEventListener('click', () => document.querySelector('#uploadZone').click());

const teamOneInput = document.querySelector('#teamOneInput');
const teamTwoInput = document.querySelector('#teamTwoInput');
const teamOneColor = document.querySelector('#teamOneColor');
const teamTwoColor = document.querySelector('#teamTwoColor');
const winCondition = document.querySelector('#winCondition');
const arena = document.querySelector('#arenaPreview');
const scoreIncrement = document.querySelector('#scoreIncrement');
const scorePoints = document.querySelector('#pointsInput');

function syncScoreTestFormula() {
  const increment = Math.max(1, Number(scoreIncrement.value) || 1);
  const points = Math.max(1, Number(scorePoints.value) || 1);
  const awarded = Math.floor(1500 / increment) * points;
  document.querySelector('#scoreTestFormula').innerHTML = `$1,500 ÷ $${increment.toLocaleString()} × ${points} = <b>${awarded} points</b>`;
  return awarded;
}

function syncGamePreview() {
  const teamOne = teamOneInput.value.trim() || 'Team One';
  const teamTwo = teamTwoInput.value.trim() || 'Team Two';
  const target = winCondition.value === 'time' ? 'TIME' : winCondition.value;
  document.querySelector('#teamOnePreview').textContent = teamOne;
  document.querySelector('#teamTwoPreview').textContent = teamTwo;
  document.querySelector('#winnerTeam').textContent = teamTwo;
  document.querySelector('#fighterOneLabel').textContent = `Team ${teamOne}`;
  document.querySelector('#fighterTwoLabel').textContent = `Team ${teamTwo}`;
  document.querySelector('#renameChipOne').textContent = teamOne;
  document.querySelector('#renameChipTwo').textContent = teamTwo;
  document.querySelector('#winTargetPreview').textContent = target;
  document.querySelector('#targetChip').textContent = target;
  arena.style.setProperty('--team-one', teamOneColor.value);
  arena.style.setProperty('--team-two', teamTwoColor.value);
}

[teamOneInput, teamTwoInput, teamOneColor, teamTwoColor, winCondition].forEach((input) => input.addEventListener('input', () => {
  syncGamePreview();
  persistBetaState({ teamOne: teamOneInput.value, teamTwo: teamTwoInput.value });
}));
[scoreIncrement, scorePoints].forEach((input) => input.addEventListener('input', syncScoreTestFormula));
document.querySelector('#testScoreEvent').addEventListener('click', () => {
  const awarded = syncScoreTestFormula();
  const nextScore = 72 + awarded;
  document.querySelector('#teamOneScore').textContent = nextScore;
  document.querySelector('#teamOneBar').style.width = `${Math.min(100, nextScore)}%`;
  document.querySelector('#winnerTeam').textContent = nextScore >= 100 ? (teamOneInput.value.trim() || 'Team One') : (teamTwoInput.value.trim() || 'Team Two');
  showToast('Test event calculated', `evt_test_001 awards ${awarded} points. No live score was written.`);
});
document.querySelector('#resetScoreTest').addEventListener('click', () => {
  document.querySelector('#teamOneScore').textContent = '72';
  document.querySelector('#teamOneBar').style.width = '72%';
  document.querySelector('#winnerTeam').textContent = teamTwoInput.value.trim() || 'Team Two';
  showToast('Test snapshot reset', 'The draft score returned to its original value.');
});
document.querySelector('#viewCompetitionContract').addEventListener('click', (event) => openWorkflow('game', event.currentTarget, 'Competition calculation contract'));
document.querySelectorAll('.arena-options button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.arena-options button').forEach((item) => item.classList.toggle('is-active', item === button));
  showToast('Arena updated', 'The new environment is shown in the live preview.');
}));
document.querySelector('#previewGame').addEventListener('click', () => {
  arena.animate([{ transform: 'scale(.985)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
  showToast('Competition preview started', 'Scores, winner copy, avatars, colors, and sounds are testable.');
});
document.querySelector('#publishGame').addEventListener('click', () => showToast('Publish flow wireframed', `${document.querySelector('#gameNameInput').value || 'Your competition'} v4 passed the preview. No live competition was changed.`));

const brandColor = document.querySelector('#brandColor');
const workspaceName = document.querySelector('#workspaceName');
const celebrationLanguage = document.querySelector('#celebrationLanguage');
const brandPreview = document.querySelector('#brandPreview');

function syncBrandPreview() {
  const customerName = workspaceName.value || 'Your workspace';
  const customerInitial = customerName.trim().charAt(0).toUpperCase() || 'W';
  const customerSlug = customerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'customer';
  document.querySelectorAll('[data-customer-brand-name]').forEach((element) => { element.textContent = customerName; });
  document.querySelectorAll('[data-customer-logo-name]').forEach((element) => { element.textContent = `${customerSlug}-mark.svg`; });
  document.querySelector('#workspacePreview').textContent = customerName;
  document.querySelector('#languagePreview').textContent = celebrationLanguage.value || 'Big win!';
  brandPreview.style.setProperty('--pink-600', brandColor.value);
  brandPreview.style.setProperty('--pink-500', brandColor.value);
  document.querySelectorAll('.customer-logo, .customer-mark-large, .customer-mark-small').forEach((mark) => { mark.textContent = customerInitial; });
  const runtimeName = document.querySelector('#runtimeBrandPreview strong');
  if (runtimeName) runtimeName.textContent = customerName;
  const runtimeAvatar = document.querySelector('#runtimeBrandPreview .workspace-avatar');
  if (runtimeAvatar) runtimeAvatar.textContent = customerInitial;
  document.querySelector('#runtimeBrandPreview')?.style.setProperty('--customer-primary', brandColor.value);
}

[brandColor, workspaceName, celebrationLanguage].forEach((input) => input.addEventListener('input', () => {
  syncBrandPreview();
  persistBetaState({ workspaceName: workspaceName.value, brandColor: brandColor.value, celebrationLanguage: celebrationLanguage.value });
  document.querySelector('#serviceWorkspaceName').textContent = workspaceName.value || 'Your workspace';
}));
document.querySelector('#publishBrand').addEventListener('click', () => showToast('Brand publish flow wireframed', 'Dashboard, TV, celebration, competition, and offline previews passed. No live brand was changed.'));

const kpiBuilderModal = document.querySelector('#kpiBuilderModal');
const builderSteps = [...document.querySelectorAll('[data-builder-step]')];
const builderStepLabels = [...document.querySelectorAll('[data-builder-step-label]')];
const sourceChoices = [...document.querySelectorAll('[data-kpi-source]')];
const sourceConfigs = [...document.querySelectorAll('[data-source-config]')];
const builderBack = document.querySelector('#builderBack');
const builderNext = document.querySelector('#builderNext');
const kpiName = document.querySelector('#kpiName');
const previewKpiName = document.querySelector('#previewKpiName');
const previewKpiValue = document.querySelector('#previewKpiValue');
const previewSourceMark = document.querySelector('#previewSourceMark');
let activeBuilderStep = 1;
let activeKpiSource = 'google';
let builderReturnFocus = null;
let liveConnections = [];
let liveKpis = [];
let liveDisplays = [];
let liveWorkspaceId = '';
let liveWorkspaceName = '';
let liveDashboardLayout = null;
let liveEngagement = { summary: {}, events: [] };
let liveBrand = null;
let liveAutomationRules = [];
let liveAutomationRuns = [];
let automationPermissions = { canRead: false, canEdit: false, canPublish: false };
let liveCapabilities = {};
let automationsLoaded = false;
let automationRulesError = '';
let automationRunsError = '';
let activeAutomationEditorStep = 1;
let activeAutomationRule = null;
let automationEditorKpi = null;
let pendingPromptKpi = null;
let automationLoadRequest = 0;
let automationRunsRequest = 0;
let bootstrapReady = false;
const structuredAutomationTypes = new Set(['rep_cards', 'leaderboard', 'trend', 'category_bar', 'funnel', 'pipeline', 'activity_feed', 'heatmap', 'table']);
let activeGoogleConnection = null;
let availableSpreadsheets = [];
let spreadsheetPickerSelection = '';
let loadedSpreadsheet = null;
let builderPreview = null;
let builderPreviewRequest = 0;
let editingKpiId = null;
let primaryRangeRoles = [];
let comparisonRangeRoles = [];
let activeDisplayType = 'scorecard';
let sheetGridState = null;
let sheetGridRequest = 0;
let sheetGridScrollTimer = null;
let sheetSelectionFrame = null;
let selectingSheetCells = false;
let sheetSelection = { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } };
let sheetSelections = [sheetSelection];
let sheetSelectionRoles = ['metric'];
let activeSheetSelectionIndex = 0;
let addingSeparateRange = false;
let rangePickerTarget = 'primary';
let rangePickerIntent = 'primary';
let rangePickerReturnFocus = null;
const sheetCellWidth = 110;
const sheetCellHeight = 38;
const sheetRowHeaderWidth = 42;
const sheetColumnHeaderHeight = 38;
const sheetWindowRows = 24;
const sheetWindowColumns = 12;
const googleDriveMetadataScope = 'https://www.googleapis.com/auth/drive.metadata.readonly';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

async function apiJson(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'AxoBoard could not complete that request.');
    error.code = payload.code || '';
    error.details = payload.details || null;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setBootstrapState(state, message = '') {
  const gate = document.querySelector('#bootstrapGate');
  const app = document.querySelector('#appShell');
  const reload = document.querySelector('#reloadApplication');
  if (!gate || !app || !reload) return;
  gate.dataset.state = state;
  gate.setAttribute('role', state === 'failed' ? 'alert' : 'status');
  gate.querySelector('small').textContent = state === 'failed' ? 'WORKSPACE UNAVAILABLE' : 'SECURE WORKSPACE';
  gate.querySelector('h1').textContent = state === 'failed' ? 'AxoBoard could not open this workspace' : 'Loading your workspace';
  document.querySelector('#bootstrapGateMessage').textContent = message || (state === 'failed'
    ? 'Your workspace could not be verified. No sample or cached fixture data has been shown.'
    : 'Verifying your session and tenant-scoped data…');
  reload.hidden = state !== 'failed';
  gate.hidden = state === 'ready';
  app.hidden = state !== 'ready' || dedicatedTvRuntime;
}

function timeAgo(value) {
  if (!value) return 'Never';
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatKpiValue(value, format = 'number') {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  if (format === 'currency') return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(number);
  if (format === 'percentage') return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(number / 100);
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number);
}

const displayTypeHelp = {
  scorecard: 'Use one calculated value, or select Rep, Metric, and Goal cells—even when they are not touching.',
  goal_pace: 'Shows one prepared value against an optional goal, including remaining distance.',
  gauge: 'Shows one prepared value within a zero-to-goal range, or an automatically sized range.',
  rep_cards: 'Select two columns: a label column and one calculated value column. Include the header row.',
  leaderboard: 'Select two columns: a label column and one calculated value column. Include the header row.',
  trend: 'Select labels or dates plus one prepared numeric value series. Keep the source order.',
  category_bar: 'Select category labels plus one prepared numeric value column.',
  funnel: 'Select ordered stage labels plus one prepared numeric value column.',
  pipeline: 'Select ordered stage labels plus one prepared numeric value column.',
  activity_feed: 'Select 2–4 columns: timestamp, event, and optional detail/value. Include headers.',
  heatmap: 'Select a matrix with column headers, row labels, and numeric cells.',
  table: 'Shows the selected rows and columns exactly as they appear in Google Sheets.'
};

const scalarDisplayTypes = new Set(['scorecard', 'goal_pace', 'gauge']);
const pairedDisplayTypes = new Set(['rep_cards', 'leaderboard', 'trend', 'category_bar', 'funnel', 'pipeline']);
const comparisonDisabledDisplayTypes = new Set(['table', 'activity_feed', 'heatmap']);
const headerRequiredDisplayTypes = new Set([...pairedDisplayTypes, 'activity_feed', 'heatmap']);

const periodLabels = { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' };

function syncCompositeScorecardControls(payload = null) {
  const composite = payload?.kind === 'scorecard' && payload?.layout === 'rep_metric_goal';
  const sheetGoal = builderPreview?.goalSource === 'google_sheets' || primaryRangeRoles.some((item) => item.role === 'goal') || composite;
  const goalInput = document.querySelector('#kpiGoal');
  const goalHelp = document.querySelector('#kpiGoalHelp');
  const goalPickerLabel = document.querySelector('#selectGoalRangeLabel');
  goalInput.disabled = sheetGoal;
  goalInput.placeholder = sheetGoal ? 'From Google Sheets' : 'Optional';
  goalPickerLabel.textContent = sheetGoal ? 'Change goal cells' : 'Use Sheets cell/range';
  goalHelp.textContent = sheetGoal
    ? 'This KPI uses the live Goal cell or range selected in Google Sheets.'
    : 'Enter a fixed goal or use a live Google Sheets cell/range.';
  if (!sheetGoal) return;
  goalInput.value = '';
  if (!composite) return;
  document.querySelector('#kpiComparisonMode').value = 'none';
  document.querySelector('#kpiComparisonFields').hidden = true;
  document.querySelector('#comparisonModeField').hidden = true;
}

function renderStructuredPreview(payload = builderPreview?.displayPayload) {
  const preview = document.querySelector('#previewStructured');
  const compositeScorecard = payload?.kind === 'scorecard' && payload?.layout === 'rep_metric_goal';
  syncCompositeScorecardControls(payload);
  if (!compositeScorecard) document.querySelector('#comparisonModeField').hidden = comparisonDisabledDisplayTypes.has(activeDisplayType);
  if (!payload || (scalarDisplayTypes.has(activeDisplayType) && !compositeScorecard)) {
    preview.hidden = true;
    preview.replaceChildren();
    previewKpiValue.hidden = false;
    return;
  }
  if (compositeScorecard) {
    const format = document.querySelector('#kpiFormat').value;
    const progress = payload.goal.value === 0 ? null : clampPercent((payload.metric.value / payload.goal.value) * 100);
    preview.innerHTML = `<div class="structured-preview-head"><span>${escapeHtml(payload.rep.label)}</span><strong>${escapeHtml(payload.rep.value)}</strong></div><div><span>${escapeHtml(payload.metric.label)}</span><strong>${escapeHtml(formatKpiValue(payload.metric.value, format))}</strong></div><div><span>${escapeHtml(payload.goal.label)}</span><strong>${escapeHtml(formatKpiValue(payload.goal.value, format))}</strong></div>${progress === null ? '' : `<div><span>Progress</span><strong>${progress.toFixed(1)}%</strong></div>`}`;
    preview.hidden = false;
    previewKpiValue.hidden = true;
    return;
  }
  const structuredItems = payload.kind === 'leaderboard'
    ? [...(payload.items || [])].sort((a, b) => Number(b.value) - Number(a.value))
    : (payload.items || []);
  const items = payload.kind === 'table'
    ? payload.rows.slice(0, 3).map((row, index) => ({ label: row[0] || `Row ${index + 1}`, value: row.slice(1).filter((value) => value !== '').join(' · ') || '—' }))
    : payload.kind === 'activity_feed'
      ? payload.entries.slice(0, 4).map((entry) => ({ label: `${entry.timestamp} ${entry.label}`.trim(), value: [entry.detail, entry.value].filter((value) => value !== '' && value !== null && value !== undefined).join(' · ') || 'Event' }))
      : payload.kind === 'heatmap'
        ? payload.yLabels.slice(0, 4).map((label, index) => ({ label, value: payload.cells[index].map((value) => formatKpiValue(value, document.querySelector('#kpiFormat').value)).join(' · ') }))
        : structuredItems.slice(0, 5);
  const rows = items.map((item) => {
    const row = document.createElement('div');
    const value = ['table', 'activity_feed', 'heatmap'].includes(payload.kind) ? item.value : formatKpiValue(item.value, document.querySelector('#kpiFormat').value);
    row.innerHTML = `<span>${escapeHtml(item.label)}</span><strong>${escapeHtml(value)}</strong>`;
    return row;
  });
  const headerLabels = payload.kind === 'table'
    ? payload.columns?.slice(0, 2)
    : payload.kind === 'activity_feed'
      ? payload.columns?.slice(0, 2)
      : payload.kind === 'heatmap'
        ? [payload.cornerLabel || 'Row', payload.xLabels?.join(' · ') || 'Values']
        : payload.headers ? [payload.headers.label, payload.headers.value] : null;
  if (headerLabels?.length) {
    const header = document.createElement('div');
    header.className = 'structured-preview-head';
    header.innerHTML = `<span>${escapeHtml(headerLabels[0] || 'Label')}</span><strong>${escapeHtml(headerLabels[1] || 'Value')}</strong>`;
    rows.unshift(header);
  }
  preview.replaceChildren(...rows);
  preview.hidden = false;
  previewKpiValue.hidden = true;
}

function setBuilderPreviewStatus(status, message, lineage = '') {
  previewKpiValue.textContent = '—';
  previewKpiValue.hidden = false;
  document.querySelector('#previewStructured').hidden = true;
  document.querySelector('#previewFreshness').textContent = message;
  document.querySelector('#previewLineage').textContent = lineage || document.querySelector('#sheetRange').value.trim() || 'No range selected';
  document.querySelector('.builder-preview-panel').dataset.previewStatus = status;
  if (status !== 'ready') renderBuilderAccuratePreview();
}

function selectDisplayType(type) {
  builderPreviewRequest += 1;
  activeDisplayType = displayTypeHelp[type] ? type : 'scorecard';
  document.querySelectorAll('[data-display-type]').forEach((button) => button.classList.toggle('is-selected', button.dataset.displayType === activeDisplayType));
  document.querySelector('#displayTypeHelp').textContent = displayTypeHelp[activeDisplayType];
  document.querySelector('#periodGranularityField').hidden = !['rep_cards','goal_pace','gauge'].includes(activeDisplayType);
  document.querySelector('#comparisonModeField').hidden = comparisonDisabledDisplayTypes.has(activeDisplayType);
  document.querySelector('#goalIntelligenceConfig').hidden = !['goal_pace', 'gauge'].includes(activeDisplayType);
  if (comparisonDisabledDisplayTypes.has(activeDisplayType)) {
    document.querySelector('#kpiComparisonMode').value = 'none';
    document.querySelector('#kpiComparisonFields').hidden = true;
  }
  document.querySelector('#sheetAggregation').value = scalarDisplayTypes.has(activeDisplayType) ? 'single_value' : 'sum';
  document.querySelector('#comparisonAggregation').value = scalarDisplayTypes.has(activeDisplayType) ? 'single_value' : 'sum';
  updateDisplayRequirement();
  builderPreview = null;
  renderStructuredPreview(null);
  if (activeBuilderStep === 3) setBuilderPreviewStatus('idle', 'waiting for compatible data');
}

function currentRangeShape() {
  const rangeValue = document.querySelector('#sheetRange').value;
  const parsed = parseSheetRanges(rangeValue);
  if (!parsed) return null;
  const shapes = parsed.map((range) => ({ rows: Math.abs(range.focus.row - range.anchor.row) + 1, columns: Math.abs(range.focus.column - range.anchor.column) + 1 }));
  const roles = rangeRolesForPayload(primaryRangeRoles, rangeValue);
  if (roles.some((item) => item.role === 'header')) {
    const combinedShape = (role) => {
      const selected = shapes.filter((shape, index) => roles[index].role === role);
      if (!selected.length) return null;
      if (selected.every((shape) => shape.rows === selected[0].rows)) return { rows: selected[0].rows, columns: selected.reduce((total, shape) => total + shape.columns, 0) };
      if (selected.every((shape) => shape.columns === selected[0].columns)) return { rows: selected.reduce((total, shape) => total + shape.rows, 0), columns: selected[0].columns };
      return null;
    };
    const headerShape = combinedShape('header');
    const metricShape = combinedShape('metric');
    if (!headerShape || !metricShape || headerShape.rows !== 1 || headerShape.columns !== metricShape.columns) return { rows: 0, columns: 0, ranges: shapes.length, incompatible: true };
    return { rows: 1 + metricShape.rows, columns: metricShape.columns, ranges: shapes.length };
  }
  if (roles.some((item) => item.role === 'goal')) {
    const metricShapes = shapes.filter((shape, index) => roles[index].role === 'metric');
    if (!metricShapes.length) return null;
    if (metricShapes.every((shape) => shape.rows === metricShapes[0].rows)) return { rows: metricShapes[0].rows, columns: metricShapes.reduce((total, shape) => total + shape.columns, 0), ranges: metricShapes.length };
    if (metricShapes.every((shape) => shape.columns === metricShapes[0].columns)) return { rows: metricShapes.reduce((total, shape) => total + shape.rows, 0), columns: metricShapes[0].columns, ranges: metricShapes.length };
    return { rows: 0, columns: 0, ranges: metricShapes.length, incompatible: true };
  }
  if (shapes.every((shape) => shape.rows === shapes[0].rows)) return { rows: shapes[0].rows, columns: shapes.reduce((total, shape) => total + shape.columns, 0), ranges: shapes.length };
  if (shapes.every((shape) => shape.columns === shapes[0].columns)) return { rows: shapes.reduce((total, shape) => total + shape.rows, 0), columns: shapes[0].columns, ranges: shapes.length };
  return { rows: 0, columns: 0, ranges: shapes.length, incompatible: true };
}

function updateDisplayRequirement() {
  const note = document.querySelector('#displayDataRequirement');
  const headers = primaryUsesHeaders();
  const shape = currentRangeShape();
  note.classList.remove('is-warning');
  if (activeDisplayType === 'scorecard') {
    note.hidden = false;
    const composite = shape && ((headers && shape.rows === 2 && shape.columns === 3) || (!headers && shape.rows === 1 && shape.columns === 3));
    note.textContent = composite
      ? 'Rep scorecard ready: first field is the rep, second is the metric, and third is the goal.'
      : headers
        ? 'Choose one header + value, or three matching header/value ranges for Rep, Metric, and Goal.'
        : 'Choose one numeric cell, or three cells in order: Rep, Metric, Goal. They can be separate ranges.';
    if (shape && !composite && ((headers && shape.rows * shape.columns !== 2) || (!headers && shape.rows * shape.columns !== 1))) note.classList.add('is-warning');
    return;
  }
  if (scalarDisplayTypes.has(activeDisplayType)) {
    note.hidden = false;
    note.textContent = headers ? 'This display expects one header cell and one calculated value cell beneath it.' : 'This display expects exactly one calculated numeric cell.';
    if (shape && ((headers && shape.rows * shape.columns !== 2) || (!headers && shape.rows * shape.columns !== 1))) note.classList.add('is-warning');
    return;
  }
  if (pairedDisplayTypes.has(activeDisplayType)) {
    note.hidden = false;
    note.textContent = headers
      ? 'Ready: the first row supplies column headers. Select exactly two columns—labels first, calculated values second.'
      : 'Headers are required. Go back to Data and turn on “Use first row as headers.”';
    if (!headers || (shape && !((shape.columns === 2 && shape.rows >= 2) || (shape.rows === 2 && shape.columns >= 2)))) note.classList.add('is-warning');
    return;
  }
  if (activeDisplayType === 'activity_feed') {
    note.hidden = false;
    note.textContent = headers
      ? 'Ready when the range has 2–4 columns: timestamp, event, and optional detail/value.'
      : 'Headers are required. Use the first row for Timestamp, Event, Detail, and optional Value.';
    if (!headers || (shape && (shape.columns < 2 || shape.columns > 4 || shape.rows < 2))) note.classList.add('is-warning');
    return;
  }
  if (activeDisplayType === 'heatmap') {
    note.hidden = false;
    note.textContent = headers
      ? 'Ready when the top row contains column labels, the first column contains row labels, and the remaining cells are numeric.'
      : 'Headers are required for both heatmap axes.';
    if (!headers || (shape && (shape.columns < 2 || shape.rows < 2))) note.classList.add('is-warning');
    return;
  }
  note.hidden = false;
  note.textContent = headers ? 'The first selected row will become the table’s column headings.' : 'The selected cells will appear as a table with spreadsheet column letters.';
}

function comparisonBuilderPayload() {
  const enabled = document.querySelector('#kpiComparisonMode').value === 'range';
  return {
    goalValue: document.querySelector('#kpiGoal').value.trim(),
    comparisonSheetId: enabled ? Number(document.querySelector('#comparisonSheet').value) : null,
    comparisonRange: enabled ? document.querySelector('#comparisonRange').value.trim() : '',
    comparisonAggregation: enabled ? document.querySelector('#comparisonAggregation').value : null,
    comparisonIncludeHeaders: enabled && document.querySelector('#comparisonHasHeaders').checked
  };
}

function renderComparisonPreview(comparison = null) {
  const preview = document.querySelector('#previewComparison');
  const status = document.querySelector('#comparisonPreviewStatus');
  if (!comparison) {
    preview.hidden = true;
    preview.textContent = '';
    status.textContent = document.querySelector('#kpiComparisonMode').value === 'range'
      ? (document.querySelector('#comparisonRange').value ? 'Ready to preview' : 'Not selected')
      : 'No comparison';
    return;
  }
  const format = document.querySelector('#kpiFormat').value;
  const delta = `${comparison.delta >= 0 ? '+' : ''}${formatKpiValue(comparison.delta, format)}`;
  const percent = comparison.percentChange === null ? '' : ` · ${comparison.percentChange >= 0 ? '+' : ''}${comparison.percentChange.toFixed(1)}%`;
  preview.textContent = `${delta}${percent} vs ${comparison.sourceRange} (${formatKpiValue(comparison.value, format)})`;
  preview.hidden = false;
  status.textContent = 'Previewed just now';
}

function sheetColumnLabel(column) {
  let value = Number(column);
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function sheetColumnNumber(label) {
  return [...String(label).toUpperCase()].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
}

function parseSheetRange(value = '') {
  const match = String(value).trim().toUpperCase().match(/^([A-Z]{1,3})([1-9][0-9]*)(?::([A-Z]{1,3})([1-9][0-9]*))?$/);
  if (!match) return null;
  return {
    anchor: { row: Number(match[2]), column: sheetColumnNumber(match[1]) },
    focus: { row: Number(match[4] || match[2]), column: sheetColumnNumber(match[3] || match[1]) }
  };
}

function parseSheetRanges(value = '') {
  const ranges = String(value).split(',').map((range) => range.trim()).filter(Boolean);
  if (!ranges.length || ranges.length > 12) return null;
  const parsed = ranges.map(parseSheetRange);
  return parsed.every(Boolean) ? parsed : null;
}

function sheetSelectionBounds(selection = sheetSelection) {
  const { anchor, focus } = selection;
  return {
    minRow: Math.min(anchor.row, focus.row), maxRow: Math.max(anchor.row, focus.row),
    minColumn: Math.min(anchor.column, focus.column), maxColumn: Math.max(anchor.column, focus.column)
  };
}

function sheetSelectionA1(selection = sheetSelection) {
  const bounds = sheetSelectionBounds(selection);
  const first = `${sheetColumnLabel(bounds.minColumn)}${bounds.minRow}`;
  const last = `${sheetColumnLabel(bounds.maxColumn)}${bounds.maxRow}`;
  return first === last ? first : `${first}:${last}`;
}

function sheetSelectionsA1() {
  return sheetSelections.map(sheetSelectionA1).join(',');
}

function normalizedSelectionRoles(roles = sheetSelectionRoles) {
  return sheetSelections.map((selection, index) => ({ range: sheetSelectionA1(selection), role: ['header', 'goal'].includes(roles[index]) ? roles[index] : 'metric' }));
}

function primaryUsesHeaders() {
  return document.querySelector('#sheetHasHeaders').checked || primaryRangeRoles.some((item) => item.role === 'header');
}

function rangeRolesForPayload(roles, rangeValue) {
  const ranges = String(rangeValue || '').split(',').map((range) => range.trim().toUpperCase()).filter(Boolean);
  return roles.length === ranges.length && roles.every((item, index) => item.range === ranges[index]) ? roles : [];
}

function sheetSelectionCellCount() {
  return sheetSelections.reduce((total, selection) => {
    const bounds = sheetSelectionBounds(selection);
    return total + ((bounds.maxRow - bounds.minRow + 1) * (bounds.maxColumn - bounds.minColumn + 1));
  }, 0);
}

function renderRangeSelectionChips() {
  const chips = document.querySelector('#rangeSelectionChips');
  chips.replaceChildren(...sheetSelections.map((selection, index) => {
    const chip = document.createElement('span');
    chip.className = index === activeSheetSelectionIndex ? 'is-active' : '';
    const role = ['header', 'goal'].includes(sheetSelectionRoles[index]) ? sheetSelectionRoles[index] : 'metric';
    chip.innerHTML = `<b>${index + 1}</b><strong>${escapeHtml(sheetSelectionA1(selection))}</strong><select data-range-role="${index}" aria-label="Role for ${escapeHtml(sheetSelectionA1(selection))}"><option value="metric"${role === 'metric' ? ' selected' : ''}>Metrics</option><option value="header"${role === 'header' ? ' selected' : ''}>Headers</option><option value="goal"${role === 'goal' ? ' selected' : ''}>Goal</option></select>${sheetSelections.length > 1 ? `<button type="button" data-remove-range="${index}" aria-label="Remove ${escapeHtml(sheetSelectionA1(selection))}">×</button>` : ''}`;
    return chip;
  }));
}

function syncSheetSelection() {
  const selectionBounds = sheetSelections.map(sheetSelectionBounds);
  const includesHeaders = document.querySelector('#rangePickerHasHeaders').checked;
  document.querySelectorAll('#sheetGrid [data-sheet-cell]').forEach((cell) => {
    const row = Number(cell.dataset.row);
    const column = Number(cell.dataset.column);
    const containingIndex = selectionBounds.findIndex((bounds) => row >= bounds.minRow && row <= bounds.maxRow && column >= bounds.minColumn && column <= bounds.maxColumn);
    const containing = selectionBounds[containingIndex];
    const selected = Boolean(containing);
    const edge = selected && (row === containing.minRow || row === containing.maxRow || column === containing.minColumn || column === containing.maxColumn);
    const header = selected && (sheetSelectionRoles[containingIndex] === 'header' || (includesHeaders && row === containing.minRow));
    if (cell.classList.contains('is-selected') !== selected) cell.classList.toggle('is-selected', selected);
    if (cell.classList.contains('is-selection-edge') !== edge) cell.classList.toggle('is-selection-edge', edge);
    if (cell.classList.contains('is-header-cell') !== header) cell.classList.toggle('is-header-cell', header);
    if (cell.getAttribute('aria-selected') !== String(selected)) cell.setAttribute('aria-selected', String(selected));
  });
  const cellCount = sheetSelectionCellCount();
  const explicitHeaders = sheetSelectionRoles.filter((role) => role === 'header').length;
  const explicitGoals = sheetSelectionRoles.filter((role) => role === 'goal').length;
  document.querySelector('#rangePickerSelectionSummary').textContent = `${sheetSelections.length} range${sheetSelections.length === 1 ? '' : 's'} · ${cellCount} selected cell${cellCount === 1 ? '' : 's'}${explicitHeaders ? ` · ${explicitHeaders} header range${explicitHeaders === 1 ? '' : 's'}` : includesHeaders ? ' · inline header rows' : ''}${explicitGoals ? ` · ${explicitGoals} goal range${explicitGoals === 1 ? '' : 's'}` : ''}`;
  renderRangeSelectionChips();
}

function scheduleSheetSelectionSync() {
  if (sheetSelectionFrame !== null) return;
  sheetSelectionFrame = window.requestAnimationFrame(() => {
    sheetSelectionFrame = null;
    syncSheetSelection();
  });
}

function setSheetSelection(anchor, focus = anchor, { writeInput = true, additive = false, selectionIndex = null } = {}) {
  const next = { anchor: { ...anchor }, focus: { ...focus } };
  if (additive) {
    sheetSelections = [...sheetSelections, next];
    sheetSelectionRoles = [...sheetSelectionRoles, 'metric'];
    activeSheetSelectionIndex = sheetSelections.length - 1;
  } else if (Number.isInteger(selectionIndex) && sheetSelections[selectionIndex]) {
    sheetSelections = sheetSelections.map((selection, index) => index === selectionIndex ? next : selection);
    activeSheetSelectionIndex = selectionIndex;
  } else {
    sheetSelections = [next];
    sheetSelectionRoles = ['metric'];
    activeSheetSelectionIndex = 0;
  }
  sheetSelection = sheetSelections[activeSheetSelectionIndex];
  if (writeInput) document.querySelector('#rangePickerInput').value = sheetSelectionsA1();
  builderPreview = null;
  document.querySelector('#rangePickerPreviewResult').textContent = 'Ready to apply';
  scheduleSheetSelectionSync();
}

function updateSheetGridOverlays() {
  const grid = document.querySelector('#sheetGrid');
  if (!sheetGridState) return;
  const columnOverlay = grid.querySelector('.sheet-column-overlay');
  const rowOverlay = grid.querySelector('.sheet-row-overlay');
  const corner = grid.querySelector('.sheet-grid-corner');
  const columnWindow = grid.querySelector('.sheet-column-window');
  const rowWindow = grid.querySelector('.sheet-row-window');
  if (!columnOverlay || !rowOverlay || !corner || !columnWindow || !rowWindow) return;
  columnOverlay.style.width = `${grid.clientWidth}px`;
  rowOverlay.style.height = `${grid.clientHeight}px`;
  columnOverlay.style.transform = `translate(${grid.scrollLeft}px, ${grid.scrollTop}px)`;
  rowOverlay.style.transform = `translate(${grid.scrollLeft}px, ${grid.scrollTop}px)`;
  corner.style.transform = `translate(${grid.scrollLeft}px, ${grid.scrollTop}px)`;
  columnWindow.style.left = `${sheetRowHeaderWidth + ((sheetGridState.startColumn - 1) * sheetCellWidth) - grid.scrollLeft}px`;
  rowWindow.style.top = `${sheetColumnHeaderHeight + ((sheetGridState.startRow - 1) * sheetCellHeight) - grid.scrollTop}px`;
}

function renderSheetGrid() {
  const grid = document.querySelector('#sheetGrid');
  if (!sheetGridState) {
    grid.innerHTML = '<p>Choose a spreadsheet and sheet to browse its cells.</p>';
    return;
  }
  const scrollLeft = grid.scrollLeft;
  const scrollTop = grid.scrollTop;
  const canvas = document.createElement('div');
  canvas.className = 'sheet-virtual-canvas';
  canvas.style.width = `${sheetRowHeaderWidth + (sheetGridState.maxColumns * sheetCellWidth)}px`;
  canvas.style.height = `${sheetColumnHeaderHeight + (sheetGridState.maxRows * sheetCellHeight)}px`;

  const cells = document.createElement('div');
  cells.className = 'sheet-cell-window';
  cells.style.left = `${sheetRowHeaderWidth + ((sheetGridState.startColumn - 1) * sheetCellWidth)}px`;
  cells.style.top = `${sheetColumnHeaderHeight + ((sheetGridState.startRow - 1) * sheetCellHeight)}px`;
  cells.style.gridTemplateColumns = `repeat(${sheetGridState.columnCount}, ${sheetCellWidth}px)`;
  cells.style.gridTemplateRows = `repeat(${sheetGridState.rowCount}, ${sheetCellHeight}px)`;

  const columnOverlay = document.createElement('div');
  columnOverlay.className = 'sheet-column-overlay';
  const columnWindow = document.createElement('div');
  columnWindow.className = 'sheet-column-window';
  columnWindow.style.gridTemplateColumns = `repeat(${sheetGridState.columnCount}, ${sheetCellWidth}px)`;
  sheetGridState.columns.forEach((column) => {
    const heading = document.createElement('b');
    heading.textContent = column;
    heading.setAttribute('role', 'columnheader');
    columnWindow.append(heading);
  });
  columnOverlay.append(columnWindow);

  const rowOverlay = document.createElement('div');
  rowOverlay.className = 'sheet-row-overlay';
  const rowWindow = document.createElement('div');
  rowWindow.className = 'sheet-row-window';
  sheetGridState.values.forEach((rowValues, rowIndex) => {
    const row = sheetGridState.startRow + rowIndex;
    const heading = document.createElement('i');
    heading.textContent = row;
    heading.setAttribute('role', 'rowheader');
    rowWindow.append(heading);
    rowValues.forEach((value, columnIndex) => {
      const column = sheetGridState.startColumn + columnIndex;
      const cell = document.createElement('button');
      const address = `${sheetColumnLabel(column)}${row}`;
      cell.type = 'button';
      cell.dataset.interactionStatus = 'working';
      cell.dataset.sheetCell = address;
      cell.dataset.row = row;
      cell.dataset.column = column;
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `${address}: ${value === '' ? 'empty' : value}`);
      cell.title = `${address}${value === '' ? '' : ` · ${value}`}`;
      cell.textContent = value === '' ? '' : String(value);
      cells.append(cell);
    });
  });
  rowOverlay.append(rowWindow);

  const corner = document.createElement('b');
  corner.className = 'sheet-grid-corner';
  corner.setAttribute('aria-hidden', 'true');
  canvas.append(cells, columnOverlay, rowOverlay, corner);
  grid.replaceChildren(canvas);
  grid.scrollLeft = scrollLeft;
  grid.scrollTop = scrollTop;
  document.querySelector('#sheetViewportLabel').textContent = sheetGridState.range;
  updateSheetGridOverlays();
  syncSheetSelection();
}

async function loadSheetGrid(startRow = 1, startColumn = 1) {
  const spreadsheet = document.querySelector('#sheetFile').value.trim();
  const selectedSheet = document.querySelector('#rangePickerSheet').value;
  const sheetId = Number(selectedSheet);
  if (!loadedSpreadsheet || !spreadsheet || !selectedSheet || !Number.isSafeInteger(sheetId)) return null;
  const sheet = loadedSpreadsheet.sheets.find((candidate) => candidate.sheetId === sheetId);
  if (!sheet) return null;
  const row = Math.max(1, Math.min(Number(startRow) || 1, sheet.rowCount));
  const column = Math.max(1, Math.min(Number(startColumn) || 1, sheet.columnCount));
  const request = ++sheetGridRequest;
  document.querySelector('#sheetPickerStatus').textContent = 'Loading cells…';
  const query = new URLSearchParams({
    connectionId: activeGoogleConnection.id, spreadsheet, sheetId: String(sheetId), row: String(row), column: String(column),
    rows: String(sheetWindowRows), columns: String(sheetWindowColumns)
  });
  try {
    const payload = await apiJson(`/api/axoboard/integrations/google/grid?${query}`);
    if (request !== sheetGridRequest) return null;
    sheetGridState = payload.grid;
    document.querySelector('#sheetPickerStatus').textContent = 'Drag to select';
    renderSheetGrid();
    return sheetGridState;
  } catch (error) {
    if (request !== sheetGridRequest) return null;
    if (!sheetGridState) {
      document.querySelector('#sheetGrid').innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      document.querySelector('#sheetPickerStatus').textContent = 'Preview unavailable';
    } else {
      document.querySelector('#sheetPickerStatus').textContent = 'Scroll preview paused';
    }
    throw error;
  }
}

function scheduleSheetGridLoad() {
  const grid = document.querySelector('#sheetGrid');
  updateSheetGridOverlays();
  if (!sheetGridState) return;
  window.clearTimeout(sheetGridScrollTimer);
  sheetGridScrollTimer = window.setTimeout(async () => {
    const visibleRow = Math.max(1, Math.floor(grid.scrollTop / sheetCellHeight) + 1);
    const visibleColumn = Math.max(1, Math.floor(grid.scrollLeft / sheetCellWidth) + 1);
    const startRow = Math.floor((visibleRow - 1) / 12) * 12 + 1;
    const startColumn = Math.floor((visibleColumn - 1) / 6) * 6 + 1;
    if (startRow === sheetGridState.startRow && startColumn === sheetGridState.startColumn) return;
    try { await loadSheetGrid(startRow, startColumn); }
    catch (error) { showToast('Sheet scroll paused', error.message); }
  }, 140);
}

async function revealSheetSelection() {
  const bounds = sheetSelectionBounds();
  const selectedSheetId = Number(document.querySelector('#rangePickerSheet').value);
  const selectedSheet = loadedSpreadsheet?.sheets.find((sheet) => sheet.sheetId === selectedSheetId);
  if (!selectedSheet || bounds.maxRow > selectedSheet.rowCount || bounds.maxColumn > selectedSheet.columnCount) {
    throw new Error('That range is outside the selected sheet.');
  }
  const startRow = Math.max(1, bounds.minRow - 3);
  const startColumn = Math.max(1, bounds.minColumn - 2);
  const loaded = sheetGridState && sheetGridState.sheet.sheetId === selectedSheetId && bounds.minRow >= sheetGridState.startRow && bounds.maxRow < sheetGridState.startRow + sheetGridState.rowCount && bounds.minColumn >= sheetGridState.startColumn && bounds.maxColumn < sheetGridState.startColumn + sheetGridState.columnCount
    ? sheetGridState
    : await loadSheetGrid(startRow, startColumn);
  const grid = document.querySelector('#sheetGrid');
  grid.scrollTo({
    top: Math.max(0, ((bounds.minRow - 1) * sheetCellHeight) - (sheetCellHeight * 2)),
    left: Math.max(0, ((bounds.minColumn - 1) * sheetCellWidth) - sheetCellWidth),
    behavior: 'auto'
  });
  updateSheetGridOverlays();
  return loaded;
}

function selectedSheetTitle(sheetId) {
  return loadedSpreadsheet?.sheets.find((sheet) => sheet.sheetId === Number(sheetId))?.title || 'Sheet';
}

function updatePrimaryRangeSummary() {
  const parsed = parseSheetRanges(document.querySelector('#sheetRange').value);
  if (!parsed) {
    document.querySelector('#sheetSelectionSummary').textContent = 'Enter valid A1 ranges';
    document.querySelector('#sheetPreviewResult').textContent = 'Examples: D8, B2:E14, or A2,C2,F2';
    return;
  }
  const count = parsed.reduce((total, range) => total + ((Math.abs(range.focus.row - range.anchor.row) + 1) * (Math.abs(range.focus.column - range.anchor.column) + 1)), 0);
  document.querySelector('#sheetSelectionSummary').textContent = `${parsed.length} range${parsed.length === 1 ? '' : 's'} · ${count} cell${count === 1 ? '' : 's'}`;
  const explicitHeaders = primaryRangeRoles.filter((item) => item.role === 'header').length;
  document.querySelector('#sheetPreviewResult').textContent = explicitHeaders
    ? `${explicitHeaders} separate header range${explicitHeaders === 1 ? '' : 's'} configured`
    : document.querySelector('#sheetHasHeaders').checked ? 'First row will be used as headers' : 'Ready to choose a display';
  updateDisplayRequirement();
}

async function openRangePicker(target, trigger = document.activeElement) {
  if (!loadedSpreadsheet) await loadSpreadsheetMetadata();
  rangePickerIntent = target === 'comparison' ? 'comparison' : target === 'goal' ? 'goal' : 'primary';
  rangePickerTarget = rangePickerIntent === 'comparison' ? 'comparison' : 'primary';
  rangePickerReturnFocus = trigger;
  const sourceRange = rangePickerTarget === 'comparison'
    ? document.querySelector('#comparisonRange').value || document.querySelector('#sheetRange').value || 'A1'
    : document.querySelector('#sheetRange').value || 'A1';
  const sourceSheet = rangePickerTarget === 'comparison'
    ? document.querySelector('#comparisonSheet').value || document.querySelector('#sheetTab').value
    : document.querySelector('#sheetTab').value;
  document.querySelector('#rangePickerSheet').value = sourceSheet;
  document.querySelector('#rangePickerHasHeaders').checked = rangePickerTarget === 'comparison'
    ? document.querySelector('#comparisonHasHeaders').checked
    : document.querySelector('#sheetHasHeaders').checked;
  const parsed = parseSheetRanges(sourceRange);
  if (!parsed) throw new Error('Use ranges such as D8, D8:D20, or A2,C2,F2.');
  sheetSelections = parsed;
  const storedRoles = rangePickerTarget === 'comparison' ? comparisonRangeRoles : primaryRangeRoles;
  sheetSelectionRoles = storedRoles.length === parsed.length
    ? storedRoles.map((item) => ['header', 'goal'].includes(item.role) ? item.role : 'metric')
    : parsed.map(() => 'metric');
  if (rangePickerIntent === 'goal') {
    const existingGoalIndex = sheetSelectionRoles.indexOf('goal');
    if (existingGoalIndex >= 0) {
      activeSheetSelectionIndex = existingGoalIndex;
    } else {
      const metricIndex = Math.max(0, sheetSelectionRoles.lastIndexOf('metric'));
      const metricBounds = sheetSelectionBounds(sheetSelections[metricIndex]);
      const rows = metricBounds.maxRow - metricBounds.minRow;
      const columns = metricBounds.maxColumn - metricBounds.minColumn;
      const selectedSheet = loadedSpreadsheet.sheets.find((sheet) => sheet.sheetId === Number(sourceSheet));
      const fitsRight = !selectedSheet || metricBounds.maxColumn + columns + 1 <= selectedSheet.columnCount;
      const fitsBelow = !selectedSheet || metricBounds.maxRow + rows + 1 <= selectedSheet.rowCount;
      const anchor = fitsRight
        ? { row: metricBounds.minRow, column: metricBounds.maxColumn + 1 }
        : fitsBelow
          ? { row: metricBounds.maxRow + 1, column: metricBounds.minColumn }
          : { row: 1, column: 1 };
      const goalSelection = { anchor, focus: { row: anchor.row + rows, column: anchor.column + columns } };
      sheetSelections = [...sheetSelections, goalSelection];
      sheetSelectionRoles = [...sheetSelectionRoles, 'goal'];
      activeSheetSelectionIndex = sheetSelections.length - 1;
    }
  } else {
    activeSheetSelectionIndex = 0;
  }
  sheetSelection = sheetSelections[activeSheetSelectionIndex];
  addingSeparateRange = false;
  document.querySelector('#addRangeSelection').setAttribute('aria-pressed', 'false');
  document.querySelector('#rangePickerInput').value = sheetSelectionsA1();
  document.querySelector('#rangePickerTitle').textContent = rangePickerIntent === 'comparison' ? 'Choose comparison cells' : rangePickerIntent === 'goal' ? 'Choose goal cells' : 'Choose KPI cells';
  document.querySelector('#rangePickerCopy').textContent = rangePickerIntent === 'comparison'
    ? 'Pick the cells this KPI should compare against.'
    : rangePickerIntent === 'goal'
      ? 'The new range is already marked Goal. Select one shared goal cell or a range matching the metric.'
    : 'Drag to select, then add separate ranges for cells that are not touching.';
  document.querySelector('#rangePickerPreviewResult').textContent = 'Selection not applied';
  const modal = document.querySelector('#rangePickerModal');
  modal.classList.add('is-visible');
  modal.setAttribute('aria-hidden', 'false');
  document.querySelector('#sheetPickerStatus').textContent = 'Loading cells…';
  document.querySelector('#rangePickerInput').focus();
  if (rangePickerIntent === 'goal') await revealSheetSelection();
  else {
    await loadSheetGrid(1, 1);
    document.querySelector('#sheetGrid').scrollTo({ top: 0, left: 0, behavior: 'auto' });
    updateSheetGridOverlays();
  }
}

function closeRangePicker() {
  const modal = document.querySelector('#rangePickerModal');
  modal.classList.remove('is-visible');
  modal.setAttribute('aria-hidden', 'true');
  selectingSheetCells = false;
  if (sheetSelectionFrame !== null) window.cancelAnimationFrame(sheetSelectionFrame);
  sheetSelectionFrame = null;
  rangePickerReturnFocus?.focus?.();
}

function applyRangePickerSelection() {
  const range = sheetSelectionsA1();
  const cellCount = sheetSelectionCellCount();
  const pickerSheet = document.querySelector('#rangePickerSheet').value;
  const includesHeaders = document.querySelector('#rangePickerHasHeaders').checked;
  if (rangePickerTarget === 'comparison') {
    if (pickerSheet === document.querySelector('#sheetTab').value && range === document.querySelector('#sheetRange').value.trim().toUpperCase()) {
      showToast('Choose different comparison cells', 'The KPI and comparison cannot use the same sheet range.');
      return;
    }
    document.querySelector('#comparisonSheet').value = pickerSheet;
    document.querySelector('#comparisonRange').value = range;
    document.querySelector('#comparisonHasHeaders').checked = includesHeaders;
    comparisonRangeRoles = normalizedSelectionRoles();
    document.querySelector('#comparisonSelectionLabel').textContent = `${selectedSheetTitle(pickerSheet)}!${range}`;
    document.querySelector('#comparisonPreviewStatus').textContent = 'Ready to preview';
  } else {
    document.querySelector('#sheetTab').value = pickerSheet;
    document.querySelector('#sheetRange').value = range;
    document.querySelector('#sheetHasHeaders').checked = includesHeaders;
    primaryRangeRoles = normalizedSelectionRoles();
    updatePrimaryRangeSummary();
  }
  builderPreview = null;
  renderComparisonPreview();
  closeRangePicker();
  if (rangePickerIntent === 'goal' && activeBuilderStep === 3) {
    previewGoogleSelection().catch((error) => showToast('Goal cells need attention', error.message));
  }
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number.isFinite(Number(value)) ? Number(value) : 0));
}

function renderTrendChart(items, displayFormat) {
  const points = (items || []).filter((item) => Number.isFinite(Number(item.value)));
  if (!points.length) return '<div class="visual-empty">No numeric trend points</div>';
  const values = points.flatMap((item) => [Number(item.value), Number(item.comparisonValue)].filter(Number.isFinite));
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const coordinates = (key) => points.map((item, index) => {
    const value = Number(item[key]);
    if (!Number.isFinite(value)) return null;
    const x = points.length === 1 ? 160 : 12 + (index / (points.length - 1)) * 296;
    const y = 108 - ((value - minimum) / (maximum - minimum)) * 92;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(' ');
  const comparison = points.every((item) => Number.isFinite(Number(item.comparisonValue)))
    ? `<polyline class="trend-comparison" points="${coordinates('comparisonValue')}" />`
    : '';
  const labels = points.length <= 6 ? points.map((item) => `<span>${escapeHtml(item.label)}</span>`).join('') : `<span>${escapeHtml(points[0].label)}</span><span>${escapeHtml(points.at(-1).label)}</span>`;
  return `<div class="trend-visual" role="img" aria-label="Trend from ${escapeHtml(points[0].label)} ${escapeHtml(formatKpiValue(points[0].value, displayFormat))} to ${escapeHtml(points.at(-1).label)} ${escapeHtml(formatKpiValue(points.at(-1).value, displayFormat))}"><svg viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden="true"><line x1="12" y1="108" x2="308" y2="108" />${comparison}<polyline class="trend-current" points="${coordinates('value')}" /></svg><div class="trend-labels">${labels}</div></div>`;
}

function renderCategoryBars(items, displayFormat) {
  const values = (items || []).map((item) => Math.abs(Number(item.value))).filter(Number.isFinite);
  const maximum = Math.max(1, ...values);
  return `<div class="category-bars">${(items || []).map((item) => `<div class="category-bar-row"><span title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span><i><b style="width:${clampPercent((Math.abs(Number(item.value)) / maximum) * 100)}%"></b></i><strong>${escapeHtml(formatKpiValue(item.value, displayFormat))}</strong></div>`).join('')}</div>`;
}

function renderFlow(items, displayFormat, kind) {
  const stages = (items || []).filter((item) => Number.isFinite(Number(item.value)));
  const maximum = Math.max(1, ...stages.map((item) => Math.abs(Number(item.value))));
  if (kind === 'pipeline') {
    return `<div class="pipeline-visual">${stages.map((item, index) => `<div class="pipeline-stage"><small>${index + 1}</small><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatKpiValue(item.value, displayFormat))}</strong></div>`).join('')}</div>`;
  }
  return `<div class="funnel-visual">${stages.map((item, index) => {
    const previous = index ? Math.abs(Number(stages[index - 1].value)) : null;
    const conversion = previous ? `${((Math.abs(Number(item.value)) / previous) * 100).toFixed(0)}%` : 'Start';
    const width = 34 + (Math.abs(Number(item.value)) / maximum) * 66;
    return `<div style="width:${width.toFixed(1)}%"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatKpiValue(item.value, displayFormat))}</strong><small>${conversion}</small></div>`;
  }).join('')}</div>`;
}

function renderActivityFeed(payload) {
  return `<div class="activity-feed">${(payload.entries || []).slice(0, 20).map((entry) => `<div><time>${escapeHtml(entry.timestamp)}</time><span><strong>${escapeHtml(entry.label)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}</span>${entry.value !== null && entry.value !== '' ? `<b>${escapeHtml(entry.value)}</b>` : ''}</div>`).join('')}</div>`;
}

function renderHeatmap(payload, displayFormat) {
  const range = Number(payload.max) - Number(payload.min) || 1;
  const columns = Math.max(1, payload.xLabels?.length || 1);
  const header = `<span title="${escapeHtml(payload.cornerLabel || '')}">${escapeHtml(payload.cornerLabel || '')}</span>${(payload.xLabels || []).map((label) => `<strong title="${escapeHtml(label)}">${escapeHtml(label)}</strong>`).join('')}`;
  const rows = (payload.yLabels || []).map((label, rowIndex) => `<b title="${escapeHtml(label)}">${escapeHtml(label)}</b>${(payload.cells[rowIndex] || []).map((value) => {
    const intensity = 0.16 + ((Number(value) - Number(payload.min)) / range) * 0.78;
    return `<i style="--heat:${intensity.toFixed(3)}" title="${escapeHtml(label)} · ${escapeHtml(formatKpiValue(value, displayFormat))}">${escapeHtml(formatKpiValue(value, displayFormat))}</i>`;
  }).join('')}`).join('');
  return `<div class="heatmap-scroll"><div class="heatmap-visual" style="--heatmap-columns:${columns}"><header>${header}</header>${rows}</div></div>`;
}

function pairedDataLabel(payload, fallback) {
  const label = String(payload?.headers?.label || 'Label');
  const value = String(payload?.headers?.value || fallback || 'Value');
  return `${value} by ${label}`;
}

function renderKpiCard(card, kpi, { interactive = true } = {}) {
  const displayType = kpi.displayType || 'scorecard';
  const compositeScorecard = displayType === 'scorecard' && kpi.displayPayload?.layout === 'rep_metric_goal';
  const structured = Boolean(kpi.displayPayload) && !scalarDisplayTypes.has(displayType);
  const canManageKpi = interactive && liveCapabilities.manageKpis !== false;
  const showSourceDetails = !interactive || liveCapabilities.viewSourceDetails !== false;
  card.className = `surface kpi-card kpi-card-${displayType}${structured ? ' kpi-card-structured' : ''}${compositeScorecard ? ' kpi-card-scorecard-detail' : ''}${interactive ? '' : ' kpi-card-builder-preview'}`;
  const goalProgress = kpi.goalValue === null || kpi.goalValue === 0 ? null : clampPercent((kpi.value / kpi.goalValue) * 100);
  const comparisonPercent = kpi.comparisonValue === null || kpi.comparisonValue === 0 ? null : (kpi.comparisonDelta / Math.abs(kpi.comparisonValue)) * 100;
  const comparisonLabel = showSourceDetails && kpi.comparisonSourceRange ? kpi.comparisonSourceRange : 'comparison';
  const comparisonText = kpi.comparisonValue === null ? '' : `${kpi.comparisonDelta >= 0 ? '+' : ''}${formatKpiValue(kpi.comparisonDelta, kpi.displayFormat)}${comparisonPercent === null ? '' : ` (${comparisonPercent >= 0 ? '+' : ''}${comparisonPercent.toFixed(1)}%)`} vs ${comparisonLabel}`;
  const contextText = comparisonText || (goalProgress === null ? (kpi.status === 'active' ? 'Live' : 'Needs attention') : `${goalProgress.toFixed(1)}% of ${formatKpiValue(kpi.goalValue, kpi.displayFormat)} goal`);
  const automationCount = canManageKpi && liveCapabilities.readAutomations !== false ? automationRulesForMetric(automationMetricIdForKpi(kpi)).length : 0;
  const automationShortcut = automationCount ? `<button class="kpi-automation-badge" type="button" data-open-kpi-automations="${escapeHtml(automationMetricIdForKpi(kpi))}" data-interaction-status="working" aria-label="Open ${automationCount} automation${automationCount === 1 ? '' : 's'} for ${escapeHtml(kpi.name)}" title="${automationCount} linked automation${automationCount === 1 ? '' : 's'}">ϟ ${automationCount}</button>` : '';
  const actions = canManageKpi ? `<span class="kpi-card-actions">${automationShortcut}<button type="button" data-edit-live-kpi="${escapeHtml(kpi.id)}" aria-label="Edit ${escapeHtml(kpi.name)}" title="Edit KPI">✎</button><button type="button" data-sync-live-kpi="${escapeHtml(kpi.id)}" aria-label="Refresh ${escapeHtml(kpi.name)}" title="Refresh KPI">↻</button><button class="kpi-delete-button" type="button" data-delete-live-kpi="${escapeHtml(kpi.id)}" aria-label="Delete ${escapeHtml(kpi.name)}" title="Delete KPI">×</button></span>` : (interactive ? '' : '<span class="preview-live-pill">Preview</span>');
  const certified = kpi.certification?.status === 'certified' ? `<button class="certified-chip" type="button" data-live-trust="${escapeHtml(kpi.id)}">✓ Certified</button>` : '';
  const source = showSourceDetails
    ? `<span class="source-mark google">G</span><small>Google Sheets · ${escapeHtml(kpi.sourceRange || `${kpi.sheetTitle}!${kpi.range}`)}</small>`
    : '<span class="source-mark certified-source">✓</span><small>Certified metric</small>';
  const header = `<header class="structured-kpi-head">${source}${certified}${actions}</header>`;
  if (displayType === 'goal_pace') {
    const target = Number(kpi.goalValue);
    const hasGoal = Number.isFinite(target) && target !== 0;
    const progress = hasGoal ? clampPercent((Number(kpi.value) / target) * 100) : 0;
    const remaining = hasGoal ? Math.max(0, target - Number(kpi.value)) : null;
    const intelligence = kpi.intelligence;
    const paceCopy = intelligence ? `${formatKpiValue(intelligence.requiredPerDay, kpi.displayFormat)}/day required` : (remaining === null ? 'Target needed' : `${formatKpiValue(remaining, kpi.displayFormat)} remaining`);
    const projection = intelligence ? `Projected ${formatKpiValue(intelligence.projectedFinish, kpi.displayFormat)}` : (hasGoal ? `${progress.toFixed(1)}% complete` : 'Add a goal to calculate pace');
    card.innerHTML = `${header}<p>${escapeHtml(kpi.name)}</p><strong>${escapeHtml(formatKpiValue(kpi.value, kpi.displayFormat))}</strong><div class="goal-pace-copy"><span>${escapeHtml(projection)}</span><b>${escapeHtml(paceCopy)}</b></div><div class="goal-pace-track"><i style="width:${progress}%"></i><em style="left:${progress}%"></em></div><footer><span>${escapeHtml(timeAgo(kpi.fetchedAt))}</span><b>${escapeHtml(intelligence?.status?.replaceAll('_',' ') || (hasGoal && progress >= 100 ? 'Goal reached' : 'In progress'))}</b></footer>`;
  } else if (displayType === 'gauge') {
    const value = Number(kpi.value);
    const configuredMax = Number(kpi.goalValue);
    const maximum = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : Math.max(10, 10 ** Math.ceil(Math.log10(Math.max(1, Math.abs(value)))));
    const progress = clampPercent((value / maximum) * 100);
    card.innerHTML = `${header}<div class="structured-kpi-title"><p>Gauge · 0 to ${escapeHtml(formatKpiValue(maximum, kpi.displayFormat))}</p><strong>${escapeHtml(kpi.name)}</strong></div><div class="gauge-dial" style="--gauge-turn:${(progress / 100).toFixed(4)}turn"><div><strong>${escapeHtml(formatKpiValue(value, kpi.displayFormat))}</strong><span>${progress.toFixed(1)}%</span></div></div><footer><span>${escapeHtml(kpi.intelligence ? `Projected ${formatKpiValue(kpi.intelligence.projectedFinish, kpi.displayFormat)}` : timeAgo(kpi.fetchedAt))}</span><b>${escapeHtml(kpi.intelligence?.status?.replaceAll('_',' ') || (Number.isFinite(configuredMax) && configuredMax > 0 ? 'Goal range' : 'Auto range'))}</b></footer>`;
  } else if (compositeScorecard) {
    const payload = kpi.displayPayload;
    const progress = payload.goal.value === 0 ? null : clampPercent((payload.metric.value / payload.goal.value) * 100);
    card.innerHTML = `${header}<div class="scorecard-rep"><small>${escapeHtml(payload.rep.label)}</small><strong>${escapeHtml(payload.rep.value)}</strong></div><div class="scorecard-metric"><p>${escapeHtml(payload.metric.label === 'Metric' ? kpi.name : payload.metric.label)}</p><strong>${escapeHtml(formatKpiValue(payload.metric.value, kpi.displayFormat))}</strong></div><div class="scorecard-goal"><span><small>${escapeHtml(payload.goal.label)}</small><b>${escapeHtml(formatKpiValue(payload.goal.value, kpi.displayFormat))}</b></span><em>${progress === null ? 'Goal progress unavailable' : `${progress.toFixed(1)}% of goal`}</em></div><div class="goal-pace-track"><i style="width:${progress ?? 0}%"></i><em style="left:${progress ?? 0}%"></em></div><footer><span>${escapeHtml(timeAgo(kpi.fetchedAt))}</span><b>Live rep scorecard</b></footer>`;
  } else if (!structured) {
    const calculationLabel = kpi.aggregation ? kpi.aggregation.replaceAll('_', ' ') : 'certified value';
    card.innerHTML = `${header}<p>${escapeHtml(kpi.name)}</p><strong>${escapeHtml(formatKpiValue(kpi.value, kpi.displayFormat))}</strong><div class="kpi-change ${kpi.status === 'active' ? 'positive' : 'neutral'}">● ${escapeHtml(contextText)} <span>${escapeHtml(timeAgo(kpi.fetchedAt))}</span></div><div class="mini-progress"><i style="width:${goalProgress === null ? (kpi.status === 'active' ? '100' : '20') : goalProgress}%"></i></div><footer><span>${escapeHtml(calculationLabel)} · read only</span><b>${escapeHtml(kpi.status)}</b></footer>`;
  } else if (displayType === 'rep_cards') {
    const period = periodLabels[kpi.periodGranularity] || 'Monthly';
    const cards = (kpi.displayPayload.items || []).map((item) => {
      const target = item.goalValue ?? item.comparisonValue ?? kpi.goalValue;
      const progress = !target ? null : clampPercent((Number(item.value) / Number(target)) * 100);
      return `<article class="period-rep-card"><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong><span>${progress === null ? `${period} value` : `${progress.toFixed(0)}% of ${formatKpiValue(target, kpi.displayFormat)}`}</span><i><b style="width:${progress ?? 100}%"></b></i></article>`;
    }).join('');
    card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(period)} · ${escapeHtml(pairedDataLabel(kpi.displayPayload, 'Value'))}</p><strong>${escapeHtml(kpi.name)}</strong></div><div class="rep-card-grid">${cards}</div>`;
  } else if (displayType === 'leaderboard') {
    const rows = [...(kpi.displayPayload.items || [])].sort((a, b) => Number(b.value) - Number(a.value)).map((item, index) => `<div class="leaderboard-row"><b>${index + 1}</b><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong></div>`).join('');
    const labelHeader = kpi.displayPayload.headers?.label || 'Rank';
    const valueHeader = kpi.displayPayload.headers?.value || 'Value';
    card.innerHTML = `${header}<div class="structured-kpi-title"><p>Leaderboard · ${escapeHtml(valueHeader)}</p><strong>${escapeHtml(kpi.name)}</strong></div><div class="leaderboard-list"><div class="leaderboard-row leaderboard-head"><b>#</b><span>${escapeHtml(labelHeader)}</span><strong>${escapeHtml(valueHeader)}</strong></div>${rows}</div>`;
  } else if (displayType === 'trend') card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(pairedDataLabel(kpi.displayPayload, 'Trend'))}</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderTrendChart(kpi.displayPayload.items, kpi.displayFormat)}`;
  else if (displayType === 'category_bar') card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(pairedDataLabel(kpi.displayPayload, 'Category value'))}</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderCategoryBars(kpi.displayPayload.items, kpi.displayFormat)}`;
  else if (displayType === 'funnel' || displayType === 'pipeline') card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(pairedDataLabel(kpi.displayPayload, displayType === 'funnel' ? 'Conversion' : 'Pipeline'))}</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderFlow(kpi.displayPayload.items, kpi.displayFormat, displayType)}`;
  else if (displayType === 'activity_feed') card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(kpi.displayPayload.columns?.slice(0, 2).join(' · ') || 'Latest activity')}</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderActivityFeed(kpi.displayPayload)}`;
  else if (displayType === 'heatmap') card.innerHTML = `${header}<div class="structured-kpi-title"><p>Heatmap</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderHeatmap(kpi.displayPayload, kpi.displayFormat)}`;
  else {
    const columns = (kpi.displayPayload.columns || []).map((column) => `<th>${escapeHtml(column)}</th>`).join('');
    const rows = (kpi.displayPayload.rows || []).slice(0, 25).map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
    card.innerHTML = `${header}<div class="structured-kpi-title"><p>Data table</p><strong>${escapeHtml(kpi.name)}</strong></div><div class="structured-table-scroll"><table class="structured-table"><thead><tr>${columns}</tr></thead><tbody>${rows}</tbody></table></div>`;
  }
}

function renderBuilderAccuratePreview() {
  const target = document.querySelector('#builderAccuratePreview');
  if (!target) return;
  if (!builderPreview) {
    target.innerHTML = '<div class="builder-preview-empty"><span>▦</span><strong>Your finished card appears here</strong><small>Choose compatible Google Sheets cells to render real data.</small></div>';
    return;
  }
  const manualGoal = Number(document.querySelector('#kpiGoal').value);
  const comparison = builderPreview.comparison;
  const card = document.createElement('article');
  renderKpiCard(card, {
    id: editingKpiId || 'preview',
    name: kpiName.value.trim() || 'Untitled KPI',
    displayType: activeDisplayType,
    displayFormat: document.querySelector('#kpiFormat').value,
    periodGranularity: document.querySelector('#periodGranularity').value,
    displayPayload: builderPreview.displayPayload,
    value: builderPreview.value,
    goalValue: builderPreview.goalValue ?? (Number.isFinite(manualGoal) && document.querySelector('#kpiGoal').value !== '' ? manualGoal : null),
    comparisonValue: comparison?.value ?? null,
    comparisonDelta: comparison?.delta ?? null,
    comparisonSourceRange: comparison?.sourceRange ?? null,
    aggregation: scalarDisplayTypes.has(activeDisplayType) ? 'single_value' : 'sum',
    sourceRange: builderPreview.sourceRange,
    sheetTitle: builderPreview.sheet?.title || '',
    range: builderPreview.range,
    fetchedAt: builderPreview.fetchedAt,
    status: 'active'
  }, { interactive: false });
  target.replaceChildren(card);
}

function renderLiveKpis() {
  document.body.dataset.liveKpis = liveKpis.length ? 'true' : 'false';
  if (!liveKpis.length) {
    const canManageKpis = liveCapabilities.manageKpis !== false;
    const empty = document.createElement('section');
    empty.className = 'surface live-dashboard-empty';
    empty.innerHTML = `<span class="empty-axo">•ᴗ•</span><div><small>THIS WORKSPACE</small><h2>No KPIs yet</h2><p>${canManageKpis ? 'Connect Google Sheets, then add the first trusted KPI to this dashboard.' : 'No dashboard metrics have been published to this workspace yet.'}</p></div>${canManageKpis ? '<button class="button button-primary" type="button">＋ Add KPI</button>' : ''}`;
    empty.querySelector('button')?.addEventListener('click', (event) => openKpiBuilder('google', event.currentTarget));
    dashboardKpiGrid.replaceChildren(empty);
    document.querySelector('.dashboard-toolbar strong').textContent = liveWorkspaceName || 'Workspace dashboard';
    document.querySelector('.dashboard-toolbar small').textContent = '0 KPIs · nothing inherited from another workspace';
    liveDashboardLayout = normalizeDashboardLayout(liveDashboardLayout || {}, []);
    applyDashboardLayout(liveDashboardLayout);
    return;
  }
  const order = normalizeDashboardLayout(liveDashboardLayout || {}, liveKpis.map((kpi) => kpi.id)).kpiOrder;
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  const orderedKpis = [...liveKpis].sort((a, b) => (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  dashboardKpiGrid.replaceChildren(...orderedKpis.map((kpi) => {
    const card = document.createElement('article');
    renderKpiCard(card, kpi);
    if (!card.innerHTML) {
    const displayType = kpi.displayType || 'scorecard';
    const compositeScorecard = displayType === 'scorecard' && kpi.displayPayload?.layout === 'rep_metric_goal';
    const structured = Boolean(kpi.displayPayload) && !scalarDisplayTypes.has(displayType);
    card.className = `surface kpi-card kpi-card-${displayType}${structured ? ' kpi-card-structured' : ''}${compositeScorecard ? ' kpi-card-scorecard-detail' : ''}`;
    card.dataset.liveKpi = kpi.id;
    card.dataset.cardKey = kpi.id;
    const goalProgress = kpi.goalValue === null || kpi.goalValue === 0 ? null : Math.max(0, Math.min(100, (kpi.value / kpi.goalValue) * 100));
    const comparisonPercent = kpi.comparisonValue === null || kpi.comparisonValue === 0 ? null : (kpi.comparisonDelta / Math.abs(kpi.comparisonValue)) * 100;
    const comparisonText = kpi.comparisonValue === null ? '' : `${kpi.comparisonDelta >= 0 ? '+' : ''}${formatKpiValue(kpi.comparisonDelta, kpi.displayFormat)}${comparisonPercent === null ? '' : ` (${comparisonPercent >= 0 ? '+' : ''}${comparisonPercent.toFixed(1)}%)`} vs ${kpi.comparisonSourceRange}`;
    const contextText = comparisonText || (goalProgress === null ? (kpi.status === 'active' ? 'Live' : 'Needs attention') : `${goalProgress.toFixed(1)}% of ${formatKpiValue(kpi.goalValue, kpi.displayFormat)} goal`);
    const header = `<header class="structured-kpi-head"><span class="source-mark google">G</span><small>Google Sheets · ${escapeHtml(kpi.sourceRange || `${kpi.sheetTitle}!${kpi.range}`)}</small><span class="kpi-card-actions"><button type="button" data-edit-live-kpi="${escapeHtml(kpi.id)}" aria-label="Edit ${escapeHtml(kpi.name)}" title="Edit KPI">✎</button><button type="button" data-sync-live-kpi="${escapeHtml(kpi.id)}" aria-label="Refresh ${escapeHtml(kpi.name)}" title="Refresh KPI">↻</button><button class="kpi-delete-button" type="button" data-delete-live-kpi="${escapeHtml(kpi.id)}" aria-label="Delete ${escapeHtml(kpi.name)}" title="Delete KPI">×</button></span></header>`;
    if (displayType === 'goal_pace') {
      const target = Number(kpi.goalValue);
      const hasGoal = Number.isFinite(target) && target !== 0;
      const progress = hasGoal ? clampPercent((Number(kpi.value) / target) * 100) : 0;
      const remaining = hasGoal ? Math.max(0, target - Number(kpi.value)) : null;
      card.innerHTML = `${header}<p>${escapeHtml(kpi.name)}</p><strong>${escapeHtml(formatKpiValue(kpi.value, kpi.displayFormat))}</strong><div class="goal-pace-copy"><span>${hasGoal ? `${progress.toFixed(1)}% complete` : 'Add a goal to calculate pace'}</span><b>${remaining === null ? 'Target needed' : `${formatKpiValue(remaining, kpi.displayFormat)} remaining`}</b></div><div class="goal-pace-track"><i style="width:${progress}%"></i><em style="left:${progress}%"></em></div><footer><span>${escapeHtml(timeAgo(kpi.fetchedAt))}</span><b>${hasGoal && progress >= 100 ? 'Goal reached' : 'In progress'}</b></footer>`;
    } else if (displayType === 'gauge') {
      const value = Number(kpi.value);
      const configuredMax = Number(kpi.goalValue);
      const maximum = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : Math.max(10, 10 ** Math.ceil(Math.log10(Math.max(1, Math.abs(value)))));
      const progress = clampPercent((value / maximum) * 100);
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>Gauge · 0 to ${escapeHtml(formatKpiValue(maximum, kpi.displayFormat))}</p><strong>${escapeHtml(kpi.name)}</strong></div><div class="gauge-dial" style="--gauge-turn:${(progress / 100).toFixed(4)}turn"><div><strong>${escapeHtml(formatKpiValue(value, kpi.displayFormat))}</strong><span>${progress.toFixed(1)}%</span></div></div><footer><span>${escapeHtml(timeAgo(kpi.fetchedAt))}</span><b>${Number.isFinite(configuredMax) && configuredMax > 0 ? 'Goal range' : 'Auto range'}</b></footer>`;
    } else if (compositeScorecard) {
      const payload = kpi.displayPayload;
      const progress = payload.goal.value === 0 ? null : clampPercent((payload.metric.value / payload.goal.value) * 100);
      card.innerHTML = `${header}<div class="scorecard-rep"><small>${escapeHtml(payload.rep.label)}</small><strong>${escapeHtml(payload.rep.value)}</strong></div><div class="scorecard-metric"><p>${escapeHtml(payload.metric.label === 'Metric' ? kpi.name : payload.metric.label)}</p><strong>${escapeHtml(formatKpiValue(payload.metric.value, kpi.displayFormat))}</strong></div><div class="scorecard-goal"><span><small>${escapeHtml(payload.goal.label)}</small><b>${escapeHtml(formatKpiValue(payload.goal.value, kpi.displayFormat))}</b></span><em>${progress === null ? 'Goal progress unavailable' : `${progress.toFixed(1)}% of goal`}</em></div><div class="goal-pace-track"><i style="width:${progress ?? 0}%"></i><em style="left:${progress ?? 0}%"></em></div><footer><span>${escapeHtml(timeAgo(kpi.fetchedAt))}</span><b>Live rep scorecard</b></footer>`;
    } else if (!structured) {
      card.innerHTML = `${header}<p>${escapeHtml(kpi.name)}</p><strong>${escapeHtml(formatKpiValue(kpi.value, kpi.displayFormat))}</strong><div class="kpi-change ${kpi.status === 'active' ? 'positive' : 'neutral'}">● ${escapeHtml(contextText)} <span>${escapeHtml(timeAgo(kpi.fetchedAt))}</span></div><div class="mini-progress"><i style="width:${goalProgress === null ? (kpi.status === 'active' ? '100' : '20') : goalProgress}%"></i></div><footer><span>${escapeHtml(kpi.aggregation.replaceAll('_', ' '))} · read only</span><b>${escapeHtml(kpi.status)}</b></footer>`;
    } else if (kpi.displayType === 'rep_cards') {
      const period = periodLabels[kpi.periodGranularity] || 'Monthly';
      const cards = (kpi.displayPayload.items || []).map((item) => {
        const target = item.comparisonValue ?? kpi.goalValue;
        const progress = !target ? null : Math.max(0, Math.min(100, (Number(item.value) / Number(target)) * 100));
        return `<article class="period-rep-card"><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong><span>${progress === null ? `${period} value` : `${progress.toFixed(0)}% of ${formatKpiValue(target, kpi.displayFormat)}`}</span><i><b style="width:${progress ?? 100}%"></b></i></article>`;
      }).join('');
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(period)} · ${escapeHtml(pairedDataLabel(kpi.displayPayload, 'Value'))}</p><strong>${escapeHtml(kpi.name)}</strong></div><div class="rep-card-grid">${cards}</div>`;
    } else if (kpi.displayType === 'leaderboard') {
      const rows = [...(kpi.displayPayload.items || [])].sort((a, b) => Number(b.value) - Number(a.value)).map((item, index) => `<div class="leaderboard-row"><b>${index + 1}</b><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong></div>`).join('');
      const labelHeader = kpi.displayPayload.headers?.label || 'Rank';
      const valueHeader = kpi.displayPayload.headers?.value || 'Value';
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>Leaderboard · ${escapeHtml(valueHeader)}</p><strong>${escapeHtml(kpi.name)}</strong></div><div class="leaderboard-list"><div class="leaderboard-row leaderboard-head"><b>#</b><span>${escapeHtml(labelHeader)}</span><strong>${escapeHtml(valueHeader)}</strong></div>${rows}</div>`;
    } else if (displayType === 'trend') {
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(pairedDataLabel(kpi.displayPayload, 'Trend'))}</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderTrendChart(kpi.displayPayload.items, kpi.displayFormat)}`;
    } else if (displayType === 'category_bar') {
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(pairedDataLabel(kpi.displayPayload, 'Category value'))}</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderCategoryBars(kpi.displayPayload.items, kpi.displayFormat)}`;
    } else if (displayType === 'funnel' || displayType === 'pipeline') {
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(pairedDataLabel(kpi.displayPayload, displayType === 'funnel' ? 'Conversion' : 'Pipeline'))}</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderFlow(kpi.displayPayload.items, kpi.displayFormat, displayType)}`;
    } else if (displayType === 'activity_feed') {
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>${escapeHtml(kpi.displayPayload.columns?.slice(0, 2).join(' · ') || 'Latest activity')}</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderActivityFeed(kpi.displayPayload)}`;
    } else if (displayType === 'heatmap') {
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>Heatmap</p><strong>${escapeHtml(kpi.name)}</strong></div>${renderHeatmap(kpi.displayPayload, kpi.displayFormat)}`;
    } else {
      const columns = (kpi.displayPayload.columns || []).map((column) => `<th>${escapeHtml(column)}</th>`).join('');
      const rows = (kpi.displayPayload.rows || []).slice(0, 25).map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
      card.innerHTML = `${header}<div class="structured-kpi-title"><p>Data table</p><strong>${escapeHtml(kpi.name)}</strong></div><div class="structured-table-scroll"><table class="structured-table"><thead><tr>${columns}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    }
    card.dataset.liveKpi = kpi.id;
    card.dataset.cardKey = kpi.id;
    const trustButton = card.querySelector('[data-live-trust]');
    if (trustButton) {
      trustButton.dataset.interactionStatus = 'working';
      trustButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openLiveMetricTrust(kpi.id, trustButton).catch((error) => showToast('Trust details unavailable', error.message));
      });
    }
    const refresh = card.querySelector('[data-sync-live-kpi]');
    if (refresh) {
      refresh.dataset.interactionStatus = 'working';
      refresh.addEventListener('click', async (event) => {
        event.stopPropagation();
        refresh.disabled = true;
        try {
          await apiJson(`/api/axoboard/kpis/${encodeURIComponent(kpi.id)}/sync`, { method: 'POST' });
          await loadLiveData();
          showToast('KPI refreshed', `${kpi.name} now shows the latest Google Sheets value.`);
        } catch (error) { showToast('Refresh failed', error.message); }
        finally { refresh.disabled = false; }
      });
    }
    const editButton = card.querySelector('[data-edit-live-kpi]');
    if (editButton) {
      editButton.dataset.interactionStatus = 'working';
      editButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openKpiBuilder('google', editButton, kpi);
      });
    }
    const automationBadge = card.querySelector('[data-open-kpi-automations]');
    if (automationBadge) automationBadge.addEventListener('click', (event) => {
      event.stopPropagation();
      showScreen('automations');
      switchAutomationTab('rules');
      document.querySelector('#automationMetricFilter').value = automationBadge.dataset.openKpiAutomations;
      renderAutomationRules();
      document.querySelector('#automationMetricFilter').focus();
    });
    const deleteButton = card.querySelector('[data-delete-live-kpi]');
    if (deleteButton) {
      deleteButton.dataset.interactionStatus = 'working';
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteLiveKpi(kpi.id, deleteButton);
      });
    }
    return card;
  }));
  liveDashboardLayout = normalizeDashboardLayout(liveDashboardLayout || {}, liveKpis.map((kpi) => kpi.id));
  applyDashboardLayout(liveDashboardLayout);
  document.querySelector('.dashboard-toolbar strong').textContent = liveWorkspaceName ? `${liveWorkspaceName} dashboard` : 'Google Sheets performance';
  document.querySelector('.dashboard-toolbar small').textContent = `${liveKpis.length} KPI${liveKpis.length === 1 ? '' : 's'} · latest ${timeAgo(liveKpis[0]?.fetchedAt)}`;
}

async function deleteLiveKpi(kpiId, trigger) {
  const kpi = liveKpis.find((item) => item.id === kpiId);
  if (!kpi) return;
  if (!window.confirm(`Delete “${kpi.name}” from ${liveWorkspaceName || 'this workspace'}?\n\nIts historical snapshots stay retained for audit and recovery.`)) return;
  trigger.disabled = true;
  try {
    await apiJson(`/api/axoboard/kpis/${encodeURIComponent(kpiId)}`, { method: 'DELETE' });
    liveKpis = liveKpis.filter((item) => item.id !== kpiId);
    liveDashboardLayout = normalizeDashboardLayout(liveDashboardLayout || {}, liveKpis.map((item) => item.id));
    if (layoutDraft) {
      layoutDraft = cloneDashboardLayout(liveDashboardLayout);
      renderLayoutOrder();
      syncLayoutWorkflowPreview();
    }
    renderLiveKpis();
    renderTvMode();
    showToast('KPI deleted', `${kpi.name} was removed only from ${liveWorkspaceName || 'this workspace'}.`);
  } catch (error) {
    trigger.disabled = false;
    if (error.code === 'kpi_has_linked_automations') {
      showToast('KPI has linked automations', `${error.message} Open Automations, archive every rule linked to this KPI, then retry deletion.`);
    } else showToast('Could not delete KPI', error.message);
  }
}

function renderLiveConnections() {
  activeGoogleConnection = liveConnections.find((connection) => connection.provider === 'google_sheets') || null;
  document.body.dataset.liveIntegrations = activeGoogleConnection ? 'true' : 'false';
  document.querySelector('#googleConnectionLabel').textContent = activeGoogleConnection ? `✓ ${activeGoogleConnection.accountEmail}` : 'Connection required';
  const connectionCard = document.querySelector('#googleConnectionCard');
  connectionCard.classList.toggle('is-connected', Boolean(activeGoogleConnection));
  if (!activeGoogleConnection) {
    document.querySelector('#liveConnectionCount').textContent = '0';
    document.querySelector('#liveKpiCount').textContent = '0';
    document.querySelector('#liveLastRefresh').textContent = '—';
    document.querySelector('#liveSyncStatus').textContent = 'Setup';
    document.querySelector('#googleConnectionAccount').textContent = 'No account connected';
    document.querySelector('#googleConnectionMappings').textContent = '0 KPIs';
    document.querySelector('#googleConnectionStatus').textContent = '○ Not connected';
    document.querySelector('#googleHealthDetail').textContent = 'Connect Google Sheets to report health';
    document.querySelector('#googleHealthMark').textContent = '—';
    document.querySelector('#googleHealthBadge').textContent = 'Setup';
    connectionCard.querySelector('.connect-source').textContent = 'Connect';
    connectionCard.querySelector('.build-source-kpi').disabled = true;
    return;
  }
  connectionCard.querySelector('.connect-source').textContent = 'Reconnect';
  connectionCard.querySelector('.build-source-kpi').disabled = false;
  const canBrowseSpreadsheets = activeGoogleConnection.scopes?.includes(googleDriveMetadataScope);
  const activeKpis = liveKpis.filter((kpi) => kpi.connectionId === activeGoogleConnection.id);
  document.querySelector('#liveConnectionCount').textContent = String(liveConnections.length);
  document.querySelector('#liveKpiCount').textContent = String(activeKpis.length);
  document.querySelector('#liveLastRefresh').textContent = timeAgo(activeGoogleConnection.lastSyncAt || activeKpis[0]?.fetchedAt);
  document.querySelector('#liveSyncStatus').textContent = activeGoogleConnection.status === 'healthy' ? 'Healthy' : 'Attention';
  document.querySelector('#googleConnectionAccount').textContent = activeGoogleConnection.accountEmail;
  document.querySelector('#googleConnectionMappings').textContent = `${activeKpis.length} KPI${activeKpis.length === 1 ? '' : 's'}`;
  document.querySelector('#googleConnectionStatus').textContent = activeGoogleConnection.status === 'healthy' && canBrowseSpreadsheets ? '● Connected' : '● Reconnect';
  document.querySelector('#googleHealthDetail').textContent = activeGoogleConnection.lastSyncAt ? `Last sync ${timeAgo(activeGoogleConnection.lastSyncAt)} · encrypted token` : 'Connected · waiting for first KPI';
  document.querySelector('#googleHealthMark').textContent = activeGoogleConnection.status === 'healthy' ? '✓' : '!';
  document.querySelector('#googleHealthBadge').textContent = activeGoogleConnection.status === 'healthy' ? '● Live' : '● Attention';
}

function renderLiveEngagement() {
  const summaryValues = document.querySelectorAll('.trust-summary dd');
  if (summaryValues.length >= 3) {
    summaryValues[0].textContent = String(liveEngagement.summary?.certified || 0);
    summaryValues[1].textContent = String(liveEngagement.summary?.stale || 0);
    summaryValues[2].textContent = timeAgo(liveEngagement.summary?.latestVerifiedAt);
  }
  if (liveBrand) {
    workspaceName.value = liveBrand.name || liveWorkspaceName;
    if (liveBrand.tokens?.primary) brandColor.value = liveBrand.tokens.primary;
    syncBrandPreview();
    document.querySelector('#tvPreviewModal')?.style.setProperty('--customer-primary', liveBrand.tokens?.primary || brandColor.value);
  }
  const events = liveEngagement.events || [];
  const ledger = document.querySelector('.event-ledger-table');
  if (ledger) {
    ledger.querySelectorAll('.event-ledger-row:not(.event-ledger-head)').forEach((row) => row.remove());
    if (!events.length) {
      const empty = document.createElement('div');
      empty.className = 'event-ledger-row';
      empty.innerHTML = '<span><b>No events yet</b><small>Waiting for a certified milestone</small></span><span><b>—</b><small>Refresh a goal-backed metric</small></span><span><i class="ledger-status held">Ready</i></span><span><b>Preview only</b></span><span><b>Published brand</b></span><button type="button" disabled>Inspect</button>';
      ledger.append(empty);
    } else events.forEach((event) => {
      const row = document.createElement('div');
      row.className = 'event-ledger-row';
      const milestone = event.payload?.milestone ? `${event.payload.milestone}% milestone` : event.type;
      row.innerHTML = `<span><b>${escapeHtml(new Date(event.occurredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</b><small>${escapeHtml(event.id.slice(0, 12))}…</small></span><span><b>${escapeHtml(event.type)}</b><small>${escapeHtml(event.metricName || milestone)}</small></span><span><i class="ledger-status delivered">Recorded</i><small>${escapeHtml(event.delivery.status)}</small></span><span><b>Preview ledger</b><small>No external delivery</small></span><span><b>${escapeHtml(liveBrand?.name || liveWorkspaceName)} v${escapeHtml(event.brandVersion)}</b><small>Customer-facing</small></span><button type="button">Inspect</button>`;
      row.querySelector('button').addEventListener('click', () => showToast('Immutable milestone event', `${event.idempotencyKey} · rule v${event.ruleVersion}`));
      ledger.append(row);
    });
  }
  const ledgerStats = document.querySelectorAll('.ledger-summary strong');
  if (ledgerStats.length >= 4) {
    ledgerStats[0].textContent = String(events.length);
    ledgerStats[1].textContent = String(events.filter((event) => event.delivery.status === 'pending').length);
    ledgerStats[2].textContent = '—';
    ledgerStats[3].textContent = '—';
  }
}

function displayKpiOptions(container, selectedIds = []) {
  const selected = new Set(selectedIds);
  container.replaceChildren(...liveKpis.map((kpi) => {
    const label = document.createElement('label');
    label.innerHTML = `<input type="checkbox" value="${escapeHtml(kpi.id)}" ${selected.has(kpi.id) ? 'checked' : ''}/><span>${escapeHtml(kpi.name)}</span>`;
    return label;
  }));
  if (!liveKpis.length) container.innerHTML = '<small>Add a KPI before assigning selected content.</small>';
}

function selectedDisplayKpis(container) {
  return [...container.querySelectorAll('input:checked')].map((input) => input.value);
}

function renderLiveDisplays() {
  const grid = document.querySelector('#liveDisplayGrid');
  if (!grid) return;
  const online = liveDisplays.filter((display) => display.online).length;
  const summary = document.querySelector('.display-summary');
  if (summary) {
    summary.querySelector('strong').textContent = `${online} screen${online === 1 ? '' : 's'} online`;
    summary.querySelector('small').textContent = liveDisplays.length ? `${liveDisplays.length} paired or pending` : 'Create the first pairing code';
    const count = summary.querySelector('div:nth-child(2) b');
    if (count) count.textContent = String(liveDisplays.filter((display) => display.status === 'active').length);
  }
  if (!liveDisplays.length) {
    grid.innerHTML = '<article class="surface screen-device" data-live-display><div class="device-preview"><span>TV</span></div><div class="device-copy"><span class="connection-pill is-pending">○ Not paired</span><h3>Your first display</h3><p>Create a one-time code, then enter it at tv.axoboard.io.</p></div><footer><button type="button" data-create-first-display>Pair a screen</button></footer></article>';
    grid.querySelector('button').addEventListener('click', openDisplayPairing);
    return;
  }
  grid.replaceChildren(...liveDisplays.map((display) => {
    const article = document.createElement('article');
    article.className = `surface screen-device ${display.online ? 'is-online' : ''}`;
    article.dataset.liveDisplay = display.id;
    const statusClass = display.status === 'pending' ? 'is-pending' : display.online ? '' : 'is-offline';
    const statusText = display.status === 'pending' ? '○ Waiting for code' : display.online ? '● Online' : '○ Offline';
    const assignment = display.contentMode === 'selected_kpis' ? `${display.kpiIds.length} selected KPI${display.kpiIds.length === 1 ? '' : 's'}` : 'Entire dashboard';
    article.innerHTML = `<div class="device-preview"><span>${escapeHtml((display.name || 'TV').slice(0,2).toUpperCase())}</span><i></i><i></i><i></i></div><div class="device-copy"><span class="connection-pill ${statusClass}">${statusText}</span><h3>${escapeHtml(display.name)}</h3><p>${escapeHtml(assignment)} · ${display.rotationSeconds}s rotation</p><dl><div><dt>Brand package</dt><dd>${escapeHtml(liveBrand?.name || liveWorkspaceName)} v${escapeHtml(liveBrand?.version || 1)}</dd></div><div><dt>Last heartbeat</dt><dd>${display.lastHeartbeatAt ? timeAgo(display.lastHeartbeatAt) : 'Not paired yet'}</dd></div><div><dt>Persistent session</dt><dd>${display.status === 'active' ? 'Active · revocable' : 'Waiting for TV'}</dd></div></dl></div><footer><button type="button">Manage screen</button></footer>`;
    article.querySelector('button').addEventListener('click', () => openDisplayEditor(display));
    return article;
  }));
}

function openDisplayPairing() {
  document.querySelector('#displayPairingForm').reset();
  document.querySelector('#displayName').value = 'Sales floor TV';
  document.querySelector('#displayPairingResult').hidden = true;
  document.querySelector('#createDisplayPairing').hidden = false;
  document.querySelector('#displayKpiSelection').hidden = true;
  displayKpiOptions(document.querySelector('#displayKpiOptions'));
  openFeatureModal('displayPairingModal', document.querySelector('#pairScreenButton'));
}

function openDisplayEditor(display) {
  document.querySelector('#displayEditorId').value = display.id;
  document.querySelector('#displayEditorName').value = display.name;
  document.querySelector('#displayEditorMode').value = display.contentMode;
  document.querySelector('#displayEditorRotation').value = String(display.rotationSeconds);
  displayKpiOptions(document.querySelector('#displayEditorKpiOptions'), display.kpiIds);
  document.querySelector('#displayEditorKpiSelection').hidden = display.contentMode !== 'selected_kpis';
  openFeatureModal('displayEditorModal', document.querySelector(`[data-live-display="${display.id}"] button`));
}

function automationMetricIdForKpi(kpi) {
  return kpi?.metricId || kpi?.certification?.metricId || '';
}

function automationEditableVersion(rule) {
  return rule?.draftVersion || rule?.publishedVersion || rule || {};
}

function automationEffectiveVersion(rule) {
  const state = automationRuleState(rule);
  if (['active', 'paused', 'degraded'].includes(state) && rule?.publishedVersion) return rule.publishedVersion;
  return rule?.draftVersion || rule?.publishedVersion || rule || {};
}

function automationRuleActions(rule) {
  if (Array.isArray(rule?.actions)) return rule.actions;
  const version = automationEditableVersion(rule);
  return Array.isArray(version?.actions) ? version.actions : [];
}

function automationRuleState(rule) {
  return String(rule?.state || (rule?.publishedVersion ? 'active' : 'draft')).toLowerCase();
}

function automationRuleMetricId(rule) {
  return rule?.metric?.id || rule?.metricId || automationEffectiveVersion(rule)?.metricId || '';
}

function automationRulesForMetric(metricId) {
  if (!metricId || !automationsLoaded) return [];
  return liveAutomationRules.filter((rule) => automationRuleMetricId(rule) === metricId);
}

function isStructuredAutomationKpi(kpi) {
  return Boolean(kpi && (structuredAutomationTypes.has(kpi.displayType) || kpi.displayPayload?.layout === 'rep_metric_goal'));
}

function certifiedScalarKpis() {
  return liveKpis.filter((kpi) => automationMetricIdForKpi(kpi) && kpi.certification?.status === 'certified' && !isStructuredAutomationKpi(kpi));
}

function setAutomationApiState(element, state, title, detail) {
  if (!element) return;
  element.hidden = false;
  element.dataset.state = state;
  element.setAttribute('aria-busy', String(state === 'loading'));
  element.querySelector('strong').textContent = title;
  element.querySelector('p').textContent = detail;
}

function clearAutomationApiState(element) {
  if (!element) return;
  element.hidden = true;
  element.setAttribute('aria-busy', 'false');
}

function automationOperatorSymbol(operator) {
  return ({ gte: '≥', gt: '>', lte: '≤', lt: '<', eq: '=' })[operator] || operator || '—';
}

function automationThresholdText(trigger = {}) {
  const threshold = Number(trigger.thresholdValue);
  const value = Number.isFinite(threshold) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(threshold) : '—';
  return trigger.thresholdMode === 'goal_percent' ? `${value}% of goal` : value;
}

function automationDecisionLabel(run) {
  if (!run) return 'Never evaluated';
  const status = String(run.status || 'recorded').replaceAll('_', ' ');
  return `${status} · ${timeAgo(run.occurredAt || run.completedAt)}`;
}

function populateAutomationMetricSelect(select, { includeAll = false, selected = '' } = {}) {
  if (!select) return;
  const previous = selected || select.value;
  const options = [];
  if (includeAll) options.push(new Option('All certified metrics', ''));
  else options.push(new Option('Choose a certified scalar metric', ''));
  certifiedScalarKpis().forEach((kpi) => options.push(new Option(kpi.name, automationMetricIdForKpi(kpi))));
  select.replaceChildren(...options);
  if ([...select.options].some((option) => option.value === previous)) select.value = previous;
}

function applyAutomationPermissions() {
  const createButton = document.querySelector('#newAutomationButton');
  if (createButton) {
    createButton.disabled = !automationPermissions.canEdit;
    createButton.title = automationPermissions.canEdit ? '' : 'Your workspace role cannot create automation drafts.';
  }
  const kpiCreate = document.querySelector('#createKpiAutomation');
  if (kpiCreate) kpiCreate.disabled = !automationPermissions.canEdit || isStructuredAutomationKpi(automationEditorKpi);
}

function renderAutomationRuleFilters() {
  const metricFilter = document.querySelector('#automationMetricFilter');
  const runRuleFilter = document.querySelector('#automationRunRuleFilter');
  populateAutomationMetricSelect(metricFilter, { includeAll: true });
  const selectedRule = runRuleFilter.value;
  runRuleFilter.replaceChildren(new Option('All rules', ''), ...liveAutomationRules.map((rule) => new Option(rule.name, rule.id)));
  if ([...runRuleFilter.options].some((option) => option.value === selectedRule)) runRuleFilter.value = selectedRule;
}

function renderAutomationRules() {
  const list = document.querySelector('#automationRuleList');
  const state = document.querySelector('#automationRulesState');
  if (!list || !state) return;
  const counts = {
    active: liveAutomationRules.filter((rule) => automationRuleState(rule) === 'active').length,
    draft: liveAutomationRules.filter((rule) => automationRuleState(rule) === 'draft').length,
    paused: liveAutomationRules.filter((rule) => automationRuleState(rule) === 'paused').length,
    attention: liveAutomationRules.filter((rule) => automationRuleState(rule) === 'degraded' || ['failed', 'dead_letter'].includes(rule.lastRun?.status)).length
  };
  document.querySelector('#automationActiveCount').textContent = automationsLoaded ? String(counts.active) : '—';
  document.querySelector('#automationDraftCount').textContent = automationsLoaded ? String(counts.draft) : '—';
  document.querySelector('#automationPausedCount').textContent = automationsLoaded ? String(counts.paused) : '—';
  document.querySelector('#automationAttentionCount').textContent = automationsLoaded ? String(counts.attention) : '—';
  renderAutomationRuleFilters();
  applyAutomationPermissions();
  if (automationRulesError) {
    list.replaceChildren();
    setAutomationApiState(state, 'error', 'Automation rules could not be loaded', automationRulesError);
    return;
  }
  if (!automationsLoaded) {
    list.replaceChildren();
    setAutomationApiState(state, 'loading', 'Loading automation rules…', 'Reading this workspace’s published and draft versions.');
    return;
  }
  const query = document.querySelector('#automationRuleSearch').value.trim().toLowerCase();
  const status = document.querySelector('#automationRuleStatusFilter').value;
  const metricId = document.querySelector('#automationMetricFilter').value;
  const rules = liveAutomationRules.filter((rule) => {
    const searchable = `${rule.name || ''} ${rule.metric?.name || ''}`.toLowerCase();
    return (!query || searchable.includes(query)) && (!status || automationRuleState(rule) === status) && (!metricId || automationRuleMetricId(rule) === metricId);
  });
  if (!liveAutomationRules.length) {
    list.replaceChildren();
    setAutomationApiState(state, 'empty', 'No automation rules yet', automationPermissions.canEdit ? 'Create a draft from a certified scalar KPI. Nothing runs until an authorized publisher activates it.' : 'No rules are visible in this workspace.');
    return;
  }
  if (!rules.length) {
    list.replaceChildren();
    setAutomationApiState(state, 'empty', 'No rules match these filters', 'Clear a filter to see the rest of this workspace’s rules.');
    return;
  }
  clearAutomationApiState(state);
  list.replaceChildren(...rules.map((rule) => {
    const article = document.createElement('article');
    const version = automationEffectiveVersion(rule);
    const trigger = version.trigger || {};
    const stateName = automationRuleState(rule);
    const lastRun = rule.lastRun || null;
    const warning = stateName === 'degraded' || ['failed', 'dead_letter'].includes(lastRun?.status);
    const stateCopy = stateName.replaceAll('_', ' ');
    const duration = Number(trigger.durationSeconds) > 0 ? ` for ${Math.round(Number(trigger.durationSeconds) / 60)}m` : '';
    const canToggle = automationPermissions.canPublish && ['active', 'paused', 'degraded'].includes(stateName);
    const toggleAction = stateName === 'active' ? 'pause' : 'resume';
    const canEditRule = automationPermissions.canEdit && stateName !== 'archived';
    const canArchive = automationPermissions.canPublish && stateName !== 'archived';
    const stateControl = canToggle ? `<button type="button" data-rule-state-action="${toggleAction}" data-rule-id="${escapeHtml(rule.id)}" data-interaction-status="working">${toggleAction === 'pause' ? 'Pause' : 'Resume'}</button>` : '';
    const editControl = canEditRule ? `<button type="button" data-edit-automation="${escapeHtml(rule.id)}" data-interaction-status="working">Edit rule</button>` : (!automationPermissions.canEdit ? '<span class="read-only-label">Read only</span>' : '');
    const archiveControl = canArchive ? `<button class="archive-rule-button" type="button" data-archive-automation="${escapeHtml(rule.id)}" data-rule-name="${escapeHtml(rule.name || 'Untitled automation')}" data-interaction-status="working">Archive</button>` : '';
    article.className = `surface rule-card automation-rule-card${warning ? ' has-warning' : ''}`;
    article.dataset.rule = rule.id;
    article.innerHTML = `<header><span class="rule-icon ${warning ? 'warning' : 'goal'}">${warning ? '!' : 'ϟ'}</span><div><h3>${escapeHtml(rule.name || 'Untitled automation')}</h3><p>${escapeHtml(rule.metric?.name || 'Certified metric')} · version ${escapeHtml(version.version || version.revision || 'draft')}</p></div><span class="automation-status-badge status-${escapeHtml(stateName)}">${escapeHtml(stateCopy)}</span></header><div class="rule-flow"><div><small>WHEN</small><strong>${escapeHtml(rule.metric?.name || 'Certified metric')} ${escapeHtml(automationOperatorSymbol(trigger.operator))} ${escapeHtml(automationThresholdText(trigger))}${escapeHtml(duration)}</strong></div><i>→</i><div><small>THEN</small><span class="action-chip celebration">▣ TV celebration</span><span class="automation-action-count">${Number(rule.actionCount || version.actions?.length || 0)} action${Number(rule.actionCount || version.actions?.length || 0) === 1 ? '' : 's'}</span></div></div><footer><span><strong>${escapeHtml(automationDecisionLabel(lastRun))}</strong>${lastRun?.reason ? `<small>${escapeHtml(lastRun.reason)}</small>` : ''}</span><div>${stateControl}${editControl}${archiveControl}</div></footer>`;
    return article;
  }));
  list.querySelectorAll('[data-edit-automation]').forEach((button) => button.addEventListener('click', () => {
    const rule = liveAutomationRules.find((item) => item.id === button.dataset.editAutomation);
    openAutomationEditor({ rule, trigger: button }).catch((error) => showToast('Rule editor unavailable', error.message));
  }));
  list.querySelectorAll('[data-rule-state-action]').forEach((button) => button.addEventListener('click', () => changeAutomationState(button.dataset.ruleId, button.dataset.ruleStateAction, button)));
  list.querySelectorAll('[data-archive-automation]').forEach((button) => button.addEventListener('click', () => archiveAutomation(button)));
}

async function loadAutomationRules({ quiet = false } = {}) {
  const request = ++automationLoadRequest;
  if (!quiet) {
    automationsLoaded = false;
    automationRulesError = '';
    renderAutomationRules();
  }
  try {
    const payload = await apiJson('/api/axoboard/automations');
    if (request !== automationLoadRequest) return false;
    liveAutomationRules = Array.isArray(payload.automations) ? payload.automations : [];
    automationPermissions = { canRead: Boolean(payload.permissions?.canRead), canEdit: Boolean(payload.permissions?.canEdit), canPublish: Boolean(payload.permissions?.canPublish) };
    automationsLoaded = true;
    automationRulesError = '';
    renderAutomationRules();
    renderLiveKpis();
    if (activeBuilderStep === 4 && editingKpiId) renderKpiAutomationSurface();
    return true;
  } catch (error) {
    if (request !== automationLoadRequest) return false;
    liveAutomationRules = [];
    automationsLoaded = false;
    automationPermissions = { canRead: false, canEdit: false, canPublish: false };
    automationRulesError = error.message;
    renderAutomationRules();
    return false;
  }
}

function renderAutomationRuns() {
  const list = document.querySelector('#automationRunList');
  const state = document.querySelector('#automationRunsState');
  if (!list || !state) return;
  if (automationRunsError) {
    list.replaceChildren();
    setAutomationApiState(state, 'error', 'Run history could not be loaded', automationRunsError);
    return;
  }
  if (!liveAutomationRuns.length) {
    list.replaceChildren();
    setAutomationApiState(state, 'empty', 'No automation runs match this view', 'Runs appear after an active rule evaluates a future certified metric event. Dry runs remain separate.');
    return;
  }
  clearAutomationApiState(state);
  list.replaceChildren(...liveAutomationRuns.map((run) => {
    const article = document.createElement('article');
    const status = String(run.status || 'recorded').toLowerCase();
    const actions = Array.isArray(run.actions) ? run.actions : [];
    article.className = `surface automation-run-card status-${status.replace(/[^a-z0-9_-]/g, '')}`;
    article.dataset.runId = run.id;
    article.innerHTML = `<header><div><span class="automation-status-badge status-${escapeHtml(status)}">${escapeHtml(status.replaceAll('_', ' '))}</span><h3>${escapeHtml(run.automationName || 'Automation run')}</h3><p>${escapeHtml(run.reason || 'Evaluation recorded')} · ${escapeHtml(timeAgo(run.occurredAt || run.completedAt))}</p></div><strong>${run.triggerValue === null || run.triggerValue === undefined ? '—' : escapeHtml(new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(run.triggerValue)))}</strong></header><div class="automation-attempt-list">${actions.length ? actions.map((action) => {
      const actionStatus = String(action.status || 'recorded').toLowerCase();
      const actionId = action.actionId;
      const retryable = ['failed', 'dead_letter'].includes(actionStatus) && automationPermissions.canPublish && actionId;
      const persistedOnly = actionStatus === 'succeeded' && action.responseMetadata?.mode === 'persisted_only';
      const actionLabel = persistedOnly ? 'Published to TV feed' : String(action.type || 'internal_tv_celebration').replaceAll('_', ' ');
      const actionDetail = persistedOnly
        ? `Playback not acknowledged · ${action.attemptCount || 0} attempt${Number(action.attemptCount || 0) === 1 ? '' : 's'}`
        : action.error || action.errorCode || `${action.attemptCount || 0} attempt${Number(action.attemptCount || 0) === 1 ? '' : 's'}`;
      const actionStatusLabel = persistedOnly ? 'published' : actionStatus.replaceAll('_', ' ');
      return `<div><span aria-hidden="true">▣</span><span><strong>${escapeHtml(actionLabel)}</strong><small>${escapeHtml(actionDetail)}</small></span><b class="status-${escapeHtml(actionStatus)}">${escapeHtml(actionStatusLabel)}</b>${retryable ? `<button type="button" data-retry-run="${escapeHtml(run.id)}" data-retry-action="${escapeHtml(actionId)}" data-interaction-status="working">Retry action</button>` : ''}</div>`;
    }).join('') : '<p>No action attempts were created for this decision.</p>'}</div>`;
    return article;
  }));
  list.querySelectorAll('[data-retry-run]').forEach((button) => button.addEventListener('click', () => retryAutomationAction(button)));
}

async function loadAutomationRuns() {
  const request = ++automationRunsRequest;
  automationRunsError = '';
  liveAutomationRuns = [];
  setAutomationApiState(document.querySelector('#automationRunsState'), 'loading', 'Loading run history…', 'Reading evaluations, suppressions, deliveries, and retries.');
  const query = new URLSearchParams({ limit: '100' });
  const status = document.querySelector('#automationRunStatusFilter').value;
  const automationId = document.querySelector('#automationRunRuleFilter').value;
  if (status) query.set('status', status);
  if (automationId) query.set('automationId', automationId);
  try {
    const payload = await apiJson(`/api/axoboard/automation-runs?${query}`);
    if (request !== automationRunsRequest) return;
    liveAutomationRuns = Array.isArray(payload.runs) ? payload.runs : [];
    renderAutomationRuns();
  } catch (error) {
    if (request !== automationRunsRequest) return;
    automationRunsError = error.message;
    renderAutomationRuns();
  }
}

function switchAutomationTab(name, { focus = false } = {}) {
  const target = name === 'runs' ? 'runs' : 'rules';
  document.querySelectorAll('[data-automation-tab]').forEach((button) => {
    const active = button.dataset.automationTab === target;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  });
  document.querySelectorAll('[data-automation-panel]').forEach((panel) => { panel.hidden = panel.dataset.automationPanel !== target; });
  if (target === 'runs') loadAutomationRuns();
}

async function retryAutomationAction(button) {
  button.disabled = true;
  try {
    await apiJson(`/api/axoboard/automation-runs/${encodeURIComponent(button.dataset.retryRun)}/actions/${encodeURIComponent(button.dataset.retryAction)}/retry`, { method: 'POST', body: '{}' });
    showToast('Retry queued', 'Only the selected failed action will be attempted again.');
    await loadAutomationRuns();
  } catch (error) {
    showToast('Retry was not queued', error.message);
  } finally { button.disabled = false; }
}

async function changeAutomationState(ruleId, action, button) {
  if (!automationPermissions.canPublish || !['pause', 'resume'].includes(action)) return;
  button.disabled = true;
  try {
    await apiJson(`/api/axoboard/automations/${encodeURIComponent(ruleId)}/${action}`, { method: 'POST', body: '{}' });
    await loadAutomationRules({ quiet: true });
    showToast(action === 'pause' ? 'Automation paused' : 'Automation resumed', action === 'pause' ? 'Future events will be recorded without running this rule.' : 'The published version can evaluate future certified events again.');
  } catch (error) {
    if (action === 'resume' && error.code === 'republish_required') {
      showToast('Review and publish a new version', 'The linked metric contract changed. Edit this rule, review the new contract, and publish before resuming.');
    } else showToast(`Automation was not ${action === 'pause' ? 'paused' : 'resumed'}`, error.message);
  } finally { button.disabled = false; }
}

async function archiveAutomation(button) {
  if (!automationPermissions.canPublish) return;
  const ruleId = button.dataset.archiveAutomation;
  const ruleName = button.dataset.ruleName || 'this automation';
  const confirmed = window.confirm(`Archive “${ruleName}”?\n\nArchived rules stop evaluating future metric events. Existing versions, runs, and audit history remain available.`);
  if (!confirmed) return;
  button.disabled = true;
  try {
    await apiJson(`/api/axoboard/automations/${encodeURIComponent(ruleId)}/archive`, { method: 'POST', body: '{}' });
    await loadAutomationRules({ quiet: true });
    await loadAutomationRuns();
    showToast('Automation archived', `${ruleName} will not evaluate future metric events. Its run history was retained.`);
  } catch (error) {
    showToast('Automation was not archived', error.message);
    button.disabled = false;
  }
}

function resetAutomationEditor() {
  const form = document.querySelector('#automationRuleForm');
  form.reset();
  document.querySelector('#automationRuleId').value = '';
  document.querySelector('#automationRuleRevision').value = '';
  document.querySelector('#automationFreshnessSeconds').value = '900';
  document.querySelector('#automationCooldownSeconds').value = '3600';
  document.querySelector('#automationMaxRunsPerDay').value = '10';
  document.querySelector('#automationTimezone').value = 'America/Denver';
  document.querySelector('#automationRequireFresh').checked = true;
  document.querySelector('#automationTvAction').checked = true;
  document.querySelector('#automationPublishConfirm').checked = false;
  document.querySelector('#automationQuietHoursFields').hidden = true;
  document.querySelector('#automationFormError').hidden = true;
  document.querySelector('#automationDryRunResult').innerHTML = '<strong>Not tested yet</strong><p>Save the draft, then run a no-side-effect evaluation.</p>';
  const metricSelect = document.querySelector('#automationMetricId');
  metricSelect.disabled = false;
  document.querySelector('#automationMetricBindingHelp').textContent = 'A published rule stays bound to this stable metric identity.';
  populateAutomationMetricSelect(metricSelect);
  activeAutomationRule = null;
  showAutomationEditorStep(1);
}

function selectedAutomationKpi() {
  const metricId = document.querySelector('#automationMetricId').value;
  const kpi = liveKpis.find((item) => automationMetricIdForKpi(item) === metricId);
  if (kpi) return kpi;
  if (activeAutomationRule && automationRuleMetricId(activeAutomationRule) === metricId) {
    return { name: activeAutomationRule.metric?.name || 'Bound metric', metricId, displayType: 'scorecard', certification: { status: 'certified' } };
  }
  return null;
}

function syncStructuredAutomationBoundary() {
  const kpi = selectedAutomationKpi();
  const field = document.querySelector('#automationScalarSelectorField');
  const blocked = isStructuredAutomationKpi(kpi);
  field.hidden = !blocked;
  document.querySelector('#automationScalarSelector').disabled = true;
  if (blocked) {
    field.querySelector('span').textContent = 'Structured-card automation unavailable';
    field.querySelector('small').textContent = 'This card contains multiple values, but the certified snapshot currently stores only one aggregate scalar. Create a separate scalar KPI for the item, stage, or field you want to automate.';
  }
}

function showAutomationEditorStep(step) {
  activeAutomationEditorStep = Math.max(1, Math.min(4, Number(step) || 1));
  document.querySelectorAll('[data-automation-editor-panel]').forEach((panel) => {
    const active = Number(panel.dataset.automationEditorPanel) === activeAutomationEditorStep;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  document.querySelectorAll('[data-automation-editor-step]').forEach((button) => {
    const active = Number(button.dataset.automationEditorStep) === activeAutomationEditorStep;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelector('#automationEditorBack').disabled = activeAutomationEditorStep === 1;
  document.querySelector('#automationEditorNext').textContent = activeAutomationEditorStep === 1 ? 'Action →' : activeAutomationEditorStep === 2 ? 'Guardrails →' : activeAutomationEditorStep === 3 ? 'Test & publish →' : 'Publish automation';
  if (activeAutomationEditorStep === 4) renderAutomationReview();
  document.querySelector('.automation-editor-body').scrollTop = 0;
}

function populateAutomationEditor(rule) {
  activeAutomationRule = rule;
  const version = automationEditableVersion(rule);
  const trigger = version.trigger || {};
  const guardrails = version.guardrails || {};
  document.querySelector('#automationRuleId').value = rule.id || '';
  document.querySelector('#automationRuleRevision').value = version.revision ?? '';
  document.querySelector('#automationRuleName').value = rule.name || '';
  const metricSelect = document.querySelector('#automationMetricId');
  const metricId = automationRuleMetricId(rule);
  populateAutomationMetricSelect(metricSelect, { selected: metricId });
  if (metricId && ![...metricSelect.options].some((option) => option.value === metricId)) metricSelect.add(new Option(`${rule.metric?.name || 'Bound metric'} · stable binding`, metricId));
  metricSelect.value = metricId;
  metricSelect.disabled = true;
  document.querySelector('#automationMetricBindingHelp').textContent = 'Stable binding · To watch a different metric, create a new automation.';
  document.querySelector('#automationOperator').value = trigger.operator || 'gte';
  document.querySelector('#automationThresholdMode').value = trigger.thresholdMode || 'absolute';
  document.querySelector('#automationThresholdValue').value = trigger.thresholdValue ?? '';
  document.querySelector(`[name="automationBehavior"][value="${trigger.behavior || 'edge'}"]`).checked = true;
  document.querySelector('#automationDurationSeconds').value = String(trigger.durationSeconds || 0);
  const actions = automationRuleActions(rule);
  document.querySelector('#automationTvAction').checked = actions.some((action) => action.type === 'internal_tv_celebration') || !actions.length;
  document.querySelector('#automationRequireFresh').checked = Number(guardrails.freshnessSeconds || 0) > 0;
  document.querySelector('#automationFreshnessSeconds').value = String(guardrails.freshnessSeconds || 900);
  document.querySelector('#automationCooldownSeconds').value = String(guardrails.cooldownSeconds || 0);
  document.querySelector('#automationMaxRunsPerDay').value = String(guardrails.maxRunsPerDay || 10);
  document.querySelector('#automationTimezone').value = guardrails.timezone || 'America/Denver';
  document.querySelector('#automationQuietHoursEnabled').checked = Boolean(guardrails.quietHours);
  document.querySelector('#automationQuietHoursFields').hidden = !guardrails.quietHours;
  document.querySelector('#automationQuietStart').value = guardrails.quietHours?.start || '20:00';
  document.querySelector('#automationQuietEnd').value = guardrails.quietHours?.end || '07:00';
  document.querySelector('#automationEditorTitle').textContent = `Edit ${rule.name || 'automation'}`;
  document.querySelector('#automationEditorStatus').textContent = `Editing ${automationRuleState(rule).replaceAll('_', ' ')} rule`;
  syncStructuredAutomationBoundary();
}

async function openAutomationEditor({ rule = null, kpi = null, trigger = document.activeElement } = {}) {
  if (!automationPermissions.canEdit) throw new Error('Your workspace role cannot create or edit automation drafts.');
  resetAutomationEditor();
  automationEditorKpi = kpi || null;
  document.querySelector('#automationEditorTitle').textContent = rule ? `Edit ${rule.name}` : 'Create automation';
  openFeatureModal('automationEditorModal', trigger);
  if (rule?.id) {
    document.querySelector('#automationEditorStatus').textContent = 'Loading the latest draft version…';
    try {
      const payload = await apiJson(`/api/axoboard/automations/${encodeURIComponent(rule.id)}`);
      populateAutomationEditor(payload.automation);
    } catch (error) {
      document.querySelector('#automationEditorStatus').textContent = 'Rule could not be loaded';
      showAutomationFormError(error.message);
      throw error;
    }
  } else {
    const metricId = automationMetricIdForKpi(kpi);
    if (metricId) {
      const metricSelect = document.querySelector('#automationMetricId');
      if ([...metricSelect.options].some((option) => option.value === metricId)) metricSelect.value = metricId;
      document.querySelector('#automationRuleName').value = kpi ? `${kpi.name} automation` : '';
    }
    syncStructuredAutomationBoundary();
    if (isStructuredAutomationKpi(kpi)) {
      showAutomationFormError('This structured card cannot be automated from its current aggregate snapshot. Create a certified scalar KPI for the exact item, stage, or field first.');
    }
  }
}

function showAutomationFormError(message) {
  const error = document.querySelector('#automationFormError');
  error.textContent = message;
  error.hidden = false;
  document.querySelector('#automationEditorStatus').textContent = 'Needs attention';
}

function clearAutomationFormError() {
  document.querySelector('#automationFormError').hidden = true;
}

function validateAutomationStep(step = activeAutomationEditorStep) {
  clearAutomationFormError();
  if (step === 1) {
    if (!document.querySelector('#automationRuleName').value.trim()) throw new Error('Enter a rule name.');
    const kpi = selectedAutomationKpi();
    if (!kpi) throw new Error('Choose a certified scalar metric.');
    if (isStructuredAutomationKpi(kpi)) throw new Error('Structured cards need a separate certified scalar KPI before they can be automated.');
    if (!Number.isFinite(Number(document.querySelector('#automationThresholdValue').value))) throw new Error('Enter a valid numeric threshold.');
  }
  if (step === 2 && !document.querySelector('#automationTvAction').checked) throw new Error('Select the supported internal TV celebration action.');
  if (step === 3) {
    const maxRuns = Number(document.querySelector('#automationMaxRunsPerDay').value);
    if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 100) throw new Error('Maximum daily runs must be a whole number from 1 to 100.');
    if (document.querySelector('#automationQuietHoursEnabled').checked && (!document.querySelector('#automationQuietStart').value || !document.querySelector('#automationQuietEnd').value)) throw new Error('Choose both quiet-hour times.');
  }
  return true;
}

function validateEntireAutomation() {
  [1, 2, 3].forEach((step) => validateAutomationStep(step));
  return true;
}

function automationDraftPayload() {
  const quietHoursEnabled = document.querySelector('#automationQuietHoursEnabled').checked;
  const requireFresh = document.querySelector('#automationRequireFresh').checked;
  const ruleName = document.querySelector('#automationRuleName').value.trim();
  const existingTvActions = automationRuleActions(activeAutomationRule).filter((action) => action.type === 'internal_tv_celebration');
  const actions = existingTvActions.length
    ? existingTvActions.map((action) => ({
        ...(action.id ? { id: action.id } : {}),
        type: action.type,
        ...(action.destinationId ? { destinationId: action.destinationId } : {}),
        config: { ...(action.config || {}) }
      }))
    : [{ type: 'internal_tv_celebration', config: { title: ruleName } }];
  return {
    name: ruleName,
    metricId: document.querySelector('#automationMetricId').value,
    trigger: {
      type: 'metric_threshold',
      operator: document.querySelector('#automationOperator').value,
      thresholdMode: document.querySelector('#automationThresholdMode').value,
      thresholdValue: Number(document.querySelector('#automationThresholdValue').value),
      behavior: document.querySelector('[name="automationBehavior"]:checked').value,
      durationSeconds: Number(document.querySelector('#automationDurationSeconds').value)
    },
    guardrails: {
      freshnessSeconds: requireFresh ? Number(document.querySelector('#automationFreshnessSeconds').value) : null,
      cooldownSeconds: Number(document.querySelector('#automationCooldownSeconds').value),
      maxRunsPerDay: Number(document.querySelector('#automationMaxRunsPerDay').value),
      quietHours: quietHoursEnabled ? { start: document.querySelector('#automationQuietStart').value, end: document.querySelector('#automationQuietEnd').value } : null,
      timezone: document.querySelector('#automationTimezone').value
    },
    actions
  };
}

function renderAutomationReview() {
  const payload = automationDraftPayload();
  const kpi = selectedAutomationKpi();
  const quiet = payload.guardrails.quietHours ? `${payload.guardrails.quietHours.start}–${payload.guardrails.quietHours.end} ${payload.guardrails.timezone}` : 'No quiet hours';
  document.querySelector('#automationReviewSummary').innerHTML = `<div><small>RULE</small><strong>${escapeHtml(payload.name || 'Untitled automation')}</strong></div><div><small>TRIGGER</small><strong>${escapeHtml(kpi?.name || 'Metric')} ${escapeHtml(automationOperatorSymbol(payload.trigger.operator))} ${escapeHtml(automationThresholdText(payload.trigger))}</strong></div><div><small>ACTION</small><strong>Internal TV celebration</strong></div><div><small>GUARDRAILS</small><strong>${escapeHtml(`${payload.guardrails.cooldownSeconds / 60}m cooldown · max ${payload.guardrails.maxRunsPerDay}/day · ${quiet}`)}</strong></div>`;
}

async function saveAutomationDraft({ announce = true } = {}) {
  validateEntireAutomation();
  const id = document.querySelector('#automationRuleId').value;
  const body = automationDraftPayload();
  const options = id
    ? { method: 'PATCH', body: JSON.stringify({ revision: Number(document.querySelector('#automationRuleRevision').value), ...body }) }
    : { method: 'POST', body: JSON.stringify(body) };
  document.querySelector('#automationEditorStatus').textContent = id ? 'Saving draft changes…' : 'Creating draft…';
  const payload = await apiJson(id ? `/api/axoboard/automations/${encodeURIComponent(id)}` : '/api/axoboard/automations', options);
  activeAutomationRule = payload.automation;
  const version = automationEditableVersion(payload.automation);
  document.querySelector('#automationRuleId').value = payload.automation.id;
  document.querySelector('#automationRuleRevision').value = version.revision ?? '';
  document.querySelector('#automationEditorStatus').textContent = `Draft saved · revision ${version.revision ?? 'current'}`;
  await loadAutomationRules({ quiet: true });
  if (announce) showToast('Automation draft saved', 'Nothing will run until an authorized publisher activates this version.');
  return payload.automation;
}

async function runAutomationDryTest() {
  const button = document.querySelector('#automationDryRunButton');
  button.disabled = true;
  try {
    const rule = await saveAutomationDraft({ announce: false });
    const result = document.querySelector('#automationDryRunResult');
    result.dataset.state = 'loading';
    result.innerHTML = '<strong>Evaluating retained snapshots…</strong><p>No actions will be created or delivered.</p>';
    const payload = await apiJson(`/api/axoboard/automations/${encodeURIComponent(rule.id)}/dry-run`, { method: 'POST', body: JSON.stringify({ lookbackDays: Number(document.querySelector('#automationDryRunDays').value), limit: 100 }) });
    const dryRun = payload.dryRun || {};
    result.dataset.state = 'complete';
    result.innerHTML = `<strong>${Number(dryRun.matches || 0)} matches from ${Number(dryRun.evaluated || 0)} evaluations</strong><p>${Number(dryRun.suppressed || 0)} suppressed by guardrails. No action attempts were created.</p>${Array.isArray(dryRun.samples) && dryRun.samples.length ? `<ul>${dryRun.samples.slice(0, 5).map((sample) => `<li>${escapeHtml(sample.at || 'Snapshot')} · ${escapeHtml(sample.result || 'evaluated')}</li>`).join('')}</ul>` : ''}`;
    document.querySelector('#automationEditorStatus').textContent = 'Dry run complete · no actions delivered';
  } catch (error) {
    document.querySelector('#automationDryRunResult').dataset.state = 'error';
    document.querySelector('#automationDryRunResult').innerHTML = `<strong>Dry run failed</strong><p>${escapeHtml(error.message)}</p>`;
    showAutomationFormError(error.message);
  } finally { button.disabled = false; }
}

async function publishAutomation() {
  if (!automationPermissions.canPublish) throw new Error('Your workspace role can save drafts but cannot publish automation versions.');
  if (!document.querySelector('#automationPublishConfirm').checked) throw new Error('Confirm that you reviewed the trigger, action, and guardrails before publishing.');
  const rule = await saveAutomationDraft({ announce: false });
  document.querySelector('#automationEditorStatus').textContent = 'Publishing immutable version…';
  const reviewedRevision = Number(automationEditableVersion(rule).revision);
  if (!Number.isInteger(reviewedRevision) || reviewedRevision < 1) throw new Error('The saved draft revision could not be verified. Reload the rule before publishing.');
  await apiJson(`/api/axoboard/automations/${encodeURIComponent(rule.id)}/publish`, { method: 'POST', body: JSON.stringify({ revision: reviewedRevision }) });
  closeFeatureModal(document.querySelector('#automationEditorModal'));
  await loadAutomationRules({ quiet: true });
  showToast('Automation published', 'The new immutable version can evaluate future certified metric events.');
}

async function renderKpiAutomationSurface() {
  const kpi = automationEditorKpi || liveKpis.find((item) => item.id === editingKpiId);
  const state = document.querySelector('#kpiAutomationState');
  const list = document.querySelector('#kpiAutomationList');
  const create = document.querySelector('#createKpiAutomation');
  if (!kpi || !state || !list) return;
  automationEditorKpi = kpi;
  const metricId = automationMetricIdForKpi(kpi);
  const structured = isStructuredAutomationKpi(kpi);
  document.querySelector('#kpiAutomationMetricName').textContent = kpi.name;
  document.querySelector('#kpiAutomationMetricMeta').textContent = metricId ? `Certified metric · ${metricId.slice(0, 8)}…` : 'No certified metric is attached';
  document.querySelector('#structuredAutomationNote').hidden = !structured;
  create.disabled = !automationPermissions.canEdit || structured || !metricId;
  create.title = structured ? 'Create a separate certified scalar KPI for this structured value first.' : !automationPermissions.canEdit ? 'Your role cannot create automation drafts.' : '';
  list.replaceChildren();
  if (structured) {
    setAutomationApiState(state, 'unavailable', 'Structured-card rules need scalar metrics', 'This snapshot certifies one aggregate value. Create a separate scalar KPI for the exact item, stage, or field before adding an automation.');
    return;
  }
  if (!metricId) {
    setAutomationApiState(state, 'unavailable', 'This KPI is not certified', 'A rule can bind only after the KPI has a stable certified metric definition.');
    return;
  }
  setAutomationApiState(state, 'loading', 'Loading linked automations…', 'Reading only rules bound to this certified metric.');
  try {
    const payload = await apiJson(`/api/axoboard/metrics/${encodeURIComponent(metricId)}/automations`);
    const rules = Array.isArray(payload.automations) ? payload.automations : [];
    document.querySelector('#kpiAutomationMetricMeta').textContent = `${rules.length} linked rule${rules.length === 1 ? '' : 's'} · certified metric`;
    if (!rules.length) {
      setAutomationApiState(state, 'empty', 'No rules use this KPI yet', automationPermissions.canEdit ? 'Create a draft with this certified metric preselected.' : 'No linked rules are visible for this metric.');
      return;
    }
    clearAutomationApiState(state);
    list.replaceChildren(...rules.map((rule) => {
      const item = document.createElement('article');
      const version = automationEffectiveVersion(rule);
      item.className = 'surface kpi-linked-rule';
      item.innerHTML = `<span class="automation-status-badge status-${escapeHtml(automationRuleState(rule))}">${escapeHtml(automationRuleState(rule).replaceAll('_', ' '))}</span><div><strong>${escapeHtml(rule.name)}</strong><small>${escapeHtml(automationDecisionLabel(rule.lastRun))} · ${Number(rule.actionCount || version.actions?.length || 0)} action${Number(rule.actionCount || version.actions?.length || 0) === 1 ? '' : 's'}</small></div>${rule.lastRun?.status === 'failed' ? '<b class="automation-warning-copy">Needs attention</b>' : ''}${automationPermissions.canEdit ? `<button type="button" data-edit-linked-automation="${escapeHtml(rule.id)}" data-interaction-status="working">Edit</button>` : '<span class="read-only-label">Read only</span>'}`;
      return item;
    }));
    list.querySelectorAll('[data-edit-linked-automation]').forEach((button) => button.addEventListener('click', () => {
      const rule = rules.find((item) => item.id === button.dataset.editLinkedAutomation);
      openAutomationEditor({ rule, kpi, trigger: button }).catch((error) => showToast('Rule editor unavailable', error.message));
    }));
  } catch (error) {
    setAutomationApiState(state, 'error', 'Linked rules could not be loaded', error.message);
  }
}

function showKpiAutomationPrompt(kpi) {
  const prompt = document.querySelector('#kpiAutomationPrompt');
  if (!prompt) return;
  pendingPromptKpi = liveKpis.find((item) => item.id === kpi.id) || kpi;
  const structured = isStructuredAutomationKpi(pendingPromptKpi);
  document.querySelector('#kpiAutomationPromptTitle').textContent = structured ? `${pendingPromptKpi.name} needs a scalar KPI` : `${pendingPromptKpi.name} is ready for automation`;
  prompt.querySelector('p').textContent = structured ? 'This structured card contains multiple values. Create a separate scalar KPI for the exact item, stage, or field you want to automate.' : 'Its certified metric now has a stable ID. Add a versioned rule now or return later from Edit KPI.';
  document.querySelector('#createPromptAutomation').hidden = structured;
  prompt.hidden = false;
  prompt.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function applySessionCapabilities(capabilities = {}) {
  liveCapabilities = capabilities || {};
  const canManageProduct = liveCapabilities.manageKpis !== false || liveCapabilities.manageDashboard !== false;
  const visibility = {
    integrations: liveCapabilities.viewSourceDetails !== false,
    displays: liveCapabilities.readDisplays !== false,
    automations: liveCapabilities.readAutomations !== false,
    workspace: liveCapabilities.manageBilling !== false,
    plans: liveCapabilities.manageBilling !== false,
    celebrations: liveCapabilities.readEvents !== false,
    sounds: canManageProduct,
    competitions: canManageProduct,
    brand: canManageProduct
  };
  Object.entries(visibility).forEach(([screen, allowed]) => {
    document.querySelectorAll(`.nav-item[data-screen="${screen}"]`).forEach((button) => { button.hidden = !allowed; });
  });
  document.querySelector('#pairScreenButton').hidden = !visibility.displays;
  document.querySelector('#newAutomationButton').hidden = !visibility.automations;
  document.querySelector('#addKpiButton').hidden = liveCapabilities.manageKpis === false;
  document.querySelector('#editLayoutButton').hidden = liveCapabilities.manageDashboard === false;
  document.querySelector('#templateGalleryButton').hidden = liveCapabilities.manageDashboard === false;
  document.querySelector('#shareDashboardButton').hidden = liveCapabilities.manageDashboard === false;
  document.querySelector('.workspace-switcher button').hidden = !visibility.workspace;
  document.querySelector('.mobile-workspace-switch').hidden = !visibility.workspace;
  document.querySelector('.sidebar-tip').hidden = !canManageProduct;
  if (!visibility.displays) liveDisplays = [];
  if (!visibility.automations) {
    liveAutomationRules = [];
    liveAutomationRuns = [];
    automationsLoaded = false;
    automationPermissions = { canRead: false, canEdit: false, canPublish: false };
  }
  const requestedScreen = location.hash.slice(1);
  if (requestedScreen && visibility[requestedScreen] === false) showScreen('dashboard');
}

async function loadLiveData() {
  if (!bootstrapReady) setBootstrapState('loading');
  try {
    const bootstrap = await apiJson('/api/axoboard/bootstrap');
    const { session, connections: connectionPayload, kpis: kpiPayload, dashboard: dashboardPayload, engagement, brand } = bootstrap;
    applySessionCapabilities(session.capabilities || {});
    const displayPayload = liveCapabilities.readDisplays === false
      ? { displays: [] }
      : await apiJson('/api/axoboard/displays').catch(() => ({ displays: [] }));
    liveConnections = connectionPayload.connections || [];
    liveKpis = kpiPayload.kpis || [];
    liveEngagement = engagement || { summary: {}, events: [] };
    liveBrand = brand || null;
    liveDisplays = displayPayload.displays || [];
    if (session.user?.workspace_name) {
      liveWorkspaceId = session.user.workspace_id;
      liveWorkspaceName = session.user.workspace_name;
      liveDashboardLayout = normalizeDashboardLayout(dashboardPayload.dashboard?.layout || {}, liveKpis.map((kpi) => kpi.id));
      document.body.dataset.activeWorkspace = 'live';
      document.body.dataset.demoData = 'false';
      document.querySelector('.workspace-switcher strong').textContent = session.user.workspace_name;
      document.querySelectorAll('.workspace-switcher .workspace-avatar, .mobile-workspace-switch .workspace-avatar').forEach((avatar) => { avatar.textContent = session.user.workspace_name[0].toUpperCase(); });
      document.querySelector('.mobile-workspace-switch')?.setAttribute('aria-label', `Open ${session.user.workspace_name} workspace settings`);
      workspaceName.value = session.user.workspace_name;
      document.querySelector('#serviceWorkspaceName').textContent = session.user.workspace_name;
      const serviceAvatar = document.querySelector('.customer-hero .workspace-avatar');
      if (serviceAvatar) serviceAvatar.textContent = session.user.workspace_name[0].toUpperCase();
      document.querySelector('#dashboardTitle').textContent = `${session.user.workspace_name} dashboard`;
      document.querySelector('.sidebar-user strong').textContent = session.user.full_name;
      document.querySelector('.sidebar-user small').textContent = `Workspace ${session.user.role}`;
      const userInitials = String(session.user.full_name || session.user.email || 'Account').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
      document.querySelector('.sidebar-user .user-avatar').textContent = userInitials || 'A';
    }
    renderLiveConnections();
    renderLiveKpis();
    renderLiveEngagement();
    renderLiveDisplays();
    if (!dedicatedTvRuntime && liveCapabilities.readAutomations !== false) await loadAutomationRules();
    if (activeFeatureModal?.id === 'tvPreviewModal' || dedicatedTvRuntime) {
      renderTvMode();
      setTvConnectionState('live');
    }
    bootstrapReady = true;
    setBootstrapState('ready');
    return true;
  } catch (error) {
    console.warn('[axoboard] live integration state unavailable', error.message);
    if (activeFeatureModal?.id === 'tvPreviewModal' || dedicatedTvRuntime) setTvConnectionState('offline');
    if (!bootstrapReady) setBootstrapState('failed', `We could not verify this workspace. ${error.message || 'Reload AxoBoard to try again.'} No synthetic dashboard data has been shown.`);
    else showToast('Workspace refresh unavailable', 'The last verified tenant data remains visible. Reload when the connection is restored.');
    return false;
  }
}

function syncBuilderSource(source) {
  activeKpiSource = source === 'hubspot' && !sourceChoices.find((choice) => choice.dataset.kpiSource === 'hubspot')?.disabled ? 'hubspot' : 'google';
  sourceChoices.forEach((choice) => choice.classList.toggle('is-selected', choice.dataset.kpiSource === activeKpiSource));
  sourceConfigs.forEach((config) => config.classList.toggle('is-active', config.dataset.sourceConfig === activeKpiSource));
  const isGoogle = activeKpiSource === 'google';
  document.querySelector('#dataStepTitle').textContent = isGoogle ? 'Choose cells to watch' : 'Choose CRM properties';
  document.querySelector('#dataStepCopy').textContent = isGoogle
    ? 'Select a spreadsheet, sheet, and one or more cell ranges.'
    : 'Select an object, standard or custom property, filters, and aggregation.';
  previewSourceMark.textContent = isGoogle ? 'G' : 'H';
  previewSourceMark.classList.toggle('google', isGoogle);
  previewSourceMark.classList.toggle('hubspot', !isGoogle);
  previewKpiValue.textContent = '—';
  kpiName.value = isGoogle ? 'My Google Sheets KPI' : 'Open pipeline';
  previewKpiName.textContent = kpiName.value;
}

function showBuilderStep(step) {
  activeBuilderStep = Math.max(1, Math.min(4, Number(step) || 1));
  builderSteps.forEach((panel) => {
    const active = Number(panel.dataset.builderStep) === activeBuilderStep;
    panel.classList.toggle('is-active', active);
    panel.hidden = !active;
  });
  builderStepLabels.forEach((label) => {
    const labelStep = Number(label.dataset.builderStepLabel);
    label.classList.toggle('is-active', labelStep === activeBuilderStep);
    label.classList.toggle('is-complete', labelStep < activeBuilderStep);
    label.setAttribute('aria-selected', String(labelStep === activeBuilderStep));
    label.tabIndex = labelStep === activeBuilderStep ? 0 : -1;
  });
  builderBack.disabled = activeBuilderStep === 1;
  builderNext.textContent = activeBuilderStep === 1
    ? 'Choose data →'
    : activeBuilderStep === 2
      ? 'Design KPI →'
      : activeBuilderStep === 3
        ? (editingKpiId ? 'Save & manage automations →' : '＋ Add to dashboard')
        : 'Done';
  document.querySelector('#builderStatus').textContent = activeBuilderStep === 4
    ? 'Automation changes save independently as versioned rules'
    : activeBuilderStep === 3
      ? (editingKpiId ? 'Save the KPI before managing its rules' : 'Ready to create live KPI')
      : 'Nothing saved until the KPI is created or updated';
  if (activeBuilderStep === 4 && editingKpiId) renderKpiAutomationSurface();
  document.querySelector('.builder-body').scrollTop = 0;
}

function validateSelectedData() {
  const spreadsheet = document.querySelector('#sheetFile').value.trim();
  if (!spreadsheet) throw new Error('Choose a spreadsheet.');
  const selectedSheet = document.querySelector('#sheetTab').value;
  if (!selectedSheet || !Number.isSafeInteger(Number(selectedSheet))) throw new Error('Choose a sheet.');
  const shape = currentRangeShape();
  if (!shape) throw new Error('Use valid ranges such as D8, A1:B12, or A2,C2,F2.');
  return shape;
}

function recommendDisplayForSelection(shape) {
  const headers = primaryUsesHeaders();
  if ((headers && shape.rows === 2 && shape.columns === 3) || (!headers && shape.rows === 1 && shape.columns === 3)) return 'scorecard';
  if (shape.rows * shape.columns === 1) return 'scorecard';
  if (headers && ((shape.columns === 2 && shape.rows >= 2) || (shape.rows === 2 && shape.columns >= 2))) return 'leaderboard';
  return 'table';
}

function openKpiBuilder(source = 'google', trigger = document.activeElement, kpi = null) {
  if (source === 'google' && !activeGoogleConnection) {
    showScreen('integrations');
    showToast('Connect Google Sheets first', 'Authorize one Google account before choosing spreadsheet cells.');
    return;
  }
  if (source === 'google' && !activeGoogleConnection.scopes?.includes(googleDriveMetadataScope)) {
    showScreen('integrations');
    showToast('Reconnect Google Sheets', 'Approve read-only Drive metadata so AxoBoard can list your spreadsheets.');
    return;
  }
  builderReturnFocus = trigger;
  editingKpiId = kpi?.id || null;
  automationEditorKpi = kpi || null;
  const automationTab = document.querySelector('#kpiBuilderTab4');
  automationTab.disabled = !editingKpiId;
  automationTab.setAttribute('aria-disabled', String(!editingKpiId));
  document.querySelector('#kpiBuilderEyebrow').textContent = editingKpiId ? 'EDIT LIVE DASHBOARD METRIC' : 'NEW DASHBOARD METRIC';
  document.querySelector('#kpiBuilderTitle').textContent = editingKpiId ? `Edit ${kpi.name}` : 'Build a KPI';
  availableSpreadsheets = [];
  loadedSpreadsheet = null;
  builderPreview = null;
  sheetGridState = null;
  sheetGridRequest += 1;
  window.clearTimeout(sheetGridScrollTimer);
  document.querySelector('#sheetRange').value = 'A1';
  sheetSelection = parseSheetRange('A1');
  sheetSelections = [sheetSelection];
  sheetSelectionRoles = ['metric'];
  primaryRangeRoles = [];
  comparisonRangeRoles = [];
  activeSheetSelectionIndex = 0;
  addingSeparateRange = false;
  document.querySelector('#sheetHasHeaders').checked = false;
  document.querySelector('#kpiGoal').value = '';
  document.querySelector('#periodGranularity').value = 'month';
  document.querySelector('#goalDirection').value = 'higher_is_better';
  document.querySelector('#goalCalendar').value = 'weekdays';
  document.querySelector('#goalTimezone').value = 'America/Denver';
  selectDisplayType('scorecard');
  document.querySelector('#kpiComparisonMode').value = 'none';
  document.querySelector('#kpiComparisonFields').hidden = true;
  document.querySelector('#comparisonRange').value = '';
  document.querySelector('#comparisonAggregation').value = 'single_value';
  document.querySelector('#comparisonHasHeaders').checked = false;
  document.querySelector('#comparisonSelectionLabel').textContent = 'Choose comparison cells';
  renderComparisonPreview();
  document.querySelector('#sheetPreviewResult').textContent = 'Ready to choose a display';
  document.querySelector('#sheetSelectionSummary').textContent = 'A1 · 1 cell';
  document.querySelector('#sheetFile').innerHTML = '<option value="">Loading your spreadsheets…</option>';
  document.querySelector('#sheetFile').disabled = true;
  document.querySelector('#openSpreadsheetPicker').disabled = true;
  document.querySelector('#selectedSpreadsheetName').textContent = 'Loading spreadsheets…';
  document.querySelector('#selectedSpreadsheetMeta').textContent = 'Google Drive';
  document.querySelector('#spreadsheetFileList').innerHTML = '<p>Loading spreadsheets…</p>';
  document.querySelector('#sheetTab').innerHTML = '<option value="">Choose a spreadsheet first</option>';
  document.querySelector('#sheetTab').disabled = true;
  document.querySelector('#sheetPickerTitle').textContent = 'Loading spreadsheets';
  document.querySelector('#sheetPickerSubtitle').textContent = 'Reading file names and modified dates from Google Drive';
  document.querySelector('#spreadsheetPickerHelp').textContent = 'Sorted by most recently updated';
  document.querySelector('#sheetGrid').innerHTML = '<p>Choose a spreadsheet and sheet to browse its cells.</p>';
  builderNext.disabled = false;
  syncBuilderSource(source);
  showBuilderStep(editingKpiId ? 3 : 1);
  if (editingKpiId) {
    builderNext.disabled = true;
    document.querySelector('#builderStatus').textContent = 'Loading saved KPI…';
  }
  kpiBuilderModal.classList.add('is-visible');
  kpiBuilderModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.querySelector('#closeKpiBuilder').focus();
  if (source === 'google') loadSpreadsheetList().then(async () => {
    if (kpi) await hydrateKpiBuilder(kpi);
    builderNext.disabled = false;
  }).catch((error) => {
    document.querySelector('#sheetPickerTitle').textContent = 'Spreadsheet list unavailable';
    document.querySelector('#sheetPickerSubtitle').textContent = error.message;
    document.querySelector('#sheetFile').innerHTML = '<option value="">Reconnect Google Sheets</option>';
    document.querySelector('#selectedSpreadsheetName').textContent = 'Reconnect Google Sheets';
    document.querySelector('#selectedSpreadsheetMeta').textContent = error.message;
    showToast('Reconnect Google Sheets', error.message);
  });
}

async function hydrateKpiBuilder(kpi) {
  const spreadsheet = availableSpreadsheets.find((item) => item.spreadsheetId === kpi.spreadsheetId);
  if (!spreadsheet) throw new Error('The KPI spreadsheet is no longer available to this Google account.');
  const fileSelect = document.querySelector('#sheetFile');
  if (fileSelect.value !== kpi.spreadsheetId) {
    fileSelect.value = kpi.spreadsheetId;
    syncSpreadsheetTrigger();
    await loadSpreadsheetMetadata();
  }
  document.querySelector('#sheetTab').value = String(kpi.sheetId);
  document.querySelector('#comparisonSheet').value = String(kpi.comparisonSheetId ?? kpi.sheetId);
  document.querySelector('#sheetRange').value = kpi.range;
  primaryRangeRoles = Array.isArray(kpi.rangeRoles) ? kpi.rangeRoles.map((item) => ({ range: String(item.range).toUpperCase(), role: ['header', 'goal'].includes(item.role) ? item.role : 'metric' })) : [];
  document.querySelector('#sheetHasHeaders').checked = Boolean(kpi.includeHeaders) && !primaryRangeRoles.some((item) => item.role === 'header');
  kpiName.value = kpi.name;
  previewKpiName.textContent = kpi.name;
  document.querySelector('#kpiFormat').value = kpi.displayFormat || 'number';
  document.querySelector('#periodGranularity').value = kpi.periodGranularity || 'month';
  document.querySelector('#goalDirection').value = kpi.goalDirection || 'higher_is_better';
  document.querySelector('#goalCalendar').value = kpi.goalCalendarType || 'weekdays';
  document.querySelector('#goalTimezone').value = kpi.goalTimezone || 'America/Denver';
  document.querySelector('#kpiGoal').value = kpi.goalValue ?? '';
  document.querySelector('#kpiComparisonMode').value = kpi.comparisonRange ? 'range' : 'none';
  document.querySelector('#kpiComparisonFields').hidden = !kpi.comparisonRange;
  document.querySelector('#comparisonRange').value = kpi.comparisonRange || '';
  document.querySelector('#comparisonHasHeaders').checked = Boolean(kpi.comparisonIncludeHeaders);
  document.querySelector('#comparisonSelectionLabel').textContent = kpi.comparisonRange ? `${kpi.comparisonSheetTitle || kpi.sheetTitle}!${kpi.comparisonRange}` : 'Choose comparison cells';
  selectDisplayType(kpi.displayType || 'scorecard');
  builderPreview = {
    value: kpi.value,
    goalValue: kpi.goalValue,
    goalSource: kpi.goalSource || 'manual',
    displayPayload: kpi.displayPayload,
    sourceRange: kpi.sourceRange,
    range: kpi.range,
    sheet: { title: kpi.sheetTitle },
    fetchedAt: kpi.fetchedAt,
    comparison: kpi.comparisonValue === null || kpi.comparisonValue === undefined ? null : {
      value: kpi.comparisonValue,
      delta: kpi.comparisonDelta,
      percentChange: kpi.comparisonPercentChange ?? null,
      sourceRange: kpi.comparisonSourceRange || `${kpi.comparisonSheetTitle || kpi.sheetTitle}!${kpi.comparisonRange}`
    }
  };
  previewKpiValue.textContent = formatKpiValue(kpi.value, kpi.displayFormat);
  document.querySelector('#previewLineage').textContent = `${kpi.spreadsheetTitle} · ${kpi.sourceRange}`;
  document.querySelector('#previewFreshness').textContent = `last synced ${timeAgo(kpi.fetchedAt)}`;
  renderStructuredPreview(kpi.displayPayload);
  updatePrimaryRangeSummary();
  renderComparisonPreview(builderPreview.comparison);
  renderBuilderAccuratePreview();
  showBuilderStep(3);
  document.querySelector('#builderStatus').textContent = 'Editing saved KPI · nothing changes until Save';
}

function closeKpiBuilder() {
  if (document.querySelector('#spreadsheetPickerModal').classList.contains('is-visible')) closeSpreadsheetPicker();
  if (document.querySelector('#rangePickerModal').classList.contains('is-visible')) closeRangePicker();
  kpiBuilderModal.classList.remove('is-visible');
  kpiBuilderModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  editingKpiId = null;
  automationEditorKpi = null;
  builderReturnFocus?.focus?.();
}

function spreadsheetModifiedLabel(value) {
  if (!value) return 'Modified date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Modified date unavailable';
  return `Updated ${timeAgo(date.toISOString())}`;
}

function syncSpreadsheetTrigger() {
  const selected = availableSpreadsheets.find((spreadsheet) => spreadsheet.spreadsheetId === document.querySelector('#sheetFile').value);
  document.querySelector('#selectedSpreadsheetName').textContent = selected?.title || (availableSpreadsheets.length ? 'Select a spreadsheet' : 'No spreadsheets found');
  document.querySelector('#selectedSpreadsheetMeta').textContent = selected ? spreadsheetModifiedLabel(selected.modifiedTime) : 'Google Drive';
}

function renderSpreadsheetFiles(query = '') {
  const normalizedQuery = String(query).trim().toLowerCase();
  const visible = availableSpreadsheets.filter((spreadsheet) => !normalizedQuery || spreadsheet.title.toLowerCase().includes(normalizedQuery));
  const list = document.querySelector('#spreadsheetFileList');
  if (!visible.length) {
    list.innerHTML = '<p>No spreadsheets match this search.</p>';
  } else {
    list.replaceChildren(...visible.map((spreadsheet) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'drive-file-card';
      button.dataset.spreadsheetId = spreadsheet.spreadsheetId;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(spreadsheet.spreadsheetId === spreadsheetPickerSelection));
      button.innerHTML = `<span aria-hidden="true">▦</span><div><strong>${escapeHtml(spreadsheet.title)}</strong><small>${escapeHtml(spreadsheetModifiedLabel(spreadsheet.modifiedTime))}</small></div>`;
      return button;
    }));
  }
  document.querySelector('#spreadsheetPickerCount').textContent = `${visible.length} spreadsheet${visible.length === 1 ? '' : 's'}`;
  document.querySelector('#applySpreadsheetPicker').disabled = !spreadsheetPickerSelection;
}

function openSpreadsheetPicker() {
  if (!availableSpreadsheets.length) return;
  spreadsheetPickerSelection = document.querySelector('#sheetFile').value || availableSpreadsheets[0].spreadsheetId;
  document.querySelector('#spreadsheetSearch').value = '';
  renderSpreadsheetFiles();
  const modal = document.querySelector('#spreadsheetPickerModal');
  modal.classList.add('is-visible');
  modal.setAttribute('aria-hidden', 'false');
  document.querySelector('#spreadsheetSearch').focus();
}

function closeSpreadsheetPicker() {
  const modal = document.querySelector('#spreadsheetPickerModal');
  modal.classList.remove('is-visible');
  modal.setAttribute('aria-hidden', 'true');
  document.querySelector('#openSpreadsheetPicker').focus();
}

function applySpreadsheetPicker() {
  if (!spreadsheetPickerSelection) return;
  const select = document.querySelector('#sheetFile');
  const changed = select.value !== spreadsheetPickerSelection;
  select.value = spreadsheetPickerSelection;
  syncSpreadsheetTrigger();
  closeSpreadsheetPicker();
  if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
}

async function loadSpreadsheetList() {
  const select = document.querySelector('#sheetFile');
  const seenTokens = new Set();
  const spreadsheets = [];
  let pageToken = '';
  let incompleteSearch = false;
  do {
    const query = new URLSearchParams({ connectionId: activeGoogleConnection.id });
    if (pageToken) query.set('pageToken', pageToken);
    const payload = await apiJson(`/api/axoboard/integrations/google/spreadsheets?${query}`);
    spreadsheets.push(...(payload.spreadsheets || []));
    incompleteSearch ||= Boolean(payload.incompleteSearch);
    pageToken = payload.nextPageToken || '';
    if (pageToken && seenTokens.has(pageToken)) throw new Error('Google returned a repeated page. Try reconnecting.');
    if (pageToken) seenTokens.add(pageToken);
  } while (pageToken);
  availableSpreadsheets = spreadsheets.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
  if (!availableSpreadsheets.length) {
    select.innerHTML = '<option value="">No Google spreadsheets found</option>';
    select.disabled = true;
    document.querySelector('#sheetPickerTitle').textContent = 'No spreadsheets found';
    document.querySelector('#sheetPickerSubtitle').textContent = 'Create or share a Google spreadsheet with this account, then reconnect.';
    document.querySelector('#spreadsheetPickerHelp').textContent = 'No files available';
    document.querySelector('#openSpreadsheetPicker').disabled = true;
    syncSpreadsheetTrigger();
    return [];
  }
  select.replaceChildren(...availableSpreadsheets.map((spreadsheet) => {
    const option = document.createElement('option');
    option.value = spreadsheet.spreadsheetId;
    option.textContent = `${spreadsheet.title} — ${spreadsheetModifiedLabel(spreadsheet.modifiedTime)}`;
    return option;
  }));
  select.disabled = false;
  spreadsheetPickerSelection = select.value;
  document.querySelector('#openSpreadsheetPicker').disabled = false;
  syncSpreadsheetTrigger();
  renderSpreadsheetFiles();
  document.querySelector('#spreadsheetPickerHelp').textContent = `${availableSpreadsheets.length} spreadsheet${availableSpreadsheets.length === 1 ? '' : 's'} · newest first${incompleteSearch ? ' · Google reported an incomplete search' : ''}`;
  await loadSpreadsheetMetadata();
  return availableSpreadsheets;
}

async function loadSpreadsheetMetadata() {
  const spreadsheet = document.querySelector('#sheetFile').value.trim();
  if (!spreadsheet) throw new Error('Choose a spreadsheet.');
  const payload = await apiJson(`/api/axoboard/integrations/google/spreadsheet?connectionId=${encodeURIComponent(activeGoogleConnection.id)}&spreadsheet=${encodeURIComponent(spreadsheet)}`);
  loadedSpreadsheet = { ...payload.spreadsheet, input: spreadsheet };
  const select = document.querySelector('#sheetTab');
  select.replaceChildren(...loadedSpreadsheet.sheets.map((sheet) => {
    const option = document.createElement('option');
    option.value = String(sheet.sheetId);
    option.textContent = sheet.title;
    return option;
  }));
  select.disabled = !loadedSpreadsheet.sheets.length;
  const comparisonSelect = document.querySelector('#comparisonSheet');
  comparisonSelect.replaceChildren(...loadedSpreadsheet.sheets.map((sheet) => {
    const option = document.createElement('option');
    option.value = String(sheet.sheetId);
    option.textContent = sheet.title;
    return option;
  }));
  comparisonSelect.value = select.value;
  const pickerSelect = document.querySelector('#rangePickerSheet');
  pickerSelect.replaceChildren(...loadedSpreadsheet.sheets.map((sheet) => {
    const option = document.createElement('option');
    option.value = String(sheet.sheetId);
    option.textContent = sheet.title;
    return option;
  }));
  pickerSelect.value = select.value;
  document.querySelector('#sheetPickerTitle').textContent = loadedSpreadsheet.title;
  document.querySelector('#sheetPickerSubtitle').textContent = `${loadedSpreadsheet.sheets.length} sheet${loadedSpreadsheet.sheets.length === 1 ? '' : 's'} available`;
  document.querySelector('#sheetPickerStatus').textContent = 'Metadata loaded';
  return loadedSpreadsheet;
}

async function previewGoogleSelection() {
  const requestId = ++builderPreviewRequest;
  const spreadsheetInput = document.querySelector('#sheetFile').value.trim();
  if (!loadedSpreadsheet || loadedSpreadsheet.input !== spreadsheetInput) await loadSpreadsheetMetadata();
  const selectedSheet = document.querySelector('#sheetTab').value;
  const sheetId = Number(selectedSheet);
  if (!selectedSheet || !Number.isSafeInteger(sheetId)) throw new Error('Choose a sheet.');
  if (!parseSheetRanges(document.querySelector('#sheetRange').value)) throw new Error('Use valid KPI ranges such as D8, B2:E14, or A2,C2,F2.');
  if (document.querySelector('#kpiComparisonMode').value === 'range' && !document.querySelector('#comparisonRange').value) {
    throw new Error('Choose comparison cells from the sheet preview.');
  }
  const selectedRange = document.querySelector('#sheetRange').value.trim();
  setBuilderPreviewStatus('loading', 'checking selected cells', selectedRange);
  document.querySelector('#builderStatus').textContent = 'Checking live Google data…';
  let payload;
  try {
    payload = await apiJson('/api/axoboard/kpis/google/preview', {
      method: 'POST', body: JSON.stringify({
        connectionId: activeGoogleConnection.id, spreadsheet: spreadsheetInput, sheetId,
        range: selectedRange, rangeRoles: rangeRolesForPayload(primaryRangeRoles, selectedRange), aggregation: document.querySelector('#sheetAggregation').value,
        includeHeaders: document.querySelector('#sheetHasHeaders').checked, displayType: activeDisplayType, ...comparisonBuilderPayload()
      })
    });
  } catch (error) {
    if (requestId === builderPreviewRequest) {
      setBuilderPreviewStatus('error', 'preview unavailable — retry', selectedRange);
      document.querySelector('#builderStatus').textContent = error.message;
    }
    throw error;
  }
  if (requestId !== builderPreviewRequest) return null;
  if (!payload.preview && payload.validation?.valid === false) {
    builderPreview = null;
    renderStructuredPreview(null);
    renderComparisonPreview();
    setBuilderPreviewStatus('invalid', 'selection needs attention', selectedRange);
    document.querySelector('#sheetPickerStatus').textContent = 'Selection needs attention';
    document.querySelector('#sheetPreviewResult').textContent = payload.validation.error;
    document.querySelector('#builderStatus').textContent = payload.validation.error || 'Choose data that matches this display.';
    throw new Error(payload.validation.error || 'Choose data that matches this display.');
  }
  if (!payload.preview) {
    setBuilderPreviewStatus('error', 'preview unavailable — retry', selectedRange);
    document.querySelector('#builderStatus').textContent = 'Google returned no preview. Choose the cells again and retry.';
    throw new Error('Google returned no preview. Choose the cells again and retry.');
  }
  builderPreview = payload.preview;
  previewKpiValue.textContent = formatKpiValue(builderPreview.value, document.querySelector('#kpiFormat').value);
  document.querySelector('#previewLineage').textContent = `${builderPreview.spreadsheetTitle} · ${builderPreview.sourceRange}`;
  document.querySelector('#previewFreshness').textContent = 'previewed just now';
  document.querySelector('#sheetPickerStatus').textContent = 'Preview healthy';
  document.querySelector('#sheetPreviewResult').textContent = `${formatKpiValue(builderPreview.value, document.querySelector('#kpiFormat').value)} · ${builderPreview.sourceRowCount} contributing cell${builderPreview.sourceRowCount === 1 ? '' : 's'}`;
  document.querySelector('#builderStatus').textContent = 'Live preview ready';
  document.querySelector('.builder-preview-panel').dataset.previewStatus = 'ready';
  renderStructuredPreview(builderPreview.displayPayload);
  renderComparisonPreview(builderPreview.comparison);
  renderBuilderAccuratePreview();
  return builderPreview;
}

async function saveLiveKpi({ stayOpen = false } = {}) {
  if (!builderPreview && !await previewGoogleSelection()) throw new Error('The display changed while Google was checking the selected cells. Try again.');
  const editedId = editingKpiId;
  const payload = await apiJson(editedId ? `/api/axoboard/kpis/${encodeURIComponent(editedId)}` : '/api/axoboard/kpis', {
    method: editedId ? 'PUT' : 'POST', body: JSON.stringify({
      connectionId: activeGoogleConnection.id, spreadsheet: document.querySelector('#sheetFile').value.trim(),
      sheetId: Number(document.querySelector('#sheetTab').value), range: document.querySelector('#sheetRange').value.trim(),
      rangeRoles: rangeRolesForPayload(primaryRangeRoles, document.querySelector('#sheetRange').value.trim()),
      aggregation: document.querySelector('#sheetAggregation').value, includeHeaders: document.querySelector('#sheetHasHeaders').checked, name: kpiName.value.trim(),
      displayFormat: document.querySelector('#kpiFormat').value, displayType: activeDisplayType,
      periodGranularity: document.querySelector('#periodGranularity').value,
      goalDirection: document.querySelector('#goalDirection').value,
      goalCalendarType: document.querySelector('#goalCalendar').value,
      goalTimezone: document.querySelector('#goalTimezone').value,
      ...comparisonBuilderPayload()
    })
  });
  await loadLiveData();
  if (stayOpen && editedId) {
    editingKpiId = payload.kpi.id;
    automationEditorKpi = liveKpis.find((item) => item.id === payload.kpi.id) || payload.kpi;
    document.querySelector('#kpiBuilderTab4').disabled = false;
    document.querySelector('#kpiBuilderTab4').setAttribute('aria-disabled', 'false');
    showBuilderStep(4);
    showToast('KPI updated', `${payload.kpi.name} is saved. Its automation rules remain independently versioned.`);
    return payload.kpi;
  }
  closeKpiBuilder();
  showScreen('dashboard');
  showToast(editedId ? 'KPI updated' : 'Live KPI created', `${payload.kpi.name} is synced from ${payload.kpi.sourceRange}.`);
  document.querySelector(`[data-live-kpi="${payload.kpi.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!editedId) showKpiAutomationPrompt(payload.kpi);
  return payload.kpi;
}

document.querySelector('#addKpiButton').addEventListener('click', (event) => openKpiBuilder('google', event.currentTarget));
document.querySelectorAll('.build-source-kpi').forEach((button) => button.addEventListener('click', () => openKpiBuilder(button.dataset.source, button)));
sourceChoices.forEach((choice) => choice.addEventListener('click', () => syncBuilderSource(choice.dataset.kpiSource)));
document.querySelectorAll('[data-display-type]').forEach((button) => button.addEventListener('click', async () => {
  selectDisplayType(button.dataset.displayType);
  if (activeBuilderStep !== 3) return;
  if (headerRequiredDisplayTypes.has(activeDisplayType) && !document.querySelector('#sheetHasHeaders').checked) {
    showToast('Headers are required', 'Go back to Data and turn on “Use first row as headers.”');
    return;
  }
  try { await previewGoogleSelection(); }
  catch (error) { showToast('Display needs different data', error.message); }
}));
builderBack.addEventListener('click', () => showBuilderStep(activeBuilderStep - 1));
builderNext.addEventListener('click', async () => {
  builderNext.disabled = true;
  try {
    if (activeBuilderStep === 1) showBuilderStep(2);
    else if (activeBuilderStep === 2) {
      const shape = validateSelectedData();
      selectDisplayType(recommendDisplayForSelection(shape));
      showBuilderStep(3);
      try { await previewGoogleSelection(); }
      catch (error) { showToast('Choose a matching display', error.message); }
    }
    else if (activeBuilderStep === 3) await saveLiveKpi({ stayOpen: Boolean(editingKpiId) });
    else closeKpiBuilder();
  } catch (error) { showToast('KPI setup needs attention', error.message); }
  finally { builderNext.disabled = false; }
});
builderStepLabels.forEach((label) => label.addEventListener('click', () => {
  const targetStep = Number(label.dataset.builderStepLabel);
  if (label.disabled || targetStep === activeBuilderStep) return;
  if (!editingKpiId && targetStep > activeBuilderStep) {
    showToast('Continue in order', targetStep === 4 ? 'Save the KPI first so its automation can bind to a stable certified metric.' : 'Complete the current KPI step before moving forward.');
    return;
  }
  showBuilderStep(targetStep);
}));
document.querySelector('#closeKpiBuilder').addEventListener('click', closeKpiBuilder);
kpiBuilderModal.addEventListener('click', (event) => { if (event.target === kpiBuilderModal) closeKpiBuilder(); });
kpiName.addEventListener('input', () => { previewKpiName.textContent = kpiName.value || 'Untitled KPI'; renderBuilderAccuratePreview(); });
document.querySelector('#kpiComparisonMode').addEventListener('change', (event) => {
  document.querySelector('#kpiComparisonFields').hidden = event.target.value !== 'range';
  builderPreview = null;
  renderComparisonPreview();
  if (event.target.value === 'range' && !document.querySelector('#comparisonRange').value) {
    openRangePicker('comparison', event.target).catch((error) => showToast('Sheet preview could not open', error.message));
  }
});
['#comparisonAggregation', '#comparisonHasHeaders'].forEach((selector) => {
  document.querySelector(selector).addEventListener('change', () => {
    builderPreview = null;
    renderComparisonPreview();
  });
});
document.querySelector('#previewComparisonButton').addEventListener('click', (event) => {
  openRangePicker('comparison', event.currentTarget).catch((error) => showToast('Sheet preview could not open', error.message));
});
document.querySelector('#selectGoalRangeButton').addEventListener('click', (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  openRangePicker('goal', button)
    .catch((error) => showToast('Goal picker could not open', error.message))
    .finally(() => { button.disabled = false; });
});
document.querySelector('#selectRangeButton').addEventListener('click', async () => {
  const button = document.querySelector('#selectRangeButton');
  button.disabled = true;
  try { await openRangePicker('primary', button); }
  catch (error) { showToast('Sheet preview could not open', error.message); }
  finally { button.disabled = false; }
});
document.querySelector('#kpiFormat').addEventListener('change', () => {
  if (builderPreview) {
    const formatted = formatKpiValue(builderPreview.value, document.querySelector('#kpiFormat').value);
    previewKpiValue.textContent = formatted;
    document.querySelector('#sheetPreviewResult').textContent = `${formatted} · ${builderPreview.sourceRowCount} contributing cell${builderPreview.sourceRowCount === 1 ? '' : 's'}`;
    renderComparisonPreview(builderPreview.comparison);
    renderStructuredPreview(builderPreview.displayPayload);
    renderBuilderAccuratePreview();
  }
});
document.querySelector('#kpiGoal').addEventListener('input', renderBuilderAccuratePreview);
document.querySelector('#periodGranularity').addEventListener('change', renderBuilderAccuratePreview);
document.querySelector('#openSpreadsheetPicker').addEventListener('click', openSpreadsheetPicker);
document.querySelector('#spreadsheetSearch').addEventListener('input', (event) => renderSpreadsheetFiles(event.currentTarget.value));
document.querySelector('#spreadsheetFileList').addEventListener('click', (event) => {
  const file = event.target.closest('[data-spreadsheet-id]');
  if (!file) return;
  spreadsheetPickerSelection = file.dataset.spreadsheetId;
  renderSpreadsheetFiles(document.querySelector('#spreadsheetSearch').value);
  document.querySelector(`[data-spreadsheet-id="${CSS.escape(spreadsheetPickerSelection)}"]`)?.focus();
});
document.querySelector('#spreadsheetFileList').addEventListener('dblclick', (event) => {
  const file = event.target.closest('[data-spreadsheet-id]');
  if (!file) return;
  spreadsheetPickerSelection = file.dataset.spreadsheetId;
  applySpreadsheetPicker();
});
document.querySelector('#applySpreadsheetPicker').addEventListener('click', applySpreadsheetPicker);
document.querySelector('#cancelSpreadsheetPicker').addEventListener('click', closeSpreadsheetPicker);
document.querySelector('#closeSpreadsheetPicker').addEventListener('click', closeSpreadsheetPicker);
document.querySelector('#spreadsheetPickerModal').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeSpreadsheetPicker(); });
document.querySelector('#sheetFile').addEventListener('change', async () => {
  syncSpreadsheetTrigger();
  loadedSpreadsheet = null;
  builderPreview = null;
  sheetGridState = null;
  document.querySelector('#sheetGrid').scrollTo({ top: 0, left: 0 });
  document.querySelector('#sheetTab').disabled = true;
  document.querySelector('#sheetTab').innerHTML = '<option value="">Loading sheets…</option>';
  try { await loadSpreadsheetMetadata(); }
  catch (error) { showToast('Spreadsheet could not load', error.message); }
});
document.querySelector('#sheetTab').addEventListener('change', async () => {
  builderPreview = null;
  sheetGridState = null;
  document.querySelector('#sheetPreviewResult').textContent = 'Sheet changed · previewed when you continue';
});
document.querySelector('#sheetRange').addEventListener('input', () => {
  builderPreview = null;
  if (!rangeRolesForPayload(primaryRangeRoles, document.querySelector('#sheetRange').value).length) primaryRangeRoles = [];
  updatePrimaryRangeSummary();
});
document.querySelector('#sheetHasHeaders').addEventListener('change', () => {
  builderPreview = null;
  updatePrimaryRangeSummary();
});
document.querySelector('#rangePickerSheet').addEventListener('change', async () => {
  sheetGridState = null;
  setSheetSelection({ row: 1, column: 1 });
  document.querySelector('#sheetGrid').scrollTo({ top: 0, left: 0 });
  try { await loadSheetGrid(1, 1); }
  catch (error) { showToast('Sheet preview could not load', error.message); }
});
document.querySelector('#rangePickerInput').addEventListener('input', () => {
  const parsed = parseSheetRanges(document.querySelector('#rangePickerInput').value);
  if (parsed && parsed.length !== sheetSelections.length) sheetSelectionRoles = parsed.map(() => 'metric');
  document.querySelector('#jumpToRangeButton').disabled = !parsed;
  document.querySelector('#applyRangePicker').disabled = !parsed;
});
document.querySelector('#jumpToRangeButton').addEventListener('click', async () => {
  const parsed = parseSheetRanges(document.querySelector('#rangePickerInput').value);
  if (!parsed) return showToast('Ranges need attention', 'Use ranges such as D8, B2:E14, or A2,C2,F2.');
  sheetSelections = parsed;
  if (sheetSelectionRoles.length !== parsed.length) sheetSelectionRoles = parsed.map(() => 'metric');
  activeSheetSelectionIndex = 0;
  sheetSelection = sheetSelections[0];
  scheduleSheetSelectionSync();
  try { await revealSheetSelection(); }
  catch (error) { showToast('Range could not load', error.message); }
});
document.querySelector('#rangePickerHasHeaders').addEventListener('change', () => {
  document.querySelector('#rangePickerPreviewResult').textContent = 'Ready to apply';
  syncSheetSelection();
});
document.querySelector('#addRangeSelection').addEventListener('click', (event) => {
  addingSeparateRange = !addingSeparateRange;
  event.currentTarget.setAttribute('aria-pressed', String(addingSeparateRange));
  document.querySelector('#sheetPickerStatus').textContent = addingSeparateRange ? 'Click or drag the next separate range' : 'Drag to select';
  if (addingSeparateRange) document.querySelector('#sheetGrid').focus();
});
document.querySelector('#rangeSelectionChips').addEventListener('click', (event) => {
  const remove = event.target.closest('[data-remove-range]');
  if (!remove) return;
  const index = Number(remove.dataset.removeRange);
  sheetSelections = sheetSelections.filter((selection, selectionIndex) => selectionIndex !== index);
  sheetSelectionRoles = sheetSelectionRoles.filter((role, selectionIndex) => selectionIndex !== index);
  activeSheetSelectionIndex = Math.max(0, Math.min(activeSheetSelectionIndex, sheetSelections.length - 1));
  sheetSelection = sheetSelections[activeSheetSelectionIndex];
  document.querySelector('#rangePickerInput').value = sheetSelectionsA1();
  builderPreview = null;
  document.querySelector('#rangePickerPreviewResult').textContent = 'Ready to apply';
  syncSheetSelection();
});
document.querySelector('#rangeSelectionChips').addEventListener('change', (event) => {
  const roleSelect = event.target.closest('[data-range-role]');
  if (!roleSelect) return;
  sheetSelectionRoles[Number(roleSelect.dataset.rangeRole)] = ['header', 'goal'].includes(roleSelect.value) ? roleSelect.value : 'metric';
  builderPreview = null;
  document.querySelector('#rangePickerPreviewResult').textContent = 'Ready to apply';
  syncSheetSelection();
});
document.querySelector('#applyRangePicker').addEventListener('click', applyRangePickerSelection);
document.querySelector('#cancelRangePicker').addEventListener('click', closeRangePicker);
document.querySelector('#closeRangePicker').addEventListener('click', closeRangePicker);
document.querySelector('#rangePickerModal').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeRangePicker(); });
document.querySelector('#sheetGrid').addEventListener('pointerdown', (event) => {
  const cell = event.target.closest('[data-sheet-cell]');
  if (!cell) return;
  event.preventDefault();
  const coordinate = { row: Number(cell.dataset.row), column: Number(cell.dataset.column) };
  const additive = addingSeparateRange || event.ctrlKey || event.metaKey;
  selectingSheetCells = true;
  setSheetSelection(event.shiftKey && !additive ? sheetSelection.anchor : coordinate, coordinate, {
    additive,
    selectionIndex: rangePickerIntent === 'goal' && !additive ? activeSheetSelectionIndex : null
  });
  addingSeparateRange = false;
  document.querySelector('#addRangeSelection').setAttribute('aria-pressed', 'false');
  cell.focus();
});
document.querySelector('#sheetGrid').addEventListener('pointerover', (event) => {
  if (!selectingSheetCells) return;
  const cell = event.target.closest('[data-sheet-cell]');
  if (cell) setSheetSelection(sheetSelection.anchor, { row: Number(cell.dataset.row), column: Number(cell.dataset.column) }, { selectionIndex: activeSheetSelectionIndex, writeInput: false });
});
document.querySelector('#sheetGrid').addEventListener('pointermove', (event) => {
  if (!selectingSheetCells) return;
  const grid = event.currentTarget;
  const bounds = grid.getBoundingClientRect();
  const horizontal = event.clientX < bounds.left + 28 ? -22 : event.clientX > bounds.right - 28 ? 22 : 0;
  const vertical = event.clientY < bounds.top + 28 ? -22 : event.clientY > bounds.bottom - 28 ? 22 : 0;
  if (horizontal || vertical) grid.scrollBy({ left: horizontal, top: vertical });
});
document.querySelector('#sheetGrid').addEventListener('keydown', (event) => {
  const cell = event.target.closest('[data-sheet-cell]');
  if (!cell || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[event.key];
  const row = Number(cell.dataset.row) + delta[0];
  const column = Number(cell.dataset.column) + delta[1];
  const next = document.querySelector(`#sheetGrid [data-row="${row}"][data-column="${column}"]`);
  if (!next) return;
  const coordinate = { row, column };
  const additive = event.ctrlKey || event.metaKey;
  setSheetSelection(event.shiftKey && !additive ? sheetSelection.anchor : coordinate, coordinate, { additive });
  next.focus();
});
document.addEventListener('pointerup', () => {
  if (selectingSheetCells) document.querySelector('#rangePickerInput').value = sheetSelectionsA1();
  selectingSheetCells = false;
});
document.querySelector('#sheetGrid').addEventListener('scroll', scheduleSheetGridLoad, { passive: true });
document.querySelector('#reconnectSource').addEventListener('click', (event) => openFreshOAuth('google', event.currentTarget));
document.querySelectorAll('.connect-source').forEach((button) => button.addEventListener('click', (event) => openFreshOAuth('google', event.currentTarget)));
document.querySelector('#browseIntegrations').addEventListener('click', (event) => activeGoogleConnection ? showToast('Google Sheets is connected', 'Build a KPI or reconnect the account from the Google card.') : openFreshOAuth('google', event.currentTarget));
document.querySelectorAll('.integration-catalog button').forEach((button) => button.addEventListener('click', () => showToast(button.querySelector('b').textContent, button.querySelector('i').textContent === 'Suggest' ? 'Request captured in this prototype.' : 'This connector is queued for a later phase.')));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (document.querySelector('#spreadsheetPickerModal').classList.contains('is-visible')) closeSpreadsheetPicker();
  else if (document.querySelector('#rangePickerModal').classList.contains('is-visible')) closeRangePicker();
  else if (kpiBuilderModal.classList.contains('is-visible')) closeKpiBuilder();
});

const featureModals = [...document.querySelectorAll('.feature-overlay')];
const shareTabs = [...document.querySelectorAll('[data-share-tab]')];
const sharePanels = [...document.querySelectorAll('[data-share-panel]')];
let activeFeatureModal = null;
let featureReturnFocus = null;
let loopTimer = null;
let tvPageIndex = 0;
let tvRotationPaused = false;
let tvRefreshSeconds = 45;
let tvRotationSeconds = 15;
const tvPageSize = 4;

function tvKpiContext(kpi) {
  if (kpi.displayPayload?.layout === 'rep_metric_goal') {
    const { metric, goal } = kpi.displayPayload;
    return goal.value === 0 ? `${goal.label} ${formatKpiValue(goal.value, kpi.displayFormat)}` : `${((metric.value / goal.value) * 100).toFixed(0)}% of ${formatKpiValue(goal.value, kpi.displayFormat)} goal`;
  }
  if (kpi.comparisonValue !== null && kpi.comparisonValue !== undefined) {
    const percent = kpi.comparisonValue === 0 ? null : (kpi.comparisonDelta / Math.abs(kpi.comparisonValue)) * 100;
    return `${kpi.comparisonDelta >= 0 ? '+' : ''}${formatKpiValue(kpi.comparisonDelta, kpi.displayFormat)}${percent === null ? '' : ` · ${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`}`;
  }
  if (kpi.goalValue) return `${Math.max(0, (Number(kpi.value) / Number(kpi.goalValue)) * 100).toFixed(0)}% of goal`;
  return `${kpi.status === 'active' ? 'Live' : 'Needs attention'} · ${timeAgo(kpi.fetchedAt)}`;
}

function tvKpiMeta(kpi) {
  const trust = kpi.certification?.status === 'certified' ? 'Certified' : 'Verified metric';
  return `<footer class="tv-kpi-meta"><span>${escapeHtml(trust)}</span><em>Customer dashboard</em><b>${escapeHtml(timeAgo(kpi.fetchedAt))}</b></footer>`;
}

function renderTvTrend(items, displayFormat) {
  const points = (items || []).filter((item) => Number.isFinite(Number(item.value)));
  if (!points.length) return '<div class="tv-visual-empty">No numeric trend points</div>';
  const values = points.flatMap((item) => [Number(item.value), Number(item.comparisonValue)].filter(Number.isFinite));
  let minimum = Math.min(...values);
  let maximum = Math.max(...values);
  if (minimum === maximum) { minimum -= 1; maximum += 1; }
  const coordinates = (key) => points.map((item, index) => {
    const value = Number(item[key]);
    if (!Number.isFinite(value)) return null;
    const x = points.length === 1 ? 320 : 20 + (index / (points.length - 1)) * 600;
    const y = 210 - ((value - minimum) / (maximum - minimum)) * 170;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).filter(Boolean).join(' ');
  const comparison = points.some((item) => Number.isFinite(Number(item.comparisonValue)))
    ? `<polyline class="tv-trend-comparison" points="${coordinates('comparisonValue')}" />`
    : '';
  const labels = points.length <= 8 ? points : [points[0], points.at(-1)];
  return `<div class="tv-trend-visual" role="img" aria-label="Trend from ${escapeHtml(points[0].label)} ${escapeHtml(formatKpiValue(points[0].value, displayFormat))} to ${escapeHtml(points.at(-1).label)} ${escapeHtml(formatKpiValue(points.at(-1).value, displayFormat))}"><svg viewBox="0 0 640 230" preserveAspectRatio="none" aria-hidden="true"><line x1="20" y1="210" x2="620" y2="210" />${comparison}<polyline class="tv-trend-current" points="${coordinates('value')}" /></svg><div>${labels.map((item) => `<span>${escapeHtml(item.label)}</span>`).join('')}</div></div>`;
}

function renderTvKpiCard(card, kpi) {
  const displayType = kpi.displayType || 'scorecard';
  const payload = kpi.displayPayload || {};
  const compositeScorecard = displayType === 'scorecard' && payload.layout === 'rep_metric_goal';
  const wideTypes = new Set(['rep_cards', 'leaderboard', 'trend', 'category_bar', 'funnel', 'pipeline', 'activity_feed', 'heatmap', 'table']);
  card.className = `tv-kpi-card tv-kpi-card-${displayType}${wideTypes.has(displayType) ? ' tv-kpi-card-wide' : ''}${compositeScorecard ? ' tv-kpi-card-composite' : ''}`;
  card.dataset.tvKpi = kpi.id;
  card.dataset.tvDisplayType = displayType;
  const title = `<header class="tv-kpi-heading"><div><small>${escapeHtml(displayType.replaceAll('_', ' '))}</small><h3>${escapeHtml(kpi.name)}</h3></div><span class="tv-live-chip">● Live</span></header>`;
  const meta = tvKpiMeta(kpi);

  if (displayType === 'goal_pace') {
    const target = Number(kpi.goalValue);
    const hasGoal = Number.isFinite(target) && target !== 0;
    const progress = hasGoal ? clampPercent((Number(kpi.value) / target) * 100) : 0;
    const remaining = hasGoal ? Math.max(0, target - Number(kpi.value)) : null;
    card.innerHTML = `${title}<div class="tv-goal-pace"><strong>${escapeHtml(formatKpiValue(kpi.value, kpi.displayFormat))}</strong><span>${hasGoal ? `${progress.toFixed(1)}% of ${formatKpiValue(target, kpi.displayFormat)}` : 'Add a goal to calculate pace'}</span><div><i style="width:${progress}%"></i><em style="left:${progress}%"></em></div><b>${remaining === null ? 'Target needed' : remaining === 0 ? 'Goal reached' : `${formatKpiValue(remaining, kpi.displayFormat)} remaining`}</b></div>${meta}`;
    return;
  }

  if (displayType === 'gauge') {
    const value = Number(kpi.value);
    const configuredMax = Number(kpi.goalValue);
    const maximum = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : Math.max(10, 10 ** Math.ceil(Math.log10(Math.max(1, Math.abs(value)))));
    const progress = clampPercent((value / maximum) * 100);
    card.innerHTML = `${title}<div class="tv-gauge" style="--tv-gauge-turn:${(progress / 100).toFixed(4)}turn"><div><strong>${escapeHtml(formatKpiValue(value, kpi.displayFormat))}</strong><span>${progress.toFixed(1)}%</span><small>of ${escapeHtml(formatKpiValue(maximum, kpi.displayFormat))}</small></div></div>${meta}`;
    return;
  }

  if (compositeScorecard) {
    const progress = payload.goal.value === 0 ? null : clampPercent((Number(payload.metric.value) / Number(payload.goal.value)) * 100);
    card.innerHTML = `${title}<div class="tv-scorecard-rep"><small>${escapeHtml(payload.rep.label)}</small><strong>${escapeHtml(payload.rep.value)}</strong></div><div class="tv-scorecard-metric"><span>${escapeHtml(payload.metric.label === 'Metric' ? kpi.name : payload.metric.label)}</span><strong>${escapeHtml(formatKpiValue(payload.metric.value, kpi.displayFormat))}</strong></div><div class="tv-scorecard-goal"><span><small>${escapeHtml(payload.goal.label)}</small><b>${escapeHtml(formatKpiValue(payload.goal.value, kpi.displayFormat))}</b></span><strong>${progress === null ? 'Goal unavailable' : `${progress.toFixed(1)}%`}</strong></div><div class="tv-progress-track"><i style="width:${progress ?? 0}%"></i></div>${meta}`;
    return;
  }

  if (displayType === 'scorecard' || !payload.kind) {
    const progress = kpi.goalValue ? clampPercent((Number(kpi.value) / Number(kpi.goalValue)) * 100) : null;
    card.innerHTML = `${title}<div class="tv-scorecard-value"><strong>${escapeHtml(formatKpiValue(kpi.value, kpi.displayFormat))}</strong><span>${escapeHtml(tvKpiContext(kpi))}</span>${progress === null ? '' : `<div class="tv-progress-track"><i style="width:${progress}%"></i></div>`}</div>${meta}`;
    return;
  }

  if (displayType === 'rep_cards') {
    const period = periodLabels[kpi.periodGranularity] || 'Monthly';
    const cards = (payload.items || []).slice(0, 8).map((item) => {
      const target = item.goalValue ?? item.comparisonValue ?? kpi.goalValue;
      const progress = !target ? null : clampPercent((Number(item.value) / Number(target)) * 100);
      return `<article class="tv-rep-card"><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong><span>${progress === null ? `${period} value` : `${progress.toFixed(0)}% of ${formatKpiValue(target, kpi.displayFormat)}`}</span><i><b style="width:${progress ?? 100}%"></b></i></article>`;
    }).join('');
    card.innerHTML = `${title}<div class="tv-card-subtitle">${escapeHtml(period)} · ${escapeHtml(pairedDataLabel(payload, 'Value'))}</div><div class="tv-rep-card-grid">${cards}</div>${meta}`;
    return;
  }

  if (displayType === 'leaderboard') {
    const labelHeader = payload.headers?.label || 'Rank';
    const valueHeader = payload.headers?.value || 'Value';
    const rows = [...(payload.items || [])].sort((a, b) => Number(b.value) - Number(a.value)).slice(0, 10).map((item, index) => `<div class="tv-leaderboard-row"><b>${index + 1}</b><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong></div>`).join('');
    card.innerHTML = `${title}<div class="tv-leaderboard"><div class="tv-leaderboard-row tv-leaderboard-head"><b>#</b><span>${escapeHtml(labelHeader)}</span><strong>${escapeHtml(valueHeader)}</strong></div>${rows}</div>${meta}`;
    return;
  }

  if (displayType === 'trend') {
    card.innerHTML = `${title}<div class="tv-card-subtitle">${escapeHtml(pairedDataLabel(payload, 'Trend'))}</div>${renderTvTrend(payload.items, kpi.displayFormat)}${meta}`;
    return;
  }

  if (displayType === 'category_bar') {
    const maximum = Math.max(1, ...(payload.items || []).map((item) => Math.abs(Number(item.value))).filter(Number.isFinite));
    const rows = (payload.items || []).slice(0, 10).map((item) => `<div class="tv-category-row"><span>${escapeHtml(item.label)}</span><i><b style="width:${clampPercent((Math.abs(Number(item.value)) / maximum) * 100)}%"></b></i><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong></div>`).join('');
    card.innerHTML = `${title}<div class="tv-card-subtitle">${escapeHtml(pairedDataLabel(payload, 'Category value'))}</div><div class="tv-category-bars">${rows}</div>${meta}`;
    return;
  }

  if (displayType === 'funnel') {
    const stages = (payload.items || []).filter((item) => Number.isFinite(Number(item.value))).slice(0, 8);
    const maximum = Math.max(1, ...stages.map((item) => Math.abs(Number(item.value))));
    const rows = stages.map((item, index) => {
      const previous = index ? Math.abs(Number(stages[index - 1].value)) : null;
      const conversion = previous ? `${((Math.abs(Number(item.value)) / previous) * 100).toFixed(0)}%` : 'Start';
      const width = 38 + (Math.abs(Number(item.value)) / maximum) * 62;
      return `<div style="width:${width.toFixed(1)}%"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong><small>${conversion}</small></div>`;
    }).join('');
    card.innerHTML = `${title}<div class="tv-funnel">${rows}</div>${meta}`;
    return;
  }

  if (displayType === 'pipeline') {
    const stages = (payload.items || []).filter((item) => Number.isFinite(Number(item.value))).slice(0, 8).map((item, index) => `<article><small>${index + 1}</small><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatKpiValue(item.value, kpi.displayFormat))}</strong></article>`).join('');
    card.innerHTML = `${title}<div class="tv-pipeline">${stages}</div>${meta}`;
    return;
  }

  if (displayType === 'activity_feed') {
    const entries = (payload.entries || []).slice(0, 8).map((entry) => `<div class="tv-activity-row"><time>${escapeHtml(entry.timestamp)}</time><span><strong>${escapeHtml(entry.label)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}</span>${entry.value !== null && entry.value !== '' ? `<b>${escapeHtml(entry.value)}</b>` : ''}</div>`).join('');
    card.innerHTML = `${title}<div class="tv-activity-feed">${entries}</div>${meta}`;
    return;
  }

  if (displayType === 'heatmap') {
    const range = Number(payload.max) - Number(payload.min) || 1;
    const columns = Math.max(1, payload.xLabels?.length || 1);
    const heatmapHeader = `<span>${escapeHtml(payload.cornerLabel || '')}</span>${(payload.xLabels || []).map((label) => `<strong>${escapeHtml(label)}</strong>`).join('')}`;
    const rows = (payload.yLabels || []).slice(0, 8).map((label, rowIndex) => `<b>${escapeHtml(label)}</b>${(payload.cells[rowIndex] || []).map((value) => {
      const intensity = 0.2 + ((Number(value) - Number(payload.min)) / range) * 0.8;
      return `<i style="--tv-heat:${intensity.toFixed(3)}">${escapeHtml(formatKpiValue(value, kpi.displayFormat))}</i>`;
    }).join('')}`).join('');
    card.innerHTML = `${title}<div class="tv-heatmap-scroll"><div class="tv-heatmap" style="--tv-heatmap-columns:${columns}"><header>${heatmapHeader}</header>${rows}</div></div>${meta}`;
    return;
  }

  const columns = (payload.columns || []).map((column) => `<th>${escapeHtml(column)}</th>`).join('');
  const rows = (payload.rows || []).slice(0, 10).map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  card.innerHTML = `${title}<div class="tv-table-scroll"><table class="tv-table"><thead><tr>${columns}</tr></thead><tbody>${rows}</tbody></table></div>${meta}`;
}

function orderedTvKpis() {
  const order = normalizeDashboardLayout(liveDashboardLayout || {}, liveKpis.map((kpi) => kpi.id)).kpiOrder;
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  return [...liveKpis].sort((a, b) => (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

function updateTvClock() {
  const clock = document.querySelector('#tvClock');
  if (clock) {
    clock.dateTime = new Date().toISOString();
    clock.textContent = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(new Date());
  }
}

function setTvConnectionState(state) {
  const status = document.querySelector('#tvConnectionState');
  if (!status) return;
  status.dataset.state = state;
  status.textContent = state === 'live' ? '● Live' : state === 'offline' ? '● Last good view' : '● Connecting';
  const modal = document.querySelector('#tvPreviewModal');
  modal?.classList.toggle('is-offline', state === 'offline');
}

function renderTvPagination(pageCount) {
  const dots = document.querySelector('#tvPageDots');
  if (dots) dots.innerHTML = Array.from({ length: pageCount }, (_, index) => `<i class="${index === tvPageIndex ? 'is-active' : ''}" aria-hidden="true"></i>`).join('');
  const previous = document.querySelector('#tvPreviousPage');
  const next = document.querySelector('#tvNextPage');
  if (previous) previous.disabled = pageCount <= 1;
  if (next) next.disabled = pageCount <= 1;
}

function renderTvMode() {
  const grid = document.querySelector('#tvKpiGrid');
  if (!grid) return;
  const visibleKpis = orderedTvKpis();
  const pageCount = Math.max(1, Math.ceil(visibleKpis.length / tvPageSize));
  tvPageIndex = Math.min(tvPageIndex, pageCount - 1);
  const pageKpis = visibleKpis.slice(tvPageIndex * tvPageSize, (tvPageIndex + 1) * tvPageSize);
  document.querySelector('#tvPreviewTitle').textContent = liveWorkspaceName ? `${liveWorkspaceName} dashboard` : 'Dashboard';
  document.querySelector('#tvPreviewEyebrow').textContent = `${liveWorkspaceName || 'CURRENT WORKSPACE'} · ${visibleKpis.length} LIVE KPI${visibleKpis.length === 1 ? '' : 'S'} · PAGE ${tvPageIndex + 1}/${pageCount}`.toUpperCase();
  const brandMark = document.querySelector('.tv-customer-logo');
  if (brandMark) brandMark.textContent = (liveBrand?.name || liveWorkspaceName || 'W').trim().charAt(0).toUpperCase();
  grid.dataset.pageItems = String(pageKpis.length);
  renderTvPagination(pageCount);
  if (!visibleKpis.length) {
    grid.innerHTML = '<article class="tv-empty-card"><small>THIS WORKSPACE</small><strong>No KPIs yet</strong><span>Add a KPI to populate TV mode.</span></article>';
    document.querySelector('#tvDashboardContext strong').textContent = 'This display is connected only to the authenticated workspace.';
    document.querySelector('#tvDashboardContext .tv-source-summary').innerHTML = '<span>Tenant isolated</span><span>No sample data</span>';
    document.querySelector('#tvFreshness').textContent = 'Waiting for the first KPI';
    return;
  }
  grid.replaceChildren(...pageKpis.map((kpi) => {
    const card = document.createElement('article');
    renderTvKpiCard(card, kpi);
    return card;
  }));
  const freshest = visibleKpis.reduce((latest, kpi) => !latest || new Date(kpi.fetchedAt) > new Date(latest.fetchedAt) ? kpi : latest, null);
  document.querySelector('#tvDashboardContext strong').textContent = `${visibleKpis.length} workspace KPI${visibleKpis.length === 1 ? '' : 's'} shown in the saved dashboard order`;
  document.querySelector('#tvDashboardContext .tv-source-summary').innerHTML = `<span>Verified metrics</span><span>${escapeHtml(liveWorkspaceName)}</span><span>${escapeHtml(freshest?.status || 'unknown')}</span>`;
  document.querySelector('#tvFreshness').textContent = `Live · freshest update ${timeAgo(freshest?.fetchedAt)}`;
  updateTvClock();
}

function startLoopCountdown() {
  const countdown = document.querySelector('#loopCountdown');
  tvRefreshSeconds = 45;
  tvRotationSeconds = 15;
  countdown.textContent = tvRefreshSeconds;
  window.clearInterval(loopTimer);
  loopTimer = window.setInterval(async () => {
    tvRefreshSeconds -= 1;
    if (!tvRotationPaused && orderedTvKpis().length > tvPageSize) tvRotationSeconds -= 1;
    if (tvRotationSeconds <= 0) {
      const pages = Math.max(1, Math.ceil(orderedTvKpis().length / tvPageSize));
      tvPageIndex = (tvPageIndex + 1) % pages;
      tvRotationSeconds = 15;
      renderTvMode();
    }
    if (tvRefreshSeconds <= 0) {
      tvRefreshSeconds = 45;
      await loadLiveData();
      renderTvMode();
    }
    countdown.textContent = tvRefreshSeconds;
    updateTvClock();
  }, 1000);
}

function moveTvPage(delta) {
  const pages = Math.max(1, Math.ceil(orderedTvKpis().length / tvPageSize));
  tvPageIndex = (tvPageIndex + delta + pages) % pages;
  tvRotationSeconds = 15;
  renderTvMode();
}

function toggleTvRotation() {
  tvRotationPaused = !tvRotationPaused;
  const button = document.querySelector('#tvPauseRotation');
  button.setAttribute('aria-pressed', String(tvRotationPaused));
  button.textContent = tvRotationPaused ? 'Resume' : 'Pause';
}

async function toggleTvFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    showToast('Fullscreen unavailable', error.message || 'The browser blocked fullscreen mode.');
  }
}

function openFeatureModal(id, trigger = document.activeElement) {
  const modal = document.querySelector(`#${id}`);
  if (!modal) return;
  featureReturnFocus = trigger;
  activeFeatureModal = modal;
  modal.classList.add('is-visible');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  if (id === 'automationEditorModal') document.querySelector('.app-shell').inert = true;
  modal.querySelector('[data-close-feature]')?.focus();
  if (id === 'tvPreviewModal') {
    renderTvMode();
    startLoopCountdown();
  }
}

function closeFeatureModal(modal = activeFeatureModal) {
  if (!modal) return;
  if (modal.id === 'tvPreviewModal' && dedicatedTvRuntime) {
    location.assign('/app');
    return;
  }
  if (modal.id === 'workflowModal' && activeWorkflow === 'layout' && layoutEditSnapshot) {
    applyDashboardLayout(layoutEditSnapshot);
    layoutEditSnapshot = null;
    layoutDraft = null;
  }
  modal.classList.remove('is-visible');
  modal.setAttribute('aria-hidden', 'true');
  if (modal.id === 'automationEditorModal') document.querySelector('.app-shell').inert = false;
  if (modal.id === 'tvPreviewModal') {
    window.clearInterval(loopTimer);
  }
  activeFeatureModal = null;
  document.body.style.overflow = '';
  featureReturnFocus?.focus?.();
}

document.querySelector('#templateGalleryButton').addEventListener('click', (event) => openFeatureModal('templateModal', event.currentTarget));
document.querySelector('#shareDashboardButton').addEventListener('click', (event) => openFeatureModal('shareModal', event.currentTarget));
document.querySelector('#openTvMode').addEventListener('click', (event) => openFeatureModal('tvPreviewModal', event.currentTarget));
document.querySelector('#previewLoopButton').addEventListener('click', (event) => openFeatureModal('tvPreviewModal', event.currentTarget));
document.querySelector('#openDedicatedTv').addEventListener('click', () => {
  if (dedicatedTvRuntime) location.assign('/app');
  else window.open('/tv', '_blank', 'noopener');
});
document.querySelector('#tvFullscreen').addEventListener('click', toggleTvFullscreen);
document.querySelector('#tvPreviousPage').addEventListener('click', () => moveTvPage(-1));
document.querySelector('#tvNextPage').addEventListener('click', () => moveTvPage(1));
document.querySelector('#tvPauseRotation').addEventListener('click', toggleTvRotation);
document.addEventListener('fullscreenchange', () => {
  const button = document.querySelector('#tvFullscreen');
  button.textContent = document.fullscreenElement ? '↙' : '⛶';
  button.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
});
window.addEventListener('online', () => { setTvConnectionState('loading'); loadLiveData(); });
window.addEventListener('offline', () => setTvConnectionState('offline'));
document.addEventListener('keydown', (event) => {
  if (activeFeatureModal?.id !== 'tvPreviewModal') return;
  if (event.key === 'ArrowRight') { event.preventDefault(); moveTvPage(1); }
  else if (event.key === 'ArrowLeft') { event.preventDefault(); moveTvPage(-1); }
  else if (event.key === ' ' || event.key.toLowerCase() === 'p') { event.preventDefault(); toggleTvRotation(); }
  else if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleTvFullscreen(); }
});
document.querySelector('#previewRuntimeCompatibility').addEventListener('click', (event) => {
  openFeatureModal('tvPreviewModal', event.currentTarget);
  showToast('Compatibility preview ready', 'Customer branding, cached fallback, reduced motion, and silent captions are represented.');
});
document.querySelector('#manageRuntimeButton').addEventListener('click', (event) => openWorkflow('screen', event.currentTarget, 'Display runtime policy'));
document.querySelector('#previewAllBrandSurfaces').addEventListener('click', (event) => {
  openFeatureModal('tvPreviewModal', event.currentTarget);
  showToast('TV brand preview opened', 'This local preview does not verify or publish a brand package to any customer-facing runtime.');
});

document.querySelectorAll('[data-close-feature]').forEach((button) => button.addEventListener('click', () => closeFeatureModal(button.closest('.feature-overlay'))));
featureModals.forEach((modal) => modal.addEventListener('click', (event) => {
  if (event.target === modal) closeFeatureModal(modal);
}));

document.querySelectorAll('.template-filters button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.template-filters button').forEach((item) => item.classList.toggle('is-active', item === button));
  showToast(`${button.textContent} recipes`, 'The gallery is filtered for this team.');
}));

document.querySelectorAll('.use-template').forEach((button) => button.addEventListener('click', () => {
  const template = button.dataset.template;
  if (button.textContent.includes('Preview')) {
    openWorkflow('dashboard', button, `${template} recipe`);
    return;
  }
  closeFeatureModal(button.closest('.feature-overlay'));
  showScreen('dashboard');
  showToast(`${template} installed`, 'KPIs, alerts, celebrations, and the TV loop were added as a draft.');
}));

shareTabs.forEach((button) => button.addEventListener('click', () => {
  shareTabs.forEach((tab) => tab.classList.toggle('is-active', tab === button));
  sharePanels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.sharePanel === button.dataset.shareTab));
}));

document.querySelectorAll('.destination-grid button').forEach((button) => button.addEventListener('click', () => {
  button.classList.toggle('is-selected');
}));

document.querySelector('#copyShareLink').addEventListener('click', async () => {
  const input = document.querySelector('.share-link-row input');
  try { await navigator.clipboard.writeText(input.value); } catch { input.select(); }
  showToast('Secure link copied', 'The viewer link is ready to share.');
});
document.querySelector('#createShareLink').addEventListener('click', () => showToast('Secure link created', 'Passcode protection and 30-day expiry are active.'));
document.querySelector('#saveSnapshotSchedule').addEventListener('click', () => showToast('Delivery scheduled', 'The dashboard snapshot will post on weekdays at 8:00 AM.'));
document.querySelector('.share-panel[data-share-panel="embed"] .button').addEventListener('click', () => showToast('Embed code generated', 'A scoped, revocable viewer token is ready.'));

const drilldownData = {
  'net-sales': { title: 'Net sales today', subtitle: '$55,396 · refreshed 2 minutes ago', source: 'Google Sheets', path: '2026 Sales Performance → Summary → D8', value: '$55,396', formula: 'Single value · D8', mark: 'G', provider: 'google', table: 'Source cells and contributing rows' },
  pipeline: { title: 'Open pipeline', subtitle: '$1.28M · refreshed 4 minutes ago', source: 'HubSpot', path: 'Deals → amount · open stages', value: '$1.28M', formula: 'SUM(amount)', mark: 'H', provider: 'hubspot', table: 'Open deals contributing to pipeline' },
  'deals-won': { title: 'Deals won', subtitle: '34 · refreshed 4 minutes ago', source: 'HubSpot', path: 'Deals → dealstage · closedwon', value: '34', formula: 'COUNT(deal_id)', mark: 'H', provider: 'hubspot', table: 'Closed-won deals in this period' },
  'team-track': { title: 'Team on track', subtitle: '82.9% · refreshed 2 minutes ago', source: 'Google Sheets', path: '2026 Sales Performance → Rep Performance → G4:G18', value: '82.9%', formula: '13 ÷ 16 reps', mark: 'G', provider: 'google', table: 'Rep attainment and goal status' }
};

function openDrilldown(key, trigger) {
  const data = drilldownData[key] || drilldownData['net-sales'];
  document.querySelector('#drilldownTitle').textContent = data.title;
  document.querySelector('#drilldownSubtitle').textContent = data.subtitle;
  document.querySelector('#drilldownSource').textContent = data.source;
  document.querySelector('#drilldownPath').textContent = data.path;
  document.querySelector('#drilldownValue').textContent = data.value;
  document.querySelector('#drilldownFormula').textContent = data.formula;
  document.querySelector('#drilldownTableTitle').textContent = data.table;
  const mark = document.querySelector('#drilldownSourceMark');
  mark.textContent = data.mark;
  mark.classList.toggle('google', data.provider === 'google');
  mark.classList.toggle('hubspot', data.provider === 'hubspot');
  document.querySelector('#openSourceButton').hidden = false;
  openFeatureModal('drilldownModal', trigger);
}

async function openLiveMetricTrust(mappingId, trigger) {
  const payload = await apiJson(`/api/axoboard/metrics/${encodeURIComponent(mappingId)}/trust`);
  const metric = payload.metric || {};
  const certification = metric.certification || {};
  const freshness = metric.freshness || {};
  const source = metric.source || null;
  const provider = String(source?.provider || '').toLowerCase();
  const providerName = provider === 'google_sheets' || provider === 'google'
    ? 'Google Sheets'
    : provider ? provider.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Certified metric';
  const sourcePath = source
    ? [source.spreadsheetTitle, source.sheetTitle, source.range].filter(Boolean).join(' → ') || 'Certified source details unavailable'
    : 'Source details are hidden for this role';
  const verifiedAt = freshness.fetchedAt || freshness.lastSyncAt;
  const certificationStatus = String(certification.status || 'certified').replaceAll('_', ' ');
  document.querySelector('#drilldownTitle').textContent = `${metric.name || 'Metric'} · Certified metric`;
  document.querySelector('#drilldownSubtitle').textContent = `${certificationStatus} · ${verifiedAt ? `verified ${timeAgo(verifiedAt)}` : 'verification time not reported'}`;
  document.querySelector('#drilldownSource').textContent = providerName;
  document.querySelector('#drilldownPath').textContent = sourcePath;
  const liveKpi = liveKpis.find((kpi) => kpi.id === mappingId);
  document.querySelector('#drilldownValue').textContent = liveKpi ? formatKpiValue(liveKpi.value, liveKpi.displayFormat) : '—';
  const refreshSeconds = Number(freshness.refreshSeconds);
  document.querySelector('#drilldownFormula').textContent = Number.isFinite(refreshSeconds) && refreshSeconds > 0
    ? `Certified read-only metric · refresh ${Math.round(refreshSeconds / 60)}m`
    : 'Certified read-only metric';
  const summaryValues = document.querySelectorAll('.drilldown-summary strong');
  if (summaryValues[2]) summaryValues[2].textContent = 'Not reported';
  if (summaryValues[3]) summaryValues[3].textContent = 'Not reported';
  document.querySelector('#drilldownTableTitle').textContent = source ? 'Certified source and immutable lineage' : 'Certified metric access';
  document.querySelector('.drilldown-content aside p').textContent = metric.definition || 'This role can verify certification and freshness without receiving provider, cell, lineage, or metric-definition details.';
  const sourceTable = document.querySelector('.source-table');
  const sourceValue = liveKpi ? formatKpiValue(liveKpi.value, liveKpi.displayFormat) : '—';
  sourceTable.innerHTML = source
    ? `<div class="table-row table-head"><span>Source</span><span>Metric</span><span>Value</span><span>Updated</span></div><div class="table-row"><span>${escapeHtml(source.range || providerName)}</span><strong>${escapeHtml(metric.name || 'Certified metric')}</strong><b>${escapeHtml(sourceValue)}</b><small>${escapeHtml(verifiedAt ? timeAgo(verifiedAt) : 'Not reported')}</small></div>`
    : `<div class="table-row table-head"><span>Access</span><span>Metric</span><span>Value</span><span>Verified</span></div><div class="table-row"><span>Restricted</span><strong>${escapeHtml(metric.name || 'Certified metric')}</strong><b>${escapeHtml(sourceValue)}</b><small>${escapeHtml(verifiedAt ? timeAgo(verifiedAt) : 'Not reported')}</small></div>`;
  const facts = document.querySelectorAll('.drilldown-content aside dd');
  if (facts.length >= 4) {
    facts[0].textContent = liveKpi?.goal?.timezone || 'Workspace timezone';
    const staleAfterSeconds = Number(freshness.staleAfterSeconds);
    facts[1].textContent = Number.isFinite(staleAfterSeconds) && staleAfterSeconds > 0 ? `${Math.round(staleAfterSeconds / 60)} minutes` : 'Policy managed';
    facts[2].textContent = certification.method ? String(certification.method).replaceAll('_', ' ') : 'Certified';
    facts[3].textContent = certification.certifiedAt ? timeAgo(certification.certifiedAt) : 'Not reported';
  }
  const mark = document.querySelector('#drilldownSourceMark');
  mark.textContent = providerName === 'Google Sheets' ? 'G' : source ? providerName.charAt(0) : '✓';
  mark.classList.toggle('google', providerName === 'Google Sheets');
  mark.classList.toggle('hubspot', providerName === 'HubSpot');
  document.querySelector('.lineage-bar .connection-pill').textContent = `● ${freshness.status ? String(freshness.status).replaceAll('_', ' ') : certificationStatus}`;
  document.querySelector('#openSourceButton').hidden = !source;
  const exportButton = document.querySelector('.drilldown-content .table-heading > button');
  exportButton.disabled = true;
  exportButton.textContent = 'Export unavailable';
  const historyButton = document.querySelector('.drilldown-content aside button');
  historyButton.disabled = true;
  historyButton.textContent = 'History unavailable';
  openFeatureModal('drilldownModal', trigger);
}

document.querySelectorAll('.kpi-card[data-drilldown]').forEach((card) => {
  card.addEventListener('click', (event) => {
    if (!event.target.closest('button')) openDrilldown(card.dataset.drilldown, card);
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openDrilldown(card.dataset.drilldown, card);
    }
  });
});
document.querySelectorAll('[data-open-trust], #openMetricTrust').forEach((button) => button.addEventListener('click', (event) => {
  event.stopPropagation();
  const liveMetric = liveKpis.find((kpi) => kpi.certification?.status === 'certified');
  if (liveMetric) {
    openLiveMetricTrust(liveMetric.id, event.currentTarget).catch((error) => showToast('Trust details unavailable', error.message));
    return;
  }
  openDrilldown('net-sales', event.currentTarget);
  document.querySelector('#drilldownTitle').textContent = 'Revenue to goal · Certified metric';
  document.querySelector('#drilldownSubtitle').textContent = '$82,400 · healthy · verified 2 minutes ago';
  document.querySelector('#drilldownValue').textContent = '$82,400';
  document.querySelector('#drilldownFormula').textContent = 'Actual ÷ $100K goal';
}));
document.querySelector('#openSourceButton').addEventListener('click', () => showToast('Source handoff ready', 'Production opens the exact permitted Sheet cell or HubSpot view.'));

document.querySelector('#pairScreenButton').addEventListener('click', openDisplayPairing);
document.querySelector('#displayContentMode').addEventListener('change', (event) => { document.querySelector('#displayKpiSelection').hidden = event.target.value !== 'selected_kpis'; });
document.querySelector('#displayEditorMode').addEventListener('change', (event) => { document.querySelector('#displayEditorKpiSelection').hidden = event.target.value !== 'selected_kpis'; });
document.querySelector('#displayPairingForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#createDisplayPairing');
  button.disabled = true;
  try {
    const contentMode = document.querySelector('#displayContentMode').value;
    const payload = await apiJson('/api/axoboard/displays/pairing-codes', { method: 'POST', body: JSON.stringify({
      name: document.querySelector('#displayName').value,
      contentMode,
      kpiIds: contentMode === 'selected_kpis' ? selectedDisplayKpis(document.querySelector('#displayKpiOptions')) : [],
      rotationSeconds: Number(document.querySelector('#displayRotationSeconds').value)
    }) });
    document.querySelector('#displayPairingDestination').textContent = `OPEN ${payload.pairing.url}`;
    document.querySelector('#displayPairingCode').textContent = payload.pairing.code;
    document.querySelector('#displayPairingExpiry').textContent = `Expires ${new Date(payload.pairing.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    document.querySelector('#displayPairingResult').hidden = false;
    button.hidden = true;
    liveDisplays = [payload.display, ...liveDisplays];
    renderLiveDisplays();
  } catch (error) { showToast('Could not create pairing code', error.message); }
  finally { button.disabled = false; }
});
document.querySelector('#displayEditorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.querySelector('#displayEditorId').value;
  const mode = document.querySelector('#displayEditorMode').value;
  try {
    const payload = await apiJson(`/api/axoboard/displays/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({
      name: document.querySelector('#displayEditorName').value,
      contentMode: mode,
      kpiIds: mode === 'selected_kpis' ? selectedDisplayKpis(document.querySelector('#displayEditorKpiOptions')) : [],
      rotationSeconds: Number(document.querySelector('#displayEditorRotation').value)
    }) });
    liveDisplays = liveDisplays.map((display) => display.id === id ? payload.display : display);
    renderLiveDisplays();
    closeFeatureModal(document.querySelector('#displayEditorModal'));
    showToast('Screen updated', `${payload.display.name} will load the new assignment on its next refresh.`);
  } catch (error) { showToast('Could not update screen', error.message); }
});
document.querySelector('#revokeDisplay').addEventListener('click', async () => {
  const id = document.querySelector('#displayEditorId').value;
  const display = liveDisplays.find((item) => item.id === id);
  if (!display || !window.confirm(`Revoke “${display.name}”?\n\nThe TV will return to the pairing screen and cannot access workspace data.`)) return;
  try {
    const payload = await apiJson(`/api/axoboard/displays/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
    liveDisplays = liveDisplays.map((item) => item.id === id ? payload.display : item);
    renderLiveDisplays();
    closeFeatureModal(document.querySelector('#displayEditorModal'));
    showToast('Screen revoked', 'Its persistent display session can no longer load workspace data.');
  } catch (error) { showToast('Could not revoke screen', error.message); }
});
document.querySelector('#saveLoopButton').addEventListener('click', () => showToast('Revenue pulse saved', 'Three views will rotate during active hours.'));
document.querySelector('.add-loop-view').addEventListener('click', () => showToast('Content picker ready', 'Add any dashboard, celebration reel, or competition to this loop.'));
document.querySelectorAll('[data-move-loop]').forEach((button) => button.addEventListener('click', () => {
  const item = button.closest('li');
  const list = document.querySelector('#loopSequence');
  const next = item.nextElementSibling;
  if (next) list.insertBefore(next, item);
  else list.prepend(item);
  [...list.children].forEach((row, index, rows) => {
    row.querySelector('b').textContent = index + 1;
    const moveButton = row.querySelector('[data-move-loop]');
    const label = row.querySelector('strong').textContent;
    moveButton.textContent = index === rows.length - 1 ? '↑' : '↓';
    moveButton.setAttribute('aria-label', index === rows.length - 1 ? `Move ${label} to top` : `Move ${label} down`);
  });
  showToast('Loop order updated', `${item.querySelector('strong').textContent} moved to position ${item.querySelector('b').textContent}.`);
}));
document.querySelectorAll('.screen-device footer button').forEach((button) => button.addEventListener('click', () => {
  showToast(button.textContent.includes('Wake') ? 'Wake signal sent' : 'Display control ready', 'The screen will update on its next heartbeat.');
}));

document.querySelectorAll('[data-automation-tab]').forEach((button) => button.addEventListener('click', () => switchAutomationTab(button.dataset.automationTab)));
document.querySelector('#viewRunLogButton').addEventListener('click', () => switchAutomationTab('runs', { focus: true }));
document.querySelector('#newAutomationButton').addEventListener('click', (event) => openAutomationEditor({ trigger: event.currentTarget }).catch((error) => showToast('Automation cannot be created', error.message)));
document.querySelector('#createKpiAutomation').addEventListener('click', (event) => openAutomationEditor({ kpi: automationEditorKpi, trigger: event.currentTarget }).catch((error) => showToast('Automation cannot be created', error.message)));
document.querySelector('#automationRuleSearch').addEventListener('input', renderAutomationRules);
document.querySelector('#automationRuleStatusFilter').addEventListener('change', renderAutomationRules);
document.querySelector('#automationMetricFilter').addEventListener('change', renderAutomationRules);
document.querySelector('#automationRunStatusFilter').addEventListener('change', loadAutomationRuns);
document.querySelector('#automationRunRuleFilter').addEventListener('change', loadAutomationRuns);
document.querySelector('#refreshAutomationRuns').addEventListener('click', loadAutomationRuns);
document.querySelector('#automationMetricId').addEventListener('change', syncStructuredAutomationBoundary);
document.querySelector('#automationQuietHoursEnabled').addEventListener('change', (event) => { document.querySelector('#automationQuietHoursFields').hidden = !event.target.checked; });
document.querySelectorAll('[data-automation-editor-step]').forEach((button) => button.addEventListener('click', () => {
  const nextStep = Number(button.dataset.automationEditorStep);
  try {
    if (nextStep > activeAutomationEditorStep) {
      for (let step = activeAutomationEditorStep; step < nextStep; step += 1) validateAutomationStep(step);
    }
    showAutomationEditorStep(nextStep);
  } catch (error) { showAutomationFormError(error.message); }
}));
document.querySelector('#automationEditorBack').addEventListener('click', () => showAutomationEditorStep(activeAutomationEditorStep - 1));
document.querySelector('#automationEditorNext').addEventListener('click', async () => {
  const button = document.querySelector('#automationEditorNext');
  button.disabled = true;
  try {
    if (activeAutomationEditorStep < 4) {
      validateAutomationStep(activeAutomationEditorStep);
      showAutomationEditorStep(activeAutomationEditorStep + 1);
    } else await publishAutomation();
  } catch (error) { showAutomationFormError(error.message); }
  finally { button.disabled = false; }
});
document.querySelector('#automationSaveDraftButton').addEventListener('click', async () => {
  const button = document.querySelector('#automationSaveDraftButton');
  button.disabled = true;
  try { await saveAutomationDraft(); }
  catch (error) { showAutomationFormError(error.message); }
  finally { button.disabled = false; }
});
document.querySelector('#automationDryRunButton').addEventListener('click', runAutomationDryTest);
document.querySelector('#createPromptAutomation').addEventListener('click', (event) => {
  const prompt = document.querySelector('#kpiAutomationPrompt');
  prompt.hidden = true;
  openAutomationEditor({ kpi: pendingPromptKpi, trigger: event.currentTarget }).catch((error) => showToast('Automation cannot be created', error.message));
});
document.querySelector('#dismissPromptAutomation').addEventListener('click', () => { document.querySelector('#kpiAutomationPrompt').hidden = true; pendingPromptKpi = null; });

document.addEventListener('keydown', (event) => {
  if (event.key === 'Tab' && activeFeatureModal?.id === 'automationEditorModal') {
    const focusable = [...activeFeatureModal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((element) => !element.closest('[hidden]') && element.getClientRects().length);
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  if (event.key === 'Escape' && activeFeatureModal) closeFeatureModal(activeFeatureModal);
});

const workflowDefinitions = {
  workspace: { eyebrow: 'WORKSPACE ACCESS', title: 'Switch workspace', description: 'Move between tenants without mixing data, brands, permissions, or credentials.', steps: ['Choose workspace','Confirm context'], primary: 'Switch workspace', canvas: '<h3>Your workspaces</h3><p>New workspace is an empty onboarding sample; Acme Sales contains populated synthetic fixtures.</p><div class="workflow-grid"><button class="workflow-card" data-workspace-id="sample-empty" type="button"><span>N</span><strong>New workspace</strong><small>Owner · blank OAuth test workspace</small><i>Choose</i></button><button class="workflow-card" data-workspace-id="acme" type="button"><span>A</span><strong>Acme Sales</strong><small>Owner · populated sample tenant</small><i>Choose</i></button></div>', context: '<h3>Tenant boundary</h3><p>Dashboards, integrations, assets, rules, tokens, and games remain isolated by workspace.</p><div class="workflow-summary"><div><small>NEW WORKSPACE</small><strong>No inherited credentials</strong></div><div><small>SESSION</small><strong>Revalidated on switch</strong></div></div>' },
  profile: { eyebrow: 'ACCOUNT & PREFERENCES', title: 'Profile controls unavailable', description: 'Personal preferences and security sessions need a dedicated account API before they can be managed here.', steps: ['Availability'], primary: 'Close preview', canvas: '<h3>No profile record is being inferred</h3><p>AxoBoard will show identity, notification preferences, MFA state, and sessions only after they are returned by an authorized account service.</p>', context: '<h3>Account boundary</h3><p>This preview does not claim a role, MFA state, sign-in time, or active-device count.</p>' },
  dashboard: { eyebrow: 'DASHBOARD CONFIGURATION', title: 'Edit dashboard', description: 'Change the time window, layout, refresh behavior, and card settings.', steps: ['Configure','Preview','Publish'], primary: 'Preview changes', canvas: '<h3>Dashboard settings</h3><p>Changes stay in a draft until you publish them.</p><div class="workflow-form"><div class="field-row"><label>Time window<select><option>Today</option><option>This week</option><option>This month</option><option>Rolling 30 days</option></select></label><label>Refresh interval<select><option>Every 5 minutes</option><option>Every minute</option><option>Every 15 minutes</option></select></label></div><label>Layout density<select><option>Comfortable</option><option>Compact</option><option>TV optimized</option></select></label><div class="workflow-checks"><label><input type="checkbox" checked /> Show source and freshness on every card</label><label><input type="checkbox" checked /> Preserve mobile card order</label></div></div>', context: '<h3>Draft impact</h3><p>4 KPI cards, 1 trend chart, and 3 attention rules use this dashboard.</p><div class="workflow-preview"><span>▦</span><strong>Sales performance</strong><small>Responsive preview · no live changes</small></div>' },
  layout: { eyebrow: 'DASHBOARD LAYOUT', title: 'Change layout', description: 'Choose a responsive preset, show the sections you need, and put KPIs in the right order.', steps: ['Arrange','Review'], primary: 'Review layout', canvas: '<h3>Shape the dashboard around the decision</h3><p>Every change previews immediately. Cancel restores the layout you started with.</p><fieldset class="layout-preset-fieldset"><legend>Layout preset</legend><div class="layout-preset-options"><label><input type="radio" name="layoutPreset" value="balanced" /><span class="layout-preset-icon balanced" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>Balanced</strong><small>Equal KPI cards with trend and actions below.</small></label><label><input type="radio" name="layoutPreset" value="kpi-focus" /><span class="layout-preset-icon kpi-focus" aria-hidden="true"><i></i><i></i><i></i></span><strong>KPI focus</strong><small>Lead with the first KPI and give the score more room.</small></label><label><input type="radio" name="layoutPreset" value="compact" /><span class="layout-preset-icon compact" aria-hidden="true"><i></i><i></i><i></i><i></i></span><strong>Compact</strong><small>Reduce card height to scan more at once.</small></label></div></fieldset><fieldset class="layout-section-fieldset"><legend>Dashboard sections</legend><div class="workflow-checks layout-visibility-options"><label><input id="layoutShowTrend" type="checkbox" /><span><strong>Trend chart</strong><small>Revenue momentum and period comparison</small></span></label><label><input id="layoutShowActionCenter" type="checkbox" /><span><strong>Action Center</strong><small>Alerts and next-best actions</small></span></label></div></fieldset><div class="layout-order-heading"><div><strong>KPI order</strong><small>Use Move up and Move down for a keyboard-safe order.</small></div></div><ol class="layout-order-list" id="layoutKpiOrder"></ol>', context: '<h3>Live layout preview</h3><p>This preview and the dashboard behind it update together. Nothing is sent to a server.</p><div class="layout-mini-preview" data-layout-preview><div class="layout-mini-kpis" data-layout-preview-kpis></div><span class="layout-mini-section trend" data-layout-preview-trend>Trend chart</span><span class="layout-mini-section actions" data-layout-preview-actions>Action Center</span><span class="layout-mini-empty" data-layout-preview-empty hidden>KPI cards only</span></div><div class="workflow-summary"><div><small>PERSISTENCE</small><strong>This browser only</strong></div><div><small>MOBILE</small><strong>Order becomes a single column</strong></div><div><small>SERVER STATUS</small><strong>Not published</strong></div></div>' },
  kpi: { eyebrow: 'KPI SETTINGS', title: 'Edit KPI card', description: 'Update source data, appearance, goal, and comparison behavior.', steps: ['Source','Data','Display','Publish'], primary: 'Review KPI', canvas: '<h3>Metric and display</h3><p>The source contract stays visible while you customize the card.</p><div class="workflow-form"><label>KPI name<input value="Net sales today" /></label><div class="field-row"><label>Format<select><option>Currency · no decimals</option><option>Number</option><option>Percentage</option></select></label><label>Goal<input value="$65,000" /></label></div><label>Comparison<select><option>Versus another Sheets cell</option><option>Versus a matching Sheets range</option><option>Versus goal only</option></select></label><div class="workflow-checks"><label><input type="checkbox" checked /> Enable source drilldown</label><label><input type="checkbox" checked /> Show stale warning after 15 minutes</label></div></div>', context: '<h3>Trusted source</h3><p>Google Sheets → 2026 Sales Performance → Summary!D8</p><div class="workflow-summary"><div><small>CURRENT VALUE</small><strong>$55,396</strong></div><div><small>FRESHNESS</small><strong>2 minutes ago · healthy</strong></div><div><small>OWNER</small><strong>Sales Ops</strong></div></div>' },
  alert: { eyebrow: 'ALERT & ACTION BUILDER', title: 'Configure an alert', description: 'Turn a trusted KPI condition into controlled notifications and team actions.', steps: ['Trigger','Actions','Guardrails','Test'], primary: 'Test rule', canvas: '<h3>When should this run?</h3><p>Rules evaluate normalized KPI snapshots—not raw browser values.</p><div class="workflow-form"><div class="field-row"><label>KPI<select><option>Pipeline coverage</option><option>Net sales today</option><option>Team on track</option></select></label><label>Condition<select><option>Falls below</option><option>Reaches</option><option>Changes by more than</option></select></label></div><div class="field-row"><label>Threshold<input value="3×" /></label><label>For at least<select><option>30 minutes</option><option>Immediately</option><option>1 hour</option></select></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> Slack #sales-leadership</label><label><input type="checkbox" /> Email the metric owner</label><label><input type="checkbox" /> Start a quiet celebration</label></div></div>', context: '<h3>Guardrail preview</h3><p>This would have run twice in the last 30 days.</p><div class="workflow-summary"><div><small>COOLDOWN</small><strong>4 hours</strong></div><div><small>QUIET HOURS</small><strong>8 PM–7 AM</strong></div><div><small>STALE DATA</small><strong>Block rule</strong></div></div>' },
  connector: { eyebrow: 'INTEGRATION SETUP', title: 'Connect a data source', description: 'Authorize the smallest useful scope, validate it, and create the first mapping.', steps: ['Choose source','Authorize','Validate','Map data'], primary: 'Review setup', canvas: '<h3>Connector roadmap</h3><p>Deep, observable connections beat a huge brittle catalog.</p><div class="workflow-grid"><button class="workflow-card is-selected" type="button"><span class="integration-logo google" aria-label="Google Sheets">Google Sheets</span><strong>Google Sheets</strong><small>Spreadsheets, sheets, cells, and named ranges</small><i>App setup required</i></button><button class="workflow-card" type="button"><span class="integration-logo hubspot" aria-label="HubSpot">HubSpot</span><strong>HubSpot</strong><small>Objects, standard/custom properties, filters</small><i>Roadmap</i></button><button class="workflow-card" type="button"><span>▤</span><strong>Shopify</strong><small>Orders, refunds, net sales, products</small><i>Roadmap</i></button><button class="workflow-card" type="button"><span>↯</span><strong>Webhook / API</strong><small>Push signed custom events</small><i>Roadmap</i></button></div>', context: '<h3>Connection requirements</h3><p>Tokens stay encrypted server-side. Revocation, freshness, rate limits, and errors remain visible.</p><div class="workflow-summary"><div><small>AUTH</small><strong>OAuth 2.0</strong></div><div><small>SYNC</small><strong>Incremental + retry</strong></div></div>' },
  connection: { eyebrow: 'CONNECTION MANAGEMENT', title: 'Manage connection', description: 'Inspect health, scopes, mappings, sync history, and revocation.', steps: ['Health','Mappings','Permissions'], primary: 'Save connection', canvas: '<h3>Google Sheets connection</h3><p>Healthy and currently used by two published KPI mappings.</p><div class="workflow-form"><div class="field-row"><label>Account<input value="jordan@acme.co" readonly /></label><label>Refresh<select><option>Every 5 minutes</option><option>Every 15 minutes</option></select></label></div><ul class="workflow-list"><li><span>▦</span><div><strong>Net sales today</strong><small>Summary!D8 · refreshed 2m ago</small></div><button type="button">Edit</button></li><li><span>◎</span><div><strong>Team on track</strong><small>Reps!G4:G18 · refreshed 2m ago</small></div><button type="button">Edit</button></li></ul></div>', context: '<h3>Connection health</h3><p>OAuth token valid. No rate limits or mapping errors.</p><div class="workflow-summary"><div><small>LAST SYNC</small><strong>2 minutes ago</strong></div><div><small>SCOPES</small><strong>Google Sheets read-only</strong></div><div><small>NEXT CHECK</small><strong>In 3 minutes</strong></div></div>' },
  screen: { eyebrow: 'DISPLAY CONTROL', title: 'Manage TV screen', description: 'Pair, assign content, set a schedule, and diagnose the player remotely.', steps: ['Screen','Content','Schedule','Confirm'], primary: 'Apply to screen', canvas: '<h3>Screen and content</h3><p>Updates apply on the next player heartbeat.</p><div class="workflow-form"><div class="field-row"><label>Screen name<input value="Sales Floor TV" /></label><label>Location<input value="Front office" /></label></div><label>Content<select><option>Revenue pulse · 3 views</option><option>Sales performance</option><option>Team Challenge</option><option>Concierge Pulse</option></select></label><div class="field-row"><label>Wake<select><option>7:00 AM</option><option>Always on</option></select></label><label>Sleep<select><option>8:00 PM</option><option>Never</option></select></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> Auto-recover last-known-good content</label><label><input type="checkbox" /> Notify admin when offline for 5 minutes</label></div></div>', context: '<h3>Player heartbeat</h3><p>Chrome · 4K · player v0.4.1</p><div class="workflow-summary"><div><small>STATUS</small><strong>Online · 18s ago</strong></div><div><small>LAST RENDER</small><strong>Successful</strong></div><div><small>PAIRING</small><strong>Device-bound token</strong></div></div>' },
  celebration: { eyebrow: 'CELEBRATION WORKFLOW', title: 'Celebrate and recognize', description: 'Review wins, create a shoutout, and choose exactly where the moment appears.', steps: ['Choose win','Message','Audience','Preview'], primary: 'Preview shoutout', canvas: '<h3>Create a team shoutout</h3><p>Recognition can be sent without changing KPI or scoring records.</p><div class="workflow-form"><label>Person or team<select><option>Maya Patel · $18,420 deal</option><option>Sales team · crossed 80%</option><option>Custom recognition</option></select></label><label>Message<textarea>You crushed it—great discovery, follow-through, and a huge finish.</textarea></label><div class="workflow-checks"><label><input type="checkbox" checked /> Celebration HQ</label><label><input type="checkbox" checked /> Sales Floor TV</label><label><input type="checkbox" /> Slack #sales-wins</label></div></div>', context: '<h3>Moment preview</h3><p>Respects quiet hours, device volume, and reduced motion.</p><div class="workflow-preview"><span>✦</span><strong>Huge win, Maya!</strong><small>Victory Splash · high hype</small></div>' },
  sound: { eyebrow: 'SOUND WORKFLOW', title: 'Upload and assign sound', description: 'Validate ownership, preview volume, tag the asset, and assign safe triggers.', steps: ['Upload','Review','Assign','Publish'], primary: 'Validate sound', canvas: '<h3>Add a sound asset</h3><p>Supported: MP3, WAV, or M4A up to 25MB.</p><div class="workflow-drop"><span>↑</span><strong>Drop a sound here or browse</strong><small>Virus scan, duration, loudness, and waveform validation run before publishing.</small></div><div class="workflow-form"><div class="field-row"><label>Name<input value="Victory Splash" /></label><label>Tags<input value="Win, Water" /></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> I own or have permission to use this audio</label><label><input type="checkbox" checked /> Normalize loudness for shared displays</label></div></div>', context: '<h3>Assignment preview</h3><p>Choose event, team scope, volume, cooldown, and quiet-hour behavior.</p><div class="workflow-summary"><div><small>TRIGGERS</small><strong>Deal won · Team goal</strong></div><div><small>VOLUME</small><strong>80% · normalized</strong></div></div>' },
  game: { eyebrow: 'TEAM COMPETITION ASSETS', title: 'Customize competition asset', description: 'Edit names, avatars, arenas, sounds, scoring, and responsive competition previews.', steps: ['Choose asset','Customize','Test','Publish'], primary: 'Test in competition', canvas: '<h3>Competition asset library</h3><p>Use a preset, upload tenant-owned artwork, or create a reusable competition asset.</p><div class="workflow-grid"><button class="workflow-card is-selected" type="button"><span>•ᴗ•</span><strong>Leucistic avatar</strong><small>Team avatar · transparent PNG</small><i>Selected</i></button><button class="workflow-card" type="button"><span>🌊</span><strong>Aquatic arena</strong><small>Responsive background + safe zones</small><i>Choose</i></button><button class="workflow-card" type="button"><span>♫</span><strong>Victory Splash</strong><small>3 seconds · normalized</small><i>Choose</i></button><button class="workflow-card" type="button"><span>↑</span><strong>Upload asset</strong><small>PNG, SVG, WebP, MP3, WAV</small><i>Add new</i></button></div>', context: '<h3>Asset checks</h3><p>Transparent edges, TV/mobile safe zones, licensing, and file scanning are required.</p><div class="workflow-summary"><div><small>MOBILE</small><strong>390px preview passes</strong></div><div><small>TV</small><strong>4K safe zone passes</strong></div></div>' },
  brand: { eyebrow: 'BRAND PUBLISHING', title: 'Complete your brand system', description: 'Finish logo, colors, type, language, domains, and accessibility before publishing.', steps: ['Identity','Theme','Language','Review'], primary: 'Continue to theme', canvas: '<h3>Brand setup</h3><p>One versioned theme powers dashboards, celebrations, sounds, games, shares, and TV.</p><div class="workflow-form"><label>Logo asset<input value="axoboard-logo-low-poly.png" /></label><div class="field-row"><label>Primary color<input type="color" value="#E96F98" /></label><label>Accent color<input type="color" value="#43BDE8" /></label></div><label>Heading font<select><option>Fredoka</option><option>DM Sans</option><option>Customer font upload</option></select></label><div class="workflow-checks"><label><input type="checkbox" checked /> Apply to dashboards</label><label><input type="checkbox" checked /> Apply to TV, celebrations, and games</label></div></div>', context: '<h3>Publish checklist</h3><p>Theme changes produce a previewable version with rollback.</p><div class="workflow-summary"><div><small>CONTRAST</small><strong>WCAG AA passes</strong></div><div><small>MOBILE</small><strong>All routes pass</strong></div><div><small>ROLLBACK</small><strong>Previous version retained</strong></div></div>' },
  data: { eyebrow: 'DATA DETAIL', title: 'Export and metric history', description: 'Inspect definition changes, refresh history, annotations, and permitted exports.', steps: ['History','Compare','Export'], primary: 'Prepare export', canvas: '<h3>Metric history</h3><p>Value and definition changes remain independently auditable.</p><div class="run-ledger"><div class="run-row"><span>Today · 2m</span><strong>$55,396 · successful refresh</strong><b class="success">Fresh</b></div><div class="run-row"><span>Today · 9:00</span><strong>$42,180 · successful refresh</strong><b class="success">Fresh</b></div><div class="run-row"><span>Aug 8</span><strong>Definition changed by Sales Ops</strong><b class="suppressed">Version 3</b></div></div><div class="workflow-form"><label>Export format<select><option>CSV · visible permitted rows</option><option>CSV · metric snapshots</option><option>PDF · audit summary</option></select></label></div>', context: '<h3>Export policy</h3><p>Exports respect tenant, share-grant, field allowlist, and provider permissions.</p><div class="workflow-summary"><div><small>ROWS</small><strong>48 permitted</strong></div><div><small>REDACTION</small><strong>2 fields hidden</strong></div></div>' },
  customer: { eyebrow: 'CUSTOMER ONBOARDING', title: 'Launch your AxoBoard workspace', description: 'Get from sign-up to a trusted, branded dashboard and first team moment.', steps: ['Workspace','Brand','Data','Team','Launch'], primary: 'Continue setup', canvas: '<h3>Workspace foundation</h3><p>This creates a separate tenant boundary for the customer.</p><div class="workflow-form"><div class="field-row"><label>Workspace name<input data-customer-workspace value="Acme Sales" /></label><label>Timezone<select><option>America/Denver</option><option>America/New_York</option><option>America/Los_Angeles</option></select></label></div><label>Primary use case<select><option>Sales performance & celebrations</option><option>Customer support operations</option><option>Executive scorecards</option><option>Custom team performance</option></select></label><div class="workflow-checks"><label><input type="checkbox" checked /> Start with the Sales Daily Command recipe</label><label><input type="checkbox" checked /> Include mobile and TV layouts</label></div></div>', context: '<h3>Customer outcome</h3><p>A branded workspace, first trusted KPI, invited team, and tested celebration—not an empty canvas.</p><div class="workflow-summary"><div><small>TARGET TIME</small><strong>Under 10 minutes</strong></div><div><small>DATA BOUNDARY</small><strong>Tenant isolated</strong></div></div>' },
  members: { eyebrow: 'PEOPLE & PERMISSIONS', title: 'Invite and manage members', description: 'Give each person the minimum role needed and keep customer access auditable.', steps: ['People','Roles','Invite','Review'], primary: 'Review invitations', canvas: '<h3>Invite teammates</h3><p>Invitations are scoped to this workspace and expire automatically.</p><div class="workflow-form"><label>Email addresses<textarea placeholder="maya@acme.co\nethan@acme.co"></textarea></label><div class="field-row"><label>Role<select><option>Viewer</option><option>Editor</option><option>Automation manager</option><option>Workspace admin</option></select></label><label>Invitation expires<select><option>In 7 days</option><option>In 24 hours</option><option>In 30 days</option></select></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> Send onboarding checklist</label><label><input type="checkbox" /> Require MFA before editor access</label></div></div>', context: '<h3>Role boundaries</h3><p>Viewers cannot edit, connect sources, publish, export, or manage billing.</p><div class="workflow-summary"><div><small>OWNER</small><strong>Full control</strong></div><div><small>EDITOR</small><strong>Draft + publish content</strong></div><div><small>VIEWER</small><strong>Published views only</strong></div></div>' },
  billing: { eyebrow: 'PLAN & BILLING', title: 'Manage plan and usage', description: 'Understand limits, billing ownership, invoices, and what grows with the customer.', steps: ['Plan','Usage','Billing','Confirm'], primary: 'Review plan', canvas: '<h3>Commercial plan roadmap</h3><p>Choose capacity without charging every person who needs visibility.</p><div class="workflow-grid"><button class="workflow-card is-selected" type="button"><span>◌</span><strong>Starter · $99/mo</strong><small>3 sources · 1 screen · core dashboards</small><i>Launch target</i></button><button class="workflow-card" type="button"><span>✦</span><strong>Growth · $249/mo</strong><small>10 sources · 5 screens · sounds and competitions</small><i>Roadmap</i></button><button class="workflow-card" type="button"><span>◇</span><strong>Scale · $599/mo</strong><small>30 sources · governance · priority support</small><i>Roadmap</i></button><button class="workflow-card" type="button"><span>＋</span><strong>Enterprise</strong><small>SSO, SLA, custom capacity and retention</small><i>Contact sales</i></button></div>', context: '<h3>Metered dimensions</h3><p>Usage warnings arrive before limits. Additional charges always require an explicit choice.</p><div class="workflow-summary"><div><small>VIEWERS</small><strong>Unlimited</strong></div><div><small>CAPACITY</small><strong>Sources · screens · automation</strong></div><div><small>OVERAGE POLICY</small><strong>Warn before charge</strong></div></div>' },
  support: { eyebrow: 'CUSTOMER SUCCESS', title: 'Get AxoBoard support', description: 'Ask for help without exposing secrets, tokens, or unrelated customer data.', steps: ['Issue','Diagnostics','Contact'], primary: 'Prepare support request', canvas: '<h3>How can we help?</h3><p>A support bundle includes only approved workspace diagnostics.</p><div class="workflow-form"><label>Topic<select><option>Setup and onboarding</option><option>Data source or freshness</option><option>Dashboard or display</option><option>Automation or celebration</option><option>Billing and account</option></select></label><label>What happened?<textarea placeholder="Tell us what you expected and what you saw."></textarea></label><div class="workflow-checks"><label><input type="checkbox" checked /> Include connection health and recent error codes</label><label><input type="checkbox" checked /> Include browser and AxoBoard version</label><label><input type="checkbox" /> Include redacted automation run IDs</label></div></div>', context: '<h3>Privacy boundary</h3><p>Support bundles exclude OAuth tokens, raw credentials, private sound assets, and unrelated tenant records.</p><div class="workflow-summary"><div><small>RESPONSE TARGET</small><strong>Defined by plan</strong></div><div><small>STATUS PAGE</small><strong>All systems healthy</strong></div></div>' },
  guide: { eyebrow: 'SETUP GUIDE', title: 'Customer setup guide', description: 'A short, outcome-led path from workspace creation to launch.', steps: ['Brand','Connect','Build','Invite','Launch'], primary: 'Start guided setup', canvas: '<h3>Recommended launch path</h3><p>Each step has a success signal and a recovery path.</p><ul class="workflow-list"><li><span>1</span><div><strong>Make it recognizable</strong><small>Logo, colors, language, and mobile preview</small></div><button type="button">Open</button></li><li><span>2</span><div><strong>Connect one trusted source</strong><small>OAuth, mapping, freshness, and owner</small></div><button type="button">Open</button></li><li><span>3</span><div><strong>Publish the first outcome recipe</strong><small>Dashboard, goal, alert, celebration, and loop</small></div><button type="button">Open</button></li><li><span>4</span><div><strong>Invite the right people</strong><small>Viewer, editor, manager, and admin roles</small></div><button type="button">Open</button></li></ul>', context: '<h3>Launch definition</h3><p>The customer can explain AxoBoard in 60 seconds and operate it without babysitting.</p><div class="workflow-summary"><div><small>FIRST VALUE</small><strong>Published KPI</strong></div><div><small>TEAM MOMENT</small><strong>Tested celebration</strong></div></div>' },
  oauth: { eyebrow: 'FRESH OAUTH TEST', title: 'Authorize a new connection', description: 'Start from provider consent without importing or reusing any existing credential.', steps: ['Preflight','Consent','Callback','Verify'], primary: 'Review fresh consent', canvas: '<h3 data-oauth-heading>Fresh OAuth preflight</h3><p data-oauth-copy>No cached account or connection will be used.</p><div class="oauth-contract"><div><small>ATTEMPT</small><strong data-oauth-attempt>New session</strong></div><div><small>TENANT</small><strong>Current workspace only</strong></div><div><small>CREDENTIAL REUSE</small><strong>Blocked</strong></div><div><small>LIVE TOKEN</small><strong>Not stored in this prototype</strong></div></div><div class="workflow-checks"><label><input type="checkbox" checked disabled /> Generate a unique state value for callback validation</label><label><input type="checkbox" checked disabled /> Use AxoBoard-owned client credentials only</label><label><input type="checkbox" checked disabled /> Encrypt tenant-scoped tokens server-side in production</label><label><input type="checkbox" checked disabled /> Expose disconnect, revocation, expiry, and retry status</label></div>', context: '<h3>Prototype boundary</h3><p data-oauth-boundary>This validates the onboarding contract, not a real provider token exchange.</p><div class="credential-boundary compact"><b>No credential import</b><span>Existing service accounts, portal tokens, browser sessions, and prior OAuth grants are never read or copied into a new workspace.</span></div><div class="workflow-summary"><div><small>CALLBACK</small><strong>/api/oauth/{provider}/callback</strong></div><div><small>STATUS</small><strong>Provider app registration required</strong></div></div>' },
};

let activeWorkflow = null;
let workflowStep = 0;

function renderWorkflow() {
  const definition = workflowDefinitions[activeWorkflow];
  document.querySelector('#workflowEyebrow').textContent = definition.eyebrow;
  document.querySelector('#workflowTitle').textContent = definition.title;
  document.querySelector('#workflowDescription').textContent = definition.description;
  document.querySelector('#workflowCanvas').innerHTML = definition.canvas;
  document.querySelector('#workflowCanvas').onchange = null;
  document.querySelector('#workflowContext').innerHTML = definition.context;
  if (activeWorkflow !== 'layout') {
    document.querySelector('#workflowCanvas').insertAdjacentHTML('afterbegin', '<aside class="surface preview-boundary compact"><b>Prototype preview · not saved or sent</b><span>Names, values, health, access, and delivery details in this workflow are illustrative fixtures, not current workspace records. The final button closes the preview without a mutation.</span></aside>');
  }
  if (activeWorkflow === 'customer') document.querySelector('[data-customer-workspace]').value = betaState.workspaceName;
  if (activeWorkflow === 'workspace') {
    const selected = document.querySelector(`[data-workspace-id="${betaState.activeWorkspace}"]`);
    if (selected) selected.classList.add('is-selected');
  }
  if (activeWorkflow === 'oauth') {
    const providerName = activeOauthProvider === 'hubspot' ? 'HubSpot' : 'Google Sheets';
    document.querySelector('#workflowTitle').textContent = `Authorize ${providerName}`;
    document.querySelector('[data-oauth-heading]').textContent = `${providerName} OAuth preflight`;
    document.querySelector('[data-oauth-copy]').textContent = `Attempt ${oauthAttempt} starts a new ${providerName} consent handoff. No account is preselected and no prior grant is reused.`;
    document.querySelector('[data-oauth-attempt]').textContent = `Fresh attempt ${oauthAttempt}`;
    document.querySelector('[data-oauth-boundary]').textContent = `Live ${providerName} redirect is intentionally unavailable until an AxoBoard-owned OAuth app, approved scopes, and exact callback URI are configured.`;
  }
  updateWorkflowProgress();
  if (activeWorkflow === 'layout') {
    if (liveWorkspaceId) {
      layoutDraft.showTrend = false;
      layoutDraft.showActionCenter = false;
      document.querySelector('.layout-section-fieldset').hidden = true;
    }
    wireLayoutWorkflow();
    if (liveWorkspaceId) {
      document.querySelector('#workflowDescription').textContent = `Arrange the KPI cards saved to ${liveWorkspaceName}. Changes stay in this workspace.`;
      document.querySelector('#workflowContext > p').textContent = 'The preview updates immediately. Save writes the layout to this workspace; Cancel restores the current saved layout.';
      document.querySelector('[data-layout-preview-trend]').hidden = true;
      document.querySelector('[data-layout-preview-actions]').hidden = true;
      document.querySelector('[data-layout-preview-empty]').textContent = 'KPI cards only · live sections';
      document.querySelector('[data-layout-preview-empty]').hidden = false;
      const summaryValues = document.querySelectorAll('#workflowContext .workflow-summary strong');
      if (summaryValues[0]) summaryValues[0].textContent = 'Workspace database';
      if (summaryValues[2]) summaryValues[2].textContent = 'Tenant scoped';
    }
  }
  document.querySelectorAll('#workflowCanvas .workflow-card').forEach((card) => {
    card.dataset.interactionStatus = 'working';
    card.addEventListener('click', () => card.parentElement.querySelectorAll('.workflow-card').forEach((item) => item.classList.toggle('is-selected', item === card)));
  });
  document.querySelectorAll('#workflowCanvas .workflow-list button').forEach((button) => {
    button.dataset.interactionStatus = 'working';
    button.addEventListener('click', () => showToast(`${button.textContent} mapping`, 'The nested editor is represented by the next workflow step.'));
  });
}

function updateWorkflowProgress() {
  const definition = workflowDefinitions[activeWorkflow];
  document.querySelector('#workflowProgress').innerHTML = definition.steps.map((step, index) => `${index ? '<i></i>' : ''}<span data-step="${index + 1}" class="${index === workflowStep ? 'is-active' : ''}">${step}</span>`).join('');
  const isFinalStep = workflowStep === definition.steps.length - 1;
  document.querySelector('#workflowPrimary').textContent = activeWorkflow === 'layout' && isFinalStep ? 'Save layout' : isFinalStep ? 'Close preview' : definition.primary;
  document.querySelector('#workflowStatus').textContent = `Step ${workflowStep + 1} of ${definition.steps.length} · ${activeWorkflow === 'layout' ? (liveWorkspaceId ? 'workspace draft' : 'browser draft') : 'preview only · not saved'}`;
}

function openWorkflow(type, trigger = document.activeElement, titleOverride = '') {
  if (!workflowDefinitions[type]) return;
  if (activeFeatureModal && activeFeatureModal.id !== 'workflowModal') {
    activeFeatureModal.classList.remove('is-visible');
    activeFeatureModal.setAttribute('aria-hidden', 'true');
    activeFeatureModal = null;
  }
  activeWorkflow = type;
  if (activeWorkflow === 'layout') {
    const currentLayout = liveWorkspaceId ? liveDashboardLayout : betaState.dashboardLayout;
    layoutEditSnapshot = cloneDashboardLayout(currentLayout);
    layoutDraft = cloneDashboardLayout(currentLayout);
  }
  workflowStep = 0;
  renderWorkflow();
  if (titleOverride) document.querySelector('#workflowTitle').textContent = titleOverride;
  openFeatureModal('workflowModal', trigger);
}

function openFreshOAuth(provider, trigger) {
  activeOauthProvider = provider === 'hubspot' ? 'hubspot' : 'google';
  oauthAttempt += 1;
  const providerName = activeOauthProvider === 'hubspot' ? 'HubSpot' : 'Google Sheets';
  const authWindow = window.open('about:blank', `axoboard-${activeOauthProvider}-oauth`);
  if (authWindow) {
    authWindow.document.title = `Connecting ${providerName}`;
    authWindow.document.body.innerHTML = '<p style="font:16px system-ui;padding:32px">Preparing secure OAuth connection…</p>';
  }
  trigger.disabled = true;
  trigger.textContent = `Opening ${providerName}…`;
  fetch('/api/axoboard/integrations/oauth/start', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: activeOauthProvider })
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || 'Could not start OAuth.');
      if (authWindow) authWindow.location.replace(payload.authorizationUrl);
      else window.location.assign(payload.authorizationUrl);
      showToast(`${providerName} OAuth opened`, 'Complete provider consent, then return to AxoBoard.');
    })
    .catch((error) => {
      if (authWindow) authWindow.close();
      openWorkflow('oauth', trigger);
      document.querySelector('[data-oauth-boundary]').textContent = error.message;
      showToast(`${providerName} setup needed`, error.message);
    })
    .finally(() => {
      trigger.disabled = false;
      trigger.textContent = `Start fresh ${providerName === 'Google Sheets' ? 'Google' : 'HubSpot'} OAuth`;
    });
}

document.querySelector('#workflowCancel').addEventListener('click', () => closeFeatureModal(document.querySelector('#workflowModal')));
document.querySelector('#workflowPrimary').addEventListener('click', async () => {
  const definition = workflowDefinitions[activeWorkflow];
  if (workflowStep < definition.steps.length - 1) {
    workflowStep += 1;
    updateWorkflowProgress();
    showToast(`${definition.steps[workflowStep]} ready`, 'The workflow advanced to the next wireframed state.');
    return;
  }
  const completedWorkflows = [...new Set([...betaState.completedWorkflows, activeWorkflow])];
  if (activeWorkflow === 'layout') {
    const savedLayout = cloneDashboardLayout(layoutDraft);
    const saveButton = document.querySelector('#workflowPrimary');
    saveButton.disabled = true;
    try {
      if (liveWorkspaceId) {
        const payload = await apiJson('/api/axoboard/dashboard', { method: 'PUT', body: JSON.stringify({ layout: savedLayout }) });
        liveDashboardLayout = normalizeDashboardLayout(payload.dashboard.layout, liveKpis.map((kpi) => kpi.id));
        applyDashboardLayout(liveDashboardLayout);
      } else {
        persistBetaState({ dashboardLayout: savedLayout, completedWorkflows, draftCount: betaState.draftCount + 1 });
        applyDashboardLayout(savedLayout);
      }
      layoutEditSnapshot = null;
      layoutDraft = null;
      closeFeatureModal(document.querySelector('#workflowModal'));
      showToast('Dashboard layout saved', liveWorkspaceId ? `Card order and density were saved only to ${liveWorkspaceName}.` : 'Saved in this browser for the prototype workspace.');
    } catch (error) {
      showToast('Layout was not saved', error.message);
    } finally { saveButton.disabled = false; }
    return;
  }
  closeFeatureModal(document.querySelector('#workflowModal'));
  showToast(`${definition.title} preview closed`, 'Nothing was saved, published, delivered, invited, uploaded, or billed.');
});

insertWorkspaceSandboxStates();

document.querySelectorAll('[data-fresh-oauth]').forEach((button) => button.addEventListener('click', (event) => openFreshOAuth(event.currentTarget.dataset.freshOauth, event.currentTarget)));
document.querySelectorAll('[data-load-demo]').forEach((button) => button.addEventListener('click', () => {
  persistBetaState({ sampleDemoData: true });
  applyWorkspaceMode();
  showToast('Synthetic KPIs loaded', 'Visibility fixtures only—no Google, HubSpot, or customer data was accessed.');
}));
document.querySelectorAll('[data-reset-sample]').forEach((button) => button.addEventListener('click', resetSampleWorkspace));
document.querySelectorAll('[data-empty-workflow]').forEach((button) => button.addEventListener('click', (event) => openWorkflow(event.currentTarget.dataset.emptyWorkflow, event.currentTarget)));
document.querySelectorAll('.workspace-empty-state [data-screen]').forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.screen)));

const workflowBindings = [
  ['.workspace-switcher button, .mobile-workspace-switch', 'workspace'], ['.sidebar-user button', 'profile'],
  ['.dashboard-toolbar button:not(#openTvMode):not(#editLayoutButton)', 'dashboard'], ['#editLayoutButton', 'layout'], ['.kpi-card header button', 'kpi'], ['.attention-card li button', 'alert'], ['.attention-card > button', 'alert'],
  ['#browseIntegrations', 'connector'], ['.integration-catalog button', 'connector'], ['.connect-source', 'connection'],
  ['.display-summary button, .screen-device:not([data-live-display]) footer button:not(#manageRuntimeButton), .add-loop-view', 'screen'],
  ['.celebration-header .button-ghost, .performers-card .card-title button, .wins-card .card-title button, .momentum-banner button', 'celebration'],
  ['#uploadSoundButton, #uploadZone, .sounds-layout .add-chip, .sounds-layout .chips button, .favorite-button', 'sound'],
  ['.studio-steps nav button, .preview-heading button, .editable-labels button, .sprite-pickers button, .arena-options button', 'game'],
  ['.brand-form .logo-drop button, .brand-form > .button', 'brand'],
  ['#openSourceButton, .table-heading button, .drilldown-content aside button', 'data'],
  ['#inviteMemberButton, #manageRolesButton, [data-service-action="members"]', 'members'],
  ['#launchChecklistButton, [data-service-action="workspace"]', 'customer'],
  ['#supportButton', 'support'], ['#setupGuideButton', 'guide']
];

workflowBindings.forEach(([selector, type]) => {
  document.querySelectorAll(selector).forEach((button) => {
    if (button.tagName !== 'BUTTON') return;
    button.dataset.workflowWired = type;
    button.addEventListener('click', (event) => {
      if (type === 'workspace' && liveWorkspaceId) {
        showScreen('workspace');
        showToast(liveWorkspaceName, 'This account is bound to one isolated workspace. Workspace switching is not simulated in the live app.');
        return;
      }
      openWorkflow(type, event.currentTarget);
    });
  });
});

document.querySelectorAll('.page-header .button-ghost').forEach((button) => {
  if (!button.id && !button.dataset.workflowWired) {
    const type = button.closest('[data-screen-panel="sounds"]') ? 'sound' : 'dashboard';
    button.dataset.workflowWired = type;
    button.addEventListener('click', (event) => openWorkflow(type, event.currentTarget));
  }
});

document.querySelectorAll('[data-plan-cycle]').forEach((button) => button.addEventListener('click', () => {
  const cycle = button.dataset.planCycle;
  document.querySelectorAll('[data-plan-cycle]').forEach((choice) => choice.classList.toggle('is-active', choice === button));
  document.querySelectorAll('[data-monthly][data-annual]').forEach((price) => { price.textContent = price.dataset[cycle]; });
  document.querySelectorAll('[data-price-note]').forEach((note) => { note.textContent = cycle === 'annual' ? 'Billed annually' : 'Billing terms at checkout'; });
  showToast(cycle === 'annual' ? 'Annual preview shown' : 'Monthly preview shown', 'This changes illustrative pricing in this browser only; no subscription or invoice was changed.');
}));

document.querySelectorAll('[data-plan-action]').forEach((button) => button.addEventListener('click', (event) => {
  const action = event.currentTarget.dataset.planAction;
  if (action === 'compare') {
    document.querySelector('#planComparison').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  openWorkflow('billing', event.currentTarget, `${action[0].toUpperCase()}${action.slice(1)} plan`);
}));

document.querySelectorAll('button').forEach((button) => {
  const known = button.matches('[data-screen], [data-plan-cycle], [data-plan-action], [data-fresh-oauth], [data-load-demo], [data-reset-sample], [data-empty-workflow], [data-close-feature], [data-share-tab], [data-celebration-style], [data-celebration-view], [data-ledger-replay], [data-ledger-inspect], [data-ledger-release], [data-display-type], [data-open-trust], .use-template, .source-choice, [data-visual], #sheetGrid button, #addKpiButton, #builderBack, #builderNext, #closeKpiBuilder, #closeRangePicker, #cancelRangePicker, #applyRangePicker, #jumpToRangeButton, #previewComparisonButton, #closeWin, #replayWin, #celebrateButton, #previewCelebration, #exportEventLedger, #openEventContract, #testDeliveryPolicy, .replay-mini, .sound-row, #soundPreviewButton, #wavePlay, #saveSound, #uploadZone, #uploadSoundButton, #previewGame, #publishGame, #testScoreEvent, #resetScoreTest, #viewCompetitionContract, #publishBrand, #previewAllBrandSurfaces, #templateGalleryButton, #shareDashboardButton, #openTvMode, #previewLoopButton, #previewRuntimeCompatibility, #manageRuntimeButton, #openMetricTrust, #pairScreenButton, #saveLoopButton, [data-move-loop], #copyShareLink, #createShareLink, #saveSnapshotSchedule, #openSourceButton, #selectRangeButton, #reconnectSource, .build-source-kpi, .destination-grid button, #workflowCancel, #workflowPrimary');
  if (button.dataset.workflowWired) { button.dataset.interactionStatus = 'wireframed'; return; }
  if (known) { button.dataset.interactionStatus = 'working'; return; }
  button.dataset.interactionStatus = 'unavailable';
});

new MutationObserver((mutations) => {
  mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (!(node instanceof Element)) return;
    const buttons = node.matches('button') ? [node] : [...node.querySelectorAll('button')];
    buttons.forEach((button) => {
      if (button.dataset.interactionStatus) return;
      if (button.closest('#sheetGrid')) {
        button.dataset.interactionStatus = 'working';
        return;
      }
      const type = button.closest('.kpi-card') ? 'kpi' : button.closest('.rule-card') ? 'automation' : null;
      if (!type) {
        button.dataset.interactionStatus = 'unavailable';
        return;
      }
      button.dataset.workflowWired = type;
      button.dataset.interactionStatus = 'wireframed';
      button.addEventListener('click', (event) => openWorkflow(type, event.currentTarget));
    });
  }));
}).observe(document.body, { childList: true, subtree: true });

const initialScreen = location.hash.slice(1) === 'kombat' ? 'competitions' : location.hash.slice(1);
document.querySelector('#reloadApplication').addEventListener('click', () => location.reload());
brandColor.value = betaState.brandColor;
celebrationLanguage.value = betaState.celebrationLanguage;
applyWorkspaceMode();
applyDashboardLayout(betaState.dashboardLayout);
if (screens.some((screen) => screen.dataset.screenPanel === initialScreen)) showScreen(initialScreen);
syncCelebrationPreview();
const integrationResult = new URLSearchParams(location.search).get('status');
if (integrationResult === 'connected') showToast('Google Sheets connected', 'Choose a spreadsheet and exact range to build the first live KPI.');
else if (integrationResult && integrationResult !== 'connected') showToast('Google connection not completed', 'Start a new consent attempt from Integrations.');
if (location.search && !dedicatedTvRuntime) history.replaceState(null, '', `/app${location.hash || ''}`);
(async () => {
  if (dedicatedTvRuntime) {
    document.body.dataset.tvRuntime = 'true';
    setTvConnectionState('loading');
  }
  const ready = await loadLiveData();
  if (dedicatedTvRuntime && ready) openFeatureModal('tvPreviewModal', document.querySelector('#tvFullscreen'));
})();
