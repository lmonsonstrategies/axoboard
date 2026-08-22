import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { PNG } from 'pngjs';
import { parseCanonicalTime, readStrictJsonFile, verifySignedAttestation } from './attestation.mjs';
import { projectRoot } from './config.mjs';

const evidenceSchemaPath = resolve(projectRoot, 'config/authenticated-evidence.schema.json');
const artifactSchemaPath = resolve(projectRoot, 'config/authenticated-artifact-manifest.schema.json');
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const zipMagic = new Set(['504b0304', '504b0506', '504b0708']);
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

function normalizedOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be an absolute HTTP(S) origin.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an HTTP(S) origin without credentials, path, query, or fragment.`);
  }
  return url.origin;
}

export function matrixIdentity(entry) {
  return [entry.state, entry.role, entry.device, entry.theme, entry.viewport, entry.browserEngine].join('|');
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

function expectedMatrix(required) {
  return required.requiredMatrix.flatMap((entry) => required.browserEngines.map((browserEngine) => ({ ...entry, browserEngine })));
}

function compareMatrix(required, actual, scenarioId) {
  const expectedIds = expectedMatrix(required).map(matrixIdentity).sort();
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

function verifyArtifactSemantics(artifact, bytes) {
  if (artifact.kind === 'screenshot') {
    if (!bytes.subarray(0, pngMagic.length).equals(pngMagic)) throw new Error(`Screenshot artifact is not PNG data: ${artifact.path}.`);
    let decoded;
    try { decoded = PNG.sync.read(bytes); } catch { throw new Error(`Screenshot artifact is not a valid PNG: ${artifact.path}.`); }
    if (decoded.width < 1 || decoded.height < 1 || decoded.width > 20_000 || decoded.height > 20_000) throw new Error(`Screenshot dimensions are invalid: ${artifact.path}.`);
    return;
  }
  if (artifact.kind === 'playwright-trace') {
    if (bytes.length < 22 || !zipMagic.has(bytes.subarray(0, 4).toString('hex'))) throw new Error(`Playwright trace artifact is not ZIP data: ${artifact.path}.`);
    return;
  }
  throw new Error(`Unsupported authenticated evidence artifact kind: ${artifact.kind}.`);
}

function verifyCellArtifactKinds(manifest, scenarioId) {
  const byPath = new Map(manifest.artifacts.map((artifact) => [artifact.path, artifact]));
  for (const cell of manifest.matrix) {
    const kinds = cell.artifactPaths.map((path) => byPath.get(path)?.kind).sort();
    if (JSON.stringify(kinds) !== JSON.stringify(['playwright-trace', 'screenshot'])) {
      throw new Error(`Matrix cell ${matrixIdentity(cell)} for ${scenarioId} requires one screenshot and one Playwright trace.`);
    }
  }
}

export async function loadHumanEvidence({ evidencePath, requiredScenarios, expectedCandidateSha, expectedTargetOrigin, expectedCaptureActor, policy, trustPolicy, now = new Date() }) {
  if (!evidencePath) return null;
  if (!/^[0-9a-f]{40}$/.test(expectedCandidateSha || '')) throw new Error('Expected candidate SHA must be an exact lowercase 40-character Git SHA.');
  if (!expectedCaptureActor) throw new Error('Expected capture actor is required for human evidence verification.');
  const evidenceDocument = await readStrictJsonFile(evidencePath, 'Human evidence document');
  const evidenceRoot = dirname(evidenceDocument.absolutePath);
  const parsed = evidenceDocument.value;
  const compiled = await validators();
  if (!compiled.evidence(parsed)) throw schemaFailure('Human evidence', compiled.evidence);

  const expectedOrigin = normalizedOrigin(expectedTargetOrigin, 'Expected target origin');
  const evidenceOrigin = normalizedOrigin(parsed.targetOrigin, 'Human evidence targetOrigin');
  if (parsed.candidateSha !== expectedCandidateSha) throw new Error('Human evidence candidate SHA does not match the exact audited candidate.');
  if (evidenceOrigin !== expectedOrigin) throw new Error('Human evidence target origin does not match the exact audited origin.');
  if (parsed.captureActor !== expectedCaptureActor) throw new Error('Human evidence capture actor does not match the asserted capture operator.');
  const signedBy = verifySignedAttestation(parsed, trustPolicy, 'authenticated-evidence');
  const reviewedAt = parseCanonicalTime(parsed.reviewedAt, 'reviewedAt');
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
  ensureUnique(parsed.scenarios.map((scenario) => scenario.artifactManifestSha256), 'Human evidence artifact manifest hashes');

  const usedArtifactPaths = new Set();
  const usedArtifactHashes = new Set();
  const usedArtifactInodes = new Set();
  const verifiedScenarios = [];
  for (const required of requiredScenarios || []) {
    const reference = parsed.scenarios.find((scenario) => scenario.id === required.id);
    const requiredType = expectedScenarioType(required);
    if (reference.type !== requiredType) throw new Error(`Scenario type mismatch for ${required.id}.`);
    const manifestFile = await resolveSafeFile(evidenceRoot, reference.artifactManifest, `Artifact manifest for ${required.id}`);
    const manifestBytes = await readFile(manifestFile.path);
    const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
    if (manifestHash !== reference.artifactManifestSha256) throw new Error(`Signed artifact manifest digest mismatch for ${required.id}.`);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (!compiled.artifact(manifest)) throw schemaFailure(`Artifact manifest for ${required.id}`, compiled.artifact);
    if (manifest.scenarioId !== required.id || manifest.scenarioType !== requiredType || manifest.runId !== reference.runId) throw new Error(`Artifact manifest scenario/run binding failed for ${required.id}.`);
    if (manifest.captureActor !== parsed.captureActor) throw new Error(`Artifact manifest capture-actor binding failed for ${required.id}.`);
    if (manifest.candidateSha !== parsed.candidateSha || normalizedOrigin(manifest.targetOrigin, `Manifest targetOrigin for ${required.id}`) !== evidenceOrigin) throw new Error(`Artifact manifest candidate/target binding failed for ${required.id}.`);
    if (manifest.syntheticTenant.tenantId !== parsed.syntheticTenant.tenantId || manifest.syntheticTenant.workspaceId !== parsed.syntheticTenant.workspaceId) throw new Error(`Artifact manifest synthetic tenant binding failed for ${required.id}.`);

    const startedAt = parseCanonicalTime(manifest.captureStartedAt, `captureStartedAt for ${required.id}`);
    const completedAt = parseCanonicalTime(manifest.captureCompletedAt, `captureCompletedAt for ${required.id}`);
    verifyTimestampWindow({ reviewedAt, startedAt, completedAt, nowMs, maximumAgeHours, maximumClockSkewMinutes, scenarioId: required.id });
    compareMatrix(required, manifest.matrix, required.id);
    verifyCellArtifactKinds(manifest, required.id);

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
      const bytes = await readFile(file.path);
      const actualHash = createHash('sha256').update(bytes).digest('hex');
      if (actualHash !== artifact.sha256) throw new Error(`Artifact SHA-256 mismatch for ${artifact.path}.`);
      verifyArtifactSemantics(artifact, bytes);
      usedArtifactPaths.add(file.realPath);
      usedArtifactInodes.add(inode);
      usedArtifactHashes.add(actualHash);
    }
    verifiedScenarios.push({ id: required.id, type: requiredType, runId: reference.runId, manifest: reference.artifactManifest, manifestSha256: manifestHash, matrixCells: manifest.matrix.length, artifacts: manifest.artifacts.length, captureCompletedAt: manifest.captureCompletedAt });
  }

  return {
    status: 'trusted-signed-attestation',
    captureActor: parsed.captureActor,
    reviewerId: parsed.reviewerId,
    reviewedAt: parsed.reviewedAt,
    candidateSha: parsed.candidateSha,
    targetOrigin: evidenceOrigin,
    syntheticTenant: parsed.syntheticTenant,
    signature: signedBy,
    scenarios: verifiedScenarios
  };
}

export { artifactSchemaPath, evidenceSchemaPath };
