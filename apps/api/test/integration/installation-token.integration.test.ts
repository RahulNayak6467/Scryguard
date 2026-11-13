import { generateKeyPairSync } from 'node:crypto';
import { inspect } from 'node:util';

import { AppError, type Clock, type ErrorKind } from '@scryguard/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { createTokenClient } from '../../src/github/installation-token.js';
import { githubReplies, startFakeGitHub, type FakeGitHub } from '../support/fake-github.js';
import { cutBody, drop, hang, json, text, type FakeReply } from '../support/fake-http-server.js';

const APP_ID = 123_456;
const INSTALLATION_ID = 42;
const MINUTE_MS = 60 * 1000;
const TIMEOUT_MS = 200;
const EXCHANGE_PATH = `/app/installations/${INSTALLATION_ID}/access_tokens`;

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const HOUR_MS = 60 * MINUTE_MS;

const ghsToken = (n: number): string => `ghs_${String(n).padStart(36, '0')}`;

const tokenReply = (token: string, expiresAtMs: number) =>
  json(201, { token, expires_at: new Date(expiresAtMs).toISOString() });

interface FakeClock extends Clock {
  now: number;
}

const fakeClock = (startMs: number): FakeClock => {
  const clock: FakeClock = {
    now: startMs,
    nowMs: () => clock.now,
    monotonicMs: () => clock.now - startMs,
  };
  return clock;
};

const servers: FakeGitHub[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const setup = async () => {
  const github = await startFakeGitHub();
  servers.push(github);
  const clock = fakeClock(Date.now());
  const client = createTokenClient({
    baseUrl: github.url,
    appId: APP_ID,
    key: privateKey,
    clock,
    timeoutMs: TIMEOUT_MS,
  });
  return { github, clock, client };
};

const exchanges = (github: FakeGitHub) =>
  github.requests.filter((request) => request.method === 'POST' && request.path === EXCHANGE_PATH);

const rejection = async (promise: Promise<unknown>): Promise<AppError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected getToken to reject');
};

const shapeOf = (error: AppError) => ({
  kind: error.kind,
  code: error.code,
  retryable: error.retryable,
});

const sentJwt = (github: FakeGitHub): string => {
  const match = /^Bearer (\S+)$/.exec(exchanges(github)[0]?.headers.authorization ?? '');
  const jwt = match?.[1];
  if (jwt === undefined) throw new Error('no app JWT was recorded');
  return jwt;
};

describe('createTokenClient', () => {
  it('returns a token after POSTing to the installation exchange with a Bearer app JWT', async () => {
    const { github, client } = await setup();

    const token = await client.getToken(INSTALLATION_ID);

    expect(token).toBe(ghsToken(1));
    expect(exchanges(github)).toHaveLength(1);
    expect(github.requests).toHaveLength(1);
    expect(github.requests[0]?.headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it('reuses the cached token 54 minutes later without a second exchange', async () => {
    const { github, clock, client } = await setup();
    const first = await client.getToken(INSTALLATION_ID);

    clock.now += 54 * MINUTE_MS;
    const second = await client.getToken(INSTALLATION_ID);

    expect(second).toBe(first);
    expect(exchanges(github)).toHaveLength(1);
  });

  it('exchanges a new token 56 minutes later when under 5 minutes remain', async () => {
    const { github, clock, client } = await setup();
    github.enqueue('createInstallationToken', tokenReply(ghsToken(101), clock.now + HOUR_MS));
    const first = await client.getToken(INSTALLATION_ID);

    clock.now += 56 * MINUTE_MS;
    github.enqueue('createInstallationToken', tokenReply(ghsToken(102), clock.now + HOUR_MS));
    const second = await client.getToken(INSTALLATION_ID);

    expect(first).toBe(ghsToken(101));
    expect(second).toBe(ghsToken(102));
    expect(exchanges(github)).toHaveLength(2);
  });

  it('makes one exchange for two concurrent callers on an empty cache', async () => {
    const { github, client } = await setup();

    const tokens = await Promise.all([
      client.getToken(INSTALLATION_ID),
      client.getToken(INSTALLATION_ID),
    ]);

    expect(tokens).toStrictEqual([ghsToken(1), ghsToken(1)]);
    expect(exchanges(github)).toHaveLength(1);
  });

  it('makes one refresh for two concurrent callers on a stale cache and gives both the new token', async () => {
    const { github, clock, client } = await setup();
    github.enqueue('createInstallationToken', tokenReply(ghsToken(201), clock.now + HOUR_MS));
    await client.getToken(INSTALLATION_ID);

    clock.now += 56 * MINUTE_MS;
    github.enqueue('createInstallationToken', tokenReply(ghsToken(202), clock.now + HOUR_MS));
    const tokens = await Promise.all([
      client.getToken(INSTALLATION_ID),
      client.getToken(INSTALLATION_ID),
    ]);

    expect(tokens).toStrictEqual([ghsToken(202), ghsToken(202)]);
    expect(exchanges(github)).toHaveLength(2);
  });

  it('drops a failed exchange from the cache so the next call exchanges again', async () => {
    const { github, client } = await setup();
    github.enqueue('createInstallationToken', githubReplies.serverError());

    const error = await rejection(client.getToken(INSTALLATION_ID));
    const token = await client.getToken(INSTALLATION_ID);

    expect(error.code).toBe('GITHUB_INTERNAL_ERROR');
    expect(token).toBe(ghsToken(1));
    expect(exchanges(github)).toHaveLength(2);
  });

  it.each<{
    name: string;
    reply: () => FakeReply;
    kind: ErrorKind;
    code: string;
    retryable: boolean;
  }>([
    {
      name: '401',
      reply: githubReplies.unauthorized,
      kind: 'unauthenticated',
      code: 'GITHUB_APP_AUTH_REJECTED',
      retryable: false,
    },
    {
      name: '404',
      reply: githubReplies.notFound,
      kind: 'not_found',
      code: 'GITHUB_INSTALLATION_NOT_FOUND',
      retryable: false,
    },
    {
      name: '429',
      reply: () => githubReplies.secondaryRateLimited(),
      kind: 'upstream_unavailable',
      code: 'GITHUB_RATE_LIMITED',
      retryable: true,
    },
    {
      name: '403 with retry-after',
      reply: () => json(403, { message: 'secondary rate limit' }, { 'retry-after': '30' }),
      kind: 'upstream_unavailable',
      code: 'GITHUB_RATE_LIMITED',
      retryable: true,
    },
    {
      name: '403 with x-ratelimit-remaining 0',
      reply: () => githubReplies.rateLimited(),
      kind: 'upstream_unavailable',
      code: 'GITHUB_RATE_LIMITED',
      retryable: true,
    },
    {
      name: '403 without rate-limit headers',
      reply: () => json(403, { message: 'Resource not accessible by integration' }),
      kind: 'internal',
      code: 'GITHUB_INSTALLATION_FORBIDDEN',
      retryable: false,
    },
    {
      name: '500',
      reply: githubReplies.serverError,
      kind: 'upstream_unavailable',
      code: 'GITHUB_INTERNAL_ERROR',
      retryable: true,
    },
    {
      name: '502 with an HTML body',
      reply: () =>
        text(502, '<html>Bad Gateway</html>', { 'content-type': 'text/html; charset=utf-8' }),
      kind: 'upstream_unavailable',
      code: 'GITHUB_INTERNAL_ERROR',
      retryable: true,
    },
    {
      name: '422',
      reply: githubReplies.unprocessable,
      kind: 'internal',
      code: 'GITHUB_UNEXPECTED_STATUS',
      retryable: false,
    },
  ])('rejects a $name reply as $kind $code', async ({ reply, kind, code, retryable }) => {
    const { github, client } = await setup();
    github.enqueue('createInstallationToken', reply());

    const error = await rejection(client.getToken(INSTALLATION_ID));

    expect(shapeOf(error)).toStrictEqual({ kind, code, retryable });
  });

  it('rejects a 201 reply whose body is not JSON as internal GITHUB_TOKEN_REPLY_NOT_JSON', async () => {
    const { github, client } = await setup();
    github.enqueue('createInstallationToken', text(201, 'ghs_not json at all'));

    const error = await rejection(client.getToken(INSTALLATION_ID));

    expect(shapeOf(error)).toStrictEqual({
      kind: 'internal',
      code: 'GITHUB_TOKEN_REPLY_NOT_JSON',
      retryable: false,
    });
  });

  it('rejects a 201 JSON reply without a token as internal GITHUB_TOKEN_REPLY_INVALID', async () => {
    const { github, clock, client } = await setup();
    github.enqueue(
      'createInstallationToken',
      json(201, { expires_at: new Date(clock.now + 60 * MINUTE_MS).toISOString() }),
    );

    const error = await rejection(client.getToken(INSTALLATION_ID));

    expect(shapeOf(error)).toStrictEqual({
      kind: 'internal',
      code: 'GITHUB_TOKEN_REPLY_INVALID',
      retryable: false,
    });
  });

  it('rejects a token that expires 2 minutes after the clock now as internal GITHUB_TOKEN_EXPIRES_TOO_SOON', async () => {
    const { github, clock, client } = await setup();
    github.enqueue('createInstallationToken', tokenReply(ghsToken(99), clock.now + 2 * MINUTE_MS));

    const error = await rejection(client.getToken(INSTALLATION_ID));

    expect(shapeOf(error)).toStrictEqual({
      kind: 'internal',
      code: 'GITHUB_TOKEN_EXPIRES_TOO_SOON',
      retryable: false,
    });
  });

  it('rejects within about timeoutMs as upstream_unavailable GITHUB_DID_NOT_RESPOND when GitHub hangs', async () => {
    const { github, client } = await setup();
    github.enqueue('createInstallationToken', hang());

    const started = performance.now();
    const error = await rejection(client.getToken(INSTALLATION_ID));
    const elapsedMs = performance.now() - started;

    expect(shapeOf(error)).toStrictEqual({
      kind: 'upstream_unavailable',
      code: 'GITHUB_DID_NOT_RESPOND',
      retryable: true,
    });
    expect(elapsedMs).toBeGreaterThanOrEqual(TIMEOUT_MS - 20);
    expect(elapsedMs).toBeLessThan(TIMEOUT_MS + 800);
  });

  it('rejects as upstream_unavailable GITHUB_DID_NOT_RESPOND when GitHub drops the connection', async () => {
    const { github, client } = await setup();
    github.enqueue('createInstallationToken', drop());

    const error = await rejection(client.getToken(INSTALLATION_ID));

    expect(shapeOf(error)).toStrictEqual({
      kind: 'upstream_unavailable',
      code: 'GITHUB_DID_NOT_RESPOND',
      retryable: true,
    });
  });

  it('rejects as upstream_unavailable GITHUB_DID_NOT_RESPOND when the connection drops halfway through a 201 body', async () => {
    const { github, clock, client } = await setup();
    github.enqueue(
      'createInstallationToken',
      cutBody(tokenReply(ghsToken(301), clock.now + HOUR_MS)),
    );

    const error = await rejection(client.getToken(INSTALLATION_ID));

    expect(shapeOf(error)).toStrictEqual({
      kind: 'upstream_unavailable',
      code: 'GITHUB_DID_NOT_RESPOND',
      retryable: true,
    });
  });

  it('keeps tokens of two installations apart and reuses each one separately', async () => {
    const { github, client } = await setup();

    const first42 = await client.getToken(42);
    const first43 = await client.getToken(43);
    const second42 = await client.getToken(42);

    expect(first42).toBe(ghsToken(1));
    expect(first43).toBe(ghsToken(2));
    expect(second42).toBe(first42);
    expect(github.requests.map((request) => `${request.method} ${request.path}`)).toStrictEqual([
      'POST /app/installations/42/access_tokens',
      'POST /app/installations/43/access_tokens',
    ]);
  });

  it.each<{ name: string; reply: (nowMs: number) => FakeReply }>([
    { name: '401', reply: () => githubReplies.unauthorized() },
    { name: '404', reply: () => githubReplies.notFound() },
    { name: '429', reply: () => githubReplies.secondaryRateLimited() },
    { name: '403', reply: () => json(403, { message: 'Forbidden' }) },
    { name: '500', reply: () => githubReplies.serverError() },
    { name: '422', reply: () => githubReplies.unprocessable() },
    { name: '201 not JSON', reply: () => text(201, `token=${ghsToken(7)}`) },
    {
      name: '201 invalid shape',
      reply: () => json(201, { token: ghsToken(8), expires_at: 'not a date' }),
    },
    {
      name: '201 expiring too soon',
      reply: (nowMs) => tokenReply(ghsToken(9), nowMs + 2 * MINUTE_MS),
    },
    { name: 'hang', reply: () => hang() },
    {
      name: '201 body cut halfway',
      reply: (nowMs) => cutBody(tokenReply(ghsToken(10), nowMs + HOUR_MS)),
    },
  ])(
    'keeps the app JWT and any ghs_ token out of the error for a $name reply',
    async ({ reply }) => {
      const { github, clock, client } = await setup();
      github.enqueue('createInstallationToken', reply(clock.now));

      const error = await rejection(client.getToken(INSTALLATION_ID));
      const jwt = sentJwt(github);
      const serialized = [
        error.message,
        inspect(error, { depth: Infinity, showHidden: true }),
        JSON.stringify(error, Object.getOwnPropertyNames(error)),
      ].join('\n');

      expect(jwt.split('.')).toHaveLength(3);
      expect(serialized).not.toContain(jwt);
      expect(serialized).not.toMatch(/ghs_/);
    },
  );
});
