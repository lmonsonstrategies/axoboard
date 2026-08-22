import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, createHealthSloReceipt } from './health-slo-receipt.mjs';

const expectedSha = '63877ddd82ba666ffcee80d0b6a0403e5b6e9aac';
const healthyBody = {
  ok: true,
  version: expectedSha,
  database: 'healthy',
  googleSheets: 'not_configured',
  automationCore: 'configured',
  automationEventProducer: 'configured',
  automationWorker: 'idle',
  tenant: { id: 'tenant-must-not-escape' },
  account: { email: 'operator@example.test' },
  headers: { authorization: 'Bearer must-not-escape' },
  rawError: 'database password must-not-escape'
};

function response(status, value, malformed = false) {
  return {
    status,
    async json() {
      if (malformed) throw new SyntaxError('fixture details must not escape');
      return value;
    }
  };
}

async function probe(fetchImpl, overrides = {}) {
  const ticks = [100, 142];
  return createHealthSloReceipt({
    baseUrl: 'https://user:password@example.test:8443/path?tenant=secret#fragment',
    expectedSha,
    fetchImpl,
    now: () => new Date('2026-08-21T12:00:00.000Z'),
    monotonicNow: () => ticks.shift(),
    timeoutMs: 10,
    latencySloMs: 200,
    ...overrides
  });
}

const healthy = await probe(async (url, options) => {
  assert.equal(url, 'https://example.test:8443/healthz');
  assert.equal(options.method, 'GET');
  assert.equal(options.redirect, 'manual');
  assert.equal('cookie' in options.headers, false);
  return response(200, healthyBody);
});
assert.deepEqual(healthy, {
  timestamp: '2026-08-21T12:00:00.000Z',
  baseUrlOrigin: 'https://example.test:8443',
  expectedSha,
  deployedSha: expectedSha,
  httpStatus: 200,
  responseLatencyMs: 42,
  databaseState: 'healthy',
  integrationStates: {
    automationCore: 'configured',
    automationEventProducer: 'configured',
    googleSheets: 'not_configured'
  },
  workerState: 'idle',
  passed: true,
  reasons: []
});
assert.equal(canonicalJson(healthy), `${JSON.stringify(healthy)}\n`);
assert.doesNotMatch(canonicalJson(healthy), /tenant|password|secret|cookie|authorization|operator@/i);

const wrongSha = await probe(async () => response(200, { ...healthyBody, version: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
assert.equal(wrongSha.passed, false);
assert.deepEqual(wrongSha.reasons, ['deployed_sha_mismatch']);

const uppercaseExpected = await probe(async () => response(200, healthyBody), {
  expectedSha: expectedSha.toUpperCase()
});
assert.equal(uppercaseExpected.expectedSha, expectedSha);
assert.equal(uppercaseExpected.passed, true);

for (const unconfiguredExpectedSha of [undefined, null, '']) {
  let fetchCount = 0;
  const unpinned = await probe(async () => {
    fetchCount += 1;
    return response(200, { ...healthyBody, version: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  }, { expectedSha: unconfiguredExpectedSha });
  assert.equal(fetchCount, 1);
  assert.equal(unpinned.expectedSha, null);
  assert.equal(unpinned.passed, true);
}

const malformedExpectedShas = [
  '86ce390-typo',
  `${expectedSha}junk`,
  ` ${expectedSha}`,
  `${expectedSha} `,
  ' ',
  expectedSha.slice(0, 7),
  expectedSha.slice(0, 39),
  `${expectedSha}0`,
  'g'.repeat(40)
];

for (const malformedExpectedSha of malformedExpectedShas) {
  let fetchCount = 0;
  await assert.rejects(
    () => probe(async () => {
      fetchCount += 1;
      return response(200, { ...healthyBody, version: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    }, { expectedSha: malformedExpectedSha }),
    /invalid expected SHA/
  );
  assert.equal(fetchCount, 0);
}

const invalidCli = spawnSync(process.execPath, [fileURLToPath(new URL('./health-slo-receipt.mjs', import.meta.url))], {
  encoding: 'utf8',
  env: {
    ...process.env,
    BASE_URL: 'https://example.test',
    EXPECTED_SHA: '86ce390-typo'
  }
});
assert.equal(invalidCli.status, 2);
assert.equal(invalidCli.stdout, '');
assert.equal(invalidCli.stderr, 'health-slo-receipt: invalid configuration\n');
assert.doesNotMatch(invalidCli.stderr, /86ce390|expected_sha/i);

const unavailable = await probe(async () => response(503, { ...healthyBody, ok: false }));
assert.deepEqual(unavailable.reasons, ['http_status_not_200', 'health_not_ok']);

const timedOut = await probe((_url, { signal }) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(Object.assign(new Error('sensitive upstream error'), { name: 'AbortError' })));
}));
assert.deepEqual(timedOut.reasons, ['timeout', 'database_unhealthy', 'worker_unhealthy']);
assert.doesNotMatch(canonicalJson(timedOut), /sensitive|upstream|error/i);

const malformed = await probe(async () => response(200, null, true));
assert.deepEqual(malformed.reasons, ['malformed_json', 'database_unhealthy', 'worker_unhealthy']);

const staleWorker = await probe(async () => response(503, { ...healthyBody, ok: false, automationWorker: 'stale' }));
assert.deepEqual(staleWorker.reasons, ['http_status_not_200', 'health_not_ok', 'worker_unhealthy']);

const optionalUnconfigured = await probe(async () => response(200, {
  ...healthyBody,
  googleSheets: 'not_configured',
  automationCore: 'not_configured',
  automationEventProducer: 'not_configured',
  automationWorker: 'disabled'
}));
assert.equal(optionalUnconfigured.passed, true);
assert.deepEqual(optionalUnconfigured.reasons, []);

const slow = await probe(async () => response(200, healthyBody), { latencySloMs: 20 });
assert.deepEqual(slow.reasons, ['latency_slo_exceeded']);

await assert.rejects(() => createHealthSloReceipt({ baseUrl: 'file:///tmp/healthz' }), /protocol/);
await assert.rejects(() => createHealthSloReceipt({ timeoutMs: 'nope' }), /positive integer/);

console.log('health SLO receipt contract tests passed');
