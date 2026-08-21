import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { approveBaselineProposal, assessApprovedBaseline, comparePngFiles, writeBaselineProposal } from '../../src/visual-baselines.mjs';

async function png(path, color) {
  const image = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = color[0]; image.data[index + 1] = color[1]; image.data[index + 2] = color[2]; image.data[index + 3] = 255;
  }
  await writeFile(path, PNG.sync.write(image));
}

test('baseline changes stage a reviewable proposal and cannot self-approve', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axoboard-baseline-test-'));
  const current = join(root, 'current.png');
  await png(current, [0, 103, 197]);
  const identity = { routeId: 'home', state: 'default', theme: 'light', viewport: 'desktop-1440' };
  const record = await assessApprovedBaseline({ identity, currentPath: current, approvedRoot: join(root, 'approved'), outputRoot: root, propose: true, reason: 'intentional fixture seed', proposer: 'builder' });
  assert.equal(record.baselineExists, false);
  assert.equal(record.candidate.reviewState, 'pending-independent-review');
  const proposal = await writeBaselineProposal([record], root, { proposer: 'builder' });
  await assert.rejects(() => approveBaselineProposal({ manifestPath: proposal.manifestPath, reviewer: 'builder', approvedRoot: join(root, 'approved') }), /cannot approve/);
  const approval = await approveBaselineProposal({ manifestPath: proposal.manifestPath, reviewer: 'independent-reviewer', approvedRoot: join(root, 'approved') });
  assert.equal(approval.operations.length, 1);
  assert.ok((await readFile(approval.operations[0].destination)).length > 0);
});

test('pixel comparison writes a diff artifact for a changed baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'axoboard-pixel-test-'));
  const first = join(root, 'first.png');
  const second = join(root, 'second.png');
  const diff = join(root, 'diff.png');
  await png(first, [0, 0, 0]);
  await png(second, [255, 255, 255]);
  const result = await comparePngFiles(first, second, diff);
  assert.equal(result.equal, false);
  assert.equal(result.diffRatio, 1);
  assert.ok((await readFile(diff)).length > 0);
});
