const navButtons = [...document.querySelectorAll('[data-screen]')];
const screens = [...document.querySelectorAll('[data-screen-panel]')];
const toast = document.querySelector('#toast');
const overlay = document.querySelector('#celebrationOverlay');
let toastTimer;
const betaStateKey = 'axoboard.beta.service.v2';
const defaultBetaState = { activeWorkspace: 'sample-empty', workspaceName: 'New workspace', brandColor: '#E96F98', celebrationLanguage: 'Big win!', teamOne: 'Team One', teamTwo: 'Team Two', sampleDemoData: false, completedWorkflows: [], draftCount: 0, lastSavedAt: null };
let betaState = { ...defaultBetaState };
let oauthAttempt = 0;
let activeOauthProvider = null;

try {
  betaState = { ...defaultBetaState, ...JSON.parse(localStorage.getItem(betaStateKey) || '{}') };
} catch {
  betaState = { ...defaultBetaState };
}

function persistBetaState(patch = {}) {
  betaState = { ...betaState, ...patch, lastSavedAt: new Date().toISOString() };
  try { localStorage.setItem(betaStateKey, JSON.stringify(betaState)); } catch { /* private-mode fallback */ }
}

const workspaceProfiles = {
  'sample-empty': { name: 'New workspace', avatar: 'N', game: 'Blank team battle', teamOne: 'Team One', teamTwo: 'Team Two' },
  acme: { name: 'Acme Sales', avatar: 'A', game: 'Team Challenge', teamOne: 'Bluefin', teamTwo: 'Coral Crew' }
};

function insertWorkspaceSandboxStates() {
  const states = {
    dashboard: '<span class="empty-axo">•ᴗ•</span><small>BLANK CUSTOMER WORKSPACE</small><h2>No KPIs yet</h2><p>Connect a source through a fresh OAuth consent flow, or load clearly labeled synthetic KPIs to test the product safely.</p><div><button class="button button-primary" type="button" data-screen="integrations">Connect a source</button><button class="button button-soft" type="button" data-load-demo>Load synthetic demo KPIs</button></div>',
    integrations: '<span class="empty-axo">⌁</span><small>0 CONNECTIONS · FRESH OAUTH ONLY</small><h2>Connect your first source</h2><p>No accounts, tokens, service accounts, portals, or credentials are included in this sample workspace. Every connection begins with a new provider consent request.</p><div class="blank-connector-grid"><article><span class="integration-logo google">G</span><strong>Google Sheets</strong><small>Pick files, worksheets, cells, and ranges after authorization.</small><button class="button button-primary" type="button" data-fresh-oauth="google">Start fresh Google OAuth</button></article><article><span class="integration-logo hubspot">H</span><strong>HubSpot</strong><small>Pick CRM objects and specific standard or custom properties.</small><button class="button button-primary" type="button" data-fresh-oauth="hubspot">Start fresh HubSpot OAuth</button></article></div><aside class="credential-boundary"><b>Credential boundary</b><span>Credentials must be newly authorized and tenant-scoped. Live redirects remain disabled until AxoBoard-owned OAuth apps and callbacks are configured.</span></aside>',
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
  ['kombat', 'brand'].forEach((route) => {
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
  document.querySelector('.workspace-switcher .workspace-avatar').textContent = profile.avatar;
  document.querySelector('.workspace-switcher strong').textContent = profile.name;
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
  screens.forEach((screen) => screen.classList.toggle('is-active', screen.dataset.screenPanel === name));
  navButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.screen === name));
  const activeNav = navButtons.find((button) => button.dataset.screen === name && button.classList.contains('nav-item'));
  if (activeNav && window.matchMedia('(max-width: 700px)').matches) activeNav.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  history.replaceState(null, '', `#${name}`);
  const title = screens.find((screen) => screen.dataset.screenPanel === name)?.querySelector('h1')?.textContent.trim() || 'AxoBoard';
  document.title = `AxoBoard — ${title}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navButtons.forEach((button) => button.addEventListener('click', () => showScreen(button.dataset.screen)));

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
  overlay.classList.add('is-visible');
  document.querySelector('#closeWin').focus();
}

function closeCelebration() {
  overlay.classList.remove('is-visible');
  document.querySelector('#celebrateButton').focus();
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
document.querySelectorAll('.arena-options button').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.arena-options button').forEach((item) => item.classList.toggle('is-active', item === button));
  showToast('Arena updated', 'The new environment is shown in the live preview.');
}));
document.querySelector('#previewGame').addEventListener('click', () => {
  arena.animate([{ transform: 'scale(.985)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' });
  showToast('Game preview started', 'Scores, winner copy, sprites, colors, and sounds are testable.');
});
document.querySelector('#publishGame').addEventListener('click', () => showToast('Preset published', `${document.querySelector('#gameNameInput').value || 'Your game'} is ready to play.`));

const brandColor = document.querySelector('#brandColor');
const workspaceName = document.querySelector('#workspaceName');
const celebrationLanguage = document.querySelector('#celebrationLanguage');
const brandPreview = document.querySelector('#brandPreview');

function syncBrandPreview() {
  document.querySelector('#workspacePreview').textContent = workspaceName.value || 'Your workspace';
  document.querySelector('#languagePreview').textContent = celebrationLanguage.value || 'Big win!';
  brandPreview.style.setProperty('--pink-600', brandColor.value);
  brandPreview.style.setProperty('--pink-500', brandColor.value);
}

[brandColor, workspaceName, celebrationLanguage].forEach((input) => input.addEventListener('input', () => {
  syncBrandPreview();
  persistBetaState({ workspaceName: workspaceName.value, brandColor: brandColor.value, celebrationLanguage: celebrationLanguage.value });
  document.querySelector('#serviceWorkspaceName').textContent = workspaceName.value || 'Your workspace';
}));
document.querySelector('#publishBrand').addEventListener('click', () => showToast('Brand published', 'Dashboards, celebrations, sounds, and games now share this theme.'));

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

function syncBuilderSource(source) {
  activeKpiSource = source === 'hubspot' ? 'hubspot' : 'google';
  sourceChoices.forEach((choice) => choice.classList.toggle('is-selected', choice.dataset.kpiSource === activeKpiSource));
  sourceConfigs.forEach((config) => config.classList.toggle('is-active', config.dataset.sourceConfig === activeKpiSource));
  const isGoogle = activeKpiSource === 'google';
  document.querySelector('#dataStepTitle').textContent = isGoogle ? 'Choose cells to watch' : 'Choose CRM properties';
  document.querySelector('#dataStepCopy').textContent = isGoogle
    ? 'Select a spreadsheet, worksheet, and exact A1 range.'
    : 'Select an object, standard or custom property, filters, and aggregation.';
  previewSourceMark.textContent = isGoogle ? 'G' : 'H';
  previewSourceMark.classList.toggle('google', isGoogle);
  previewSourceMark.classList.toggle('hubspot', !isGoogle);
  previewKpiValue.textContent = isGoogle ? '$55,396' : '$1.28M';
  kpiName.value = isGoogle ? 'Net sales today' : 'Open pipeline';
  previewKpiName.textContent = kpiName.value;
}

function showBuilderStep(step) {
  activeBuilderStep = Math.max(1, Math.min(3, Number(step) || 1));
  builderSteps.forEach((panel) => panel.classList.toggle('is-active', Number(panel.dataset.builderStep) === activeBuilderStep));
  builderStepLabels.forEach((label) => {
    const labelStep = Number(label.dataset.builderStepLabel);
    label.classList.toggle('is-active', labelStep === activeBuilderStep);
    label.classList.toggle('is-complete', labelStep < activeBuilderStep);
  });
  builderBack.disabled = activeBuilderStep === 1;
  builderNext.textContent = activeBuilderStep === 1 ? 'Choose data →' : activeBuilderStep === 2 ? 'Design KPI →' : '＋ Add to dashboard';
  document.querySelector('#builderStatus').textContent = activeBuilderStep === 3 ? 'Ready to add · draft only' : 'Draft changes only';
}

function openKpiBuilder(source = 'google', trigger = document.activeElement) {
  builderReturnFocus = trigger;
  syncBuilderSource(source);
  showBuilderStep(1);
  kpiBuilderModal.classList.add('is-visible');
  kpiBuilderModal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.querySelector('#closeKpiBuilder').focus();
}

function closeKpiBuilder() {
  kpiBuilderModal.classList.remove('is-visible');
  kpiBuilderModal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  builderReturnFocus?.focus?.();
}

function addPrototypeKpi() {
  const grid = document.querySelector('.kpi-grid');
  const isGoogle = activeKpiSource === 'google';
  const article = document.createElement('article');
  article.className = 'surface kpi-card newly-added-kpi';
  article.innerHTML = `<header><span class="source-mark ${isGoogle ? 'google' : 'hubspot'}">${isGoogle ? 'G' : 'H'}</span><small>${isGoogle ? `Google Sheets · ${document.querySelector('#sheetTab').value}!${document.querySelector('#sheetRange').value}` : `HubSpot · ${document.querySelector('#hubspotObject').value}.${document.querySelector('#hubspotProperty').value}`}</small><button type="button" aria-label="Edit KPI">•••</button></header><p>${kpiName.value || 'Untitled KPI'}</p><strong>${previewKpiValue.textContent}</strong><div class="kpi-change positive">● Live <span>new draft KPI</span></div><div class="mini-progress"><i style="width:76%"></i></div><footer><span>Refresh every 5 min</span><b>Draft</b></footer>`;
  grid.appendChild(article);
  closeKpiBuilder();
  showScreen('dashboard');
  showToast('KPI added to draft', `${kpiName.value || 'Your KPI'} is ready to place and publish.`);
  article.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.querySelector('#addKpiButton').addEventListener('click', (event) => openKpiBuilder('google', event.currentTarget));
document.querySelectorAll('.build-source-kpi').forEach((button) => button.addEventListener('click', () => openKpiBuilder(button.dataset.source, button)));
sourceChoices.forEach((choice) => choice.addEventListener('click', () => syncBuilderSource(choice.dataset.kpiSource)));
builderBack.addEventListener('click', () => showBuilderStep(activeBuilderStep - 1));
builderNext.addEventListener('click', () => {
  if (activeBuilderStep < 3) showBuilderStep(activeBuilderStep + 1);
  else addPrototypeKpi();
});
document.querySelector('#closeKpiBuilder').addEventListener('click', closeKpiBuilder);
kpiBuilderModal.addEventListener('click', (event) => { if (event.target === kpiBuilderModal) closeKpiBuilder(); });
kpiName.addEventListener('input', () => { previewKpiName.textContent = kpiName.value || 'Untitled KPI'; });
document.querySelectorAll('[data-visual]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-visual]').forEach((item) => item.classList.toggle('is-selected', item === button));
}));
document.querySelectorAll('#sheetGrid button').forEach((cell) => cell.addEventListener('click', () => {
  document.querySelectorAll('#sheetGrid button').forEach((item) => item.classList.toggle('is-selected', item === cell));
  if (cell.dataset.cell) document.querySelector('#sheetRange').value = cell.dataset.cell;
}));
document.querySelector('#selectRangeButton').addEventListener('click', () => {
  document.querySelector('#sheetGrid').scrollIntoView({ behavior: 'smooth', block: 'center' });
  showToast('Cell selector ready', 'Choose a cell in the preview or enter any A1 range.');
});
document.querySelector('#reconnectSource').addEventListener('click', () => showToast('OAuth handoff ready', `Production will open ${activeKpiSource === 'google' ? 'Google' : 'HubSpot'} consent in a secure new window.`));
document.querySelectorAll('.connect-source').forEach((button) => button.addEventListener('click', () => showToast(`${button.dataset.source === 'google' ? 'Google Sheets' : 'HubSpot'} connection`, 'Healthy, scoped, and refreshing every five minutes.')));
document.querySelector('#browseIntegrations').addEventListener('click', () => showToast('Integration catalog', 'Google Sheets and HubSpot are ready; Shopify is next.'));
document.querySelectorAll('.integration-catalog button').forEach((button) => button.addEventListener('click', () => showToast(button.querySelector('b').textContent, button.querySelector('i').textContent === 'Suggest' ? 'Request captured in this prototype.' : 'This connector is queued for a later phase.')));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && kpiBuilderModal.classList.contains('is-visible')) closeKpiBuilder();
});

const featureModals = [...document.querySelectorAll('.feature-overlay')];
const shareTabs = [...document.querySelectorAll('[data-share-tab]')];
const sharePanels = [...document.querySelectorAll('[data-share-panel]')];
let activeFeatureModal = null;
let featureReturnFocus = null;
let loopTimer = null;

function startLoopCountdown() {
  const countdown = document.querySelector('#loopCountdown');
  let seconds = 45;
  countdown.textContent = seconds;
  window.clearInterval(loopTimer);
  loopTimer = window.setInterval(() => {
    seconds -= 1;
    if (seconds <= 0) {
      seconds = 30;
      document.querySelector('#tvPreviewTitle').textContent = 'Pipeline health';
      document.querySelector('.tv-preview-stage header small').textContent = 'REVENUE PULSE · VIEW 2 OF 3';
    }
    countdown.textContent = seconds;
  }, 1000);
}

function openFeatureModal(id, trigger = document.activeElement) {
  const modal = document.querySelector(`#${id}`);
  if (!modal) return;
  featureReturnFocus = trigger;
  activeFeatureModal = modal;
  modal.classList.add('is-visible');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  modal.querySelector('[data-close-feature]')?.focus();
  if (id === 'tvPreviewModal') startLoopCountdown();
}

function closeFeatureModal(modal = activeFeatureModal) {
  if (!modal) return;
  modal.classList.remove('is-visible');
  modal.setAttribute('aria-hidden', 'true');
  if (modal.id === 'tvPreviewModal') {
    window.clearInterval(loopTimer);
    document.querySelector('#tvPreviewTitle').textContent = 'Sales performance';
    document.querySelector('.tv-preview-stage header small').textContent = 'REVENUE PULSE · VIEW 1 OF 3';
  }
  activeFeatureModal = null;
  document.body.style.overflow = '';
  featureReturnFocus?.focus?.();
}

document.querySelector('#templateGalleryButton').addEventListener('click', (event) => openFeatureModal('templateModal', event.currentTarget));
document.querySelector('#shareDashboardButton').addEventListener('click', (event) => openFeatureModal('shareModal', event.currentTarget));
document.querySelector('#openTvMode').addEventListener('click', (event) => openFeatureModal('tvPreviewModal', event.currentTarget));
document.querySelector('#previewLoopButton').addEventListener('click', (event) => openFeatureModal('tvPreviewModal', event.currentTarget));

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
document.querySelector('#openSourceButton').addEventListener('click', () => showToast('Source handoff ready', 'Production opens the exact permitted Sheet cell or HubSpot view.'));

document.querySelector('#pairScreenButton').addEventListener('click', () => showToast('Pairing code: AXO-482', 'Enter this one-time code on the new display within 10 minutes.'));
document.querySelector('#saveLoopButton').addEventListener('click', () => showToast('Revenue pulse saved', 'Three views will rotate during active hours.'));
document.querySelector('.add-loop-view').addEventListener('click', () => showToast('Content picker ready', 'Add any dashboard, celebration reel, or game preset to this loop.'));
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

document.querySelectorAll('.rule-card .toggle input').forEach((toggle) => toggle.addEventListener('change', () => {
  const name = toggle.closest('.rule-card').querySelector('h3').textContent;
  showToast(`${name} ${toggle.checked ? 'enabled' : 'paused'}`, toggle.checked ? 'Future matching events will run this rule.' : 'No new events will run until it is enabled.');
}));
document.querySelectorAll('.rule-card footer button').forEach((button) => button.addEventListener('click', () => showToast('Rule editor ready', `Edit ${button.closest('.rule-card').querySelector('h3').textContent}, destinations, cooldowns, and quiet hours.`)));
document.querySelector('#viewRunLogButton').addEventListener('click', () => showToast('Automation log', '128 runs · 128 successful · 0 duplicates · full source lineage retained.'));
document.querySelector('#newAutomationButton').addEventListener('click', () => {
  const article = document.createElement('article');
  article.className = 'surface rule-card prototype-rule';
  article.innerHTML = '<header><span class="rule-icon goal">＋</span><div><h3>New KPI rule</h3><p>Choose a KPI threshold and one or more outcomes</p></div><label class="toggle"><input type="checkbox" /><span></span></label></header><div class="rule-flow"><div><small>WHEN</small><strong>Select KPI + condition</strong></div><i>→</i><div><small>THEN</small><span class="action-chip celebration">＋ Add action</span></div></div><footer><span>Draft · never run</span><button type="button">Continue setup</button></footer>';
  document.querySelector('.rule-list').prepend(article);
  article.querySelector('footer button').addEventListener('click', () => showToast('Automation builder ready', 'Choose a trusted metric, threshold, cooldown, and destinations.'));
  showToast('Automation draft created', 'It will not run until its trigger, actions, and safeguards are configured.');
  article.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeFeatureModal) closeFeatureModal(activeFeatureModal);
});

const workflowDefinitions = {
  workspace: { eyebrow: 'WORKSPACE ACCESS', title: 'Switch workspace', description: 'Move between tenants without mixing data, brands, permissions, or credentials.', steps: ['Choose workspace','Confirm context'], primary: 'Switch workspace', canvas: '<h3>Your workspaces</h3><p>New workspace is an empty onboarding sample; Acme Sales contains populated synthetic fixtures.</p><div class="workflow-grid"><button class="workflow-card" data-workspace-id="sample-empty" type="button"><span>N</span><strong>New workspace</strong><small>Owner · blank OAuth test workspace</small><i>Choose</i></button><button class="workflow-card" data-workspace-id="acme" type="button"><span>A</span><strong>Acme Sales</strong><small>Owner · populated sample tenant</small><i>Choose</i></button></div>', context: '<h3>Tenant boundary</h3><p>Dashboards, integrations, assets, rules, tokens, and games remain isolated by workspace.</p><div class="workflow-summary"><div><small>NEW WORKSPACE</small><strong>No inherited credentials</strong></div><div><small>SESSION</small><strong>Revalidated on switch</strong></div></div>' },
  profile: { eyebrow: 'ACCOUNT & PREFERENCES', title: 'Your AxoBoard profile', description: 'Manage personal display, notification, sound, and accessibility defaults.', steps: ['Profile','Preferences','Security'], primary: 'Save preferences', canvas: '<h3>Personal preferences</h3><p>These follow you across workspaces unless an admin policy overrides them.</p><div class="workflow-form"><div class="field-row"><label>Display name<input value="Jordan Lee" /></label><label>Timezone<select><option>America/Denver</option><option>America/New_York</option></select></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> Email me when an automation needs attention</label><label><input type="checkbox" checked /> Respect reduced-motion system preference</label><label><input type="checkbox" /> Mute celebration sounds on this device</label></div></div>', context: '<h3>Account security</h3><p>Last sign-in today at 8:14 AM. MFA is enabled.</p><div class="workflow-summary"><div><small>ROLE</small><strong>Workspace owner</strong></div><div><small>ACTIVE SESSIONS</small><strong>2 devices</strong></div></div>' },
  dashboard: { eyebrow: 'DASHBOARD CONFIGURATION', title: 'Edit dashboard', description: 'Change the time window, layout, refresh behavior, and card settings.', steps: ['Configure','Preview','Publish'], primary: 'Preview changes', canvas: '<h3>Dashboard settings</h3><p>Changes stay in a draft until you publish them.</p><div class="workflow-form"><div class="field-row"><label>Time window<select><option>Today</option><option>This week</option><option>This month</option><option>Rolling 30 days</option></select></label><label>Refresh interval<select><option>Every 5 minutes</option><option>Every minute</option><option>Every 15 minutes</option></select></label></div><label>Layout density<select><option>Comfortable</option><option>Compact</option><option>TV optimized</option></select></label><div class="workflow-checks"><label><input type="checkbox" checked /> Show source and freshness on every card</label><label><input type="checkbox" checked /> Preserve mobile card order</label></div></div>', context: '<h3>Draft impact</h3><p>4 KPI cards, 1 trend chart, and 3 attention rules use this dashboard.</p><div class="workflow-preview"><span>▦</span><strong>Sales performance</strong><small>Responsive preview · no live changes</small></div>' },
  kpi: { eyebrow: 'KPI SETTINGS', title: 'Edit KPI card', description: 'Update source mapping, calculation, appearance, goal, and alert behavior.', steps: ['Source','Calculation','Display','Publish'], primary: 'Review KPI', canvas: '<h3>Metric and display</h3><p>The source contract stays visible while you customize the card.</p><div class="workflow-form"><label>KPI name<input value="Net sales today" /></label><div class="field-row"><label>Format<select><option>Currency · no decimals</option><option>Number</option><option>Percentage</option></select></label><label>Goal<input value="$65,000" /></label></div><label>Comparison<select><option>Versus yesterday</option><option>Versus prior week</option><option>Versus goal only</option></select></label><div class="workflow-checks"><label><input type="checkbox" checked /> Enable source drilldown</label><label><input type="checkbox" checked /> Show stale warning after 15 minutes</label></div></div>', context: '<h3>Trusted source</h3><p>Google Sheets → 2026 Sales Performance → Summary!D8</p><div class="workflow-summary"><div><small>CURRENT VALUE</small><strong>$55,396</strong></div><div><small>FRESHNESS</small><strong>2 minutes ago · healthy</strong></div><div><small>OWNER</small><strong>Sales Ops</strong></div></div>' },
  alert: { eyebrow: 'ALERT & ACTION BUILDER', title: 'Configure an alert', description: 'Turn a trusted KPI condition into controlled notifications and team actions.', steps: ['Trigger','Actions','Guardrails','Test'], primary: 'Test rule', canvas: '<h3>When should this run?</h3><p>Rules evaluate normalized KPI snapshots—not raw browser values.</p><div class="workflow-form"><div class="field-row"><label>KPI<select><option>Pipeline coverage</option><option>Net sales today</option><option>Team on track</option></select></label><label>Condition<select><option>Falls below</option><option>Reaches</option><option>Changes by more than</option></select></label></div><div class="field-row"><label>Threshold<input value="3×" /></label><label>For at least<select><option>30 minutes</option><option>Immediately</option><option>1 hour</option></select></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> Slack #sales-leadership</label><label><input type="checkbox" /> Email the metric owner</label><label><input type="checkbox" /> Start a quiet celebration</label></div></div>', context: '<h3>Guardrail preview</h3><p>This would have run twice in the last 30 days.</p><div class="workflow-summary"><div><small>COOLDOWN</small><strong>4 hours</strong></div><div><small>QUIET HOURS</small><strong>8 PM–7 AM</strong></div><div><small>STALE DATA</small><strong>Block rule</strong></div></div>' },
  connector: { eyebrow: 'INTEGRATION SETUP', title: 'Connect a data source', description: 'Authorize the smallest useful scope, validate it, and create the first mapping.', steps: ['Choose source','Authorize','Validate','Map data'], primary: 'Continue to OAuth', canvas: '<h3>Available connectors</h3><p>Deep, observable connections beat a huge brittle catalog.</p><div class="workflow-grid"><button class="workflow-card is-selected" type="button"><span class="integration-logo google" aria-label="Google Sheets">Google Sheets</span><strong>Google Sheets</strong><small>Files, worksheets, cells, and named ranges</small><i>OAuth ready</i></button><button class="workflow-card" type="button"><span class="integration-logo hubspot" aria-label="HubSpot">HubSpot</span><strong>HubSpot</strong><small>Objects, standard/custom properties, filters</small><i>OAuth ready</i></button><button class="workflow-card" type="button"><span>▤</span><strong>Shopify</strong><small>Orders, refunds, net sales, products</small><i>Wireframe next</i></button><button class="workflow-card" type="button"><span>↯</span><strong>Webhook / API</strong><small>Push signed custom events</small><i>Wireframe next</i></button></div>', context: '<h3>Connection requirements</h3><p>Tokens stay encrypted server-side. Revocation, freshness, rate limits, and errors remain visible.</p><div class="workflow-summary"><div><small>AUTH</small><strong>OAuth 2.0</strong></div><div><small>SYNC</small><strong>Incremental + retry</strong></div></div>' },
  connection: { eyebrow: 'CONNECTION MANAGEMENT', title: 'Manage connection', description: 'Inspect health, scopes, mappings, sync history, and revocation.', steps: ['Health','Mappings','Permissions'], primary: 'Save connection', canvas: '<h3>Google Sheets connection</h3><p>Healthy and currently used by two published KPI mappings.</p><div class="workflow-form"><div class="field-row"><label>Account<input value="jordan@acme.co" readonly /></label><label>Refresh<select><option>Every 5 minutes</option><option>Every 15 minutes</option></select></label></div><ul class="workflow-list"><li><span>▦</span><div><strong>Net sales today</strong><small>Summary!D8 · refreshed 2m ago</small></div><button type="button">Edit</button></li><li><span>◎</span><div><strong>Team on track</strong><small>Reps!G4:G18 · refreshed 2m ago</small></div><button type="button">Edit</button></li></ul></div>', context: '<h3>Connection health</h3><p>OAuth token valid. No rate limits or mapping errors.</p><div class="workflow-summary"><div><small>LAST SYNC</small><strong>2 minutes ago</strong></div><div><small>SCOPES</small><strong>Selected files only</strong></div><div><small>NEXT CHECK</small><strong>In 3 minutes</strong></div></div>' },
  screen: { eyebrow: 'DISPLAY CONTROL', title: 'Manage TV screen', description: 'Pair, assign content, set a schedule, and diagnose the player remotely.', steps: ['Screen','Content','Schedule','Confirm'], primary: 'Apply to screen', canvas: '<h3>Screen and content</h3><p>Updates apply on the next player heartbeat.</p><div class="workflow-form"><div class="field-row"><label>Screen name<input value="Sales Floor TV" /></label><label>Location<input value="Front office" /></label></div><label>Content<select><option>Revenue pulse · 3 views</option><option>Sales performance</option><option>Team Challenge</option><option>Concierge Pulse</option></select></label><div class="field-row"><label>Wake<select><option>7:00 AM</option><option>Always on</option></select></label><label>Sleep<select><option>8:00 PM</option><option>Never</option></select></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> Auto-recover last-known-good content</label><label><input type="checkbox" /> Notify admin when offline for 5 minutes</label></div></div>', context: '<h3>Player heartbeat</h3><p>Chrome · 4K · player v0.4.1</p><div class="workflow-summary"><div><small>STATUS</small><strong>Online · 18s ago</strong></div><div><small>LAST RENDER</small><strong>Successful</strong></div><div><small>PAIRING</small><strong>Device-bound token</strong></div></div>' },
  automation: { eyebrow: 'AUTOMATION WORKFLOW', title: 'Edit automation rule', description: 'Build the trigger, actions, cooldowns, and replay policy as one auditable rule.', steps: ['Trigger','Actions','Guardrails','Dry run'], primary: 'Run dry test', canvas: '<h3>Rule definition</h3><p>Every destination gets its own idempotency key and retry state.</p><div class="workflow-form"><label>Rule name<input value="Sales goal crossed" /></label><div class="field-row"><label>Metric<select><option>Net sales today</option><option>Open pipeline</option></select></label><label>Condition<select><option>Reaches $65,000</option><option>Crosses 100% of goal</option></select></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> ✦ Play celebration</label><label><input type="checkbox" checked /> # Post to Slack</label><label><input type="checkbox" checked /> ⚔ Award 100 Kombat points</label></div><div class="field-row"><label>Cooldown<select><option>Once per day</option><option>4 hours</option></select></label><label>Quiet hours<select><option>8 PM–7 AM</option><option>None</option></select></label></div></div>', context: '<h3>Recent dry-run result</h3><p>1 match across the last 30 days; no duplicate event IDs.</p><div class="workflow-summary"><div><small>RULE STATE</small><strong>Draft version 4</strong></div><div><small>STALE METRIC</small><strong>Do not run</strong></div></div>' },
  runs: { eyebrow: 'AUTOMATION OBSERVABILITY', title: 'Automation run log', description: 'Inspect every evaluation, suppression, destination attempt, and replay.', steps: ['Runs','Details','Replay'], primary: 'Export log', canvas: '<h3>Recent runs</h3><p>Filter by rule, metric, outcome, destination, or event ID.</p><div class="run-ledger"><div class="run-row"><span>Today · 1:06</span><strong>Big deal landed · 3 actions</strong><b class="success">Succeeded</b></div><div class="run-row"><span>Today · 10:18</span><strong>Pipeline coverage · Slack + email</strong><b class="success">Succeeded</b></div><div class="run-row"><span>Yesterday</span><strong>Sales goal crossed · cooldown active</strong><b class="suppressed">Suppressed</b></div><div class="run-row"><span>Aug 10</span><strong>Big deal landed · duplicate event ID</strong><b class="suppressed">Deduped</b></div></div>', context: '<h3>Thirty-day health</h3><p>128 evaluations with no duplicate outcomes.</p><div class="workflow-summary"><div><small>SUCCESS</small><strong>100%</strong></div><div><small>SUPPRESSED</small><strong>14 expected</strong></div><div><small>RETRIES</small><strong>2 recovered</strong></div></div>' },
  celebration: { eyebrow: 'CELEBRATION WORKFLOW', title: 'Celebrate and recognize', description: 'Review wins, create a shoutout, and choose exactly where the moment appears.', steps: ['Choose win','Message','Audience','Preview'], primary: 'Preview shoutout', canvas: '<h3>Create a team shoutout</h3><p>Recognition can be sent without changing KPI or scoring records.</p><div class="workflow-form"><label>Person or team<select><option>Maya Patel · $18,420 deal</option><option>Sales team · crossed 80%</option><option>Custom recognition</option></select></label><label>Message<textarea>You crushed it—great discovery, follow-through, and a huge finish.</textarea></label><div class="workflow-checks"><label><input type="checkbox" checked /> Celebration HQ</label><label><input type="checkbox" checked /> Sales Floor TV</label><label><input type="checkbox" /> Slack #sales-wins</label></div></div>', context: '<h3>Moment preview</h3><p>Respects quiet hours, device volume, and reduced motion.</p><div class="workflow-preview"><span>✦</span><strong>Huge win, Maya!</strong><small>Victory Splash · high hype</small></div>' },
  sound: { eyebrow: 'SOUND WORKFLOW', title: 'Upload and assign sound', description: 'Validate ownership, preview volume, tag the asset, and assign safe triggers.', steps: ['Upload','Review','Assign','Publish'], primary: 'Validate sound', canvas: '<h3>Add a sound asset</h3><p>Supported: MP3, WAV, or M4A up to 25MB.</p><div class="workflow-drop"><span>↑</span><strong>Drop a sound here or browse</strong><small>Virus scan, duration, loudness, and waveform validation run before publishing.</small></div><div class="workflow-form"><div class="field-row"><label>Name<input value="Victory Splash" /></label><label>Tags<input value="Win, Water" /></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> I own or have permission to use this audio</label><label><input type="checkbox" checked /> Normalize loudness for shared displays</label></div></div>', context: '<h3>Assignment preview</h3><p>Choose event, team scope, volume, cooldown, and quiet-hour behavior.</p><div class="workflow-summary"><div><small>TRIGGERS</small><strong>Deal won · Team goal</strong></div><div><small>VOLUME</small><strong>80% · normalized</strong></div></div>' },
  game: { eyebrow: 'KOMBAT ASSET WORKFLOW', title: 'Customize game asset', description: 'Edit names, sprites, arenas, sounds, scoring, and responsive preview modes.', steps: ['Choose asset','Customize','Test','Publish'], primary: 'Test in game', canvas: '<h3>Asset library</h3><p>Use a preset, upload tenant-owned artwork, or create a reusable game asset.</p><div class="workflow-grid"><button class="workflow-card is-selected" type="button"><span>•ᴗ•</span><strong>Leucistic fighter</strong><small>Team sprite · transparent PNG</small><i>Selected</i></button><button class="workflow-card" type="button"><span>🌊</span><strong>Aquatic arena</strong><small>Responsive background + safe zones</small><i>Choose</i></button><button class="workflow-card" type="button"><span>♫</span><strong>Victory Splash</strong><small>3 seconds · normalized</small><i>Choose</i></button><button class="workflow-card" type="button"><span>↑</span><strong>Upload asset</strong><small>PNG, SVG, WebP, MP3, WAV</small><i>Add new</i></button></div>', context: '<h3>Asset checks</h3><p>Transparent edges, TV/mobile safe zones, licensing, and file scanning are required.</p><div class="workflow-summary"><div><small>MOBILE</small><strong>390px preview passes</strong></div><div><small>TV</small><strong>4K safe zone passes</strong></div></div>' },
  brand: { eyebrow: 'BRAND PUBLISHING', title: 'Complete your brand system', description: 'Finish logo, colors, type, language, domains, and accessibility before publishing.', steps: ['Identity','Theme','Language','Review'], primary: 'Continue to theme', canvas: '<h3>Brand setup</h3><p>One versioned theme powers dashboards, celebrations, sounds, games, shares, and TV.</p><div class="workflow-form"><label>Logo asset<input value="axoboard-logo-low-poly.png" /></label><div class="field-row"><label>Primary color<input type="color" value="#E96F98" /></label><label>Accent color<input type="color" value="#43BDE8" /></label></div><label>Heading font<select><option>Fredoka</option><option>DM Sans</option><option>Customer font upload</option></select></label><div class="workflow-checks"><label><input type="checkbox" checked /> Apply to dashboards</label><label><input type="checkbox" checked /> Apply to TV, celebrations, and games</label></div></div>', context: '<h3>Publish checklist</h3><p>Theme changes produce a previewable version with rollback.</p><div class="workflow-summary"><div><small>CONTRAST</small><strong>WCAG AA passes</strong></div><div><small>MOBILE</small><strong>All routes pass</strong></div><div><small>ROLLBACK</small><strong>Previous version retained</strong></div></div>' },
  data: { eyebrow: 'DATA DETAIL', title: 'Export and metric history', description: 'Inspect definition changes, refresh history, annotations, and permitted exports.', steps: ['History','Compare','Export'], primary: 'Prepare export', canvas: '<h3>Metric history</h3><p>Value and definition changes remain independently auditable.</p><div class="run-ledger"><div class="run-row"><span>Today · 2m</span><strong>$55,396 · successful refresh</strong><b class="success">Fresh</b></div><div class="run-row"><span>Today · 9:00</span><strong>$42,180 · successful refresh</strong><b class="success">Fresh</b></div><div class="run-row"><span>Aug 8</span><strong>Definition changed by Sales Ops</strong><b class="suppressed">Version 3</b></div></div><div class="workflow-form"><label>Export format<select><option>CSV · visible permitted rows</option><option>CSV · metric snapshots</option><option>PDF · audit summary</option></select></label></div>', context: '<h3>Export policy</h3><p>Exports respect tenant, share-grant, field allowlist, and provider permissions.</p><div class="workflow-summary"><div><small>ROWS</small><strong>48 permitted</strong></div><div><small>REDACTION</small><strong>2 fields hidden</strong></div></div>' },
  customer: { eyebrow: 'CUSTOMER ONBOARDING', title: 'Launch your AxoBoard workspace', description: 'Get from sign-up to a trusted, branded dashboard and first team moment.', steps: ['Workspace','Brand','Data','Team','Launch'], primary: 'Continue setup', canvas: '<h3>Workspace foundation</h3><p>This creates a separate tenant boundary for the customer.</p><div class="workflow-form"><div class="field-row"><label>Workspace name<input data-customer-workspace value="Acme Sales" /></label><label>Timezone<select><option>America/Denver</option><option>America/New_York</option><option>America/Los_Angeles</option></select></label></div><label>Primary use case<select><option>Sales performance & celebrations</option><option>Customer support operations</option><option>Executive scorecards</option><option>Custom team performance</option></select></label><div class="workflow-checks"><label><input type="checkbox" checked /> Start with the Sales Daily Command recipe</label><label><input type="checkbox" checked /> Include mobile and TV layouts</label></div></div>', context: '<h3>Customer outcome</h3><p>A branded workspace, first trusted KPI, invited team, and tested celebration—not an empty canvas.</p><div class="workflow-summary"><div><small>TARGET TIME</small><strong>Under 10 minutes</strong></div><div><small>DATA BOUNDARY</small><strong>Tenant isolated</strong></div></div>' },
  members: { eyebrow: 'PEOPLE & PERMISSIONS', title: 'Invite and manage members', description: 'Give each person the minimum role needed and keep customer access auditable.', steps: ['People','Roles','Invite','Review'], primary: 'Review invitations', canvas: '<h3>Invite teammates</h3><p>Invitations are scoped to this workspace and expire automatically.</p><div class="workflow-form"><label>Email addresses<textarea placeholder="maya@acme.co\nethan@acme.co"></textarea></label><div class="field-row"><label>Role<select><option>Viewer</option><option>Editor</option><option>Automation manager</option><option>Workspace admin</option></select></label><label>Invitation expires<select><option>In 7 days</option><option>In 24 hours</option><option>In 30 days</option></select></label></div><div class="workflow-checks"><label><input type="checkbox" checked /> Send onboarding checklist</label><label><input type="checkbox" /> Require MFA before editor access</label></div></div>', context: '<h3>Role boundaries</h3><p>Viewers cannot edit, connect sources, publish, export, or manage billing.</p><div class="workflow-summary"><div><small>OWNER</small><strong>Full control</strong></div><div><small>EDITOR</small><strong>Draft + publish content</strong></div><div><small>VIEWER</small><strong>Published views only</strong></div></div>' },
  billing: { eyebrow: 'PLAN & BILLING', title: 'Manage plan and usage', description: 'Understand limits, billing ownership, invoices, and what grows with the customer.', steps: ['Plan','Usage','Billing','Confirm'], primary: 'Review plan', canvas: '<h3>Commercial plan</h3><p>Choose capacity without charging every person who needs visibility.</p><div class="workflow-grid"><button class="workflow-card" type="button"><span>◌</span><strong>Starter · $99/mo</strong><small>3 sources · 1 screen · core dashboards</small><i>Available</i></button><button class="workflow-card is-selected" type="button"><span>✦</span><strong>Growth · $249/mo</strong><small>10 sources · 5 screens · sounds and games</small><i>Current beta</i></button><button class="workflow-card" type="button"><span>◇</span><strong>Scale · $599/mo</strong><small>30 sources · governance · priority support</small><i>Available</i></button><button class="workflow-card" type="button"><span>＋</span><strong>Enterprise</strong><small>SSO, SLA, custom capacity and retention</small><i>Contact sales</i></button></div>', context: '<h3>Metered dimensions</h3><p>Usage warnings arrive before limits. Additional charges always require an explicit choice.</p><div class="workflow-summary"><div><small>VIEWERS</small><strong>Unlimited</strong></div><div><small>CAPACITY</small><strong>Sources · screens · automation</strong></div><div><small>OVERAGE POLICY</small><strong>Warn before charge</strong></div></div>' },
  support: { eyebrow: 'CUSTOMER SUCCESS', title: 'Get AxoBoard support', description: 'Ask for help without exposing secrets, tokens, or unrelated customer data.', steps: ['Issue','Diagnostics','Contact'], primary: 'Prepare support request', canvas: '<h3>How can we help?</h3><p>A support bundle includes only approved workspace diagnostics.</p><div class="workflow-form"><label>Topic<select><option>Setup and onboarding</option><option>Data source or freshness</option><option>Dashboard or display</option><option>Automation or celebration</option><option>Billing and account</option></select></label><label>What happened?<textarea placeholder="Tell us what you expected and what you saw."></textarea></label><div class="workflow-checks"><label><input type="checkbox" checked /> Include connection health and recent error codes</label><label><input type="checkbox" checked /> Include browser and AxoBoard version</label><label><input type="checkbox" /> Include redacted automation run IDs</label></div></div>', context: '<h3>Privacy boundary</h3><p>Support bundles exclude OAuth tokens, raw credentials, private sound assets, and unrelated tenant records.</p><div class="workflow-summary"><div><small>RESPONSE TARGET</small><strong>Defined by plan</strong></div><div><small>STATUS PAGE</small><strong>All systems healthy</strong></div></div>' },
  guide: { eyebrow: 'SETUP GUIDE', title: 'Customer setup guide', description: 'A short, outcome-led path from workspace creation to launch.', steps: ['Brand','Connect','Build','Invite','Launch'], primary: 'Start guided setup', canvas: '<h3>Recommended launch path</h3><p>Each step has a success signal and a recovery path.</p><ul class="workflow-list"><li><span>1</span><div><strong>Make it recognizable</strong><small>Logo, colors, language, and mobile preview</small></div><button type="button">Open</button></li><li><span>2</span><div><strong>Connect one trusted source</strong><small>OAuth, mapping, freshness, and owner</small></div><button type="button">Open</button></li><li><span>3</span><div><strong>Publish the first outcome recipe</strong><small>Dashboard, goal, alert, celebration, and loop</small></div><button type="button">Open</button></li><li><span>4</span><div><strong>Invite the right people</strong><small>Viewer, editor, manager, and admin roles</small></div><button type="button">Open</button></li></ul>', context: '<h3>Launch definition</h3><p>The customer can explain AxoBoard in 60 seconds and operate it without babysitting.</p><div class="workflow-summary"><div><small>FIRST VALUE</small><strong>Published KPI</strong></div><div><small>TEAM MOMENT</small><strong>Tested celebration</strong></div></div>' },
  oauth: { eyebrow: 'FRESH OAUTH TEST', title: 'Authorize a new connection', description: 'Start from provider consent without importing or reusing any existing credential.', steps: ['Preflight','Consent','Callback','Verify'], primary: 'Review fresh consent', canvas: '<h3 data-oauth-heading>Fresh OAuth preflight</h3><p data-oauth-copy>No cached account or connection will be used.</p><div class="oauth-contract"><div><small>ATTEMPT</small><strong data-oauth-attempt>New session</strong></div><div><small>TENANT</small><strong>Current workspace only</strong></div><div><small>CREDENTIAL REUSE</small><strong>Blocked</strong></div><div><small>LIVE TOKEN</small><strong>Not stored in this prototype</strong></div></div><div class="workflow-checks"><label><input type="checkbox" checked disabled /> Generate a unique state value for callback validation</label><label><input type="checkbox" checked disabled /> Use AxoBoard-owned client credentials only</label><label><input type="checkbox" checked disabled /> Encrypt tenant-scoped tokens server-side in production</label><label><input type="checkbox" checked disabled /> Expose disconnect, revocation, expiry, and retry status</label></div>', context: '<h3>Prototype boundary</h3><p data-oauth-boundary>This validates the onboarding contract, not a real provider token exchange.</p><div class="credential-boundary compact"><b>No credential import</b><span>Existing service accounts, portal tokens, browser sessions, and prior OAuth grants are never read or copied into a new workspace.</span></div><div class="workflow-summary"><div><small>CALLBACK</small><strong>/api/oauth/{provider}/callback</strong></div><div><small>STATUS</small><strong>Provider app registration required</strong></div></div>' },
  generic: { eyebrow: 'FEATURE WIREFRAME', title: 'Feature setup', description: 'This control now has a defined next state and production requirements.', steps: ['Configure','Review','Save'], primary: 'Save draft', canvas: '<h3>Configuration</h3><p>This workflow is captured for the implementation backlog.</p><div class="workflow-form"><label>Name<input value="New configuration" /></label><label>Notes<textarea>Define the final data contract, permissions, failure states, and success signal.</textarea></label><div class="workflow-checks"><label><input type="checkbox" checked /> Mobile-compatible</label><label><input type="checkbox" checked /> Audit changes</label></div></div>', context: '<h3>Definition of done</h3><p>Runs end-to-end, exposes errors, supports rollback, and has no silent controls.</p>' }
};

let activeWorkflow = null;
let workflowStep = 0;

function renderWorkflow() {
  const definition = workflowDefinitions[activeWorkflow] || workflowDefinitions.generic;
  document.querySelector('#workflowEyebrow').textContent = definition.eyebrow;
  document.querySelector('#workflowTitle').textContent = definition.title;
  document.querySelector('#workflowDescription').textContent = definition.description;
  document.querySelector('#workflowCanvas').innerHTML = definition.canvas;
  document.querySelector('#workflowContext').innerHTML = definition.context;
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
  const definition = workflowDefinitions[activeWorkflow] || workflowDefinitions.generic;
  document.querySelector('#workflowProgress').innerHTML = definition.steps.map((step, index) => `${index ? '<i></i>' : ''}<span data-step="${index + 1}" class="${index === workflowStep ? 'is-active' : ''}">${step}</span>`).join('');
  document.querySelector('#workflowPrimary').textContent = workflowStep === definition.steps.length - 1 ? 'Save draft' : definition.primary;
  document.querySelector('#workflowStatus').textContent = `Step ${workflowStep + 1} of ${definition.steps.length} · prototype draft`;
}

function openWorkflow(type, trigger = document.activeElement, titleOverride = '') {
  if (activeFeatureModal && activeFeatureModal.id !== 'workflowModal') {
    activeFeatureModal.classList.remove('is-visible');
    activeFeatureModal.setAttribute('aria-hidden', 'true');
    activeFeatureModal = null;
  }
  activeWorkflow = workflowDefinitions[type] ? type : 'generic';
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
document.querySelector('#workflowPrimary').addEventListener('click', () => {
  const definition = workflowDefinitions[activeWorkflow] || workflowDefinitions.generic;
  if (workflowStep < definition.steps.length - 1) {
    workflowStep += 1;
    updateWorkflowProgress();
    showToast(`${definition.steps[workflowStep]} ready`, 'The workflow advanced to the next wireframed state.');
    return;
  }
  const completedWorkflows = [...new Set([...betaState.completedWorkflows, activeWorkflow])];
  const workspaceValue = document.querySelector('[data-customer-workspace]')?.value.trim();
  const selectedWorkspace = activeWorkflow === 'workspace' ? document.querySelector('#workflowCanvas [data-workspace-id].is-selected')?.dataset.workspaceId : null;
  persistBetaState({ completedWorkflows, draftCount: betaState.draftCount + 1, ...(workspaceValue ? { workspaceName: workspaceValue } : {}) });
  if (workspaceValue) {
    document.querySelector('#serviceWorkspaceName').textContent = workspaceValue;
    workspaceName.value = workspaceValue;
    syncBrandPreview();
  }
  if (selectedWorkspace) {
    const profile = workspaceProfiles[selectedWorkspace];
    persistBetaState({ activeWorkspace: selectedWorkspace, workspaceName: profile.name, ...(selectedWorkspace === 'sample-empty' ? { teamOne: 'Team One', teamTwo: 'Team Two' } : {}) });
    applyWorkspaceMode();
  }
  closeFeatureModal(document.querySelector('#workflowModal'));
  const detail = activeWorkflow === 'oauth'
    ? 'OAuth handoff test recorded. No provider redirect occurred and no credential or token was stored.'
    : 'Saved in this beta browser. Nothing was published or sent externally.';
  showToast(`${definition.title} saved as a draft`, detail);
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
  ['.workspace-switcher button', 'workspace'], ['.sidebar-user button', 'profile'],
  ['.dashboard-toolbar button:not(#openTvMode)', 'dashboard'], ['.kpi-card header button', 'kpi'], ['.attention-card li button', 'alert'], ['.attention-card > button', 'alert'],
  ['#browseIntegrations', 'connector'], ['.integration-catalog button', 'connector'], ['.connect-source', 'connection'],
  ['#pairScreenButton, .display-summary button, .screen-device footer button, .add-loop-view', 'screen'],
  ['.rule-card footer button, #newAutomationButton', 'automation'], ['#viewRunLogButton', 'runs'],
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
    button.addEventListener('click', (event) => openWorkflow(type, event.currentTarget));
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
  document.querySelectorAll('[data-price-note]').forEach((note) => { note.textContent = cycle === 'annual' ? 'Billed annually' : 'Cancel anytime'; });
  showToast(cycle === 'annual' ? 'Annual pricing applied' : 'Monthly pricing applied', cycle === 'annual' ? 'The displayed monthly rate is billed as one annual commitment.' : 'Flexible monthly billing is shown.');
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
  const known = button.matches('[data-screen], [data-plan-cycle], [data-plan-action], [data-fresh-oauth], [data-load-demo], [data-reset-sample], [data-empty-workflow], [data-close-feature], [data-share-tab], [data-celebration-style], .use-template, .source-choice, [data-visual], #sheetGrid button, #builderBack, #builderNext, #closeKpiBuilder, #closeWin, #replayWin, #celebrateButton, #previewCelebration, .replay-mini, .sound-row, #soundPreviewButton, #wavePlay, #saveSound, #uploadZone, #uploadSoundButton, #previewGame, #publishGame, #publishBrand, #templateGalleryButton, #shareDashboardButton, #openTvMode, #previewLoopButton, #pairScreenButton, #saveLoopButton, [data-move-loop], #copyShareLink, #createShareLink, #saveSnapshotSchedule, #openSourceButton, #selectRangeButton, #reconnectSource, .build-source-kpi, .destination-grid button, #workflowCancel, #workflowPrimary');
  if (button.dataset.workflowWired) { button.dataset.interactionStatus = 'wireframed'; return; }
  if (known) { button.dataset.interactionStatus = 'working'; return; }
  button.dataset.workflowWired = 'generic';
  button.dataset.interactionStatus = 'wireframed';
  button.addEventListener('click', (event) => openWorkflow('generic', event.currentTarget, (button.textContent || button.getAttribute('aria-label') || 'Feature setup').trim().replace(/\s+/g, ' ')));
});

new MutationObserver((mutations) => {
  mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (!(node instanceof Element)) return;
    const buttons = node.matches('button') ? [node] : [...node.querySelectorAll('button')];
    buttons.forEach((button) => {
      if (button.dataset.interactionStatus) return;
      const type = button.closest('.kpi-card') ? 'kpi' : button.closest('.rule-card') ? 'automation' : 'generic';
      button.dataset.workflowWired = type;
      button.dataset.interactionStatus = 'wireframed';
      button.addEventListener('click', (event) => openWorkflow(type, event.currentTarget));
    });
  }));
}).observe(document.body, { childList: true, subtree: true });

const initialScreen = location.hash.slice(1);
brandColor.value = betaState.brandColor;
celebrationLanguage.value = betaState.celebrationLanguage;
applyWorkspaceMode();
if (screens.some((screen) => screen.dataset.screenPanel === initialScreen)) showScreen(initialScreen);
syncCelebrationPreview();
