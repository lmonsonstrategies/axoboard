import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanWorkspace, validateManifest } from './provenance-scan.mjs';

const sourceRepo = 'https://github.com/example/approved-upstream.git';
const reviewedAt = '2026-08-21T12:00:00.000Z';

function write(root, path, content) {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function manifest(overrides = {}) {
  return {
    $schema: './manifest.schema.json',
    version: 1,
    allowedSources: [sourceRepo],
    entries: [],
    exceptions: [],
    ...overrides
  };
}

function writeManifest(root, value) {
  write(root, 'provenance/manifest.json', `${JSON.stringify(value, null, 2)}\n`);
}

const root = mkdtempSync(join(tmpdir(), 'axoboard-provenance-test-'));
try {
  write(root, 'src/reused.mjs', 'export const genericValue = 1;\n');
  writeManifest(root, manifest({
    entries: [{
      sourceRepo,
      sourceSha: 'a'.repeat(40),
      sourcePath: 'src/original.mjs',
      destinationPaths: ['src/reused.mjs'],
      extractionMethod: 'port',
      rationale: 'Reuse a provider-neutral algorithm.',
      genericContract: 'No customer identity or fixed provider data.',
      reviewedBy: 'Release gate',
      reviewedAt
    }]
  }));
  assert.deepEqual(validateManifest(root), [], 'full-SHA entries from an allowlisted source are accepted');

  writeManifest(root, manifest({ entries: [{
    sourceRepo,
    sourceSha: 'a'.repeat(7),
    sourcePath: 'src/original.mjs',
    destinationPaths: ['src/reused.mjs'],
    extractionMethod: 'copy',
    rationale: 'This entry intentionally has a short SHA.',
    genericContract: 'The malformed entry must fail closed.',
    reviewedBy: 'Release gate',
    reviewedAt
  }] }));
  assert.ok(validateManifest(root).some((error) => error.includes('full lowercase commit SHA')), 'short source SHAs are rejected');

  writeManifest(root, manifest({ entries: [{
    sourceRepo: 'https://github.com/example/not-approved.git',
    sourceSha: 'b'.repeat(40),
    sourcePath: 'src/original.mjs',
    destinationPaths: ['src/reused.mjs'],
    extractionMethod: 'concept',
    rationale: 'This source was never placed on the allowlist.',
    genericContract: 'Unapproved repositories must fail closed.',
    reviewedBy: 'Release gate',
    reviewedAt
  }] }));
  assert.ok(validateManifest(root).some((error) => error.includes('not in allowedSources')), 'unapproved source repositories are rejected');

  write(root, 'provenance/manifest.json', '{not-json\n');
  assert.ok(validateManifest(root)[0].includes('invalid JSON'), 'malformed provenance fails closed');
  writeManifest(root, { ...manifest(), unexpectedPolicy: true });
  assert.ok(validateManifest(root).some((error) => error.includes('unknown property unexpectedPolicy')), 'unknown manifest fields fail closed');

  const company = ['Mur', 'phy'].join('');
  const credentialLabel = ['api', 'key'].join('_');
  const credentialValue = ['gh', 'p_', '1234567890', '1234567890', '1234567890'].join('');
  const credentialDirectory = ['creden', 'tials'].join('');
  const tenantLabel = ['tenant', 'id'].join('_');
  const commissionTerm = ['comm', 'ission'].join('');
  const forbiddenText = [
    `${company} Door operational default`,
    `https://${company.toLowerCase()}dashboards.example.com/private`,
    `/home/example/.openclaw/workspace-${company.toLowerCase()}/.${credentialDirectory}/provider.env`,
    `${tenantLabel} = "tenant_123456789"`,
    `${credentialLabel} = "${credentialValue}"`,
    `${commissionTerm} formula is fixed`,
    'data-workspace-id="sample-empty"'
  ].join('\n');
  write(root, 'src/leaks.txt', `${forbiddenText}\n`);
  write(root, 'src/safe.html', '<button data-workspace-id="sample-empty">Choose</button>\n');
  write(root, `assets/${company.toLowerCase()}-logo.png`, Buffer.from([0, 1, 2, 3]));
  symlinkSync(join(root, 'src/leaks.txt'), join(root, 'src/leak-link.txt'));
  writeManifest(root, manifest());
  const leaked = scanWorkspace(root);
  const rules = new Set(leaked.violations.map((violation) => violation.rule));
  for (const rule of ['company-identity', 'company-domain', 'legacy-workspace-path', 'tenant-provider-id', 'credential-material', 'brand-asset', 'business-assumption', 'filesystem-boundary']) {
    assert.ok(rules.has(rule), `${rule} leakage is rejected`);
  }
  assert.equal(leaked.violations.some((violation) => violation.rule === 'tenant-provider-id' && violation.file.endsWith('safe.html')), false);

  write(root, 'scripts/provenance-scan.mjs', `${company} confidential tenant material\n`);
  const policyLeak = scanWorkspace(root);
  assert.ok(policyLeak.violations.some((violation) => violation.file === 'scripts/provenance-scan.mjs' && violation.rule === 'company-identity'),
    'provenance policy files are scanned and cannot exempt themselves');
  write(root, 'scripts/provenance-scan.mjs', 'export const policy = true;\n');

  const reusedContent = 'export const genericValue = 1;\n';
  writeManifest(root, manifest({
    exceptions: [{
      path: 'src/reused.mjs',
      sha256: digest(reusedContent),
      rules: ['company-identity'],
      rationale: 'Exercise denylist checks on manifest review metadata.',
      reviewedBy: `${company} reviewer`,
      reviewedAt
    }]
  }));
  const manifestPolicyLeak = scanWorkspace(root);
  assert.ok(manifestPolicyLeak.violations.some((violation) => violation.file === 'provenance/manifest.json' && violation.rule === 'company-identity'),
    'manifest policy metadata is scanned while structured paths remain SHA-pinned');
  writeManifest(root, manifest());

  const history = `${company} is named only in this reviewed historical record.\n`;
  write(root, 'docs/history.md', history);
  writeManifest(root, manifest({
    exceptions: [{
      path: 'docs/history.md',
      sha256: digest(history),
      rules: ['company-identity'],
      rationale: 'Preserve an exact historical review artifact.',
      reviewedBy: 'Release gate',
      reviewedAt
    }]
  }));
  const reviewed = scanWorkspace(root);
  assert.equal(reviewed.manifestErrors.length, 0);
  assert.equal(reviewed.violations.some((violation) => violation.file === 'docs/history.md' && violation.rule === 'company-identity'), false,
    'an exact content-SHA exception is honored');
  write(root, 'docs/history.md', `${history}changed\n`);
  const changed = scanWorkspace(root);
  assert.ok(changed.manifestErrors.some((error) => error.includes('sha256 does not match docs/history.md')));
  assert.ok(changed.violations.some((violation) => violation.file === 'docs/history.md' && violation.rule === 'company-identity'),
    'a changed exception fails closed and is scanned');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('AxoBoard provenance scanner test passed: denylist coverage, SHA-pinned source allowlist, exact exceptions, and malformed-manifest failure.');
