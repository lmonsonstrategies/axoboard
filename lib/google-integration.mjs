import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { GoogleProviderError } from './google-provider.mjs';
import {
  backfillWorkspaceEngagement,
  engagementForMappings,
  ensurePublishedBrand,
  listDomainEvents,
  metricTrust,
  recordSnapshotEngagement
} from './engagement-core.mjs';
import { createVisualQaBoard, visualQaAccess, visualQaNow } from './visual-qa-fixture.mjs';

const googleScopes = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly'
];
const requiredGoogleScopes = new Set(googleScopes.slice(2));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const spreadsheetIdPattern = /^[A-Za-z0-9_-]{10,200}$/;
const cellRangePattern = /^[A-Za-z]{1,3}[1-9][0-9]*(?::[A-Za-z]{1,3}[1-9][0-9]*)?$/;
const maximumSelectedRanges = 12;
const aggregations = new Set(['single_value', 'sum', 'average', 'count', 'min', 'max', 'latest_non_empty']);
const displayFormats = new Set(['number', 'currency', 'percentage']);
const scalarDisplayTypes = new Set(['scorecard', 'goal_pace', 'gauge']);
const pairedDisplayTypes = new Set(['rep_cards', 'leaderboard', 'trend', 'category_bar', 'funnel', 'pipeline']);
const displayTypes = new Set([...scalarDisplayTypes, ...pairedDisplayTypes, 'activity_feed', 'heatmap', 'table']);
const comparisonDisplayTypes = new Set([...scalarDisplayTypes, ...pairedDisplayTypes]);
const periodGranularities = new Set(['day', 'week', 'month', 'year']);
const goalDirections = new Set(['higher_is_better', 'lower_is_better']);
const goalCalendars = new Set(['calendar_days', 'weekdays']);

class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function digest(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function base64url(buffer) { return Buffer.from(buffer).toString('base64url'); }
function oauthAad(transaction) { return `oauth:${transaction.id}:${transaction.workspace_id}`; }
function connectionAad(id, workspaceId, version = 1) { return `connection:${id}:${workspaceId}:v${version}`; }
function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }

function normalizeSpreadsheetId(value) {
  const raw = String(value || '').trim();
  const fromUrl = raw.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1];
  const id = fromUrl || raw;
  if (!spreadsheetIdPattern.test(id)) throw new HttpError(422, 'invalid_spreadsheet', 'Enter a valid Google Sheets URL or spreadsheet ID.');
  return id;
}

function validateUuid(value, label = 'ID') {
  const id = String(value || '');
  if (!uuidPattern.test(id)) throw new HttpError(422, 'invalid_id', `${label} was not accepted.`);
  return id;
}

function normalizeRange(value) {
  const range = String(value || '').trim().toUpperCase();
  if (!cellRangePattern.test(range)) throw new HttpError(422, 'invalid_range', 'Use a cell or range such as D8 or D8:D20.');
  return range;
}

function normalizeRanges(value) {
  const rawRanges = String(value || '').split(',').map((range) => range.trim()).filter(Boolean);
  if (!rawRanges.length || rawRanges.length > maximumSelectedRanges) {
    throw new HttpError(422, 'invalid_range_count', `Choose between 1 and ${maximumSelectedRanges} cell ranges.`);
  }
  const ranges = rawRanges.map(normalizeRange);
  if (new Set(ranges).size !== ranges.length) throw new HttpError(422, 'duplicate_range', 'Each selected range must be different.');
  return ranges;
}

function normalizeRangeRoles(ranges, value) {
  if (!Array.isArray(value) || !value.length) return [];
  if (value.length !== ranges.length) throw new HttpError(422, 'range_role_mismatch', 'Assign one role to every selected range.');
  const normalized = value.map((item, index) => {
    const range = normalizeRange(item?.range ?? ranges[index]);
    const role = String(item?.role || 'metric');
    if (range !== ranges[index]) throw new HttpError(422, 'range_role_order_mismatch', 'Range roles must follow the selected range order.');
    if (!['header', 'metric', 'goal'].includes(role)) throw new HttpError(422, 'invalid_range_role', 'Each range must be assigned as Headers, Metrics, or Goal.');
    return { range, role };
  });
  if (!normalized.some((item) => item.role === 'metric')) throw new HttpError(422, 'metric_range_required', 'Choose at least one Metrics range.');
  return normalized;
}

function rangeShape(range) {
  const match = String(range).match(/^([A-Z]{1,3})([1-9][0-9]*)(?::([A-Z]{1,3})([1-9][0-9]*))?$/);
  const columnNumber = (label) => [...label].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0);
  const startColumn = columnNumber(match[1]);
  const endColumn = columnNumber(match[3] || match[1]);
  const startRow = Number(match[2]);
  const endRow = Number(match[4] || match[2]);
  return { rows: Math.abs(endRow - startRow) + 1, columns: Math.abs(endColumn - startColumn) + 1 };
}

function combineSelectedValues(ranges, valueRanges = []) {
  const shapes = ranges.map(rangeShape);
  const totalCells = shapes.reduce((total, shape) => total + (shape.rows * shape.columns), 0);
  if (totalCells > 8_000) throw new HttpError(422, 'display_range_too_large', 'Selected ranges can contain up to 8,000 cells total.');
  const selections = ranges.map((range, index) => {
    const shape = shapes[index];
    const source = Array.isArray(valueRanges[index]?.values) ? valueRanges[index].values : [];
    const values = Array.from({ length: shape.rows }, (_, row) => Array.from({ length: shape.columns }, (_, column) => source[row]?.[column] ?? ''));
    return { shape, values };
  });
  if (selections.length === 1) return selections[0].values;
  if (selections.every(({ shape }) => shape.rows === selections[0].shape.rows)) {
    if (selections[0].shape.rows > 200 || selections.reduce((total, { shape }) => total + shape.columns, 0) > 40) throw new HttpError(422, 'display_range_too_large', 'Combined ranges can contain up to 200 rows and 40 columns.');
    return Array.from({ length: selections[0].shape.rows }, (_, row) => selections.flatMap(({ values }) => values[row]));
  }
  if (selections.every(({ shape }) => shape.columns === selections[0].shape.columns)) {
    if (selections[0].shape.columns > 40 || selections.reduce((total, { shape }) => total + shape.rows, 0) > 200) throw new HttpError(422, 'display_range_too_large', 'Combined ranges can contain up to 200 rows and 40 columns.');
    return selections.flatMap(({ values }) => values);
  }
  throw new HttpError(422, 'multi_range_shape_mismatch', 'Non-adjacent ranges must have the same number of rows or the same number of columns.');
}

function combineRoleSelectedValues(ranges, valueRanges, rangeRoles) {
  if (!rangeRoles.some((item) => item.role === 'header')) {
    const metricIndexes = rangeRoles.map((item, index) => item.role === 'metric' ? index : -1).filter((index) => index >= 0);
    return combineSelectedValues(metricIndexes.map((index) => ranges[index]), metricIndexes.map((index) => valueRanges[index]));
  }
  const headerRanges = [];
  const headerValues = [];
  const metricRanges = [];
  const metricValues = [];
  rangeRoles.forEach((item, index) => {
    if (item.role === 'goal') return;
    const targetRanges = item.role === 'header' ? headerRanges : metricRanges;
    const targetValues = item.role === 'header' ? headerValues : metricValues;
    targetRanges.push(ranges[index]);
    targetValues.push(valueRanges[index]);
  });
  const headers = combineSelectedValues(headerRanges, headerValues);
  const metrics = combineSelectedValues(metricRanges, metricValues);
  if (headers.length !== 1) throw new HttpError(422, 'header_range_shape', 'Header ranges must combine into one row.');
  const metricWidth = Math.max(0, ...metrics.map((row) => row.length));
  if (headers[0].length !== metricWidth) throw new HttpError(422, 'header_metric_shape_mismatch', `Headers contain ${headers[0].length} cells, but Metrics contain ${metricWidth} columns.`);
  return [headers[0], ...metrics];
}

function combineGoalSelectedValues(ranges, valueRanges, rangeRoles) {
  const goalRanges = [];
  const goalValues = [];
  rangeRoles.forEach((item, index) => {
    if (item.role !== 'goal') return;
    goalRanges.push(ranges[index]);
    goalValues.push(valueRanges[index]);
  });
  return goalRanges.length ? combineSelectedValues(goalRanges, goalValues) : null;
}

function normalizePageToken(value) {
  const token = String(value || '').trim();
  if (token.length > 2048 || /[^A-Za-z0-9._~+/=-]/.test(token)) throw new HttpError(422, 'invalid_page_token', 'Spreadsheet pagination token was not accepted.');
  return token;
}

function escapeSheetTitle(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function columnLabel(column) {
  let value = Number(column);
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function gridIndex(value, maximum, label) {
  const number = Number(value || 1);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new HttpError(422, 'invalid_grid_position', `${label} is outside this sheet.`);
  }
  return number;
}

function gridWindowSize(value, fallback, maximum, label) {
  const number = Number(value || fallback);
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum) {
    throw new HttpError(422, 'invalid_grid_window', `${label} must be between 1 and ${maximum}.`);
  }
  return number;
}

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function calculateKpi(values, aggregation, includeHeaders = false) {
  const dataRows = Array.isArray(values) ? (includeHeaders ? values.slice(1) : values) : [];
  const flattened = dataRows.flat().filter((value) => value !== '' && value !== null && value !== undefined);
  if (!flattened.length) throw new HttpError(422, 'empty_range', 'The selected range is empty.');
  if (aggregation === 'count') return { value: flattened.length, sourceRowCount: flattened.length };
  if (aggregation === 'latest_non_empty') {
    const latest = numericValue(flattened.at(-1));
    if (latest === null) throw new HttpError(422, 'non_numeric_value', 'The latest non-empty cell is not numeric.');
    return { value: latest, sourceRowCount: flattened.length };
  }
  const numeric = flattened.map(numericValue).filter((value) => value !== null);
  if (!numeric.length) throw new HttpError(422, 'non_numeric_range', 'The selected range does not contain numeric values.');
  if (aggregation === 'single_value') {
    if (flattened.length !== 1 || numeric.length !== 1) {
      throw new HttpError(422, 'single_value_requires_one_cell', 'Scorecard needs one calculated numeric cell. Calculate totals or rates in Google Sheets, or choose a structured display.');
    }
    return { value: numeric[0], sourceRowCount: 1 };
  }
  if (aggregation === 'sum') return { value: numeric.reduce((total, value) => total + value, 0), sourceRowCount: flattened.length };
  if (aggregation === 'average') return { value: numeric.reduce((total, value) => total + value, 0) / numeric.length, sourceRowCount: flattened.length };
  if (aggregation === 'min') return { value: Math.min(...numeric), sourceRowCount: flattened.length };
  if (aggregation === 'max') return { value: Math.max(...numeric), sourceRowCount: flattened.length };
  throw new HttpError(422, 'invalid_aggregation', 'Choose a supported KPI calculation.');
}

function populatedValues(values, includeHeaders = false) {
  const dataRows = Array.isArray(values) ? (includeHeaders ? values.slice(1) : values) : [];
  return dataRows.flat().filter((value) => value !== '' && value !== null && value !== undefined);
}

function preparedMetricValue(value, label) {
  const number = numericValue(value);
  if (number === null) throw new HttpError(422, 'non_numeric_value', `${label} must be a number calculated in Google Sheets.`);
  return number;
}

function displayPayload(values, aggregation, includeHeaders, displayType, comparisonValues = null, comparisonIncludeHeaders = false, goalValues = null) {
  if (displayType === 'scorecard') {
    const rows = Array.isArray(values) ? values.map((row) => Array.isArray(row) ? row : []) : [];
    const headers = includeHeaders ? rows[0] : [];
    const dataRows = includeHeaders ? rows.slice(1) : rows;
    const sheetGoals = populatedValues(goalValues, false);
    if (dataRows.length === 1 && (dataRows[0].length === 3 || (dataRows[0].length === 2 && sheetGoals.length === 1))) {
      const [rep, metric, inlineGoal] = dataRows[0];
      const goal = inlineGoal ?? sheetGoals[0];
      if (rep === '' || rep === null || rep === undefined) throw new HttpError(422, 'scorecard_rep_required', 'The first selected scorecard cell must contain the rep name.');
      return {
        kind: 'scorecard',
        layout: 'rep_metric_goal',
        rep: { label: String(headers[0] || 'Rep'), value: String(rep) },
        metric: { label: String(headers[1] || 'Metric'), value: preparedMetricValue(metric, 'The scorecard metric') },
        goal: { label: String(headers[2] || 'Goal'), value: preparedMetricValue(goal, 'The scorecard goal') }
      };
    }
  }
  if (scalarDisplayTypes.has(displayType)) {
    const header = includeHeaders ? String(values?.[0]?.[0] || 'Value') : null;
    const comparisonHeader = comparisonIncludeHeaders ? String(comparisonValues?.[0]?.[0] || 'Comparison') : null;
    return header || comparisonHeader ? { kind: displayType, headers: { value: header, comparison: comparisonHeader } } : null;
  }
  const rows = Array.isArray(values) ? values.map((row) => Array.isArray(row) ? row.slice(0, 40) : []) : [];
  if (!rows.length || rows.length > 200) throw new HttpError(422, 'display_range_too_large', 'Display ranges can contain up to 200 rows and 40 columns.');
  const width = Math.max(0, ...rows.map((row) => row.length));
  if (!width) throw new HttpError(422, 'empty_range', 'The selected range is empty.');
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
  const comparisonRows = Array.isArray(comparisonValues)
    ? comparisonValues.map((row) => Array.isArray(row) ? row.slice(0, 40) : [])
    : [];

  if (displayType === 'table') {
    const columns = includeHeaders
      ? normalized[0].map((value, index) => String(value || columnLabel(index + 1)))
      : Array.from({ length: width }, (_, index) => columnLabel(index + 1));
    return { kind: 'table', columns, rows: includeHeaders ? normalized.slice(1) : normalized };
  }

  if (!includeHeaders) {
    throw new HttpError(422, 'display_requires_headers', 'Turn on “Use first row as headers” for this display.');
  }

  if (displayType === 'activity_feed') {
    if (width < 2 || width > 4 || normalized.length < 2) {
      throw new HttpError(422, 'activity_feed_shape', 'Activity Feed needs 2–4 columns with a header row: timestamp, event, and optional detail/value.');
    }
    const columns = normalized[0].map((value, index) => String(value || columnLabel(index + 1)));
    const entries = normalized.slice(1).filter((row) => row.some((value) => value !== '')).map((row, index) => ({
      timestamp: String(row[0] ?? ''),
      label: String(row[1] || `Event ${index + 1}`),
      detail: String(row[2] ?? ''),
      value: row[3] ?? null
    }));
    if (!entries.length) throw new HttpError(422, 'empty_range', 'The selected activity range has no events.');
    return { kind: 'activity_feed', columns, entries };
  }

  if (displayType === 'heatmap') {
    if (width < 2 || normalized.length < 2) {
      throw new HttpError(422, 'heatmap_shape', 'Heatmap needs a header row, a label column, and at least one numeric value column.');
    }
    const xLabels = normalized[0].slice(1).map((value, index) => String(value || columnLabel(index + 2)));
    const dataRows = normalized.slice(1).filter((row) => row.some((value) => value !== ''));
    const yLabels = dataRows.map((row, index) => String(row[0] || `Row ${index + 2}`));
    const cells = dataRows.map((row, rowIndex) => row.slice(1).map((value, columnIndex) => preparedMetricValue(value, `Heatmap cell ${yLabels[rowIndex]} × ${xLabels[columnIndex]}`)));
    const flattened = cells.flat();
    return { kind: 'heatmap', cornerLabel: String(normalized[0][0] || ''), xLabels, yLabels, cells, min: Math.min(...flattened), max: Math.max(...flattened) };
  }

  let labels = [];
  let metricValues = [];
  let comparisonMetricValues = [];
  let headers = { label: 'Label', value: 'Value' };
  let comparisonHeaders = null;
  let orientation = 'columns';
  const hasComparison = Array.isArray(comparisonValues);
  if (width === 2 && normalized.length >= 2) {
    headers = { label: String(normalized[0][0] || 'Label'), value: String(normalized[0][1] || 'Value') };
    const dataRows = normalized.slice(1).filter((row) => row.some((value) => value !== ''));
    labels = dataRows.map((row, index) => String(row[0] || `Row ${index + 2}`));
    metricValues = dataRows.map((row, index) => preparedMetricValue(row[1], `The value beside “${labels[index]}”`));
    const comparisonData = (comparisonIncludeHeaders ? comparisonRows.slice(1) : comparisonRows).filter((row) => row.some((value) => value !== ''));
    if (comparisonIncludeHeaders) {
      comparisonHeaders = { label: comparisonRows[0]?.length >= 2 ? String(comparisonRows[0][0] || headers.label) : null, value: String(comparisonRows[0]?.at(-1) || 'Comparison') };
    }
    if (hasComparison && comparisonData.length !== labels.length) {
      throw new HttpError(422, 'comparison_shape_mismatch', `Comparison needs ${labels.length} value row${labels.length === 1 ? '' : 's'} to match the selected display.`);
    }
    comparisonData.forEach((row, index) => {
      if (row.length >= 2 && row[0] !== '' && String(row[0]) !== labels[index]) {
        throw new HttpError(422, 'comparison_label_mismatch', `Comparison label “${row[0]}” does not match “${labels[index]}”.`);
      }
    });
    comparisonMetricValues = comparisonData.map((row) => row?.length >= 2 ? row[1] : row?.[0]);
  } else if (normalized.length === 2 && width >= 2) {
    orientation = 'rows';
    labels = normalized[0].map((value, index) => String(value || `Column ${columnLabel(index + 1)}`));
    metricValues = normalized[1].map((value, index) => preparedMetricValue(value, `The value below “${labels[index]}”`));
    const comparisonData = comparisonIncludeHeaders ? comparisonRows.slice(1) : comparisonRows;
    if (comparisonIncludeHeaders) comparisonHeaders = { label: null, value: 'Comparison' };
    if (hasComparison && (comparisonData.length !== 1 || comparisonData[0]?.length !== labels.length)) {
      throw new HttpError(422, 'comparison_shape_mismatch', `Comparison needs one row with ${labels.length} values to match the selected display.`);
    }
    comparisonMetricValues = comparisonData[0] || [];
  } else {
    throw new HttpError(422, 'display_requires_two_dimensions', 'Select either two columns (labels + calculated values) or two rows (headers + calculated values).');
  }

  const items = labels.map((label, index) => {
    let comparisonValue = null;
    const comparisonCandidate = comparisonMetricValues[index];
    if (comparisonCandidate !== '' && comparisonCandidate !== null && comparisonCandidate !== undefined) {
      comparisonValue = preparedMetricValue(comparisonCandidate, `The comparison for “${label}”`);
    }
    return { label, value: metricValues[index], comparisonValue };
  });
  const preparedGoals = populatedValues(goalValues, false);
  if (preparedGoals.length && !pairedDisplayTypes.has(displayType)) {
    throw new HttpError(422, 'goal_not_supported', 'This display does not use a Google Sheets goal range.');
  }
  if (preparedGoals.length && ![1, items.length].includes(preparedGoals.length)) {
    throw new HttpError(422, 'goal_shape_mismatch', `Goal needs one value or ${items.length} values to match this display.`);
  }
  if (preparedGoals.length) {
    items.forEach((item, index) => { item.goalValue = preparedMetricValue(preparedGoals.length === 1 ? preparedGoals[0] : preparedGoals[index], `The goal for “${item.label}”`); });
  }
  return { kind: displayType, orientation, headers, ...(comparisonHeaders ? { comparisonHeaders } : {}), items };
}

function summarizeDisplay(values, includeHeaders, displayType, payload) {
  const sourceValues = populatedValues(values, includeHeaders);
  if (!sourceValues.length) throw new HttpError(422, 'empty_range', 'The selected range is empty.');
  if (displayType === 'scorecard' && payload?.layout === 'rep_metric_goal') {
    return { value: payload.metric.value, sourceRowCount: sourceValues.length };
  }
  if (scalarDisplayTypes.has(displayType)) return calculateKpi(values, 'single_value', includeHeaders);
  if (payload?.items?.length) {
    return { value: payload.items.reduce((total, item) => total + item.value, 0), sourceRowCount: sourceValues.length };
  }
  if (payload?.kind === 'activity_feed') return { value: payload.entries.length, sourceRowCount: sourceValues.length };
  if (payload?.kind === 'heatmap') return { value: payload.cells.flat().reduce((total, value) => total + value, 0), sourceRowCount: sourceValues.length };
  const numeric = sourceValues.map(numericValue).filter((value) => value !== null);
  return { value: numeric.reduce((total, value) => total + value, 0), sourceRowCount: sourceValues.length };
}

function publicConnection(row) {
  return {
    id: row.id, provider: row.provider, accountEmail: row.external_account_email,
    scopes: row.scopes, status: row.status, lastSyncAt: row.last_sync_at,
    lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function recordMetricSnapshotEvent(client, { mapping, snapshotId, value, goalValue, fetchedAt, engagement }) {
  const metric = engagement?.metric;
  if (!metric || metric.certification_status !== 'certified') return null;
  const occurredAt = new Date(fetchedAt || Date.now());
  if (Number.isNaN(occurredAt.getTime())) throw new TypeError('Snapshot event time is invalid.');
  const intelligence = engagement.intelligence;
  const goal = engagement.goal;
  const payload = {
    schemaVersion: 1,
    metricId: metric.id,
    snapshotId,
    value: Number(value),
    goal: goal ? {
      id: goal.id,
      version: Number(goal.version),
      targetValue: intelligence?.targetValue ?? (goal.target_value === null ? Number(goalValue) : Number(goal.target_value)),
      direction: goal.direction,
      periodGranularity: goal.period_granularity,
      periodKey: intelligence?.periodKey || null
    } : null,
    evaluation: intelligence ? {
      attainment: intelligence.attainment,
      attainmentPercent: intelligence.attainmentPercent,
      projectedFinish: intelligence.projectedFinish,
      requiredPerDay: intelligence.requiredPerDay,
      status: intelligence.status,
      nextMilestone: intelligence.nextMilestone
    } : null,
    certification: {
      status: metric.certification_status,
      method: metric.certification_method,
      certifiedAt: metric.certified_at
    },
    freshness: {
      status: 'fresh',
      fetchedAt: occurredAt.toISOString(),
      refreshSeconds: Number(mapping.refresh_seconds),
      staleAfterSeconds: Number(mapping.stale_after_seconds)
    }
  };
  const eventId = randomUUID();
  const event = (await client.query(`INSERT INTO domain_events
    (id,workspace_id,event_type,idempotency_key,metric_id,goal_id,source_snapshot_id,rule_version,brand_version,period_key,payload,occurred_at)
    VALUES ($1,$2,'metric.snapshot.recorded.v1',$3,$4,$5,$6,1,1,$7,$8::jsonb,$9)
    ON CONFLICT (workspace_id,idempotency_key) DO NOTHING
    RETURNING id,event_type,idempotency_key,payload,occurred_at`,
  [eventId, mapping.workspace_id, `metric_snapshot:${snapshotId}:v1`, metric.id, goal?.id || null, snapshotId,
    intelligence?.periodKey || null, JSON.stringify(payload), occurredAt])).rows[0];
  if (!event) return null;
  await client.query(`INSERT INTO event_outbox (id,workspace_id,event_id,status) VALUES ($1,$2,$3,'pending')
    ON CONFLICT (workspace_id,event_id) DO NOTHING`, [randomUUID(), mapping.workspace_id, eventId]);
  return event;
}

export function createGoogleIntegration({ pool, vault, provider, env = process.env, sendJson, readJson, currentSession, sameOrigin }) {
  const clientId = String(env.AXOBOARD_GOOGLE_CLIENT_ID || '');
  const clientSecret = String(env.AXOBOARD_GOOGLE_CLIENT_SECRET || '');
  const redirectUri = String(env.AXOBOARD_GOOGLE_REDIRECT_URI || '');
  const ready = Boolean(pool && vault.ready && clientId && clientSecret && redirectUri);
  const engagementEnabled = env.AXOBOARD_ENGAGEMENT_CORE_ENABLED !== 'false';
  const metadataCacheTtlMs = Math.max(5_000, Math.min(300_000, Number(env.AXOBOARD_GOOGLE_METADATA_CACHE_MS || 60_000)));
  const metadataCache = new Map();

  function requireConfigured() {
    if (!ready) throw new HttpError(503, 'google_not_configured', 'Google Sheets is not configured yet.');
  }

  function canEdit(session) { return ['owner', 'admin', 'editor'].includes(session?.role); }
  function canAdminister(session) { return ['owner', 'admin'].includes(session?.role); }

  function requireEditor(session) {
    if (!canEdit(session)) throw new HttpError(403, 'editor_required', 'Workspace editor access is required.');
  }

  function requireAdmin(session) {
    if (!canAdminister(session)) throw new HttpError(403, 'admin_required', 'Workspace admin access is required.');
  }

  function capabilitiesFor(session) {
    const editor = canEdit(session);
    const admin = canAdminister(session);
    return {
      readDashboard: true,
      manageDashboard: editor,
      readKpis: true,
      manageKpis: editor,
      syncKpis: editor,
      viewSourceDetails: editor,
      browseDataSources: editor,
      manageDataSources: admin,
      readDisplays: admin,
      manageDisplays: admin,
      manageBilling: admin,
      readEvents: editor,
      readAutomations: editor,
      manageAutomationDrafts: editor,
      publishAutomations: admin,
      manageAutomationDestinations: admin,
      retryAutomationActions: admin
    };
  }

  async function connectionForWorkspace(connectionId, workspaceId) {
    const id = validateUuid(connectionId, 'Connection ID');
    const result = await pool.query('SELECT * FROM integration_connections WHERE id = $1 LIMIT 1', [id]);
    const connection = result.rows[0];
    if (!connection) throw new HttpError(404, 'connection_not_found', 'Connection was not found.');
    if (connection.workspace_id !== workspaceId) throw new HttpError(403, 'connection_workspace_mismatch', 'Connection does not belong to this workspace.');
    if (connection.status === 'disconnected') throw new HttpError(409, 'connection_disconnected', 'Reconnect Google Sheets to continue.');
    return connection;
  }

  async function accessTokenFor(connection) {
    const aad = connectionAad(connection.id, connection.workspace_id, connection.token_version);
    let tokens = vault.decryptJson({ ciphertext: connection.token_ciphertext, iv: connection.token_iv, authTag: connection.token_auth_tag }, aad);
    const expiresAt = Number(tokens.expiresAt || new Date(connection.access_token_expires_at || 0).getTime());
    if (tokens.accessToken && expiresAt > Date.now() + 60_000) return tokens.accessToken;
    if (!tokens.refreshToken) {
      await pool.query("UPDATE integration_connections SET status='reauthorization_required', last_error_code='missing_refresh_token', updated_at=NOW() WHERE id=$1 AND workspace_id=$2", [connection.id, connection.workspace_id]);
      throw new HttpError(409, 'reauthorization_required', 'Reconnect Google Sheets to continue.');
    }
    try {
      const refreshed = await provider.refreshToken({ refreshToken: tokens.refreshToken, clientId, clientSecret });
      if (!refreshed.access_token) throw new GoogleProviderError('google_refresh_missing_access_token', 502, false);
      tokens = {
        ...tokens,
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token || tokens.refreshToken,
        tokenType: refreshed.token_type || tokens.tokenType || 'Bearer',
        scope: refreshed.scope || tokens.scope,
        expiresAt: Date.now() + Math.max(60, Number(refreshed.expires_in || 3600)) * 1000
      };
      const encrypted = vault.encryptJson(tokens, aad);
      await pool.query(`UPDATE integration_connections SET token_ciphertext=$1, token_iv=$2, token_auth_tag=$3,
        access_token_expires_at=$4, status='healthy', last_error_code=NULL, updated_at=NOW()
        WHERE id=$5 AND workspace_id=$6`, [encrypted.ciphertext, encrypted.iv, encrypted.authTag, new Date(tokens.expiresAt), connection.id, connection.workspace_id]);
      connection.token_ciphertext = encrypted.ciphertext;
      connection.token_iv = encrypted.iv;
      connection.token_auth_tag = encrypted.authTag;
      connection.access_token_expires_at = new Date(tokens.expiresAt);
      connection.status = 'healthy';
      return tokens.accessToken;
    } catch (error) {
      await pool.query("UPDATE integration_connections SET status='reauthorization_required', last_error_code=$1, updated_at=NOW() WHERE id=$2 AND workspace_id=$3", [error.code || 'google_refresh_failed', connection.id, connection.workspace_id]);
      throw new HttpError(409, 'reauthorization_required', 'Reconnect Google Sheets to continue.');
    }
  }

  async function spreadsheetMetadata(connection, spreadsheetInput) {
    const spreadsheetId = normalizeSpreadsheetId(spreadsheetInput);
    const cacheKey = `${connection.id}:${spreadsheetId}`;
    const cached = metadataCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.metadata;
    const accessToken = await accessTokenFor(connection);
    const result = await provider.spreadsheetMetadata(accessToken, spreadsheetId);
    const metadata = {
      spreadsheetId,
      title: String(result.body.properties?.title || 'Untitled spreadsheet'),
      locale: result.body.properties?.locale || null,
      timeZone: result.body.properties?.timeZone || null,
      sheets: (result.body.sheets || []).map((sheet) => ({
        sheetId: Number(sheet.properties?.sheetId), title: String(sheet.properties?.title || ''),
        index: Number(sheet.properties?.index || 0), rowCount: Number(sheet.properties?.gridProperties?.rowCount || 0),
        columnCount: Number(sheet.properties?.gridProperties?.columnCount || 0), sheetType: sheet.properties?.sheetType || 'GRID'
      })).filter((sheet) => Number.isSafeInteger(sheet.sheetId) && sheet.title),
      providerRequestId: result.requestId
    };
    metadataCache.set(cacheKey, { metadata, expiresAt: Date.now() + metadataCacheTtlMs });
    if (metadataCache.size > 500) metadataCache.delete(metadataCache.keys().next().value);
    return metadata;
  }

  async function spreadsheetFiles(connection, pageToken = '') {
    const accessToken = await accessTokenFor(connection);
    const result = await provider.spreadsheetFiles(accessToken, normalizePageToken(pageToken));
    return {
      spreadsheets: (result.body.files || []).map((file) => ({
        spreadsheetId: String(file.id || ''),
        title: String(file.name || 'Untitled spreadsheet'),
        modifiedTime: file.modifiedTime || null
      })).filter((file) => spreadsheetIdPattern.test(file.spreadsheetId)),
      nextPageToken: result.body.nextPageToken || null,
      incompleteSearch: Boolean(result.body.incompleteSearch),
      providerRequestId: result.requestId
    };
  }

  async function selectedValues(accessToken, spreadsheetId, sheet, rangeInput, options = {}) {
    const ranges = normalizeRanges(rangeInput);
    const rangeRoles = normalizeRangeRoles(ranges, options.rangeRoles);
    const sourceRanges = ranges.map((range) => `${escapeSheetTitle(sheet.title)}!${range}`);
    const result = ranges.length === 1
      ? await provider.spreadsheetValues(accessToken, spreadsheetId, sourceRanges[0], options)
      : await provider.spreadsheetValueRanges(accessToken, spreadsheetId, sourceRanges, options);
    const valueRanges = ranges.length === 1 ? [{ values: result.body.values }] : (result.body.valueRanges || []);
    return {
      result,
      ranges,
      range: ranges.join(','),
      sourceRanges,
      sourceRange: sourceRanges.join(', '),
      rangeRoles,
      values: rangeRoles.length ? combineRoleSelectedValues(ranges, valueRanges, rangeRoles) : combineSelectedValues(ranges, valueRanges),
      goalValues: rangeRoles.length ? combineGoalSelectedValues(ranges, valueRanges, rangeRoles) : null
    };
  }

  async function previewSelection(connection, body) {
    const metadata = await spreadsheetMetadata(connection, body.spreadsheet);
    const sheetId = Number(body.sheetId);
    const sheet = metadata.sheets.find((candidate) => candidate.sheetId === sheetId);
    if (!sheet) throw new HttpError(422, 'sheet_not_found', 'Choose a sheet from the selected spreadsheet.');
    const displayType = String(body.displayType || 'scorecard');
    if (!displayTypes.has(displayType)) throw new HttpError(422, 'invalid_display_type', 'Choose a supported KPI display.');
    const aggregation = scalarDisplayTypes.has(displayType) ? 'single_value' : 'sum';
    const accessToken = await accessTokenFor(connection);
    const startedAt = Date.now();
    const selected = await selectedValues(accessToken, metadata.spreadsheetId, sheet, body.range, { rangeRoles: body.rangeRoles });
    const includeHeaders = body.includeHeaders === true || selected.rangeRoles.some((item) => item.role === 'header');
    const { range, sourceRange, result } = selected;
    let payload = null;
    let comparison = null;
    let comparisonValues = null;
    let comparisonContext = null;
    const comparisonRangeInput = String(body.comparisonRange || '').trim();
    if (comparisonRangeInput) {
      if (!comparisonDisplayTypes.has(displayType)) throw new HttpError(422, 'comparison_not_supported', 'This display does not use comparison cells.');
      const comparisonSheetId = Number(body.comparisonSheetId ?? sheetId);
      const comparisonSheet = metadata.sheets.find((candidate) => candidate.sheetId === comparisonSheetId);
      if (!comparisonSheet) throw new HttpError(422, 'comparison_sheet_not_found', 'Choose a comparison sheet from this spreadsheet.');
      const comparisonRanges = normalizeRanges(comparisonRangeInput);
      const comparisonRange = comparisonRanges.join(',');
      if (comparisonSheet.sheetId === sheet.sheetId && comparisonRange === range) {
        throw new HttpError(422, 'comparison_matches_kpi_range', 'Choose comparison cells that are different from the KPI range.');
      }
      const comparisonAggregation = scalarDisplayTypes.has(displayType) ? 'single_value' : 'sum';
      const comparisonIncludeHeaders = body.comparisonIncludeHeaders === true;
      const comparisonSelection = await selectedValues(accessToken, metadata.spreadsheetId, comparisonSheet, comparisonRange);
      const comparisonSourceRange = comparisonSelection.sourceRange;
      comparisonValues = comparisonSelection.values;
      comparisonContext = { comparisonResult: comparisonSelection.result, comparisonValues, comparisonAggregation, comparisonIncludeHeaders, comparisonRange, comparisonSourceRange, comparisonSheet };
    }
    payload = displayPayload(selected.values, aggregation, includeHeaders, displayType, comparisonValues, body.comparisonIncludeHeaders === true, selected.goalValues);
    if (payload?.layout === 'rep_metric_goal' && comparisonContext) {
      throw new HttpError(422, 'comparison_not_supported', 'This scorecard already uses its selected goal cell, so a second comparison range is not needed.');
    }
    const calculation = summarizeDisplay(selected.values, includeHeaders, displayType, payload);
    const goalCandidates = populatedValues(selected.goalValues, false);
    const sheetGoalValue = payload?.layout === 'rep_metric_goal'
      ? payload.goal.value
      : goalCandidates.length === 1 ? preparedMetricValue(goalCandidates[0], 'The selected goal') : null;
    const goalSource = goalCandidates.length || payload?.layout === 'rep_metric_goal' ? 'google_sheets' : 'manual';
    if (comparisonContext) {
      const comparisonCalculation = scalarDisplayTypes.has(displayType)
        ? calculateKpi(comparisonContext.comparisonValues, comparisonContext.comparisonAggregation, comparisonContext.comparisonIncludeHeaders)
        : {
            value: (payload.items || []).reduce((total, item) => total + (item.comparisonValue ?? 0), 0),
            sourceRowCount: populatedValues(comparisonContext.comparisonValues, comparisonContext.comparisonIncludeHeaders).length
          };
      comparison = {
        value: comparisonCalculation.value, sourceRowCount: comparisonCalculation.sourceRowCount,
        range: comparisonContext.comparisonRange, sourceRange: comparisonContext.comparisonSourceRange, sheet: comparisonContext.comparisonSheet,
        aggregation: comparisonContext.comparisonAggregation, includeHeaders: comparisonContext.comparisonIncludeHeaders,
        delta: calculation.value - comparisonCalculation.value,
        percentChange: null
      };
      comparison.delta = calculation.value - comparison.value;
      comparison.percentChange = comparison.value === 0 ? null : ((calculation.value - comparison.value) / Math.abs(comparison.value)) * 100;
    }
    return {
      ...calculation, goalValue: sheetGoalValue, goalSource, aggregation, includeHeaders, range, rangeRoles: selected.rangeRoles, sourceRange, sheet, comparison,
      displayType, displayPayload: payload,
      spreadsheetId: metadata.spreadsheetId, spreadsheetTitle: metadata.title,
      fetchedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
      providerStatus: result.status, providerRequestId: result.requestId
    };
  }

  async function gridPreview(connection, params) {
    const metadata = await spreadsheetMetadata(connection, params.get('spreadsheet'));
    const sheetId = Number(params.get('sheetId'));
    const sheet = metadata.sheets.find((candidate) => candidate.sheetId === sheetId);
    if (!sheet || sheet.sheetType !== 'GRID') throw new HttpError(422, 'sheet_not_found', 'Choose a grid sheet from the selected spreadsheet.');
    const startRow = gridIndex(params.get('row'), sheet.rowCount, 'Row');
    const startColumn = gridIndex(params.get('column'), sheet.columnCount, 'Column');
    const requestedRows = gridWindowSize(params.get('rows'), 12, 50, 'Grid rows');
    const requestedColumns = gridWindowSize(params.get('columns'), 8, 20, 'Grid columns');
    const rowCount = Math.min(requestedRows, sheet.rowCount - startRow + 1);
    const columnCount = Math.min(requestedColumns, sheet.columnCount - startColumn + 1);
    const endRow = startRow + rowCount - 1;
    const endColumn = startColumn + columnCount - 1;
    const range = `${columnLabel(startColumn)}${startRow}:${columnLabel(endColumn)}${endRow}`;
    const sourceRange = `${escapeSheetTitle(sheet.title)}!${range}`;
    const accessToken = await accessTokenFor(connection);
    const result = await provider.spreadsheetValues(accessToken, metadata.spreadsheetId, sourceRange, { formatted: true });
    const sourceValues = Array.isArray(result.body.values) ? result.body.values : [];
    const values = Array.from({ length: rowCount }, (_, rowIndex) =>
      Array.from({ length: columnCount }, (_, columnIndex) => sourceValues[rowIndex]?.[columnIndex] ?? '')
    );
    return {
      spreadsheetTitle: metadata.title, sheet: { ...sheet }, range, sourceRange,
      startRow, startColumn, rowCount, columnCount, maxRows: sheet.rowCount, maxColumns: sheet.columnCount,
      columns: Array.from({ length: columnCount }, (_, index) => columnLabel(startColumn + index)), values
    };
  }

  async function startOAuth(req, res, session) {
    requireConfigured();
    requireAdmin(session);
    const body = await readJson(req);
    if (!['google', 'google_sheets'].includes(String(body.provider || ''))) throw new HttpError(422, 'provider_not_supported', 'Choose Google Sheets.');
    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const id = randomUUID();
    const encrypted = vault.encryptJson({ verifier }, `oauth:${id}:${session.workspace_id}`);
    await pool.query('DELETE FROM oauth_transactions WHERE expires_at <= NOW() OR consumed_at IS NOT NULL');
    await pool.query(`INSERT INTO oauth_transactions
      (id, workspace_id, user_id, provider, state_digest, pkce_ciphertext, pkce_iv, pkce_auth_tag, return_path, expires_at)
      VALUES ($1,$2,$3,'google_sheets',$4,$5,$6,$7,'/app',NOW()+INTERVAL '10 minutes')`,
    [id, session.workspace_id, session.id, digest(state), encrypted.ciphertext, encrypted.iv, encrypted.authTag]);
    const url = new URL(provider.authorizationUrl);
    url.search = new URLSearchParams({
      client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: googleScopes.join(' '),
      access_type: 'offline', include_granted_scopes: 'true', prompt: 'consent', state,
      code_challenge: challenge, code_challenge_method: 'S256'
    }).toString();
    return sendJson(res, 200, { authorizationUrl: url.toString(), expiresInSeconds: 600 });
  }

  async function handleCallback(req, res, url) {
    requireConfigured();
    const state = String(url.searchParams.get('state') || '');
    if (!state || state.length > 256) return redirect(res, '/app?integration=google&status=invalid_state');
    const session = await currentSession(req);
    if (!session?.can_access_app) return redirect(res, '/login?oauth=google');
    const client = await pool.connect();
    let transaction;
    try {
      await client.query('BEGIN');
      const result = await client.query(`SELECT * FROM oauth_transactions
        WHERE state_digest=$1 AND provider='google_sheets' AND consumed_at IS NULL AND expires_at>NOW() FOR UPDATE`, [digest(state)]);
      transaction = result.rows[0];
      if (!transaction || transaction.workspace_id !== session.workspace_id || transaction.user_id !== session.id) {
        await client.query('ROLLBACK');
        return redirect(res, '/app?integration=google&status=invalid_state');
      }
      await client.query('UPDATE oauth_transactions SET consumed_at=NOW() WHERE id=$1', [transaction.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
    if (url.searchParams.get('error')) return redirect(res, '/app?integration=google&status=denied');
    const code = String(url.searchParams.get('code') || '');
    if (!code || code.length > 4096) return redirect(res, '/app?integration=google&status=missing_code');
    try {
      const { verifier } = vault.decryptJson({ ciphertext: transaction.pkce_ciphertext, iv: transaction.pkce_iv, authTag: transaction.pkce_auth_tag }, oauthAad(transaction));
      const tokenResponse = await provider.exchangeCode({ code, clientId, clientSecret, redirectUri, codeVerifier: verifier });
      if (!tokenResponse.access_token) throw new GoogleProviderError('google_exchange_missing_access_token', 502, false);
      const grantedScopes = String(tokenResponse.scope || '').split(/\s+/).filter(Boolean);
      if (grantedScopes.length && [...requiredGoogleScopes].some((scope) => !grantedScopes.includes(scope))) {
        throw new GoogleProviderError('google_required_scope_missing', 403, false);
      }
      const identity = await provider.userInfo(tokenResponse.access_token);
      if (!identity.sub || !identity.email || identity.email_verified === false) throw new GoogleProviderError('google_identity_not_verified', 502, false);
      const existingResult = await pool.query(`SELECT * FROM integration_connections
        WHERE workspace_id=$1 AND provider='google_sheets' AND external_account_id=$2 LIMIT 1`, [session.workspace_id, String(identity.sub)]);
      const existing = existingResult.rows[0];
      const connectionId = existing?.id || randomUUID();
      let refreshToken = tokenResponse.refresh_token || null;
      if (!refreshToken && existing) {
        const old = vault.decryptJson({ ciphertext: existing.token_ciphertext, iv: existing.token_iv, authTag: existing.token_auth_tag }, connectionAad(existing.id, existing.workspace_id, existing.token_version));
        refreshToken = old.refreshToken || null;
      }
      if (!refreshToken) throw new GoogleProviderError('google_refresh_token_missing', 502, false);
      const expiresAt = Date.now() + Math.max(60, Number(tokenResponse.expires_in || 3600)) * 1000;
      const tokenPayload = {
        accessToken: tokenResponse.access_token, refreshToken, tokenType: tokenResponse.token_type || 'Bearer',
        scope: tokenResponse.scope || googleScopes.join(' '), expiresAt
      };
      const encrypted = vault.encryptJson(tokenPayload, connectionAad(connectionId, session.workspace_id));
      const scopes = String(tokenPayload.scope).split(/\s+/).filter(Boolean);
      await pool.query(`INSERT INTO integration_connections
        (id,workspace_id,provider,external_account_id,external_account_email,scopes,status,token_ciphertext,token_iv,token_auth_tag,access_token_expires_at)
        VALUES ($1,$2,'google_sheets',$3,$4,$5,'healthy',$6,$7,$8,$9)
        ON CONFLICT (workspace_id,provider,external_account_id) DO UPDATE SET
          external_account_email=EXCLUDED.external_account_email, scopes=EXCLUDED.scopes, status='healthy',
          token_ciphertext=EXCLUDED.token_ciphertext, token_iv=EXCLUDED.token_iv, token_auth_tag=EXCLUDED.token_auth_tag,
          access_token_expires_at=EXCLUDED.access_token_expires_at, last_error_code=NULL, disconnected_at=NULL, updated_at=NOW()`,
      [connectionId, session.workspace_id, String(identity.sub), String(identity.email).toLowerCase(), scopes, encrypted.ciphertext, encrypted.iv, encrypted.authTag, new Date(expiresAt)]);
      return redirect(res, '/app?integration=google&status=connected');
    } catch (error) {
      console.error('[google-oauth] callback failed', error.code || error.message || 'unknown');
      return redirect(res, '/app?integration=google&status=failed');
    }
  }

  async function connectionsForWorkspace(workspaceId) {
    const result = await pool.query(`SELECT id,provider,external_account_email,scopes,status,last_sync_at,last_error_code,created_at,updated_at
      FROM integration_connections WHERE workspace_id=$1 AND status<>'disconnected' ORDER BY created_at`, [workspaceId]);
    return result.rows.map(publicConnection);
  }

  async function listConnections(res, session) {
    requireEditor(session);
    return sendJson(res, 200, { connections: await connectionsForWorkspace(session.workspace_id), configured: ready });
  }

  function publicKpi(row, { includeSourceDetails = true } = {}) {
    const result = {
      id: row.id, name: row.name, displayFormat: row.display_format,
      displayType: row.display_type, periodGranularity: row.period_granularity, displayPayload: row.display_payload,
      goalDirection: row.goal_direction || 'higher_is_better',
      goalCalendarType: row.goal_calendar_type || 'weekdays',
      goalTimezone: row.goal_timezone || 'America/Denver',
      goalValue: (row.goal_source === 'google_sheets' ? row.snapshot_goal_value : row.goal_value) === null ? null : Number(row.goal_source === 'google_sheets' ? row.snapshot_goal_value : row.goal_value),
      refreshSeconds: row.refresh_seconds, staleAfterSeconds: row.stale_after_seconds, status: row.status,
      value: row.value === null ? null : Number(row.value),
      comparisonValue: row.comparison_value === null ? null : Number(row.comparison_value),
      comparisonDelta: row.comparison_delta === null ? null : Number(row.comparison_delta),
      sourceRowCount: row.source_row_count, fetchedAt: row.fetched_at,
      lastSyncAt: row.last_sync_at, nextSyncAt: row.next_sync_at,
      metricId: row.engagement?.metricId || null,
      certification: row.engagement?.certification ? (includeSourceDetails ? row.engagement.certification : {
        status: row.engagement.certification.status,
        method: row.engagement.certification.method,
        certifiedAt: row.engagement.certification.certifiedAt
      }) : null,
      goal: row.engagement?.goal || null,
      intelligence: row.engagement?.intelligence || null
    };
    if (!includeSourceDetails) return result;
    return {
      ...result,
      provider: row.provider, connectionId: row.connection_id,
      spreadsheetId: row.spreadsheet_id, spreadsheetTitle: row.spreadsheet_title, sheetId: Number(row.sheet_id), sheetTitle: row.sheet_title,
      range: row.a1_range, rangeRoles: row.range_roles || [], aggregation: row.aggregation, includeHeaders: row.include_headers,
      goalSource: row.goal_source || 'manual',
      comparisonSheetId: row.comparison_sheet_id === null ? null : Number(row.comparison_sheet_id), comparisonSheetTitle: row.comparison_sheet_title,
      comparisonRange: row.comparison_a1_range, comparisonAggregation: row.comparison_aggregation, comparisonIncludeHeaders: row.comparison_include_headers,
      sourceRange: row.source_range, comparisonSourceRange: row.comparison_source_range,
      lineageHash: row.lineage_hash, lastErrorCode: row.last_error_code
    };
  }

  async function kpisForWorkspace(workspaceId, { includeSourceDetails = true } = {}) {
    const result = await pool.query(`SELECT m.*, s.value, s.goal_value AS snapshot_goal_value, s.source_row_count, s.source_range, s.comparison_value, s.comparison_source_range, s.comparison_delta, s.display_payload, s.fetched_at, s.lineage_hash
      FROM kpi_mappings m LEFT JOIN LATERAL (
        SELECT value,goal_value,source_row_count,source_range,comparison_value,comparison_source_range,comparison_delta,display_payload,fetched_at,lineage_hash FROM metric_snapshots
        WHERE workspace_id=m.workspace_id AND mapping_id=m.id ORDER BY fetched_at DESC LIMIT 1
      ) s ON TRUE WHERE m.workspace_id=$1 AND m.status<>'deleted' ORDER BY m.created_at`, [workspaceId]);
    const engagement = engagementEnabled ? await engagementForMappings(pool, workspaceId, result.rows.map((row) => row.id)) : new Map();
    return result.rows.map((row) => publicKpi({ ...row, engagement: engagement.get(row.id) || null }, { includeSourceDetails }));
  }

  async function listKpis(res, session) {
    return sendJson(res, 200, { kpis: await kpisForWorkspace(session.workspace_id, { includeSourceDetails: canEdit(session) }) });
  }

  function normalizeDashboardLayoutForIds(input = {}, validIds = []) {
    const validIdSet = new Set(validIds);
    const suppliedOrder = Array.isArray(input?.kpiOrder) ? input.kpiOrder.map(String) : [];
    const kpiOrder = [...new Set([...suppliedOrder.filter((id) => validIdSet.has(id)), ...validIds])];
    return {
      preset: ['balanced', 'kpi-focus', 'compact'].includes(input?.preset) ? input.preset : 'balanced',
      showTrend: input?.showTrend !== false,
      showActionCenter: input?.showActionCenter !== false,
      kpiOrder
    };
  }

  async function normalizeDashboardLayout(workspaceId, input = {}) {
    const result = await pool.query("SELECT id FROM kpi_mappings WHERE workspace_id=$1 AND status<>'deleted' ORDER BY created_at", [workspaceId]);
    return normalizeDashboardLayoutForIds(input, result.rows.map((row) => row.id));
  }

  async function dashboardSettings(res, session) {
    const stored = await pool.query('SELECT layout,updated_at FROM workspace_dashboard_settings WHERE workspace_id=$1', [session.workspace_id]);
    const layout = await normalizeDashboardLayout(session.workspace_id, stored.rows[0]?.layout || {});
    return sendJson(res, 200, { dashboard: { layout, updatedAt: stored.rows[0]?.updated_at || null } });
  }

  async function bootstrap(res, session, url = null) {
    if (url?.searchParams.get('board') === 'visual-qa') {
      const access = visualQaAccess(env, session);
      if (!access.allowed) return sendJson(res, 404, { error: 'Not found' });
      const brand = (await pool.query("SELECT id,version,name,tokens,published_at FROM brand_packages WHERE workspace_id=$1 AND status='published' LIMIT 1", [session.workspace_id])).rows[0] || null;
      const board = createVisualQaBoard({
        workspaceId: session.workspace_id,
        workspaceName: session.workspace_name,
        brand,
        now: visualQaNow(env)
      });
      const { billing_status: billingStatus, can_access_app: canAccessApp, ...user } = session;
      const capabilities = {
        ...capabilitiesFor(session),
        manageDashboard: false,
        manageKpis: false,
        syncKpis: false,
        viewSourceDetails: false,
        browseDataSources: false,
        manageDataSources: false,
        readDisplays: false,
        manageDisplays: false,
        manageBilling: false,
        readEvents: false,
        readAutomations: false,
        manageAutomationDrafts: false,
        publishAutomations: false,
        manageAutomationDestinations: false,
        retryAutomationActions: false
      };
      return sendJson(res, 200, {
        session: { authenticated: true, canAccessApp, billing: { status: billingStatus }, user, capabilities },
        connections: { connections: [], configured: false, restricted: true },
        kpis: { kpis: board.kpis },
        dashboard: { dashboard: board.dashboard },
        engagement: { summary: { certified: 0, stale: 1, latestVerifiedAt: null }, events: [] },
        brand: board.brand,
        visualQa: board.visualQa
      });
    }
    if (engagementEnabled) await backfillWorkspaceEngagement(pool, session.workspace_id);
    const includeSourceDetails = canEdit(session);
    const [connections, kpis, stored, brand, events] = await Promise.all([
      includeSourceDetails ? connectionsForWorkspace(session.workspace_id) : Promise.resolve([]),
      kpisForWorkspace(session.workspace_id, { includeSourceDetails }),
      pool.query('SELECT layout,updated_at FROM workspace_dashboard_settings WHERE workspace_id=$1', [session.workspace_id]),
      ensurePublishedBrand(pool, session.workspace_id, session.workspace_name),
      engagementEnabled && includeSourceDetails ? listDomainEvents(pool, session.workspace_id, 50) : Promise.resolve([])
    ]);
    const { billing_status: billingStatus, can_access_app: canAccessApp, ...user } = session;
    const layout = normalizeDashboardLayoutForIds(stored.rows[0]?.layout || {}, kpis.map((kpi) => kpi.id));
    return sendJson(res, 200, {
      session: { authenticated: true, canAccessApp, billing: { status: billingStatus }, user, capabilities: capabilitiesFor(session) },
      connections: { connections, configured: ready, restricted: !includeSourceDetails },
      kpis: { kpis },
      dashboard: { dashboard: { layout, updatedAt: stored.rows[0]?.updated_at || null } },
      engagement: {
        summary: {
          certified: kpis.filter((kpi) => kpi.certification?.status === 'certified').length,
          stale: kpis.filter((kpi) => kpi.status !== 'active').length,
          latestVerifiedAt: kpis.map((kpi) => kpi.fetchedAt).filter(Boolean).sort().at(-1) || null
        },
        events
      },
      brand: { id: brand.id, version: brand.version, name: brand.name, tokens: brand.tokens, publishedAt: brand.published_at }
    });
  }

  async function displaySnapshot(workspaceId, selectedKpiIds = null) {
    if (engagementEnabled) await backfillWorkspaceEngagement(pool, workspaceId);
    const [allKpis, stored, workspace] = await Promise.all([
      kpisForWorkspace(workspaceId, { includeSourceDetails: false }),
      pool.query('SELECT layout,updated_at FROM workspace_dashboard_settings WHERE workspace_id=$1', [workspaceId]),
      pool.query('SELECT name FROM workspaces WHERE id=$1', [workspaceId])
    ]);
    const workspaceName = workspace.rows[0]?.name || 'Customer workspace';
    const brand = await ensurePublishedBrand(pool, workspaceId, workspaceName);
    const selected = Array.isArray(selectedKpiIds) && selectedKpiIds.length ? new Set(selectedKpiIds) : null;
    const kpis = selected ? allKpis.filter((kpi) => selected.has(kpi.id)) : allKpis;
    const layout = normalizeDashboardLayoutForIds(stored.rows[0]?.layout || {}, kpis.map((kpi) => kpi.id));
    return {
      workspace: { id: workspaceId, name: workspaceName },
      brand: { id: brand.id, version: brand.version, name: brand.name, tokens: brand.tokens, publishedAt: brand.published_at },
      dashboard: { layout, updatedAt: stored.rows[0]?.updated_at || null },
      kpis
    };
  }

  async function saveDashboardSettings(req, res, session) {
    requireEditor(session);
    const body = await readJson(req);
    const layout = await normalizeDashboardLayout(session.workspace_id, body.layout || {});
    const result = await pool.query(`INSERT INTO workspace_dashboard_settings (workspace_id,layout,updated_by)
      VALUES ($1,$2::jsonb,$3)
      ON CONFLICT (workspace_id) DO UPDATE SET layout=EXCLUDED.layout,updated_by=EXCLUDED.updated_by,updated_at=NOW()
      RETURNING updated_at`, [session.workspace_id, JSON.stringify(layout), session.id]);
    return sendJson(res, 200, { dashboard: { layout, updatedAt: result.rows[0].updated_at } });
  }

  async function deleteKpi(res, session, mappingId) {
    requireEditor(session);
    const id = validateUuid(mappingId, 'KPI ID');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const linkedAutomations = (await client.query(`SELECT ar.id,ar.name,ar.state
        FROM metric_definitions md
        JOIN automation_rules ar ON ar.workspace_id=md.workspace_id AND ar.metric_id=md.id
        WHERE md.workspace_id=$1 AND md.mapping_id=$2 AND ar.state<>'archived'
        ORDER BY ar.updated_at DESC FOR UPDATE OF ar`, [session.workspace_id, id])).rows;
      if (linkedAutomations.length) {
        throw new HttpError(409, 'kpi_has_linked_automations',
          `Archive ${linkedAutomations.length === 1 ? 'the linked automation' : `all ${linkedAutomations.length} linked automations`} before deleting this KPI.`,
          { count: linkedAutomations.length, automations: linkedAutomations.map((rule) => ({ id: rule.id, name: rule.name, state: rule.state })) });
      }
      const deleted = await client.query(`UPDATE kpi_mappings SET status='deleted',updated_at=NOW()
        WHERE id=$1 AND workspace_id=$2 AND status<>'deleted' RETURNING id,name`, [id, session.workspace_id]);
      if (!deleted.rows[0]) throw new HttpError(404, 'kpi_not_found', 'KPI was not found in this workspace.');
      if (engagementEnabled) await client.query(`UPDATE metric_definitions SET certification_status='suspended',suspended_at=NOW(),updated_at=NOW()
        WHERE workspace_id=$1 AND mapping_id=$2`, [session.workspace_id, id]);
      const settings = await client.query('SELECT layout FROM workspace_dashboard_settings WHERE workspace_id=$1 FOR UPDATE', [session.workspace_id]);
      if (settings.rows[0]) {
        const layout = settings.rows[0].layout || {};
        const kpiOrder = Array.isArray(layout.kpiOrder) ? layout.kpiOrder.filter((item) => item !== id) : [];
        await client.query('UPDATE workspace_dashboard_settings SET layout=$1::jsonb,updated_by=$2,updated_at=NOW() WHERE workspace_id=$3',
          [JSON.stringify({ ...layout, kpiOrder }), session.id, session.workspace_id]);
      }
      await client.query('COMMIT');
      return sendJson(res, 200, { deleted: true, kpi: deleted.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function saveKpi(req, res, session) {
    requireEditor(session);
    const body = await readJson(req);
    const connection = await connectionForWorkspace(body.connectionId, session.workspace_id);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) throw new HttpError(422, 'invalid_kpi_name', 'Enter a KPI name between 2 and 80 characters.');
    const displayFormat = String(body.displayFormat || 'number');
    if (!displayFormats.has(displayFormat)) throw new HttpError(422, 'invalid_display_format', 'Choose a supported display format.');
    const displayType = String(body.displayType || 'scorecard');
    if (!displayTypes.has(displayType)) throw new HttpError(422, 'invalid_display_type', 'Choose a supported KPI display.');
    const periodGranularity = ['rep_cards','goal_pace','gauge'].includes(displayType) ? String(body.periodGranularity || 'month') : null;
    if (periodGranularity !== null && !periodGranularities.has(periodGranularity)) throw new HttpError(422, 'invalid_period_granularity', 'Choose a daily, weekly, monthly, or yearly period.');
    const goalDirection = goalDirections.has(body.goalDirection) ? body.goalDirection : 'higher_is_better';
    const goalCalendarType = goalCalendars.has(body.goalCalendarType) ? body.goalCalendarType : 'weekdays';
    const goalTimezone = String(body.goalTimezone || 'America/Denver');
    try { new Intl.DateTimeFormat('en', { timeZone: goalTimezone }).format(); } catch { throw new HttpError(422, 'invalid_goal_timezone', 'Choose a supported goal timezone.'); }
    const manualGoalValue = body.goalValue === '' || body.goalValue === null || body.goalValue === undefined ? null : Number(body.goalValue);
    if (manualGoalValue !== null && !Number.isFinite(manualGoalValue)) throw new HttpError(422, 'invalid_goal', 'Enter a numeric goal or leave it blank.');
    const preview = await previewSelection(connection, body);
    const goalValue = preview.goalSource === 'google_sheets' ? null : manualGoalValue;
    const mappingId = randomUUID();
    const snapshotId = randomUUID();
    let engagementResult = null;
    const lineageHash = digest(`${session.workspace_id}:${connection.id}:${preview.spreadsheetId}:${preview.sheet.sheetId}:${preview.range}:${JSON.stringify(preview.rangeRoles)}:${preview.aggregation}:${preview.includeHeaders}:${preview.comparison?.sourceRange || ''}:${preview.comparison?.aggregation || ''}:${preview.comparison?.includeHeaders || false}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO kpi_mappings
        (id,workspace_id,connection_id,name,provider,spreadsheet_id,spreadsheet_title,sheet_id,sheet_title,a1_range,range_roles,aggregation,include_headers,display_format,display_type,period_granularity,goal_value,goal_source,comparison_sheet_id,comparison_sheet_title,comparison_a1_range,comparison_aggregation,comparison_include_headers,status,last_sync_at,next_sync_at)
        VALUES ($1,$2,$3,$4,'google_sheets',$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'active',NOW(),NOW()+INTERVAL '5 minutes')`,
      [mappingId, session.workspace_id, connection.id, name, preview.spreadsheetId, preview.spreadsheetTitle, preview.sheet.sheetId, preview.sheet.title, preview.range, JSON.stringify(preview.rangeRoles), preview.aggregation, preview.includeHeaders, displayFormat, displayType, periodGranularity, goalValue, preview.goalSource, preview.comparison?.sheet.sheetId ?? null, preview.comparison?.sheet.title ?? null, preview.comparison?.range ?? null, preview.comparison?.aggregation ?? null, preview.comparison?.includeHeaders ?? false]);
      await client.query('UPDATE kpi_mappings SET goal_direction=$1,goal_calendar_type=$2,goal_timezone=$3 WHERE workspace_id=$4 AND id=$5',
        [goalDirection, goalCalendarType, goalTimezone, session.workspace_id, mappingId]);
      await client.query(`INSERT INTO metric_snapshots
        (id,workspace_id,mapping_id,value,goal_value,source_row_count,source_range,comparison_value,comparison_source_range,comparison_delta,display_payload,lineage_hash,fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [snapshotId, session.workspace_id, mappingId, preview.value, preview.goalValue, preview.sourceRowCount, preview.sourceRange, preview.comparison?.value ?? null, preview.comparison?.sourceRange ?? null, preview.comparison?.delta ?? null, preview.displayPayload, lineageHash]);
      await client.query(`INSERT INTO integration_sync_runs
        (id,workspace_id,mapping_id,status,attempt_count,provider_status,provider_request_id,source_row_count,duration_ms,started_at,finished_at)
        VALUES ($1,$2,$3,'succeeded',1,$4,$5,$6,$7,NOW(),NOW())`,
      [randomUUID(), session.workspace_id, mappingId, preview.providerStatus, preview.providerRequestId, preview.sourceRowCount, preview.durationMs]);
      const engagementMapping = (await client.query('SELECT * FROM kpi_mappings WHERE workspace_id=$1 AND id=$2', [session.workspace_id, mappingId])).rows[0];
      if (engagementEnabled) {
        engagementResult = await recordSnapshotEngagement(client, { mapping: engagementMapping, snapshotId, value: preview.value, goalValue: preview.goalValue ?? goalValue, fetchedAt: preview.fetchedAt });
        await recordMetricSnapshotEvent(client, { mapping: engagementMapping, snapshotId, value: preview.value, goalValue: preview.goalValue ?? goalValue, fetchedAt: preview.fetchedAt, engagement: engagementResult });
      }
      await client.query("UPDATE integration_connections SET last_sync_at=NOW(), status='healthy', last_error_code=NULL, updated_at=NOW() WHERE id=$1 AND workspace_id=$2", [connection.id, session.workspace_id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    return sendJson(res, 201, { kpi: { id: mappingId, metricId: engagementResult?.metric?.id || null, name, value: preview.value, goalValue: preview.goalValue ?? goalValue, goalSource: preview.goalSource, comparison: preview.comparison, status: 'active', sourceRange: preview.sourceRange, fetchedAt: preview.fetchedAt, lineageHash } });
  }

  async function updateKpi(req, res, session, mappingId) {
    requireEditor(session);
    const id = validateUuid(mappingId, 'KPI ID');
    const existing = (await pool.query("SELECT * FROM kpi_mappings WHERE id=$1 AND workspace_id=$2 AND status<>'deleted'", [id, session.workspace_id])).rows[0];
    if (!existing) throw new HttpError(404, 'kpi_not_found', 'KPI was not found in this workspace.');
    const body = await readJson(req);
    const connection = await connectionForWorkspace(body.connectionId, session.workspace_id);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) throw new HttpError(422, 'invalid_kpi_name', 'Enter a KPI name between 2 and 80 characters.');
    const displayFormat = String(body.displayFormat || 'number');
    if (!displayFormats.has(displayFormat)) throw new HttpError(422, 'invalid_display_format', 'Choose a supported display format.');
    const displayType = String(body.displayType || 'scorecard');
    if (!displayTypes.has(displayType)) throw new HttpError(422, 'invalid_display_type', 'Choose a supported KPI display.');
    const periodGranularity = ['rep_cards','goal_pace','gauge'].includes(displayType) ? String(body.periodGranularity || 'month') : null;
    if (periodGranularity !== null && !periodGranularities.has(periodGranularity)) throw new HttpError(422, 'invalid_period_granularity', 'Choose a daily, weekly, monthly, or yearly period.');
    const goalDirection = goalDirections.has(body.goalDirection) ? body.goalDirection : 'higher_is_better';
    const goalCalendarType = goalCalendars.has(body.goalCalendarType) ? body.goalCalendarType : 'weekdays';
    const goalTimezone = String(body.goalTimezone || 'America/Denver');
    try { new Intl.DateTimeFormat('en', { timeZone: goalTimezone }).format(); } catch { throw new HttpError(422, 'invalid_goal_timezone', 'Choose a supported goal timezone.'); }
    const manualGoalValue = body.goalValue === '' || body.goalValue === null || body.goalValue === undefined ? null : Number(body.goalValue);
    if (manualGoalValue !== null && !Number.isFinite(manualGoalValue)) throw new HttpError(422, 'invalid_goal', 'Enter a numeric goal or leave it blank.');
    const preview = await previewSelection(connection, body);
    const goalValue = preview.goalSource === 'google_sheets' ? null : manualGoalValue;
    const lineageHash = digest(`${session.workspace_id}:${connection.id}:${preview.spreadsheetId}:${preview.sheet.sheetId}:${preview.range}:${JSON.stringify(preview.rangeRoles)}:${preview.aggregation}:${preview.includeHeaders}:${preview.comparison?.sourceRange || ''}:${preview.comparison?.aggregation || ''}:${preview.comparison?.includeHeaders || false}`);
    const snapshotId = randomUUID();
    let engagementResult = null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`UPDATE kpi_mappings SET
        connection_id=$1,name=$2,spreadsheet_id=$3,spreadsheet_title=$4,sheet_id=$5,sheet_title=$6,a1_range=$7,range_roles=$8::jsonb,
        aggregation=$9,include_headers=$10,display_format=$11,display_type=$12,period_granularity=$13,goal_value=$14,goal_source=$15,
        comparison_sheet_id=$16,comparison_sheet_title=$17,comparison_a1_range=$18,comparison_aggregation=$19,comparison_include_headers=$20,
        status='active',last_sync_at=NOW(),next_sync_at=NOW()+INTERVAL '5 minutes',last_error_code=NULL,updated_at=NOW()
        WHERE id=$21 AND workspace_id=$22 AND status<>'deleted' RETURNING id`,
      [connection.id, name, preview.spreadsheetId, preview.spreadsheetTitle, preview.sheet.sheetId, preview.sheet.title, preview.range, JSON.stringify(preview.rangeRoles), preview.aggregation, preview.includeHeaders, displayFormat, displayType, periodGranularity, goalValue, preview.goalSource, preview.comparison?.sheet.sheetId ?? null, preview.comparison?.sheet.title ?? null, preview.comparison?.range ?? null, preview.comparison?.aggregation ?? null, preview.comparison?.includeHeaders ?? false, id, session.workspace_id]);
      if (!updated.rows[0]) throw new HttpError(404, 'kpi_not_found', 'KPI was not found in this workspace.');
      await client.query('UPDATE kpi_mappings SET goal_direction=$1,goal_calendar_type=$2,goal_timezone=$3 WHERE workspace_id=$4 AND id=$5',
        [goalDirection, goalCalendarType, goalTimezone, session.workspace_id, id]);
      await client.query(`INSERT INTO metric_snapshots
        (id,workspace_id,mapping_id,value,goal_value,source_row_count,source_range,comparison_value,comparison_source_range,comparison_delta,display_payload,lineage_hash,fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [snapshotId, session.workspace_id, id, preview.value, preview.goalValue, preview.sourceRowCount, preview.sourceRange, preview.comparison?.value ?? null, preview.comparison?.sourceRange ?? null, preview.comparison?.delta ?? null, preview.displayPayload, lineageHash]);
      await client.query(`INSERT INTO integration_sync_runs
        (id,workspace_id,mapping_id,status,attempt_count,provider_status,provider_request_id,source_row_count,duration_ms,started_at,finished_at)
        VALUES ($1,$2,$3,'succeeded',1,$4,$5,$6,$7,NOW(),NOW())`,
      [randomUUID(), session.workspace_id, id, preview.providerStatus, preview.providerRequestId, preview.sourceRowCount, preview.durationMs]);
      const engagementMapping = (await client.query('SELECT * FROM kpi_mappings WHERE workspace_id=$1 AND id=$2', [session.workspace_id, id])).rows[0];
      if (engagementEnabled) {
        engagementResult = await recordSnapshotEngagement(client, { mapping: engagementMapping, snapshotId, value: preview.value, goalValue: preview.goalValue ?? goalValue, fetchedAt: preview.fetchedAt });
        await recordMetricSnapshotEvent(client, { mapping: engagementMapping, snapshotId, value: preview.value, goalValue: preview.goalValue ?? goalValue, fetchedAt: preview.fetchedAt, engagement: engagementResult });
      }
      await client.query("UPDATE integration_connections SET last_sync_at=NOW(),status='healthy',last_error_code=NULL,updated_at=NOW() WHERE id=$1 AND workspace_id=$2", [connection.id, session.workspace_id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    return sendJson(res, 200, { kpi: { id, metricId: engagementResult?.metric?.id || null, name, value: preview.value, goalValue: preview.goalValue ?? goalValue, goalSource: preview.goalSource, status: 'active', sourceRange: preview.sourceRange, fetchedAt: preview.fetchedAt, lineageHash } });
  }

  async function performSync(mapping, connection) {
    const runId = randomUUID();
    await pool.query("INSERT INTO integration_sync_runs (id,workspace_id,mapping_id,status) VALUES ($1,$2,$3,'running')", [runId, mapping.workspace_id, mapping.id]);
    try {
      const preview = await previewSelection(connection, {
        spreadsheet: mapping.spreadsheet_id, sheetId: Number(mapping.sheet_id), range: mapping.a1_range, rangeRoles: mapping.range_roles, aggregation: mapping.aggregation, includeHeaders: mapping.include_headers, displayType: mapping.display_type,
        comparisonSheetId: mapping.comparison_sheet_id, comparisonRange: mapping.comparison_a1_range, comparisonAggregation: mapping.comparison_aggregation,
        comparisonIncludeHeaders: mapping.comparison_include_headers
      });
      const lineageHash = digest(`${mapping.workspace_id}:${connection.id}:${preview.spreadsheetId}:${preview.sheet.sheetId}:${preview.range}:${JSON.stringify(preview.rangeRoles)}:${preview.aggregation}:${preview.includeHeaders}:${preview.comparison?.sourceRange || ''}:${preview.comparison?.aggregation || ''}:${preview.comparison?.includeHeaders || false}`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const snapshotId = randomUUID();
        await client.query(`INSERT INTO metric_snapshots (id,workspace_id,mapping_id,value,goal_value,source_row_count,source_range,comparison_value,comparison_source_range,comparison_delta,display_payload,lineage_hash,fetched_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`, [snapshotId, mapping.workspace_id, mapping.id, preview.value, preview.goalValue, preview.sourceRowCount, preview.sourceRange, preview.comparison?.value ?? null, preview.comparison?.sourceRange ?? null, preview.comparison?.delta ?? null, preview.displayPayload, lineageHash]);
        await client.query("UPDATE kpi_mappings SET status='active', last_sync_at=NOW(), next_sync_at=NOW()+make_interval(secs=>$1), last_error_code=NULL, updated_at=NOW() WHERE id=$2 AND workspace_id=$3", [mapping.refresh_seconds, mapping.id, mapping.workspace_id]);
        const engagementMapping = { ...mapping, status: 'active' };
        if (engagementEnabled) {
          const engagement = await recordSnapshotEngagement(client, { mapping: engagementMapping, snapshotId, value: preview.value, goalValue: preview.goalValue ?? mapping.goal_value, fetchedAt: preview.fetchedAt });
          await recordMetricSnapshotEvent(client, { mapping: engagementMapping, snapshotId, value: preview.value, goalValue: preview.goalValue ?? mapping.goal_value, fetchedAt: preview.fetchedAt, engagement });
        }
        await client.query("UPDATE integration_connections SET status='healthy', last_sync_at=NOW(), last_error_code=NULL, updated_at=NOW() WHERE id=$1 AND workspace_id=$2", [connection.id, mapping.workspace_id]);
        await client.query(`UPDATE integration_sync_runs SET status='succeeded', provider_status=$1, provider_request_id=$2,
          source_row_count=$3, duration_ms=$4, finished_at=NOW() WHERE id=$5 AND workspace_id=$6`,
        [preview.providerStatus, preview.providerRequestId, preview.sourceRowCount, preview.durationMs, runId, mapping.workspace_id]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return { id: mapping.id, value: preview.value, goalValue: preview.goalValue ?? (mapping.goal_value === null ? null : Number(mapping.goal_value)), goalSource: mapping.goal_source, comparison: preview.comparison, displayPayload: preview.displayPayload, status: 'active', sourceRange: preview.sourceRange, fetchedAt: preview.fetchedAt, lineageHash };
    } catch (error) {
      const code = error.code || 'google_sync_failed';
      await pool.query("UPDATE kpi_mappings SET status='degraded', next_sync_at=NOW()+make_interval(secs=>refresh_seconds), last_error_code=$1, updated_at=NOW() WHERE id=$2 AND workspace_id=$3", [code, mapping.id, mapping.workspace_id]);
      if (engagementEnabled) await pool.query(`UPDATE metric_definitions SET certification_status='suspended',suspended_at=NOW(),updated_at=NOW()
        WHERE workspace_id=$1 AND mapping_id=$2`, [mapping.workspace_id, mapping.id]);
      await pool.query("UPDATE integration_sync_runs SET status='failed', error_code=$1, finished_at=NOW() WHERE id=$2 AND workspace_id=$3", [code, runId, mapping.workspace_id]);
      throw error;
    }
  }

  async function syncKpi(res, session, mappingId) {
    requireEditor(session);
    const id = validateUuid(mappingId, 'KPI ID');
    const result = await pool.query('SELECT * FROM kpi_mappings WHERE id=$1 LIMIT 1', [id]);
    const mapping = result.rows[0];
    if (!mapping) throw new HttpError(404, 'kpi_not_found', 'KPI was not found.');
    if (mapping.workspace_id !== session.workspace_id) throw new HttpError(403, 'kpi_workspace_mismatch', 'KPI does not belong to this workspace.');
    const connection = await connectionForWorkspace(mapping.connection_id, session.workspace_id);
    return sendJson(res, 200, { kpi: await performSync(mapping, connection) });
  }

  async function runDueSyncs() {
    if (!ready) return 0;
    const client = await pool.connect();
    let due = [];
    try {
      await client.query('BEGIN');
      const result = await client.query(`SELECT id FROM kpi_mappings
        WHERE status IN ('active','degraded') AND next_sync_at<=NOW()
        ORDER BY next_sync_at FOR UPDATE SKIP LOCKED LIMIT 10`);
      due = result.rows;
      if (due.length) {
        await client.query(`UPDATE kpi_mappings SET next_sync_at=NOW()+make_interval(secs=>refresh_seconds)
          WHERE id=ANY($1::uuid[])`, [due.map((row) => row.id)]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    for (const item of due) {
      try {
        const mapping = (await pool.query('SELECT * FROM kpi_mappings WHERE id=$1', [item.id])).rows[0];
        if (!mapping) continue;
        const connection = await connectionForWorkspace(mapping.connection_id, mapping.workspace_id);
        await performSync(mapping, connection);
      } catch (error) {
        console.error('[google-sync] scheduled sync failed', item.id, error.code || error.message || 'unknown');
      }
    }
    return due.length;
  }

  function startScheduler() {
    if (!ready || env.AXOBOARD_DISABLE_SYNC_SCHEDULER === 'true') return () => {};
    const intervalMs = Math.max(10_000, Number(env.AXOBOARD_SYNC_INTERVAL_MS || 60_000));
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try { await runDueSyncs(); }
      catch (error) { console.error('[google-sync] scheduler failed', error.message || 'unknown'); }
      finally { running = false; }
    };
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    setTimeout(tick, Math.min(5_000, intervalMs)).unref();
    return () => clearInterval(timer);
  }

  async function disconnect(res, session, connectionId) {
    requireAdmin(session);
    const connection = await connectionForWorkspace(connectionId, session.workspace_id);
    const tokens = vault.decryptJson({ ciphertext: connection.token_ciphertext, iv: connection.token_iv, authTag: connection.token_auth_tag }, connectionAad(connection.id, connection.workspace_id, connection.token_version));
    await provider.revoke(tokens.refreshToken || tokens.accessToken);
    const tombstone = vault.encryptJson({ disconnected: true, at: new Date().toISOString() }, connectionAad(connection.id, connection.workspace_id, connection.token_version));
    await pool.query(`UPDATE integration_connections SET status='disconnected', token_ciphertext=$1, token_iv=$2, token_auth_tag=$3,
      access_token_expires_at=NULL, disconnected_at=NOW(), updated_at=NOW() WHERE id=$4 AND workspace_id=$5`,
    [tombstone.ciphertext, tombstone.iv, tombstone.authTag, connection.id, session.workspace_id]);
    await pool.query("UPDATE kpi_mappings SET status='degraded', last_error_code='connection_disconnected', updated_at=NOW() WHERE connection_id=$1 AND workspace_id=$2 AND status<>'deleted'", [connection.id, session.workspace_id]);
    if (engagementEnabled) await pool.query(`UPDATE metric_definitions SET certification_status='suspended',suspended_at=NOW(),updated_at=NOW()
      WHERE workspace_id=$1 AND mapping_id IN (SELECT id FROM kpi_mappings WHERE workspace_id=$1 AND connection_id=$2)`, [session.workspace_id, connection.id]);
    return sendJson(res, 200, { disconnected: true });
  }

  async function handleProductRequest(req, res, url, session) {
    const pathname = url.pathname;
    if (pathname === '/api/axoboard/bootstrap' && req.method === 'GET') return bootstrap(res, session, url);
    if (pathname === '/api/axoboard/integrations/oauth/start' && req.method === 'POST') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return startOAuth(req, res, session);
    }
    if (pathname === '/api/axoboard/integrations/connections' && req.method === 'GET') return listConnections(res, session);
    if (pathname === '/api/axoboard/integrations/google/spreadsheets' && req.method === 'GET') {
      requireEditor(session);
      const connection = await connectionForWorkspace(url.searchParams.get('connectionId'), session.workspace_id);
      return sendJson(res, 200, await spreadsheetFiles(connection, url.searchParams.get('pageToken')));
    }
    if (pathname === '/api/axoboard/integrations/google/spreadsheet' && req.method === 'GET') {
      requireEditor(session);
      const connection = await connectionForWorkspace(url.searchParams.get('connectionId'), session.workspace_id);
      const metadata = await spreadsheetMetadata(connection, url.searchParams.get('spreadsheet'));
      return sendJson(res, 200, { spreadsheet: metadata });
    }
    if (pathname === '/api/axoboard/integrations/google/grid' && req.method === 'GET') {
      requireEditor(session);
      const connection = await connectionForWorkspace(url.searchParams.get('connectionId'), session.workspace_id);
      return sendJson(res, 200, { grid: await gridPreview(connection, url.searchParams) });
    }
    if (pathname === '/api/axoboard/kpis/google/preview' && req.method === 'POST') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      requireEditor(session);
      const body = await readJson(req);
      const connection = await connectionForWorkspace(body.connectionId, session.workspace_id);
      let preview;
      try {
        preview = await previewSelection(connection, body);
      } catch (error) {
        if (error instanceof HttpError && error.status === 422) {
          return sendJson(res, 200, { preview: null, validation: { valid: false, code: error.code, error: error.message } });
        }
        throw error;
      }
      return sendJson(res, 200, { preview: { value: preview.value, goalValue: preview.goalValue, goalSource: preview.goalSource, range: preview.range, rangeRoles: preview.rangeRoles, sourceRange: preview.sourceRange, sourceRowCount: preview.sourceRowCount, spreadsheetTitle: preview.spreadsheetTitle, sheet: preview.sheet, includeHeaders: preview.includeHeaders, comparison: preview.comparison, displayType: preview.displayType, displayPayload: preview.displayPayload, fetchedAt: preview.fetchedAt } });
    }
    if (pathname === '/api/axoboard/kpis' && req.method === 'GET') return listKpis(res, session);
    if (pathname === '/api/axoboard/kpis' && req.method === 'POST') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return saveKpi(req, res, session);
    }
    if (pathname === '/api/axoboard/dashboard' && req.method === 'GET') return dashboardSettings(res, session);
    if (pathname === '/api/axoboard/dashboard' && req.method === 'PUT') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return saveDashboardSettings(req, res, session);
    }
    if (pathname === '/api/axoboard/events' && req.method === 'GET') {
      if (!engagementEnabled) throw new HttpError(404, 'engagement_disabled', 'Engagement features are not enabled.');
      requireEditor(session);
      return sendJson(res, 200, { events: await listDomainEvents(pool, session.workspace_id, url.searchParams.get('limit')) });
    }
    const trustMatch = pathname.match(/^\/api\/axoboard\/metrics\/([^/]+)\/trust$/);
    if (trustMatch && req.method === 'GET') {
      if (!engagementEnabled) throw new HttpError(404, 'engagement_disabled', 'Engagement features are not enabled.');
      const mappingId = validateUuid(trustMatch[1], 'Metric ID');
      const trust = await metricTrust(pool, session.workspace_id, mappingId);
      if (!trust) throw new HttpError(404, 'metric_not_found', 'Metric was not found in this workspace.');
      if (canEdit(session)) return sendJson(res, 200, { metric: trust });
      const { source: _source, lineageHash: _lineageHash, definition: _definition, ...viewerTrust } = trust;
      const { errorCode: _errorCode, ...freshness } = viewerTrust.freshness || {};
      return sendJson(res, 200, { metric: { ...viewerTrust, freshness } });
    }
    const syncMatch = pathname.match(/^\/api\/axoboard\/kpis\/([^/]+)\/sync$/);
    if (syncMatch && req.method === 'POST') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return syncKpi(res, session, syncMatch[1]);
    }
    const kpiMatch = pathname.match(/^\/api\/axoboard\/kpis\/([^/]+)$/);
    if (kpiMatch && req.method === 'PUT') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return updateKpi(req, res, session, kpiMatch[1]);
    }
    if (kpiMatch && req.method === 'DELETE') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return deleteKpi(res, session, kpiMatch[1]);
    }
    const disconnectMatch = pathname.match(/^\/api\/axoboard\/integrations\/connections\/([^/]+)$/);
    if (disconnectMatch && req.method === 'DELETE') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return disconnect(res, session, disconnectMatch[1]);
    }
    return false;
  }

  async function runProductRequest(req, res, url, session) {
    try { return await handleProductRequest(req, res, url, session); }
    catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
      if (error instanceof GoogleProviderError) {
        console.error('[google-api] request failed', error.code, error.status);
        const status = error.status === 404 ? 422 : (error.status === 401 || error.status === 403 ? 409 : 502);
        const message = status === 422 ? 'Spreadsheet was not accessible with this Google account.' : status === 409 ? 'Reconnect Google Sheets to approve spreadsheet browsing.' : 'Google Sheets is temporarily unavailable.';
        return sendJson(res, status, { error: message, code: error.code });
      }
      throw error;
    }
  }

  return { ready, handleCallback, handleProductRequest: runProductRequest, runDueSyncs, startScheduler, displaySnapshot };
}

export const googleIntegrationInternals = {
  calculateKpi, combineSelectedValues, displayPayload, normalizeSpreadsheetId, normalizeRange, normalizeRanges, normalizePageToken,
  recordMetricSnapshotEvent
};
