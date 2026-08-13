import assert from 'node:assert/strict';

const baseUrl = String(process.env.BASE_URL || 'https://axoboard.io').replace(/\/$/, '');
const expectedSha = String(process.env.EXPECTED_SHA || '').trim();

async function request(path, expectedStatus) {
  const response = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
  assert.equal(response.status, expectedStatus, `${path} expected ${expectedStatus}, received ${response.status}`);
  return response;
}

const health = await (await request('/healthz', 200)).json();
assert.equal(health.ok, true);
if (expectedSha) assert.ok(String(health.version).startsWith(expectedSha), `deployed ${health.version}, expected ${expectedSha}`);
assert.match(await (await request('/', 200)).text(), /AxoBoard/i);
assert.match(await (await request('/signup', 200)).text(), /Create your AxoBoard/);
assert.equal((await request('/app', 302)).headers.get('location'), '/login');
for (const path of ['/demo', '/index.html', '/app.js', '/styles.css', '/landing.html', '/auth.html', '/api/axoboard/integrations/oauth/start', '/assets/axoboard-logo-low-poly.png', '/assets/integrations/google-sheets.svg', '/assets/integrations/hubspot.svg', '/assets/favicon/favicon-source.png']) await request(path, 404);
for (const path of ['/.env', '/server.mjs', '/package.json', '/Dockerfile', '/.git/config']) await request(path, 404);
await request('/%2e%2e/%2e%2e/etc/passwd', 404);
console.log(`Production verified at ${baseUrl}: ${health.version}; database=${health.database}.`);
