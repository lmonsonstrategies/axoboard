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
  const knownViewports = new Set(config.viewports.map((viewport) => viewport.id));
  for (const scenario of config.humanOnlyScenarios) {
    if ((scenario.type === 'authenticated-app') !== (scenario.surface === 'app')) throw new Error(`Human scenario ${scenario.id} has an inconsistent type/surface binding.`);
    if (JSON.stringify(scenario.browserEngines) !== JSON.stringify(config.browserEngines)) throw new Error(`Human scenario ${scenario.id} must require the complete browser-engine policy.`);
    const matrixIds = new Set();
    const observed = { states: new Set(), viewports: new Set(), themes: new Set() };
    for (const entry of scenario.requiredMatrix) {
      const id = [entry.state, entry.role, entry.device, entry.theme, entry.viewport].join('|');
      if (matrixIds.has(id)) throw new Error(`Human scenario ${scenario.id} contains duplicate matrix cell ${id}.`);
      matrixIds.add(id);
      if (!scenario.states.includes(entry.state) || !scenario.viewports.includes(entry.viewport) || !scenario.themes.includes(entry.theme) || !knownViewports.has(entry.viewport)) {
        throw new Error(`Human scenario ${scenario.id} matrix cell ${id} is outside its declared state/theme/viewport inventory.`);
      }
      observed.states.add(entry.state);
      observed.viewports.add(entry.viewport);
      observed.themes.add(entry.theme);
    }
    for (const field of ['states', 'viewports', 'themes']) {
      const missing = scenario[field].filter((value) => !observed[field].has(value));
      if (missing.length) throw new Error(`Human scenario ${scenario.id} matrix does not cover ${field}: ${missing.join(', ')}.`);
    }
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
