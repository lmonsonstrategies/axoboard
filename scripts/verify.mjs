import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { assertDatabaseSuiteReceipts } from './test-support.mjs';

const { Pool } = pg;
const POSTGRES_IMAGE = 'postgres:18-alpine';
const enabled = (value) => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
const isCi = enabled(process.env.CI) || enabled(process.env.GITHUB_ACTIONS);
const receiptsDirectory = mkdtempSync(join(tmpdir(), 'axoboard-verify-receipts-'));
let disposableContainer = null;

function run(command, args, { env = process.env, capture = false, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    const detail = capture ? `\n${String(result.stderr || result.stdout || '').trim()}` : '';
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}${detail}`);
  }
  return capture ? String(result.stdout || '').trim() : result.status;
}

function assertDisposableUrl(rawUrl, { externallyManaged }) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL');
  }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'DATABASE_URL must use PostgreSQL');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'verification refuses a non-loopback database');
  if (!externallyManaged) {
    assert.equal(process.env.AXOBOARD_VERIFY_DATABASE_DISPOSABLE, '1',
      'local DATABASE_URL use requires AXOBOARD_VERIFY_DATABASE_DISPOSABLE=1; otherwise omit DATABASE_URL to auto-provision Docker PostgreSQL');
  }
  return url.toString();
}

async function waitForPostgres(databaseUrl) {
  const deadline = Date.now() + 60_000;
  let lastError = null;
  while (Date.now() < deadline) {
    const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 1_500 });
    try {
      await pool.query('SELECT 1');
      await pool.end();
      return;
    } catch (error) {
      lastError = error;
      await pool.end().catch(() => {});
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    }
  }
  throw new Error(`disposable PostgreSQL did not become ready: ${lastError?.message || 'timeout'}`);
}

async function databaseForVerification() {
  const configured = String(process.env.DATABASE_URL || '').trim();
  if (configured) {
    const databaseUrl = assertDisposableUrl(configured, { externallyManaged: isCi });
    console.log(`Using ${isCi ? 'CI-provisioned' : 'operator-attested disposable'} PostgreSQL.`);
    await waitForPostgres(databaseUrl);
    return databaseUrl;
  }

  const suffix = `${process.pid}-${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  const name = `axoboard-verify-${suffix}`;
  const password = randomBytes(24).toString('hex');
  disposableContainer = name;
  run('docker', [
    'run', '--detach', '--rm', '--name', name,
    '--publish', '127.0.0.1::5432',
    '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', 'POSTGRES_DB=axoboard_verify',
    POSTGRES_IMAGE
  ], { capture: true });
  const portMapping = run('docker', ['port', name, '5432/tcp'], { capture: true });
  const match = portMapping.match(/127\.0\.0\.1:(\d+)/);
  assert.ok(match, `could not resolve disposable PostgreSQL port: ${portMapping}`);
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${match[1]}/axoboard_verify`;
  console.log(`Provisioned disposable PostgreSQL ${POSTGRES_IMAGE} on an isolated loopback port.`);
  await waitForPostgres(databaseUrl);
  return databaseUrl;
}

function cleanup() {
  if (disposableContainer) {
    run('docker', ['stop', '--time', '5', disposableContainer], { capture: true, allowFailure: true });
    disposableContainer = null;
  }
  rmSync(receiptsDirectory, { recursive: true, force: true });
}

try {
  const databaseUrl = await databaseForVerification();
  const verificationEnv = {
    ...process.env,
    AXOBOARD_FULL_VERIFY: '1',
    AXOBOARD_VERIFY_RECEIPTS_DIR: receiptsDirectory,
    DATABASE_URL: databaseUrl,
    DATABASE_SSL: 'false'
  };
  for (const key of [
    'AXOBOARD_SMOKE_PORT',
    'AXOBOARD_BILLING_APP_PORT',
    'AXOBOARD_BILLING_STRIPE_PORT',
    'AXOBOARD_GOOGLE_APP_PORT',
    'AXOBOARD_GOOGLE_PROVIDER_PORT'
  ]) delete verificationEnv[key];

  const gates = [
    ['npm', ['run', 'check']],
    ['npm', ['audit', '--omit=dev']],
    ['npm', ['run', 'test:release-foundation']],
    ['npm', ['run', 'test:provenance']],
    ['npm', ['run', 'test:tv-visuals']],
    ['npm', ['run', 'test:smoke']],
    ['npm', ['run', 'test:engagement']],
    ['npm', ['run', 'test:automation']],
    ['npm', ['run', 'test:display']],
    ['npm', ['run', 'test:billing']],
    ['npm', ['run', 'test:google']]
  ];
  for (const [command, args] of gates) run(command, args, { env: verificationEnv });
  const suites = assertDatabaseSuiteReceipts(receiptsDirectory);
  console.log(`AxoBoard verification passed with fail-closed PostgreSQL coverage: ${suites.join(', ')}.`);
} finally {
  cleanup();
}
