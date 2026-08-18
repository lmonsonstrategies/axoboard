import { createHmac, randomBytes, randomUUID } from 'node:crypto';

const displayCookie = 'axo_display';
const pairingAlphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

class DisplayError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([key]) => key));
}

function safeUuid(value, label = 'Display ID') {
  const text = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) throw new DisplayError(404, 'not_found', `${label} was not found.`);
  return text;
}

function publicDevice(row) {
  const heartbeat = row.last_heartbeat_at ? new Date(row.last_heartbeat_at).getTime() : 0;
  const online = row.status === 'active' && heartbeat > Date.now() - 90_000;
  return {
    id: row.id, name: row.name, status: row.status, online, contentMode: row.content_mode,
    kpiIds: row.kpi_ids || [], rotationSeconds: row.rotation_seconds, pairedAt: row.paired_at,
    pairingExpiresAt: row.pairing_expires_at, lastHeartbeatAt: row.last_heartbeat_at, createdAt: row.created_at
  };
}

export function createDisplayRuntime({ pool, env = process.env, sendJson, readJson, sameOrigin, isRateLimited, loadWorkspaceDisplay, loadVisualQaDisplay, loadAutomationEvents }) {
  const secret = String(env.AXOBOARD_DISPLAY_TOKEN_SECRET || env.AXOBOARD_OAUTH_ENCRYPTION_KEY || '');
  const enabled = env.AXOBOARD_DISPLAY_RUNTIME_ENABLED !== 'false';
  const ready = Boolean(enabled && pool && secret.length >= 32 && loadWorkspaceDisplay);
  const appBaseUrl = String(env.APP_BASE_URL || 'https://axoboard.io').replace(/\/$/, '');
  const playerUrl = String(env.AXOBOARD_DISPLAY_BASE_URL || `${appBaseUrl}/tv`).replace(/\/$/, '');
  const digest = (purpose, value) => createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex');

  function oneTimeCode() {
    const bytes = randomBytes(8);
    return Array.from(bytes, (byte) => pairingAlphabet[byte % pairingAlphabet.length]).join('');
  }

  function cookie(req, token, maxAge = 365 * 24 * 60 * 60) {
    const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0];
    return `${displayCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${proto === 'https' ? '; Secure' : ''}; Max-Age=${maxAge}`;
  }

  async function validateKpis(workspaceId, requested) {
    const ids = [...new Set((Array.isArray(requested) ? requested : []).map((id) => safeUuid(id, 'KPI')))];
    if (!ids.length) return [];
    const result = await pool.query("SELECT id FROM kpi_mappings WHERE workspace_id=$1 AND id=ANY($2::uuid[]) AND status<>'deleted'", [workspaceId, ids]);
    if (result.rows.length !== ids.length) throw new DisplayError(422, 'invalid_kpis', 'Choose only KPIs from this workspace.');
    return ids;
  }

  async function list(res, session) {
    const result = await pool.query('SELECT * FROM display_devices WHERE workspace_id=$1 ORDER BY created_at DESC', [session.workspace_id]);
    return sendJson(res, 200, { displays: result.rows.map(publicDevice), configured: ready });
  }

  function requireAdmin(session) {
    if (!['owner', 'admin'].includes(session?.role)) {
      throw new DisplayError(403, 'admin_required', 'Workspace admin access is required.');
    }
  }

  async function createPairing(req, res, session) {
    if (!ready) throw new DisplayError(503, 'display_runtime_not_configured', 'Display pairing is not configured.');
    const body = await readJson(req);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) throw new DisplayError(422, 'invalid_name', 'Enter a screen name between 2 and 80 characters.');
    const contentMode = body.contentMode === 'selected_kpis' ? 'selected_kpis' : 'full_dashboard';
    const kpiIds = contentMode === 'selected_kpis' ? await validateKpis(session.workspace_id, body.kpiIds) : [];
    if (contentMode === 'selected_kpis' && !kpiIds.length) throw new DisplayError(422, 'empty_selection', 'Choose at least one KPI for this screen.');
    const rotationSeconds = Math.max(5, Math.min(300, Number(body.rotationSeconds) || 15));
    let code;
    let inserted;
    for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
      code = oneTimeCode();
      try {
        inserted = (await pool.query(`INSERT INTO display_devices
          (id,workspace_id,name,status,pairing_code_digest,pairing_expires_at,content_mode,kpi_ids,rotation_seconds,created_by)
          VALUES ($1,$2,$3,'pending',$4,NOW()+INTERVAL '10 minutes',$5,$6::uuid[],$7,$8) RETURNING *`,
        [randomUUID(), session.workspace_id, name, digest('pair', code), contentMode, kpiIds, rotationSeconds, session.id])).rows[0];
      } catch (error) { if (error.code !== '23505') throw error; }
    }
    if (!inserted) throw new DisplayError(503, 'code_generation_failed', 'Could not create a pairing code. Try again.');
    return sendJson(res, 201, { display: publicDevice(inserted), pairing: { code, expiresAt: inserted.pairing_expires_at, url: playerUrl } });
  }

  async function update(req, res, session, id) {
    const body = await readJson(req);
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) throw new DisplayError(422, 'invalid_name', 'Enter a screen name between 2 and 80 characters.');
    const contentMode = body.contentMode === 'selected_kpis' ? 'selected_kpis' : 'full_dashboard';
    const kpiIds = contentMode === 'selected_kpis' ? await validateKpis(session.workspace_id, body.kpiIds) : [];
    if (contentMode === 'selected_kpis' && !kpiIds.length) throw new DisplayError(422, 'empty_selection', 'Choose at least one KPI for this screen.');
    const rotationSeconds = Math.max(5, Math.min(300, Number(body.rotationSeconds) || 15));
    const result = await pool.query(`UPDATE display_devices SET name=$1,content_mode=$2,kpi_ids=$3::uuid[],rotation_seconds=$4,updated_at=NOW()
      WHERE workspace_id=$5 AND id=$6 AND status<>'revoked' RETURNING *`, [name, contentMode, kpiIds, rotationSeconds, session.workspace_id, safeUuid(id)]);
    if (!result.rows[0]) throw new DisplayError(404, 'not_found', 'Display was not found in this workspace.');
    return sendJson(res, 200, { display: publicDevice(result.rows[0]) });
  }

  async function revoke(res, session, id) {
    const result = await pool.query(`UPDATE display_devices SET status='revoked',token_digest=NULL,pairing_code_digest=NULL,
      pairing_expires_at=NULL,revoked_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2 AND status<>'revoked' RETURNING *`, [session.workspace_id, safeUuid(id)]);
    if (!result.rows[0]) throw new DisplayError(404, 'not_found', 'Display was not found in this workspace.');
    return sendJson(res, 200, { display: publicDevice(result.rows[0]) });
  }

  async function pair(req, res) {
    if (!ready) throw new DisplayError(503, 'display_runtime_not_configured', 'Display pairing is not configured.');
    if (isRateLimited(req, 'display_pair', 20, 10 * 60_000)) throw new DisplayError(429, 'rate_limited', 'Too many pairing attempts. Wait and try again.');
    const body = await readJson(req);
    const code = String(body.code || '').trim().toUpperCase().replace(/[^2-9A-HJ-NP-Z]/g, '');
    if (code.length !== 8) throw new DisplayError(422, 'invalid_code', 'Enter the eight-character pairing code.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = (await client.query(`SELECT * FROM display_devices WHERE pairing_code_digest=$1 AND status='pending'
        AND pairing_expires_at>NOW() FOR UPDATE`, [digest('pair', code)])).rows[0];
      if (!found) throw new DisplayError(404, 'pairing_not_found', 'That pairing code is invalid or expired.');
      const token = randomBytes(32).toString('base64url');
      const updated = (await client.query(`UPDATE display_devices SET status='active',token_digest=$1,pairing_code_digest=NULL,
        pairing_expires_at=NULL,paired_at=NOW(),last_heartbeat_at=NOW(),last_user_agent=$2,updated_at=NOW() WHERE id=$3 RETURNING *`,
      [digest('token', token), String(req.headers['user-agent'] || '').slice(0, 500), found.id])).rows[0];
      await client.query('COMMIT');
      return sendJson(res, 200, { paired: true, display: publicDevice(updated) }, { 'Set-Cookie': cookie(req, token) });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async function currentDevice(req) {
    const token = parseCookies(req)[displayCookie];
    if (!token || !ready) return null;
    return (await pool.query("SELECT * FROM display_devices WHERE token_digest=$1 AND status='active' LIMIT 1", [digest('token', token)])).rows[0] || null;
  }

  async function runtime(req, res, url) {
    const device = await currentDevice(req);
    if (!device) throw new DisplayError(401, 'display_unpaired', 'This display is not paired.');
    let snapshot;
    const visualQaRequested = url.searchParams.get('board') === 'visual-qa';
    if (visualQaRequested) {
      snapshot = typeof loadVisualQaDisplay === 'function' ? await loadVisualQaDisplay(device.workspace_id) : null;
      if (!snapshot) throw new DisplayError(404, 'visual_qa_not_found', 'Visual QA is not available for this display.');
    } else {
      snapshot = await loadWorkspaceDisplay(device.workspace_id, device.content_mode === 'selected_kpis' ? device.kpi_ids : null);
    }
    if (!visualQaRequested) {
      await pool.query('UPDATE display_devices SET last_heartbeat_at=NOW(),last_user_agent=$1,updated_at=NOW() WHERE id=$2 AND workspace_id=$3',
        [String(req.headers['user-agent'] || '').slice(0, 500), device.id, device.workspace_id]);
    }
    return sendJson(res, 200, { display: publicDevice({ ...device, last_heartbeat_at: new Date() }), ...snapshot });
  }

  async function heartbeat(req, res) {
    const device = await currentDevice(req);
    if (!device) throw new DisplayError(401, 'display_unpaired', 'This display is not paired.');
    await pool.query('UPDATE display_devices SET last_heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2', [device.id, device.workspace_id]);
    return sendJson(res, 200, { ok: true, at: new Date().toISOString() });
  }

  async function automationEvents(req, res, url) {
    const device = await currentDevice(req);
    if (!device) throw new DisplayError(401, 'display_unpaired', 'This display is not paired.');
    if (typeof loadAutomationEvents !== 'function') return sendJson(res, 200, { events: [], cursor: null, configured: false });
    try {
      const payload = await loadAutomationEvents(device.workspace_id, {
        after: url.searchParams.get('after') || '',
        limit: 50,
        displayId: device.id
      });
      await pool.query('UPDATE display_devices SET last_heartbeat_at=NOW(),updated_at=NOW() WHERE id=$1 AND workspace_id=$2', [device.id, device.workspace_id]);
      return sendJson(res, 200, { events: payload.events || [], cursor: payload.cursor || null, configured: !payload.disabled });
    } catch (error) {
      if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 500) {
        throw new DisplayError(error.status, error.code || 'automation_events_rejected', error.message || 'TV events could not be loaded.');
      }
      throw error;
    }
  }

  async function handleAdmin(req, res, url, session) {
    if (url.pathname === '/api/axoboard/displays' && req.method === 'GET') {
      requireAdmin(session);
      return list(res, session);
    }
    if (url.pathname === '/api/axoboard/displays/pairing-codes' && req.method === 'POST') {
      if (!sameOrigin(req)) throw new DisplayError(403, 'origin_rejected', 'Request origin was not accepted.');
      requireAdmin(session);
      return createPairing(req, res, session);
    }
    const match = url.pathname.match(/^\/api\/axoboard\/displays\/([^/]+)$/);
    if (match && req.method === 'PATCH') {
      if (!sameOrigin(req)) throw new DisplayError(403, 'origin_rejected', 'Request origin was not accepted.');
      requireAdmin(session);
      return update(req, res, session, match[1]);
    }
    const revokeMatch = url.pathname.match(/^\/api\/axoboard\/displays\/([^/]+)\/revoke$/);
    if (revokeMatch && req.method === 'POST') {
      if (!sameOrigin(req)) throw new DisplayError(403, 'origin_rejected', 'Request origin was not accepted.');
      requireAdmin(session);
      return revoke(res, session, revokeMatch[1]);
    }
    return false;
  }

  async function handlePublic(req, res, url) {
    try {
      if (url.pathname === '/api/display/status' && req.method === 'GET') {
        const device = await currentDevice(req);
        return sendJson(res, 200, { paired: Boolean(device), display: device ? publicDevice(device) : null });
      }
      if (url.pathname === '/api/display/pair' && req.method === 'POST') return await pair(req, res);
      if (url.pathname === '/api/display/runtime' && req.method === 'GET') return await runtime(req, res, url);
      if (url.pathname === '/api/display/automation-events' && req.method === 'GET') return await automationEvents(req, res, url);
      if (url.pathname === '/api/display/heartbeat' && req.method === 'POST') return await heartbeat(req, res);
      return false;
    } catch (error) {
      if (error instanceof DisplayError) return sendJson(res, error.status, { error: error.message, code: error.code });
      throw error;
    }
  }

  async function runAdmin(req, res, url, session) {
    try { return await handleAdmin(req, res, url, session); }
    catch (error) {
      if (error instanceof DisplayError) return sendJson(res, error.status, { error: error.message, code: error.code });
      throw error;
    }
  }

  return { ready, handleAdmin: runAdmin, handlePublic };
}
