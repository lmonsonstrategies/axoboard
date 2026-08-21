import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { classifyAutomationWorkerHealth, createAutomationRuntime } from '../lib/automation-runtime.mjs';
import { integrationDatabase, recordDatabaseSuitePass } from './test-support.mjs';

const databaseUrl = integrationDatabase('automation');
if (!databaseUrl) {
  console.log('AxoBoard automation runtime test skipped: DATABASE_URL is not configured.');
  process.exit(0);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  max: 4
});

const ids = {
  workspace: randomUUID(), otherWorkspace: randomUUID(), owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), otherOwner: randomUUID(),
  connection: randomUUID(), otherConnection: randomUUID(), mapping: randomUUID(), structuredMapping: randomUUID(), otherMapping: randomUUID(),
  metric: randomUUID(), structuredMetric: randomUUID(), otherMetric: randomUUID(), targetDisplay: randomUUID(), otherDisplay: randomUUID()
};
let clockValue = new Date();
let deliveryFails = false;
const deliveries = [];

function response() {
  return {
    status: 0, headers: {}, payload: null,
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body = '') { this.payload = body ? JSON.parse(body) : null; }
  };
}
function sendJson(res, status, payload, headers = {}) { res.writeHead(status, headers); res.end(JSON.stringify(payload)); return payload; }
function request(method, body = {}) { return { method, body, headers: { origin: 'http://local.test', host: 'local.test' }, socket: { encrypted: false } }; }
async function api(runtime, method, path, session, body = {}) {
  const res = response();
  await runtime.handleAdmin(request(method, body), res, new URL(path, 'http://local.test'), session);
  return res;
}
async function expectPgCode(work, code, message) {
  let thrown = null;
  try { await work(); } catch (error) { thrown = error; }
  assert.ok(thrown, message);
  assert.equal(thrown.code, code, `${message}: unexpected PostgreSQL code`);
}

const owner = { id: ids.owner, workspace_id: ids.workspace, role: 'owner' };
const editor = { id: ids.editor, workspace_id: ids.workspace, role: 'editor' };
const viewer = { id: ids.viewer, workspace_id: ids.workspace, role: 'viewer' };
const otherOwner = { id: ids.otherOwner, workspace_id: ids.otherWorkspace, role: 'owner' };
const runtime = createAutomationRuntime({
  pool,
  env: {},
  sendJson,
  readJson: async (req) => req.body,
  sameOrigin: () => true,
  clock: () => new Date(clockValue),
  deliveryAdapter: async (delivery) => {
    deliveries.push(delivery);
    if (deliveryFails) { const error = new Error('Synthetic TV delivery failure.'); error.code = 'synthetic_delivery_failure'; throw error; }
    return { accepted: true, adapter: 'test' };
  }
});
assert.equal(runtime.ready, true);
const healthNow = new Date('2026-08-17T18:00:00.000Z');
assert.equal(classifyAutomationWorkerHealth({ ready: false, enabled: false, now: healthNow }), 'not_configured');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: false, now: healthNow }), 'disabled');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: true, dependenciesReady: false, now: healthNow }), 'dependency_unavailable');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: true, now: healthNow }), 'starting');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: true, lastErrorAt: new Date(healthNow.getTime() - 1_000), now: healthNow }), 'degraded');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: true, lastCompletedAt: new Date(healthNow.getTime() - 2_000), now: healthNow, intervalMs: 1_000 }), 'healthy');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: true, lastCompletedAt: new Date(healthNow.getTime() - 8_000), now: healthNow, intervalMs: 1_000 }), 'stale');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: true, lastStartedAt: new Date(healthNow.getTime() - 8_000), now: healthNow, intervalMs: 1_000 }), 'stale',
  'a started worker that never completes becomes stale');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: true, lastStartedAt: new Date(healthNow.getTime() - 1_000),
  lastCompletedAt: new Date(healthNow.getTime() - 8_000), now: healthNow, intervalMs: 1_000 }), 'healthy', 'a fresh tick start is a bounded liveness heartbeat');
assert.equal(classifyAutomationWorkerHealth({ ready: true, enabled: true, lastCompletedAt: new Date(healthNow.getTime() - 2_000),
  lastErrorAt: new Date(healthNow.getTime() - 1_000), now: healthNow }), 'degraded');

async function insertSnapshot(value, at, { workspaceId = ids.workspace, mappingId = ids.mapping, metricId = ids.metric } = {}) {
  const snapshotId = randomUUID();
  await pool.query(`INSERT INTO metric_snapshots
    (id,workspace_id,mapping_id,metric_id,value,source_row_count,source_range,lineage_hash,fetched_at)
    VALUES ($1,$2,$3,$4,$5,1,'A1',$6,$7)`, [snapshotId, workspaceId, mappingId, metricId, value, 'a'.repeat(64), at]);
  return snapshotId;
}

async function snapshotEvent(value, at) {
  const snapshotId = await insertSnapshot(value, at);
  const emitted = await runtime.emitMetricSnapshotEvent({ workspaceId: ids.workspace, metricId: ids.metric, snapshotId, value, occurredAt: at });
  return { snapshotId, ...emitted };
}

try {
  const migrationReady = await pool.query("SELECT to_regclass('public.automation_rules') AS table_name");
  assert.ok(migrationReady.rows[0].table_name, 'migration 013 must be applied before the runtime test');

  await pool.query(`INSERT INTO users (id,email,full_name,password_hash) VALUES
    ($1,$2,'Automation Owner','test'),($3,$4,'Automation Editor','test'),($5,$6,'Automation Viewer','test'),($7,$8,'Other Owner','test')`,
  [ids.owner, `automation-owner-${ids.owner}@example.test`, ids.editor, `automation-editor-${ids.editor}@example.test`,
    ids.viewer, `automation-viewer-${ids.viewer}@example.test`, ids.otherOwner, `automation-other-${ids.otherOwner}@example.test`]);
  await pool.query('INSERT INTO workspaces (id,name,timezone) VALUES ($1,$2,$3),($4,$5,$3)',
    [ids.workspace, 'Automation Test', 'America/Denver', ids.otherWorkspace, 'Other Automation Test']);
  await pool.query(`INSERT INTO memberships (id,workspace_id,user_id,role) VALUES
    ($1,$2,$3,'owner'),($4,$2,$5,'editor'),($6,$2,$7,'viewer'),($8,$9,$10,'owner')`,
  [randomUUID(), ids.workspace, ids.owner, randomUUID(), ids.editor, randomUUID(), ids.viewer,
    randomUUID(), ids.otherWorkspace, ids.otherOwner]);
  await pool.query(`INSERT INTO display_devices (id,workspace_id,name,status,created_by)
    VALUES ($1,$2,'Target TV','active',$3),($4,$2,'Other TV','active',$3)`,
  [ids.targetDisplay, ids.workspace, ids.owner, ids.otherDisplay]);
  const tokenBytes = Buffer.from('00', 'hex');
  await pool.query(`INSERT INTO integration_connections
    (id,workspace_id,provider,external_account_id,external_account_email,token_ciphertext,token_iv,token_auth_tag)
    VALUES ($1,$2,'google_sheets',$3,$4,$5,$5,$5),($6,$7,'google_sheets',$8,$9,$5,$5,$5)`,
  [ids.connection, ids.workspace, `account-${ids.workspace}`, `automation-${ids.workspace}@example.test`, tokenBytes,
    ids.otherConnection, ids.otherWorkspace, `account-${ids.otherWorkspace}`, `automation-${ids.otherWorkspace}@example.test`]);
  const mappingSql = `INSERT INTO kpi_mappings
    (id,workspace_id,connection_id,name,provider,spreadsheet_id,spreadsheet_title,sheet_id,sheet_title,a1_range,
     aggregation,display_format,display_type,range_roles,status,stale_after_seconds)
    VALUES ($1,$2,$3,$4,'google_sheets',$5,'Automation Sheet',1,'Metrics','A1',$6,'number',$7,'[]'::jsonb,'active',600)`;
  await pool.query(mappingSql, [ids.mapping, ids.workspace, ids.connection, 'Revenue', 'sheet-automation-main', 'single_value', 'scorecard']);
  await pool.query(mappingSql, [ids.structuredMapping, ids.workspace, ids.connection, 'Leaderboard', 'sheet-automation-structured', 'sum', 'leaderboard']);
  await pool.query(mappingSql, [ids.otherMapping, ids.otherWorkspace, ids.otherConnection, 'Other Revenue', 'sheet-automation-other', 'single_value', 'scorecard']);
  const metricSql = `INSERT INTO metric_definitions
    (id,workspace_id,mapping_id,semantic_key,name,unit,direction,definition,certification_status,certification_method,certified_at)
    VALUES ($1,$2,$3,$4,$5,'number','higher_is_better',$6,'certified','source_contract_v1',NOW())`;
  await pool.query(metricSql, [ids.metric, ids.workspace, ids.mapping, `test:${ids.metric}`, 'Revenue', 'Certified scalar revenue.']);
  await pool.query(metricSql, [ids.structuredMetric, ids.workspace, ids.structuredMapping, `test:${ids.structuredMetric}`, 'Leaderboard', 'Structured leaderboard.']);
  await pool.query(metricSql, [ids.otherMetric, ids.otherWorkspace, ids.otherMapping, `test:${ids.otherMetric}`, 'Other Revenue', 'Other tenant revenue.']);

  let res = await api(runtime, 'POST', '/api/axoboard/automation-destinations', editor,
    { name: 'Sales TVs', type: 'internal_tv_celebration', config: { displayIds: [ids.targetDisplay] } });
  assert.equal(res.status, 403, 'only admins can manage destinations');
  res = await api(runtime, 'POST', '/api/axoboard/automation-destinations', owner,
    { name: 'Sales TVs', type: 'internal_tv_celebration', config: { displayIds: [ids.targetDisplay] } });
  assert.equal(res.status, 201);
  const destinationId = res.payload.destination.id;
  const createBody = {
    name: 'Revenue crossed 100', metricId: ids.metric,
    trigger: { type: 'metric_threshold', operator: 'gte', thresholdMode: 'absolute', thresholdValue: 100, behavior: 'edge', durationSeconds: 60 },
    guardrails: { freshnessSeconds: 600, cooldownSeconds: 0, maxRunsPerDay: 20, timezone: 'America/Denver' },
    actions: [{ type: 'internal_tv_celebration', destinationId, config: { title: 'Revenue crossed 100', message: 'Nice work.', durationSeconds: 6, theme: 'brand', displayIds: [ids.otherDisplay] } }]
  };
  res = await api(runtime, 'POST', '/api/axoboard/automations', viewer, createBody);
  assert.equal(res.status, 403, 'viewers cannot create automations');
  res = await api(runtime, 'POST', '/api/axoboard/automations', editor, { ...createBody, metricId: ids.structuredMetric });
  assert.equal(res.status, 422);
  assert.equal(res.payload.code, 'scalar_metric_required', 'structured cards cannot silently use aggregate automation semantics');
  res = await api(runtime, 'POST', '/api/axoboard/automations', editor, {
    ...createBody, trigger: { ...createBody.trigger, selector: { kind: 'item', key: 'rep-1', label: 'Rep 1' } }
  });
  assert.equal(res.status, 422);
  assert.equal(res.payload.code, 'unsupported_selector', 'dimension selectors are rejected until snapshots support them');
  res = await api(runtime, 'POST', '/api/axoboard/automations', editor, createBody);
  assert.equal(res.status, 201);
  const ruleId = res.payload.automation.id;
  assert.equal(res.payload.automation.draftVersion.revision, 1);

  res = await api(runtime, 'GET', `/api/axoboard/automations/${ruleId}`, otherOwner);
  assert.equal(res.status, 404, 'cross-tenant reads do not reveal rule existence');
  res = await api(runtime, 'PATCH', `/api/axoboard/automations/${ruleId}`, editor, { revision: 1, metricId: ids.structuredMetric });
  assert.equal(res.status, 409);
  assert.equal(res.payload.code, 'metric_binding_immutable', 'draft PATCH cannot silently rebind a metric');
  res = await api(runtime, 'PATCH', `/api/axoboard/automations/${ruleId}`, editor, { revision: 99, name: 'Conflict' });
  assert.equal(res.status, 409);
  assert.equal(res.payload.code, 'revision_conflict');
  res = await api(runtime, 'PATCH', `/api/axoboard/automations/${ruleId}`, editor, { revision: 1, name: 'Revenue threshold celebration' });
  assert.equal(res.status, 200);
  assert.equal(res.payload.automation.draftVersion.revision, 2, 'draft updates use optimistic concurrency');

  const base = clockValue.getTime();
  await insertSnapshot(50, new Date(base - 3_600_000));
  await insertSnapshot(110, new Date(base - 3_500_000));
  await insertSnapshot(120, new Date(base - 3_400_000));
  const actionCountBeforeDryRun = Number((await pool.query('SELECT COUNT(*) AS count FROM automation_action_attempts WHERE workspace_id=$1', [ids.workspace])).rows[0].count);
  res = await api(runtime, 'POST', `/api/axoboard/automations/${ruleId}/dry-run`, editor, { lookbackDays: 1, limit: 100 });
  assert.equal(res.status, 200);
  assert.equal(res.payload.dryRun.matches, 1, 'duration-aware edge dry run matures once');
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM automation_action_attempts WHERE workspace_id=$1', [ids.workspace])).rows[0].count), actionCountBeforeDryRun,
    'dry run never creates action attempts');

  const beforePublish = await snapshotEvent(150, new Date(base - 1_000));
  res = await api(runtime, 'POST', `/api/axoboard/automations/${ruleId}/publish`, editor, { revision: 2 });
  assert.equal(res.status, 403, 'editors cannot publish');
  res = await api(runtime, 'POST', `/api/axoboard/automations/${ruleId}/publish`, owner, {});
  assert.equal(res.status, 422);
  assert.equal(res.payload.code, 'revision_required', 'publish requires the exact reviewed revision');
  res = await api(runtime, 'POST', `/api/axoboard/automations/${ruleId}/publish`, owner, { revision: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.payload.automation.state, 'active');
  assert.equal(res.payload.automation.publishedVersion.version, 1);
  assert.equal(res.payload.automation.draftVersion.version, 2);
  assert.match(res.payload.automation.publishedVersion.metricContractFingerprint, /^[a-f0-9]{64}$/);
  const publishedVersionId = res.payload.automation.publishedVersion.id;
  const draftVersionId = res.payload.automation.draftVersion.id;
  const publishedAction = (await pool.query(`SELECT * FROM automation_actions WHERE workspace_id=$1 AND rule_version_id=$2`, [ids.workspace, publishedVersionId])).rows[0];
  const draftAction = (await pool.query(`SELECT * FROM automation_actions WHERE workspace_id=$1 AND rule_version_id=$2`, [ids.workspace, draftVersionId])).rows[0];
  await expectPgCode(() => pool.query(`UPDATE automation_rule_versions SET trigger_config='{"type":"changed"}'::jsonb WHERE id=$1`, [publishedVersionId]), '55000', 'published version update is rejected');
  await expectPgCode(() => pool.query("UPDATE automation_rule_versions SET lifecycle='draft',published_at=NULL WHERE id=$1", [publishedVersionId]), '55000', 'published lifecycle cannot be reversed');
  await expectPgCode(() => pool.query(`INSERT INTO automation_actions
    (id,workspace_id,rule_version_id,position,action_type,config) VALUES ($1,$2,$3,2,'internal_tv_celebration','{}'::jsonb)`,
  [randomUUID(), ids.workspace, publishedVersionId]), '55000', 'published action insert is rejected');
  await expectPgCode(() => pool.query(`UPDATE automation_actions SET config='{}'::jsonb WHERE id=$1`, [publishedAction.id]), '55000', 'published action update is rejected');
  await expectPgCode(() => pool.query('DELETE FROM automation_actions WHERE id=$1', [publishedAction.id]), '55000', 'published action delete is rejected');
  await expectPgCode(() => pool.query('UPDATE automation_actions SET rule_version_id=$1 WHERE id=$2', [publishedVersionId, draftAction.id]), '55000',
    'a draft action cannot be moved into a published version');

  clockValue = new Date(base + 1_000);
  let eventWork = await runtime.processDueEvents();
  assert.equal(eventWork.processed, 1);
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1', [ids.workspace])).rows[0].count), 0,
    'activation cursor prevents pre-publish delivery');
  assert.equal((await pool.query('SELECT status FROM event_outbox WHERE event_id=$1', [beforePublish.event.id])).rows[0].status, 'processed');

  clockValue = new Date(base + 10_000);
  await snapshotEvent(80, clockValue); await runtime.processDueEvents();
  clockValue = new Date(base + 20_000);
  await snapshotEvent(120, clockValue); await runtime.processDueEvents();
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1', [ids.workspace])).rows[0].count), 0,
    'edge duration starts pending without an early run');
  clockValue = new Date(base + 90_000);
  const mature = await snapshotEvent(130, clockValue);
  const milestoneId = randomUUID();
  await pool.query(`INSERT INTO domain_events
    (id,workspace_id,event_type,idempotency_key,metric_id,source_snapshot_id,payload,occurred_at)
    VALUES ($1,$2,'goal.milestone.100',$3,$4,$5,'{"milestone":100}'::jsonb,$6)`,
  [milestoneId, ids.workspace, `milestone:${mature.snapshotId}`, ids.metric, mature.snapshotId, clockValue]);
  await pool.query(`INSERT INTO event_outbox (id,workspace_id,event_id,status) VALUES ($1,$2,$3,'pending')`, [randomUUID(), ids.workspace, milestoneId]);
  await runtime.processDueEvents();
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1 AND status='queued'", [ids.workspace])).rows[0].count), 1,
    'snapshot plus milestone produces one automation run');
  assert.equal((await pool.query('SELECT status FROM event_outbox WHERE event_id=$1', [milestoneId])).rows[0].status, 'pending',
    'milestone remains for its dedicated future consumer');
  await pool.query("UPDATE event_outbox SET status='pending',attempt_count=0,available_at=NOW() WHERE event_id=$1", [mature.event.id]);
  await runtime.processDueEvents();
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1', [ids.workspace])).rows[0].count), 1,
    'duplicate event replay is idempotent');
  clockValue = new Date(base + 100_000);
  await snapshotEvent(140, clockValue); await runtime.processDueEvents();
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1', [ids.workspace])).rows[0].count), 1,
    'matured edge does not repeat while value remains above threshold');

  const actionWork = await runtime.processDueActions();
  assert.equal(actionWork.succeeded, 1);
  assert.equal(deliveries.length, 1);
  assert.deepEqual(deliveries[0].config.displayIds, [ids.targetDisplay], 'destination targets override action-level display IDs');
  const successfulMetadata = (await pool.query(`SELECT response_metadata FROM automation_action_attempts
    WHERE workspace_id=$1 AND status='succeeded' ORDER BY completed_at LIMIT 1`, [ids.workspace])).rows[0].response_metadata;
  assert.equal(successfulMetadata.destinationId, destinationId);
  assert.deepEqual(successfulMetadata.targetDisplayIds, [ids.targetDisplay], 'effective destination targets are snapshotted for TV polling');
  const tvWrong = await runtime.listTvEvents(ids.workspace, { after: new Date(base).toISOString(), displayId: ids.otherDisplay });
  assert.equal(tvWrong.events.length, 0, 'targeted event is hidden from another display');
  assert.notEqual(tvWrong.cursor, null, 'cursor advances even when scanned TV events are filtered out');
  const tvWrongAgain = await runtime.listTvEvents(ids.workspace, { after: tvWrong.cursor, displayId: ids.otherDisplay });
  assert.equal(tvWrongAgain.events.length, 0);
  assert.equal(tvWrongAgain.cursor, tvWrong.cursor, 'filtered cursor does not loop over the same event');
  const tvRight = await runtime.listTvEvents(ids.workspace, { after: new Date(base).toISOString(), displayId: ids.targetDisplay });
  assert.equal(tvRight.events.length, 1);
  assert.equal(tvRight.events[0].title, 'Revenue crossed 100');
  assert.equal(tvRight.events[0].ruleName, 'Revenue threshold celebration');
  res = await api(runtime, 'PATCH', `/api/axoboard/automation-destinations/${destinationId}`, owner,
    { config: { displayIds: [ids.otherDisplay] } });
  assert.equal(res.status, 200);
  assert.equal((await runtime.listTvEvents(ids.workspace, { after: new Date(base).toISOString(), displayId: ids.targetDisplay })).events.length, 1,
    'later destination retargeting does not broaden or rewrite a completed delivery');
  assert.equal((await runtime.listTvEvents(ids.workspace, { after: new Date(base).toISOString(), displayId: ids.otherDisplay })).events.length, 0);
  res = await api(runtime, 'PATCH', `/api/axoboard/automation-destinations/${destinationId}`, owner, { status: 'disabled' });
  assert.equal(res.status, 200);
  assert.equal((await runtime.listTvEvents(ids.workspace, { after: new Date(base).toISOString(), displayId: ids.targetDisplay })).events.length, 0,
    'disabled destinations do not emit previously unpolled TV feed events');
  res = await api(runtime, 'PATCH', `/api/axoboard/automation-destinations/${destinationId}`, owner,
    { status: 'active', config: { displayIds: [ids.targetDisplay] } });
  assert.equal(res.status, 200);

  res = await api(runtime, 'GET', `/api/axoboard/metrics/${ids.metric}/automations`, owner);
  assert.equal(res.status, 200);
  assert.equal(res.payload.automations.length, 1, 'metric-linked listing returns tenant rule');
  res = await api(runtime, 'GET', '/api/axoboard/automations', viewer);
  assert.equal(res.status, 403, 'viewer reads are opt-in and disabled by default');

  const goalPercentCreate = await api(runtime, 'POST', '/api/axoboard/automations', editor, {
    ...createBody,
    name: 'Goal percent requires context',
    trigger: { ...createBody.trigger, thresholdMode: 'goal_percent', thresholdValue: 100, durationSeconds: 0 },
    actions: [{ type: 'internal_tv_celebration', config: { title: 'Goal reached', displayIds: [] } }]
  });
  assert.equal(goalPercentCreate.status, 201, 'goal-percent rules may be prepared as drafts');
  res = await api(runtime, 'POST', `/api/axoboard/automations/${goalPercentCreate.payload.automation.id}/publish`, owner, { revision: 1 });
  assert.equal(res.status, 422);
  assert.equal(res.payload.code, 'active_goal_required', 'goal-percent rules cannot activate without current goal context');

  res = await api(runtime, 'POST', '/api/axoboard/automation-destinations', owner,
    { name: 'Disabled destination', type: 'internal_tv_celebration', config: { displayIds: [ids.targetDisplay] } });
  const disabledDestinationId = res.payload.destination.id;
  const disabledCreate = await api(runtime, 'POST', '/api/axoboard/automations', editor, {
    ...createBody,
    name: 'Disabled destination rule',
    trigger: { ...createBody.trigger, behavior: 'level', durationSeconds: 0 },
    actions: [{ type: 'internal_tv_celebration', destinationId: disabledDestinationId,
      config: { title: 'Must not deliver', displayIds: [ids.otherDisplay] } }]
  });
  const disabledRuleId = disabledCreate.payload.automation.id;
  const disabledPublish = await api(runtime, 'POST', `/api/axoboard/automations/${disabledRuleId}/publish`, owner, { revision: 1 });
  const disabledPublishedVersionId = disabledPublish.payload.automation.publishedVersion.id;
  res = await api(runtime, 'PATCH', `/api/axoboard/automation-destinations/${disabledDestinationId}`, owner, { status: 'disabled' });
  assert.equal(res.status, 200);
  clockValue = new Date(base + 110_000);
  await snapshotEvent(150, clockValue); await runtime.processDueEvents();
  const deliveriesBeforeDisabled = deliveries.length;
  const disabledWork = await runtime.processDueActions();
  assert.ok(disabledWork.deadLettered >= 1, 'disabled destination is terminalized without adapter execution');
  assert.equal(deliveries.length, deliveriesBeforeDisabled, 'disabled destination never invokes the delivery adapter');
  const disabledAttempt = (await pool.query(`SELECT at.action_id,at.run_id,at.status,at.error_code,r.status AS run_status
    FROM automation_action_attempts at JOIN automation_runs r ON r.workspace_id=at.workspace_id AND r.id=at.run_id
    WHERE at.workspace_id=$1 AND r.rule_id=$2 ORDER BY at.created_at DESC LIMIT 1`, [ids.workspace, disabledRuleId])).rows[0];
  assert.equal(disabledAttempt.status, 'dead_letter');
  assert.equal(disabledAttempt.error_code, 'destination_disabled');
  assert.equal(disabledAttempt.run_status, 'dead_letter');
  res = await api(runtime, 'POST', `/api/axoboard/automations/${disabledRuleId}/archive`, editor, {});
  assert.equal(res.status, 403, 'editors cannot archive automations');
  res = await api(runtime, 'POST', `/api/axoboard/automations/${disabledRuleId}/archive`, owner, {});
  assert.equal(res.status, 200);
  assert.equal(res.payload.automation.state, 'archived');
  assert.equal((await pool.query('SELECT lifecycle FROM automation_rule_versions WHERE id=$1', [disabledPublishedVersionId])).rows[0].lifecycle, 'retired');
  res = await api(runtime, 'POST', `/api/axoboard/automation-runs/${disabledAttempt.run_id}/actions/${disabledAttempt.action_id}/retry`, owner, {});
  assert.equal(res.status, 409);
  assert.equal(res.payload.code, 'automation_archived', 'archived delivery attempts cannot be re-queued');
  const archivedRunCount = Number((await pool.query('SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1 AND rule_id=$2',
    [ids.workspace, disabledRuleId])).rows[0].count);
  clockValue = new Date(base + 115_000);
  await snapshotEvent(160, clockValue); await runtime.processDueEvents();
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1 AND rule_id=$2',
    [ids.workspace, disabledRuleId])).rows[0].count), archivedRunCount, 'archived rules cannot execute again');

  const versionBoundaryCreate = await api(runtime, 'POST', '/api/axoboard/automations', editor, {
    ...createBody, name: 'Version boundary isolation', trigger: { ...createBody.trigger, behavior: 'level', durationSeconds: 0 },
    actions: [{ type: 'internal_tv_celebration', config: { title: 'Version boundary', displayIds: [] } }]
  });
  const versionBoundaryRuleId = versionBoundaryCreate.payload.automation.id;
  const versionOnePublish = await api(runtime, 'POST', `/api/axoboard/automations/${versionBoundaryRuleId}/publish`, owner, { revision: 1 });
  const versionOneId = versionOnePublish.payload.automation.publishedVersion.id;
  const versionOneActionId = (await pool.query(`SELECT id FROM automation_actions WHERE workspace_id=$1 AND rule_version_id=$2`,
    [ids.workspace, versionOneId])).rows[0].id;
  const oldRunId = randomUUID();
  await pool.query(`INSERT INTO automation_runs
    (id,workspace_id,rule_id,rule_version_id,metric_id,idempotency_key,status,occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,'queued',$7)`,
  [oldRunId, ids.workspace, versionBoundaryRuleId, versionOneId, ids.metric, `version-boundary:${oldRunId}`, clockValue]);
  await pool.query(`INSERT INTO automation_action_attempts
    (id,workspace_id,run_id,action_id,idempotency_key,status,attempt_count,available_at)
    VALUES ($1,$2,$3,$4,$5,'pending',2,NOW()-INTERVAL '1 second')`,
  [randomUUID(), ids.workspace, oldRunId, versionOneActionId, `version-boundary-action:${oldRunId}`]);
  const versionTwoPublish = await api(runtime, 'POST', `/api/axoboard/automations/${versionBoundaryRuleId}/publish`, owner, { revision: 1 });
  assert.notEqual(versionTwoPublish.payload.automation.publishedVersion.id, versionOneId);
  deliveryFails = true;
  const oldVersionWork = await runtime.processDueActions();
  assert.ok(oldVersionWork.deadLettered >= 1, 'an already queued old-version delivery retains its independent outcome');
  deliveryFails = false;
  const versionBoundaryState = (await pool.query(`SELECT r.state,r.published_version_id,s.last_result,s.consecutive_failures
    FROM automation_rules r JOIN automation_rule_state s ON s.workspace_id=r.workspace_id AND s.rule_id=r.id
    WHERE r.workspace_id=$1 AND r.id=$2`, [ids.workspace, versionBoundaryRuleId])).rows[0];
  assert.equal(versionBoundaryState.state, 'active', 'an old-version terminal delivery cannot degrade the current version');
  assert.equal(versionBoundaryState.published_version_id, versionTwoPublish.payload.automation.publishedVersion.id);
  assert.equal(versionBoundaryState.last_result, 'published', 'an old-version outcome cannot overwrite current-version state');
  assert.equal(Number(versionBoundaryState.consecutive_failures), 0);

  const failureCreate = await api(runtime, 'POST', '/api/axoboard/automations', editor, {
    ...createBody, name: 'Failure path', trigger: { ...createBody.trigger, behavior: 'level', durationSeconds: 0 },
    actions: [{ type: 'internal_tv_celebration', config: { title: 'Failure path', displayIds: [] } }]
  });
  const failureRuleId = failureCreate.payload.automation.id;
  const failurePublish = await api(runtime, 'POST', `/api/axoboard/automations/${failureRuleId}/publish`, owner, { revision: 1 });
  const failureAction = (await pool.query(`SELECT id FROM automation_actions WHERE workspace_id=$1 AND rule_version_id=$2`,
    [ids.workspace, failurePublish.payload.automation.publishedVersion.id])).rows[0];
  clockValue = new Date(base + 120_000);
  await snapshotEvent(150, clockValue); await runtime.processDueEvents();
  deliveryFails = true;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const work = await runtime.processDueActions();
    if (attempt < 3) assert.ok(work.failed >= 1); else assert.ok(work.deadLettered >= 1);
    await pool.query("UPDATE automation_action_attempts SET available_at=NOW()-INTERVAL '1 second' WHERE workspace_id=$1 AND status='failed'", [ids.workspace]);
    clockValue = new Date(clockValue.getTime() + 60_000);
  }
  assert.equal((await pool.query('SELECT state FROM automation_rules WHERE id=$1', [failureRuleId])).rows[0].state, 'degraded');
  const failedRun = (await pool.query(`SELECT id FROM automation_runs WHERE workspace_id=$1 AND rule_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [ids.workspace, failureRuleId])).rows[0];
  res = await api(runtime, 'POST', `/api/axoboard/automation-runs/${failedRun.id}/actions/${failureAction.id}/retry`, editor);
  assert.equal(res.status, 403, 'editors cannot retry delivery');
  res = await api(runtime, 'POST', `/api/axoboard/automation-runs/${failedRun.id}/actions/${failureAction.id}/retry`, owner);
  assert.equal(res.status, 200);
  deliveryFails = false;
  const retryWork = await runtime.processDueActions();
  assert.ok(retryWork.succeeded >= 1, 'admin retry can recover a dead-lettered action');

  res = await api(runtime, 'POST', `/api/axoboard/automations/${failureRuleId}/resume`, owner, {});
  assert.equal(res.status, 200);
  assert.equal(res.payload.automation.state, 'active');
  res = await api(runtime, 'POST', `/api/axoboard/automations/${failureRuleId}/pause`, owner, {});
  assert.equal(res.status, 200);
  res = await api(runtime, 'POST', `/api/axoboard/automations/${failureRuleId}/resume`, owner, {});
  assert.equal(res.status, 200);

  clockValue = new Date(base + 400_000);
  await snapshotEvent(50, clockValue); await runtime.processDueEvents(); await runtime.processDueActions();
  const staleOccurredAt = new Date(base + 410_000);
  clockValue = new Date(base + 1_100_000);
  await snapshotEvent(150, staleOccurredAt); await runtime.processDueEvents();
  assert.ok(Number((await pool.query("SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1 AND reason_code='stale_metric'", [ids.workspace])).rows[0].count) >= 1,
    'stale crossings are suppressed');

  const queuedBeforeDriftRunId = randomUUID();
  await pool.query(`INSERT INTO automation_runs
    (id,workspace_id,rule_id,rule_version_id,metric_id,idempotency_key,status,occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,'queued',$7)`,
  [queuedBeforeDriftRunId, ids.workspace, ruleId, publishedVersionId, ids.metric, `queued-before-drift:${queuedBeforeDriftRunId}`, clockValue]);
  await pool.query(`INSERT INTO automation_action_attempts
    (id,workspace_id,run_id,action_id,idempotency_key,status,available_at)
    VALUES ($1,$2,$3,$4,$5,'pending',NOW()-INTERVAL '1 second')`,
  [randomUUID(), ids.workspace, queuedBeforeDriftRunId, publishedAction.id, `queued-before-drift-action:${queuedBeforeDriftRunId}`]);
  res = await api(runtime, 'POST', `/api/axoboard/automations/${versionBoundaryRuleId}/pause`, owner, {});
  assert.equal(res.status, 200);
  await pool.query("UPDATE kpi_mappings SET aggregation='sum',display_type='gauge' WHERE workspace_id=$1 AND id=$2", [ids.workspace, ids.mapping]);
  clockValue = new Date(base + 1_200_000);
  await snapshotEvent(160, clockValue); await runtime.processDueEvents();
  assert.ok(Number((await pool.query("SELECT COUNT(*) AS count FROM automation_runs WHERE workspace_id=$1 AND reason_code='metric_contract_changed'", [ids.workspace])).rows[0].count) >= 1,
    'aggregation/display drift invalidates the pinned metric contract');
  assert.equal((await pool.query('SELECT state FROM automation_rules WHERE id=$1', [ruleId])).rows[0].state, 'degraded');
  const queuedBeforeDriftWork = await runtime.processDueActions();
  assert.ok(queuedBeforeDriftWork.succeeded >= 1, 'a delivery queued before contract drift can finish independently');
  assert.equal((await pool.query('SELECT last_result FROM automation_rule_state WHERE workspace_id=$1 AND rule_id=$2',
    [ids.workspace, ruleId])).rows[0].last_result, 'metric_contract_changed',
  'a queued delivery success cannot erase the republish-required degradation cause');
  res = await api(runtime, 'POST', `/api/axoboard/automations/${ruleId}/resume`, owner, {});
  assert.equal(res.status, 409);
  assert.equal(res.payload.code, 'republish_required', 'contract-degraded rules cannot bypass review by resuming');
  res = await api(runtime, 'POST', `/api/axoboard/automations/${versionBoundaryRuleId}/resume`, owner, {});
  assert.equal(res.status, 409);
  assert.equal(res.payload.code, 'republish_required', 'resume recomputes contract drift that occurred while the rule was paused');

  const otherSnapshot = await insertSnapshot(999, clockValue, { workspaceId: ids.otherWorkspace, mappingId: ids.otherMapping, metricId: ids.otherMetric });
  await expectPgCode(() => pool.query(`INSERT INTO automation_runs
    (id,workspace_id,rule_id,rule_version_id,metric_id,source_snapshot_id,idempotency_key,status,occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'suppressed',$8)`,
  [randomUUID(), ids.workspace, ruleId, publishedVersionId, ids.metric, otherSnapshot, `cross-tenant:${randomUUID()}`, clockValue]), '23503',
  'cross-tenant snapshot references are rejected by a composite foreign key');

  const leaseRunId = randomUUID();
  await pool.query(`INSERT INTO automation_runs
    (id,workspace_id,rule_id,rule_version_id,metric_id,idempotency_key,status,occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,'processing',$7)`,
  [leaseRunId, ids.workspace, ruleId, publishedVersionId, ids.metric, `lease-run:${leaseRunId}`, clockValue]);
  await pool.query(`INSERT INTO automation_action_attempts
    (id,workspace_id,run_id,action_id,idempotency_key,status,attempt_count,available_at,lease_token,lease_expires_at)
    VALUES ($1,$2,$3,$4,$5,'processing',3,NOW()-INTERVAL '1 minute',$6,NOW()-INTERVAL '1 second')`,
  [randomUUID(), ids.workspace, leaseRunId, publishedAction.id, `lease-action:${leaseRunId}`, randomUUID()]);
  const recoveredActionLease = await runtime.processDueActions();
  assert.ok(recoveredActionLease.deadLettered >= 1);
  assert.equal((await pool.query('SELECT status FROM automation_runs WHERE id=$1', [leaseRunId])).rows[0].status, 'dead_letter',
    'expired final action lease is terminalized');

  const leasedEvent = await snapshotEvent(170, new Date(clockValue.getTime() + 1_000));
  await pool.query(`UPDATE event_outbox SET status='processing',attempt_count=3,lease_token=$1,lease_expires_at=NOW()-INTERVAL '1 second'
    WHERE event_id=$2`, [randomUUID(), leasedEvent.event.id]);
  const recoveredEventLease = await runtime.processDueEvents();
  assert.ok(recoveredEventLease.deadLettered >= 1);
  assert.equal((await pool.query('SELECT status FROM event_outbox WHERE event_id=$1', [leasedEvent.event.id])).rows[0].status, 'dead_letter',
    'expired final event lease is terminalized');

  res = await api(runtime, 'GET', '/api/axoboard/automation-runs?limit=100', owner);
  assert.equal(res.status, 200);
  assert.ok(res.payload.runs.length >= 1);
  const auditActions = new Set((await pool.query('SELECT action FROM audit_events WHERE workspace_id=$1', [ids.workspace])).rows.map((row) => row.action));
  for (const expected of ['automation.destination_created', 'automation.created', 'automation.draft_updated', 'automation.dry_run',
    'automation.published', 'automation.action_retried', 'automation.archived']) {
    assert.ok(auditActions.has(expected), `audit event ${expected} is persisted`);
  }

  const disabled = createAutomationRuntime({ pool, env: { AXOBOARD_AUTOMATION_CORE_ENABLED: 'false' }, sendJson, readJson: async (req) => req.body });
  assert.equal(disabled.ready, false);
  assert.equal((await disabled.processDueEvents()).disabled, true);
  res = await api(disabled, 'GET', '/api/axoboard/automations', owner);
  assert.equal(res.status, 503, 'feature flag disables routes and workers');

  recordDatabaseSuitePass('automation', { coverage: 'RBAC, tenant isolation, versions, workers, retries' });
  console.log('AxoBoard automation runtime test passed: RBAC, tenant isolation, immutable versions, dry-run, activation, duration, idempotency, drift, retries, leases, and TV events.');
} finally {
  await pool.query('DELETE FROM workspaces WHERE id=ANY($1::uuid[])', [[ids.workspace, ids.otherWorkspace]]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[ids.owner, ids.editor, ids.viewer, ids.otherOwner]]).catch(() => {});
  await pool.end();
}
