import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { assertFreshAttestation, readStrictJsonFile, verifySignedAttestation } from './attestation.mjs';
import { projectRoot } from './config.mjs';

const expertReviewSchemaPath = resolve(projectRoot, 'config/expert-review.schema.json');
const verifiedReviews = new WeakMap();
let validatorPromise;

function schemaFailure(validate) {
  const detail = (validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
  return new Error(`Expert review schema validation failed: ${detail}`);
}

async function validator() {
  validatorPromise ||= readFile(expertReviewSchemaPath, 'utf8').then((raw) => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    return ajv.compile(JSON.parse(raw));
  });
  return validatorPromise;
}

function normalizedOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTP(S) origin.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an HTTP(S) origin without credentials, path, query, or fragment.`);
  }
  return url.origin;
}

export function expertReviewIdentity(value) {
  return [value.routeId, value.state, value.theme, value.viewport?.id || value.viewport, value.browserEngine].join('|');
}

function ensureUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains a duplicate: ${value}.`);
    seen.add(value);
  }
}

function assertExactIdentitySet(actualReviews, expectedIdentities) {
  const actual = actualReviews.map(expertReviewIdentity).sort();
  const expected = expectedIdentities.map(expertReviewIdentity).sort();
  ensureUnique(actual, 'Expert review identities');
  ensureUnique(expected, 'Required expert review identities');
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    const missing = expected.filter((identity) => !actualSet.has(identity));
    const unexpected = actual.filter((identity) => !expectedSet.has(identity));
    throw new Error(`Expert review matrix mismatch; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}.`);
  }
}

function assertDimensions(review, qualitativeDimensions) {
  const expected = [...qualitativeDimensions].sort();
  const actual = review.dimensions.map((dimension) => dimension.id).sort();
  ensureUnique(actual, `Expert review dimensions for ${expertReviewIdentity(review)}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expert review dimensions do not exactly match policy for ${expertReviewIdentity(review)}.`);
}

export async function loadExpertReviewBundle({ path, expectedCandidateSha, expectedTargetOrigin, expectedCaptureActor, expectedIdentities, qualitativeDimensions, evidencePolicy, trustPolicy, now = new Date() }) {
  if (!path) return { reviews: [], metadata: null };
  const document = await readStrictJsonFile(path, 'Expert review attestation');
  const parsed = document.value;
  const validate = await validator();
  if (!validate(parsed)) throw schemaFailure(validate);
  if (parsed.candidateSha !== expectedCandidateSha) throw new Error('Expert review candidate SHA does not match the audited candidate.');
  if (!expectedCaptureActor || parsed.captureActor !== expectedCaptureActor) throw new Error('Expert review capture actor does not match the asserted capture operator.');
  const expectedOrigin = normalizedOrigin(expectedTargetOrigin, 'Expected expert-review target origin');
  const actualOrigin = normalizedOrigin(parsed.targetOrigin, 'Expert review targetOrigin');
  if (actualOrigin !== expectedOrigin) throw new Error('Expert review target origin does not match the audited origin.');
  const signedBy = verifySignedAttestation(parsed, trustPolicy, 'expert-review');
  assertFreshAttestation({
    capturedAt: parsed.capturedAt,
    reviewedAt: parsed.reviewedAt,
    now,
    maximumAgeHours: evidencePolicy.maximumAgeHours,
    maximumClockSkewMinutes: evidencePolicy.maximumClockSkewMinutes,
    label: 'Expert review'
  });
  assertExactIdentitySet(parsed.reviews, expectedIdentities);
  for (const review of parsed.reviews) {
    assertDimensions(review, qualitativeDimensions);
    const context = {
      candidateSha: parsed.candidateSha,
      targetOrigin: actualOrigin,
      captureActor: parsed.captureActor,
      reviewerId: parsed.reviewerId,
      capturedAt: parsed.capturedAt,
      reviewedAt: parsed.reviewedAt,
      signature: signedBy
    };
    verifiedReviews.set(review, context);
    Object.defineProperties(review, {
      reviewerId: { value: parsed.reviewerId, enumerable: false },
      reviewedAt: { value: parsed.reviewedAt, enumerable: false }
    });
  }
  return { reviews: parsed.reviews, metadata: { ...signedBy, captureActor: parsed.captureActor, reviewerId: parsed.reviewerId, capturedAt: parsed.capturedAt, reviewedAt: parsed.reviewedAt, candidateSha: parsed.candidateSha, targetOrigin: actualOrigin } };
}

export function assertVerifiedExpertReview(review, result, policy, expected = {}) {
  if (!review || typeof review !== 'object') throw new Error('Expert review must be a JSON object.');
  const context = verifiedReviews.get(review);
  if (!context) throw new Error('Expert review requires a trusted owner-policy Ed25519 attestation.');
  if (!review.approved) throw new Error('Expert review must be explicitly approved.');
  if (expertReviewIdentity(review) !== expertReviewIdentity({ ...result, viewport: result.viewport.id })) throw new Error('Expert review identity does not match the audited route/state/theme/viewport/browser engine.');
  if (expected.candidateSha && context.candidateSha !== expected.candidateSha) throw new Error('Expert review candidate binding changed after verification.');
  if (expected.targetOrigin && context.targetOrigin !== normalizedOrigin(expected.targetOrigin, 'Audited expert-review origin')) throw new Error('Expert review origin binding changed after verification.');
  if (review.artifacts.screenshotSha256 !== expected.screenshotSha256 || review.artifacts.repeatScreenshotSha256 !== expected.repeatScreenshotSha256) {
    throw new Error('Expert review artifact hashes do not match the current audited captures.');
  }
  assertDimensions(review, policy.qualitativeDimensions);
  return review;
}

export { expertReviewSchemaPath };
