import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import pg from 'pg';

const { Pool } = pg;

const port = 43219;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
let testWorkspaceId = null;
let testUserId = null;
let testEmail = null;
const testPool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 2 })
  : null;
child.stdout.on('data', (chunk) => { logs += chunk; });
child.stderr.on('data', (chunk) => { logs += chunk; });

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`server did not become healthy\n${logs}`);
}

async function assertRoute(path, expectedStatus, content = null) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  assert.equal(response.status, expectedStatus, `${path} status`);
  if (content) assert.match(await response.text(), content, `${path} content`);
  return response;
}

async function assertPaidGate(cookie, status, appStatus = 302) {
  await testPool.query('UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE workspace_id = $2', [status, testWorkspaceId]);
  const app = await fetch(`${baseUrl}/app`, { headers: { Cookie: cookie }, redirect: 'manual' });
  assert.equal(app.status, appStatus, `/app with ${status}`);
  if (appStatus === 302) {
    assert.equal(app.headers.get('location'), '/pricing?access=subscription_required', `${status} redirect`);
  } else {
    assert.match(app.headers.get('cache-control') || '', /private, no-store/, '/app cache policy');
    assert.match(app.headers.get('vary') || '', /Cookie/i, '/app varies on session');
  }
  for (const path of ['/app.js', '/styles.css', '/assets/integrations/google-sheets.svg', '/assets/integrations/hubspot.svg']) {
    const response = await fetch(`${baseUrl}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(response.status, appStatus === 200 ? 200 : 404, `${path} with ${status}`);
    if (appStatus === 200) {
      assert.match(response.headers.get('cache-control') || '', /private, no-store/, `${path} cache policy`);
      assert.match(response.headers.get('vary') || '', /Cookie/i, `${path} varies on session`);
    }
  }
  const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
  const body = await session.json();
  assert.equal(body.billing.status, status, `session billing status for ${status}`);
  assert.equal(body.canAccessApp, status === 'active', `session access for ${status}`);
}

function rawStatus(path) {
  return new Promise((resolveStatus, rejectStatus) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method: 'GET' }, (response) => {
      response.resume();
      response.on('end', () => resolveStatus(response.statusCode));
    });
    request.on('error', rejectStatus);
    request.end();
  });
}

try {
  const health = await waitForHealth();
  assert.equal(health.database, process.env.DATABASE_URL ? 'healthy' : 'not_configured', 'database health state');
  const landing = await assertRoute('/', 200, /Your team should[\s\S]*<em>feel<\/em>[\s\S]*the numbers[\s\S]*moving/i);
  assert.match(landing.headers.get('content-security-policy') || '', /default-src 'self'/);
  const landingHtml = await (await fetch(`${baseUrl}/`)).text();
  assert.doesNotMatch(landingHtml, /murphy/i);
  assert.doesNotMatch(landingHtml, /See how it works/i);
  assert.match(landingHtml, /Don’t just show the score/i);
  assert.match(landingHtml, /GAMIFICATION (?:&|&amp;) RECOGNITION/i);
  assert.match(landingHtml, /TEAM COMPETITIONS/i);
  assert.equal((landingHtml.match(/id="integrations"/g) || []).length, 1, 'landing has one integrations destination');
  assert.equal((landingHtml.match(/Built for the tools running your business/g) || []).length, 1, 'landing has one integrations presentation');
  assert.match(landingHtml, /class="hero-celebration"/i);
  assert.match(landingHtml, /Quarter target hit!/i);
  assert.match(landingHtml, /Turn live performance into action, recognition, and momentum/i);
  assert.match(landingHtml, /Live preview/i);
  for (const price of ['$99', '$249', '$599', 'From $1,500']) assert.ok(landingHtml.includes(price), `landing includes ${price} plan`);
  assert.match(landingHtml, /"@type": "WebApplication"/i);
  assert.match(landingHtml, /rel="canonical" href="https:\/\/axoboard\.io\/"/i);
  await assertRoute('/features', 200, /AxoBoard/i);
  await assertRoute('/integrations', 200, /AxoBoard/i);
  await assertRoute('/pricing', 200, /AxoBoard/i);
  await assertRoute('/faq', 200, /AxoBoard/i);
  await assertRoute('/terms', 200, /Terms of Service/);
  await assertRoute('/privacy', 200, /Privacy Policy/);
  await assertRoute('/login', 200, /Log in to AxoBoard/);
  await assertRoute('/signup', 200, /Create your AxoBoard/);
  for (const path of ['/marketing.css', '/marketing.js', '/auth.js', '/robots.txt', '/sitemap.xml', '/llms.txt', '/assets/favicon/favicon-32.png', '/assets/favicon/favicon-192.png', '/assets/providers/google-sheets.svg', '/assets/providers/shopify.svg', '/assets/providers/wix.svg', '/assets/providers/microsoft-excel.svg', '/assets/providers/hubspot.svg', '/assets/providers/salesforce.svg']) await assertRoute(path, 200);
  assert.match(await (await fetch(`${baseUrl}/robots.txt`)).text(), /User-agent: OAI-SearchBot[\s\S]*Sitemap: https:\/\/axoboard\.io\/sitemap\.xml/i);
  assert.match(await (await fetch(`${baseUrl}/sitemap.xml`)).text(), /<loc>https:\/\/axoboard\.io\/<\/loc>/i);
  assert.match(await (await fetch(`${baseUrl}/llms.txt`)).text(), /AxoBoard is currently in pre-launch development/i);
  for (const path of ['/demo', '/index.html', '/app.js', '/styles.css', '/api/axoboard/integrations/oauth/start']) await assertRoute(path, 404);
  const protectedApp = await assertRoute('/app', 302);
  assert.equal(protectedApp.headers.get('location'), '/login');
  for (const path of ['/.env', '/server.mjs', '/package.json', '/Dockerfile', '/.git/config', '/landing.html', '/auth.html', '/unknown.js', '/assets/axoboard-logo-low-poly.png', '/assets/integrations/google-sheets.svg', '/assets/integrations/hubspot.svg', '/assets/favicon/favicon-source.png']) await assertRoute(path, 404);
  await assertRoute('/%2e%2e/%2e%2e/etc/passwd', 404);
  assert.equal(await rawStatus('/%2e%2e/%2e%2e/etc/passwd'), 400, 'raw encoded traversal status');

  if (process.env.DATABASE_URL) {
    const anonymousSession = await (await fetch(`${baseUrl}/api/auth/session`)).json();
    assert.deepEqual(anonymousSession, { authenticated: false, canAccessApp: false });
    const email = `qa-${Date.now()}@example.com`;
    testEmail = email;
    const signup = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ name: 'Release QA', email, password: 'AxoBoardQA123', workspaceName: 'Release QA', timezone: 'America/Denver', acceptTerms: true })
    });
    const signupText = await signup.text();
    assert.equal(signup.status, 201, `signup status: ${signupText}`);
    const signupBody = JSON.parse(signupText);
    assert.equal(signupBody.redirect, '/pricing?access=subscription_required');
    const setCookie = signup.headers.get('set-cookie');
    assert.ok(setCookie?.includes('axo_session='), 'signup session cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    const cookie = setCookie.split(';')[0];
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
    const sessionBody = await session.json();
    assert.equal(sessionBody.authenticated, true);
    assert.equal(sessionBody.canAccessApp, false);
    assert.equal(sessionBody.billing.status, 'pending_payment');
    assert.equal(sessionBody.user.role, 'owner');
    assert.equal(sessionBody.user.workspace_name, 'Release QA');
    assert.equal(sessionBody.user.billing_status, undefined, 'raw billing status is not exposed on user');
    testWorkspaceId = sessionBody.user.workspace_id;
    testUserId = sessionBody.user.id;

    const secondWorkspaceId = randomUUID();
    await testPool.query('INSERT INTO workspaces (id, name, timezone) VALUES ($1, $2, $3)', [secondWorkspaceId, 'Release QA Second', 'America/Denver']);
    await testPool.query('INSERT INTO memberships (id, workspace_id, user_id, role, created_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL \'1 minute\')', [randomUUID(), secondWorkspaceId, testUserId, 'owner']);
    await testPool.query('INSERT INTO subscriptions (id, workspace_id, status) VALUES ($1, $2, $3)', [randomUUID(), secondWorkspaceId, 'active']);
    await assertPaidGate(cookie, 'pending_payment');

    const login = async () => {
      const response = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ email, password: 'AxoBoardQA123' }) });
      const responseText = await response.text();
      assert.equal(response.status, 200, `login response: ${responseText}`);
      return { body: JSON.parse(responseText), cookie: response.headers.get('set-cookie')?.split(';')[0] || '' };
    };
    assert.equal((await login()).body.redirect, '/pricing?access=subscription_required');
    await assertPaidGate(cookie, 'active', 200);
    assert.equal((await login()).body.redirect, '/app');
    await assertPaidGate(cookie, 'past_due');
    assert.equal((await login()).body.redirect, '/pricing?access=subscription_required');
    await assertPaidGate(cookie, 'canceled');
    assert.equal((await login()).body.redirect, '/pricing?access=subscription_required');

    await testPool.query("UPDATE memberships SET created_at = TIMESTAMPTZ '2000-01-01 00:00:00Z' WHERE workspace_id = $1 AND user_id = $2", [secondWorkspaceId, testUserId]);
    const secondWorkspaceLogin = await login();
    assert.equal(secondWorkspaceLogin.body.redirect, '/app', 'login selects one explicit active workspace');
    const secondSession = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: secondWorkspaceLogin.cookie } })).json();
    assert.equal(secondSession.user.workspace_id, secondWorkspaceId, 'session is bound to selected workspace');
    assert.equal(secondSession.canAccessApp, true, 'second workspace active access');
    const originalSession = await (await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } })).json();
    assert.equal(originalSession.user.workspace_id, testWorkspaceId, 'existing session remains bound to original workspace');
    assert.equal(originalSession.canAccessApp, false, 'canceled original workspace remains denied');

    const auditStatuses = (await testPool.query('SELECT status FROM subscription_status_events WHERE workspace_id = $1 ORDER BY id', [testWorkspaceId])).rows.map((row) => row.status);
    assert.deepEqual(auditStatuses, ['pending_payment', 'active', 'past_due', 'canceled'], 'subscription status history');
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ email, password: 'wrong-password' }) });
    assert.equal(badLogin.status, 401);
  } else {
    const anonymousSession = await (await fetch(`${baseUrl}/api/auth/session`)).json();
    assert.deepEqual(anonymousSession, { authenticated: false, canAccessApp: false, accountStorage: 'not_configured' });
  }
  console.log(`AxoBoard smoke test passed${process.env.DATABASE_URL ? ' with PostgreSQL auth' : ' (public routes; PostgreSQL not configured)'}.`);
} finally {
  child.kill('SIGTERM');
  await new Promise((resolveExit) => child.once('exit', resolveExit));
  if (testPool) {
    if (testEmail) {
      const cleanup = await testPool.query(`
        SELECT u.id AS user_id, m.workspace_id
        FROM users u LEFT JOIN memberships m ON m.user_id = u.id
        WHERE u.email = $1
      `, [testEmail]);
      const workspaceIds = cleanup.rows.map((row) => row.workspace_id).filter(Boolean);
      if (workspaceIds.length) await testPool.query('DELETE FROM workspaces WHERE id = ANY($1::uuid[])', [workspaceIds]);
      if (testUserId || cleanup.rows[0]?.user_id) await testPool.query('DELETE FROM users WHERE id = $1', [testUserId || cleanup.rows[0].user_id]);
    }
    await testPool.end();
  }
}
