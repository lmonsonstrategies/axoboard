import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const safePart = (value) => String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

export function screenshotName(identity) {
  return [identity.routeId, identity.state, identity.theme, identity.viewport].map(safePart).join('--') + '.png';
}

export async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function comparePngFiles(actualPath, expectedPath, diffPath) {
  const [actual, expected] = await Promise.all([
    readFile(actualPath).then((buffer) => PNG.sync.read(buffer)),
    readFile(expectedPath).then((buffer) => PNG.sync.read(buffer))
  ]);
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      equal: false,
      diffPixels: Math.max(actual.width * actual.height, expected.width * expected.height),
      diffRatio: 1,
      dimensionsMatch: false,
      actual: { width: actual.width, height: actual.height },
      expected: { width: expected.width, height: expected.height },
      diffPath: null
    };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  const diffPixels = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.5,
    diffColor: [255, 46, 99]
  });
  const diffRatio = diffPixels / Math.max(1, actual.width * actual.height);
  if (diffPixels > 0 && diffPath) {
    await mkdir(dirname(diffPath), { recursive: true });
    await writeFile(diffPath, PNG.sync.write(diff));
  }
  return {
    equal: diffPixels === 0,
    diffPixels,
    diffRatio,
    dimensionsMatch: true,
    actual: { width: actual.width, height: actual.height },
    expected: { width: expected.width, height: expected.height },
    diffPath: diffPixels > 0 ? diffPath : null
  };
}

export async function compareRuntimeStability({ currentPath, repeatPath, diffPath, maximumDiffRatio }) {
  const comparison = await comparePngFiles(currentPath, repeatPath, diffPath);
  return { ...comparison, stable: comparison.diffRatio <= maximumDiffRatio, maximumDiffRatio };
}

export async function assessApprovedBaseline({ identity, currentPath, approvedRoot, outputRoot, propose = false, reason = '', proposer = '' }) {
  const name = screenshotName(identity);
  const approvedPath = join(approvedRoot, name);
  const candidatePath = join(outputRoot, 'baseline-candidates', name);
  const diffPath = join(outputRoot, 'diffs', name);
  const currentHash = await sha256File(currentPath);
  let approvedHash = null;
  let comparison = null;
  try {
    approvedHash = await sha256File(approvedPath);
    comparison = await comparePngFiles(currentPath, approvedPath, diffPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const matches = Boolean(comparison?.diffRatio === 0);
  let candidate = null;
  if (!matches && propose) {
    if (!reason.trim()) throw new Error('--propose-baselines requires a non-empty --reason.');
    if (!proposer.trim()) throw new Error('--propose-baselines requires a proposer identity.');
    await mkdir(dirname(candidatePath), { recursive: true });
    await copyFile(currentPath, candidatePath);
    candidate = {
      candidatePath,
      candidateHash: currentHash,
      proposer,
      reason,
      reviewState: 'pending-independent-review'
    };
  }
  return {
    ...identity,
    name,
    currentPath,
    currentHash,
    approvedPath,
    approvedHash,
    baselineExists: approvedHash !== null,
    matches,
    comparison,
    candidate
  };
}

export async function writeBaselineProposal(records, outputRoot, metadata) {
  const changes = records.filter((record) => record.candidate);
  if (!changes.length) return null;
  const manifest = {
    schemaVersion: 1,
    kind: 'axoboard-visual-baseline-proposal',
    reviewState: 'pending-independent-review',
    generatedAt: new Date().toISOString(),
    ...metadata,
    changes: changes.map((record) => ({
      identity: { routeId: record.routeId, state: record.state, theme: record.theme, viewport: record.viewport },
      candidatePath: relative(outputRoot, record.candidate.candidatePath),
      candidateHash: record.candidate.candidateHash,
      approvedPath: record.approvedPath,
      approvedHash: record.approvedHash,
      diffPath: record.comparison?.diffPath ? relative(outputRoot, record.comparison.diffPath) : null,
      diffRatio: record.comparison?.diffRatio ?? null,
      reason: record.candidate.reason,
      proposer: record.candidate.proposer
    }))
  };
  const manifestPath = join(outputRoot, 'baseline-proposal.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, manifestPath };
}

export async function approveBaselineProposal({ manifestPath, reviewer, approvedRoot, dryRun = false }) {
  const absoluteManifest = resolve(manifestPath);
  const manifestRoot = dirname(absoluteManifest);
  const manifest = JSON.parse(await readFile(absoluteManifest, 'utf8'));
  if (manifest.kind !== 'axoboard-visual-baseline-proposal' || manifest.reviewState !== 'pending-independent-review') {
    throw new Error('Manifest is not a pending AxoBoard baseline proposal.');
  }
  if (!reviewer?.trim()) throw new Error('Independent reviewer identity is required.');
  const operations = [];
  for (const change of manifest.changes || []) {
    if (reviewer.trim() === String(change.proposer || '').trim()) throw new Error('Baseline proposer cannot approve the same proposal.');
    const candidatePath = resolve(manifestRoot, change.candidatePath);
    const candidateHash = await sha256File(candidatePath);
    if (candidateHash !== change.candidateHash) throw new Error(`Candidate hash mismatch for ${basename(candidatePath)}.`);
    const destination = join(resolve(approvedRoot), screenshotName(change.identity));
    operations.push({ candidatePath, destination, candidateHash });
  }
  if (!dryRun) {
    await mkdir(resolve(approvedRoot), { recursive: true });
    for (const operation of operations) await copyFile(operation.candidatePath, operation.destination);
    const approval = {
      schemaVersion: 1,
      kind: 'axoboard-visual-baseline-approval',
      proposal: absoluteManifest,
      reviewer: reviewer.trim(),
      approvedAt: new Date().toISOString(),
      files: operations.map((operation) => ({ path: operation.destination, sha256: operation.candidateHash }))
    };
    await writeFile(join(resolve(approvedRoot), 'approval-manifest.json'), `${JSON.stringify(approval, null, 2)}\n`);
  }
  return { dryRun, reviewer: reviewer.trim(), operations };
}
