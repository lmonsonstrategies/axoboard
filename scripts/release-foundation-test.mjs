import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  findExpectedReleaseWorkflowRun,
  evaluateRailwayDeployment,
  isExpectedProductionHealth,
  isExpectedOriginUrl,
  isExpectedReleaseWorkflowRun,
  isReleaseBranch,
  isSuccessfulReleaseWorkflowRun,
  RELEASE_REPOSITORY,
  RELEASE_WORKFLOW
} from '../lib/release-policy.mjs';
import {
  allocateLoopbackPorts,
  assertDatabaseSuiteReceipts,
  integrationDatabase,
  recordDatabaseSuitePass,
  REQUIRED_DATABASE_SUITES
} from './test-support.mjs';

for (const branch of ['feat/new-dashboard', 'fix/operator-release-foundation', 'release/2026.08.21']) {
  assert.equal(isReleaseBranch(branch), true, `${branch} is a releasable branch`);
}
for (const branch of ['', 'main', 'feature/nope', 'hotfix/nope', 'fix/', 'Fix/uppercase']) {
  assert.equal(isReleaseBranch(branch), false, `${branch || '<empty>'} is not a releasable branch`);
}

assert.equal(isExpectedOriginUrl('git@github-personal:lmonsonstrategies/axoboard.git'), true);
assert.equal(isExpectedOriginUrl('git@github.com:lmonsonstrategies/axoboard.git'), true);
assert.equal(isExpectedOriginUrl('ssh://git@ssh.github.com:443/lmonsonstrategies/axoboard.git'), true);
assert.equal(isExpectedOriginUrl('git@github.com:another-owner/axoboard.git'), false);

const workflowId = 123456;
const sha = 'a'.repeat(40);
const branch = 'fix/operator-release-foundation';
const run = {
  workflow_id: workflowId,
  name: RELEASE_WORKFLOW.name,
  path: RELEASE_WORKFLOW.path,
  event: RELEASE_WORKFLOW.event,
  head_sha: sha,
  head_branch: branch,
  status: 'completed',
  conclusion: 'success',
  repository: { full_name: RELEASE_REPOSITORY },
  head_repository: { full_name: RELEASE_REPOSITORY }
};
const candidate = { repository: RELEASE_REPOSITORY, sha, branch, workflowId };
assert.equal(isExpectedReleaseWorkflowRun(run, candidate), true);
assert.equal(isSuccessfulReleaseWorkflowRun(run, candidate), true);
assert.equal(findExpectedReleaseWorkflowRun([{ ...run, event: 'pull_request' }, run], candidate), run);

const identityMutations = {
  workflow_id: workflowId + 1,
  name: 'A different workflow',
  path: '.github/workflows/other.yml',
  event: 'workflow_dispatch',
  head_sha: 'b'.repeat(40),
  head_branch: 'fix/other',
  repository: { full_name: 'someone/else' },
  head_repository: { full_name: 'someone/fork' }
};
for (const [field, value] of Object.entries(identityMutations)) {
  assert.equal(isExpectedReleaseWorkflowRun({ ...run, [field]: value }, candidate), false, `${field} is pinned`);
}
assert.equal(isSuccessfulReleaseWorkflowRun({ ...run, status: 'in_progress' }, candidate), false, 'CI must be completed');
assert.equal(isSuccessfulReleaseWorkflowRun({ ...run, conclusion: 'failure' }, candidate), false, 'CI must succeed');

const railwayDeployment = (status, overrides = {}) => ({
  id: '41473706-b05b-4274-b3f9-85a8b70978e2',
  status,
  createdAt: '2026-08-21T23:24:24.789Z',
  meta: {
    repo: RELEASE_REPOSITORY,
    branch: 'main',
    commitHash: sha,
    buildOnly: false
  },
  ...overrides
});
const transientHealth = { ok: true, version: sha };
assert.equal(isExpectedProductionHealth(transientHealth, sha), true, 'the adversarial response briefly serves the target SHA');
assert.equal(
  evaluateRailwayDeployment([railwayDeployment('DEPLOYING')], { sha }).state,
  'waiting',
  'target-SHA health cannot complete a deployment still configuring'
);
const rolledBack = evaluateRailwayDeployment([railwayDeployment('FAILED')], { sha });
assert.equal(rolledBack.state, 'failed', 'a target-SHA deployment that later fails is release-blocking');
assert.match(rolledBack.reason, /terminal status FAILED/);
assert.equal(evaluateRailwayDeployment([railwayDeployment('CANCELED')], { sha }).state, 'failed', 'Railway cancellation fails immediately');
const superseded = evaluateRailwayDeployment([railwayDeployment('SUPERSEDED')], { sha });
assert.equal(superseded.state, 'failed', 'an identity-matching superseded deployment fails immediately');
assert.match(superseded.reason, /terminal status SUPERSEDED/);

const succeeded = evaluateRailwayDeployment([railwayDeployment('SUCCESS')], { sha });
assert.equal(succeeded.state, 'succeeded');
assert.equal(succeeded.deployment.id, railwayDeployment('SUCCESS').id);
assert.equal(isExpectedProductionHealth({ ok: true, version: 'b'.repeat(40) }, sha), false, 'successful deployment cannot excuse a stale route');
const removedAfterSmoke = evaluateRailwayDeployment([railwayDeployment('REMOVED')], {
  sha,
  deploymentId: succeeded.deployment.id
});
assert.equal(removedAfterSmoke.state, 'failed', 'the accepted deployment is rechecked after production smoke');
assert.equal(
  evaluateRailwayDeployment([railwayDeployment('SUCCESS', { id: 'newer-deployment' })], {
    sha,
    deploymentId: succeeded.deployment.id
  }).state,
  'failed',
  'a superseding deployment invalidates the accepted deployment identity'
);
assert.equal(
  evaluateRailwayDeployment([railwayDeployment('SUCCESS', { meta: { ...railwayDeployment('SUCCESS').meta, commitHash: 'b'.repeat(40) } })], {
    sha,
  }).state,
  'failed',
  'the latest pinned-service deployment must match the exact release SHA'
);
assert.equal(
  evaluateRailwayDeployment([railwayDeployment('SUCCESS')], {
    sha,
    excludedDeploymentIds: [railwayDeployment('SUCCESS').id]
  }).state,
  'waiting',
  'a deployment observed before promotion cannot satisfy the release'
);
const malformedSuperseder = evaluateRailwayDeployment([
  railwayDeployment('FAILED', { id: 'malformed-superseder', createdAt: 'not-a-timestamp' }),
  railwayDeployment('SUCCESS')
], { sha });
assert.equal(malformedSuperseder.state, 'failed', 'an unorderable superseding deployment cannot be silently ignored');
assert.match(malformedSuperseder.reason, /invalid creation timestamp/);
for (const [label, createdAt] of [['null', null], ['boolean', false], ['number', 0], ['empty', '']]) {
  const malformedType = evaluateRailwayDeployment([
    railwayDeployment('FAILED', { id: `${label}-timestamp`, createdAt }),
    railwayDeployment('SUCCESS')
  ], { sha, deploymentId: railwayDeployment('SUCCESS').id });
  assert.equal(malformedType.state, 'failed', `${label} Railway timestamp cannot hide a superseding failure`);
  assert.match(malformedType.reason, /invalid creation timestamp/);
}
const ambiguousNewest = evaluateRailwayDeployment([
  railwayDeployment('FAILED', { id: 'same-millisecond-failure' }),
  railwayDeployment('SUCCESS')
], { sha });
assert.equal(ambiguousNewest.state, 'failed', 'same-timestamp deployments fail closed instead of trusting list order');
assert.match(ambiguousNewest.reason, /ambiguous newest timestamp/);

const workflow = readFileSync(resolve('.github/workflows/ci.yml'), 'utf8');
assert.match(workflow, /^name:\s+AxoBoard release gate$/m);
for (const family of ['feat', 'fix', 'release']) {
  assert.match(workflow, new RegExp(`^\\s+- '${family}/\\*\\*'$`, 'm'), `CI push trigger includes ${family}/**`);
}

const ports = await allocateLoopbackPorts(8);
assert.equal(new Set(ports).size, ports.length, 'isolated port allocation never shares a port');
assert.ok(ports.every((port) => Number.isInteger(port) && port > 0 && port <= 65_535));
assert.equal(integrationDatabase('billing', {}), null, 'standalone local suites may explicitly report a skip');
assert.throws(() => integrationDatabase('billing', { CI: 'true' }), /requires disposable PostgreSQL/, 'CI refuses a database skip');
assert.throws(() => integrationDatabase('billing', { AXOBOARD_FULL_VERIFY: '1' }), /requires disposable PostgreSQL/, 'full verification refuses a database skip');

const receiptsDirectory = mkdtempSync(join(tmpdir(), 'axoboard-receipt-test-'));
try {
  const receiptEnv = { DATABASE_URL: 'postgresql://placeholder.invalid/test', AXOBOARD_VERIFY_RECEIPTS_DIR: receiptsDirectory };
  for (const suite of REQUIRED_DATABASE_SUITES) recordDatabaseSuitePass(suite, { deterministicTest: true }, receiptEnv);
  assert.deepEqual(assertDatabaseSuiteReceipts(receiptsDirectory), REQUIRED_DATABASE_SUITES);
  rmSync(resolve(receiptsDirectory, 'google.json'));
  assert.throws(() => assertDatabaseSuiteReceipts(receiptsDirectory), /required integration suite did not produce a valid receipt: google/);
} finally {
  rmSync(receiptsDirectory, { recursive: true, force: true });
}

console.log('AxoBoard release foundation test passed: branch parity, pinned CI/Railway identity, rollback-resistant production checks, dynamic ports, fail-closed database coverage, and execution receipts.');
