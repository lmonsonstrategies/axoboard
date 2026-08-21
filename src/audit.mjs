#!/usr/bin/env node
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createFinding } from './detectors.mjs';
import { loadConfig, materializeRoutes, projectRoot, resolveChromiumExecutable, validateBaseUrl } from './config.mjs';
import { startFixtureServer } from './fixture-server.mjs';
import { startLocalProductServer } from './local-server.mjs';
import { runPageAudit } from './page-audit.mjs';
import { scoreQualitativeRubric, validateExpertReview } from './qualitative-rubric.mjs';
import { writeAuditReport } from './report.mjs';
import { assessApprovedBaseline, compareRuntimeStability, screenshotName, writeBaselineProposal } from './visual-baselines.mjs';

const allowedTargets = new Set(['local', 'fixture', 'fixture-bad', 'url']);
const allowedModes = new Set(['gate', 'diagnostic', 'harness']);

function splitValues(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

export function parseArguments(argv) {
  const options = {
    target: 'local',
    mode: 'gate',
    quick: false,
    list: false,
    dryRun: false,
    checkLinks: false,
    noBaselines: false,
    proposeBaselines: false,
    expectFailure: false,
    routeIds: [],
    viewportIds: [],
    themes: [],
    outputRoot: resolve(projectRoot, 'reports/runs', new Date().toISOString().replace(/[:.]/g, '-')),
    approvedRoot: resolve(projectRoot, 'tests/apple-qa/baselines/approved'),
    baseUrl: process.env.AXOBOARD_BASE_URL || null,
    reason: '',
    proposer: process.env.AXOBOARD_QA_PROPOSER || '',
    expertReviewPath: null,
    humanEvidencePath: null
  };
  const takesValue = new Set(['--target', '--mode', '--base-url', '--output', '--approved-root', '--route', '--viewport', '--theme', '--reason', '--proposer', '--expert-review', '--human-evidence']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (takesValue.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === '--target') options.target = value;
      if (argument === '--mode') options.mode = value;
      if (argument === '--base-url') options.baseUrl = value;
      if (argument === '--output') options.outputRoot = resolve(value);
      if (argument === '--approved-root') options.approvedRoot = resolve(value);
      if (argument === '--route') options.routeIds.push(...splitValues(value));
      if (argument === '--viewport') options.viewportIds.push(...splitValues(value));
      if (argument === '--theme') options.themes.push(...splitValues(value));
      if (argument === '--reason') options.reason = value;
      if (argument === '--proposer') options.proposer = value;
      if (argument === '--expert-review') options.expertReviewPath = resolve(value);
      if (argument === '--human-evidence') options.humanEvidencePath = resolve(value);
      continue;
    }
    if (argument === '--quick') options.quick = true;
    else if (argument === '--list') options.list = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--check-links') options.checkLinks = true;
    else if (argument === '--no-baselines') options.noBaselines = true;
    else if (argument === '--propose-baselines') options.proposeBaselines = true;
    else if (argument === '--expect-failure') options.expectFailure = true;
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!allowedTargets.has(options.target)) throw new Error(`Unknown target: ${options.target}`);
  if (!allowedModes.has(options.mode)) throw new Error(`Unknown mode: ${options.mode}`);
  if (options.target === 'url' && !options.baseUrl) throw new Error('--target url requires --base-url.');
  if (options.proposeBaselines && options.noBaselines) throw new Error('--propose-baselines cannot be combined with --no-baselines.');
  if (options.mode === 'gate' && options.noBaselines) throw new Error('--no-baselines is prohibited in gate mode. Use diagnostic or harness mode.');
  if (options.proposeBaselines && (!options.reason.trim() || !options.proposer.trim())) throw new Error('--propose-baselines requires --reason and --proposer (or AXOBOARD_QA_PROPOSER).');
  return options;
}

function helpText() {
  return [
    'AxoBoard Apple-level QA gate',
    '',
    'Usage:',
    '  node src/audit.mjs --target local|fixture|fixture-bad|url [options]',
    '',
    'Inventory:',
    '  --list                 Print route/state/theme/viewport inventory without launching a browser',
    '  --dry-run              Validate and print the selected execution plan',
    '  --quick                Checkpoint routes and canonical viewports only',
    '  --route <a,b>          Limit route IDs',
    '  --viewport <a,b>       Limit viewport IDs',
    '  --theme <light,dark>   Limit supported themes',
    '',
    'Evidence and policy:',
    '  --mode gate|diagnostic|harness',
    '  --no-baselines         Diagnostic/harness only; skips approved baseline comparison',
    '  --propose-baselines    Stage candidates; never overwrites approved baselines',
    '  --reason <text>        Required proposal reason',
    '  --proposer <identity>  Required proposal author; cannot self-approve',
    '  --expert-review <json> Independent route/state review bundle',
    '  --human-evidence <json> Reviewed disposable-tenant evidence for authenticated app/TV states',
    '  --expect-failure       Pass only when the deliberate bad fixture triggers required hard gates',
    '  --output <directory>   Artifact destination (default unique reports/runs directory)',
    ''
  ].join('\n');
}

function routesForTarget(config, target) {
  if (target === 'fixture') return config.fixtureRoutes;
  if (target === 'fixture-bad') return config.badFixtureRoutes;
  return materializeRoutes(config);
}

export function buildPlan(config, options) {
  const allViewportIds = new Set(config.viewports.map((viewport) => viewport.id));
  const requestedViewports = new Set(options.viewportIds);
  const requestedRoutes = new Set(options.routeIds);
  const requestedThemes = new Set(options.themes);
  const canonical = new Set(config.canonicalScreenshotViewports);
  const routes = routesForTarget(config, options.target).filter((route) => {
    if (requestedRoutes.size && !requestedRoutes.has(route.id)) return false;
    return !options.quick || route.checkpoint;
  });
  const entries = [];
  for (const route of routes) {
    for (const theme of route.themes) {
      if (requestedThemes.size && !requestedThemes.has(theme)) continue;
      for (const viewportId of route.viewports) {
        if (!allViewportIds.has(viewportId)) throw new Error(`Route ${route.id} references unknown viewport ${viewportId}.`);
        if (requestedViewports.size && !requestedViewports.has(viewportId)) continue;
        if (options.quick && !canonical.has(viewportId)) continue;
        entries.push({ route, theme, viewport: config.viewports.find((viewport) => viewport.id === viewportId) });
      }
    }
  }
  if (!entries.length) throw new Error('Selection produced an empty QA plan.');
  return entries;
}

async function loadExpertReviews(path) {
  if (!path) return [];
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  return Array.isArray(parsed) ? parsed : parsed.reviews || [parsed];
}

async function loadHumanEvidence(path, requiredScenarios) {
  if (!path) return null;
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (parsed.kind !== 'axoboard-human-authenticated-qa-evidence' || !parsed.reviewer || !parsed.reviewedAt || parsed.environment !== 'disposable-non-production') {
    throw new Error('Human evidence requires kind, reviewer, reviewedAt, and environment=disposable-non-production.');
  }
  for (const required of requiredScenarios || []) {
    const scenario = (parsed.scenarios || []).find((candidate) => candidate.id === required.id);
    if (!scenario?.passed || !scenario.artifactManifest) throw new Error(`Human evidence is incomplete for ${required.id}.`);
    const manifestPath = resolve(dirname(path), scenario.artifactManifest);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.kind !== 'axoboard-apple-qa-artifact-manifest' || manifest.passed !== true) {
      throw new Error(`Authenticated evidence manifest did not pass for ${required.id}.`);
    }
  }
  return parsed;
}

function matchingReview(reviews, entry) {
  return reviews.find((review) => review.routeId === entry.route.id && review.state === entry.route.state && review.theme === entry.theme && review.viewport === entry.viewport.id) || null;
}

function pathWithTheme(routePath, theme, target) {
  if (!target.startsWith('fixture')) return routePath;
  const url = new URL(routePath, 'http://fixture.invalid');
  url.searchParams.set('theme', theme);
  return `${url.pathname}${url.search}`;
}

function expectedBadRules(findings) {
  const rules = new Set(findings.map((finding) => finding.rule));
  const required = [
    'layout.horizontal-overflow',
    'interaction.touch-target',
    'accessibility.missing-name',
    'accessibility.positive-tabindex',
    'accessibility.invisible-focus',
    'motion.reduced-motion-parity',
    'structure.main-landmark',
    'structure.single-h1',
    'runtime.console-error',
    'safety.mutation-attempt'
  ];
  return { required, missing: required.filter((rule) => !rules.has(rule)) };
}

function severityCounts(findings) {
  return ['P0', 'P1', 'P2', 'P3'].reduce((counts, severity) => ({ ...counts, [severity]: findings.filter((finding) => finding.severity === severity).length }), {});
}

function findingContext(result) {
  return { route: result.routeId, state: result.state, theme: result.theme, viewport: result.viewport.id };
}

async function resolveTarget(options, config) {
  if (options.baseUrl) return { origin: validateBaseUrl(options.baseUrl, config.allowedBaseUrls), close: async () => {}, kind: 'provided-url' };
  if (options.target.startsWith('fixture')) return { ...await startFixtureServer(), kind: 'fixture-server' };
  return { ...await startLocalProductServer(projectRoot), kind: 'local-product-server' };
}

export async function runAudit(options, suppliedConfig = null) {
  const config = suppliedConfig || await loadConfig();
  const plan = buildPlan(config, options);
  const inventory = {
    schemaVersion: 1,
    target: options.target,
    mode: options.mode,
    entries: plan.map(({ route, theme, viewport }) => ({ routeId: route.id, path: route.path, surface: route.surface, state: route.state, theme, viewport: viewport.id, size: `${viewport.width}x${viewport.height}`, baselineRequired: route.baselineRequired })),
    humanOnlyScenarios: config.humanOnlyScenarios
  };
  if (options.list || options.dryRun) return { inventory, dryRun: true };

  await mkdir(options.outputRoot, { recursive: true });
  const server = await resolveTarget(options, config);
  const executablePath = resolveChromiumExecutable();
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const reviews = await loadExpertReviews(options.expertReviewPath);
  const humanEvidence = await loadHumanEvidence(options.humanEvidencePath, config.humanOnlyScenarios);
  const results = [];
  const baselineRecords = [];
  try {
    for (const [entryIndex, entry] of plan.entries()) {
      const context = await browser.newContext({
        viewport: { width: entry.viewport.width, height: entry.viewport.height },
        deviceScaleFactor: entry.viewport.dpr,
        isMobile: entry.viewport.width < 640,
        hasTouch: entry.viewport.width < 1024,
        locale: 'en-US',
        timezoneId: 'America/Denver',
        colorScheme: entry.theme,
        reducedMotion: 'no-preference',
        serviceWorkers: 'block'
      });
      const page = await context.newPage();
      const route = { ...entry.route, path: pathWithTheme(entry.route.path, entry.theme, options.target) };
      const result = await runPageAudit({ page, requestContext: context.request, route, viewport: entry.viewport, theme: entry.theme, config, baseOrigin: server.origin, checkLinks: options.checkLinks });
      if (entryIndex === 0 && options.mode === 'gate' && config.humanOnlyScenarios.length && !humanEvidence) {
        result.findings.push(createFinding({
          rule: 'coverage.authenticated-states-unverified', severity: 'P1', ...findingContext(result),
          source: 'governance', message: 'Authenticated app and paired-TV critical states require reviewed evidence from a disposable non-production tenant.',
          evidence: { requiredScenarios: config.humanOnlyScenarios.map((scenario) => ({ id: scenario.id, blocker: scenario.blocker })), template: 'config/authenticated-evidence.template.json' }
        }));
      }
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await page.waitForTimeout(80);
      const name = screenshotName({ routeId: entry.route.id, state: entry.route.state, theme: entry.theme, viewport: entry.viewport.id });
      const screenshotPath = join(options.outputRoot, 'screenshots', name);
      const repeatPath = join(options.outputRoot, 'stability-repeat', name);
      const stabilityDiffPath = join(options.outputRoot, 'stability-diffs', name);
      await mkdir(join(options.outputRoot, 'screenshots'), { recursive: true });
      await mkdir(join(options.outputRoot, 'stability-repeat'), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled', caret: 'hide' });
      await page.waitForTimeout(80);
      await page.screenshot({ path: repeatPath, fullPage: true, animations: 'disabled', caret: 'hide' });
      const stability = await compareRuntimeStability({ currentPath: screenshotPath, repeatPath, diffPath: stabilityDiffPath, maximumDiffRatio: config.budgets.maximumScreenshotDiffRatio });
      if (!stability.stable) {
        result.findings.push(createFinding({
          rule: 'visual.screenshot-instability', severity: 'P1', ...findingContext(result),
          message: `Repeated deterministic captures differ by ${(stability.diffRatio * 100).toFixed(3)}%.`, evidence: stability,
          screenshot: relative(options.outputRoot, screenshotPath)
        }));
      }
      let baseline = null;
      if (entry.route.baselineRequired && !options.noBaselines) {
        baseline = await assessApprovedBaseline({
          identity: { routeId: entry.route.id, state: entry.route.state, theme: entry.theme, viewport: entry.viewport.id },
          currentPath: screenshotPath,
          approvedRoot: options.approvedRoot,
          outputRoot: options.outputRoot,
          propose: options.proposeBaselines,
          reason: options.reason,
          proposer: options.proposer
        });
        baselineRecords.push(baseline);
        if (!baseline.baselineExists || !baseline.matches) {
          result.findings.push(createFinding({
            rule: baseline.baselineExists ? 'visual.baseline-mismatch' : 'visual.baseline-missing',
            severity: 'P1',
            ...findingContext(result),
            message: baseline.candidate ? 'Visual change is staged for independent review; approved baseline is unchanged.' : (baseline.baselineExists ? 'Screenshot differs from the approved visual baseline.' : 'No approved visual baseline exists for this checkpoint.'),
            evidence: { approvedHash: baseline.approvedHash, currentHash: baseline.currentHash, diffRatio: baseline.comparison?.diffRatio ?? null, proposalState: baseline.candidate?.reviewState || null },
            screenshot: relative(options.outputRoot, screenshotPath)
          }));
        }
      }
      const expertReview = matchingReview(reviews, entry);
      if (expertReview) validateExpertReview(expertReview, result, config.qualityPolicy);
      result.rubric = scoreQualitativeRubric(result, config.qualityPolicy, expertReview);
      if (options.mode === 'gate' && config.qualityPolicy.expertReviewRequired && !expertReview) {
        result.findings.push(createFinding({
          rule: 'qualitative.expert-review-missing', severity: 'P1', ...findingContext(result),
          source: 'governance', message: 'Apple-level acceptance requires an independent evidence-backed review for this exact route/state/theme/viewport.',
          evidence: { reviewTemplate: 'expert-review-template.json' }
        }));
        result.rubric = scoreQualitativeRubric(result, config.qualityPolicy, null);
      }
      if (result.rubric.score < config.qualityPolicy.minimumQualitativeScore) {
        result.findings.push(createFinding({
          rule: 'qualitative.score-below-premium', severity: 'P2', ...findingContext(result),
          source: result.rubric.scoreType, message: `Qualitative score ${result.rubric.score} is below the premium threshold ${config.qualityPolicy.minimumQualitativeScore}.`,
          evidence: { score: result.rubric.score, minimum: config.qualityPolicy.minimumQualitativeScore }
        }));
      }
      result.rubric = scoreQualitativeRubric(result, config.qualityPolicy, expertReview);
      result.artifacts = {
        screenshot: relative(options.outputRoot, screenshotPath),
        repeatScreenshot: relative(options.outputRoot, repeatPath),
        stabilityDiff: stability.diffPath ? relative(options.outputRoot, stability.diffPath) : null,
        approvedBaseline: baseline?.baselineExists ? baseline.approvedPath : null,
        baselineDiff: baseline?.comparison?.diffPath ? relative(options.outputRoot, baseline.comparison.diffPath) : null
      };
      results.push(result);
      await context.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const allFindings = results.flatMap((result) => result.findings);
  const severity = severityCounts(allFindings);
  const hardFailures = allFindings.filter((finding) => config.failOn.includes(finding.severity));
  const premiumFailures = results.filter((result) => !result.rubric.eligibleForPremium);
  const badFixture = expectedBadRules(allFindings);
  const expectedFailureSatisfied = options.expectFailure && hardFailures.length > 0 && badFixture.missing.length === 0;
  const passed = options.expectFailure
    ? expectedFailureSatisfied
    : hardFailures.length === 0 && (options.mode !== 'gate' || premiumFailures.length === 0);
  const summary = {
    passed,
    expectedFailure: options.expectFailure,
    expectedFailureSatisfied,
    missingExpectedBadRules: options.expectFailure ? badFixture.missing : [],
    severity,
    hardFailureCount: hardFailures.length,
    premiumFailureCount: premiumFailures.length,
    checkCount: results.length
  };
  const proposal = await writeBaselineProposal(baselineRecords, options.outputRoot, { target: options.target, mode: options.mode, reason: options.reason, proposer: options.proposer });
  const metadata = {
    generatedAt: new Date().toISOString(),
    target: options.target,
    mode: options.mode,
    origin: server.kind === 'provided-url' ? server.origin : `${server.kind}:ephemeral`,
    baseCommit: '63877ddd82ba666ffcee80d0b6a0403e5b6e9aac',
    baselinePolicy: options.noBaselines ? 'runtime-stability-only' : (options.proposeBaselines ? 'candidate-proposal-pending-review' : 'approved-baselines-required'),
    hardFailurePolicy: config.failOn,
    qualitativeScoreCannotOverrideHardFailures: true,
    humanAuthenticatedEvidence: humanEvidence
      ? { status: 'reviewed', reviewer: humanEvidence.reviewer, reviewedAt: humanEvidence.reviewedAt }
      : { status: 'human-only-blocker', scenarios: config.humanOnlyScenarios }
  };
  await writeAuditReport({ outputRoot: options.outputRoot, metadata, results, summary, baselineProposal: proposal });
  return { inventory, results, summary, outputRoot: options.outputRoot };
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      console.log(helpText());
      return;
    }
    const result = await runAudit(options);
    if (result.dryRun) {
      console.log(JSON.stringify(result.inventory, null, 2));
      return;
    }
    console.log(JSON.stringify({ ok: result.summary.passed, summary: result.summary, artifacts: result.outputRoot }, null, 2));
    if (!result.summary.passed) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 2;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
