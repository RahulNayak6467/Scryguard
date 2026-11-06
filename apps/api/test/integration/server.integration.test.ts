import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import { resolve } from 'node:path';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { createGithubAppFixture, TEST_WEBHOOK_SECRET } from '../support/github-app.js';

const apiRoot = resolve(import.meta.dirname, '../..');
const LISTEN_DEADLINE_MS = 15_000;
const SHORT_SHUTDOWN_TIMEOUT_MS = 7_000;
const SHORT_HTTP_DRAIN_MS = 2_000;
const SHORT_SHUTDOWN_ENV = {
  SHUTDOWN_TIMEOUT_MS: String(SHORT_SHUTDOWN_TIMEOUT_MS),
  MIN_HTTP_DRAIN_MS: '1000',
  HTTP_KEEP_ALIVE_TIMEOUT_MS: '1000',
  DB_CONNECTION_TIMEOUT_MS: '500',
  DB_STATEMENT_TIMEOUT_MS: '500',
  DB_READINESS_TIMEOUT_MS: '500',
};
const STEP_ORDER = ['http_server', 'database', 'redis'];
const githubApp = createGithubAppFixture();

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set; run pnpm test:stack`);
  return value;
};

const findFreePort = async (): Promise<number> => {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
};

type LogRecord = Record<string, unknown> & { event?: unknown; step?: unknown };

const parseLines = (text: string): LogRecord[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as LogRecord);

interface ApiProcess {
  readonly child: ChildProcess;
  readonly port: number;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly records: () => LogRecord[];
  readonly exited: Promise<number | null>;
}

const running: ChildProcess[] = [];
const sockets: Socket[] = [];

const startApi = async (env: Record<string, string | undefined> = {}): Promise<ApiProcess> => {
  const port = await findFreePort();
  let stdout = '';
  let stderr = '';
  const child = spawn(
    process.execPath,
    [
      '--conditions=@scryguard/source',
      '--import',
      'tsx',
      '--import',
      './test/support/crash-trigger.ts',
      '--import',
      './test/support/leaked-handle.ts',
      'src/main.ts',
    ],
    {
      cwd: apiRoot,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        LOG_LEVEL: 'info',
        PORT: String(port),
        DATABASE_URL: requireEnv('TEST_DATABASE_URL'),
        REDIS_URL: requireEnv('TEST_REDIS_URL'),
        ...githubApp.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  running.push(child);
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
  const exited = new Promise<number | null>((resolveExit) => {
    child.once('exit', (code) => resolveExit(code));
  });

  return {
    child,
    port,
    stdout: () => stdout,
    stderr: () => stderr,
    records: () => parseLines(stdout),
    exited,
  };
};

const canConnect = (port: number): Promise<boolean> =>
  new Promise((resolveConnect) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolveConnect(true);
    });
    socket.once('error', () => resolveConnect(false));
  });

const waitUntilListening = async (api: ApiProcess): Promise<void> => {
  const deadline = Date.now() + LISTEN_DEADLINE_MS;
  while (Date.now() < deadline) {
    if (api.child.exitCode !== null) {
      throw new Error(`API exited with ${String(api.child.exitCode)} before listening`);
    }
    if (api.stdout().includes('"event":"server_listening"')) return;
    await new Promise((wait) => setTimeout(wait, 50));
  }
  throw new Error(`API never listened on port ${String(api.port)}`);
};

const holdRequestOpen = async (port: number, requestLine = 'GET /health/live'): Promise<Socket> => {
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => undefined);
  sockets.push(socket);
  await once(socket, 'connect');
  // Node sends 100 Continue only after parsing the headers, so the request is now in flight.
  const continued = new Promise<void>((resolveContinue) => {
    let received = '';
    const onData = (chunk: Buffer): void => {
      received += chunk.toString('utf8');
      if (received.includes('\r\n\r\n')) {
        socket.off('data', onData);
        resolveContinue();
      }
    };
    socket.on('data', onData);
  });
  socket.write(
    `${requestLine} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 2\r\nExpect: 100-continue\r\n\r\n`,
  );
  await continued;
  return socket;
};

const roundTrip = async (port: number): Promise<void> => {
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => undefined);
  socket.resume();
  const closed = new Promise((resolveClose) => socket.once('close', resolveClose));
  await once(socket, 'connect');
  socket.write('GET /health/live HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
  await closed;
};

const openUnfinishedHeaders = async (port: number): Promise<Socket> => {
  const socket = connect(port, '127.0.0.1');
  socket.on('error', () => undefined);
  sockets.push(socket);
  await once(socket, 'connect');
  socket.write('GET /health/live HTTP/1.1\r\nHost: localhost\r\n');
  // The server answers a later request only after reading these earlier bytes.
  await roundTrip(port);
  return socket;
};

const stepsDone = (api: ApiProcess): unknown[] =>
  api
    .records()
    .filter((record) => record.event === 'step_done')
    .map((record) => record.step);

const eventsNamed = (api: ApiProcess, event: string): LogRecord[] =>
  api.records().filter((record) => record.event === event);

describe('API process lifecycle', () => {
  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.destroy();
    for (const child of running.splice(0)) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });

  afterAll(() => {
    githubApp.cleanup();
  });

  it.each(['SIGTERM', 'SIGINT'] as const)(
    'on %s closes the server, then the database, then Redis, and exits 0',
    async (signal) => {
      const api = await startApi();
      await waitUntilListening(api);

      api.child.kill(signal);

      expect(await api.exited).toBe(0);
      expect(stepsDone(api)).toEqual(STEP_ORDER);
      expect(eventsNamed(api, 'step_failed')).toEqual([]);
    },
  );

  it('runs every step once when a second SIGTERM arrives during the drain', async () => {
    const api = await startApi();
    await waitUntilListening(api);
    const held = await holdRequestOpen(api.port);

    api.child.kill('SIGTERM');
    await new Promise((wait) => setTimeout(wait, 50));
    api.child.kill('SIGTERM');
    await new Promise((wait) => setTimeout(wait, 200));
    held.destroy();

    expect(await api.exited).toBe(0);
    expect(stepsDone(api)).toEqual(STEP_ORDER);
  });

  it('exits as soon as the steps finish instead of waiting for the deadline', async () => {
    const api = await startApi({ SHUTDOWN_TIMEOUT_MS: '20000' });
    await waitUntilListening(api);
    const startedAt = Date.now();

    api.child.kill('SIGTERM');
    await api.exited;

    expect(Date.now() - startedAt).toBeLessThan(3_000);
  });

  it('closes a keep-alive connection after its drain response instead of waiting out keep-alive', async () => {
    const api = await startApi({
      HTTP_KEEP_ALIVE_TIMEOUT_MS: '10000',
      SHUTDOWN_TIMEOUT_MS: '20000',
    });
    await waitUntilListening(api);
    const held = await openUnfinishedHeaders(api.port);
    let response = '';
    held.on('data', (chunk: Buffer) => (response += chunk.toString('utf8')));

    api.child.kill('SIGTERM');
    await new Promise((wait) => setTimeout(wait, 200));
    const finishedAt = Date.now();
    held.write('\r\n');

    expect(await api.exited).toBe(0);
    expect(Date.now() - finishedAt).toBeLessThan(3_000);
    expect(response).toMatch(/^HTTP\/1\.1 200/);
    expect(response).toMatch(/^connection: close$/im);
  });

  it('closes the connection of a request that was already running when shutdown started', async () => {
    const api = await startApi({
      HTTP_KEEP_ALIVE_TIMEOUT_MS: '10000',
      SHUTDOWN_TIMEOUT_MS: '20000',
    });
    await waitUntilListening(api);
    const socket = await holdRequestOpen(api.port, 'POST /slow');
    let response = '';
    socket.on('data', (chunk: Buffer) => (response += chunk.toString('utf8')));

    api.child.kill('SIGTERM');
    await new Promise((wait) => setTimeout(wait, 200));
    const finishedAt = Date.now();
    socket.write('{}');

    expect(await api.exited).toBe(0);
    expect(Date.now() - finishedAt).toBeLessThan(3_000);
    expect(response).toMatch(/^HTTP\/1\.1 404/);
  });

  it('stops accepting new connections once shutdown starts', async () => {
    const api = await startApi(SHORT_SHUTDOWN_ENV);
    await waitUntilListening(api);
    await holdRequestOpen(api.port);

    api.child.kill('SIGTERM');
    await new Promise((wait) => setTimeout(wait, 300));

    expect(await canConnect(api.port)).toBe(false);
  });

  it('cuts a request that never finishes once the HTTP drain share runs out, then closes the database and Redis and exits 0', async () => {
    const api = await startApi(SHORT_SHUTDOWN_ENV);
    await waitUntilListening(api);
    const held = await holdRequestOpen(api.port);
    // events.once would reject: a cut socket can emit ECONNRESET before 'close'.
    const heldClosed = new Promise((closed) => held.once('close', closed));
    const startedAt = Date.now();

    api.child.kill('SIGTERM');
    const code = await api.exited;
    const elapsed = Date.now() - startedAt;
    await heldClosed;

    expect(code).toBe(0);
    expect(eventsNamed(api, 'http_drain_timeout')).toEqual([
      expect.objectContaining({ httpDrainMs: SHORT_HTTP_DRAIN_MS }),
    ]);
    expect(stepsDone(api)).toEqual(STEP_ORDER);
    expect(eventsNamed(api, 'step_failed')).toEqual([]);
    expect(eventsNamed(api, 'shutdown_deadline_exceeded')).toEqual([]);
    expect(elapsed).toBeGreaterThanOrEqual(SHORT_HTTP_DRAIN_MS - 100);
    expect(elapsed).toBeLessThan(SHORT_SHUTDOWN_TIMEOUT_MS);
  });

  it('exits 0 well before the drain share when no request is open, without logging a drain timeout', async () => {
    const api = await startApi(SHORT_SHUTDOWN_ENV);
    await waitUntilListening(api);
    const startedAt = Date.now();

    api.child.kill('SIGTERM');
    const code = await api.exited;
    const elapsed = Date.now() - startedAt;

    expect(code).toBe(0);
    expect(elapsed).toBeLessThan(SHORT_HTTP_DRAIN_MS);
    expect(stepsDone(api)).toEqual(STEP_ORDER);
    expect(eventsNamed(api, 'http_drain_timeout')).toEqual([]);
  });

  it('force-exits with code 1 at the deadline when a leaked handle keeps the process alive after every step', async () => {
    const api = await startApi({ ...SHORT_SHUTDOWN_ENV, TEST_LEAKED_HANDLE: 'true' });
    await waitUntilListening(api);
    const startedAt = Date.now();

    api.child.kill('SIGTERM');
    const code = await api.exited;
    const elapsed = Date.now() - startedAt;

    expect(code).toBe(1);
    expect(stepsDone(api)).toEqual(STEP_ORDER);
    expect(eventsNamed(api, 'server_shutdown_successfully')).toHaveLength(1);
    expect(eventsNamed(api, 'shutdown_deadline_exceeded')).toEqual([
      expect.objectContaining({ timeoutMs: SHORT_SHUTDOWN_TIMEOUT_MS }),
    ]);
    expect(elapsed).toBeGreaterThanOrEqual(SHORT_SHUTDOWN_TIMEOUT_MS - 100);
    expect(elapsed).toBeLessThan(SHORT_SHUTDOWN_TIMEOUT_MS + 3_000);
  });

  it.each(['uncaught_exception', 'unhandled_rejection'] as const)(
    'on %s logs one fatal line, still runs every step, and exits 1',
    async (mode) => {
      const api = await startApi({ TEST_CRASH_MODE: mode });
      await waitUntilListening(api);

      api.child.kill('SIGUSR2');

      expect(await api.exited).toBe(1);
      expect(eventsNamed(api, mode)).toEqual([expect.objectContaining({ severity: 'FATAL' })]);
      expect(stepsDone(api)).toEqual(STEP_ORDER);
    },
  );

  it('keeps exit code 1 when a crash arrives during a SIGTERM shutdown', async () => {
    const api = await startApi({
      TEST_CRASH_MODE: 'uncaught_exception',
      SHUTDOWN_TIMEOUT_MS: '20000',
    });
    await waitUntilListening(api);
    const held = await holdRequestOpen(api.port);

    api.child.kill('SIGTERM');
    await new Promise((wait) => setTimeout(wait, 300));
    api.child.kill('SIGUSR2');
    await new Promise((wait) => setTimeout(wait, 300));
    held.destroy();

    expect(await api.exited).toBe(1);
    expect(stepsDone(api)).toEqual(STEP_ORDER);
    expect(eventsNamed(api, 'shutdown_deadline_exceeded')).toEqual([]);
  });

  it.each(['GITHUB_APP_ID', 'GITHUB_APP_WEBHOOK_SECRET', 'GITHUB_APP_PRIVATE_KEY_PATH'] as const)(
    'refuses to start without %s, naming it as required',
    async (field) => {
      const api = await startApi({ [field]: undefined });

      expect(await api.exited).toBe(1);
      expect(api.stderr()).toContain('"event":"config_invalid"');
      expect(api.stderr()).toContain(`{"field":"${field}","reason":"${field} is required"}`);
      expect(await canConnect(api.port)).toBe(false);
    },
  );

  it('refuses to start with an unreadable key file, never printing the key path or the webhook secret', async () => {
    const missingKeyPath = resolve(githubApp.dir, 'missing.pem');
    const api = await startApi({ GITHUB_APP_PRIVATE_KEY_PATH: missingKeyPath });

    expect(await api.exited).toBe(1);
    expect(api.stderr()).toContain(
      '{"field":"GITHUB_APP_PRIVATE_KEY_PATH","reason":"GITHUB_APP_PRIVATE_KEY_PATH could not be read"}',
    );
    for (const forbidden of [missingKeyPath, githubApp.dir, TEST_WEBHOOK_SECRET, 'ENOENT']) {
      expect(api.stderr() + api.stdout()).not.toContain(forbidden);
    }
  });

  it('refuses to start on invalid config, naming the field but never its value', async () => {
    const api = await startApi({ REDIS_URL: 'redis://default:not-a-real-secret@127.0.0.1:1/5' });

    expect(await api.exited).toBe(1);
    expect(api.stderr()).toContain('"event":"config_invalid"');
    expect(api.stderr()).toContain('REDIS_URL');
    expect(api.stderr() + api.stdout()).not.toContain('not-a-real-secret');
    expect(await canConnect(api.port)).toBe(false);
  });

  it('never writes the database or Redis password to the logs', async () => {
    const passwords = [requireEnv('TEST_DATABASE_URL'), requireEnv('TEST_REDIS_URL')].map((url) =>
      decodeURIComponent(new URL(url).password),
    );
    const api = await startApi();
    await waitUntilListening(api);

    api.child.kill('SIGTERM');
    await api.exited;

    for (const password of passwords) {
      expect(api.stdout() + api.stderr()).not.toContain(password);
    }
  });
});
