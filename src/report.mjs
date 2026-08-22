import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}

async function fileRecord(path, root) {
  const [buffer, details] = await Promise.all([readFile(path), stat(path)]);
  return {
    path: relative(root, path),
    bytes: details.size,
    sha256: createHash('sha256').update(buffer).digest('hex')
  };
}

function severityCounts(findings) {
  return ['P0', 'P1', 'P2', 'P3'].reduce((counts, severity) => ({ ...counts, [severity]: findings.filter((finding) => finding.severity === severity).length }), {});
}

function htmlDocument(report) {
  const rows = report.results.map((result) => {
    const counts = severityCounts(result.findings);
    const screenshot = result.artifacts?.screenshot ? `<a href="${escapeHtml(result.artifacts.screenshot)}">screenshot</a>` : '—';
    return `<tr><td>${escapeHtml(result.browserEngine)}</td><td>${escapeHtml(result.routeId)}</td><td>${escapeHtml(result.state)}</td><td>${escapeHtml(result.theme)}</td><td>${escapeHtml(result.viewport.id)}</td><td>${result.status ?? '—'}</td><td>${counts.P0}</td><td>${counts.P1}</td><td>${counts.P2}</td><td>${escapeHtml(result.rubric.score.toFixed(1))}</td><td>${escapeHtml(result.rubric.expertReviewStatus)}</td><td>${screenshot}</td></tr>`;
  }).join('');
  const findingRows = report.findings.map((finding) => `<tr><td><b>${escapeHtml(finding.severity)}</b></td><td>${escapeHtml(finding.rule)}</td><td>${escapeHtml(finding.browserEngine)} / ${escapeHtml(finding.route)} / ${escapeHtml(finding.state)} / ${escapeHtml(finding.theme)} / ${escapeHtml(finding.viewport)}</td><td>${escapeHtml(finding.message)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AxoBoard Apple QA report</title><style>
body{margin:0;padding:32px;color:#172033;background:#f5f7fb;font:15px/1.5 system-ui,sans-serif}main{max-width:1500px;margin:auto}.card{margin:20px 0;padding:24px;border:1px solid #d8deea;border-radius:16px;background:white;box-shadow:0 12px 35px #14213d12}h1,h2{letter-spacing:-.025em}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #e8ebf2;text-align:left;vertical-align:top}th{font-size:12px;letter-spacing:.08em;color:#53617a}.pass{color:#087847}.fail{color:#b42318}code{padding:2px 5px;background:#edf1f7;border-radius:5px}@media(max-width:800px){body{padding:16px}.card{overflow:auto;padding:16px}}
</style></head><body><main><h1>AxoBoard Apple-level QA gate</h1><section class="card"><h2 class="${report.summary.passed ? 'pass' : 'fail'}">${report.summary.passed ? 'PASS' : 'BLOCKED'}</h2><p>Target: <code>${escapeHtml(report.metadata.target)}</code> · Mode: <code>${escapeHtml(report.metadata.mode)}</code> · ${report.results.length} browser/route/state/theme/viewport checks</p><p>P0 ${report.summary.severity.P0} · P1 ${report.summary.severity.P1} · P2 ${report.summary.severity.P2} · P3 ${report.summary.severity.P3}</p><p>Qualitative scores are evidence-backed proxies until independently reviewed. They never override hard failures.</p></section><section class="card"><h2>Route/state matrix</h2><table><thead><tr><th>Browser</th><th>Route</th><th>State</th><th>Theme</th><th>Viewport</th><th>HTTP</th><th>P0</th><th>P1</th><th>P2</th><th>Score</th><th>Review</th><th>Artifact</th></tr></thead><tbody>${rows}</tbody></table></section><section class="card"><h2>Findings</h2>${findingRows ? `<table><thead><tr><th>Severity</th><th>Rule</th><th>Surface</th><th>Evidence summary</th></tr></thead><tbody>${findingRows}</tbody></table>` : '<p>No findings.</p>'}</section></main></body></html>`;
}

function reviewTemplate(report) {
  return {
    schemaVersion: 2,
    kind: 'axoboard-expert-review-attestation',
    candidateSha: report.metadata.candidateSha,
    targetOrigin: report.metadata.origin.startsWith('http') ? report.metadata.origin : '',
    captureActor: report.metadata.captureActor || '',
    reviewerId: '',
    capturedAt: report.metadata.generatedAt,
    reviewedAt: '',
    reviews: report.results.map((result) => ({
      routeId: result.routeId,
      state: result.state,
      theme: result.theme,
      viewport: result.viewport.id,
      browserEngine: result.browserEngine,
      approved: false,
      artifacts: {
        screenshotSha256: result.artifacts?.screenshotSha256 || '',
        repeatScreenshotSha256: result.artifacts?.repeatScreenshotSha256 || ''
      },
      dimensions: result.rubric.dimensions.map((dimension) => ({ id: dimension.id, score: null, evidence: '' }))
    })),
    attestation: {
      algorithm: 'Ed25519',
      keyId: '',
      payloadSha256: '',
      signature: ''
    }
  };
}

export async function writeAuditReport({ outputRoot, metadata, results, summary, baselineProposal = null }) {
  await mkdir(outputRoot, { recursive: true });
  const findings = results.flatMap((result) => result.findings);
  const report = { schemaVersion: 1, kind: 'axoboard-apple-qa-report', metadata, summary, results, findings, baselineProposal: baselineProposal ? relative(outputRoot, baselineProposal.manifestPath) : null };
  await Promise.all([
    writeFile(join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`),
    writeFile(join(outputRoot, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`),
    writeFile(join(outputRoot, 'report.html'), htmlDocument(report)),
    writeFile(join(outputRoot, 'expert-review-template.json'), `${JSON.stringify(reviewTemplate(report), null, 2)}\n`)
  ]);
  const artifactFiles = (await walk(outputRoot)).filter((path) => basename(path) !== 'artifact-manifest.json');
  const artifacts = await Promise.all(artifactFiles.sort().map((path) => fileRecord(path, outputRoot)));
  const manifest = {
    schemaVersion: 1,
    kind: 'axoboard-apple-qa-artifact-manifest',
    generatedAt: new Date().toISOString(),
    candidateSha: metadata.candidateSha,
    requiredBrowserEngines: metadata.requiredBrowserEngines,
    executedBrowserEngines: [...new Set(results.map((result) => result.browserEngine))].sort(),
    browserCoverage: summary.browserCoverage,
    report: 'report.json',
    passed: summary.passed,
    artifacts
  };
  await writeFile(join(outputRoot, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { report, manifest };
}
