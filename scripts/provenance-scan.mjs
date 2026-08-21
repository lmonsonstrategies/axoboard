import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const POLICY_FILES = new Set([
  'provenance/manifest.json',
  'provenance/manifest.schema.json',
  'scripts/provenance-scan.mjs',
  'scripts/provenance-scan-test.mjs'
]);

const RULES = Object.freeze([
  { id: 'company-identity', patterns: [/\bmurphy(?:'s|\s+door|\s+dashboards?|\s+kombat)?\b/i] },
  { id: 'company-domain', patterns: [/\b(?:[a-z0-9-]+\.)*(?:murphydoor|murphydashboards)\.[a-z]{2,}\b/i] },
  {
    id: 'legacy-workspace-path',
    patterns: [/(?:^|[\\/])(?:home[\\/][^\s"'`\\/]+[\\/])?\.openclaw[\\/]workspace-murphy(?:[\\/][^\s"'`]*)?/i]
  },
  {
    id: 'tenant-provider-id',
    patterns: [
      /https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{20,}/i,
      /(?<!data-)\b(?:portal|spreadsheet|tenant|workspace)(?:[_-]?id|Id)\s*[:=]\s*["'][A-Za-z0-9_-]{8,}["']/i
    ]
  },
  {
    id: 'credential-material',
    patterns: [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
      /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/,
      /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com\b/i,
      /(?:^|[\\/])\.credentials[\\/]/i,
      /\b(?:client_secret|api_key|access_token|refresh_token)\s*[:=]\s*["'][^"'\s]{12,}["']/i
    ]
  },
  {
    id: 'brand-asset',
    patterns: [/\bmurphy[^\n]{0,80}\.(?:avif|gif|jpe?g|png|svg|webp|woff2?)\b/i],
    pathPattern: /murphy[^/]*\.(?:avif|gif|jpe?g|png|svg|webp|woff2?)$/i
  },
  {
    id: 'business-assumption',
    patterns: [/\b(?:commission\s+(?:rate|formula)|clawback|fixed\s+spreadsheet|door\s+sales\s+stage|murphy\s+kombat)\b/i]
  }
]);

export const PROVENANCE_RULE_IDS = Object.freeze(RULES.map((rule) => rule.id));
const RULE_ID_SET = new Set(PROVENANCE_RULE_IDS);

function normalizePath(path) {
  return path.split(sep).join('/').replace(/^\.\//, '');
}

function recursiveFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const absolute = resolve(current, entry.name);
    if (entry.isDirectory()) files.push(...recursiveFiles(root, absolute));
    else files.push(normalizePath(relative(root, absolute)));
  }
  return files;
}

function workspaceFiles(root) {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.split('\0').filter(Boolean).map(normalizePath);
  } catch {
    return recursiveFiles(root);
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeRelative(value) {
  if (typeof value !== 'string' || !value || /[\u0000-\u001f]/.test(value) || value.startsWith('/') || value.includes('\\') || isAbsolute(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment && segment !== '.' && segment !== '..');
}

function isIsoTimestamp(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function exactKeys(value, { required, optional = [] }, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!(key in value)) errors.push(`${label} is missing ${key}`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label} has unknown property ${key}`);
  return true;
}

function isExplicitRemote(value) {
  return /^(?:https:\/\/[^\s]+|ssh:\/\/[^\s]+|git@[^\s:]+:[^\s]+)$/.test(String(value || ''));
}

function parseManifest(root) {
  const manifestPath = resolve(root, 'provenance/manifest.json');
  const errors = [];
  if (!existsSync(manifestPath)) return { manifest: null, errors: ['provenance/manifest.json is required'], exceptions: new Map() };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return { manifest: null, errors: [`provenance/manifest.json is invalid JSON: ${error.message}`], exceptions: new Map() };
  }
  if (!exactKeys(manifest, { required: ['$schema', 'version', 'allowedSources', 'entries', 'exceptions'] }, 'manifest', errors)) {
    return { manifest, errors, exceptions: new Map() };
  }
  if (manifest.$schema !== './manifest.schema.json') errors.push('manifest $schema must be ./manifest.schema.json');
  if (manifest.version !== 1) errors.push('manifest version must be 1');

  const allowedSources = new Set();
  if (!Array.isArray(manifest.allowedSources)) errors.push('manifest allowedSources must be an array');
  else manifest.allowedSources.forEach((source, index) => {
    if (!isExplicitRemote(source)) errors.push(`allowed source ${index} must be an explicit remote repository`);
    if (allowedSources.has(source)) errors.push(`allowed source ${index} is duplicated`);
    allowedSources.add(source);
  });

  const destinations = new Set();
  if (!Array.isArray(manifest.entries)) errors.push('manifest entries must be an array');
  else manifest.entries.forEach((entry, index) => {
    const label = `manifest entry ${index}`;
    if (!exactKeys(entry, {
      required: ['sourceRepo', 'sourceSha', 'sourcePath', 'destinationPaths', 'extractionMethod', 'rationale', 'genericContract', 'reviewedBy', 'reviewedAt']
    }, label, errors)) return;
    if (!isExplicitRemote(entry.sourceRepo)) errors.push(`${label} sourceRepo must be an explicit remote repository`);
    else if (!allowedSources.has(entry.sourceRepo)) errors.push(`${label} sourceRepo is not in allowedSources`);
    if (!/^[0-9a-f]{40}$/.test(String(entry.sourceSha || ''))) errors.push(`${label} sourceSha must be a full lowercase commit SHA`);
    if (!isSafeRelative(entry.sourcePath)) errors.push(`${label} sourcePath must be a safe relative path`);
    if (!['concept', 'port', 'copy'].includes(entry.extractionMethod)) errors.push(`${label} extractionMethod is invalid`);
    if (typeof entry.rationale !== 'string' || entry.rationale.length < 12) errors.push(`${label} rationale is too short`);
    if (typeof entry.genericContract !== 'string' || entry.genericContract.length < 12) errors.push(`${label} genericContract is too short`);
    if (typeof entry.reviewedBy !== 'string' || entry.reviewedBy.length < 2) errors.push(`${label} reviewedBy is required`);
    if (!isIsoTimestamp(entry.reviewedAt)) errors.push(`${label} reviewedAt must be an ISO timestamp`);
    if (!Array.isArray(entry.destinationPaths) || entry.destinationPaths.length === 0) {
      errors.push(`${label} destinationPaths must not be empty`);
    } else {
      for (const destination of entry.destinationPaths) {
        if (!isSafeRelative(destination)) errors.push(`${label} destination path is unsafe: ${destination}`);
        else {
          const absolute = resolve(root, destination);
          if (!existsSync(absolute)) errors.push(`${label} destination does not exist: ${destination}`);
          else if (!lstatSync(absolute).isFile()) errors.push(`${label} destination must be a regular file: ${destination}`);
        }
        if (destinations.has(destination)) errors.push(`${label} destination is claimed more than once: ${destination}`);
        destinations.add(destination);
      }
    }
  });

  const exceptions = new Map();
  if (!Array.isArray(manifest.exceptions)) errors.push('manifest exceptions must be an array');
  else manifest.exceptions.forEach((exception, index) => {
    const label = `manifest exception ${index}`;
    if (!exactKeys(exception, {
      required: ['path', 'sha256', 'rules', 'rationale', 'reviewedBy', 'reviewedAt']
    }, label, errors)) return;
    if (!isSafeRelative(exception.path)) errors.push(`${label} path must be a safe relative path`);
    if (POLICY_FILES.has(exception.path)) errors.push(`${label} cannot exempt a provenance policy file`);
    if (!/^[0-9a-f]{64}$/.test(String(exception.sha256 || ''))) errors.push(`${label} sha256 must be a full lowercase digest`);
    if (!Array.isArray(exception.rules) || exception.rules.length === 0) errors.push(`${label} rules must not be empty`);
    else {
      const uniqueRules = new Set();
      for (const rule of exception.rules) {
        if (!RULE_ID_SET.has(rule)) errors.push(`${label} has unknown rule ${rule}`);
        if (uniqueRules.has(rule)) errors.push(`${label} duplicates rule ${rule}`);
        uniqueRules.add(rule);
      }
    }
    if (typeof exception.rationale !== 'string' || exception.rationale.length < 12) errors.push(`${label} rationale is too short`);
    if (typeof exception.reviewedBy !== 'string' || exception.reviewedBy.length < 2) errors.push(`${label} reviewedBy is required`);
    if (!isIsoTimestamp(exception.reviewedAt)) errors.push(`${label} reviewedAt must be an ISO timestamp`);
    if (exceptions.has(exception.path)) errors.push(`${label} duplicates exception path ${exception.path}`);
    if (isSafeRelative(exception.path)) {
      const absolute = resolve(root, exception.path);
      if (!existsSync(absolute)) errors.push(`${label} path does not exist: ${exception.path}`);
      else if (!lstatSync(absolute).isFile()) errors.push(`${label} path must be a regular file: ${exception.path}`);
      else if (/^[0-9a-f]{64}$/.test(String(exception.sha256 || '')) && sha256File(absolute) !== exception.sha256) {
        errors.push(`${label} sha256 does not match ${exception.path}`);
      }
    }
    exceptions.set(exception.path, new Set(Array.isArray(exception.rules) ? exception.rules : []));
  });
  return { manifest, errors, exceptions: errors.length ? new Map() : exceptions };
}

export function validateManifest(root) {
  return parseManifest(resolve(root)).errors;
}

function isBinary(buffer) {
  return buffer.subarray(0, 8_192).includes(0);
}

export function scanWorkspace(root, { checkManifest = true } = {}) {
  const absoluteRoot = resolve(root);
  const manifestResult = checkManifest ? parseManifest(absoluteRoot) : { errors: [], exceptions: new Map() };
  const violations = [];
  const files = workspaceFiles(absoluteRoot);
  for (const file of files) {
    const absolute = resolve(absoluteRoot, file);
    const fromRoot = relative(absoluteRoot, absolute);
    if (fromRoot.startsWith('..') || isAbsolute(fromRoot) || !existsSync(absolute)) continue;
    const metadata = lstatSync(absolute);
    if (!metadata.isFile()) {
      violations.push({ rule: 'filesystem-boundary', file, line: 0 });
      continue;
    }
    if (POLICY_FILES.has(file)) continue;
    const allowedRules = manifestResult.exceptions.get(file) || new Set();
    for (const rule of RULES) {
      if (!allowedRules.has(rule.id) && rule.pathPattern?.test(file)) violations.push({ rule: rule.id, file, line: 0 });
    }
    const bytes = readFileSync(absolute);
    if (isBinary(bytes)) continue;
    const lines = bytes.toString('utf8').split(/\r?\n/);
    for (const rule of RULES) {
      if (allowedRules.has(rule.id)) continue;
      lines.forEach((line, index) => {
        if (rule.patterns.some((pattern) => pattern.test(line))) violations.push({ rule: rule.id, file, line: index + 1 });
      });
    }
  }
  return { violations, manifestErrors: manifestResult.errors, filesScanned: files.length };
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = scanWorkspace(root);
  for (const error of result.manifestErrors) console.error(`Provenance manifest error: ${error}`);
  for (const violation of result.violations) console.error(`Provenance denylist violation: ${violation.rule} at ${violation.file}:${violation.line}`);
  if (result.manifestErrors.length || result.violations.length) process.exitCode = 1;
  else console.log(`Provenance gate passed: ${result.filesScanned} files scanned; SHA-pinned manifest and exceptions valid.`);
}
