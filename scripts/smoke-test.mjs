import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';

const port = 43219;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let logs = '';
child.stdout.on('data', (chunk) => { logs += chunk; });
child.stderr.on('data', (chunk) => { logs += chunk; });

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
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
  await waitForHealth();
  const landing = await assertRoute('/', 200, /Your team should/);
  assert.match(landing.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.doesNotMatch(await (await fetch(`${baseUrl}/`)).text(), /murphy/i);
  await assertRoute('/features', 200, /Performance changes/);
  await assertRoute('/integrations', 200, /Your systems already have the answers/);
  await assertRoute('/pricing', 200, /See your operation clearly/);
  await assertRoute('/faq', 200, /What teams ask/);
  await assertRoute('/login', 200, /Log in to AxoBoard/);
  await assertRoute('/signup', 200, /Create your AxoBoard/);
  await assertRoute('/demo', 200, /Dashboard Builder/);
  const protectedApp = await assertRoute('/app', 302);
  assert.equal(protectedApp.headers.get('location'), '/login');
  for (const path of ['/.env', '/server.mjs', '/package.json', '/Dockerfile', '/.git/config']) await assertRoute(path, 404);
  await assertRoute('/%2e%2e/%2e%2e/etc/passwd', 404);
  assert.equal(await rawStatus('/%2e%2e/%2e%2e/etc/passwd'), 400, 'raw encoded traversal status');

  if (process.env.DATABASE_URL) {
    const email = `qa-${Date.now()}@example.com`;
    const signup = await fetch(`${baseUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: baseUrl },
      body: JSON.stringify({ name: 'Release QA', email, password: 'AxoBoardQA123', workspaceName: 'Release QA', timezone: 'America/Denver', acceptTerms: true })
    });
    assert.equal(signup.status, 201, `signup status: ${await signup.text()}`);
    const cookie = signup.headers.get('set-cookie');
    assert.ok(cookie?.includes('axo_session='), 'signup session cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: cookie } });
    const sessionBody = await session.json();
    assert.equal(sessionBody.authenticated, true);
    assert.equal(sessionBody.user.role, 'owner');
    assert.equal(sessionBody.user.workspace_name, 'Release QA');
    const authenticatedApp = await fetch(`${baseUrl}/app`, { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal(authenticatedApp.status, 200);
    const badLogin = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: baseUrl }, body: JSON.stringify({ email, password: 'wrong-password' }) });
    assert.equal(badLogin.status, 401);
  }
  console.log(`AxoBoard smoke test passed${process.env.DATABASE_URL ? ' with PostgreSQL auth' : ' (public routes; PostgreSQL not configured)'}.`);
} finally {
  child.kill('SIGTERM');
  await new Promise((resolveExit) => child.once('exit', resolveExit));
}
