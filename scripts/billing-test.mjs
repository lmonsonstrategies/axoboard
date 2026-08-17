import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Stripe from 'stripe';

if (!process.env.DATABASE_URL) {
  console.log('AxoBoard Stripe billing test skipped: DATABASE_URL is not configured.');
  process.exit(0);
}
const { Pool } = pg;
const appPort = 43220;
const stripePort = 43221;
const baseUrl = `http://127.0.0.1:${appPort}`;
const webhookSecret = 'whsec_axoboard_billing_test_secret';
const starterPrice = 'price_axoboard_starter_test';
const stripeSigner = new Stripe('sk_test_signer');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 2 });
const testEmails = [];
const testWorkspaceIds = [];
const testEventIds = [];
const runId = `${Date.now()}${randomUUID().replaceAll('-', '').slice(0, 8)}`;
const firstCustomerId = `cus_test_${runId}_1`;
let customerSequence = 0;

function parseForm(buffer) {
  return new URLSearchParams(buffer.toString('utf8'));
}

const fakeStripe = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const form = parseForm(Buffer.concat(chunks));
  let payload;
  if (req.url === '/v1/customers' && req.method === 'POST') {
    customerSequence += 1;
    payload = { id: `cus_test_${runId}_${customerSequence}`, object: 'customer', email: form.get('email'), metadata: { workspace_id: form.get('metadata[workspace_id]') } };
  } else if (req.url === '/v1/checkout/sessions' && req.method === 'POST') {
    assert.equal(form.get('mode'), 'subscription');
    assert.equal(form.get('line_items[0][price]'), starterPrice);
    assert.equal(form.get('line_items[0][quantity]'), '1');
    assert.equal(form.get('metadata[plan_key]'), 'starter_monthly');
    assert.equal(form.get('subscription_data[metadata][plan_key]'), 'starter_monthly');
    assert.equal(form.get('consent_collection[terms_of_service]'), 'required');
    payload = { id: 'cs_test_axoboard', object: 'checkout.session', url: 'https://checkout.stripe.test/c/pay/test-session' };
  } else if (req.url === '/v1/billing_portal/sessions' && req.method === 'POST') {
    payload = { id: 'bps_test_axoboard', object: 'billing_portal.session', url: 'https://billing.stripe.test/session/test-portal' };
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'not found', type: 'invalid_request_error' } }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
});

await new Promise((resolveListen) => fakeStripe.listen(stripePort, '127.0.0.1', resolveListen));
const app = spawn(process.execPath, ['server.mjs'], {
  env: {
    ...process.env, PORT: String(appPort), NODE_ENV: 'test', APP_BASE_URL: baseUrl,
    STRIPE_SECRET_KEY: 'sk_test_axoboard', STRIPE_WEBHOOK_SECRET: webhookSecret,
    STRIPE_PRICE_STARTER_MONTHLY: starterPrice, STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test_axoboard',
    STRIPE_API_HOST: '127.0.0.1', STRIPE_API_PORT: String(stripePort)
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
let appExited = false;
let appExitCode = null;
const appExit = new Promise((resolveExit) => app.once('exit', (code) => {
  appExited = true;
  appExitCode = code;
  resolveExit(code);
}));
let logs = '';
let completed = false;
app.stdout.on('data', (chunk) => { logs += chunk; });
app.stderr.on('data', (chunk) => { logs += chunk; });

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (appExited) throw new Error(`billing test server exited with code ${appExitCode}\n${logs}`);
    try { if ((await fetch(`${baseUrl}/healthz`)).ok) return; } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
  }
  throw new Error(`billing test server did not start\n${logs}`);
}

async function signup(label) {
  const email = `billing-${label}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  testEmails.push(email);
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl },
    body: JSON.stringify({ name: `Billing ${label}`, email, password: 'AxoBoardQA123', workspaceName: `Billing ${label}`, acceptTerms: true })
  });
  assert.equal(response.status, 201, await response.text());
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const session = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })).json();
  testWorkspaceIds.push(session.user.workspace_id);
  return { email, cookie, workspaceId: session.user.workspace_id };
}

async function post(path, cookie, headers = {}) {
  return fetch(`${baseUrl}${path}`, { method: 'POST', redirect: 'manual', headers: { Origin: baseUrl, Cookie: cookie, ...headers } });
}

async function webhook(event, secret = webhookSecret) {
  const payload = JSON.stringify(event);
  const signature = stripeSigner.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${baseUrl}/api/billing/stripe/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body: payload });
}

function event(id, type, created, object) {
  testEventIds.push(id);
  return { id, object: 'event', api_version: '2025-12-15.clover', created, livemode: false, type, data: { object } };
}

try {
  await waitForHealth();
  const first = await signup('Primary');
  const second = await signup('Isolated');

  const checkout = await post('/api/billing/checkout-session', first.cookie, { 'Idempotency-Key': 'checkout_retry_key_00000001' });
  const checkoutText = await checkout.text();
  assert.equal(checkout.status, 200, checkoutText);
  assert.equal(JSON.parse(checkoutText).url, 'https://checkout.stripe.test/c/pay/test-session');
  let firstSub = (await pool.query('SELECT * FROM subscriptions WHERE workspace_id = $1', [first.workspaceId])).rows[0];
  assert.equal(firstSub.status, 'pending_payment', 'Checkout creation never grants access');
  assert.equal(firstSub.stripe_customer_id, firstCustomerId);
  const successUrlApp = await fetch(`${baseUrl}/app`, { headers: { Cookie: first.cookie }, redirect: 'manual' });
  assert.equal(successUrlApp.status, 302);

  const checkoutEvent = event(`evt_checkout_${runId}`, 'checkout.session.completed', 100, {
    id: 'cs_test_axoboard', object: 'checkout.session', customer: firstCustomerId, subscription: 'sub_test_1',
    metadata: { workspace_id: first.workspaceId, plan_key: 'starter_monthly' }
  });
  assert.equal((await webhook(checkoutEvent)).status, 200);
  firstSub = (await pool.query('SELECT * FROM subscriptions WHERE workspace_id = $1', [first.workspaceId])).rows[0];
  assert.equal(firstSub.status, 'pending_payment', 'Checkout webhook binds IDs but does not activate');
  assert.equal(firstSub.stripe_subscription_id, 'sub_test_1');

  const activeEvent = event(`evt_subscription_active_${runId}`, 'customer.subscription.created', 200, {
    id: 'sub_test_1', object: 'subscription', customer: firstCustomerId, status: 'active', cancel_at_period_end: false,
    current_period_start: 200, current_period_end: 2_592_200,
    metadata: { workspace_id: first.workspaceId, plan_key: 'starter_monthly' },
    items: { data: [{ price: { id: starterPrice } }] }
  });
  assert.equal((await webhook(activeEvent)).status, 200);
  assert.equal((await fetch(`${baseUrl}/app`, { headers: { Cookie: first.cookie }, redirect: 'manual' })).status, 200);
  assert.equal((await fetch(`${baseUrl}/app`, { headers: { Cookie: second.cookie }, redirect: 'manual' })).status, 302, 'other workspace stays denied');

  const duplicate = await webhook(activeEvent);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM stripe_webhook_events WHERE event_id = $1', [activeEvent.id])).rows[0].count, 1);

  const oldCanceled = event(`evt_subscription_old_cancel_${runId}`, 'customer.subscription.deleted', 150, {
    id: 'sub_test_1', object: 'subscription', customer: firstCustomerId, status: 'canceled',
    metadata: { workspace_id: first.workspaceId }, items: { data: [{ price: { id: starterPrice } }] }
  });
  assert.equal((await webhook(oldCanceled)).status, 200);
  assert.equal((await pool.query('SELECT status FROM subscriptions WHERE workspace_id = $1', [first.workspaceId])).rows[0].status, 'active', 'older event cannot overwrite state');

  const badSignatureId = `evt_bad_signature_${runId}`;
  const invalidSignature = await webhook(event(badSignatureId, 'customer.subscription.deleted', 300, {}), 'wrong_secret');
  assert.equal(invalidSignature.status, 400);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM stripe_webhook_events WHERE event_id = $1', [badSignatureId])).rows[0].count, 0);

  const crossTenant = event(`evt_cross_tenant_${runId}`, 'customer.subscription.updated', 300, {
    id: 'sub_test_cross', object: 'subscription', customer: firstCustomerId, status: 'active',
    metadata: { workspace_id: second.workspaceId }, items: { data: [{ price: { id: starterPrice } }] }
  });
  assert.equal((await webhook(crossTenant)).status, 500);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM stripe_webhook_events WHERE event_id = $1', [crossTenant.id])).rows[0].count, 0, 'failed event insert rolls back');
  assert.equal((await pool.query('SELECT status FROM subscriptions WHERE workspace_id = $1', [second.workspaceId])).rows[0].status, 'pending_payment');

  const portal = await post('/api/billing/portal-session', first.cookie);
  const portalText = await portal.text();
  assert.equal(portal.status, 200, portalText);
  assert.equal(JSON.parse(portalText).url, 'https://billing.stripe.test/session/test-portal');

  const pastDue = event(`evt_invoice_failed_${runId}`, 'invoice.payment_failed', 400, {
    id: 'in_test_1', object: 'invoice', customer: firstCustomerId, subscription: 'sub_test_1'
  });
  assert.equal((await webhook(pastDue)).status, 200);
  assert.equal((await pool.query('SELECT status FROM subscriptions WHERE workspace_id = $1', [first.workspaceId])).rows[0].status, 'past_due');
  assert.equal((await fetch(`${baseUrl}/app`, { headers: { Cookie: first.cookie }, redirect: 'manual' })).status, 302);

  console.log('AxoBoard Stripe billing test passed: Checkout fail-closed, signed/idempotent webhooks, ordering, portal, revocation, and tenant isolation.');
  completed = true;
} finally {
  if (!appExited) {
    app.kill('SIGTERM');
    await appExit;
  }
  await new Promise((resolveClose) => fakeStripe.close(resolveClose));
  if (testWorkspaceIds.length) await pool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [testWorkspaceIds]);
  if (testEventIds.length) await pool.query('DELETE FROM stripe_webhook_events WHERE event_id = ANY($1::text[])', [[...new Set(testEventIds)]]);
  for (const email of testEmails) {
    const records = await pool.query('SELECT u.id AS user_id, m.workspace_id FROM users u LEFT JOIN memberships m ON m.user_id = u.id WHERE u.email = $1', [email]);
    if (records.rows[0]?.user_id) await pool.query('DELETE FROM users WHERE id = $1', [records.rows[0].user_id]);
  }
  await pool.end();
  if (!completed && logs) console.error(logs);
}
