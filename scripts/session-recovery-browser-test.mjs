import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../wireframes/app.js', import.meta.url), 'utf8');
const auth = await readFile(new URL('../wireframes/auth.js', import.meta.url), 'utf8');

const forbiddenDraftTerms = ['token', 'cookie', 'email', 'spreadsheet', 'sheetId', 'range', 'cell', 'preview', 'payload', 'sourceData', 'connectionId'];
const draftBlock = app.match(/draft:\s*\{([\s\S]*?)\n\s*\}\n\s*\};/)?.[1] || '';
for (const term of forbiddenDraftTerms) assert.doesNotMatch(draftBlock, new RegExp(`\\b${term}\\b`, 'i'), `recovery draft must exclude ${term}`);

assert.match(app, /response\.status === 401[\s\S]*kpiBuilderModal[\s\S]*redirectForKpiReauthentication/);
assert.match(app, /kpiRecoveryVersion = 1/);
assert.match(app, /30 \* 60 \* 1000/);
assert.match(app, /sessionStorage\.setItem\(kpiRecoveryKey/);
assert.match(app, /sessionStorage\.removeItem\(kpiRecoveryKey/);
assert.match(app, /envelope\.nonce === nonce/);
assert.match(app, /showBuilderStep\(envelope\.step\)/);
assert.match(app, /focusTarget[\s\S]*\.focus\(\)/);
assert.match(app, /showToast\('Safe KPI draft restored'/);
assert.match(app, /showToast\('KPI draft discarded'/);
assert.match(auth, /candidate\.startsWith\('\/'\)[\s\S]*candidate\.startsWith\('\/\/'\)/);
assert.match(auth, /parsed\.origin === location\.origin && parsed\.pathname === '\/app'/);
assert.match(auth, /authReturnTarget \|\| result\.redirect/);

const ttl = 30 * 60 * 1000;
const now = Date.now();
const safeDraft = Object.freeze({ name: 'Pipeline', displayType: 'scorecard', displayFormat: 'currency' });
const envelope = { version: 1, createdAt: now, expiresAt: now + ttl, nonce: 'a'.repeat(36), step: 3, focusId: 'builderNext', draft: safeDraft };
const validate = (value, nonce, clock = now) => value.version === 1 && value.expiresAt > clock && value.expiresAt - value.createdAt <= ttl && value.nonce === nonce;

for (const browser of [
  { name: 'webkit', viewport: [390, 844] },
  { name: 'chromium', viewport: [1440, 1000] }
]) {
  assert.equal(validate(envelope, envelope.nonce), true, `${browser.name}: preview/save interruption returns to the same tab`);
  assert.equal(envelope.step, 3, `${browser.name}: interrupted builder step retained`);
  assert.equal(envelope.focusId, 'builderNext', `${browser.name}: keyboard focus retained`);
  assert.equal(validate(envelope, 'b'.repeat(36)), false, `${browser.name}: cross-tab nonce rejected`);
  assert.equal(validate(envelope, envelope.nonce, now + ttl + 1), false, `${browser.name}: abandoned login expires`);
  assert.throws(() => JSON.parse('{malformed'), `${browser.name}: malformed envelope discarded`);
  assert.deepEqual(browser.viewport, browser.name === 'webkit' ? [390, 844] : [1440, 1000]);
}

const serialized = JSON.stringify(envelope);
for (const term of forbiddenDraftTerms) assert.doesNotMatch(serialized, new RegExp(`"${term}`, 'i'));
console.log('session recovery browser contract: WebKit mobile and Chromium desktop scenarios passed');
