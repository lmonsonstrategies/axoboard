import assert from 'node:assert/strict';
import test from 'node:test';
import { assessBrowserCoverage, buildPlan, parseArguments, resolveBrowserEngines, resolveCandidateSha, verifyServedCandidate } from '../../src/audit.mjs';
import { loadConfig, materializeRoutes, validateBaseUrl } from '../../src/config.mjs';

test('quality configuration validates and inventories every required surface', async () => {
  const config = await loadConfig();
  const surfaces = new Set([...config.routes, ...config.fixtureRoutes].map((route) => route.surface));
  for (const surface of ['landing', 'auth', 'app', 'tv']) assert.ok(surfaces.has(surface), `missing ${surface} surface`);
  const states = new Set(config.fixtureRoutes.map((route) => route.state));
  for (const state of ['empty', 'loading', 'error']) assert.ok(states.has(state), `missing ${state} state`);
  assert.ok(config.viewports.some((viewport) => viewport.width === 320));
  assert.ok(config.viewports.some((viewport) => viewport.width >= 1728));
  assert.ok(config.viewports.some((viewport) => viewport.id.startsWith('tv-')));
  assert.deepEqual(config.browserEngines, ['chromium', 'firefox', 'webkit']);
});

test('base URL allowlist rejects credentials, paths, and external origins', async () => {
  const config = await loadConfig();
  assert.equal(validateBaseUrl('http://127.0.0.1:49152', config.allowedBaseUrls), 'http://127.0.0.1:49152');
  assert.throws(() => validateBaseUrl('https://example.com', config.allowedBaseUrls), /outside the QA allowlist/);
  assert.throws(() => validateBaseUrl('http://user:pass@127.0.0.1:4000', config.allowedBaseUrls), /without credentials/);
  assert.throws(() => validateBaseUrl('http://127.0.0.1:4000/app', config.allowedBaseUrls), /without credentials or a path/);
});

test('optional public route is materialized only from a constrained environment path', async () => {
  const config = await loadConfig();
  const withoutOptional = materializeRoutes(config, {});
  assert.ok(!withoutOptional.some((route) => route.id === 'public-tv-player'));
  const withOptional = materializeRoutes(config, { AXOBOARD_TV_PUBLIC_PATH: '/display/abcDEF_12345' });
  assert.equal(withOptional.at(-1).path, '/display/abcDEF_12345');
  assert.throws(() => materializeRoutes(config, { AXOBOARD_TV_PUBLIC_PATH: '/admin' }), /approved public route pattern/);
});

test('dry-run plan filters without launching a fixed-port server', async () => {
  const config = await loadConfig();
  const options = parseArguments(['--target', 'fixture', '--mode', 'diagnostic', '--dry-run', '--route', 'fixture-app-empty', '--viewport', 'phone-375', '--theme', 'dark']);
  const plan = buildPlan(config, options);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].route.state, 'empty');
  assert.equal(plan[0].theme, 'dark');
  assert.equal(plan[0].viewport.id, 'phone-375');
});

test('release gate cannot bypass approved visual baselines', () => {
  assert.throws(() => parseArguments(['--target', 'local', '--mode', 'gate', '--no-baselines']), /prohibited in gate mode/);
});

test('gate and harness modes cannot omit a browser engine', async () => {
  const config = await loadConfig();
  assert.throws(() => parseArguments(['--target', 'fixture', '--mode', 'harness', '--browser', 'chromium,firefox']), /cannot reduce the policy matrix/);
  assert.deepEqual(resolveBrowserEngines(config, parseArguments(['--target', 'fixture', '--mode', 'diagnostic', '--browser', 'webkit'])), ['webkit']);
});

test('gate and harness reject every caller-controlled matrix shrinker', async () => {
  const config = await loadConfig();
  const shrinkers = [
    ['--quick'],
    ['--route', 'app-auth-guard'],
    ['--viewport', 'phone-390'],
    ['--theme', 'light'],
    ['--browser', 'chromium,firefox,webkit']
  ];
  for (const mode of ['gate', 'harness']) {
    for (const args of shrinkers) assert.throws(() => parseArguments(['--target', mode === 'gate' ? 'local' : 'fixture', '--mode', mode, '--dry-run', ...args]), /cannot reduce the policy matrix/);
  }
  const forged = parseArguments(['--target', 'fixture', '--mode', 'diagnostic', '--route', 'fixture-app-empty']);
  forged.mode = 'gate';
  assert.throws(() => buildPlan(config, forged), /cannot reduce the policy matrix/);
});

test('candidate identity is checked against local HEAD and exact URL health', async () => {
  assert.throws(() => parseArguments(['--candidate-sha', 'a'.repeat(40)]), /Unknown argument/);
  const sha = await resolveCandidateSha();
  const exact = async () => new Response(JSON.stringify({ ok: true, version: sha }), { status: 200, headers: { 'content-type': 'application/json' } });
  assert.deepEqual(await verifyServedCandidate('http://127.0.0.1:4173', sha, exact), { ok: true, version: sha });
  await assert.rejects(() => verifyServedCandidate('http://127.0.0.1:4173', sha, async () => new Response(JSON.stringify({ ok: true, version: sha.slice(0, 7) }), { status: 200 })), /exact version/);
  await assert.rejects(() => verifyServedCandidate('http://127.0.0.1:4173', sha, async () => new Response('not-json', { status: 200 })), /malformed JSON/);
  assert.throws(() => parseArguments(['--target', 'local', '--base-url', 'http://127.0.0.1:4173']), /only with --target url/);
});

test('missing, incomplete, or failed browser execution fails coverage closed', () => {
  const required = ['chromium', 'firefox', 'webkit'];
  const complete = required.flatMap((browserEngine) => [{ browserEngine }, { browserEngine }]);
  assert.equal(assessBrowserCoverage(required, 2, complete).complete, true);
  assert.equal(assessBrowserCoverage(required, 2, complete.filter((result) => result.browserEngine !== 'webkit')).complete, false);
  assert.equal(assessBrowserCoverage(required, 2, complete, [{ browserEngine: 'firefox', message: 'launch failed' }]).complete, false);
});
