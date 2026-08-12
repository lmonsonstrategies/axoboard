import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const publicRoot = resolve(appRoot, 'wireframes');
const port = Math.max(1, Number(process.env.PORT || 3000));

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.webp', 'image/webp']
]);

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function resolvePublicFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.split(/[\\/]+/).includes('..')) return { error: 'invalid_path' };
  const relative = normalize(decoded).replace(/^[/\\]+/, '');
  const candidate = resolve(publicRoot, relative || 'index.html');
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${sep}`)) return { error: 'invalid_path' };
  if (existsSync(candidate) && statSync(candidate).isFile()) return { filePath: candidate };
  if (extname(relative)) return { error: 'not_found' };
  return { filePath: join(publicRoot, 'index.html') };
}

const server = createServer((req, res) => {
  const rawPathname = String(req.url || '/').split('?')[0];
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/healthz' || url.pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'axoboard-web',
      version: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_VERSION || 'development'
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  const resolved = resolvePublicFile(rawPathname);
  if (resolved?.error === 'invalid_path') return sendJson(res, 400, { error: 'Invalid path' });
  if (resolved?.error === 'not_found') return sendJson(res, 404, { error: 'Not found' });
  const filePath = resolved.filePath;
  const stat = statSync(filePath);
  const isHtml = extname(filePath).toLowerCase() === '.html';
  res.writeHead(200, {
    'Content-Type': contentTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': isHtml ? 'no-store' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  if (req.method === 'HEAD') return res.end();
  return createReadStream(filePath).pipe(res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[axoboard-web] listening on 0.0.0.0:${port}`);
});

function shutdown(signal) {
  console.log(`[axoboard-web] received ${signal}; shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
