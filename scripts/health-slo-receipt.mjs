#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_LATENCY_SLO_MS = 2_000;

const INTEGRATION_FIELDS = [
  ['automationCore', 'automationCore'],
  ['automationEventProducer', 'automationEventProducer'],
  ['googleSheets', 'googleSheets']
];

function cleanSha(value) {
  const sha = String(value || '').trim();
  return /^[a-f0-9]{7,64}$/i.test(sha) ? sha : null;
}

function state(value) {
  return typeof value === 'string' && value.length <= 64 ? value : 'unknown';
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new RangeError('invalid positive integer');
  return parsed;
}

export async function createHealthSloReceipt(options = {}) {
  const baseUrl = new URL(options.baseUrl || 'https://axoboard.io');
  if (!['http:', 'https:'].includes(baseUrl.protocol)) throw new TypeError('invalid base URL protocol');
  const origin = baseUrl.origin;
  const expectedSha = cleanSha(options.expectedSha);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const latencySloMs = positiveInteger(options.latencySloMs, DEFAULT_LATENCY_SLO_MS);
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => new Date());
  const monotonicNow = options.monotonicNow || (() => performance.now());
  const timestamp = now().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response = null;
  let body = null;
  let failure = null;
  const startedAt = monotonicNow();

  try {
    response = await fetchImpl(`${origin}/healthz`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json' }
    });
    try {
      body = await response.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) failure = 'malformed_json';
    } catch {
      failure = 'malformed_json';
    }
  } catch (error) {
    failure = error?.name === 'AbortError' ? 'timeout' : 'request_failed';
  } finally {
    clearTimeout(timeout);
  }

  const responseLatencyMs = Math.max(0, Math.round(monotonicNow() - startedAt));
  const httpStatus = response?.status ?? null;
  const deployedSha = cleanSha(body?.version);
  const databaseState = state(body?.database);
  const integrationStates = Object.fromEntries(
    INTEGRATION_FIELDS.map(([receiptName, healthName]) => [receiptName, state(body?.[healthName])])
  );
  const workerState = state(body?.automationWorker);
  const reasons = [];

  if (failure) reasons.push(failure);
  if (responseLatencyMs > latencySloMs) reasons.push('latency_slo_exceeded');
  if (httpStatus !== null && httpStatus !== 200) reasons.push('http_status_not_200');
  if (body && body.ok !== true) reasons.push('health_not_ok');
  if (expectedSha && body && (!deployedSha || !deployedSha.startsWith(expectedSha))) reasons.push('deployed_sha_mismatch');
  if (databaseState === 'unhealthy' || databaseState === 'unknown') reasons.push('database_unhealthy');
  if (['dependency_unavailable', 'degraded', 'stale', 'unknown'].includes(workerState)) reasons.push('worker_unhealthy');

  return {
    timestamp,
    baseUrlOrigin: origin,
    expectedSha,
    deployedSha,
    httpStatus,
    responseLatencyMs,
    databaseState,
    integrationStates,
    workerState,
    passed: reasons.length === 0,
    reasons
  };
}

export function canonicalJson(receipt) {
  return `${JSON.stringify(receipt)}\n`;
}

async function main() {
  let receipt;
  try {
    receipt = await createHealthSloReceipt({
      baseUrl: process.env.BASE_URL || 'https://axoboard.io',
      expectedSha: process.env.EXPECTED_SHA,
      timeoutMs: process.env.HEALTH_TIMEOUT_MS,
      latencySloMs: process.env.HEALTH_LATENCY_SLO_MS
    });
  } catch {
    process.stderr.write('health-slo-receipt: invalid configuration\n');
    process.exitCode = 2;
    return;
  }
  process.stdout.write(canonicalJson(receipt));
  process.exitCode = receipt.passed ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
