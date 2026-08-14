import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';

const repository = process.env.GITHUB_REPOSITORY || 'lmonsonstrategies/axoboard';
const baseUrl = String(process.env.BASE_URL || 'https://axoboard.io').replace(/\/$/, '');
const pollMs = Number(process.env.RELEASE_POLL_MS || 10_000);
const timeoutMs = Number(process.env.RELEASE_TIMEOUT_MS || 20 * 60_000);
const promote = process.argv.includes('--promote');

function run(command, args, options = {}) {
  const output = execFileSync(command, args, { encoding: 'utf8', stdio: options.stdio || ['ignore', 'pipe', 'pipe'], ...options });
  return typeof output === 'string' ? output.trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubRuns(sha, branch = '') {
  const url = new URL(`https://api.github.com/repos/${repository}/actions/runs`);
  url.searchParams.set('head_sha', sha);
  if (branch) url.searchParams.set('branch', branch);
  url.searchParams.set('per_page', '20');
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'axoboard-release' } });
  assert.equal(response.status, 200, `GitHub Actions API returned ${response.status}`);
  return (await response.json()).workflow_runs || [];
}

async function waitFor(label, check) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result.done) return result.value;
    if (result.failed) throw new Error(`${label} failed: ${result.failed}`);
    console.log(`Waiting for ${label}...`);
    await sleep(pollMs);
  }
  throw new Error(`${label} did not finish within ${Math.round(timeoutMs / 60_000)} minutes`);
}

const branch = run('git', ['branch', '--show-current']);
const sha = run('git', ['rev-parse', 'HEAD']);
const shortSha = sha.slice(0, 7);
assert.match(branch, /^(feat|fix|release)\//, `release from feat/*, fix/*, or release/*; current branch is ${branch}`);
assert.equal(run('git', ['status', '--porcelain']), '', 'worktree must be clean before release');
run('git', ['fetch', '--quiet', 'origin', 'main', branch]);
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', sha]).status, 0, 'release must fast-forward from origin/main');
assert.equal(run('git', ['rev-parse', `origin/${branch}`]), sha, `push ${branch} before release`);

const featureRun = (await githubRuns(sha, branch)).find((item) => item.event === 'push' && item.status === 'completed');
assert.ok(featureRun, `no completed feature CI run found for ${shortSha}`);
assert.equal(featureRun.conclusion, 'success', `feature CI concluded ${featureRun.conclusion}: ${featureRun.html_url}`);
console.log(`Preflight passed: ${branch}@${shortSha}; ${featureRun.html_url}`);

if (!promote) {
  console.log('Dry run complete. Run `npm run release` to publish this exact SHA.');
  process.exit(0);
}

run('git', ['push', 'origin', `${sha}:refs/heads/main`], { stdio: 'inherit' });
console.log(`Promoted ${shortSha} to main.`);

await waitFor('main CI', async () => {
  const item = (await githubRuns(sha, 'main')).find((candidate) => candidate.event === 'push');
  if (!item) return { done: false };
  if (item.status === 'completed' && item.conclusion !== 'success') return { failed: `${item.conclusion} (${item.html_url})` };
  return item.status === 'completed' ? { done: true, value: item } : { done: false };
});

await waitFor('Railway production deployment', async () => {
  try {
    const response = await fetch(`${baseUrl}/healthz`, { cache: 'no-store' });
    if (!response.ok) return { done: false };
    const health = await response.json();
    return String(health.version || '').startsWith(sha) ? { done: true, value: health } : { done: false };
  } catch {
    return { done: false };
  }
});

const verification = spawnSync(process.execPath, ['scripts/verify-production.mjs'], {
  env: { ...process.env, BASE_URL: baseUrl, EXPECTED_SHA: sha },
  stdio: 'inherit'
});
assert.equal(verification.status, 0, 'production verification failed');
console.log(`Release complete: ${shortSha} is live and verified at ${baseUrl}.`);
