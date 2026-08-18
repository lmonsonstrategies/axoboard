import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const baseUrl = String(process.env.BASE_URL || 'http://127.0.0.1:43230').replace(/\/$/, '');
const email = String(process.env.AUDIT_EMAIL || '');
const password = String(process.env.AUDIT_PASSWORD || '');
const cdpPort = Number(process.env.CDP_PORT || 9228);
const artifactRoot = resolve(process.env.VISUAL_QA_ARTIFACT_DIR || 'artifacts/qa/visual-board/local');
const timezone = 'America/Denver';
const locale = 'en-US';
const viewports = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { name: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
  { name: 'tv-1920x1080', width: 1920, height: 1080, mobile: false }
];
const canonicalTypes = ['scorecard','goal_pace','gauge','rep_cards','leaderboard','trend','category_bar','funnel','pipeline','activity_feed','heatmap','table'];

assert.ok(email && password, 'Set AUDIT_EMAIL and AUDIT_PASSWORD for the allowlisted QA workspace.');
await mkdir(artifactRoot, { recursive: true });

function cookiePair(header) {
  const pair = String(header || '').split(';')[0];
  const index = pair.indexOf('=');
  assert.ok(index > 0, 'Expected a Set-Cookie response.');
  return { name: pair.slice(0, index), value: decodeURIComponent(pair.slice(index + 1)) };
}

async function jsonRequest(path, { method = 'GET', cookie = '', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json', Origin: baseUrl } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  assert.ok(response.ok, `${method} ${path} failed (${response.status}): ${text}`);
  return { response, payload };
}

function parityPayload(payload) {
  return (payload.kpis?.kpis || payload.kpis || []).map((card) => ({
    id: card.id, name: card.name, displayType: card.displayType, displayFormat: card.displayFormat,
    periodGranularity: card.periodGranularity, value: card.value, goalValue: card.goalValue,
    comparisonValue: card.comparisonValue, comparisonDelta: card.comparisonDelta,
    displayPayload: card.displayPayload, status: card.status, fetchedAt: card.fetchedAt, qa: card.qa
  }));
}

function parityHash(payload) {
  return createHash('sha256').update(JSON.stringify(parityPayload(payload))).digest('hex');
}

class CdpPage {
  constructor(target, socket) {
    this.target = target;
    this.socket = socket;
    this.commandId = 0;
    this.pending = new Map();
    this.events = new Map();
    this.errors = [];
    this.surface = 'startup';
    socket.addEventListener('message', ({ data }) => this.#message(JSON.parse(data)));
  }

  #message(message) {
    if (message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result || {});
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      this.errors.push({ surface: this.surface, type: 'exception', text: message.params?.exceptionDetails?.text || 'Browser exception' });
    }
    if (message.method === 'Runtime.consoleAPICalled' && ['error','assert'].includes(message.params?.type)) {
      this.errors.push({ surface: this.surface, type: `console.${message.params.type}`, text: (message.params.args || []).map((arg) => arg.value ?? arg.description ?? '').join(' ') });
    }
    if (message.method === 'Log.entryAdded' && message.params?.entry?.level === 'error') {
      this.errors.push({ surface: this.surface, type: 'log.error', text: message.params.entry.text, url: message.params.entry.url || '' });
    }
    const waiters = this.events.get(message.method) || [];
    this.events.delete(message.method);
    waiters.forEach((resolveEvent) => resolveEvent(message.params || {}));
  }

  send(method, params = {}) {
    const id = ++this.commandId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCommand, rejectCommand) => this.pending.set(id, { resolve: resolveCommand, reject: rejectCommand }));
  }

  once(method, timeoutMs = 15_000) {
    return new Promise((resolveEvent, rejectEvent) => {
      const timer = setTimeout(() => rejectEvent(new Error(`Timed out waiting for ${method}`)), timeoutMs);
      const done = (value) => { clearTimeout(timer); resolveEvent(value); };
      this.events.set(method, [...(this.events.get(method) || []), done]);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
    return result.result?.value;
  }

  async navigate(url) {
    const loaded = this.once('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
  }

  async viewport(viewport) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile,
      screenWidth: viewport.width, screenHeight: viewport.height
    });
    await this.settle();
  }

  async settle() {
    await this.evaluate(`(async()=>{if(document.fonts?.ready)await document.fonts.ready;await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return true;})()`);
  }

  async waitFor(expression, message, timeoutMs = 12_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.evaluate(`Boolean(${expression})`).catch(() => false)) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
    }
    throw new Error(`Timed out: ${message}`);
  }

  async screenshot(viewport, filename, { fullPage = false } = {}) {
    const directory = resolve(artifactRoot, viewport.name);
    await mkdir(directory, { recursive: true });
    const capture = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: fullPage });
    const path = resolve(directory, filename);
    await writeFile(path, Buffer.from(capture.data, 'base64'));
    return relative(artifactRoot, path);
  }
}

async function openCdpPage() {
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });
  return new CdpPage(target, socket);
}

let displayId = null;
let page = null;
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() ? 'dirty' : 'clean',
  baseUrl,
  environment: { timezone, locale, reducedMotion: true, animationsDisabled: true, deviceScaleFactor: 1 },
  fixture: {},
  viewports,
  surfaces: [],
  consoleErrors: [],
  contrast: { status: 'manual-review', note: 'Screenshots are evidence; approve a golden and contrast baseline separately.' },
  status: 'running'
};
let failure = null;

try {
  const login = await jsonRequest('/api/auth/login', { method: 'POST', body: { email, password } });
  const sessionCookie = cookiePair(login.response.headers.get('set-cookie'));
  const sessionCookieHeader = `${sessionCookie.name}=${encodeURIComponent(sessionCookie.value)}`;
  const bootstrap = await jsonRequest('/api/axoboard/bootstrap?board=visual-qa', { cookie: sessionCookieHeader });
  assert.equal(bootstrap.payload.kpis.kpis.length, 20);
  const frozenAt = String(process.env.AXOBOARD_VISUAL_QA_FROZEN_AT || new Date(new Date(bootstrap.payload.kpis.kpis[0].fetchedAt).getTime() + 120_000).toISOString());
  manifest.environment.frozenAt = frozenAt;
  manifest.fixture = {
    cards: 20, canonicalTypes, edgeCases: bootstrap.payload.visualQa.edgeCases,
    rawParityHash: parityHash(bootstrap.payload), synthetic: true, readOnly: true
  };

  const pairing = await jsonRequest('/api/axoboard/displays/pairing-codes', {
    method: 'POST', cookie: sessionCookieHeader,
    body: { name: 'Visual QA Browser Audit', contentMode: 'full_dashboard', rotationSeconds: 300 }
  });
  displayId = pairing.payload.display.id;
  const paired = await jsonRequest('/api/display/pair', { method: 'POST', body: { code: pairing.payload.pairing.code } });
  const displayCookie = cookiePair(paired.response.headers.get('set-cookie'));
  const displayCookieHeader = `${displayCookie.name}=${encodeURIComponent(displayCookie.value)}`;
  const pairedPayload = await jsonRequest('/api/display/runtime?board=visual-qa', { cookie: displayCookieHeader });
  assert.equal(parityHash(pairedPayload.payload), manifest.fixture.rawParityHash, 'authenticated and paired TV raw fixtures must match');

  page = await openCdpPage();
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Network.enable');
  await page.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.send('Emulation.setTimezoneOverride', { timezoneId: timezone });
  await page.send('Emulation.setLocaleOverride', { locale });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{const NativeDate=Date,fixed=${JSON.stringify(new Date(frozenAt).getTime())};class FrozenDate extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}}FrozenDate.parse=NativeDate.parse;FrozenDate.UTC=NativeDate.UTC;Object.defineProperty(window,'Date',{value:FrozenDate});})();` });
  for (const item of [sessionCookie, displayCookie]) {
    await page.send('Network.setCookie', { name: item.name, value: item.value, url: baseUrl, httpOnly: true, sameSite: 'Lax' });
  }

  page.surface = 'dashboard';
  await page.navigate(`${baseUrl}/app?board=visual-qa`);
  await page.waitFor(`document.body.dataset.visualQa==='true'&&document.querySelectorAll('#dashboardKpiGrid [data-live-kpi]').length===20`, 'visual QA dashboard');
  await page.evaluate(`(()=>{const style=document.createElement('style');style.id='visual-qa-audit-freeze';style.textContent='*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}';document.head.append(style);return true;})()`);
  await page.settle();

  for (const viewport of viewports) {
    await page.viewport(viewport);
    const dashboard = await page.evaluate(`(()=>{const cards=[...document.querySelectorAll('#dashboardKpiGrid [data-live-kpi]')],coreTrend=document.querySelector('[data-live-kpi="visual-qa-core-trend"]'),comparison=document.querySelector('[data-live-kpi="visual-qa-edge-comparison"]'),stale=document.querySelector('[data-live-kpi="visual-qa-edge-stale"]'),activity=document.querySelector('[data-live-kpi="visual-qa-core-activity-feed"]'),negative=document.querySelector('[data-live-kpi="visual-qa-edge-negative"]'),empty=document.querySelector('[data-live-kpi="visual-qa-edge-empty"]'),activityText=activity?.textContent||'';return{cards:cards.length,types:cards.slice(0,12).map((card)=>card.className.match(/kpi-card-([a-z_]+)/)?.[1]),documentOverflow:document.documentElement.scrollWidth-innerWidth,cardOverflow:cards.filter((card)=>card.scrollWidth>card.clientWidth+1).map((card)=>card.dataset.liveKpi),coreTrendSeries:coreTrend?.querySelectorAll('polyline').length||0,comparisonSeries:comparison?.querySelectorAll('polyline').length||0,comparisonLabel:comparison?.querySelector('[role="img"]')?.getAttribute('aria-label')||'',zeroVisible:activityText.includes('No-show count')&&activityText.includes('0'),negativeVisible:(negative?.textContent||'').includes('-25'),staleText:stale?.textContent||'',emptyState:Boolean(empty?.querySelector('[data-qa-empty-state]')),trustSummaryVisible:Boolean(document.querySelector('.trust-summary:not([hidden])')),tableInternalScroll:(()=>{const node=document.querySelector('[data-live-kpi="visual-qa-core-table"] .structured-table-scroll');return node?node.scrollWidth>node.clientWidth:false;})()};})()`);
    assert.equal(dashboard.cards, 20);
    assert.deepEqual(dashboard.types, canonicalTypes);
    assert.ok(dashboard.documentOverflow <= 1, `${viewport.name} dashboard page overflow`);
    assert.deepEqual(dashboard.cardOverflow, [], `${viewport.name} dashboard card overflow`);
    assert.equal(dashboard.coreTrendSeries, 1);
    assert.equal(dashboard.comparisonSeries, 2);
    assert.match(dashboard.comparisonLabel, /comparison/i);
    assert.equal(dashboard.zeroVisible, true);
    assert.equal(dashboard.negativeVisible, true);
    assert.match(dashboard.staleText, /Needs attention|Stale fixture/i);
    assert.doesNotMatch(dashboard.staleText, /\bLive\b/i);
    assert.equal(dashboard.emptyState, true);
    assert.equal(dashboard.trustSummaryVisible, false);
    const screenshots = [await page.screenshot(viewport, 'dashboard--cards.png', { fullPage: true })];

    const builderAudits = [];
    for (const type of canonicalTypes) {
      const audit = await page.evaluate(`(async()=>{const kpi=liveKpis.find((item)=>item.displayType===${JSON.stringify(type)}&&item.qa?.group==='core');openVisualQaBuilderPreview(kpi,document.querySelector('[data-visual-qa-action="builder"]'));await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const card=document.querySelector('#builderAccuratePreview .kpi-card'),modal=document.querySelector('.builder-modal'),cardRect=card.getBoundingClientRect(),modalRect=modal.getBoundingClientRect();return{type:${JSON.stringify(type)},className:card.className,fieldsetDisabled:document.querySelector('.display-type-fieldset').disabled,configInert:document.querySelector('.display-config').inert,horizontalBounds:cardRect.left>=modalRect.left-1&&cardRect.right<=modalRect.right+1,text:card.textContent.replace(/\s+/g,' ').trim()};})()`);
      builderAudits.push(audit);
      if (type === 'scorecard' || type === 'table') screenshots.push(await page.screenshot(viewport, `builder--${type}.png`));
      await page.evaluate('closeKpiBuilder()');
    }
    assert.deepEqual(builderAudits.map((item) => item.type), canonicalTypes);
    assert.ok(builderAudits.every((item) => item.fieldsetDisabled && item.configInert && item.horizontalBounds), `${viewport.name} builder must be inert and bounded`);

    page.surface = 'tv-auth';
    await page.evaluate(`openFeatureModal('tvPreviewModal',document.querySelector('#openTvMode'));tvRotationPaused=true;`);
    const tvPages = [];
    for (let index = 0; index < 5; index += 1) {
      const audit = await page.evaluate(`(async()=>{tvPageIndex=${index};renderTvMode();await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const stage=document.querySelector('.tv-preview-stage'),cards=[...document.querySelectorAll('#tvKpiGrid>[data-tv-kpi]')];return{page:${index+1},ids:cards.map((card)=>card.dataset.tvKpi),types:cards.map((card)=>card.dataset.tvDisplayType),stageOverflow:stage.scrollWidth-stage.clientWidth,cardOverflow:cards.filter((card)=>card.scrollWidth>card.clientWidth+1).map((card)=>card.dataset.tvKpi),coreTrendSeries:document.querySelector('[data-tv-kpi="visual-qa-core-trend"]')?.querySelectorAll('polyline').length||0,comparisonSeries:document.querySelector('[data-tv-kpi="visual-qa-edge-comparison"]')?.querySelectorAll('polyline').length||0,zeroText:document.querySelector('[data-tv-kpi="visual-qa-core-activity-feed"]')?.textContent||'',staleText:document.querySelector('[data-tv-kpi="visual-qa-edge-stale"]')?.textContent||'',tableCue:document.querySelector('[data-tv-kpi="visual-qa-core-table"] .tv-collection-cue')?.textContent||''};})()`);
      tvPages.push(audit);
      screenshots.push(await page.screenshot(viewport, `tv-auth--cards-p${String(index + 1).padStart(2, '0')}.png`));
    }
    assert.deepEqual(tvPages.flatMap((item) => item.types).slice(0, 12), canonicalTypes);
    assert.ok(tvPages.every((item) => item.stageOverflow <= 1 && item.cardOverflow.length === 0), `${viewport.name} authenticated TV overflow: ${JSON.stringify(tvPages)}`);
    assert.equal(tvPages.reduce((total, item) => total + item.coreTrendSeries, 0), 1);
    assert.equal(tvPages.reduce((total, item) => total + item.comparisonSeries, 0), 2);
    assert.match(tvPages.map((item) => item.zeroText).join(' '), /No-show count[\s\S]*0/);
    assert.match(tvPages.map((item) => item.staleText).join(' '), /Stale fixture/);
    assert.doesNotMatch(tvPages.map((item) => item.staleText).join(' '), /\bLive\b/i);
    assert.match(tvPages.map((item) => item.tableCue).join(' '), /Showing 10 of 12/);
    await page.evaluate(`closeFeatureModal(document.querySelector('#tvPreviewModal'))`);

    page.surface = 'celebration-auth';
    await page.evaluate('previewVisualQaCelebration()');
    await page.settle();
    const authCelebration = await page.evaluate(`(()=>{const card=document.querySelector('#celebrationOverlay .win-modal').getBoundingClientRect();return{inside:card.left>=-1&&card.top>=-1&&card.right<=innerWidth+1&&card.bottom<=innerHeight+1,bounds:{left:card.left,top:card.top,right:card.right,bottom:card.bottom,width:card.width,height:card.height,viewportWidth:innerWidth,viewportHeight:innerHeight},text:document.querySelector('#celebrationOverlay').textContent.replace(/\s+/g,' ').trim()};})()`);
    assert.equal(authCelebration.inside, true, `${viewport.name} authenticated celebration bounds: ${JSON.stringify(authCelebration.bounds)}`);
    assert.match(authCelebration.text, /Synthetic QA fixture.*Read only/i);
    screenshots.push(await page.screenshot(viewport, 'celebration-auth--long-copy.png'));
    await page.evaluate('closeCelebration()');
    manifest.surfaces.push({ viewport: viewport.name, surface: 'authenticated', dashboard, builder: builderAudits, tvPages, celebration: authCelebration, screenshots });
  }

  page.surface = 'tv-paired';
  await page.navigate(`${baseUrl}/tv?board=visual-qa`);
  await page.waitFor(`!document.querySelector('#playerShell').hidden&&document.querySelectorAll('#runtimeGrid>[data-kpi]').length===4`, 'paired visual QA player');
  await page.evaluate(`(()=>{const style=document.createElement('style');style.textContent='*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}';document.head.append(style);rotationPaused=true;return true;})()`);

  for (const viewport of viewports) {
    await page.viewport(viewport);
    const screenshots = [];
    const tvPages = [];
    for (let index = 0; index < 5; index += 1) {
      const audit = await page.evaluate(`(async()=>{pageIndex=${index};render();await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const cards=[...document.querySelectorAll('#runtimeGrid>[data-kpi]')];return{page:${index+1},ids:cards.map((card)=>card.dataset.kpi),types:cards.map((card)=>card.dataset.type),documentOverflow:document.documentElement.scrollWidth-innerWidth,cardOverflow:cards.filter((card)=>card.scrollWidth>card.clientWidth+1).map((card)=>card.dataset.kpi),coreTrendSeries:document.querySelector('[data-kpi="visual-qa-core-trend"]')?.querySelectorAll('polyline').length||0,comparisonSeries:document.querySelector('[data-kpi="visual-qa-edge-comparison"]')?.querySelectorAll('polyline').length||0,comparisonLabel:document.querySelector('[data-kpi="visual-qa-edge-comparison"] [role="img"]')?.getAttribute('aria-label')||'',zeroText:document.querySelector('[data-kpi="visual-qa-core-activity-feed"]')?.textContent||'',staleText:document.querySelector('[data-kpi="visual-qa-edge-stale"]')?.textContent||'',tableCue:document.querySelector('[data-kpi="visual-qa-core-table"] .collection-cue')?.textContent||'',goalPaceText:document.querySelector('[data-kpi="visual-qa-core-goal-pace"]')?.textContent||'',repProgress:document.querySelectorAll('[data-kpi="visual-qa-core-rep-cards"] .rep-card i b').length};})()`);
      tvPages.push(audit);
      screenshots.push(await page.screenshot(viewport, `tv-paired--cards-p${String(index + 1).padStart(2, '0')}.png`, { fullPage: viewport.mobile }));
    }
    assert.deepEqual(tvPages.flatMap((item) => item.types).slice(0, 12), canonicalTypes);
    assert.ok(tvPages.every((item) => item.documentOverflow <= 1 && item.cardOverflow.length === 0), `${viewport.name} paired TV overflow: ${JSON.stringify(tvPages)}`);
    assert.equal(tvPages.reduce((total, item) => total + item.coreTrendSeries, 0), 1);
    assert.equal(tvPages.reduce((total, item) => total + item.comparisonSeries, 0), 2);
    assert.match(tvPages.map((item) => item.comparisonLabel).join(' '), /comparison/i);
    assert.match(tvPages.map((item) => item.zeroText).join(' '), /No-show count[\s\S]*0/);
    assert.match(tvPages.map((item) => item.staleText).join(' '), /Stale fixture/);
    assert.doesNotMatch(tvPages.map((item) => item.staleText).join(' '), /\bLive\b/i);
    assert.match(tvPages.map((item) => item.tableCue).join(' '), /Showing 8 of 12/);
    assert.match(tvPages.map((item) => item.goalPaceText).join(' '), /Projected.*Remaining.*Required pace/i);
    assert.equal(tvPages.reduce((total, item) => total + item.repProgress, 0), 2);

    page.surface = 'celebration-paired';
    await page.navigate(`${baseUrl}/tv?board=visual-qa&celebration=1`);
    await page.waitFor(`!document.querySelector('#automationCelebration').hidden`, 'paired visual QA celebration');
    await page.viewport(viewport);
    const pairedCelebration = await page.evaluate(`(()=>{const card=document.querySelector('.tv-celebration-card').getBoundingClientRect();return{inside:card.left>=-1&&card.top>=-1&&card.right<=innerWidth+1&&card.bottom<=innerHeight+1,bounds:{left:card.left,top:card.top,right:card.right,bottom:card.bottom,width:card.width,height:card.height,viewportWidth:innerWidth,viewportHeight:innerHeight},text:document.querySelector('#automationCelebration').textContent.replace(/\s+/g,' ').trim()};})()`);
    assert.equal(pairedCelebration.inside, true, `${viewport.name} paired celebration bounds: ${JSON.stringify(pairedCelebration.bounds)}`);
    assert.match(pairedCelebration.text, /Synthetic QA fixture.*read only/i);
    screenshots.push(await page.screenshot(viewport, 'celebration-paired--long-copy.png'));
    manifest.surfaces.push({ viewport: viewport.name, surface: 'paired-tv', tvPages, celebration: pairedCelebration, screenshots });
    if (viewport !== viewports.at(-1)) {
      await page.navigate(`${baseUrl}/tv?board=visual-qa`);
      await page.waitFor(`!document.querySelector('#playerShell').hidden&&document.querySelectorAll('#runtimeGrid>[data-kpi]').length===4`, 'paired visual QA player reload');
      await page.evaluate('rotationPaused=true');
    }
  }

  manifest.consoleErrors = page.errors;
  assert.deepEqual(page.errors, [], `browser console errors: ${JSON.stringify(page.errors)}`);
  manifest.status = 'passed';
} catch (error) {
  failure = error;
  manifest.status = 'failed';
  manifest.failure = error.stack || error.message;
  if (page) manifest.consoleErrors = page.errors;
} finally {
  if (page) {
    page.socket.close();
    await fetch(`http://127.0.0.1:${cdpPort}/json/close/${page.target.id}`).catch(() => {});
  }
  if (displayId) {
    try {
      const login = await jsonRequest('/api/auth/login', { method: 'POST', body: { email, password } });
      const cookie = cookiePair(login.response.headers.get('set-cookie'));
      await jsonRequest(`/api/axoboard/displays/${displayId}/revoke`, { method: 'POST', cookie: `${cookie.name}=${encodeURIComponent(cookie.value)}`, body: {} });
    } catch (cleanupError) {
      manifest.cleanupError = cleanupError.message;
    }
  }
  await writeFile(resolve(artifactRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(JSON.stringify({ status: manifest.status, artifactRoot, rawParityHash: manifest.fixture.rawParityHash, screenshots: manifest.surfaces.reduce((total, surface) => total + surface.screenshots.length, 0) }, null, 2));
if (failure) throw failure;
