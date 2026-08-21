import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';

async function allocatePort() {
  const probe = createServer();
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolveListen);
  });
  const port = probe.address().port;
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForHealth(origin, child, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Local AxoBoard server exited before readiness (code ${child.exitCode}).`);
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Local AxoBoard server was not ready within ${timeoutMs}ms.`);
}

export async function startLocalProductServer(projectRoot, { timeoutMs = 12_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const port = await allocatePort();
    const origin = `http://127.0.0.1:${port}`;
    const output = [];
    const child = spawn(process.execPath, [join(projectRoot, 'server.mjs')], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH || '',
        NODE_ENV: 'test',
        PORT: String(port),
        APP_BASE_URL: origin,
        DATABASE_URL: '',
        DATABASE_SSL: 'false',
        STRIPE_SECRET_KEY: '',
        STRIPE_WEBHOOK_SECRET: '',
        AXOBOARD_AUTOMATION_WORKER_ENABLED: 'false'
      }
    });
    const capture = (chunk) => {
      output.push(String(chunk));
      if (output.join('').length > 12_000) output.shift();
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    try {
      await waitForHealth(origin, child, timeoutMs);
      return {
        origin,
        port,
        output,
        close: async () => {
          if (child.exitCode !== null) return;
          child.kill('SIGTERM');
          await Promise.race([
            new Promise((resolveExit) => child.once('exit', resolveExit)),
            new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000))
          ]);
          if (child.exitCode === null) child.kill('SIGKILL');
        }
      };
    } catch (error) {
      lastError = new Error(`${error.message}\n${output.join('').slice(-2_000)}`);
      if (child.exitCode === null) child.kill('SIGTERM');
    }
  }
  throw lastError || new Error('Unable to allocate an isolated local AxoBoard server.');
}
