import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { PNG } from 'pngjs';
import { canonicalSignedBytes } from '../../src/attestation.mjs';
import { loadHumanEvidence } from '../../src/evidence.mjs';

const candidateSha = 'a'.repeat(40);
const targetOrigin = 'http://127.0.0.1:4173';
const now = new Date('2026-08-21T21:10:00.000Z');
const tenant = { tenantId: 'synthetic-tenant-proof', workspaceId: 'synthetic-workspace-proof' };
const captureActor = 'capture-operator';
const reviewerId = 'trusted-reviewer';
const keyId = 'trusted-reviewer-key';
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const trustPolicy = {
  sha256: 'c'.repeat(64),
  reviewers: [{
    id: reviewerId,
    keyId,
    algorithm: 'Ed25519',
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    roles: ['authenticated-evidence', 'expert-review'],
    active: true
  }]
};
const requiredScenarios = [
  {
    id: 'authenticated-app-critical-states',
    type: 'authenticated-app',
    browserEngines: ['chromium', 'firefox', 'webkit'],
    requiredMatrix: [{ state: 'default', role: 'owner', device: 'phone', theme: 'light', viewport: 'phone-375' }]
  },
  {
    id: 'paired-tv-live-state',
    type: 'paired-tv',
    browserEngines: ['chromium', 'firefox', 'webkit'],
    requiredMatrix: [{ state: 'live', role: 'display-device', device: 'tv', theme: 'dark', viewport: 'tv-1920' }]
  }
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path, bytes);
  return bytes;
}

function signed(document, signingKey = privateKey) {
  const payload = canonicalSignedBytes(document);
  document.attestation = {
    algorithm: 'Ed25519',
    keyId,
    payloadSha256: sha256(payload),
    signature: sign(null, payload, signingKey).toString('base64')
  };
  return document;
}

function pngBytes(seed) {
  const image = new PNG({ width: 2, height: 2 });
  image.data.fill(255);
  image.data[0] = seed % 255;
  return PNG.sync.write(image);
}

function traceBytes(seed) {
  const bytes = Buffer.alloc(64, seed % 255);
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(bytes, 0);
  return bytes;
}

async function bundle() {
  const root = await mkdtemp(join(tmpdir(), 'axoboard-evidence-'));
  const evidencePath = join(root, 'evidence.json');
  const manifests = [];
  const references = [];
  let seed = 1;
  for (const [index, required] of requiredScenarios.entries()) {
    const folder = index === 0 ? 'authenticated-app' : 'paired-tv';
    const runId = index === 0 ? 'qa-auth-app-proof' : 'qa-paired-tv-proof';
    const matrix = [];
    const artifacts = [];
    for (const entry of required.requiredMatrix) {
      for (const browserEngine of required.browserEngines) {
        const stem = `${folder}/${browserEngine}-${seed}`;
        const screenshotPath = `${stem}.png`;
        const tracePath = `${stem}.zip`;
        const screenshot = pngBytes(seed++);
        const trace = traceBytes(seed++);
        await mkdir(join(root, folder), { recursive: true });
        await writeFile(join(root, screenshotPath), screenshot);
        await writeFile(join(root, tracePath), trace);
        matrix.push({ ...entry, browserEngine, browserVersion: `${browserEngine}-test-1`, artifactPaths: [screenshotPath, tracePath] });
        artifacts.push(
          { kind: 'screenshot', path: screenshotPath, bytes: screenshot.length, sha256: sha256(screenshot), mediaType: 'image/png' },
          { kind: 'playwright-trace', path: tracePath, bytes: trace.length, sha256: sha256(trace), mediaType: 'application/zip' }
        );
      }
    }
    const manifest = {
      schemaVersion: 3,
      kind: 'axoboard-human-qa-scenario-artifact-manifest',
      scenarioId: required.id,
      scenarioType: required.type,
      runId,
      captureActor,
      candidateSha,
      targetOrigin,
      syntheticTenant: tenant,
      captureStartedAt: '2026-08-21T20:00:00.000Z',
      captureCompletedAt: '2026-08-21T21:00:00.000Z',
      playwrightVersion: '1.55.0',
      matrix,
      artifacts
    };
    const manifestRelative = `${folder}/manifest.json`;
    const manifestBytes = await writeJson(join(root, manifestRelative), manifest);
    manifests.push({ path: join(root, manifestRelative), value: manifest, artifactPath: join(root, artifacts[0].path), artifactRelative: artifacts[0].path });
    references.push({ id: required.id, type: required.type, runId, artifactManifest: manifestRelative, artifactManifestSha256: sha256(manifestBytes), notes: 'Synthetic non-production browser proof reviewed independently.' });
  }
  const evidence = {
    schemaVersion: 3,
    kind: 'axoboard-human-authenticated-qa-evidence',
    captureActor,
    reviewerId,
    reviewedAt: '2026-08-21T21:05:00.000Z',
    environment: 'disposable-non-production',
    candidateSha,
    targetOrigin,
    syntheticTenant: tenant,
    scenarios: references
  };
  await writeJson(evidencePath, signed(evidence));
  return { root, evidencePath, evidence, manifests };
}

async function rewriteManifestAndSign(input, index = 0) {
  const bytes = await writeJson(input.manifests[index].path, input.manifests[index].value);
  input.evidence.scenarios[index].artifactManifestSha256 = sha256(bytes);
  delete input.evidence.attestation;
  await writeJson(input.evidencePath, signed(input.evidence));
}

async function rewriteEvidence(input, signingKey = privateKey) {
  delete input.evidence.attestation;
  await writeJson(input.evidencePath, signed(input.evidence, signingKey));
}

async function validate(input) {
  return loadHumanEvidence({
    evidencePath: input.evidencePath,
    requiredScenarios,
    expectedCandidateSha: candidateSha,
    expectedTargetOrigin: targetOrigin,
    expectedCaptureActor: captureActor,
    policy: { maximumAgeHours: 72, maximumClockSkewMinutes: 5 },
    trustPolicy,
    now
  });
}

test('derives authenticated evidence pass only from a trusted signed exact artifact chain', async () => {
  const input = await bundle();
  const result = await validate(input);
  assert.equal(result.status, 'trusted-signed-attestation');
  assert.equal(result.reviewerId, reviewerId);
  assert.deepEqual(result.scenarios.map((scenario) => scenario.matrixCells), [3, 3]);
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

test('rejects self-issued reviewer signatures and capture/reviewer identity reuse', async () => {
  const input = await bundle();
  const attacker = generateKeyPairSync('ed25519');
  await rewriteEvidence(input, attacker.privateKey);
  await assert.rejects(() => validate(input), /signature verification failed/);
  const sameActor = await bundle();
  sameActor.evidence.captureActor = reviewerId;
  await rewriteEvidence(sameActor);
  await assert.rejects(() => validate(sameActor), /capture actor|must be distinct/i);
});

test('rejects zero-browser claim artifacts, aliases, and unsigned manifest replacement', async () => {
  const input = await bundle();
  const manifest = input.manifests[0];
  manifest.value.matrix[0].browserEngine = 'chrome';
  manifest.value.artifacts[0] = { kind: 'screenshot', path: 'authenticated-app/claim.txt', bytes: 32, sha256: '0'.repeat(64), mediaType: 'text/plain' };
  await rewriteManifestAndSign(input);
  await assert.rejects(() => validate(input), /schema validation failed/);

  const replaced = await bundle();
  replaced.manifests[0].value.captureActor = 'different-capture-actor';
  await writeJson(replaced.manifests[0].path, replaced.manifests[0].value);
  await assert.rejects(() => validate(replaced), /Signed artifact manifest digest mismatch/);
});

test('rejects artifact tampering and declared byte-size drift', async () => {
  const input = await bundle();
  await writeFile(input.manifests[0].artifactPath, 'tampered');
  await assert.rejects(() => validate(input), /byte-size mismatch|SHA-256 mismatch/);
});

test('rejects manifest path traversal and symlink artifacts', async () => {
  const traversal = await bundle();
  traversal.evidence.scenarios[0].artifactManifest = '../outside.json';
  await rewriteEvidence(traversal);
  await assert.rejects(() => validate(traversal), /safe relative POSIX path|path traversal/);

  const linked = await bundle();
  const manifest = linked.manifests[0];
  const linkRelative = 'authenticated-app/link.png';
  await symlink(manifest.value.artifacts[0].path.split('/').at(-1), join(linked.root, linkRelative));
  manifest.value.matrix[0].artifactPaths[0] = linkRelative;
  manifest.value.artifacts[0].path = linkRelative;
  await rewriteManifestAndSign(linked);
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
    await rewriteManifestAndSign(input);
    await assert.rejects(() => validate(input), mutation.label);
  }
});

test('rejects a manifest or artifact reused across authenticated and paired-TV scenarios', async () => {
  const reusedManifest = await bundle();
  reusedManifest.evidence.scenarios[1].artifactManifest = reusedManifest.evidence.scenarios[0].artifactManifest;
  reusedManifest.evidence.scenarios[1].artifactManifestSha256 = reusedManifest.evidence.scenarios[0].artifactManifestSha256;
  await rewriteEvidence(reusedManifest);
  await assert.rejects(() => validate(reusedManifest), /artifact manifests.*duplicate|manifest hashes.*duplicate/i);

  const reusedArtifact = await bundle();
  const firstContent = await readFile(reusedArtifact.manifests[0].artifactPath);
  const second = reusedArtifact.manifests[1];
  await writeFile(second.artifactPath, firstContent);
  second.value.artifacts[0].bytes = firstContent.length;
  second.value.artifacts[0].sha256 = sha256(firstContent);
  await rewriteManifestAndSign(reusedArtifact, 1);
  await assert.rejects(() => validate(reusedArtifact), /Duplicate artifact reuse/);
});
