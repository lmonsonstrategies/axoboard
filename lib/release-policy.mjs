export const RELEASE_REPOSITORY = 'lmonsonstrategies/axoboard';
export const RELEASE_BRANCH_PATTERN = /^(?:feat|fix|release)\/[a-z0-9][a-z0-9._/-]*$/;
export const RELEASE_WORKFLOW = Object.freeze({
  name: 'AxoBoard release gate',
  file: 'ci.yml',
  path: '.github/workflows/ci.yml',
  event: 'push'
});

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
