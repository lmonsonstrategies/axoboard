import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  findExpectedReleaseWorkflowRun,
  isExpectedOriginUrl,
  isReleaseBranch,
  isSuccessfulReleaseWorkflowRun,
  RELEASE_REPOSITORY,
  RELEASE_WORKFLOW
} from '../lib/release-policy.mjs';

const repository = String(process.env.GITHUB_REPOSITORY || RELEASE_REPOSITORY);
assert.equal(repository.toLowerCase(), RELEASE_REPOSITORY, `release repository must be ${RELEASE_REPOSITORY}`);
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

async function githubJson(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'axoboard-release', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  assert.equal(response.status, 200, `GitHub Actions API returned ${response.status} for ${path}`);
  return response.json();
}

async function expectedWorkflow() {
  const workflow = await githubJson(`/actions/workflows/${encodeURIComponent(RELEASE_WORKFLOW.file)}`);
  assert.ok(Number.isInteger(workflow.id) && workflow.id > 0, 'release workflow id is invalid');
  assert.equal(workflow.name, RELEASE_WORKFLOW.name, 'release workflow name changed');
  assert.equal(workflow.path, RELEASE_WORKFLOW.path, 'release workflow path changed');
  assert.equal(workflow.state, 'active', 'release workflow must be active');
  return workflow;
}

async function githubRuns(workflowId, sha, branch) {
  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/${workflowId}/runs`);
  url.searchParams.set('head_sha', sha);
  url.searchParams.set('branch', branch);
  url.searchParams.set('event', RELEASE_WORKFLOW.event);
  url.searchParams.set('per_page', '20');
  const response = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'axoboard-release', 'X-GitHub-Api-Version': '2022-11-28' }
  });
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
assert.ok(isReleaseBranch(branch), `release from feat/*, fix/*, or release/*; current branch is ${branch}`);
assert.equal(run('git', ['status', '--porcelain']), '', 'worktree must be clean before release');
assert.ok(isExpectedOriginUrl(run('git', ['remote', 'get-url', 'origin']), repository), `origin must be the pinned ${repository} SSH repository`);
run('git', ['fetch', '--quiet', 'origin', 'main', branch]);
assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', 'origin/main', sha]).status, 0, 'release must fast-forward from origin/main');
assert.equal(run('git', ['rev-parse', `origin/${branch}`]), sha, `push ${branch} before release`);

const workflow = await expectedWorkflow();
const candidate = { repository, sha, branch, workflowId: workflow.id };
const featureRun = findExpectedReleaseWorkflowRun(await githubRuns(workflow.id, sha, branch), candidate);
assert.ok(featureRun, `no ${RELEASE_WORKFLOW.name} (${RELEASE_WORKFLOW.path}) push run found for ${branch}@${shortSha}`);
assert.equal(featureRun.status, 'completed', `feature CI is ${featureRun.status}: ${featureRun.html_url}`);
assert.equal(featureRun.conclusion, 'success', `feature CI concluded ${featureRun.conclusion}: ${featureRun.html_url}`);
assert.ok(isSuccessfulReleaseWorkflowRun(featureRun, candidate), 'feature CI identity or success contract did not match');
console.log(`Preflight passed: ${branch}@${shortSha}; ${featureRun.html_url}`);

if (!promote) {
  console.log('Dry run complete. Run `npm run release` to publish this exact SHA.');
  process.exit(0);
}

run('git', ['push', 'origin', `${sha}:refs/heads/main`], { stdio: 'inherit' });
console.log(`Promoted ${shortSha} to main.`);

await waitFor('main CI', async () => {
  const mainCandidate = { repository, sha, branch: 'main', workflowId: workflow.id };
  const item = findExpectedReleaseWorkflowRun(await githubRuns(workflow.id, sha, 'main'), mainCandidate);
  if (!item) return { done: false };
  if (item.status === 'completed' && item.conclusion !== 'success') return { failed: `${item.conclusion} (${item.html_url})` };
  return isSuccessfulReleaseWorkflowRun(item, mainCandidate) ? { done: true, value: item } : { done: false };
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
