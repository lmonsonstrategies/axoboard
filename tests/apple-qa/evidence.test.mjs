import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { loadHumanEvidence } from '../../src/evidence.mjs';

const candidateSha = 'a'.repeat(40);
const targetOrigin = 'http://127.0.0.1:4173';
const now = new Date('2026-08-21T21:10:00.000Z');
const tenant = { tenantId: 'synthetic-tenant-proof', workspaceId: 'synthetic-workspace-proof' };
const requiredScenarios = [
  {
    id: 'authenticated-app-critical-states',
    type: 'authenticated-app',
    requiredMatrix: [{ state: 'default', role: 'owner', device: 'phone', theme: 'light', viewport: 'phone-375' }]
  },
  {
    id: 'paired-tv-live-state',
    type: 'paired-tv',
    requiredMatrix: [{ state: 'live', role: 'display-device', device: 'tv', theme: 'dark', viewport: 'tv-1920' }]
  }
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function bundle() {
  const root = await mkdtemp(join(tmpdir(), 'axoboard-evidence-'));
  const evidencePath = join(root, 'evidence.json');
  const manifests = [];
  const references = [];
  for (const [index, required] of requiredScenarios.entries()) {
    const folder = index === 0 ? 'authenticated-app' : 'paired-tv';
    const artifactPath = `${folder}/capture-${index}.txt`;
    const artifactContent = Buffer.from(`synthetic evidence ${required.id}`);
    await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, artifactPath), artifactContent);
    const runId = index === 0 ? 'qa-auth-app-proof' : 'qa-paired-tv-proof';
    const manifest = {
      schemaVersion: 2,
      kind: 'axoboard-human-qa-scenario-artifact-manifest',
      scenarioId: required.id,
      scenarioType: required.type,
      runId,
      candidateSha,
      targetOrigin,
      syntheticTenant: tenant,
      captureStartedAt: '2026-08-21T20:00:00.000Z',
      captureCompletedAt: '2026-08-21T21:00:00.000Z',
      matrix: required.requiredMatrix.map((entry) => ({ ...entry, browserEngine: index === 0 ? 'webkit' : 'chromium', artifactPaths: [artifactPath] })),
      artifacts: [{ path: artifactPath, bytes: artifactContent.length, sha256: sha256(artifactContent), mediaType: 'text/plain' }]
    };
    const manifestRelative = `${folder}/manifest.json`;
    await writeJson(join(root, manifestRelative), manifest);
    manifests.push({ path: join(root, manifestRelative), value: manifest, artifactPath: join(root, artifactPath), artifactRelative: artifactPath });
    references.push({ id: required.id, type: required.type, runId, artifactManifest: manifestRelative, notes: 'Synthetic non-production proof.' });
  }
  const evidence = {
    schemaVersion: 2,
    kind: 'axoboard-human-authenticated-qa-evidence',
    reviewer: 'independent-reviewer',
    reviewedAt: '2026-08-21T21:05:00.000Z',
    environment: 'disposable-non-production',
    candidateSha,
    targetOrigin,
    syntheticTenant: tenant,
    scenarios: references
  };
  await writeJson(evidencePath, evidence);
  return { root, evidencePath, evidence, manifests };
}

async function validate(input) {
  return loadHumanEvidence({
    evidencePath: input.evidencePath,
    requiredScenarios,
    expectedCandidateSha: candidateSha,
    expectedTargetOrigin: targetOrigin,
    policy: { maximumAgeHours: 72, maximumClockSkewMinutes: 5 },
    now
  });
}

test('derives authenticated evidence pass only after exact binding and artifact verification', async () => {
  const input = await bundle();
  const result = await validate(input);
  assert.equal(result.status, 'cryptographically-verified');
  assert.equal(result.candidateSha, candidateSha);
  assert.deepEqual(result.scenarios.map((scenario) => scenario.matrixCells), [1, 1]);
});

test('rejects the prior wrapper-passed plus unrelated-good-manifest false-certification attack', async () => {
  const input = await bundle();
  const oldAttack = {
    schemaVersion: 1,
    kind: 'axoboard-human-authenticated-qa-evidence',
    reviewer: 'attacker',
    reviewedAt: '2026-08-21T21:05:00.000Z',
    environment: 'disposable-non-production',
    scenarios: requiredScenarios.map((scenario) => ({ id: scenario.id, passed: true, artifactManifest: 'unrelated-good-fixture-manifest.json' }))
  };
  await writeJson(input.evidencePath, oldAttack);
  await writeJson(join(input.root, 'unrelated-good-fixture-manifest.json'), { kind: 'axoboard-apple-qa-artifact-manifest', passed: true });
  await assert.rejects(() => validate(input), /schema validation failed/);
});

test('rejects artifact tampering and declared byte-size drift', async () => {
  const input = await bundle();
  await writeFile(input.manifests[0].artifactPath, 'tampered');
  await assert.rejects(() => validate(input), /byte-size mismatch|SHA-256 mismatch/);
});

test('rejects manifest path traversal and symlink artifacts', async () => {
  const traversal = await bundle();
  traversal.evidence.scenarios[0].artifactManifest = '../outside.json';
  await writeJson(traversal.evidencePath, traversal.evidence);
  await assert.rejects(() => validate(traversal), /safe relative POSIX path|path traversal/);

  const linked = await bundle();
  const manifest = linked.manifests[0];
  const linkRelative = 'authenticated-app/link.txt';
  await symlink('capture-0.txt', join(linked.root, linkRelative));
  manifest.value.matrix[0].artifactPaths = [linkRelative];
  manifest.value.artifacts[0].path = linkRelative;
  await writeJson(manifest.path, manifest.value);
  await assert.rejects(() => validate(linked), /symbolic link/);
});

test('rejects wrong matrix, candidate SHA, target, tenant, and stale capture bindings', async () => {
  const mutations = [
    { label: /matrix mismatch/, mutate: (input) => { input.manifests[0].value.matrix[0].state = 'error'; } },
    { label: /candidate\/target binding/, mutate: (input) => { input.manifests[0].value.candidateSha = 'b'.repeat(40); } },
    { label: /candidate\/target binding/, mutate: (input) => { input.manifests[0].value.targetOrigin = 'http://127.0.0.1:9999'; } },
    { label: /synthetic tenant binding/, mutate: (input) => { input.manifests[0].value.syntheticTenant = { ...tenant, workspaceId: 'synthetic-other-workspace' }; } },
    { label: /stale/, mutate: (input) => { input.manifests[0].value.captureStartedAt = '2026-08-01T20:00:00.000Z'; } }
  ];
  for (const mutation of mutations) {
    const input = await bundle();
    mutation.mutate(input);
    await writeJson(input.manifests[0].path, input.manifests[0].value);
    await assert.rejects(() => validate(input), mutation.label);
  }
});

test('rejects a manifest or artifact reused across authenticated and paired-TV scenarios', async () => {
  const reusedManifest = await bundle();
  reusedManifest.evidence.scenarios[1].artifactManifest = reusedManifest.evidence.scenarios[0].artifactManifest;
  await writeJson(reusedManifest.evidencePath, reusedManifest.evidence);
  await assert.rejects(() => validate(reusedManifest), /artifact manifests.*duplicate/i);

  const reusedArtifact = await bundle();
  const firstContent = await readFile(reusedArtifact.manifests[0].artifactPath);
  const second = reusedArtifact.manifests[1];
  await writeFile(second.artifactPath, firstContent);
  second.value.artifacts[0].bytes = firstContent.length;
  second.value.artifacts[0].sha256 = sha256(firstContent);
  await writeJson(second.path, second.value);
  await assert.rejects(() => validate(reusedArtifact), /Duplicate artifact reuse/);
});
