import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_DATABASE_SUITES = Object.freeze([
  'smoke',
  'engagement',
  'automation',
  'display',
  'billing',
  'google'
]);

export async function allocateLoopbackPorts(count = 1) {
  assert.ok(Number.isInteger(count) && count > 0 && count <= 8, 'port count must be between 1 and 8');
  const reservations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const reservation = createServer();
      await new Promise((resolveListen, rejectListen) => {
        reservation.once('error', rejectListen);
        reservation.listen(0, '127.0.0.1', resolveListen);
      });
      reservations.push(reservation);
    }
    return reservations.map((reservation) => reservation.address().port);
  } finally {
    await Promise.all(reservations.map((reservation) => new Promise((resolveClose) => reservation.close(resolveClose))));
  }
}

export function strictVerificationRequired(env = process.env) {
  const enabled = (value) => ['1', 'true', 'yes'].includes(String(value || '').toLowerCase());
  return enabled(env.AXOBOARD_FULL_VERIFY) || enabled(env.CI) || enabled(env.GITHUB_ACTIONS);
}

export function integrationDatabase(suite, env = process.env) {
  assert.match(String(suite || ''), /^[a-z][a-z0-9-]*$/, 'integration suite name is invalid');
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!databaseUrl && strictVerificationRequired(env)) {
    throw new Error(`${suite} integration coverage requires disposable PostgreSQL during CI/full verification`);
  }
  return databaseUrl || null;
}

export function recordDatabaseSuitePass(suite, details = {}, env = process.env) {
  const receiptsDirectory = String(env.AXOBOARD_VERIFY_RECEIPTS_DIR || '').trim();
  if (!receiptsDirectory) return;
  assert.ok(REQUIRED_DATABASE_SUITES.includes(suite), `unknown verification suite: ${suite}`);
  assert.ok(env.DATABASE_URL, `${suite} cannot record database coverage without DATABASE_URL`);
  mkdirSync(receiptsDirectory, { recursive: true, mode: 0o700 });
  const receipt = {
    schemaVersion: 1,
    suite,
    databaseCoverage: true,
    pid: process.pid,
    completedAt: new Date().toISOString(),
    ...details
  };
  writeFileSync(resolve(receiptsDirectory, `${suite}.json`), `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
}

export function assertDatabaseSuiteReceipts(receiptsDirectory, requiredSuites = REQUIRED_DATABASE_SUITES) {
  const seen = new Set();
  for (const suite of requiredSuites) {
    const path = resolve(receiptsDirectory, `${suite}.json`);
    let receipt;
    try {
      receipt = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`required integration suite did not produce a valid receipt: ${suite} (${error.message})`);
    }
    assert.equal(receipt.schemaVersion, 1, `${suite} receipt schema`);
    assert.equal(receipt.suite, suite, `${suite} receipt identity`);
    assert.equal(receipt.databaseCoverage, true, `${suite} must prove database coverage`);
    assert.ok(Number.isInteger(receipt.pid) && receipt.pid > 0, `${suite} receipt pid`);
    assert.ok(Number.isFinite(Date.parse(receipt.completedAt)), `${suite} receipt completion time`);
    assert.equal(basename(path), `${suite}.json`);
    seen.add(suite);
  }
  assert.equal(seen.size, requiredSuites.length, 'every required database suite must run');
  return [...seen];
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  console.error('scripts/test-support.mjs is a library; run `npm run verify` for the fail-closed verification entry point.');
  process.exitCode = 1;
}
