import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import Stripe from 'stripe';
import { createVault } from './lib/crypto-vault.mjs';
import { createGoogleProvider } from './lib/google-provider.mjs';
import { createGoogleIntegration } from './lib/google-integration.mjs';

const { Pool } = pg;
const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const publicRoot = resolve(appRoot, 'wireframes');
const migrationsRoot = resolve(appRoot, 'migrations');
const port = Math.max(1, Number(process.env.PORT || 3000));
const sessionCookie = 'axo_session';
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const databaseUrl = process.env.DATABASE_URL || '';
const databaseSsl = process.env.DATABASE_SSL === 'true';
const pool = databaseUrl
  ? new Pool({ connectionString: databaseUrl, ssl: databaseSsl ? { rejectUnauthorized: false } : false, max: 10 })
  : null;
const appBaseUrl = String(process.env.APP_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');
const stripeSecretKey = String(process.env.STRIPE_SECRET_KEY || '');
const stripeWebhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || '');
const stripeStarterPrice = String(process.env.STRIPE_PRICE_STARTER_MONTHLY || '');
const stripePortalConfiguration = String(process.env.STRIPE_PORTAL_CONFIGURATION_ID || '');
const stripeOptions = process.env.NODE_ENV === 'test' && process.env.STRIPE_API_HOST
  ? { host: process.env.STRIPE_API_HOST, port: Number(process.env.STRIPE_API_PORT), protocol: 'http' }
  : {};
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { ...stripeOptions, apiVersion: '2025-12-15.clover', maxNetworkRetries: 2, timeout: 10_000 }) : null;
const oauthVault = createVault(process.env.AXOBOARD_OAUTH_ENCRYPTION_KEY);
const googleProvider = createGoogleProvider();
const googleIntegration = createGoogleIntegration({
  pool, vault: oauthVault, provider: googleProvider, env: process.env,
  sendJson, readJson, currentSession, sameOrigin
});

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml; charset=utf-8'], ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'], ['.xml', 'application/xml; charset=utf-8']
]);

const pageRoutes = new Map([
  ['/', 'landing.html'], ['/features', 'landing.html'], ['/integrations', 'landing.html'],
  ['/pricing', 'landing.html'], ['/faq', 'landing.html'], ['/login', 'auth.html'],
  ['/signup', 'auth.html'], ['/terms', 'terms.html'], ['/privacy', 'privacy.html']
]);
const publicStaticFiles = new Set(['marketing.css', 'marketing.js', 'auth.js', 'robots.txt', 'sitemap.xml', 'llms.txt']);
const publicAssetFiles = new Set([
  'assets/axoboard-wordmark-signature.svg',
  'assets/favicon/favicon-16.png',
  'assets/favicon/favicon-32.png',
  'assets/favicon/favicon-192.png',
  'assets/favicon/apple-touch-icon.png',
  'assets/providers/google-sheets.svg',
  'assets/providers/shopify.svg',
  'assets/providers/wix.svg',
  'assets/providers/microsoft-excel.svg',
  'assets/providers/hubspot.svg',
  'assets/providers/salesforce.svg'
]);
const productFiles = new Map([
  ['/app', 'index.html'],
  ['/app.js', 'app.js'],
  ['/styles.css', 'styles.css'],
  ['/assets/integrations/google-sheets.svg', 'assets/integrations/google-sheets.svg'],
  ['/assets/integrations/hubspot.svg', 'assets/integrations/hubspot.svg']
]);
const paidAccessRedirect = '/pricing?access=subscription_required';

const rateBuckets = new Map();

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function isRateLimited(req, action, limit = 10, windowMs = 15 * 60 * 1000) {
  const key = `${action}:${requestIp(req)}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0];
  return origin === `${proto}://${req.headers.host}`;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('invalid_json'); }
}

async function readRawBody(req, limit = 1_048_576) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }

function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, salt, expected] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const actual = scryptSync(password, Buffer.from(salt, 'base64url'), 64, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
    return timingSafeEqual(actual, Buffer.from(expected, 'base64url'));
  } catch { return false; }
}

function tokenDigest(token) { return createHash('sha256').update(token).digest('hex'); }

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([key]) => key));
}

function sessionHeader(req, token, maxAge = Math.floor(sessionLifetimeMs / 1000)) {
  const proto = String(req.headers['x-forwarded-proto'] || (req.socket.encrypted ? 'https' : 'http')).split(',')[0];
  const secure = proto === 'https' ? '; Secure' : '';
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=${maxAge}`;
}

function validateSignup(body) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const workspaceName = String(body.workspaceName || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return 'Enter a valid work email.';
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least 10 characters with a letter and number.';
  if (workspaceName.length < 2 || workspaceName.length > 80) return 'Enter a workspace name.';
  if (body.acceptTerms !== true) return 'Accept the terms to continue.';
  return null;
}

async function createSession(client, userId, workspaceId) {
  const token = randomBytes(32).toString('base64url');
  await client.query('INSERT INTO sessions (id, user_id, workspace_id, token_digest, expires_at) VALUES ($1, $2, $3, $4, $5)', [randomUUID(), userId, workspaceId, tokenDigest(token), new Date(Date.now() + sessionLifetimeMs)]);
  return token;
}

function canAccessApp(status) { return status === 'active'; }

function billingReady() {
  return Boolean(pool && stripe && stripeWebhookSecret && stripeStarterPrice && /^price_/.test(stripeStarterPrice));
}

function stripeStatusToLocal(status) {
  if (status === 'active') return 'active';
  if (status === 'canceled') return 'canceled';
  if (['past_due', 'unpaid', 'paused'].includes(status)) return 'past_due';
  return 'pending_payment';
}

function safeStripeId(value, prefix) {
  const id = typeof value === 'string' ? value : value?.id;
  return typeof id === 'string' && id.startsWith(prefix) ? id : null;
}

async function workspaceAccessForUser(client, userId) {
  const result = await client.query(`
    SELECT m.workspace_id, COALESCE(s.status, 'pending_payment') AS billing_status
    FROM memberships m
    LEFT JOIN subscriptions s ON s.workspace_id = m.workspace_id
    WHERE m.user_id = $1
    ORDER BY m.created_at ASC
    LIMIT 1
  `, [userId]);
  return result.rows[0] || null;
}

async function currentSession(req) {
  if (!pool) return null;
  const token = parseCookies(req)[sessionCookie];
  if (!token) return null;
  const result = await pool.query(`
    SELECT u.id, u.email, u.full_name, w.id AS workspace_id, w.name AS workspace_name, m.role,
      COALESCE(b.status, 'pending_payment') AS billing_status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN memberships m ON m.user_id = u.id AND m.workspace_id = s.workspace_id
    JOIN workspaces w ON w.id = s.workspace_id
    LEFT JOIN subscriptions b ON b.workspace_id = w.id
    WHERE s.token_digest = $1 AND s.expires_at > NOW()
    LIMIT 1
  `, [tokenDigest(token)]);
  const session = result.rows[0] || null;
  return session ? { ...session, can_access_app: canAccessApp(session.billing_status) } : null;
}

async function billingSession(req) {
  const session = await currentSession(req);
  if (!session) return null;
  if (!['owner', 'admin'].includes(session.role)) return { ...session, billing_forbidden: true };
  return session;
}

async function reconcileStripeEvent(client, event) {
  const object = event.data?.object || {};
  const eventCreated = Number(event.created || 0);
  if (!Number.isSafeInteger(eventCreated) || eventCreated <= 0) throw new Error('invalid_stripe_event_created');

  let workspaceId = String(object.metadata?.workspace_id || object.subscription_details?.metadata?.workspace_id || object.parent?.subscription_details?.metadata?.workspace_id || '').trim();
  const customerId = safeStripeId(object.customer, 'cus_');
  const subscriptionId = safeStripeId(object.subscription, 'sub_') || safeStripeId(object.parent?.subscription_details?.subscription, 'sub_') || (object.object === 'subscription' ? safeStripeId(object.id, 'sub_') : null);
  if (event.type.startsWith('invoice.') && !subscriptionId) return;
  const planKey = object.metadata?.plan_key || object.subscription_details?.metadata?.plan_key || object.parent?.subscription_details?.metadata?.plan_key;
  if (planKey && planKey !== 'starter_monthly') throw new Error('stripe_plan_not_allowed');
  if (!workspaceId && customerId) {
    const lookup = await client.query('SELECT workspace_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1', [customerId]);
    workspaceId = lookup.rows[0]?.workspace_id || '';
  }
  if (!workspaceId) return;

  const existingResult = await client.query('SELECT * FROM subscriptions WHERE workspace_id = $1 FOR UPDATE', [workspaceId]);
  const existing = existingResult.rows[0];
  if (!existing) throw new Error('stripe_workspace_not_found');
  if (customerId) {
    const customerOwner = await client.query('SELECT workspace_id FROM subscriptions WHERE stripe_customer_id = $1 AND workspace_id <> $2 LIMIT 1', [customerId, workspaceId]);
    if (customerOwner.rowCount) throw new Error('stripe_customer_cross_workspace');
  }
  if (subscriptionId) {
    const subscriptionOwner = await client.query('SELECT workspace_id FROM subscriptions WHERE stripe_subscription_id = $1 AND workspace_id <> $2 LIMIT 1', [subscriptionId, workspaceId]);
    if (subscriptionOwner.rowCount) throw new Error('stripe_subscription_cross_workspace');
  }
  if (existing.stripe_customer_id && customerId && existing.stripe_customer_id !== customerId) throw new Error('stripe_customer_workspace_mismatch');
  if (existing.stripe_subscription_id && subscriptionId && existing.stripe_subscription_id !== subscriptionId) throw new Error('stripe_subscription_workspace_mismatch');
  if (eventCreated < Number(existing.last_stripe_event_created_at || 0)) return;

  let nextStatus = existing.status;
  if (object.object === 'subscription') nextStatus = stripeStatusToLocal(object.status);
  if (event.type === 'invoice.paid') nextStatus = 'active';
  if (event.type === 'invoice.payment_failed') nextStatus = 'past_due';
  if (event.type === 'customer.subscription.deleted') nextStatus = 'canceled';
  const periodStart = object.current_period_start ? new Date(object.current_period_start * 1000) : existing.current_period_start;
  const periodEnd = object.current_period_end ? new Date(object.current_period_end * 1000) : existing.current_period_end;
  const priceId = object.items?.data?.[0]?.price?.id || existing.stripe_price_id;
  if (priceId && priceId !== stripeStarterPrice) throw new Error('stripe_price_not_allowed');

  await client.query("SELECT set_config('axoboard.audit_source', $1, true)", [`stripe:${event.type}`]);
  await client.query("SELECT set_config('axoboard.audit_actor', $1, true)", [event.id]);
  await client.query(`
    UPDATE subscriptions SET status = $1,
      stripe_customer_id = COALESCE($2, stripe_customer_id),
      stripe_subscription_id = COALESCE($3, stripe_subscription_id),
      stripe_price_id = COALESCE($4, stripe_price_id),
      current_period_start = COALESCE($5, current_period_start),
      current_period_end = COALESCE($6, current_period_end),
      cancel_at_period_end = $7,
      last_stripe_event_created_at = $8,
      updated_at = NOW()
    WHERE workspace_id = $9
  `, [nextStatus, customerId, subscriptionId, priceId, periodStart, periodEnd, Boolean(object.cancel_at_period_end), eventCreated, workspaceId]);
}

async function handleBilling(req, res, pathname) {
  if (pathname === '/api/billing/stripe/webhook' && req.method === 'POST') {
    if (!pool || !stripe || !stripeWebhookSecret) return sendJson(res, 503, { error: 'Billing is not configured.' });
    const rawBody = await readRawBody(req);
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, String(req.headers['stripe-signature'] || ''), stripeWebhookSecret);
    } catch {
      return sendJson(res, 400, { error: 'Webhook signature was not accepted.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(`
        INSERT INTO stripe_webhook_events (event_id, event_type, livemode, stripe_created_at)
        VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING RETURNING event_id
      `, [event.id, event.type, Boolean(event.livemode), Number(event.created)]);
      if (!inserted.rowCount) {
        await client.query('COMMIT');
        return sendJson(res, 200, { received: true, duplicate: true });
      }
      if (event.livemode !== (stripeSecretKey.startsWith('sk_live_'))) throw new Error('stripe_mode_mismatch');
      if (['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'].includes(event.type)) {
        await reconcileStripeEvent(client, event);
      }
      await client.query('COMMIT');
      return sendJson(res, 200, { received: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[billing] webhook failed', event?.id || 'unknown', error?.message || 'unknown');
      return sendJson(res, 500, { error: 'Webhook processing failed.' });
    } finally { client.release(); }
  }

  if (!billingReady()) return sendJson(res, 503, { error: 'Billing is not configured.' });
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Request origin was not accepted.' });
  const session = await billingSession(req);
  if (!session) return sendJson(res, 401, { error: 'Authentication required.' });
  if (session.billing_forbidden) return sendJson(res, 403, { error: 'Workspace billing access is required.' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' }, { Allow: 'POST' });

  const subscriptionResult = await pool.query('SELECT * FROM subscriptions WHERE workspace_id = $1 LIMIT 1', [session.workspace_id]);
  const localSubscription = subscriptionResult.rows[0];
  if (!localSubscription) return sendJson(res, 409, { error: 'Workspace subscription record is missing.' });

  if (pathname === '/api/billing/checkout-session') {
    if (localSubscription.status === 'active') return sendJson(res, 409, { error: 'Workspace already has active billing.' });
    let customerId = localSubscription.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: session.email, name: session.workspace_name,
        metadata: { workspace_id: session.workspace_id }
      }, { idempotencyKey: `customer:${session.workspace_id}` });
      customerId = customer.id;
      const bound = await pool.query(`UPDATE subscriptions SET stripe_customer_id = $1, updated_at = NOW()
        WHERE workspace_id = $2 AND (stripe_customer_id IS NULL OR stripe_customer_id = $1)`, [customerId, session.workspace_id]);
      if (!bound.rowCount) return sendJson(res, 409, { error: 'Workspace billing customer conflict.' });
    }
    const suppliedKey = String(req.headers['idempotency-key'] || randomUUID());
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(suppliedKey)) return sendJson(res, 422, { error: 'Idempotency key was not accepted.' });
    const checkout = await stripe.checkout.sessions.create({
      mode: 'subscription', customer: customerId,
      line_items: [{ price: stripeStarterPrice, quantity: 1 }],
      client_reference_id: session.workspace_id,
      metadata: { workspace_id: session.workspace_id, plan_key: 'starter_monthly' },
      subscription_data: { metadata: { workspace_id: session.workspace_id, plan_key: 'starter_monthly' } },
      success_url: `${appBaseUrl}/pricing?checkout=success`,
      cancel_url: `${appBaseUrl}/pricing?checkout=canceled`,
      consent_collection: { terms_of_service: 'required' },
      allow_promotion_codes: false
    }, { idempotencyKey: `checkout:${session.workspace_id}:${suppliedKey}` });
    return sendJson(res, 200, { url: checkout.url });
  }

  if (pathname === '/api/billing/portal-session') {
    if (!localSubscription.stripe_customer_id) return sendJson(res, 409, { error: 'Workspace does not have a billing customer yet.' });
    const portal = await stripe.billingPortal.sessions.create({
      customer: localSubscription.stripe_customer_id,
      return_url: `${appBaseUrl}/pricing`,
      ...(stripePortalConfiguration ? { configuration: stripePortalConfiguration } : {})
    });
    return sendJson(res, 200, { url: portal.url });
  }
  return sendJson(res, 404, { error: 'Not found' });
}

async function handleAuth(req, res, pathname) {
  if (pathname === '/api/auth/session' && req.method === 'GET' && !pool) {
    return sendJson(res, 200, { authenticated: false, canAccessApp: false, accountStorage: 'not_configured' });
  }
  if (!pool) return sendJson(res, 503, { error: 'Account storage is not configured yet.' });
  if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Request origin was not accepted.' });
  if (pathname === '/api/auth/session' && req.method === 'GET') {
    const session = await currentSession(req);
    if (!session) return sendJson(res, 200, { authenticated: false, canAccessApp: false });
    const { billing_status: billingStatus, can_access_app: canAccess, ...user } = session;
    return sendJson(res, 200, { authenticated: true, canAccessApp: canAccess, billing: { status: billingStatus }, user });
  }
  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    if (isRateLimited(req, 'signup', 8)) return sendJson(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const body = await readJson(req);
    const validationError = validateSignup(body);
    if (validationError) return sendJson(res, 422, { error: validationError });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const userId = randomUUID();
      const workspaceId = randomUUID();
      await client.query('INSERT INTO users (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)', [userId, normalizeEmail(body.email), String(body.name).trim(), hashPassword(String(body.password))]);
      await client.query('INSERT INTO workspaces (id, name, timezone) VALUES ($1, $2, $3)', [workspaceId, String(body.workspaceName).trim(), String(body.timezone || 'America/Denver')]);
      await client.query('INSERT INTO memberships (id, workspace_id, user_id, role) VALUES ($1, $2, $3, $4)', [randomUUID(), workspaceId, userId, 'owner']);
      await client.query('INSERT INTO subscriptions (id, workspace_id, status) VALUES ($1, $2, $3)', [randomUUID(), workspaceId, 'pending_payment']);
      const token = await createSession(client, userId, workspaceId);
      await client.query('COMMIT');
      return sendJson(res, 201, { ok: true, redirect: paidAccessRedirect }, { 'Set-Cookie': sessionHeader(req, token) });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error?.code === '23505') return sendJson(res, 409, { error: 'An account already exists for that email.' });
      console.error('[auth] signup failed', error?.code || error?.message || 'unknown');
      return sendJson(res, 500, { error: 'We could not create the account. Please try again.' });
    } finally { client.release(); }
  }
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (isRateLimited(req, 'login', 12)) return sendJson(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
    const body = await readJson(req);
    const result = await pool.query('SELECT id, password_hash FROM users WHERE email = $1 LIMIT 1', [normalizeEmail(body.email)]);
    const user = result.rows[0];
    if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) return sendJson(res, 401, { error: 'Email or password is incorrect.' });
    const client = await pool.connect();
    try {
      const workspaceAccess = await workspaceAccessForUser(client, user.id);
      if (!workspaceAccess) return sendJson(res, 403, { error: 'This account is not assigned to a workspace.' });
      const token = await createSession(client, user.id, workspaceAccess.workspace_id);
      return sendJson(res, 200, { ok: true, redirect: canAccessApp(workspaceAccess.billing_status) ? '/app' : paidAccessRedirect }, { 'Set-Cookie': sessionHeader(req, token) });
    } finally { client.release(); }
  }
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookies(req)[sessionCookie];
    if (token) await pool.query('DELETE FROM sessions WHERE token_digest = $1', [tokenDigest(token)]);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionHeader(req, '', 0) });
  }
  return sendJson(res, 404, { error: 'Not found' });
}

function resolvePublicFile(pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.split(/[\\/]+/).includes('..')) return { error: 'invalid_path' };
  const routeFile = pageRoutes.get(decoded);
  const normalizedRelative = normalize(decoded).replace(/^[/\\]+/, '');
  const relative = routeFile || (publicStaticFiles.has(normalizedRelative) || publicAssetFiles.has(normalizedRelative) ? normalizedRelative : '');
  if (!relative) return { error: 'not_found' };
  const candidate = resolve(publicRoot, relative);
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${sep}`)) return { error: 'invalid_path' };
  if (existsSync(candidate) && statSync(candidate).isFile()) return { filePath: candidate };
  return { error: 'not_found' };
}

async function initializeDatabase() {
  if (!pool) {
    console.warn('[axoboard-web] DATABASE_URL is unset; public site is available but account creation is disabled');
    return;
  }
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      console.warn(`[axoboard-web] database connection attempt ${attempt}/10 failed`);
      if (attempt < 10) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
    }
  }
  if (lastError) throw lastError;
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('axoboard:schema-migrations'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const appliedRows = await client.query('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(appliedRows.rows.map((row) => [row.name, row.checksum]));
    const migrationFiles = readdirSync(migrationsRoot).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
    if (!migrationFiles.length) throw new Error('No database migrations were found.');
    for (const name of migrationFiles) {
      const sql = readFileSync(resolve(migrationsRoot, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (applied.has(name)) {
        if (applied.get(name) !== checksum) throw new Error(`Applied migration checksum mismatch: ${name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [name, checksum]);
        await client.query('COMMIT');
        console.log(`[axoboard-web] applied database migration ${name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('axoboard:schema-migrations'))").catch(() => {});
    client.release();
  }
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
  console.log('[axoboard-web] database ready');
}

const server = createServer(async (req, res) => {
  try {
    const rawPathname = String(req.url || '/').split('?')[0];
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/healthz' || url.pathname === '/api/health') {
      let database = 'not_configured';
      if (pool) {
        try { await pool.query('SELECT 1'); database = 'healthy'; }
        catch { database = 'unhealthy'; }
      }
      return sendJson(res, database === 'unhealthy' ? 503 : 200, {
        ok: database !== 'unhealthy', service: 'axoboard-web',
        version: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_VERSION || 'development',
        database, googleSheets: googleIntegration.ready ? 'configured' : 'not_configured'
      });
    }
    if (url.pathname === '/api/integrations/oauth/google/callback' && req.method === 'GET') return await googleIntegration.handleCallback(req, res, url);
    if (url.pathname.startsWith('/api/auth/')) return await handleAuth(req, res, url.pathname);
    if (url.pathname.startsWith('/api/billing/')) return await handleBilling(req, res, url.pathname);
    if (url.pathname === '/demo' || url.pathname === '/index.html') return sendJson(res, 404, { error: 'Not found' });

    let productSession = null;
    if (productFiles.has(url.pathname) || url.pathname.startsWith('/api/axoboard/')) {
      productSession = await currentSession(req);
      if (url.pathname === '/app' && !productSession && (req.method === 'GET' || req.method === 'HEAD')) {
        res.writeHead(302, { Location: '/login', 'Cache-Control': 'no-store' });
        return res.end();
      }
      if (!productSession?.can_access_app) {
        if (url.pathname === '/app' && (req.method === 'GET' || req.method === 'HEAD')) {
          res.writeHead(302, { Location: paidAccessRedirect, 'Cache-Control': 'no-store' });
          return res.end();
        }
        return sendJson(res, 404, { error: 'Not found' });
      }
      if (url.pathname.startsWith('/api/axoboard/')) {
        const handled = await googleIntegration.handleProductRequest(req, res, url, productSession);
        if (handled !== false) return handled;
        return sendJson(res, 404, { error: 'Not found' });
      }
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return sendJson(res, 405, { error: 'Method not allowed' });
    }

    let resolved;
    if (productFiles.has(url.pathname)) {
      resolved = { filePath: resolve(publicRoot, productFiles.get(url.pathname)) };
    } else {
      resolved = resolvePublicFile(rawPathname);
    }
    if (resolved?.error === 'invalid_path') return sendJson(res, 400, { error: 'Invalid path' });
    if (!resolved || resolved?.error === 'not_found') return sendJson(res, 404, { error: 'Not found' });
    const filePath = resolved.filePath;
    const stat = statSync(filePath);
    const isHtml = extname(filePath).toLowerCase() === '.html';
    const isProductFile = productFiles.has(url.pathname);
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0];
    res.writeHead(200, {
      'Content-Type': contentTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream', 'Content-Length': stat.size,
      'Cache-Control': isProductFile ? 'private, no-store' : (isHtml ? 'no-store' : 'public, max-age=300'),
      ...(isProductFile ? { Vary: 'Cookie' } : {}),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
      'Cross-Origin-Opener-Policy': 'same-origin',
      'X-Permitted-Cross-Domain-Policies': 'none',
      ...(forwardedProto === 'https' ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
    });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error?.message === 'payload_too_large') return sendJson(res, 413, { error: 'Request is too large.' });
    if (error?.message === 'invalid_json') return sendJson(res, 400, { error: 'Request body must be valid JSON.' });
    console.error('[axoboard-web] request failed', error?.message || 'unknown');
    return sendJson(res, 500, { error: 'Unexpected server error.' });
  }
});

await initializeDatabase();
const stopGoogleScheduler = googleIntegration.startScheduler();
server.listen(port, '0.0.0.0', () => console.log(`[axoboard-web] listening on 0.0.0.0:${port}`));

function shutdown(signal) {
  console.log(`[axoboard-web] received ${signal}; shutting down`);
  stopGoogleScheduler();
  server.close(async () => { if (pool) await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
