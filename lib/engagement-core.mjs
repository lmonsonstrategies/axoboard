import { randomUUID } from 'node:crypto';

const supportedPeriods = new Set(['day', 'week', 'month', 'year']);
const supportedCalendars = new Set(['calendar_days', 'weekdays']);
const supportedDirections = new Set(['higher_is_better', 'lower_is_better']);
const defaultMilestones = [25, 50, 75, 90, 100];

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be a finite number.`);
  return number;
}

function localDateParts(date, timezone) {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    throw new TypeError('Timezone is not supported.');
  }
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return { year: parts.year, month: parts.month, day: parts.day };
}

function utcDate({ year, month, day }) { return new Date(Date.UTC(year, month - 1, day)); }
function dateKey(date) { return date.toISOString().slice(0, 10); }

function periodBounds(local, period) {
  const current = utcDate(local);
  if (period === 'day') return { start: current, end: current };
  if (period === 'week') {
    const weekday = current.getUTCDay() || 7;
    const start = new Date(current); start.setUTCDate(start.getUTCDate() - weekday + 1);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    return { start, end };
  }
  if (period === 'year') return { start: new Date(Date.UTC(local.year, 0, 1)), end: new Date(Date.UTC(local.year, 11, 31)) };
  return { start: new Date(Date.UTC(local.year, local.month - 1, 1)), end: new Date(Date.UTC(local.year, local.month, 0)) };
}

function workingDays(start, end, calendar) {
  const days = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const weekday = cursor.getUTCDay();
    if (calendar === 'calendar_days' || (weekday !== 0 && weekday !== 6)) days.push(dateKey(cursor));
  }
  return days;
}

export function calculateGoalIntelligence(input = {}) {
  const actual = finiteNumber(input.actualValue, 'Actual value');
  const target = finiteNumber(input.targetValue, 'Target value');
  if (target === 0) throw new RangeError('Target value cannot be zero.');
  const direction = supportedDirections.has(input.direction) ? input.direction : 'higher_is_better';
  const period = supportedPeriods.has(input.periodGranularity) ? input.periodGranularity : 'month';
  const calendar = supportedCalendars.has(input.calendarType) ? input.calendarType : 'weekdays';
  const timezone = String(input.timezone || 'America/Denver');
  const asOf = input.asOf instanceof Date ? input.asOf : new Date(input.asOf || Date.now());
  if (Number.isNaN(asOf.getTime())) throw new TypeError('Evaluation time is invalid.');
  const local = localDateParts(asOf, timezone);
  const today = dateKey(utcDate(local));
  const { start, end } = periodBounds(local, period);
  const days = workingDays(start, end, calendar);
  const completedDays = days.filter((day) => day <= today).length;
  const remainingDays = days.filter((day) => day >= today).length;
  const totalDays = Math.max(1, days.length);
  const elapsed = Math.max(1, completedDays);
  const projectedFinish = actual / elapsed * totalDays;
  const attainment = direction === 'higher_is_better' ? actual / target : target / Math.max(actual, Number.EPSILON);
  const complete = direction === 'higher_is_better' ? actual >= target : actual <= target;
  const requiredPerDay = complete ? 0 : direction === 'higher_is_better'
    ? Math.max(0, target - actual) / Math.max(1, remainingDays)
    : Math.max(0, actual - target) / Math.max(1, remainingDays);
  const projectedSuccess = direction === 'higher_is_better' ? projectedFinish >= target : projectedFinish <= target;
  const deltaRatio = direction === 'higher_is_better' ? projectedFinish / target : target / Math.max(projectedFinish, Number.EPSILON);
  const status = complete ? 'complete' : projectedSuccess ? (deltaRatio >= 1.05 ? 'ahead' : 'on_track') : 'behind';
  const milestones = (Array.isArray(input.milestones) ? input.milestones : defaultMilestones)
    .map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  const attainmentPercent = Math.max(0, attainment * 100);
  const crossedMilestones = direction === 'higher_is_better' ? milestones.filter((milestone) => attainmentPercent >= milestone) : [];
  const nextMilestone = direction === 'higher_is_better' ? milestones.find((milestone) => attainmentPercent < milestone) ?? null : null;
  return {
    periodKey: `${period}:${dateKey(start)}:${dateKey(end)}`,
    periodStart: dateKey(start), periodEnd: dateKey(end), actualValue: actual, targetValue: target,
    attainment, attainmentPercent, projectedFinish, requiredPerDay, completedDays, remainingDays,
    status, nextMilestone, crossedMilestones, direction, calendarType: calendar, timezone
  };
}

function semanticKey(mappingId) { return `google_sheets:${mappingId}`; }

export async function ensurePublishedBrand(poolOrClient, workspaceId, workspaceName) {
  const existing = await poolOrClient.query("SELECT id,version,name,tokens,published_at FROM brand_packages WHERE workspace_id=$1 AND status='published' LIMIT 1", [workspaceId]);
  if (existing.rows[0]) return existing.rows[0];
  const name = String(workspaceName || 'Customer workspace').trim().slice(0, 120) || 'Customer workspace';
  const tokens = { primary: '#E96F98', secondary: '#43BDE8', success: '#6DDB65', background: '#FFF9FB', text: '#35233A', logoMode: 'initial', motion: 'system', sound: 'system' };
  const inserted = await poolOrClient.query(`INSERT INTO brand_packages (id,workspace_id,version,status,name,tokens,published_at)
    VALUES ($1,$2,1,'published',$3,$4::jsonb,NOW()) ON CONFLICT DO NOTHING RETURNING id,version,name,tokens,published_at`,
  [randomUUID(), workspaceId, name, JSON.stringify(tokens)]);
  if (inserted.rows[0]) return inserted.rows[0];
  return (await poolOrClient.query("SELECT id,version,name,tokens,published_at FROM brand_packages WHERE workspace_id=$1 AND status='published' LIMIT 1", [workspaceId])).rows[0];
}

async function ensureMetric(client, mapping) {
  const existing = await client.query('SELECT * FROM metric_definitions WHERE workspace_id=$1 AND mapping_id=$2 LIMIT 1', [mapping.workspace_id, mapping.id]);
  if (existing.rows[0]) {
    const updated = await client.query(`UPDATE metric_definitions SET name=$1,unit=$2,direction=$3,definition=$4,
      certification_status=CASE WHEN $5='active' THEN 'certified' ELSE 'suspended' END,
      certified_at=CASE WHEN $5='active' THEN COALESCE(certified_at,NOW()) ELSE certified_at END,
      suspended_at=CASE WHEN $5='active' THEN NULL ELSE COALESCE(suspended_at,NOW()) END,updated_at=NOW()
      WHERE workspace_id=$6 AND id=$7 RETURNING *`,
    [mapping.name, mapping.display_format, supportedDirections.has(mapping.goal_direction) ? mapping.goal_direction : 'higher_is_better',
      `${mapping.name} from Google Sheets ${mapping.sheet_title}!${mapping.a1_range}.`, mapping.status, mapping.workspace_id, existing.rows[0].id]);
    return updated.rows[0];
  }
  const inserted = await client.query(`INSERT INTO metric_definitions
    (id,workspace_id,mapping_id,semantic_key,name,unit,direction,definition,certification_status,certified_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9='certified' THEN NOW() ELSE NULL END) RETURNING *`,
  [randomUUID(), mapping.workspace_id, mapping.id, semanticKey(mapping.id), mapping.name, mapping.display_format,
    supportedDirections.has(mapping.goal_direction) ? mapping.goal_direction : 'higher_is_better',
    `${mapping.name} from Google Sheets ${mapping.sheet_title}!${mapping.a1_range}.`, mapping.status === 'active' ? 'certified' : 'suspended']);
  return inserted.rows[0];
}

async function ensureGoal(client, metric, mapping, targetValue) {
  const current = (await client.query("SELECT * FROM goal_configs WHERE workspace_id=$1 AND metric_id=$2 AND status='active' FOR UPDATE", [mapping.workspace_id, metric.id])).rows[0];
  if (targetValue === null || targetValue === undefined || !Number.isFinite(Number(targetValue))) {
    if (current) {
      await client.query("UPDATE goal_configs SET status='retired',retired_at=NOW() WHERE workspace_id=$1 AND id=$2 AND status='active'",
        [mapping.workspace_id, current.id]);
    }
    return null;
  }
  const targetSource = mapping.goal_source === 'google_sheets' ? 'google_sheets' : 'manual';
  const storedTarget = targetSource === 'manual' ? Number(targetValue) : null;
  const period = supportedPeriods.has(mapping.period_granularity) ? mapping.period_granularity : 'month';
  const direction = supportedDirections.has(mapping.goal_direction) ? mapping.goal_direction : 'higher_is_better';
  const calendar = supportedCalendars.has(mapping.goal_calendar_type) ? mapping.goal_calendar_type : 'weekdays';
  const timezone = String(mapping.goal_timezone || 'America/Denver');
  if (current && current.target_source === targetSource && Number(current.target_value ?? 0) === Number(storedTarget ?? 0) && current.period_granularity === period
    && current.direction === direction && current.calendar_type === calendar && current.timezone === timezone) return current;
  const version = current ? Number(current.version) + 1 : 1;
  if (current) await client.query("UPDATE goal_configs SET status='retired',retired_at=NOW() WHERE workspace_id=$1 AND id=$2", [mapping.workspace_id, current.id]);
  return (await client.query(`INSERT INTO goal_configs
    (id,workspace_id,metric_id,version,target_source,target_value,direction,period_granularity,calendar_type,timezone,status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active') RETURNING *`,
  [randomUUID(), mapping.workspace_id, metric.id, version, targetSource, storedTarget, direction, period, calendar, timezone])).rows[0];
}

export async function recordSnapshotEngagement(client, { mapping, snapshotId, value, goalValue, fetchedAt = new Date() }) {
  const metric = await ensureMetric(client, mapping);
  await client.query('UPDATE metric_snapshots SET metric_id=$1 WHERE workspace_id=$2 AND id=$3', [metric.id, mapping.workspace_id, snapshotId]);
  const goal = await ensureGoal(client, metric, mapping, goalValue);
  if (!goal || metric.certification_status !== 'certified') return { metric, goal: null, intelligence: null, events: [] };
  const target = goal.target_source === 'google_sheets' ? Number(goalValue) : Number(goal.target_value);
  const intelligence = calculateGoalIntelligence({
    actualValue: value, targetValue: target, direction: goal.direction, periodGranularity: goal.period_granularity,
    calendarType: goal.calendar_type, timezone: goal.timezone, milestones: goal.milestones, asOf: fetchedAt
  });
  const evaluationId = randomUUID();
  await client.query(`INSERT INTO goal_evaluations
    (id,workspace_id,goal_id,metric_id,snapshot_id,period_key,actual_value,target_value,attainment,projected_finish,required_per_day,completed_days,remaining_days,status,next_milestone,evaluated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
    ON CONFLICT (workspace_id,goal_id,snapshot_id) DO NOTHING`,
  [evaluationId, mapping.workspace_id, goal.id, metric.id, snapshotId, intelligence.periodKey, value, target, intelligence.attainment,
    intelligence.projectedFinish, intelligence.requiredPerDay, intelligence.completedDays, intelligence.remainingDays, intelligence.status, intelligence.nextMilestone, fetchedAt]);
  const events = [];
  for (const milestone of intelligence.crossedMilestones) {
    const eventId = randomUUID();
    const key = `goal:${goal.id}:v${goal.version}:${intelligence.periodKey}:milestone:${milestone}`;
    const payload = { metricId: metric.id, metricName: metric.name, actualValue: Number(value), targetValue: target, attainment: intelligence.attainment, milestone, status: intelligence.status };
    const inserted = await client.query(`INSERT INTO domain_events
      (id,workspace_id,event_type,idempotency_key,metric_id,goal_id,source_snapshot_id,rule_version,brand_version,period_key,payload,occurred_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10::jsonb,$11)
      ON CONFLICT (workspace_id,idempotency_key) DO NOTHING RETURNING id,event_type,idempotency_key,payload,occurred_at`,
    [eventId, mapping.workspace_id, `goal.milestone.${milestone}`, key, metric.id, goal.id, snapshotId, goal.version, intelligence.periodKey, JSON.stringify(payload), fetchedAt]);
    if (!inserted.rows[0]) continue;
    await client.query(`INSERT INTO event_outbox (id,workspace_id,event_id,status) VALUES ($1,$2,$3,'pending')
      ON CONFLICT (workspace_id,event_id) DO NOTHING`, [randomUUID(), mapping.workspace_id, eventId]);
    events.push(inserted.rows[0]);
  }
  return { metric, goal, intelligence, events };
}

export async function backfillWorkspaceEngagement(pool, workspaceId) {
  const rows = (await pool.query(`SELECT m.*,s.id AS snapshot_id,s.value,s.goal_value AS snapshot_goal_value,s.fetched_at
    FROM kpi_mappings m JOIN LATERAL (
      SELECT id,value,goal_value,fetched_at FROM metric_snapshots
      WHERE workspace_id=m.workspace_id AND mapping_id=m.id ORDER BY fetched_at DESC LIMIT 1
    ) s ON TRUE
    LEFT JOIN metric_definitions d ON d.workspace_id=m.workspace_id AND d.mapping_id=m.id
    WHERE m.workspace_id=$1 AND m.status<>'deleted' AND (
      d.id IS NULL OR ((m.goal_value IS NOT NULL OR s.goal_value IS NOT NULL) AND NOT EXISTS (
        SELECT 1 FROM goal_evaluations e WHERE e.workspace_id=m.workspace_id AND e.snapshot_id=s.id
      ))
    )`, [workspaceId])).rows;
  if (!rows.length) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const mapping of rows) {
      const goalValue = mapping.goal_source === 'google_sheets' ? mapping.snapshot_goal_value : mapping.goal_value;
      await recordSnapshotEngagement(client, { mapping, snapshotId: mapping.snapshot_id, value: mapping.value, goalValue, fetchedAt: mapping.fetched_at });
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export async function engagementForMappings(poolOrClient, workspaceId, mappingIds) {
  if (!mappingIds.length) return new Map();
  const result = await poolOrClient.query(`SELECT m.mapping_id,m.id AS metric_id,m.certification_status,m.certification_method,m.certified_at,m.definition,m.direction,
    g.id AS goal_id,g.version AS goal_version,g.period_granularity,g.calendar_type,g.timezone,
    e.period_key,e.attainment,e.projected_finish,e.required_per_day,e.completed_days,e.remaining_days,e.status AS goal_status,e.next_milestone,e.evaluated_at
    FROM metric_definitions m
    LEFT JOIN goal_configs g ON g.workspace_id=m.workspace_id AND g.metric_id=m.id AND g.status='active'
    LEFT JOIN LATERAL (SELECT * FROM goal_evaluations WHERE workspace_id=m.workspace_id AND metric_id=m.id ORDER BY evaluated_at DESC LIMIT 1) e ON TRUE
    WHERE m.workspace_id=$1 AND m.mapping_id=ANY($2::uuid[])`, [workspaceId, mappingIds]);
  return new Map(result.rows.map((row) => [row.mapping_id, {
    metricId: row.metric_id, certification: { status: row.certification_status, method: row.certification_method, certifiedAt: row.certified_at, definition: row.definition },
    goal: row.goal_id ? { id: row.goal_id, version: row.goal_version, periodGranularity: row.period_granularity, calendarType: row.calendar_type, timezone: row.timezone } : null,
    intelligence: row.evaluated_at ? { periodKey: row.period_key, attainment: Number(row.attainment), projectedFinish: Number(row.projected_finish), requiredPerDay: Number(row.required_per_day), completedDays: row.completed_days, remainingDays: row.remaining_days, status: row.goal_status, nextMilestone: row.next_milestone === null ? null : Number(row.next_milestone), evaluatedAt: row.evaluated_at } : null
  }]));
}

export async function listDomainEvents(poolOrClient, workspaceId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const result = await poolOrClient.query(`SELECT e.id,e.event_type,e.idempotency_key,e.rule_version,e.brand_version,e.period_key,e.payload,e.occurred_at,e.created_at,
    m.name AS metric_name,o.status AS outbox_status,o.attempt_count
    FROM domain_events e LEFT JOIN metric_definitions m ON m.workspace_id=e.workspace_id AND m.id=e.metric_id
    LEFT JOIN event_outbox o ON o.workspace_id=e.workspace_id AND o.event_id=e.id
    WHERE e.workspace_id=$1 ORDER BY e.occurred_at DESC,e.created_at DESC LIMIT $2`, [workspaceId, safeLimit]);
  return result.rows.map((row) => ({ id: row.id, type: row.event_type, idempotencyKey: row.idempotency_key, ruleVersion: row.rule_version, brandVersion: row.brand_version,
    periodKey: row.period_key, payload: row.payload, occurredAt: row.occurred_at, createdAt: row.created_at, metricName: row.metric_name,
    delivery: { status: row.outbox_status || 'not_queued', attempts: row.attempt_count || 0 } }));
}

export async function metricTrust(poolOrClient, workspaceId, mappingId) {
  const result = await poolOrClient.query(`SELECT m.id,m.mapping_id,m.name,m.unit,m.direction,m.definition,m.certification_status,m.certification_method,m.certified_at,
    k.provider,k.spreadsheet_title,k.sheet_title,k.a1_range,k.refresh_seconds,k.stale_after_seconds,k.status,k.last_sync_at,k.last_error_code,
    s.fetched_at,s.lineage_hash
    FROM metric_definitions m JOIN kpi_mappings k ON k.workspace_id=m.workspace_id AND k.id=m.mapping_id
    LEFT JOIN LATERAL (SELECT fetched_at,lineage_hash FROM metric_snapshots WHERE workspace_id=m.workspace_id AND mapping_id=m.mapping_id ORDER BY fetched_at DESC LIMIT 1) s ON TRUE
    WHERE m.workspace_id=$1 AND m.mapping_id=$2 AND k.status<>'deleted' LIMIT 1`, [workspaceId, mappingId]);
  const row = result.rows[0];
  if (!row) return null;
  return { id: row.id, mappingId: row.mapping_id, name: row.name, unit: row.unit, direction: row.direction, definition: row.definition,
    certification: { status: row.certification_status, method: row.certification_method, certifiedAt: row.certified_at },
    source: { provider: row.provider, spreadsheetTitle: row.spreadsheet_title, sheetTitle: row.sheet_title, range: row.a1_range },
    freshness: { refreshSeconds: row.refresh_seconds, staleAfterSeconds: row.stale_after_seconds, fetchedAt: row.fetched_at, lastSyncAt: row.last_sync_at, status: row.status, errorCode: row.last_error_code },
    lineageHash: row.lineage_hash };
}
