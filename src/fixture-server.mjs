import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(moduleDirectory, '..', 'tests', 'apple-qa', 'fixtures');
const files = new Map([
  ['/fixtures/good', ['good.html', 'text/html; charset=utf-8']],
  ['/fixtures/bad', ['bad.html', 'text/html; charset=utf-8']],
  ['/fixtures/fixture.css', ['fixture.css', 'text/css; charset=utf-8']],
  ['/fixtures/fixture.js', ['fixture.js', 'text/javascript; charset=utf-8']]
]);

export async function startFixtureServer() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const entry = files.get(url.pathname);
    if (!entry || !['GET', 'HEAD'].includes(request.method || 'GET')) {
      response.writeHead(entry ? 405 : 404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(entry ? 'Method not allowed' : 'Not found');
      return;
    }
    const body = await readFile(join(fixtureRoot, entry[0]));
    response.writeHead(200, {
      'Content-Type': entry[1],
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    port: address.port,
    close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  };
}
