export const RELEASE_REPOSITORY = 'lmonsonstrategies/axoboard';
export const RELEASE_BRANCH_PATTERN = /^(?:feat|fix|release)\/[a-z0-9][a-z0-9._/-]*$/;
export const RELEASE_WORKFLOW = Object.freeze({
  name: 'AxoBoard release gate',
  file: 'ci.yml',
  path: '.github/workflows/ci.yml',
  event: 'push'
});
export const RAILWAY_PRODUCTION = Object.freeze({
  project: 'e1d54bb6-1a73-49a5-b412-ee2129022c4a',
  environment: '7423fc77-cee2-4f6a-bd2e-f87f7b8fd37c',
  service: 'cc02786e-2896-44b4-b78c-5b0a8ca26b78',
  repository: RELEASE_REPOSITORY,
  branch: 'main'
});

const FAILED_RAILWAY_STATUSES = new Set(['CANCELED', 'CANCELLED', 'CRASHED', 'FAILED', 'REMOVED', 'SKIPPED', 'SUPERSEDED']);

function railwayCreatedAt(value) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) return NaN;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return NaN;
  return new Date(timestamp).toISOString() === value ? timestamp : NaN;
}

function sameRepository(actual, expected) {
  return typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();
}

export function isReleaseBranch(branch) {
  return RELEASE_BRANCH_PATTERN.test(String(branch || ''));
}

export function isExpectedOriginUrl(remoteUrl, repository = RELEASE_REPOSITORY) {
  const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(?:git@(?:github\\.com|github-personal|ssh\\.github\\.com):|ssh://git@ssh\\.github\\.com(?::443)?/)${escaped}\\.git$`, 'i')
    .test(String(remoteUrl || ''));
}

export function isExpectedReleaseWorkflowRun(run, { repository = RELEASE_REPOSITORY, sha, branch, workflowId }) {
  return Boolean(
    run
    && Number.isInteger(workflowId)
    && workflowId > 0
    && run.workflow_id === workflowId
    && run.name === RELEASE_WORKFLOW.name
    && run.path === RELEASE_WORKFLOW.path
    && run.event === RELEASE_WORKFLOW.event
    && run.head_sha === sha
    && run.head_branch === branch
    && sameRepository(run.repository?.full_name, repository)
    && sameRepository(run.head_repository?.full_name, repository)
  );
}

export function isSuccessfulReleaseWorkflowRun(run, candidate) {
  return isExpectedReleaseWorkflowRun(run, candidate)
    && run.status === 'completed'
    && run.conclusion === 'success';
}

export function findExpectedReleaseWorkflowRun(runs, candidate) {
  return runs.find((run) => isExpectedReleaseWorkflowRun(run, candidate)) || null;
}

export function evaluateRailwayDeployment(deployments, {
  sha,
  excludedDeploymentIds = [],
  deploymentId = null,
  production = RAILWAY_PRODUCTION
}) {
  if (!Array.isArray(deployments)) return { state: 'failed', reason: 'Railway deployment response is not an array' };
  const excluded = new Set(excludedDeploymentIds);

  const unseen = deployments
    .filter((deployment) => !excluded.has(deployment?.id))
    .map((deployment) => ({ deployment, createdAt: railwayCreatedAt(deployment?.createdAt) }));
  const malformed = unseen.find(({ createdAt }) => !Number.isFinite(createdAt));
  if (malformed) {
    return { state: 'failed', reason: `Railway deployment ${malformed.deployment?.id || '<unknown>'} has an invalid creation timestamp` };
  }
  const recent = unseen.sort((left, right) => right.createdAt - left.createdAt);
  if (recent.length === 0) return { state: 'waiting' };
  if (recent.length > 1 && recent[0].createdAt === recent[1].createdAt && recent[0].deployment?.id !== recent[1].deployment?.id) {
    return { state: 'failed', reason: 'Railway returned multiple deployments with an ambiguous newest timestamp' };
  }

  const latest = recent[0].deployment;
  if (deploymentId && latest.id !== deploymentId) {
    return { state: 'failed', reason: `Railway deployment ${deploymentId} was superseded by ${latest.id || '<unknown>'}` };
  }

  const identityMatches = (
    typeof latest.id === 'string'
    && latest.id.length > 0
    && latest.meta?.repo?.toLowerCase() === production.repository.toLowerCase()
    && latest.meta?.branch === production.branch
    && latest.meta?.commitHash === sha
    && latest.meta?.buildOnly === false
  );
  if (!identityMatches) {
    return { state: 'failed', reason: `latest Railway deployment ${latest.id || '<unknown>'} does not match the production release identity` };
  }

  const status = String(latest.status || '').toUpperCase();
  if (status === 'SUCCESS') return { state: 'succeeded', deployment: latest };
  if (FAILED_RAILWAY_STATUSES.has(status)) {
    return { state: 'failed', reason: `Railway deployment ${latest.id} entered terminal status ${status}` };
  }
  return { state: 'waiting', deployment: latest };
}

export function isExpectedProductionHealth(health, sha) {
  return Boolean(
    health
    && health.ok === true
    && typeof health.version === 'string'
    && health.version.startsWith(sha)
  );
}
