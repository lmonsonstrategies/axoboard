import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalSignedBytes, loadTrustPolicy } from '../../src/attestation.mjs';
import { loadExpertReviewBundle } from '../../src/expert-review.mjs';
import { validateExpertReview } from '../../src/qualitative-rubric.mjs';

const candidateSha = 'd'.repeat(40);
const targetOrigin = 'http://127.0.0.1:4173';
const now = new Date('2026-08-21T21:10:00.000Z');
const dimensions = ['hierarchy', 'typography', 'spacing-rhythm', 'alignment-grid', 'density', 'surface-material', 'icon-consistency', 'microcopy', 'interaction-states', 'motion-intent', 'perceived-polish', 'brand-distinctiveness'];
const policy = { qualitativeDimensions: dimensions };
const evidencePolicy = { maximumAgeHours: 72, maximumClockSkewMinutes: 5 };
const identity = { routeId: 'home', state: 'default', theme: 'light', viewport: 'desktop-1440', browserEngine: 'webkit' };
const result = {
  ...identity,
  viewport: { id: identity.viewport, width: 1440, height: 900 },
  findings: [],
  counts: { interactiveTargets: 1, focusStops: 1 },
  qualitativeSnapshot: {}
};
const screenshotSha256 = 'a'.repeat(64);
const repeatScreenshotSha256 = 'b'.repeat(64);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function writeJson(path, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(path, bytes);
  return bytes;
}

function signed(document, signingKey = privateKey) {
  delete document.attestation;
  const payload = canonicalSignedBytes(document);
  document.attestation = {
    algorithm: 'Ed25519',
    keyId: 'owner-reviewer-key',
    payloadSha256: sha256(payload),
    signature: sign(null, payload, signingKey).toString('base64')
  };
  return document;
}

async function fixtures() {
  const root = await mkdtemp(join(tmpdir(), 'axoboard-attestation-'));
  const policyPath = join(root, 'trust-policy.json');
  const trustDocument = {
    schemaVersion: 1,
    kind: 'axoboard-owner-controlled-qa-trust-policy',
    issuedBy: 'axoboard-owner',
    issuedAt: '2026-08-20T00:00:00.000Z',
    expiresAt: '2026-08-22T00:00:00.000Z',
    reviewers: [{
      id: 'owner-reviewer',
      keyId: 'owner-reviewer-key',
      algorithm: 'Ed25519',
      publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      roles: ['authenticated-evidence', 'expert-review'],
      active: true
    }]
  };
  const policyBytes = await writeJson(policyPath, trustDocument);
  const trustPolicy = await loadTrustPolicy({ path: policyPath, expectedSha256: sha256(policyBytes), now });
  const reviewPath = join(root, 'expert-review.json');
  const review = {
    schemaVersion: 2,
    kind: 'axoboard-expert-review-attestation',
    candidateSha,
    targetOrigin,
    captureActor: 'capture-operator',
    reviewerId: 'owner-reviewer',
    capturedAt: '2026-08-21T20:00:00.000Z',
    reviewedAt: '2026-08-21T21:00:00.000Z',
    reviews: [{
      ...identity,
      approved: true,
      artifacts: { screenshotSha256, repeatScreenshotSha256 },
      dimensions: dimensions.map((id) => ({ id, score: 5, evidence: `Reviewed exact ${id} artifact evidence.` }))
    }]
  };
  await writeJson(reviewPath, signed(review));
  return { root, policyPath, policySha256: sha256(policyBytes), trustDocument, trustPolicy, reviewPath, review };
}

async function load(input, overrides = {}) {
  return loadExpertReviewBundle({
    path: input.reviewPath,
    expectedCandidateSha: candidateSha,
    expectedTargetOrigin: targetOrigin,
    expectedCaptureActor: 'capture-operator',
    expectedIdentities: [identity],
    qualitativeDimensions: dimensions,
    evidencePolicy,
    trustPolicy: input.trustPolicy,
    now,
    ...overrides
  });
}

test('loads only an external exact-digest, active owner-controlled trust policy', async () => {
  const input = await fixtures();
  assert.equal(input.trustPolicy.reviewers[0].id, 'owner-reviewer');
  await assert.rejects(() => loadTrustPolicy({ path: input.policyPath, expectedSha256: '0'.repeat(64), now }), /digest does not match/);
  await assert.rejects(() => loadTrustPolicy({ path: input.policyPath, expectedSha256: input.policySha256, now: new Date('2026-08-23T00:00:00.000Z') }), /not currently valid/);
});

test('accepts an exact signed expert review and binds its current screenshot artifacts', async () => {
  const input = await fixtures();
  const bundle = await load(input);
  assert.equal(bundle.metadata.reviewerId, 'owner-reviewer');
  assert.doesNotThrow(() => validateExpertReview(bundle.reviews[0], result, policy, { candidateSha, targetOrigin, screenshotSha256, repeatScreenshotSha256 }));
});

test('rejects unsigned or self-authored legacy expert review objects', () => {
  const legacy = {
    ...identity,
    reviewer: 'same-builder',
    reviewedAt: 'not-a-timestamp',
    approved: true,
    dimensions: dimensions.map((id) => ({ id, score: 5, evidence: 'self-authored evidence' }))
  };
  assert.throws(() => validateExpertReview(legacy, result, policy, { candidateSha, targetOrigin, screenshotSha256, repeatScreenshotSha256 }), /trusted owner-policy Ed25519 attestation/);
});

test('rejects untrusted signatures, self-review, stale time, wrong SHA/origin, and matrix drift', async () => {
  const mutations = [
    { label: /capture actor|must be distinct/i, mutate: (input) => { input.review.captureActor = input.review.reviewerId; } },
    { label: /stale/, mutate: (input) => { input.review.capturedAt = '2026-08-01T20:00:00.000Z'; } },
    { label: /candidate SHA/, mutate: (input) => { input.review.candidateSha = 'e'.repeat(40); } },
    { label: /target origin/, mutate: (input) => { input.review.targetOrigin = 'http://127.0.0.1:9999'; } },
    { label: /matrix mismatch/, mutate: (input) => { input.review.reviews[0].viewport = 'phone-375'; } }
  ];
  for (const mutation of mutations) {
    const input = await fixtures();
    mutation.mutate(input);
    await writeJson(input.reviewPath, signed(input.review));
    await assert.rejects(() => load(input), mutation.label);
  }
  const untrusted = await fixtures();
  const attacker = generateKeyPairSync('ed25519');
  await writeJson(untrusted.reviewPath, signed(untrusted.review, attacker.privateKey));
  await assert.rejects(() => load(untrusted), /signature verification failed/);
});

test('rejects expert approval when current artifact hashes differ from the signed review', async () => {
  const input = await fixtures();
  const bundle = await load(input);
  assert.throws(() => validateExpertReview(bundle.reviews[0], result, policy, { candidateSha, targetOrigin, screenshotSha256: 'f'.repeat(64), repeatScreenshotSha256 }), /artifact hashes/);
});
