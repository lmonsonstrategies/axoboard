#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, firefox, webkit } from '@playwright/test';
import { createFinding } from './detectors.mjs';
import { loadConfig, materializeRoutes, projectRoot, resolveChromiumExecutable, validateBaseUrl } from './config.mjs';
import { loadHumanEvidence } from './evidence.mjs';
import { startFixtureServer } from './fixture-server.mjs';
import { startLocalProductServer } from './local-server.mjs';
import { runPageAudit } from './page-audit.mjs';
import { scoreQualitativeRubric, validateExpertReview } from './qualitative-rubric.mjs';
import { writeAuditReport } from './report.mjs';
import { assessApprovedBaseline, compareRuntimeStability, screenshotName, writeBaselineProposal } from './visual-baselines.mjs';

const allowedTargets = new Set(['local', 'fixture', 'fixture-bad', 'url']);
const allowedModes = new Set(['gate', 'diagnostic', 'harness']);
const browserTypes = { chromium, firefox, webkit };
const execFileAsync = promisify(execFile);

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
    browserEngines: [],
    outputRoot: resolve(projectRoot, 'reports/runs', new Date().toISOString().replace(/[:.]/g, '-')),
    approvedRoot: resolve(projectRoot, 'tests/apple-qa/baselines/approved'),
    baseUrl: process.env.AXOBOARD_BASE_URL || null,
    reason: '',
    proposer: process.env.AXOBOARD_QA_PROPOSER || '',
    expertReviewPath: null,
    humanEvidencePath: null,
    candidateSha: process.env.AXOBOARD_CANDIDATE_SHA || process.env.GITHUB_SHA || null
  };
  const takesValue = new Set(['--target', '--mode', '--base-url', '--output', '--approved-root', '--route', '--viewport', '--theme', '--browser', '--reason', '--proposer', '--expert-review', '--human-evidence', '--candidate-sha']);
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
      if (argument === '--browser') options.browserEngines.push(...splitValues(value));
      if (argument === '--reason') options.reason = value;
      if (argument === '--proposer') options.proposer = value;
      if (argument === '--expert-review') options.expertReviewPath = resolve(value);
      if (argument === '--human-evidence') options.humanEvidencePath = resolve(value);
      if (argument === '--candidate-sha') options.candidateSha = value;
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
  if (options.candidateSha && !/^[0-9a-f]{40}$/.test(options.candidateSha)) throw new Error('--candidate-sha must be an exact lowercase 40-character Git SHA.');
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
    '  --browser <engines>    Diagnostic-only subset; gate/harness require Chromium, Firefox, and WebKit',
    '',
    'Evidence and policy:',
    '  --mode gate|diagnostic|harness',
    '  --no-baselines         Diagnostic/harness only; skips approved baseline comparison',
    '  --propose-baselines    Stage candidates; never overwrites approved baselines',
    '  --reason <text>        Required proposal reason',
    '  --proposer <identity>  Required proposal author; cannot self-approve',
    '  --expert-review <json> Independent route/state review bundle',
    '  --human-evidence <json> Reviewed disposable-tenant evidence for authenticated app/TV states',
    '  --candidate-sha <sha>  Exact candidate SHA; defaults to GITHUB_SHA or the checked-out HEAD',
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

export function resolveBrowserEngines(config, options) {
  const required = [...config.browserEngines];
  const requested = options.browserEngines?.length ? [...new Set(options.browserEngines)] : required;
  for (const engine of requested) if (!required.includes(engine)) throw new Error(`Unknown or unapproved browser engine: ${engine}.`);
  const omitted = required.filter((engine) => !requested.includes(engine));
  if (omitted.length && ['gate', 'harness'].includes(options.mode)) throw new Error(`${options.mode} mode cannot omit required browser engines: ${omitted.join(', ')}.`);
  return requested;
}

export function assessBrowserCoverage(requiredEngines, planLength, results, failures = []) {
  const counts = Object.fromEntries(requiredEngines.map((engine) => [engine, results.filter((result) => result.browserEngine === engine).length]));
  const missingOrIncomplete = requiredEngines.filter((engine) => counts[engine] !== planLength);
  const failedEngines = failures.map((failure) => failure.browserEngine);
  return {
    required: requiredEngines,
    expectedChecksPerEngine: planLength,
    counts,
    failures,
    missingOrIncomplete,
    complete: missingOrIncomplete.length === 0 && failedEngines.length === 0
  };
}

async function resolveCandidateSha(candidate) {
  if (candidate) return candidate;
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });
  const sha = stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Could not resolve an exact candidate Git SHA.');
  return sha;
}

function launchOptions(browserEngine) {
  if (browserEngine !== 'chromium') return { headless: true };
  const executablePath = resolveChromiumExecutable();
  return {
    ...(executablePath ? { executablePath } : {}),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  };
}

async function loadExpertReviews(path) {
  if (!path) return [];
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  return Array.isArray(parsed) ? parsed : parsed.reviews || [parsed];
}

function matchingReview(reviews, entry, browserEngine) {
  return reviews.find((review) => review.routeId === entry.route.id && review.state === entry.route.state && review.theme === entry.theme && review.viewport === entry.viewport.id && review.browserEngine === browserEngine) || null;
}

function pathWithTheme(routePath, theme, target) {
  if (!target.startsWith('fixture')) return routePath;
  const url = new URL(routePath, 'http://fixture.invalid');
  url.searchParams.set('theme', theme);
  return `${url.pathname}${url.search}`;
}

function expectedBadRules(findings, browserEngines) {
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
  const missingByEngine = Object.fromEntries(browserEngines.map((browserEngine) => {
    const rules = new Set(findings.filter((finding) => finding.browserEngine === browserEngine).map((finding) => finding.rule));
    return [browserEngine, required.filter((rule) => !rules.has(rule))];
  }));
  return { required, missingByEngine, missing: Object.entries(missingByEngine).flatMap(([browserEngine, rules]) => rules.map((rule) => `${browserEngine}:${rule}`)) };
}

function severityCounts(findings) {
  return ['P0', 'P1', 'P2', 'P3'].reduce((counts, severity) => ({ ...counts, [severity]: findings.filter((finding) => finding.severity === severity).length }), {});
}

function findingContext(result) {
  return { route: result.routeId, state: result.state, theme: result.theme, viewport: result.viewport.id, browserEngine: result.browserEngine };
}

async function resolveTarget(options, config) {
  if (options.baseUrl) return { origin: validateBaseUrl(options.baseUrl, config.allowedBaseUrls), close: async () => {}, kind: 'provided-url' };
  if (options.target.startsWith('fixture')) return { ...await startFixtureServer(), kind: 'fixture-server' };
  return { ...await startLocalProductServer(projectRoot), kind: 'local-product-server' };
}

export async function runAudit(options, suppliedConfig = null) {
  const config = suppliedConfig || await loadConfig();
  const plan = buildPlan(config, options);
  const browserEngines = resolveBrowserEngines(config, options);
  const inventory = {
    schemaVersion: 1,
    target: options.target,
    mode: options.mode,
    browserEngines,
    entries: plan.map(({ route, theme, viewport }) => ({ routeId: route.id, path: route.path, surface: route.surface, state: route.state, theme, viewport: viewport.id, size: `${viewport.width}x${viewport.height}`, baselineRequired: route.baselineRequired })),
    humanOnlyScenarios: config.humanOnlyScenarios
  };
  if (options.list || options.dryRun) return { inventory, dryRun: true };

  await mkdir(options.outputRoot, { recursive: true });
  const candidateSha = await resolveCandidateSha(options.candidateSha);
  const server = await resolveTarget(options, config);
  const results = [];
  const baselineRecords = [];
  const browserFailures = [];
  let humanEvidence = null;
  let reviews = [];
  let humanBlockerAdded = false;
  try {
    reviews = await loadExpertReviews(options.expertReviewPath);
    humanEvidence = await loadHumanEvidence({
      evidencePath: options.humanEvidencePath,
      requiredScenarios: config.humanOnlyScenarios,
      expectedCandidateSha: candidateSha,
      expectedTargetOrigin: server.origin,
      policy: config.evidencePolicy
    });
    for (const browserEngine of browserEngines) {
      let browser = null;
      try {
        browser = await browserTypes[browserEngine].launch(launchOptions(browserEngine));
        for (const entry of plan) {
          const context = await browser.newContext({
            viewport: { width: entry.viewport.width, height: entry.viewport.height },
            deviceScaleFactor: entry.viewport.dpr,
            ...(browserEngine === 'firefox' ? {} : { isMobile: entry.viewport.width < 640 }),
            hasTouch: entry.viewport.width < 1024,
            locale: 'en-US',
            timezoneId: 'America/Denver',
            colorScheme: entry.theme,
            reducedMotion: 'no-preference',
            serviceWorkers: 'block'
          });
          try {
            const page = await context.newPage();
            const route = { ...entry.route, path: pathWithTheme(entry.route.path, entry.theme, options.target) };
            const result = await runPageAudit({ page, requestContext: context.request, route, viewport: entry.viewport, theme: entry.theme, browserEngine, config, baseOrigin: server.origin, checkLinks: options.checkLinks });
            result.browserEngine = browserEngine;
            if (!humanBlockerAdded && options.mode === 'gate' && config.humanOnlyScenarios.length && !humanEvidence) {
              result.findings.push(createFinding({
                rule: 'coverage.authenticated-states-unverified', severity: 'P1', ...findingContext(result),
                source: 'governance', message: 'Authenticated app and paired-TV critical states require cryptographically verified evidence from a disposable non-production tenant.',
                evidence: { requiredScenarios: config.humanOnlyScenarios.map((scenario) => ({ id: scenario.id, type: scenario.type, matrixCells: scenario.requiredMatrix.length, blocker: scenario.blocker })), template: 'config/authenticated-evidence.template.json' }
              }));
              humanBlockerAdded = true;
            }
            await page.evaluate(() => {
              window.scrollTo(0, 0);
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            });
            await page.waitForTimeout(80);
            const identity = { routeId: entry.route.id, state: entry.route.state, theme: entry.theme, viewport: entry.viewport.id, browserEngine };
            const name = screenshotName(identity);
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
                identity,
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
            const expertReview = matchingReview(reviews, entry, browserEngine);
            if (expertReview) validateExpertReview(expertReview, result, config.qualityPolicy);
            result.rubric = scoreQualitativeRubric(result, config.qualityPolicy, expertReview);
            if (options.mode === 'gate' && config.qualityPolicy.expertReviewRequired && !expertReview) {
              result.findings.push(createFinding({
                rule: 'qualitative.expert-review-missing', severity: 'P1', ...findingContext(result),
                source: 'governance', message: 'Apple-level acceptance requires an independent evidence-backed review for this exact route/state/theme/viewport/browser engine.',
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
          } finally {
            await context.close();
          }
        }
      } catch (error) {
        browserFailures.push({ browserEngine, message: String(error.message || error).slice(0, 500) });
      } finally {
        await browser?.close().catch(() => {});
      }
    }
  } finally {
    await server.close();
  }

  const allFindings = results.flatMap((result) => result.findings);
  const severity = severityCounts(allFindings);
  const hardFailures = allFindings.filter((finding) => config.failOn.includes(finding.severity));
  const premiumFailures = results.filter((result) => !result.rubric.eligibleForPremium);
  const badFixture = expectedBadRules(allFindings, browserEngines);
  const expectedFailureSatisfied = options.expectFailure && hardFailures.length > 0 && badFixture.missing.length === 0;
  const browserCoverage = assessBrowserCoverage(browserEngines, plan.length, results, browserFailures);
  const passed = options.expectFailure
    ? expectedFailureSatisfied && browserCoverage.complete
    : browserCoverage.complete && hardFailures.length === 0 && (options.mode !== 'gate' || premiumFailures.length === 0);
  const summary = {
    passed,
    expectedFailure: options.expectFailure,
    expectedFailureSatisfied,
    missingExpectedBadRules: options.expectFailure ? badFixture.missing : [],
    missingExpectedBadRulesByEngine: options.expectFailure ? badFixture.missingByEngine : {},
    severity,
    hardFailureCount: hardFailures.length,
    premiumFailureCount: premiumFailures.length,
    checkCount: results.length,
    browserCoverage
  };
  const proposal = await writeBaselineProposal(baselineRecords, options.outputRoot, { target: options.target, mode: options.mode, reason: options.reason, proposer: options.proposer });
  const metadata = {
    generatedAt: new Date().toISOString(),
    target: options.target,
    mode: options.mode,
    origin: server.kind === 'provided-url' ? server.origin : `${server.kind}:ephemeral`,
    candidateSha,
    requiredBrowserEngines: browserEngines,
    baselinePolicy: options.noBaselines ? 'runtime-stability-only' : (options.proposeBaselines ? 'candidate-proposal-pending-review' : 'approved-baselines-required'),
    hardFailurePolicy: config.failOn,
    qualitativeScoreCannotOverrideHardFailures: true,
    humanAuthenticatedEvidence: humanEvidence
      ? humanEvidence
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
