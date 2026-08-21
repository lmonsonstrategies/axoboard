import { resolve } from 'node:path';
import { approveBaselineProposal } from '../src/visual-baselines.mjs';

const args = process.argv.slice(2);
const value = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const manifestPath = value('--manifest');
const reviewer = value('--reviewer') || process.env.AXOBOARD_QA_REVIEWER;
const approvedRoot = value('--approved-root') || resolve('tests/apple-qa/baselines/approved');
const dryRun = args.includes('--dry-run');

if (!manifestPath) {
  console.error('Usage: npm run qa:apple:baseline:approve -- --manifest <proposal.json> --reviewer <independent-name> [--dry-run]');
  process.exitCode = 2;
} else {
  try {
    const result = await approveBaselineProposal({ manifestPath, reviewer, approvedRoot, dryRun });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
