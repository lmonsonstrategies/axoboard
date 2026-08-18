import { createHash, randomUUID } from 'node:crypto';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const editorRoles = new Set(['owner', 'admin', 'editor']);
const adminRoles = new Set(['owner', 'admin']);
const operators = new Set(['gte', 'gt', 'lte', 'lt', 'eq']);
const thresholdModes = new Set(['absolute', 'goal_percent']);
const behaviors = new Set(['edge', 'level']);
const actionTypes = new Set(['internal_tv_celebration']);
const scalarDisplayTypes = new Set(['scorecard', 'goal_pace', 'gauge']);
const ruleStates = new Set(['draft', 'active', 'paused', 'degraded', 'archived']);
const runStates = new Set(['queued', 'processing', 'succeeded', 'failed', 'suppressed', 'dead_letter', 'canceled']);

export class AutomationError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function safeUuid(value, label = 'ID') {
  const id = String(value || '');
  if (!uuidPattern.test(id)) throw new AutomationError(422, 'invalid_id', `${label} was not accepted.`);
  return id;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new AutomationError(422, 'invalid_number', `${label} must be a finite number.`);
  return number;
}

function integerInRange(value, minimum, maximum, label, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new AutomationError(422, 'invalid_integer', `${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function normalizedName(value, label = 'Automation name') {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw new AutomationError(422, 'invalid_name', `${label} must be between 2 and 120 characters.`);
  return name;
}

function validTimezone(value) {
  const timezone = String(value || 'UTC');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()); }
  catch { throw new AutomationError(422, 'invalid_timezone', 'Choose a supported IANA timezone.'); }
  return timezone;
}

function clockTime(value, label) {
  const time = String(value || '');
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new AutomationError(422, 'invalid_quiet_hours', `${label} must use HH:MM in 24-hour time.`);
  return time;
}

function normalizeTrigger(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AutomationError(422, 'invalid_trigger', 'Trigger configuration must be an object.');
  if (input.selector !== undefined) throw new AutomationError(422, 'unsupported_selector', 'Item and column selectors require dimension-aware metric snapshots and are not available yet.');
  const type = String(input.type || 'metric_threshold');
  if (type !== 'metric_threshold') throw new AutomationError(422, 'unsupported_trigger', 'Only metric threshold triggers are available in this release.');
  const operator = String(input.operator || 'gte');
  if (!operators.has(operator)) throw new AutomationError(422, 'invalid_operator', 'Choose a supported threshold operator.');
  const thresholdMode = String(input.thresholdMode || input.threshold_mode || 'absolute');
  if (!thresholdModes.has(thresholdMode)) throw new AutomationError(422, 'invalid_threshold_mode', 'Choose absolute or goal percent threshold mode.');
  const behavior = String(input.behavior || 'edge');
  if (!behaviors.has(behavior)) throw new AutomationError(422, 'invalid_behavior', 'Choose edge crossing or level behavior.');
  return {
    type,
    operator,
    thresholdMode,
    thresholdValue: finiteNumber(input.thresholdValue ?? input.threshold_value, 'Threshold value'),
    behavior,
    durationSeconds: integerInRange(input.durationSeconds ?? input.duration_seconds, 0, 604800, 'Duration', 0)
  };
}

function normalizeGuardrails(input = {}, fallbackTimezone = 'UTC') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AutomationError(422, 'invalid_guardrails', 'Guardrails must be an object.');
  let quietHours = null;
  if (input.quietHours || input.quiet_hours) {
    const raw = input.quietHours || input.quiet_hours;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AutomationError(422, 'invalid_quiet_hours', 'Quiet hours must include start and end times.');
    quietHours = { start: clockTime(raw.start, 'Quiet-hours start'), end: clockTime(raw.end, 'Quiet-hours end') };
    if (quietHours.start === quietHours.end) throw new AutomationError(422, 'invalid_quiet_hours', 'Quiet-hours start and end must be different.');
  }
  const freshnessInput = input.freshnessSeconds ?? input.freshness_seconds;
  return {
    freshnessSeconds: freshnessInput === null || freshnessInput === undefined || freshnessInput === ''
      ? null
      : integerInRange(freshnessInput, 60, 604800, 'Freshness window', null),
    cooldownSeconds: integerInRange(input.cooldownSeconds ?? input.cooldown_seconds, 0, 604800, 'Cooldown', 0),
    maxRunsPerDay: integerInRange(input.maxRunsPerDay ?? input.max_runs_per_day, 1, 1000, 'Daily run limit', 20),
    quietHours,
    timezone: validTimezone(input.timezone || fallbackTimezone || 'UTC')
  };
}

function normalizeActionConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AutomationError(422, 'invalid_action_config', 'Action configuration must be an object.');
  const allowed = new Set(['title', 'message', 'theme', 'durationSeconds', 'displayIds']);
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length) throw new AutomationError(422, 'unsupported_action_config', 'Action configuration contains unsupported fields.', { fields: unknown });
  const title = String(input.title || 'Goal reached').trim();
  const message = String(input.message || '').trim();
  const theme = String(input.theme || 'brand').trim();
  if (!title || title.length > 120 || message.length > 500 || theme.length > 40) throw new AutomationError(422, 'invalid_action_config', 'TV celebration text or theme is outside the supported limits.');
  const displayIds = [...new Set((Array.isArray(input.displayIds) ? input.displayIds : []).map((id) => safeUuid(id, 'Display ID')))];
  if (displayIds.length > 100) throw new AutomationError(422, 'invalid_action_config', 'An action can target up to 100 displays.');
  return { title, message, theme, durationSeconds: integerInRange(input.durationSeconds, 2, 60, 'Celebration duration', 8), displayIds };
}

function normalizeActions(input = []) {
  if (!Array.isArray(input) || input.length > 20) throw new AutomationError(422, 'invalid_actions', 'Provide up to 20 automation actions.');
  return input.map((raw, index) => {
    const type = String(raw?.type || raw?.actionType || '');
    if (!actionTypes.has(type)) throw new AutomationError(422, 'unsupported_action', 'Only internal TV celebrations are available in this release.');
    return {
      id: raw.id && uuidPattern.test(String(raw.id)) ? String(raw.id) : randomUUID(),
      position: index + 1,
      type,
      destinationId: raw.destinationId ? safeUuid(raw.destinationId, 'Destination ID') : null,
      config: normalizeActionConfig(raw.config || {})
    };
  });
}

function normalizeDestinationConfig(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AutomationError(422, 'invalid_destination_config', 'Destination configuration must be an object.');
  const unknown = Object.keys(input).filter((key) => key !== 'displayIds');
  if (unknown.length) throw new AutomationError(422, 'unsupported_destination_config', 'Destination configuration contains unsupported fields.', { fields: unknown });
  const displayIds = [...new Set((Array.isArray(input.displayIds) ? input.displayIds : []).map((id) => safeUuid(id, 'Display ID')))];
  if (displayIds.length > 100) throw new AutomationError(422, 'invalid_destination_config', 'A destination can target up to 100 displays.');
  return { displayIds };
}

function compare(operator, value, threshold) {
  if (!Number.isFinite(value)) return false;
  if (operator === 'gte') return value >= threshold;
  if (operator === 'gt') return value > threshold;
  if (operator === 'lte') return value <= threshold;
  if (operator === 'lt') return value < threshold;
  return value === threshold;
}

function localParts(date, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function inQuietHours(date, guardrails) {
  if (!guardrails.quietHours) return false;
  const toMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const current = localParts(date, guardrails.timezone).minutes;
  const start = toMinutes(guardrails.quietHours.start);
  const end = toMinutes(guardrails.quietHours.end);
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function publicPermissions(session, allowViewerRead) {
  const canRead = editorRoles.has(session?.role) || (allowViewerRead && session?.role === 'viewer');
  return { canRead, canEdit: editorRoles.has(session?.role), canPublish: adminRoles.has(session?.role) };
}

function stableHash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

function safeDeliveryMetadata(value, { destinationId = null, targetDisplayIds = [] } = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const metadata = {
    accepted: input.accepted === true,
    destinationId: destinationId && uuidPattern.test(String(destinationId)) ? String(destinationId) : null,
    targetDisplayIds: [...new Set((Array.isArray(targetDisplayIds) ? targetDisplayIds : []).filter((id) => uuidPattern.test(String(id))).map(String))].slice(0, 100)
  };
  for (const key of ['mode', 'adapter', 'eventId']) {
    if (typeof input[key] === 'string' && input[key].length <= 160) metadata[key] = input[key];
  }
  return metadata;
}

function deliveryError(code, message, { nonRetryable = false } = {}) {
  const error = new Error(message);
  error.code = code;
  error.nonRetryable = nonRetryable;
  return error;
}

export function classifyAutomationWorkerHealth({
  ready,
  enabled,
  dependenciesReady = true,
  lastStartedAt,
  lastCompletedAt,
  lastErrorAt,
  now: healthNow = new Date(),
  intervalMs = 5_000
} = {}) {
  if (!ready) return 'not_configured';
  if (!enabled) return 'disabled';
  if (!dependenciesReady) return 'dependency_unavailable';
  const startedAt = lastStartedAt ? new Date(lastStartedAt) : null;
  const completedAt = lastCompletedAt ? new Date(lastCompletedAt) : null;
  const errorAt = lastErrorAt ? new Date(lastErrorAt) : null;
  const current = healthNow instanceof Date ? healthNow : new Date(healthNow);
  const safeInterval = Math.max(1_000, Math.min(60_000, Number(intervalMs) || 5_000));
  const freshnessWindowMs = Math.max(5_000, safeInterval * 3);
  if (!completedAt || Number.isNaN(completedAt.getTime())) {
    if (errorAt && !Number.isNaN(errorAt.getTime())) return 'degraded';
    if (startedAt && !Number.isNaN(startedAt.getTime()) && current.getTime() - startedAt.getTime() > freshnessWindowMs) return 'stale';
    return 'starting';
  }
  if (errorAt && !Number.isNaN(errorAt.getTime()) && errorAt > completedAt) return 'degraded';
  const latestActivityAt = startedAt && !Number.isNaN(startedAt.getTime()) && startedAt > completedAt ? startedAt : completedAt;
  if (Number.isNaN(current.getTime()) || current.getTime() - latestActivityAt.getTime() > freshnessWindowMs) return 'stale';
  return 'healthy';
}

async function metricContract(client, workspaceId, metricId) {
  const row = (await client.query(`SELECT m.id,m.mapping_id,m.semantic_key,m.name,m.data_type,m.unit,m.direction,m.definition,
      m.certification_status,m.certification_method,k.stale_after_seconds,w.timezone AS workspace_timezone,
      k.display_type,k.aggregation,k.a1_range,k.include_headers,k.range_roles,k.goal_source,
      k.comparison_a1_range,k.comparison_aggregation,k.comparison_include_headers,
      g.id AS goal_id,g.version AS goal_version,g.target_source,g.direction AS goal_direction,
      g.period_granularity,g.calendar_type,g.timezone AS goal_timezone
    FROM metric_definitions m
    JOIN kpi_mappings k ON k.workspace_id=m.workspace_id AND k.id=m.mapping_id
    JOIN workspaces w ON w.id=m.workspace_id
    LEFT JOIN goal_configs g ON g.workspace_id=m.workspace_id AND g.metric_id=m.id AND g.status='active'
    WHERE m.workspace_id=$1 AND m.id=$2 AND k.status<>'deleted' LIMIT 1`, [workspaceId, metricId])).rows[0];
  if (!row) throw new AutomationError(404, 'metric_not_found', 'Metric was not found in this workspace.');
  const contract = {
    semanticKey: row.semantic_key,
    dataType: row.data_type,
    unit: row.unit,
    direction: row.direction,
    definition: row.definition,
    certificationMethod: row.certification_method,
    calculation: {
      displayType: row.display_type,
      aggregation: row.aggregation,
      range: row.a1_range,
      includeHeaders: Boolean(row.include_headers),
      rangeRoles: row.range_roles || [],
      goalSource: row.goal_source,
      comparisonRange: row.comparison_a1_range || null,
      comparisonAggregation: row.comparison_aggregation || null,
      comparisonIncludeHeaders: Boolean(row.comparison_include_headers)
    },
    goal: row.goal_id ? {
      id: row.goal_id,
      version: Number(row.goal_version),
      targetSource: row.target_source,
      direction: row.goal_direction,
      periodGranularity: row.period_granularity,
      calendarType: row.calendar_type,
      timezone: row.goal_timezone
    } : null
  };
  return { row, contract, fingerprint: stableHash(contract) };
}

function requireScalarMetric(metric) {
  if (!scalarDisplayTypes.has(metric.row.display_type)) {
    throw new AutomationError(422, 'scalar_metric_required', 'Structured cards need a dedicated scalar KPI before they can trigger automations.',
      { displayType: metric.row.display_type });
  }
}

async function writeAudit(client, workspaceId, actorId, action, targetType, targetId, metadata = {}) {
  await client.query(`INSERT INTO audit_events (id,workspace_id,actor_user_id,action,target_type,target_id,metadata)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [randomUUID(), workspaceId, actorId || null, action, targetType, targetId || null, JSON.stringify(metadata)]);
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

function versionSummary(row, prefix) {
  const id = row[`${prefix}_version_id`];
  if (!id) return null;
  return {
    id,
    version: Number(row[`${prefix}_version_number`]),
    revision: Number(row[`${prefix}_revision`]),
    lifecycle: row[`${prefix}_lifecycle`],
    trigger: row[`${prefix}_trigger`] || {},
    guardrails: row[`${prefix}_guardrails`] || {},
    metricContractFingerprint: row[`${prefix}_metric_contract_fingerprint`] || null,
    publishedAt: row[`${prefix}_published_at`] || null
  };
}

function publicRule(row, actions = []) {
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    metric: { id: row.metric_id, mappingId: row.mapping_id, name: row.metric_name, unit: row.metric_unit },
    publishedVersion: versionSummary(row, 'published'),
    draftVersion: versionSummary(row, 'draft'),
    actions,
    actionCount: Number(row.action_count || actions.length || 0),
    lastRun: row.last_run_id ? { id: row.last_run_id, status: row.last_run_status, occurredAt: row.last_run_at } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const ruleSelect = `SELECT r.*,m.mapping_id,m.name AS metric_name,m.unit AS metric_unit,
  pv.id AS published_version_id,pv.version AS published_version_number,pv.revision AS published_revision,
  pv.lifecycle AS published_lifecycle,pv.trigger_config AS published_trigger,pv.guardrail_config AS published_guardrails,
  pv.metric_contract_fingerprint AS published_metric_contract_fingerprint,pv.published_at AS published_published_at,
  dv.id AS draft_version_id,dv.version AS draft_version_number,dv.revision AS draft_revision,
  dv.lifecycle AS draft_lifecycle,dv.trigger_config AS draft_trigger,dv.guardrail_config AS draft_guardrails,
  dv.metric_contract_fingerprint AS draft_metric_contract_fingerprint,dv.published_at AS draft_published_at,
  (SELECT COUNT(*) FROM automation_actions aa WHERE aa.workspace_id=r.workspace_id AND aa.rule_version_id=COALESCE(r.published_version_id,r.draft_version_id)) AS action_count,
  lr.id AS last_run_id,lr.status AS last_run_status,lr.occurred_at AS last_run_at
  FROM automation_rules r
  JOIN metric_definitions m ON m.workspace_id=r.workspace_id AND m.id=r.metric_id
  LEFT JOIN automation_rule_versions pv ON pv.workspace_id=r.workspace_id AND pv.id=r.published_version_id
  LEFT JOIN automation_rule_versions dv ON dv.workspace_id=r.workspace_id AND dv.id=r.draft_version_id
  LEFT JOIN LATERAL (SELECT id,status,occurred_at FROM automation_runs WHERE workspace_id=r.workspace_id AND rule_id=r.id ORDER BY occurred_at DESC LIMIT 1) lr ON TRUE`;

async function actionsForVersion(client, workspaceId, versionId) {
  if (!versionId) return [];
  const rows = (await client.query(`SELECT id,action_type,destination_id,position,config FROM automation_actions
    WHERE workspace_id=$1 AND rule_version_id=$2 ORDER BY position`, [workspaceId, versionId])).rows;
  return rows.map((row) => ({ id: row.id, type: row.action_type, destinationId: row.destination_id, position: row.position, config: row.config }));
}

async function detailedRule(client, workspaceId, ruleId, lock = false) {
  const suffix = lock ? ' FOR UPDATE OF r' : '';
  const row = (await client.query(`${ruleSelect} WHERE r.workspace_id=$1 AND r.id=$2${suffix}`, [workspaceId, ruleId])).rows[0];
  if (!row) throw new AutomationError(404, 'automation_not_found', 'Automation was not found in this workspace.');
  const versionId = row.draft_version_id || row.published_version_id;
  return publicRule(row, await actionsForVersion(client, workspaceId, versionId));
}

async function insertActions(client, workspaceId, versionId, actions) {
  for (const action of actions) {
    const displayIds = Array.isArray(action.config?.displayIds) ? action.config.displayIds : [];
    if (displayIds.length) {
      const displays = await client.query(`SELECT id FROM display_devices WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status<>'revoked'`,
        [workspaceId, displayIds]);
      if (displays.rowCount !== displayIds.length) throw new AutomationError(422, 'display_not_found', 'Action targets must be active displays in this workspace.');
    }
    if (action.destinationId) {
      const destination = await client.query(`SELECT 1 FROM automation_destinations WHERE workspace_id=$1 AND id=$2
        AND action_type=$3 AND status<>'disabled'`, [workspaceId, action.destinationId, action.type]);
      if (!destination.rowCount) throw new AutomationError(422, 'destination_not_found', 'Action destination was not found or is unavailable.');
    }
    await client.query(`INSERT INTO automation_actions (id,workspace_id,rule_version_id,destination_id,position,action_type,config)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [action.id, workspaceId, versionId, action.destinationId, action.position, action.type, JSON.stringify(action.config)]);
  }
}

export async function recordMetricSnapshotEvent(client, input = {}) {
  const workspaceId = safeUuid(input.workspaceId, 'Workspace ID');
  const metricId = safeUuid(input.metricId, 'Metric ID');
  const snapshotId = safeUuid(input.snapshotId, 'Snapshot ID');
  const value = finiteNumber(input.value, 'Metric value');
  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt || Date.now());
  if (Number.isNaN(occurredAt.getTime())) throw new AutomationError(422, 'invalid_event_time', 'Metric event time was not accepted.');
  const owned = await client.query(`SELECT 1 FROM metric_snapshots s JOIN metric_definitions m
    ON m.workspace_id=s.workspace_id AND m.id=s.metric_id
    WHERE s.workspace_id=$1 AND s.id=$2 AND s.metric_id=$3`, [workspaceId, snapshotId, metricId]);
  if (!owned.rowCount) throw new AutomationError(404, 'snapshot_not_found', 'Metric snapshot was not found in this workspace.');
  const idempotencyKey = `metric_snapshot:${snapshotId}:v1`;
  const payload = {
    value,
    goalPercent: input.goalPercent === null || input.goalPercent === undefined ? null : finiteNumber(input.goalPercent, 'Goal percent'),
    fetchedAt: occurredAt.toISOString()
  };
  const eventId = randomUUID();
  const inserted = await client.query(`INSERT INTO domain_events
    (id,workspace_id,event_type,idempotency_key,metric_id,source_snapshot_id,payload,occurred_at)
    VALUES ($1,$2,'metric.snapshot.recorded.v1',$3,$4,$5,$6::jsonb,$7)
    ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING *`,
  [eventId, workspaceId, idempotencyKey, metricId, snapshotId, JSON.stringify(payload), occurredAt]);
  const event = inserted.rows[0] || (await client.query('SELECT * FROM domain_events WHERE workspace_id=$1 AND idempotency_key=$2', [workspaceId, idempotencyKey])).rows[0];
  await client.query(`INSERT INTO event_outbox (id,workspace_id,event_id,status) VALUES ($1,$2,$3,'pending')
    ON CONFLICT (workspace_id,event_id) DO NOTHING`, [randomUUID(), workspaceId, event.id]);
  return { event, created: Boolean(inserted.rowCount) };
}

export function createAutomationRuntime({
  pool,
  env = process.env,
  sendJson,
  readJson,
  sameOrigin = () => true,
  deliveryAdapter,
  allowViewerRead = false,
  clock = () => new Date()
} = {}) {
  const enabled = env.AXOBOARD_AUTOMATION_CORE_ENABLED !== 'false';
  const ready = Boolean(enabled && pool);
  const deliver = typeof deliveryAdapter === 'function'
    ? deliveryAdapter
    : typeof deliveryAdapter?.deliver === 'function'
      ? deliveryAdapter.deliver.bind(deliveryAdapter)
      : async () => ({ accepted: true, mode: 'persisted_only' });

  function now() {
    const value = clock();
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('automation_clock_invalid');
    return date;
  }

  function requireReady() {
    if (!ready) throw new AutomationError(503, 'automation_unavailable', 'Automation is not available right now.');
  }

  function requireRead(session) {
    if (!publicPermissions(session, allowViewerRead).canRead) throw new AutomationError(403, 'automation_read_forbidden', 'Automation access is not available for this role.');
  }

  function requireEditor(session) {
    if (!editorRoles.has(session?.role)) throw new AutomationError(403, 'editor_required', 'Workspace editor access is required.');
  }

  function requireAdmin(session) {
    if (!adminRoles.has(session?.role)) throw new AutomationError(403, 'admin_required', 'Workspace admin access is required.');
  }

  function requireMutationOrigin(req) {
    if (!sameOrigin(req)) throw new AutomationError(403, 'origin_rejected', 'Request origin was not accepted.');
  }

  async function bodyFor(req) {
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AutomationError(400, 'invalid_json_object', 'Request body must be a JSON object.');
    return body;
  }

  async function ensureDisplayTargets(client, workspaceId, config) {
    const ids = Array.isArray(config?.displayIds) ? config.displayIds : [];
    if (!ids.length) return;
    const rows = await client.query(`SELECT id FROM display_devices WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status<>'revoked'`, [workspaceId, ids]);
    if (rows.rowCount !== ids.length) throw new AutomationError(422, 'display_not_found', 'Destination targets must be active displays in this workspace.');
  }

  async function listRules(res, url, session) {
    requireRead(session);
    const values = [session.workspace_id];
    const filters = ['r.workspace_id=$1'];
    const state = url.searchParams.get('status');
    if (state) {
      if (!ruleStates.has(state)) throw new AutomationError(422, 'invalid_status', 'Choose a supported automation status.');
      values.push(state); filters.push(`r.state=$${values.length}`);
    }
    const metricId = url.searchParams.get('metricId');
    if (metricId) { values.push(safeUuid(metricId, 'Metric ID')); filters.push(`r.metric_id=$${values.length}`); }
    const rows = (await pool.query(`${ruleSelect} WHERE ${filters.join(' AND ')} ORDER BY r.updated_at DESC LIMIT 500`, values)).rows;
    return sendJson(res, 200, { automations: rows.map((row) => publicRule(row)), permissions: publicPermissions(session, allowViewerRead) });
  }

  async function createRule(req, res, session) {
    requireEditor(session);
    const body = await bodyFor(req);
    const metricId = safeUuid(body.metricId, 'Metric ID');
    const ruleId = randomUUID();
    const versionId = randomUUID();
    const result = await transaction(pool, async (client) => {
      const metric = await metricContract(client, session.workspace_id, metricId);
      requireScalarMetric(metric);
      if (metric.row.certification_status !== 'certified') throw new AutomationError(409, 'metric_not_certified', 'Certify this metric before creating an automation.');
      const trigger = normalizeTrigger(body.trigger || {});
      const guardrails = normalizeGuardrails(body.guardrails || {}, metric.row.workspace_timezone);
      const actions = normalizeActions(body.actions || []);
      await client.query(`INSERT INTO automation_rules (id,workspace_id,metric_id,name,state,draft_version_id,created_by,updated_by)
        VALUES ($1,$2,$3,$4,'draft',NULL,$5,$5)`, [ruleId, session.workspace_id, metricId, normalizedName(body.name), session.id]);
      await client.query(`INSERT INTO automation_rule_versions
        (id,workspace_id,rule_id,version,revision,lifecycle,trigger_config,guardrail_config,created_by)
        VALUES ($1,$2,$3,1,1,'draft',$4::jsonb,$5::jsonb,$6)`,
      [versionId, session.workspace_id, ruleId, JSON.stringify(trigger), JSON.stringify(guardrails), session.id]);
      await insertActions(client, session.workspace_id, versionId, actions);
      await client.query('UPDATE automation_rules SET draft_version_id=$1 WHERE workspace_id=$2 AND id=$3', [versionId, session.workspace_id, ruleId]);
      await client.query(`INSERT INTO automation_rule_state (workspace_id,rule_id,last_result) VALUES ($1,$2,'draft')`, [session.workspace_id, ruleId]);
      await writeAudit(client, session.workspace_id, session.id, 'automation.created', 'automation_rule', ruleId, { metricId, version: 1 });
      return detailedRule(client, session.workspace_id, ruleId);
    });
    return sendJson(res, 201, { automation: result, permissions: publicPermissions(session, allowViewerRead) });
  }

  async function getRule(res, session, id) {
    requireRead(session);
    const automation = await detailedRule(pool, session.workspace_id, safeUuid(id, 'Automation ID'));
    return sendJson(res, 200, { automation, permissions: publicPermissions(session, allowViewerRead) });
  }

  async function updateDraft(req, res, session, id) {
    requireEditor(session);
    const body = await bodyFor(req);
    const ruleId = safeUuid(id, 'Automation ID');
    const requestedRevision = integerInRange(body.revision, 1, 2_147_483_647, 'Revision');
    const automation = await transaction(pool, async (client) => {
      const current = await detailedRule(client, session.workspace_id, ruleId, true);
      if (current.state === 'archived') throw new AutomationError(409, 'automation_archived', 'Archived automations cannot be edited.');
      if (!current.draftVersion) throw new AutomationError(409, 'draft_missing', 'This automation does not have an editable draft.');
      if (body.metricId !== undefined && safeUuid(body.metricId, 'Metric ID') !== current.metric.id) {
        throw new AutomationError(409, 'metric_binding_immutable', 'An automation cannot be rebound to another metric. Create a new automation instead.');
      }
      if (current.draftVersion.revision !== requestedRevision) {
        throw new AutomationError(409, 'revision_conflict', 'This automation draft changed. Reload it before saving.', { currentRevision: current.draftVersion.revision });
      }
      const trigger = body.trigger === undefined ? current.draftVersion.trigger : normalizeTrigger(body.trigger);
      const metric = await metricContract(client, session.workspace_id, current.metric.id);
      requireScalarMetric(metric);
      const guardrails = body.guardrails === undefined
        ? current.draftVersion.guardrails
        : normalizeGuardrails(body.guardrails, metric.row.workspace_timezone);
      const actions = body.actions === undefined ? null : normalizeActions(body.actions);
      const changed = await client.query(`UPDATE automation_rule_versions SET trigger_config=$1::jsonb,guardrail_config=$2::jsonb,
        revision=revision+1,metric_contract_fingerprint=NULL,updated_at=NOW()
        WHERE workspace_id=$3 AND id=$4 AND lifecycle='draft' AND revision=$5 RETURNING revision`,
      [JSON.stringify(trigger), JSON.stringify(guardrails), session.workspace_id, current.draftVersion.id, requestedRevision]);
      if (!changed.rowCount) throw new AutomationError(409, 'revision_conflict', 'This automation draft changed. Reload it before saving.');
      if (actions) {
        await client.query('DELETE FROM automation_actions WHERE workspace_id=$1 AND rule_version_id=$2', [session.workspace_id, current.draftVersion.id]);
        await insertActions(client, session.workspace_id, current.draftVersion.id, actions);
      }
      const name = body.name === undefined ? current.name : normalizedName(body.name);
      await client.query(`UPDATE automation_rules SET name=$1,updated_by=$2,updated_at=NOW()
        WHERE workspace_id=$3 AND id=$4`, [name, session.id, session.workspace_id, ruleId]);
      await writeAudit(client, session.workspace_id, session.id, 'automation.draft_updated', 'automation_rule', ruleId,
        { version: current.draftVersion.version, previousRevision: requestedRevision, revision: Number(changed.rows[0].revision) });
      return detailedRule(client, session.workspace_id, ruleId);
    });
    return sendJson(res, 200, { automation, permissions: publicPermissions(session, allowViewerRead) });
  }

  async function publishRule(req, res, session, id) {
    requireAdmin(session);
    const body = await bodyFor(req);
    const ruleId = safeUuid(id, 'Automation ID');
    const automation = await transaction(pool, async (client) => {
      const current = await detailedRule(client, session.workspace_id, ruleId, true);
      if (current.state === 'archived') throw new AutomationError(409, 'automation_archived', 'Archived automations cannot be published.');
      if (!current.draftVersion) throw new AutomationError(409, 'draft_missing', 'This automation does not have a publishable draft.');
      if (body.revision === undefined || body.revision === null) {
        throw new AutomationError(422, 'revision_required', 'Provide the reviewed draft revision before publishing.');
      }
      const reviewedRevision = integerInRange(body.revision, 1, 2_147_483_647, 'Revision');
      if (reviewedRevision !== current.draftVersion.revision) {
        throw new AutomationError(409, 'revision_conflict', 'This automation draft changed. Reload it before publishing.', { currentRevision: current.draftVersion.revision });
      }
      if (!current.actions.length) throw new AutomationError(422, 'action_required', 'Add at least one action before publishing.');
      const metric = await metricContract(client, session.workspace_id, current.metric.id);
      requireScalarMetric(metric);
      if (metric.row.certification_status !== 'certified') throw new AutomationError(409, 'metric_not_certified', 'The linked metric is not certified.');
      const reviewedTrigger = normalizeTrigger(current.draftVersion.trigger);
      if (reviewedTrigger.thresholdMode === 'goal_percent' && !metric.row.goal_id) {
        throw new AutomationError(422, 'active_goal_required', 'Goal-percent automations require an active goal for this metric.');
      }
      const publishedAt = now();
      const cursor = (await client.query(`SELECT id,occurred_at FROM domain_events WHERE workspace_id=$1 AND metric_id=$2
        AND occurred_at<=$3 ORDER BY occurred_at DESC,created_at DESC LIMIT 1`, [session.workspace_id, current.metric.id, publishedAt])).rows[0] || null;
      if (current.publishedVersion) {
        await client.query(`UPDATE automation_rule_versions SET lifecycle='retired',retired_at=$1,updated_at=$1
          WHERE workspace_id=$2 AND id=$3 AND lifecycle='published'`, [publishedAt, session.workspace_id, current.publishedVersion.id]);
      }
      const promoted = await client.query(`UPDATE automation_rule_versions SET lifecycle='published',metric_contract_fingerprint=$1,
        activation_cursor_at=$2,activation_cursor_event_id=$3,published_by=$4,published_at=$2,updated_at=$2
        WHERE workspace_id=$5 AND id=$6 AND lifecycle='draft' RETURNING *`,
      [metric.fingerprint, publishedAt, cursor?.id || null, session.id, session.workspace_id, current.draftVersion.id]);
      if (!promoted.rowCount) throw new AutomationError(409, 'draft_missing', 'This automation draft is no longer publishable.');
      const nextVersionId = randomUUID();
      await client.query(`INSERT INTO automation_rule_versions
        (id,workspace_id,rule_id,version,revision,lifecycle,trigger_config,guardrail_config,created_by)
        VALUES ($1,$2,$3,$4,1,'draft',$5::jsonb,$6::jsonb,$7)`,
      [nextVersionId, session.workspace_id, ruleId, current.draftVersion.version + 1,
        JSON.stringify(current.draftVersion.trigger), JSON.stringify(current.draftVersion.guardrails), session.id]);
      const clonedActions = current.actions.map((action, index) => ({ ...action, id: randomUUID(), position: index + 1 }));
      await insertActions(client, session.workspace_id, nextVersionId, clonedActions);
      await client.query(`UPDATE automation_rules SET state='active',published_version_id=$1,draft_version_id=$2,
        updated_by=$3,updated_at=$4 WHERE workspace_id=$5 AND id=$6`,
      [current.draftVersion.id, nextVersionId, session.id, publishedAt, session.workspace_id, ruleId]);
      await client.query(`UPDATE automation_rule_state SET last_event_id=NULL,last_event_at=NULL,last_value=NULL,last_goal_percent=NULL,
        condition_started_at=NULL,last_run_at=NULL,cooldown_until=NULL,daily_run_count=0,daily_run_date=NULL,last_result='published',updated_at=$1
        WHERE workspace_id=$2 AND rule_id=$3`, [publishedAt, session.workspace_id, ruleId]);
      await writeAudit(client, session.workspace_id, session.id, 'automation.published', 'automation_rule', ruleId,
        { version: current.draftVersion.version, revision: current.draftVersion.revision, metricContractFingerprint: metric.fingerprint, activationCursorAt: publishedAt.toISOString() });
      return detailedRule(client, session.workspace_id, ruleId);
    });
    return sendJson(res, 200, { automation, permissions: publicPermissions(session, allowViewerRead) });
  }

  async function setRuleState(res, session, id, targetState) {
    requireAdmin(session);
    const ruleId = safeUuid(id, 'Automation ID');
    const action = targetState === 'paused' ? 'automation.paused' : 'automation.resumed';
    const automation = await transaction(pool, async (client) => {
      const current = await detailedRule(client, session.workspace_id, ruleId, true);
      if (!current.publishedVersion) throw new AutomationError(409, 'automation_not_published', 'Publish this automation first.');
      if (targetState === 'paused' && !['active', 'degraded'].includes(current.state)) throw new AutomationError(409, 'invalid_state', 'Only active automations can be paused.');
      if (targetState === 'active' && !['paused', 'degraded'].includes(current.state)) throw new AutomationError(409, 'invalid_state', 'Only paused or degraded automations can be resumed.');
      if (targetState === 'active') {
        const metric = await metricContract(client, session.workspace_id, current.metric.id);
        if (metric.fingerprint !== current.publishedVersion.metricContractFingerprint) {
          throw new AutomationError(409, 'republish_required', 'The metric contract changed. Review and publish a new rule version before resuming.');
        }
        if (metric.row.certification_status !== 'certified') {
          throw new AutomationError(409, 'metric_not_certified', 'The linked metric is not certified.');
        }
        const trigger = normalizeTrigger(current.publishedVersion.trigger);
        if (trigger.thresholdMode === 'goal_percent' && !metric.row.goal_id) {
          throw new AutomationError(409, 'active_goal_required', 'Goal-percent automations require an active goal before resuming.');
        }
      }
      await client.query(`UPDATE automation_rules SET state=$1,updated_by=$2,updated_at=NOW() WHERE workspace_id=$3 AND id=$4`,
        [targetState, session.id, session.workspace_id, ruleId]);
      await client.query(`UPDATE automation_rule_state SET last_event_id=NULL,last_event_at=NULL,last_value=NULL,last_goal_percent=NULL,
        condition_started_at=NULL,consecutive_failures=CASE WHEN $1='active' THEN 0 ELSE consecutive_failures END,
        last_result=$1,updated_at=NOW() WHERE workspace_id=$2 AND rule_id=$3`, [targetState, session.workspace_id, ruleId]);
      await writeAudit(client, session.workspace_id, session.id, action, 'automation_rule', ruleId, { previousState: current.state, state: targetState });
      return detailedRule(client, session.workspace_id, ruleId);
    });
    return sendJson(res, 200, { automation, permissions: publicPermissions(session, allowViewerRead) });
  }

  async function archiveRule(res, session, id) {
    requireAdmin(session);
    const ruleId = safeUuid(id, 'Automation ID');
    const result = await transaction(pool, async (client) => {
      const current = await detailedRule(client, session.workspace_id, ruleId, true);
      if (current.state === 'archived') throw new AutomationError(409, 'automation_already_archived', 'This automation is already archived.');
      const archivedAt = now();
      if (current.publishedVersion) {
        await client.query(`UPDATE automation_rule_versions SET lifecycle='retired',retired_at=COALESCE(retired_at,$1),updated_at=$1
          WHERE workspace_id=$2 AND id=$3 AND lifecycle='published'`, [archivedAt, session.workspace_id, current.publishedVersion.id]);
      }
      const canceledAttempts = await client.query(`UPDATE automation_action_attempts SET status='canceled',lease_token=NULL,
        lease_expires_at=NULL,error_code='automation_archived',error_message='Automation was archived before delivery.',completed_at=$1,updated_at=$1
        WHERE workspace_id=$2 AND run_id IN (SELECT id FROM automation_runs WHERE workspace_id=$2 AND rule_id=$3)
          AND status IN ('pending','processing','failed')`, [archivedAt, session.workspace_id, ruleId]);
      const canceledRuns = await client.query(`UPDATE automation_runs SET status='canceled',completed_at=$1
        WHERE workspace_id=$2 AND rule_id=$3 AND status IN ('queued','processing','failed')`, [archivedAt, session.workspace_id, ruleId]);
      await client.query(`UPDATE automation_rules SET state='archived',archived_at=$1,updated_by=$2,updated_at=$1
        WHERE workspace_id=$3 AND id=$4`, [archivedAt, session.id, session.workspace_id, ruleId]);
      await client.query(`UPDATE automation_rule_state SET last_result='archived',condition_started_at=NULL,cooldown_until=NULL,updated_at=$1
        WHERE workspace_id=$2 AND rule_id=$3`, [archivedAt, session.workspace_id, ruleId]);
      await writeAudit(client, session.workspace_id, session.id, 'automation.archived', 'automation_rule', ruleId,
        { previousState: current.state, publishedVersion: current.publishedVersion?.version || null,
          canceledRuns: canceledRuns.rowCount, canceledAttempts: canceledAttempts.rowCount });
      return { automation: await detailedRule(client, session.workspace_id, ruleId), canceledRuns: canceledRuns.rowCount, canceledAttempts: canceledAttempts.rowCount };
    });
    return sendJson(res, 200, { ...result, permissions: publicPermissions(session, allowViewerRead) });
  }

  async function dryRun(req, res, session, id) {
    requireEditor(session);
    const body = await bodyFor(req);
    const ruleId = safeUuid(id, 'Automation ID');
    const lookbackDays = integerInRange(body.lookbackDays, 1, 365, 'Lookback days', 30);
    const limit = integerInRange(body.limit, 1, 5000, 'Snapshot limit', 1000);
    const rule = await detailedRule(pool, session.workspace_id, ruleId);
    const version = rule.draftVersion || rule.publishedVersion;
    if (!version) throw new AutomationError(409, 'version_missing', 'This automation has no rule version to test.');
    const rows = (await pool.query(`SELECT s.id,s.value,s.fetched_at,s.source_timestamp,e.attainment
      FROM metric_snapshots s
      LEFT JOIN goal_evaluations e ON e.workspace_id=s.workspace_id AND e.snapshot_id=s.id
      WHERE s.workspace_id=$1 AND s.metric_id=$2 AND s.fetched_at>=NOW()-($3::text||' days')::interval
      ORDER BY s.fetched_at ASC LIMIT $4`, [session.workspace_id, rule.metric.id, lookbackDays, limit])).rows;
    const trigger = normalizeTrigger(version.trigger);
    const guardrails = normalizeGuardrails(version.guardrails);
    let previous = null;
    let conditionStartedAt = null;
    let matches = 0;
    let suppressed = 0;
    const samples = [];
    const daily = new Map();
    let lastRunAt = null;
    for (const row of rows) {
      const at = new Date(row.fetched_at);
      const value = trigger.thresholdMode === 'goal_percent'
        ? (row.attainment === null || row.attainment === undefined ? NaN : Number(row.attainment) * 100)
        : Number(row.value);
      const met = compare(trigger.operator, value, trigger.thresholdValue);
      const freshCrossing = met && previous !== null && !compare(trigger.operator, previous, trigger.thresholdValue);
      const pendingCrossing = trigger.behavior === 'edge' && Boolean(conditionStartedAt);
      if (!met) conditionStartedAt = null;
      else if (trigger.behavior === 'level' && !conditionStartedAt) conditionStartedAt = at;
      else if (freshCrossing) conditionStartedAt = at;
      const edge = trigger.behavior === 'level' || freshCrossing || pendingCrossing;
      const durationMet = trigger.durationSeconds === 0 || (conditionStartedAt && at.getTime() - conditionStartedAt.getTime() >= trigger.durationSeconds * 1000);
      let reason = met && edge && durationMet ? 'matched' : met && edge ? 'duration_pending' : 'not_matched';
      const local = localParts(at, guardrails.timezone);
      const dayCount = daily.get(local.date) || 0;
      if (reason === 'matched' && inQuietHours(at, guardrails)) reason = 'quiet_hours';
      if (reason === 'matched' && lastRunAt && guardrails.cooldownSeconds && at.getTime() < lastRunAt.getTime() + guardrails.cooldownSeconds * 1000) reason = 'cooldown';
      if (reason === 'matched' && dayCount >= guardrails.maxRunsPerDay) reason = 'daily_cap';
      if (reason === 'matched') { matches += 1; daily.set(local.date, dayCount + 1); lastRunAt = at; if (trigger.behavior === 'edge') conditionStartedAt = null; }
      else if (!['not_matched', 'duration_pending'].includes(reason)) { suppressed += 1; if (trigger.behavior === 'edge') conditionStartedAt = null; }
      if (samples.length < 100 && reason !== 'not_matched') samples.push({ snapshotId: row.id, value, at: at.toISOString(), result: reason });
      previous = value;
    }
    await pool.query(`INSERT INTO audit_events (id,workspace_id,actor_user_id,action,target_type,target_id,metadata)
      VALUES ($1,$2,$3,'automation.dry_run','automation_rule',$4,$5::jsonb)`,
    [randomUUID(), session.workspace_id, session.id, ruleId, JSON.stringify({ version: version.version, lookbackDays, evaluated: rows.length, matches, suppressed })]);
    return sendJson(res, 200, { dryRun: { evaluated: rows.length, matches, suppressed, samples } });
  }

  async function emitMetricSnapshotEvent(input) {
    requireReady();
    return transaction(pool, (client) => recordMetricSnapshotEvent(client, input));
  }

  async function insertRun(client, rule, event, status, reason, values, evaluation = {}) {
    const runId = randomUUID();
    const idempotencyKey = `automation:${rule.version_id}:event:${event.id}`;
    const inserted = await client.query(`INSERT INTO automation_runs
      (id,workspace_id,rule_id,rule_version_id,metric_id,source_event_id,source_snapshot_id,idempotency_key,status,
       trigger_value,previous_value,reason_code,evaluation,occurred_at,started_at,completed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,
        CASE WHEN $9='queued' THEN NOW() ELSE NULL END,CASE WHEN $9='suppressed' THEN NOW() ELSE NULL END)
      ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING *`,
    [runId, rule.workspace_id, rule.rule_id, rule.version_id, rule.metric_id, event.id, event.source_snapshot_id || null,
      idempotencyKey, status, values.current, values.previous, reason, JSON.stringify(evaluation), event.occurred_at]);
    if (!inserted.rowCount) return null;
    if (status === 'queued') {
      const actions = (await client.query(`SELECT id FROM automation_actions WHERE workspace_id=$1 AND rule_version_id=$2 ORDER BY position`,
        [rule.workspace_id, rule.version_id])).rows;
      for (const action of actions) {
        await client.query(`INSERT INTO automation_action_attempts
          (id,workspace_id,run_id,action_id,idempotency_key,status,available_at)
          VALUES ($1,$2,$3,$4,$5,'pending',NOW()) ON CONFLICT (workspace_id,run_id,action_id) DO NOTHING`,
        [randomUUID(), rule.workspace_id, runId, action.id, `automation_action:${runId}:${action.id}`]);
      }
    }
    return inserted.rows[0];
  }

  async function evaluateRuleEvent(client, rule, event, evaluationNow, contract) {
    const trigger = normalizeTrigger(rule.trigger_config);
    const guardrails = normalizeGuardrails(rule.guardrail_config, contract.row.workspace_timezone);
    const occurredAt = new Date(event.occurred_at);
    if (rule.activation_cursor_at && occurredAt <= new Date(rule.activation_cursor_at)) return { result: 'before_activation_cursor' };
    let state = (await client.query(`SELECT * FROM automation_rule_state WHERE workspace_id=$1 AND rule_id=$2 FOR UPDATE`,
      [rule.workspace_id, rule.rule_id])).rows[0];
    if (!state) {
      state = (await client.query(`INSERT INTO automation_rule_state (workspace_id,rule_id,last_result)
        VALUES ($1,$2,'initialized') RETURNING *`, [rule.workspace_id, rule.rule_id])).rows[0];
    }
    if (state.last_event_id === event.id) return { result: 'duplicate' };
    if (state.last_event_at && occurredAt < new Date(state.last_event_at)) return { result: 'out_of_order' };
    const absoluteValue = Number(event.payload?.value ?? event.payload?.actualValue);
    let goalPercent = event.payload?.goalPercent;
    if (goalPercent === null || goalPercent === undefined) {
      if (event.payload?.attainment !== null && event.payload?.attainment !== undefined) goalPercent = Number(event.payload.attainment) * 100;
      else if (event.source_snapshot_id) {
        const goal = (await client.query(`SELECT attainment FROM goal_evaluations WHERE workspace_id=$1 AND snapshot_id=$2 LIMIT 1`,
          [rule.workspace_id, event.source_snapshot_id])).rows[0];
        if (goal) goalPercent = Number(goal.attainment) * 100;
      }
    }
    const current = trigger.thresholdMode === 'goal_percent' ? Number(goalPercent) : absoluteValue;
    const previous = trigger.thresholdMode === 'goal_percent'
      ? (state.last_goal_percent === null ? null : Number(state.last_goal_percent))
      : (state.last_value === null ? null : Number(state.last_value));
    const baseStateValues = [event.id, occurredAt, Number.isFinite(absoluteValue) ? absoluteValue : null,
      Number.isFinite(Number(goalPercent)) ? Number(goalPercent) : null, evaluationNow, rule.workspace_id, rule.rule_id];

    if (rule.metric_contract_fingerprint !== contract.fingerprint) {
      await insertRun(client, rule, event, 'suppressed', 'metric_contract_changed', { current: Number.isFinite(current) ? current : null, previous },
        { expected: rule.metric_contract_fingerprint, actual: contract.fingerprint });
      await client.query(`UPDATE automation_rule_state SET last_event_id=$1,last_event_at=$2,last_value=$3,last_goal_percent=$4,
        last_result='metric_contract_changed',suppressed_count=suppressed_count+1,updated_at=$5 WHERE workspace_id=$6 AND rule_id=$7`, baseStateValues);
      await client.query(`UPDATE automation_rules SET state='degraded',updated_at=$1 WHERE workspace_id=$2 AND id=$3 AND state='active'`,
        [evaluationNow, rule.workspace_id, rule.rule_id]);
      await writeAudit(client, rule.workspace_id, null, 'automation.metric_contract_changed', 'automation_rule', rule.rule_id,
        { ruleVersionId: rule.version_id, expected: rule.metric_contract_fingerprint, actual: contract.fingerprint });
      return { result: 'metric_contract_changed', suppressed: true };
    }
    if (!Number.isFinite(current)) {
      await insertRun(client, rule, event, 'suppressed', 'goal_context_unavailable', { current: null, previous });
      await client.query(`UPDATE automation_rule_state SET last_event_id=$1,last_event_at=$2,last_value=$3,last_goal_percent=$4,
        last_result='goal_context_unavailable',suppressed_count=suppressed_count+1,updated_at=$5 WHERE workspace_id=$6 AND rule_id=$7`, baseStateValues);
      return { result: 'goal_context_unavailable', suppressed: true };
    }
    const met = compare(trigger.operator, current, trigger.thresholdValue);
    const freshCrossing = met && previous !== null && !compare(trigger.operator, previous, trigger.thresholdValue);
    const pendingCrossing = trigger.behavior === 'edge' && state.last_result === 'duration_pending' && Boolean(state.condition_started_at);
    let conditionStartedAt = null;
    if (met && trigger.behavior === 'level') conditionStartedAt = state.condition_started_at ? new Date(state.condition_started_at) : occurredAt;
    else if (pendingCrossing) conditionStartedAt = new Date(state.condition_started_at);
    else if (freshCrossing) conditionStartedAt = occurredAt;
    const durationMet = trigger.durationSeconds === 0 || (conditionStartedAt && occurredAt.getTime() - conditionStartedAt.getTime() >= trigger.durationSeconds * 1000);
    const crossed = trigger.behavior === 'level' || freshCrossing || pendingCrossing;
    if (!met || !crossed || !durationMet) {
      const result = met && crossed ? 'duration_pending' : previous === null && trigger.behavior === 'edge' ? 'baseline' : 'not_matched';
      await client.query(`UPDATE automation_rule_state SET last_event_id=$1,last_event_at=$2,last_value=$3,last_goal_percent=$4,
        condition_started_at=$5,last_result=$6,updated_at=$7 WHERE workspace_id=$8 AND rule_id=$9`,
      [event.id, occurredAt, Number.isFinite(absoluteValue) ? absoluteValue : null, Number.isFinite(Number(goalPercent)) ? Number(goalPercent) : null,
        conditionStartedAt, result, evaluationNow, rule.workspace_id, rule.rule_id]);
      return { result };
    }
    let suppression = null;
    const freshnessSeconds = guardrails.freshnessSeconds ?? Number(contract.row.stale_after_seconds || 900);
    if (contract.row.certification_status !== 'certified') suppression = 'metric_not_certified';
    else if (evaluationNow.getTime() - occurredAt.getTime() > freshnessSeconds * 1000) suppression = 'stale_metric';
    else if (inQuietHours(evaluationNow, guardrails)) suppression = 'quiet_hours';
    else if (state.cooldown_until && evaluationNow < new Date(state.cooldown_until)) suppression = 'cooldown';
    const localDate = localParts(evaluationNow, guardrails.timezone).date;
    const dailyCount = String(state.daily_run_date || '').slice(0, 10) === localDate ? Number(state.daily_run_count) : 0;
    if (!suppression && dailyCount >= guardrails.maxRunsPerDay) suppression = 'daily_cap';
    if (suppression) {
      await insertRun(client, rule, event, 'suppressed', suppression, { current, previous }, { freshnessSeconds });
      await client.query(`UPDATE automation_rule_state SET last_event_id=$1,last_event_at=$2,last_value=$3,last_goal_percent=$4,
        condition_started_at=$5,last_result=$6,suppressed_count=suppressed_count+1,updated_at=$7
        WHERE workspace_id=$8 AND rule_id=$9`, [event.id, occurredAt, Number.isFinite(absoluteValue) ? absoluteValue : null,
        Number.isFinite(Number(goalPercent)) ? Number(goalPercent) : null, trigger.behavior === 'edge' ? null : conditionStartedAt,
        suppression, evaluationNow, rule.workspace_id, rule.rule_id]);
      return { result: suppression, suppressed: true };
    }
    const run = await insertRun(client, rule, event, 'queued', 'threshold_matched', { current, previous },
      { operator: trigger.operator, thresholdMode: trigger.thresholdMode, thresholdValue: trigger.thresholdValue, behavior: trigger.behavior });
    const cooldownUntil = guardrails.cooldownSeconds ? new Date(evaluationNow.getTime() + guardrails.cooldownSeconds * 1000) : null;
    await client.query(`UPDATE automation_rule_state SET last_event_id=$1,last_event_at=$2,last_value=$3,last_goal_percent=$4,
      condition_started_at=$5,last_run_at=$6,cooldown_until=$7,daily_run_date=$8,daily_run_count=$9,last_result=$10,updated_at=$6
      WHERE workspace_id=$11 AND rule_id=$12`, [event.id, occurredAt, Number.isFinite(absoluteValue) ? absoluteValue : null,
      Number.isFinite(Number(goalPercent)) ? Number(goalPercent) : null, trigger.behavior === 'edge' ? null : conditionStartedAt,
      evaluationNow, cooldownUntil, localDate,
      dailyCount + (run ? 1 : 0), run ? 'queued' : 'duplicate', rule.workspace_id, rule.rule_id]);
    return { result: run ? 'queued' : 'duplicate', runId: run?.id || null };
  }

  async function evaluateEvent(event) {
    if (event.event_type !== 'metric.snapshot.recorded.v1') return { ignored: true, rules: 0 };
    return transaction(pool, async (client) => {
      const rules = (await client.query(`SELECT r.workspace_id,r.id AS rule_id,r.metric_id,v.id AS version_id,v.trigger_config,
          v.guardrail_config,v.activation_cursor_at,v.metric_contract_fingerprint
        FROM automation_rules r JOIN automation_rule_versions v
          ON v.workspace_id=r.workspace_id AND v.id=r.published_version_id AND v.lifecycle='published'
        WHERE r.workspace_id=$1 AND r.metric_id=$2 AND r.state='active' ORDER BY r.created_at FOR UPDATE OF r`,
      [event.workspace_id, event.metric_id])).rows;
      if (!rules.length) return { ignored: false, rules: 0, results: [] };
      const contract = await metricContract(client, event.workspace_id, event.metric_id);
      const results = [];
      for (const rule of rules) results.push(await evaluateRuleEvent(client, rule, event, now(), contract));
      return { ignored: false, rules: rules.length, results };
    });
  }

  async function processDueEvents({ limit = 25, workerId = randomUUID() } = {}) {
    if (!ready) return { disabled: true, claimed: 0, processed: 0, failed: 0, deadLettered: 0 };
    const safeLimit = integerInRange(limit, 1, 200, 'Event batch size', 25);
    const workerToken = uuidPattern.test(String(workerId)) ? String(workerId) : randomUUID();
    const claimTime = now();
    const claimedBatch = await transaction(pool, async (client) => {
      const expired = (await client.query(`SELECT o.id AS outbox_id,e.id AS event_id,e.workspace_id,e.metric_id,o.attempt_count
        FROM event_outbox o JOIN domain_events e ON e.workspace_id=o.workspace_id AND e.id=o.event_id
        WHERE e.event_type='metric.snapshot.recorded.v1' AND o.status='processing' AND o.attempt_count>=3
          AND o.lease_expires_at<=$1 ORDER BY o.lease_expires_at,o.created_at LIMIT $2 FOR UPDATE OF o SKIP LOCKED`, [claimTime, safeLimit])).rows;
      for (const row of expired) {
        await client.query(`UPDATE event_outbox SET status='dead_letter',lease_token=NULL,lease_expires_at=NULL,
          last_error_code='lease_expired_after_final_attempt',updated_at=$1 WHERE workspace_id=$2 AND id=$3`,
        [claimTime, row.workspace_id, row.outbox_id]);
        if (row.metric_id) await client.query(`UPDATE automation_rules SET state='degraded',updated_at=$1
          WHERE workspace_id=$2 AND metric_id=$3 AND state='active'`, [claimTime, row.workspace_id, row.metric_id]);
        await writeAudit(client, row.workspace_id, null, 'automation.event_dead_lettered', 'domain_event', row.event_id,
          { errorCode: 'lease_expired_after_final_attempt', attempts: Number(row.attempt_count) });
      }
      const rows = (await client.query(`SELECT o.id AS outbox_id,o.attempt_count,e.*
        FROM event_outbox o JOIN domain_events e ON e.workspace_id=o.workspace_id AND e.id=o.event_id
        WHERE e.event_type='metric.snapshot.recorded.v1' AND o.attempt_count<3 AND o.available_at<=$1 AND (
          o.status IN ('pending','failed') OR (o.status='processing' AND o.lease_expires_at<=$1)
        ) AND NOT EXISTS (
          SELECT 1 FROM event_outbox older_o JOIN domain_events older_e
            ON older_e.workspace_id=older_o.workspace_id AND older_e.id=older_o.event_id
          WHERE older_e.workspace_id=e.workspace_id AND older_e.metric_id=e.metric_id
            AND older_e.event_type='metric.snapshot.recorded.v1'
            AND older_o.status IN ('pending','failed','processing')
            AND (older_e.occurred_at<e.occurred_at
              OR (older_e.occurred_at=e.occurred_at AND older_e.created_at<e.created_at)
              OR (older_e.occurred_at=e.occurred_at AND older_e.created_at=e.created_at AND older_e.id<e.id))
        ) ORDER BY o.available_at,e.occurred_at,o.created_at LIMIT $2 FOR UPDATE OF o SKIP LOCKED`, [claimTime, safeLimit])).rows;
      for (const row of rows) {
        await client.query(`UPDATE event_outbox SET status='processing',attempt_count=attempt_count+1,lease_token=$1,
          lease_expires_at=$2,updated_at=$3 WHERE id=$4 AND workspace_id=$5`,
        [workerToken, new Date(claimTime.getTime() + 60_000), claimTime, row.outbox_id, row.workspace_id]);
      }
      return { rows, expired };
    });
    const summary = { disabled: false, claimed: claimedBatch.rows.length, processed: 0, failed: 0,
      deadLettered: claimedBatch.expired.length, evaluations: [] };
    for (const event of claimedBatch.rows) {
      try {
        const evaluation = await evaluateEvent(event);
        await pool.query(`UPDATE event_outbox SET status='processed',processed_at=$1,lease_token=NULL,lease_expires_at=NULL,
          last_error_code=NULL,updated_at=$1 WHERE id=$2 AND workspace_id=$3 AND lease_token=$4`,
        [now(), event.outbox_id, event.workspace_id, workerToken]);
        summary.processed += 1;
        summary.evaluations.push({ eventId: event.id, ...evaluation });
      } catch (error) {
        const latest = (await pool.query('SELECT attempt_count FROM event_outbox WHERE workspace_id=$1 AND id=$2', [event.workspace_id, event.outbox_id])).rows[0];
        const attempts = Number(latest?.attempt_count || event.attempt_count + 1);
        const terminal = attempts >= 3;
        const failureTime = now();
        await transaction(pool, async (client) => {
          await client.query(`UPDATE event_outbox SET status=$1,available_at=$2,lease_token=NULL,lease_expires_at=NULL,
            last_error_code=$3,updated_at=$4 WHERE id=$5 AND workspace_id=$6 AND lease_token=$7`,
          [terminal ? 'dead_letter' : 'failed', new Date(failureTime.getTime() + (2 ** attempts) * 15_000),
            String(error.code || 'automation_evaluation_failed').slice(0, 120), failureTime, event.outbox_id, event.workspace_id, workerToken]);
          if (terminal && event.metric_id) {
            await client.query(`UPDATE automation_rules SET state='degraded',updated_at=$1
              WHERE workspace_id=$2 AND metric_id=$3 AND state='active'`, [failureTime, event.workspace_id, event.metric_id]);
            await writeAudit(client, event.workspace_id, null, 'automation.event_dead_lettered', 'domain_event', event.id,
              { errorCode: String(error.code || 'automation_evaluation_failed'), attempts });
          }
        });
        if (terminal) summary.deadLettered += 1; else summary.failed += 1;
      }
    }
    return summary;
  }

  async function refreshRunState(client, workspaceId, runId, at) {
    const counts = (await client.query(`SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status='succeeded')::int AS succeeded,
        COUNT(*) FILTER (WHERE status='dead_letter')::int AS dead,
        COUNT(*) FILTER (WHERE status='failed')::int AS failed
      FROM automation_action_attempts WHERE workspace_id=$1 AND run_id=$2`, [workspaceId, runId])).rows[0];
    let status = 'processing';
    if (Number(counts.dead) > 0) status = 'dead_letter';
    else if (Number(counts.failed) > 0) status = 'failed';
    else if (Number(counts.total) > 0 && Number(counts.succeeded) === Number(counts.total)) status = 'succeeded';
    await client.query(`UPDATE automation_runs SET status=$1,started_at=COALESCE(started_at,$2),
      completed_at=CASE WHEN $1 IN ('succeeded','dead_letter') THEN $2 ELSE NULL END WHERE workspace_id=$3 AND id=$4`,
    [status, at, workspaceId, runId]);
    return status;
  }

  async function processDueActions({ limit = 25, workerId = randomUUID() } = {}) {
    if (!ready) return { disabled: true, claimed: 0, succeeded: 0, failed: 0, deadLettered: 0 };
    const safeLimit = integerInRange(limit, 1, 200, 'Action batch size', 25);
    const workerToken = uuidPattern.test(String(workerId)) ? String(workerId) : randomUUID();
    const claimTime = now();
    const claimedBatch = await transaction(pool, async (client) => {
      const expiredCandidates = (await client.query(`SELECT at.id,at.workspace_id,at.run_id,at.action_id,at.attempt_count,r.rule_id,r.rule_version_id
        FROM automation_action_attempts at JOIN automation_runs r ON r.workspace_id=at.workspace_id AND r.id=at.run_id
        WHERE at.status='processing' AND at.attempt_count>=3 AND at.lease_expires_at<=$1
        ORDER BY at.lease_expires_at,at.created_at,at.id LIMIT $2`, [claimTime, safeLimit])).rows;
      const expired = [];
      for (const row of expiredCandidates) {
        const lockedRule = (await client.query(`SELECT state,published_version_id FROM automation_rules
          WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [row.workspace_id, row.rule_id])).rows[0];
        const terminalized = await client.query(`UPDATE automation_action_attempts SET status='dead_letter',lease_token=NULL,lease_expires_at=NULL,
          error_code='lease_expired_after_final_attempt',error_message='Worker lease expired during the final delivery attempt.',
          completed_at=$1,updated_at=$1 WHERE workspace_id=$2 AND id=$3 AND status='processing'
            AND attempt_count>=3 AND lease_expires_at<=$1 RETURNING id`, [claimTime, row.workspace_id, row.id]);
        if (!terminalized.rowCount) continue;
        expired.push(row);
        await refreshRunState(client, row.workspace_id, row.run_id, claimTime);
        const affectsCurrentVersion = lockedRule?.state === 'active'
          && lockedRule.published_version_id === row.rule_version_id;
        if (affectsCurrentVersion) {
          await client.query(`UPDATE automation_rules SET state='degraded',updated_at=$1 WHERE workspace_id=$2 AND id=$3`,
            [claimTime, row.workspace_id, row.rule_id]);
          await client.query(`UPDATE automation_rule_state SET consecutive_failures=consecutive_failures+1,
            last_result='dead_letter',updated_at=$1 WHERE workspace_id=$2 AND rule_id=$3`, [claimTime, row.workspace_id, row.rule_id]);
        }
        await writeAudit(client, row.workspace_id, null, 'automation.delivery_dead_lettered', 'automation_rule', row.rule_id,
          { runId: row.run_id, ruleVersionId: row.rule_version_id, actionId: row.action_id,
            errorCode: 'lease_expired_after_final_attempt', attempts: Number(row.attempt_count), affectedCurrentVersion: affectsCurrentVersion });
      }
      const rows = (await client.query(`SELECT a.id,a.workspace_id,a.run_id,a.action_id,a.attempt_count
        FROM automation_action_attempts a
        JOIN automation_runs claimed_run ON claimed_run.workspace_id=a.workspace_id AND claimed_run.id=a.run_id
        JOIN automation_rules claimed_rule ON claimed_rule.workspace_id=claimed_run.workspace_id AND claimed_rule.id=claimed_run.rule_id
        WHERE a.attempt_count<3 AND a.available_at<=$1 AND (
          a.status IN ('pending','failed') OR (a.status='processing' AND a.lease_expires_at<=$1)
        ) AND claimed_rule.state<>'archived'
        ORDER BY a.available_at,a.created_at LIMIT $2 FOR UPDATE OF a SKIP LOCKED`, [claimTime, safeLimit])).rows;
      for (const row of rows) {
        await client.query(`UPDATE automation_action_attempts SET status='processing',attempt_count=attempt_count+1,
          lease_token=$1,lease_expires_at=$2,started_at=COALESCE(started_at,$3),updated_at=$3
          WHERE workspace_id=$4 AND id=$5`, [workerToken, new Date(claimTime.getTime() + 60_000), claimTime, row.workspace_id, row.id]);
        await client.query(`UPDATE automation_runs SET status='processing',started_at=COALESCE(started_at,$1)
          WHERE workspace_id=$2 AND id=$3 AND status='queued'`, [claimTime, row.workspace_id, row.run_id]);
      }
      return { rows, expired };
    });
    const summary = { disabled: false, claimed: claimedBatch.rows.length, succeeded: 0, failed: 0,
      deadLettered: claimedBatch.expired.length, canceled: 0 };
    for (const claimedAttempt of claimedBatch.rows) {
      const detail = (await pool.query(`SELECT at.*,a.action_type,a.config AS action_config,a.destination_id,
          r.rule_id,r.rule_version_id,r.metric_id,r.trigger_value,r.previous_value,r.occurred_at,
          ar.name AS rule_name,d.status AS destination_status,d.config AS destination_config,d.updated_at AS destination_updated_at
        FROM automation_action_attempts at
        JOIN automation_actions a ON a.workspace_id=at.workspace_id AND a.id=at.action_id
        JOIN automation_runs r ON r.workspace_id=at.workspace_id AND r.id=at.run_id
        JOIN automation_rules ar ON ar.workspace_id=r.workspace_id AND ar.id=r.rule_id
        LEFT JOIN automation_destinations d ON d.workspace_id=a.workspace_id AND d.id=a.destination_id
        WHERE at.workspace_id=$1 AND at.id=$2 AND at.lease_token=$3 LIMIT 1`,
      [claimedAttempt.workspace_id, claimedAttempt.id, workerToken])).rows[0];
      if (!detail) continue;
      try {
        if (detail.destination_id && detail.destination_status !== 'active') {
          throw deliveryError(detail.destination_status ? 'destination_disabled' : 'destination_missing',
            'The automation destination is not active.', { nonRetryable: true });
        }
        const effectiveDisplayIds = detail.destination_id
          ? (Array.isArray(detail.destination_config?.displayIds) ? detail.destination_config.displayIds : [])
          : (Array.isArray(detail.action_config?.displayIds) ? detail.action_config.displayIds : []);
        const response = await deliver({
          idempotencyKey: detail.idempotency_key,
          workspaceId: detail.workspace_id,
          type: detail.action_type,
          config: { ...detail.action_config, displayIds: effectiveDisplayIds },
          destination: detail.destination_id ? { id: detail.destination_id, status: detail.destination_status, config: detail.destination_config || {} } : null,
          run: { id: detail.run_id, ruleId: detail.rule_id, ruleVersionId: detail.rule_version_id, metricId: detail.metric_id,
            value: detail.trigger_value === null ? null : Number(detail.trigger_value), occurredAt: detail.occurred_at },
          rule: { id: detail.rule_id, name: detail.rule_name }
        });
        const metadata = safeDeliveryMetadata(response, { destinationId: detail.destination_id, targetDisplayIds: effectiveDisplayIds });
        await transaction(pool, async (client) => {
          const finishedAt = now();
          const lockedRule = (await client.query(`SELECT state,published_version_id FROM automation_rules
            WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [detail.workspace_id, detail.rule_id])).rows[0];
          if (detail.destination_id) {
            const destination = (await client.query(`SELECT status,updated_at FROM automation_destinations
              WHERE workspace_id=$1 AND id=$2 FOR SHARE`, [detail.workspace_id, detail.destination_id])).rows[0];
            if (!destination || destination.status !== 'active') {
              throw deliveryError(destination ? 'destination_disabled' : 'destination_missing', 'The automation destination is not active.', { nonRetryable: true });
            }
            if (new Date(destination.updated_at).getTime() !== new Date(detail.destination_updated_at).getTime()) {
              throw deliveryError('destination_changed', 'The automation destination changed during delivery.');
            }
          }
          const updated = await client.query(`UPDATE automation_action_attempts SET status='succeeded',lease_token=NULL,lease_expires_at=NULL,
            error_code=NULL,error_message=NULL,response_metadata=$1::jsonb,completed_at=$2,updated_at=$2
            WHERE workspace_id=$3 AND id=$4 AND lease_token=$5`,
          [JSON.stringify(metadata), finishedAt, detail.workspace_id, detail.id, workerToken]);
          if (!updated.rowCount) throw deliveryError('attempt_lease_lost', 'The action attempt lease is no longer active.', { nonRetryable: true });
          const runStatus = await refreshRunState(client, detail.workspace_id, detail.run_id, finishedAt);
          const affectsCurrentVersion = lockedRule?.state === 'active'
            && lockedRule.published_version_id === detail.rule_version_id;
          if (runStatus === 'succeeded' && affectsCurrentVersion) {
            await client.query(`UPDATE automation_rule_state SET consecutive_failures=0,last_result='succeeded',updated_at=$1
              WHERE workspace_id=$2 AND rule_id=$3`, [finishedAt, detail.workspace_id, detail.rule_id]);
          }
        });
        summary.succeeded += 1;
      } catch (error) {
        const attempts = Number(detail.attempt_count);
        const terminal = error.nonRetryable === true || attempts >= 3;
        const failureApplied = await transaction(pool, async (client) => {
          const failedAt = now();
          const lockedRule = (await client.query(`SELECT state,published_version_id FROM automation_rules
            WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [detail.workspace_id, detail.rule_id])).rows[0];
          const failed = await client.query(`UPDATE automation_action_attempts SET status=$1,available_at=$2,lease_token=NULL,lease_expires_at=NULL,
            error_code=$3,error_message=$4,completed_at=CASE WHEN $1::text='dead_letter' THEN $5::timestamptz ELSE NULL END,updated_at=$5::timestamptz
            WHERE workspace_id=$6 AND id=$7 AND lease_token=$8 RETURNING id`,
          [terminal ? 'dead_letter' : 'failed', new Date(failedAt.getTime() + (2 ** attempts) * 15_000),
            String(error.code || 'delivery_failed').slice(0, 120), String(error.message || 'Delivery failed.').slice(0, 500), failedAt,
            detail.workspace_id, detail.id, workerToken]);
          if (!failed.rowCount) return false;
          await refreshRunState(client, detail.workspace_id, detail.run_id, failedAt);
          const affectsCurrentVersion = lockedRule?.state === 'active'
            && lockedRule.published_version_id === detail.rule_version_id;
          if (affectsCurrentVersion) {
            await client.query(`UPDATE automation_rule_state SET consecutive_failures=consecutive_failures+1,last_result=$1,updated_at=$2
              WHERE workspace_id=$3 AND rule_id=$4`, [terminal ? 'dead_letter' : 'delivery_failed', failedAt, detail.workspace_id, detail.rule_id]);
            if (terminal) {
              await client.query(`UPDATE automation_rules SET state='degraded',updated_at=$1 WHERE workspace_id=$2 AND id=$3`,
                [failedAt, detail.workspace_id, detail.rule_id]);
            }
          }
          if (terminal) {
            await writeAudit(client, detail.workspace_id, null, 'automation.delivery_dead_lettered', 'automation_rule', detail.rule_id,
              { runId: detail.run_id, ruleVersionId: detail.rule_version_id, actionId: detail.action_id,
                errorCode: String(error.code || 'delivery_failed'), attempts, affectedCurrentVersion: affectsCurrentVersion });
          }
          return true;
        });
        if (!failureApplied) summary.canceled += 1;
        else if (terminal) summary.deadLettered += 1;
        else summary.failed += 1;
      }
    }
    return summary;
  }

  async function listRuns(res, url, session) {
    requireRead(session);
    const values = [session.workspace_id];
    const filters = ['r.workspace_id=$1'];
    const automationId = url.searchParams.get('automationId');
    if (automationId) { values.push(safeUuid(automationId, 'Automation ID')); filters.push(`r.rule_id=$${values.length}`); }
    const status = url.searchParams.get('status');
    if (status) {
      if (!runStates.has(status)) throw new AutomationError(422, 'invalid_status', 'Choose a supported run status.');
      values.push(status); filters.push(`r.status=$${values.length}`);
    }
    const limit = integerInRange(url.searchParams.get('limit'), 1, 200, 'Run limit', 50);
    values.push(limit);
    const rows = (await pool.query(`SELECT r.*,ar.name AS automation_name,m.name AS metric_name
      FROM automation_runs r JOIN automation_rules ar ON ar.workspace_id=r.workspace_id AND ar.id=r.rule_id
      JOIN metric_definitions m ON m.workspace_id=r.workspace_id AND m.id=r.metric_id
      WHERE ${filters.join(' AND ')} ORDER BY r.occurred_at DESC,r.created_at DESC LIMIT $${values.length}`, values)).rows;
    const runIds = rows.map((row) => row.id);
    const attempts = runIds.length ? (await pool.query(`SELECT at.*,a.action_type,a.config
      FROM automation_action_attempts at JOIN automation_actions a ON a.workspace_id=at.workspace_id AND a.id=at.action_id
      WHERE at.workspace_id=$1 AND at.run_id=ANY($2::uuid[]) ORDER BY at.created_at`, [session.workspace_id, runIds])).rows : [];
    const byRun = new Map();
    for (const attempt of attempts) {
      const item = {
        id: attempt.id, actionId: attempt.action_id, type: attempt.action_type, status: attempt.status,
        attemptCount: Number(attempt.attempt_count), errorCode: attempt.error_code, error: attempt.error_message,
        availableAt: attempt.available_at, completedAt: attempt.completed_at, config: attempt.config,
        responseMetadata: attempt.response_metadata || {}
      };
      byRun.set(attempt.run_id, [...(byRun.get(attempt.run_id) || []), item]);
    }
    return sendJson(res, 200, { runs: rows.map((row) => ({
      id: row.id, automationId: row.rule_id, automationName: row.automation_name, metricId: row.metric_id, metricName: row.metric_name,
      status: row.status, triggerValue: row.trigger_value === null ? null : Number(row.trigger_value),
      previousValue: row.previous_value === null ? null : Number(row.previous_value), reason: row.reason_code,
      evaluation: row.evaluation, occurredAt: row.occurred_at, completedAt: row.completed_at, actions: byRun.get(row.id) || []
    })) });
  }

  async function retryAction(req, res, session, runIdInput, actionIdInput) {
    requireAdmin(session);
    const runId = safeUuid(runIdInput, 'Run ID');
    const actionId = safeUuid(actionIdInput, 'Action ID');
    const attempt = await transaction(pool, async (client) => {
      const row = (await client.query(`SELECT at.*,r.rule_id,ar.state AS rule_state FROM automation_action_attempts at
        JOIN automation_runs r ON r.workspace_id=at.workspace_id AND r.id=at.run_id
        JOIN automation_rules ar ON ar.workspace_id=r.workspace_id AND ar.id=r.rule_id
        WHERE at.workspace_id=$1 AND at.run_id=$2 AND at.action_id=$3 FOR UPDATE OF at,ar`,
      [session.workspace_id, runId, actionId])).rows[0];
      if (!row) throw new AutomationError(404, 'action_attempt_not_found', 'Action attempt was not found in this workspace.');
      if (row.rule_state === 'archived') throw new AutomationError(409, 'automation_archived', 'Archived automations cannot retry delivery.');
      if (!['failed', 'dead_letter'].includes(row.status)) throw new AutomationError(409, 'action_not_retryable', 'Only failed actions can be retried.');
      const retried = (await client.query(`UPDATE automation_action_attempts SET status='pending',attempt_count=$1,available_at=$2,
        lease_token=NULL,lease_expires_at=NULL,error_code=NULL,error_message=NULL,completed_at=NULL,updated_at=$2
        WHERE workspace_id=$3 AND id=$4 RETURNING *`, [row.status === 'dead_letter' ? 0 : row.attempt_count, now(), session.workspace_id, row.id])).rows[0];
      await client.query(`UPDATE automation_runs SET status='queued',completed_at=NULL WHERE workspace_id=$1 AND id=$2`, [session.workspace_id, runId]);
      await writeAudit(client, session.workspace_id, session.id, 'automation.action_retried', 'automation_action_attempt', row.id,
        { runId, actionId, previousStatus: row.status, previousAttempts: Number(row.attempt_count) });
      return retried;
    });
    return sendJson(res, 200, { attempt: { id: attempt.id, runId: attempt.run_id, actionId: attempt.action_id,
      status: attempt.status, attemptCount: Number(attempt.attempt_count), availableAt: attempt.available_at } });
  }

  async function metricRules(res, session, metricIdInput) {
    requireRead(session);
    const metricId = safeUuid(metricIdInput, 'Metric ID');
    const metric = await metricContract(pool, session.workspace_id, metricId);
    const rows = (await pool.query(`${ruleSelect} WHERE r.workspace_id=$1 AND r.metric_id=$2 AND r.state<>'archived' ORDER BY r.updated_at DESC`,
      [session.workspace_id, metricId])).rows;
    return sendJson(res, 200, { metric: { id: metric.row.id, mappingId: metric.row.mapping_id, name: metric.row.name, unit: metric.row.unit },
      automations: rows.map((row) => publicRule(row)), permissions: publicPermissions(session, allowViewerRead) });
  }

  async function listDestinations(res, session) {
    requireRead(session);
    const rows = (await pool.query(`SELECT id,name,action_type,status,config,created_at,updated_at
      FROM automation_destinations WHERE workspace_id=$1 ORDER BY name`, [session.workspace_id])).rows;
    return sendJson(res, 200, { destinations: rows.map((row) => ({ id: row.id, name: row.name, type: row.action_type,
      status: row.status, config: row.config, createdAt: row.created_at, updatedAt: row.updated_at })), permissions: publicPermissions(session, allowViewerRead) });
  }

  async function createDestination(req, res, session) {
    requireAdmin(session);
    const body = await bodyFor(req);
    const type = String(body.type || 'internal_tv_celebration');
    if (!actionTypes.has(type)) throw new AutomationError(422, 'unsupported_destination', 'Only internal TV destinations are available in this release.');
    if (body.credentialEnvelope || body.code || body.script || body.url) throw new AutomationError(422, 'unsupported_destination_secret', 'This destination does not accept credentials, code, or URLs.');
    const id = randomUUID();
    const row = await transaction(pool, async (client) => {
      const config = normalizeDestinationConfig(body.config || {});
      await ensureDisplayTargets(client, session.workspace_id, config);
      const inserted = (await client.query(`INSERT INTO automation_destinations
        (id,workspace_id,name,action_type,status,config,created_by,updated_by) VALUES ($1,$2,$3,$4,'active',$5::jsonb,$6,$6) RETURNING *`,
      [id, session.workspace_id, normalizedName(body.name, 'Destination name'), type, JSON.stringify(config), session.id])).rows[0];
      await writeAudit(client, session.workspace_id, session.id, 'automation.destination_created', 'automation_destination', id, { type });
      return inserted;
    });
    return sendJson(res, 201, { destination: { id: row.id, name: row.name, type: row.action_type, status: row.status, config: row.config } });
  }

  async function updateDestination(req, res, session, idInput) {
    requireAdmin(session);
    const body = await bodyFor(req);
    if (body.credentialEnvelope || body.code || body.script || body.url) throw new AutomationError(422, 'unsupported_destination_secret', 'This destination does not accept credentials, code, or URLs.');
    const id = safeUuid(idInput, 'Destination ID');
    const row = await transaction(pool, async (client) => {
      const existing = (await client.query(`SELECT * FROM automation_destinations WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [session.workspace_id, id])).rows[0];
      if (!existing) throw new AutomationError(404, 'destination_not_found', 'Destination was not found in this workspace.');
      const status = body.status === undefined ? existing.status : String(body.status);
      if (!['active', 'disabled'].includes(status)) throw new AutomationError(422, 'invalid_destination_status', 'Choose active or disabled.');
      const config = body.config === undefined ? existing.config : normalizeDestinationConfig(body.config);
      await ensureDisplayTargets(client, session.workspace_id, config);
      const updated = (await client.query(`UPDATE automation_destinations SET name=$1,status=$2,config=$3::jsonb,updated_by=$4,updated_at=NOW()
        WHERE workspace_id=$5 AND id=$6 RETURNING *`, [body.name === undefined ? existing.name : normalizedName(body.name, 'Destination name'), status,
        JSON.stringify(config), session.id, session.workspace_id, id])).rows[0];
      await writeAudit(client, session.workspace_id, session.id, 'automation.destination_updated', 'automation_destination', id, { status });
      return updated;
    });
    return sendJson(res, 200, { destination: { id: row.id, name: row.name, type: row.action_type, status: row.status, config: row.config } });
  }

  function decodeTvCursor(value, floor) {
    if (!value) return { at: new Date(Math.max(floor.getTime(), now().getTime() - 5 * 60_000)), id: null };
    try {
      const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
      const at = new Date(parsed.at);
      if (!Number.isNaN(at.getTime())) return { at: at < floor ? floor : at > now() ? now() : at, id: uuidPattern.test(String(parsed.id || '')) ? String(parsed.id) : null };
    } catch {}
    const at = new Date(value);
    if (Number.isNaN(at.getTime())) throw new AutomationError(422, 'invalid_cursor', 'TV event cursor was not accepted.');
    return { at: at < floor ? floor : at > now() ? now() : at, id: null };
  }

  function encodeTvCursor(at, id) { return Buffer.from(JSON.stringify({ at: new Date(at).toISOString(), id: id || null })).toString('base64url'); }

  async function listTvEvents(workspaceIdInput, { after, limit = 50, displayId } = {}) {
    if (!ready) return { events: [], cursor: null, disabled: true };
    const workspaceId = safeUuid(workspaceIdInput, 'Workspace ID');
    const targetDisplayId = displayId ? safeUuid(displayId, 'Display ID') : null;
    const safeLimit = integerInRange(limit, 1, 100, 'TV event limit', 50);
    const floor = new Date(now().getTime() - 24 * 60 * 60_000);
    const cursor = decodeTvCursor(after, floor);
    const rows = (await pool.query(`SELECT at.id,at.completed_at,at.response_metadata,a.config,a.destination_id,
        d.status AS destination_status,d.config AS destination_config,r.occurred_at,r.metric_id,ar.name AS rule_name,m.name AS metric_name
      FROM automation_action_attempts at
      JOIN automation_actions a ON a.workspace_id=at.workspace_id AND a.id=at.action_id
      JOIN automation_runs r ON r.workspace_id=at.workspace_id AND r.id=at.run_id
      JOIN automation_rules ar ON ar.workspace_id=r.workspace_id AND ar.id=r.rule_id
      JOIN metric_definitions m ON m.workspace_id=r.workspace_id AND m.id=r.metric_id
      LEFT JOIN automation_destinations d ON d.workspace_id=a.workspace_id AND d.id=a.destination_id
      WHERE at.workspace_id=$1 AND at.status='succeeded' AND a.action_type='internal_tv_celebration'
        AND (at.completed_at>$2 OR ($3::uuid IS NOT NULL AND at.completed_at=$2 AND at.id>$3::uuid))
      ORDER BY at.completed_at,at.id LIMIT $4`, [workspaceId, cursor.at, cursor.id, Math.min(500, safeLimit * 5)])).rows;
    const selected = [];
    let lastScanned = null;
    for (const row of rows) {
      lastScanned = row;
      const boundDestinationId = row.response_metadata?.destinationId || row.destination_id || null;
      if (boundDestinationId && row.destination_status !== 'active') continue;
      const ids = Array.isArray(row.response_metadata?.targetDisplayIds)
        ? row.response_metadata.targetDisplayIds
        : boundDestinationId
          ? (Array.isArray(row.destination_config?.displayIds) ? row.destination_config.displayIds : [])
          : (Array.isArray(row.config?.displayIds) ? row.config.displayIds : []);
      if (!ids.length || (targetDisplayId && ids.includes(targetDisplayId))) selected.push(row);
      if (selected.length >= safeLimit) break;
    }
    const events = selected.map((row) => ({
      id: row.id,
      title: String(row.config?.title || 'Goal reached'),
      message: String(row.config?.message || ''),
      ruleName: row.rule_name,
      metricName: row.metric_name,
      occurredAt: row.completed_at,
      durationSeconds: Number(row.config?.durationSeconds || 8),
      theme: String(row.config?.theme || 'brand')
    }));
    return { events, cursor: lastScanned ? encodeTvCursor(lastScanned.completed_at, lastScanned.id) : encodeTvCursor(cursor.at, cursor.id) };
  }

  async function handleAdmin(req, res, url, session) {
    const pathname = url.pathname;
    const isAutomationPath = pathname.startsWith('/api/axoboard/automations')
      || pathname.startsWith('/api/axoboard/automation-runs')
      || pathname.startsWith('/api/axoboard/automation-destinations')
      || /^\/api\/axoboard\/metrics\/[^/]+\/automations$/.test(pathname);
    if (!isAutomationPath) return false;
    requireReady();
    if (!['GET', 'HEAD'].includes(req.method)) requireMutationOrigin(req);
    if (pathname === '/api/axoboard/automations' && req.method === 'GET') return listRules(res, url, session);
    if (pathname === '/api/axoboard/automations' && req.method === 'POST') return createRule(req, res, session);
    if (pathname === '/api/axoboard/automation-runs' && req.method === 'GET') return listRuns(res, url, session);
    if (pathname === '/api/axoboard/automation-destinations' && req.method === 'GET') return listDestinations(res, session);
    if (pathname === '/api/axoboard/automation-destinations' && req.method === 'POST') return createDestination(req, res, session);
    const destinationMatch = pathname.match(/^\/api\/axoboard\/automation-destinations\/([^/]+)$/);
    if (destinationMatch && req.method === 'PATCH') return updateDestination(req, res, session, destinationMatch[1]);
    const metricMatch = pathname.match(/^\/api\/axoboard\/metrics\/([^/]+)\/automations$/);
    if (metricMatch && req.method === 'GET') return metricRules(res, session, metricMatch[1]);
    const retryMatch = pathname.match(/^\/api\/axoboard\/automation-runs\/([^/]+)\/actions\/([^/]+)\/retry$/);
    if (retryMatch && req.method === 'POST') return retryAction(req, res, session, retryMatch[1], retryMatch[2]);
    const operationMatch = pathname.match(/^\/api\/axoboard\/automations\/([^/]+)\/(dry-run|publish|pause|resume|archive)$/);
    if (operationMatch && req.method === 'POST') {
      if (operationMatch[2] === 'dry-run') return dryRun(req, res, session, operationMatch[1]);
      if (operationMatch[2] === 'publish') return publishRule(req, res, session, operationMatch[1]);
      if (operationMatch[2] === 'archive') { await bodyFor(req); return archiveRule(res, session, operationMatch[1]); }
      if (operationMatch[2] === 'pause') { await bodyFor(req); return setRuleState(res, session, operationMatch[1], 'paused'); }
      await bodyFor(req); return setRuleState(res, session, operationMatch[1], 'active');
    }
    const ruleMatch = pathname.match(/^\/api\/axoboard\/automations\/([^/]+)$/);
    if (ruleMatch && req.method === 'GET') return getRule(res, session, ruleMatch[1]);
    if (ruleMatch && req.method === 'PATCH') return updateDraft(req, res, session, ruleMatch[1]);
    throw new AutomationError(405, 'method_not_allowed', 'Method not allowed.');
  }

  async function runAdmin(req, res, url, session) {
    try { return await handleAdmin(req, res, url, session); }
    catch (error) {
      if (error instanceof AutomationError) {
        return sendJson(res, error.status, { error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
      }
      throw error;
    }
  }

  return {
    ready,
    handleAdmin: runAdmin,
    emitMetricSnapshotEvent,
    processDueEvents,
    processDueActions,
    listTvEvents
  };
}
