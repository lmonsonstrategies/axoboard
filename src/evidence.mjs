import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { projectRoot } from './config.mjs';

const evidenceSchemaPath = resolve(projectRoot, 'config/authenticated-evidence.schema.json');
const artifactSchemaPath = resolve(projectRoot, 'config/authenticated-artifact-manifest.schema.json');
let validatorsPromise;

function schemaFailure(label, validate) {
  const detail = (validate.errors || []).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
  return new Error(`${label} schema validation failed: ${detail}`);
}

async function validators() {
  validatorsPromise ||= Promise.all([readFile(evidenceSchemaPath, 'utf8'), readFile(artifactSchemaPath, 'utf8')]).then(([evidenceRaw, artifactRaw]) => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    return { evidence: ajv.compile(JSON.parse(evidenceRaw)), artifact: ajv.compile(JSON.parse(artifactRaw)) };
  });
  return validatorsPromise;
}

function parseTime(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new Error(`${label} must be a canonical ISO-8601 timestamp.`);
  return timestamp;
}

function normalizedOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTP(S) origin.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an HTTP(S) origin without credentials, path, query, or fragment.`);
  }
  return url.origin;
}

function matrixIdentity(entry) {
  return [entry.state, entry.role, entry.device, entry.theme, entry.viewport].join('|');
}

function expectedScenarioType(scenario) {
  if (scenario.type) return scenario.type;
  if (scenario.surface === 'app') return 'authenticated-app';
  if (scenario.surface === 'tv') return 'paired-tv';
  throw new Error(`Scenario ${scenario.id} has no supported evidence type.`);
}

function ensureUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains a duplicate: ${value}.`);
    seen.add(value);
  }
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.includes('\0')) throw new Error(`${label} must be a safe relative POSIX path.`);
  const pieces = value.split('/');
  if (pieces.some((piece) => !piece || piece === '.' || piece === '..')) throw new Error(`${label} contains path traversal or ambiguous segments.`);
}

async function resolveSafeFile(root, relativePath, label) {
  assertSafeRelativePath(relativePath, label);
  const candidate = resolve(root, relativePath);
  if (relative(root, candidate).startsWith(`..${sep}`) || relative(root, candidate) === '..') throw new Error(`${label} escapes the evidence directory.`);
  let cursor = root;
  for (const piece of relativePath.split('/')) {
    cursor = resolve(cursor, piece);
    const details = await lstat(cursor).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`${label} is missing: ${relativePath}.`);
      throw error;
    });
    if (details.isSymbolicLink()) throw new Error(`${label} cannot traverse a symbolic link: ${relativePath}.`);
  }
  const [rootReal, candidateReal, details] = await Promise.all([realpath(root), realpath(candidate), stat(candidate)]);
  if (candidateReal !== rootReal && !candidateReal.startsWith(`${rootReal}${sep}`)) throw new Error(`${label} resolves outside the evidence directory.`);
  if (!details.isFile()) throw new Error(`${label} must reference a regular file.`);
  return { path: candidate, realPath: candidateReal, details };
}

function compareMatrix(required, actual, scenarioId) {
  const expectedIds = (required || []).map(matrixIdentity).sort();
  const actualIds = (actual || []).map(matrixIdentity).sort();
  ensureUnique(expectedIds, `Required matrix for ${scenarioId}`);
  ensureUnique(actualIds, `Evidence matrix for ${scenarioId}`);
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds)) {
    const expected = new Set(expectedIds);
    const observed = new Set(actualIds);
    const missing = expectedIds.filter((id) => !observed.has(id));
    const unexpected = actualIds.filter((id) => !expected.has(id));
    throw new Error(`Evidence matrix mismatch for ${scenarioId}; missing=${JSON.stringify(missing)} unexpected=${JSON.stringify(unexpected)}.`);
  }
}

function verifyTimestampWindow({ reviewedAt, startedAt, completedAt, nowMs, maximumAgeHours, maximumClockSkewMinutes, scenarioId }) {
  if (startedAt > completedAt) throw new Error(`Capture timestamps are reversed for ${scenarioId}.`);
  if (completedAt > reviewedAt) throw new Error(`Review predates completed capture for ${scenarioId}.`);
  const skewMs = maximumClockSkewMinutes * 60_000;
  if (reviewedAt > nowMs + skewMs || completedAt > nowMs + skewMs) throw new Error(`Evidence timestamp is in the future for ${scenarioId}.`);
  if (nowMs - startedAt > maximumAgeHours * 3_600_000) throw new Error(`Evidence is stale for ${scenarioId}.`);
}

export async function loadHumanEvidence({ evidencePath, requiredScenarios, expectedCandidateSha, expectedTargetOrigin, policy, now = new Date() }) {
  if (!evidencePath) return null;
  if (!/^[0-9a-f]{40}$/.test(expectedCandidateSha || '')) throw new Error('Expected candidate SHA must be an exact lowercase 40-character Git SHA.');
  const absoluteEvidencePath = resolve(evidencePath);
  const evidenceRoot = dirname(absoluteEvidencePath);
  const evidenceDetails = await lstat(absoluteEvidencePath);
  if (evidenceDetails.isSymbolicLink() || !evidenceDetails.isFile()) throw new Error('Human evidence document must be a regular non-symlink file.');
  const parsed = JSON.parse(await readFile(absoluteEvidencePath, 'utf8'));
  const compiled = await validators();
  if (!compiled.evidence(parsed)) throw schemaFailure('Human evidence', compiled.evidence);

  const expectedOrigin = normalizedOrigin(expectedTargetOrigin, 'Expected target origin');
  const evidenceOrigin = normalizedOrigin(parsed.targetOrigin, 'Human evidence targetOrigin');
  if (parsed.candidateSha !== expectedCandidateSha) throw new Error('Human evidence candidate SHA does not match the exact audited candidate.');
  if (evidenceOrigin !== expectedOrigin) throw new Error('Human evidence target origin does not match the exact audited origin.');
  const reviewedAt = parseTime(parsed.reviewedAt, 'reviewedAt');
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const maximumAgeHours = policy?.maximumAgeHours ?? 72;
  const maximumClockSkewMinutes = policy?.maximumClockSkewMinutes ?? 5;

  const requiredIds = (requiredScenarios || []).map((scenario) => scenario.id);
  const providedIds = parsed.scenarios.map((scenario) => scenario.id);
  ensureUnique(requiredIds, 'Required scenarios');
  ensureUnique(providedIds, 'Human evidence scenarios');
  if (JSON.stringify([...requiredIds].sort()) !== JSON.stringify([...providedIds].sort())) throw new Error('Human evidence must contain exactly the required scenario IDs.');
  ensureUnique(parsed.scenarios.map((scenario) => scenario.runId), 'Human evidence run IDs');
  ensureUnique(parsed.scenarios.map((scenario) => scenario.artifactManifest), 'Human evidence artifact manifests');

  const usedArtifactPaths = new Set();
  const usedArtifactHashes = new Set();
  const usedArtifactInodes = new Set();
  const verifiedScenarios = [];
  for (const required of requiredScenarios || []) {
    const reference = parsed.scenarios.find((scenario) => scenario.id === required.id);
    const requiredType = expectedScenarioType(required);
    if (reference.type !== requiredType) throw new Error(`Scenario type mismatch for ${required.id}.`);
    const manifestFile = await resolveSafeFile(evidenceRoot, reference.artifactManifest, `Artifact manifest for ${required.id}`);
    const manifest = JSON.parse(await readFile(manifestFile.path, 'utf8'));
    if (!compiled.artifact(manifest)) throw schemaFailure(`Artifact manifest for ${required.id}`, compiled.artifact);
    if (manifest.scenarioId !== required.id || manifest.scenarioType !== requiredType || manifest.runId !== reference.runId) throw new Error(`Artifact manifest scenario/run binding failed for ${required.id}.`);
    if (manifest.candidateSha !== parsed.candidateSha || normalizedOrigin(manifest.targetOrigin, `Manifest targetOrigin for ${required.id}`) !== evidenceOrigin) throw new Error(`Artifact manifest candidate/target binding failed for ${required.id}.`);
    if (manifest.syntheticTenant.tenantId !== parsed.syntheticTenant.tenantId || manifest.syntheticTenant.workspaceId !== parsed.syntheticTenant.workspaceId) throw new Error(`Artifact manifest synthetic tenant binding failed for ${required.id}.`);

    const startedAt = parseTime(manifest.captureStartedAt, `captureStartedAt for ${required.id}`);
    const completedAt = parseTime(manifest.captureCompletedAt, `captureCompletedAt for ${required.id}`);
    verifyTimestampWindow({ reviewedAt, startedAt, completedAt, nowMs, maximumAgeHours, maximumClockSkewMinutes, scenarioId: required.id });
    compareMatrix(required.requiredMatrix, manifest.matrix, required.id);

    const artifactPaths = manifest.artifacts.map((artifact) => artifact.path);
    ensureUnique(artifactPaths, `Artifact records for ${required.id}`);
    const referencedPaths = manifest.matrix.flatMap((entry) => entry.artifactPaths);
    ensureUnique(referencedPaths, `Matrix artifact references for ${required.id}`);
    if (JSON.stringify([...artifactPaths].sort()) !== JSON.stringify([...referencedPaths].sort())) throw new Error(`Every artifact for ${required.id} must be referenced by exactly one matrix cell.`);

    for (const artifact of manifest.artifacts) {
      const file = await resolveSafeFile(evidenceRoot, artifact.path, `Artifact for ${required.id}`);
      const inode = `${file.details.dev}:${file.details.ino}`;
      if (usedArtifactPaths.has(file.realPath) || usedArtifactInodes.has(inode) || usedArtifactHashes.has(artifact.sha256)) throw new Error(`Duplicate artifact reuse detected for ${required.id}: ${artifact.path}.`);
      if (file.details.size !== artifact.bytes) throw new Error(`Artifact byte-size mismatch for ${artifact.path}.`);
      const actualHash = createHash('sha256').update(await readFile(file.path)).digest('hex');
      if (actualHash !== artifact.sha256) throw new Error(`Artifact SHA-256 mismatch for ${artifact.path}.`);
      usedArtifactPaths.add(file.realPath);
      usedArtifactInodes.add(inode);
      usedArtifactHashes.add(actualHash);
    }
    verifiedScenarios.push({ id: required.id, type: requiredType, runId: reference.runId, manifest: reference.artifactManifest, matrixCells: manifest.matrix.length, artifacts: manifest.artifacts.length, captureCompletedAt: manifest.captureCompletedAt });
  }

  return {
    status: 'cryptographically-verified',
    reviewer: parsed.reviewer,
    reviewedAt: parsed.reviewedAt,
    candidateSha: parsed.candidateSha,
    targetOrigin: evidenceOrigin,
    syntheticTenant: parsed.syntheticTenant,
    scenarios: verifiedScenarios
  };
}

export { artifactSchemaPath, evidenceSchemaPath, matrixIdentity };
