import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPlan, parseArguments } from '../../src/audit.mjs';
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
  const options = parseArguments(['--target', 'fixture', '--dry-run', '--route', 'fixture-app-empty', '--viewport', 'phone-375', '--theme', 'dark']);
  const plan = buildPlan(config, options);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].route.state, 'empty');
  assert.equal(plan[0].theme, 'dark');
  assert.equal(plan[0].viewport.id, 'phone-375');
});

test('release gate cannot bypass approved visual baselines', () => {
  assert.throws(() => parseArguments(['--target', 'local', '--mode', 'gate', '--no-baselines']), /prohibited in gate mode/);
});
