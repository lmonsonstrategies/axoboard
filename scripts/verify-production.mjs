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
const landing = await (await request('/', 200)).text();
assert.match(landing, /Your team should[\s\S]*<em>feel<\/em>[\s\S]*the numbers[\s\S]*moving/i);
assert.doesNotMatch(landing, /See how it works/i);
assert.match(landing, /Don’t just show the score/i);
assert.match(landing, /GAMIFICATION (?:&|&amp;) RECOGNITION/i);
assert.match(landing, /TEAM COMPETITIONS/i);
assert.equal((landing.match(/id="integrations"/g) || []).length, 1, 'landing has one integrations destination');
assert.equal((landing.match(/Built for the tools running your business/g) || []).length, 1, 'landing has one integrations presentation');
assert.match(landing, /class="hero-celebration"/i);
assert.match(landing, /Quarter target hit!/i);
for (const price of ['$99', '$249', '$599', 'From $1,500']) assert.ok(landing.includes(price), `landing includes ${price} plan`);
assert.match(landing, /"@type": "WebApplication"/i);
assert.match(landing, /rel="canonical" href="https:\/\/axoboard\.io\/"/i);
assert.match(await (await request('/signup', 200)).text(), /Create your AxoBoard/);
assert.match(await (await request('/terms', 200)).text(), /Terms of Service/);
assert.match(await (await request('/privacy', 200)).text(), /Privacy Policy/);
for (const path of ['/assets/providers/google-sheets.svg', '/assets/providers/shopify.svg', '/assets/providers/wix.svg', '/assets/providers/microsoft-excel.svg', '/assets/providers/hubspot.svg', '/assets/providers/salesforce.svg']) await request(path, 200);
assert.match(await (await request('/robots.txt', 200)).text(), /User-agent: OAI-SearchBot[\s\S]*Sitemap: https:\/\/axoboard\.io\/sitemap\.xml/i);
assert.match(await (await request('/sitemap.xml', 200)).text(), /<loc>https:\/\/axoboard\.io\/<\/loc>/i);
assert.match(await (await request('/llms.txt', 200)).text(), /AxoBoard is currently in pre-launch development/i);
assert.equal((await request('/app', 302)).headers.get('location'), '/login');
for (const path of ['/demo', '/index.html', '/app.js', '/styles.css', '/landing.html', '/auth.html', '/api/axoboard/integrations/oauth/start', '/assets/axoboard-logo-low-poly.png', '/assets/integrations/google-sheets.svg', '/assets/integrations/hubspot.svg', '/assets/favicon/favicon-source.png']) await request(path, 404);
for (const path of ['/.env', '/server.mjs', '/package.json', '/Dockerfile', '/.git/config']) await request(path, 404);
await request('/%2e%2e/%2e%2e/etc/passwd', 404);
console.log(`Production verified at ${baseUrl}: ${health.version}; database=${health.database}.`);
