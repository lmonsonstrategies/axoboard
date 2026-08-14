import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { GoogleProviderError } from './google-provider.mjs';

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
const aggregations = new Set(['single_value', 'sum', 'average', 'count', 'min', 'max', 'latest_non_empty']);
const displayFormats = new Set(['number', 'currency', 'percentage']);

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
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

function normalizePageToken(value) {
  const token = String(value || '').trim();
  if (token.length > 2048 || /[^A-Za-z0-9._~+/=-]/.test(token)) throw new HttpError(422, 'invalid_page_token', 'Spreadsheet pagination token was not accepted.');
  return token;
}

function escapeSheetTitle(value) { return `'${String(value).replaceAll("'", "''")}'`; }

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function calculateKpi(values, aggregation) {
  const flattened = Array.isArray(values) ? values.flat().filter((value) => value !== '' && value !== null && value !== undefined) : [];
  if (!flattened.length) throw new HttpError(422, 'empty_range', 'The selected range is empty.');
  if (aggregation === 'count') return { value: flattened.length, sourceRowCount: flattened.length };
  if (aggregation === 'latest_non_empty') {
    const latest = numericValue(flattened.at(-1));
    if (latest === null) throw new HttpError(422, 'non_numeric_value', 'The latest non-empty cell is not numeric.');
    return { value: latest, sourceRowCount: flattened.length };
  }
  const numeric = flattened.map(numericValue).filter((value) => value !== null);
  if (!numeric.length) throw new HttpError(422, 'non_numeric_range', 'The selected range does not contain numeric values.');
  if (aggregation === 'single_value') return { value: numeric[0], sourceRowCount: flattened.length };
  if (aggregation === 'sum') return { value: numeric.reduce((total, value) => total + value, 0), sourceRowCount: flattened.length };
  if (aggregation === 'average') return { value: numeric.reduce((total, value) => total + value, 0) / numeric.length, sourceRowCount: flattened.length };
  if (aggregation === 'min') return { value: Math.min(...numeric), sourceRowCount: flattened.length };
  if (aggregation === 'max') return { value: Math.max(...numeric), sourceRowCount: flattened.length };
  throw new HttpError(422, 'invalid_aggregation', 'Choose a supported KPI calculation.');
}

function publicConnection(row) {
  return {
    id: row.id, provider: row.provider, accountEmail: row.external_account_email,
    scopes: row.scopes, status: row.status, lastSyncAt: row.last_sync_at,
    lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function createGoogleIntegration({ pool, vault, provider, env = process.env, sendJson, readJson, currentSession, sameOrigin }) {
  const clientId = String(env.AXOBOARD_GOOGLE_CLIENT_ID || '');
  const clientSecret = String(env.AXOBOARD_GOOGLE_CLIENT_SECRET || '');
  const redirectUri = String(env.AXOBOARD_GOOGLE_REDIRECT_URI || '');
  const ready = Boolean(pool && vault.ready && clientId && clientSecret && redirectUri);

  function requireConfigured() {
    if (!ready) throw new HttpError(503, 'google_not_configured', 'Google Sheets is not configured yet.');
  }

  function requireEditor(session) {
    if (!['owner', 'admin', 'editor'].includes(session.role)) throw new HttpError(403, 'editor_required', 'Workspace editor access is required.');
  }

  function requireAdmin(session) {
    if (!['owner', 'admin'].includes(session.role)) throw new HttpError(403, 'admin_required', 'Workspace admin access is required.');
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
    const accessToken = await accessTokenFor(connection);
    const result = await provider.spreadsheetMetadata(accessToken, spreadsheetId);
    return {
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

  async function previewSelection(connection, body) {
    const metadata = await spreadsheetMetadata(connection, body.spreadsheet);
    const sheetId = Number(body.sheetId);
    const sheet = metadata.sheets.find((candidate) => candidate.sheetId === sheetId);
    if (!sheet) throw new HttpError(422, 'sheet_not_found', 'Choose a sheet from the selected spreadsheet.');
    const range = normalizeRange(body.range);
    const aggregation = String(body.aggregation || 'single_value');
    if (!aggregations.has(aggregation)) throw new HttpError(422, 'invalid_aggregation', 'Choose a supported KPI calculation.');
    const sourceRange = `${escapeSheetTitle(sheet.title)}!${range}`;
    const accessToken = await accessTokenFor(connection);
    const startedAt = Date.now();
    const result = await provider.spreadsheetValues(accessToken, metadata.spreadsheetId, sourceRange);
    const calculation = calculateKpi(result.body.values, aggregation);
    return {
      ...calculation, aggregation, range, sourceRange, sheet,
      spreadsheetId: metadata.spreadsheetId, spreadsheetTitle: metadata.title,
      fetchedAt: new Date().toISOString(), durationMs: Date.now() - startedAt,
      providerStatus: result.status, providerRequestId: result.requestId
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

  async function listConnections(res, session) {
    const result = await pool.query(`SELECT id,provider,external_account_email,scopes,status,last_sync_at,last_error_code,created_at,updated_at
      FROM integration_connections WHERE workspace_id=$1 AND status<>'disconnected' ORDER BY created_at`, [session.workspace_id]);
    return sendJson(res, 200, { connections: result.rows.map(publicConnection), configured: ready });
  }

  async function listKpis(res, session) {
    const result = await pool.query(`SELECT m.*, s.value, s.source_row_count, s.source_range, s.fetched_at, s.lineage_hash
      FROM kpi_mappings m LEFT JOIN LATERAL (
        SELECT value,source_row_count,source_range,fetched_at,lineage_hash FROM metric_snapshots
        WHERE workspace_id=m.workspace_id AND mapping_id=m.id ORDER BY fetched_at DESC LIMIT 1
      ) s ON TRUE WHERE m.workspace_id=$1 AND m.status<>'deleted' ORDER BY m.created_at`, [session.workspace_id]);
    return sendJson(res, 200, { kpis: result.rows.map((row) => ({
      id: row.id, name: row.name, provider: row.provider, connectionId: row.connection_id,
      spreadsheetTitle: row.spreadsheet_title, sheetId: Number(row.sheet_id), sheetTitle: row.sheet_title,
      range: row.a1_range, aggregation: row.aggregation, displayFormat: row.display_format,
      refreshSeconds: row.refresh_seconds, staleAfterSeconds: row.stale_after_seconds, status: row.status,
      value: row.value === null ? null : Number(row.value), sourceRange: row.source_range,
      sourceRowCount: row.source_row_count, fetchedAt: row.fetched_at, lineageHash: row.lineage_hash,
      lastSyncAt: row.last_sync_at, nextSyncAt: row.next_sync_at, lastErrorCode: row.last_error_code
    })) });
  }

  async function saveKpi(req, res, session) {
    requireEditor(session);
    const body = await readJson(req);
    const connection = await connectionForWorkspace(body.connectionId, session.workspace_id);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) throw new HttpError(422, 'invalid_kpi_name', 'Enter a KPI name between 2 and 80 characters.');
    const displayFormat = String(body.displayFormat || 'number');
    if (!displayFormats.has(displayFormat)) throw new HttpError(422, 'invalid_display_format', 'Choose a supported display format.');
    const preview = await previewSelection(connection, body);
    const mappingId = randomUUID();
    const snapshotId = randomUUID();
    const lineageHash = digest(`${session.workspace_id}:${connection.id}:${preview.spreadsheetId}:${preview.sheet.sheetId}:${preview.range}:${preview.aggregation}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO kpi_mappings
        (id,workspace_id,connection_id,name,provider,spreadsheet_id,spreadsheet_title,sheet_id,sheet_title,a1_range,aggregation,display_format,status,last_sync_at,next_sync_at)
        VALUES ($1,$2,$3,$4,'google_sheets',$5,$6,$7,$8,$9,$10,$11,'active',NOW(),NOW()+INTERVAL '5 minutes')`,
      [mappingId, session.workspace_id, connection.id, name, preview.spreadsheetId, preview.spreadsheetTitle, preview.sheet.sheetId, preview.sheet.title, preview.range, preview.aggregation, displayFormat]);
      await client.query(`INSERT INTO metric_snapshots
        (id,workspace_id,mapping_id,value,source_row_count,source_range,lineage_hash,fetched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [snapshotId, session.workspace_id, mappingId, preview.value, preview.sourceRowCount, preview.sourceRange, lineageHash]);
      await client.query(`INSERT INTO integration_sync_runs
        (id,workspace_id,mapping_id,status,attempt_count,provider_status,provider_request_id,source_row_count,duration_ms,started_at,finished_at)
        VALUES ($1,$2,$3,'succeeded',1,$4,$5,$6,$7,NOW(),NOW())`,
      [randomUUID(), session.workspace_id, mappingId, preview.providerStatus, preview.providerRequestId, preview.sourceRowCount, preview.durationMs]);
      await client.query("UPDATE integration_connections SET last_sync_at=NOW(), status='healthy', last_error_code=NULL, updated_at=NOW() WHERE id=$1 AND workspace_id=$2", [connection.id, session.workspace_id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    return sendJson(res, 201, { kpi: { id: mappingId, name, value: preview.value, status: 'active', sourceRange: preview.sourceRange, fetchedAt: preview.fetchedAt, lineageHash } });
  }

  async function performSync(mapping, connection) {
    const runId = randomUUID();
    await pool.query("INSERT INTO integration_sync_runs (id,workspace_id,mapping_id,status) VALUES ($1,$2,$3,'running')", [runId, mapping.workspace_id, mapping.id]);
    try {
      const preview = await previewSelection(connection, { spreadsheet: mapping.spreadsheet_id, sheetId: Number(mapping.sheet_id), range: mapping.a1_range, aggregation: mapping.aggregation });
      const lineageHash = digest(`${mapping.workspace_id}:${connection.id}:${preview.spreadsheetId}:${preview.sheet.sheetId}:${preview.range}:${preview.aggregation}`);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`INSERT INTO metric_snapshots (id,workspace_id,mapping_id,value,source_row_count,source_range,lineage_hash,fetched_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`, [randomUUID(), mapping.workspace_id, mapping.id, preview.value, preview.sourceRowCount, preview.sourceRange, lineageHash]);
        await client.query("UPDATE kpi_mappings SET status='active', last_sync_at=NOW(), next_sync_at=NOW()+make_interval(secs=>$1), last_error_code=NULL, updated_at=NOW() WHERE id=$2 AND workspace_id=$3", [mapping.refresh_seconds, mapping.id, mapping.workspace_id]);
        await client.query("UPDATE integration_connections SET status='healthy', last_sync_at=NOW(), last_error_code=NULL, updated_at=NOW() WHERE id=$1 AND workspace_id=$2", [connection.id, mapping.workspace_id]);
        await client.query(`UPDATE integration_sync_runs SET status='succeeded', provider_status=$1, provider_request_id=$2,
          source_row_count=$3, duration_ms=$4, finished_at=NOW() WHERE id=$5 AND workspace_id=$6`,
        [preview.providerStatus, preview.providerRequestId, preview.sourceRowCount, preview.durationMs, runId, mapping.workspace_id]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return { id: mapping.id, value: preview.value, status: 'active', sourceRange: preview.sourceRange, fetchedAt: preview.fetchedAt, lineageHash };
    } catch (error) {
      const code = error.code || 'google_sync_failed';
      await pool.query("UPDATE kpi_mappings SET status='degraded', next_sync_at=NOW()+make_interval(secs=>refresh_seconds), last_error_code=$1, updated_at=NOW() WHERE id=$2 AND workspace_id=$3", [code, mapping.id, mapping.workspace_id]);
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
    return sendJson(res, 200, { disconnected: true });
  }

  async function handleProductRequest(req, res, url, session) {
    const pathname = url.pathname;
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
    if (pathname === '/api/axoboard/kpis/google/preview' && req.method === 'POST') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      requireEditor(session);
      const body = await readJson(req);
      const connection = await connectionForWorkspace(body.connectionId, session.workspace_id);
      const preview = await previewSelection(connection, body);
      return sendJson(res, 200, { preview: { value: preview.value, sourceRange: preview.sourceRange, sourceRowCount: preview.sourceRowCount, spreadsheetTitle: preview.spreadsheetTitle, sheet: preview.sheet, fetchedAt: preview.fetchedAt } });
    }
    if (pathname === '/api/axoboard/kpis' && req.method === 'GET') return listKpis(res, session);
    if (pathname === '/api/axoboard/kpis' && req.method === 'POST') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return saveKpi(req, res, session);
    }
    const syncMatch = pathname.match(/^\/api\/axoboard\/kpis\/([^/]+)\/sync$/);
    if (syncMatch && req.method === 'POST') {
      if (!sameOrigin(req)) throw new HttpError(403, 'origin_rejected', 'Request origin was not accepted.');
      return syncKpi(res, session, syncMatch[1]);
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
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, code: error.code });
      if (error instanceof GoogleProviderError) {
        console.error('[google-api] request failed', error.code, error.status);
        const status = error.status === 404 ? 422 : (error.status === 401 || error.status === 403 ? 409 : 502);
        const message = status === 422 ? 'Spreadsheet was not accessible with this Google account.' : status === 409 ? 'Reconnect Google Sheets to approve spreadsheet browsing.' : 'Google Sheets is temporarily unavailable.';
        return sendJson(res, status, { error: message, code: error.code });
      }
      throw error;
    }
  }

  return { ready, handleCallback, handleProductRequest: runProductRequest, runDueSyncs, startScheduler };
}

export const googleIntegrationInternals = { calculateKpi, normalizeSpreadsheetId, normalizeRange, normalizePageToken };
