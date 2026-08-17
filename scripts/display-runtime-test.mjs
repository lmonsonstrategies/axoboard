import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createDisplayRuntime } from '../lib/display-runtime.mjs';

if (!process.env.DATABASE_URL) {
  console.log('AxoBoard display runtime test skipped: DATABASE_URL is not configured.');
  process.exit(0);
}

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false, max: 2 });
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const userId = randomUUID();
const otherUserId = randomUUID();

function response() {
  return { status: 0, headers: {}, payload: null, writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(body = '') { this.payload = body ? JSON.parse(body) : null; } };
}
function sendJson(res, status, payload, headers = {}) { res.writeHead(status, headers); res.end(JSON.stringify(payload)); return payload; }
function request(body = {}, cookie = '', method = 'POST') { return { body, method, headers: { cookie, 'user-agent': 'AxoBoard display test' }, socket: { encrypted: false, remoteAddress: '127.0.0.1' } }; }
async function call(handler, ...args) { const res = response(); await handler(...args.slice(0, 1), res, ...args.slice(1)); return res; }

await pool.query("INSERT INTO users (id,email,full_name,password_hash) VALUES ($1,$2,'Display Owner','test'),($3,$4,'Other Owner','test')", [userId, `display-${userId}@example.com`, otherUserId, `display-${otherUserId}@example.com`]);
await pool.query('INSERT INTO workspaces (id,name) VALUES ($1,$2),($3,$4)', [workspaceId, 'Display Test', otherWorkspaceId, 'Other Display Test']);
await pool.query("INSERT INTO memberships (id,user_id,workspace_id,role) VALUES ($1,$2,$3,'owner'),($4,$5,$6,'owner')", [randomUUID(), userId, workspaceId, randomUUID(), otherUserId, otherWorkspaceId]);

const loads = [];
const runtime = createDisplayRuntime({
  pool,
  env: { AXOBOARD_DISPLAY_TOKEN_SECRET: randomBytes(32).toString('base64url') },
  sendJson,
  readJson: async (req) => req.body,
  sameOrigin: () => true,
  isRateLimited: () => false,
  loadWorkspaceDisplay: async (id, kpiIds) => { loads.push({ id, kpiIds }); return { workspace: { id, name: 'Display Test' }, brand: { name: 'Display Test', version: 1, tokens: {} }, dashboard: { layout: { kpiOrder: [] } }, kpis: [] }; }
});
assert.equal(runtime.ready, true);
const session = { id: userId, workspace_id: workspaceId };
const otherSession = { id: otherUserId, workspace_id: otherWorkspaceId };

let res = response();
await runtime.handleAdmin(request({ name: 'Sales Floor TV', contentMode: 'full_dashboard', rotationSeconds: 15 }), res, new URL('http://local/api/axoboard/displays/pairing-codes'), session);
assert.equal(res.status, 201);
assert.match(res.payload.pairing.code, /^[2-9A-HJ-NP-Z]{8}$/);
assert.equal(res.payload.display.status, 'pending');
const displayId = res.payload.display.id;
const code = res.payload.pairing.code;

res = response();
await runtime.handleAdmin(request({}, '', 'GET'), res, new URL('http://local/api/axoboard/displays'), otherSession);
assert.equal(res.payload.displays.length, 0, 'display lists are tenant isolated');

res = response();
await runtime.handlePublic(request({ code }), res, new URL('http://local/api/display/pair'));
assert.equal(res.status, 200);
assert.equal(res.payload.paired, true);
assert.match(String(res.headers['Set-Cookie']), /^axo_display=/);
const displayCookie = String(res.headers['Set-Cookie']).split(';')[0];

res = response();
await runtime.handlePublic(request({}, displayCookie, 'GET'), res, new URL('http://local/api/display/status'));
assert.equal(res.status, 200);
assert.equal(res.payload.paired, true);

res = response();
await runtime.handlePublic(request({ code }), res, new URL('http://local/api/display/pair'));
assert.equal(res.status, 404, 'pairing codes are one-time use');

res = response();
await runtime.handlePublic(request({}, displayCookie, 'GET'), res, new URL('http://local/api/display/runtime'));
assert.equal(res.status, 200);
assert.equal(res.payload.display.name, 'Sales Floor TV');
assert.deepEqual(loads.at(-1), { id: workspaceId, kpiIds: null });

res = response();
await runtime.handleAdmin(request({ name: 'Executive TV', contentMode: 'full_dashboard', rotationSeconds: 30 }, '', 'PATCH'), res, new URL(`http://local/api/axoboard/displays/${displayId}`), session);
assert.equal(res.status, 200);
assert.equal(res.payload.display.name, 'Executive TV');
assert.equal(res.payload.display.rotationSeconds, 30);

res = response();
await runtime.handleAdmin(request({ name: 'Stolen TV', contentMode: 'full_dashboard' }, '', 'PATCH'), res, new URL(`http://local/api/axoboard/displays/${displayId}`), otherSession);
assert.equal(res.status, 404, 'foreign workspace cannot update a display');

res = response();
await runtime.handleAdmin(request(), res, new URL(`http://local/api/axoboard/displays/${displayId}/revoke`), session);
assert.equal(res.status, 200);
assert.equal(res.payload.display.status, 'revoked');

res = response();
await runtime.handlePublic(request({}, displayCookie, 'GET'), res, new URL('http://local/api/display/runtime'));
assert.equal(res.status, 401, 'revoked device tokens stop working immediately');

res = response();
await runtime.handlePublic(request({}, displayCookie, 'GET'), res, new URL('http://local/api/display/status'));
assert.equal(res.status, 200);
assert.equal(res.payload.paired, false, 'revoked devices return to the pairing screen');

const disabledRuntime = createDisplayRuntime({
  pool,
  env: { AXOBOARD_DISPLAY_RUNTIME_ENABLED: 'false', AXOBOARD_DISPLAY_TOKEN_SECRET: randomBytes(32).toString('base64url') },
  sendJson,
  readJson: async (req) => req.body,
  sameOrigin: () => true,
  isRateLimited: () => false,
  loadWorkspaceDisplay: async () => ({})
});
assert.equal(disabledRuntime.ready, false, 'the runtime supports an emergency feature-flag rollback');

await pool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [[workspaceId, otherWorkspaceId]]);
await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[userId, otherUserId]]);
await pool.end();
console.log('AxoBoard display runtime test passed: one-time pairing, persistent token, remote configuration, revocation, and tenant isolation.');
