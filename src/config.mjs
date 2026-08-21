import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(moduleDirectory, '..');
const configPath = resolve(projectRoot, 'config/quality-budgets.json');
const schemaPath = resolve(projectRoot, 'config/quality-budgets.schema.json');

export async function loadConfig() {
  const [rawConfig, rawSchema] = await Promise.all([
    readFile(configPath, 'utf8'),
    readFile(schemaPath, 'utf8')
  ]);
  const config = JSON.parse(rawConfig);
  const schema = JSON.parse(rawSchema);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(config)) {
    const detail = validate.errors.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    throw new Error(`Invalid quality configuration: ${detail}`);
  }
  return config;
}

function wildcardOriginMatches(pattern, candidate) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[0-9]+');
  return new RegExp(`^${escaped}$`).test(candidate);
}

export function validateBaseUrl(candidate, allowedPatterns) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid base URL: ${candidate}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/') {
    throw new Error('Base URL must be an HTTP(S) origin without credentials or a path.');
  }
  const origin = url.origin;
  if (!allowedPatterns.some((pattern) => wildcardOriginMatches(pattern, origin))) {
    throw new Error(`Base URL is outside the QA allowlist: ${origin}`);
  }
  return origin;
}

export function materializeRoutes(config, env = process.env) {
  const routes = config.routes.map((route) => ({ surface: 'public', ...route }));
  for (const optional of config.optionalRoutes || []) {
    const path = env[optional.env];
    if (!path) continue;
    if (!new RegExp(optional.pattern).test(path)) {
      throw new Error(`${optional.env} does not match the approved public route pattern.`);
    }
    routes.push({ ...optional, path });
  }
  return routes;
}

export function resolveChromiumExecutable(env = process.env) {
  const candidates = [
    env.CHROMIUM_PATH,
    '/snap/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      // Synchronous existence is intentionally avoided in the hot audit path;
      // known host paths are returned only when present via the small helper cache.
      return executableAvailability.get(candidate) === true;
    } catch {
      return false;
    }
  });
}

const executableAvailability = new Map();
for (const candidate of [
  process.env.CHROMIUM_PATH,
  '/snap/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable'
].filter(Boolean)) {
  try {
    await access(candidate, constants.X_OK);
    executableAvailability.set(candidate, true);
  } catch {
    executableAvailability.set(candidate, false);
  }
}

export { configPath, projectRoot, schemaPath };
