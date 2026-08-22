import { createHash, createPublicKey, verify } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot } from './config.mjs';

const trustPolicySchemaPath = resolve(projectRoot, 'config/qa-trust-policy.schema.json');
const maximumDocumentBytes = 10 * 1024 * 1024;
let trustValidatorPromise;

function schemaFailure(label, validate) {
  const detail = (validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
  return new Error(`${label} schema validation failed: ${detail}`);
}

async function trustValidator() {
  trustValidatorPromise ||= readFile(trustPolicySchemaPath, 'utf8').then((raw) => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    return ajv.compile(JSON.parse(raw));
  });
  return trustValidatorPromise;
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Signed attestation contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  throw new Error('Signed attestation contains an unsupported value type.');
}

export function canonicalSignedBytes(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Signed attestation must be a JSON object.');
  const { attestation: _attestation, ...payload } = document;
  return Buffer.from(canonicalJson(payload), 'utf8');
}

export function parseCanonicalTime(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new Error(`${label} must be a canonical ISO-8601 timestamp.`);
  return timestamp;
}

export function assertFreshAttestation({ capturedAt, reviewedAt, now = new Date(), maximumAgeHours, maximumClockSkewMinutes, label }) {
  const captureMs = parseCanonicalTime(capturedAt, `${label} capturedAt`);
  const reviewMs = parseCanonicalTime(reviewedAt, `${label} reviewedAt`);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const skewMs = maximumClockSkewMinutes * 60_000;
  if (captureMs > reviewMs) throw new Error(`${label} review predates its capture.`);
  if (reviewMs > nowMs + skewMs) throw new Error(`${label} review timestamp is in the future.`);
  if (nowMs - captureMs > maximumAgeHours * 3_600_000) throw new Error(`${label} is stale.`);
  return { captureMs, reviewMs, nowMs };
}

export async function readStrictJsonFile(path, label) {
  const absolutePath = resolve(path);
  const details = await lstat(absolutePath);
  if (details.isSymbolicLink() || !details.isFile()) throw new Error(`${label} must be a regular non-symlink file.`);
  if (details.size < 2 || details.size > maximumDocumentBytes) throw new Error(`${label} has an invalid size.`);
  const bytes = await readFile(absolutePath);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`${label} must contain valid JSON.`); }
  return { absolutePath, bytes, value };
}

function ensureUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains a duplicate: ${value}.`);
    seen.add(value);
  }
}

export async function loadTrustPolicy({ path, expectedSha256, now = new Date() }) {
  if (!path || !expectedSha256) throw new Error('Owner-controlled QA trust policy path and SHA-256 are required for signed review evidence.');
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new Error('QA trust policy SHA-256 must be an exact lowercase digest.');
  const document = await readStrictJsonFile(path, 'QA trust policy');
  const [policyRealPath, projectRealPath] = await Promise.all([realpath(document.absolutePath), realpath(projectRoot)]);
  const withinProject = relative(projectRealPath, policyRealPath);
  if (withinProject === '' || (!withinProject.startsWith(`..${sep}`) && withinProject !== '..')) {
    throw new Error('QA trust policy must be supplied from outside the candidate checkout.');
  }
  const actualSha256 = createHash('sha256').update(document.bytes).digest('hex');
  if (actualSha256 !== expectedSha256) throw new Error('QA trust policy digest does not match the owner-controlled expected SHA-256.');
  const validate = await trustValidator();
  if (!validate(document.value)) throw schemaFailure('QA trust policy', validate);
  const issuedAt = parseCanonicalTime(document.value.issuedAt, 'QA trust policy issuedAt');
  const expiresAt = parseCanonicalTime(document.value.expiresAt, 'QA trust policy expiresAt');
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (issuedAt > nowMs || expiresAt <= nowMs || expiresAt <= issuedAt) throw new Error('QA trust policy is not currently valid.');
  ensureUnique(document.value.reviewers.map((reviewer) => reviewer.id), 'QA trust policy reviewer IDs');
  ensureUnique(document.value.reviewers.map((reviewer) => reviewer.keyId), 'QA trust policy key IDs');
  for (const reviewer of document.value.reviewers) {
    let key;
    try { key = createPublicKey(reviewer.publicKeyPem); } catch { throw new Error(`QA reviewer ${reviewer.id} has an invalid public key.`); }
    if (key.asymmetricKeyType !== 'ed25519') throw new Error(`QA reviewer ${reviewer.id} must use an Ed25519 public key.`);
  }
  return { ...document.value, sha256: actualSha256, sourcePath: policyRealPath };
}

export function verifySignedAttestation(document, trustPolicy, role) {
  if (!trustPolicy) throw new Error('A verified owner-controlled QA trust policy is required.');
  if (!document?.reviewerId || document.captureActor === document.reviewerId) throw new Error('Capture actor and independent reviewer must be distinct identities.');
  const reviewer = trustPolicy.reviewers.find((candidate) => candidate.id === document.reviewerId && candidate.keyId === document.attestation?.keyId);
  if (!reviewer || !reviewer.active || !reviewer.roles.includes(role)) throw new Error(`Reviewer is not trusted for ${role}.`);
  if (document.attestation?.algorithm !== 'Ed25519') throw new Error('QA attestation must use Ed25519.');
  const payload = canonicalSignedBytes(document);
  const payloadSha256 = createHash('sha256').update(payload).digest('hex');
  if (document.attestation.payloadSha256 !== payloadSha256) throw new Error('QA attestation payload digest mismatch.');
  const signature = Buffer.from(String(document.attestation.signature || ''), 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== document.attestation.signature) throw new Error('QA attestation signature must be canonical base64 Ed25519 bytes.');
  const publicKey = createPublicKey(reviewer.publicKeyPem);
  if (!verify(null, payload, publicKey, signature)) throw new Error('QA attestation signature verification failed.');
  return { reviewerId: reviewer.id, keyId: reviewer.keyId, role, trustPolicySha256: trustPolicy.sha256 };
}

export { trustPolicySchemaPath };
