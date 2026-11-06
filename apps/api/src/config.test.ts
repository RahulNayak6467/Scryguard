import { QUERY_TIMEOUT_MARGIN_MS } from '@scryguard/database';
import { QUIT_TIMEOUT_MS } from '@scryguard/redis';
import { generateKeyPairSync, KeyObject } from 'node:crypto';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { createGithubAppFixture, TEST_WEBHOOK_SECRET } from '../test/support/github-app.js';
import { apiEnvSchema, loadConfig, parseConfig, SHUTDOWN_MARGIN_MS } from './config.js';

const databaseUrl = 'postgres://scryguard_test:test-only@127.0.0.1:5461/scryguard_test';
const redisUrl = 'redis://default:test-only@127.0.0.1:6411/0';

const githubApp = createGithubAppFixture();

afterAll(() => {
  githubApp.cleanup();
});

const requiredInput = {
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  ...githubApp.env,
} as const;

const anyKeyObject: unknown = expect.any(KeyObject);

const expectedGithub = {
  appId: 123_456,
  webhookSecret: TEST_WEBHOOK_SECRET,
  privateKey: anyKeyObject,
};

const expectedDefaults = {
  environment: 'development',
  logging: { level: 'info', pretty: false },
  server: {
    port: 8000,
    requestTimeoutMs: 30_000,
    headersTimeoutMs: 20_000,
    keepAliveTimeoutMs: 5_000,
    shutdownTimeoutMs: 20_000,
    httpDrainMs: 6_000,
  },
  database: {
    url: databaseUrl,
    poolMax: 10,
    connectionTimeoutMs: 5_000,
    idleTimeoutMs: 10_000,
    statementTimeoutMs: 5_000,
    readinessTimeoutMs: 1_000,
  },
  redis: { url: redisUrl, commandTimeoutMs: 100, connectTimeoutMs: 2_000 },
  github: expectedGithub,
} as const;

const explicitInput = {
  ...requiredInput,
  NODE_ENV: 'test',
  LOG_LEVEL: 'debug',
  LOG_PRETTY: 'true',
  PORT: '8080',
  MIN_HTTP_DRAIN_MS: '8000',
  HTTP_REQUEST_TIMEOUT_MS: '90000',
  HTTP_HEADERS_TIMEOUT_MS: '45000',
  HTTP_KEEP_ALIVE_TIMEOUT_MS: '7000',
  SHUTDOWN_TIMEOUT_MS: '50000',
  DB_POOL_MAX: '20',
  DB_CONNECTION_TIMEOUT_MS: '2000',
  DB_POOL_IDLE_TIMEOUT_MS: '30000',
  DB_STATEMENT_TIMEOUT_MS: '30000',
  DB_READINESS_TIMEOUT_MS: '750',
  REDIS_COMMAND_TIMEOUT_MS: '250',
  REDIS_CONNECT_TIMEOUT_MS: '4000',
} as const;

const expectedExplicit = {
  environment: 'test',
  logging: { level: 'debug', pretty: true },
  server: {
    port: 8080,
    requestTimeoutMs: 90_000,
    headersTimeoutMs: 45_000,
    keepAliveTimeoutMs: 7_000,
    shutdownTimeoutMs: 50_000,
    httpDrainMs: 14_000,
  },
  database: {
    url: databaseUrl,
    poolMax: 20,
    connectionTimeoutMs: 2_000,
    idleTimeoutMs: 30_000,
    statementTimeoutMs: 30_000,
    readinessTimeoutMs: 750,
  },
  redis: { url: redisUrl, commandTimeoutMs: 250, connectTimeoutMs: 4_000 },
  github: expectedGithub,
} as const;

const failingFields = (input: Record<string, string>): string[] => {
  const result = apiEnvSchema.safeParse({ ...requiredInput, ...input });
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

const issuesFor = (input: Record<string, string>) => {
  const result = apiEnvSchema.safeParse({ ...requiredInput, ...input });
  return result.success ? [] : result.error.issues;
};

describe('API configuration', () => {
  it('fills every default when only the required variables are set', () => {
    expect(parseConfig(requiredInput)).toEqual(expectedDefaults);
  });

  it('converts every explicit variable into the nested config', () => {
    expect(parseConfig(explicitInput)).toEqual(expectedExplicit);
  });

  it('requires NODE_ENV, DATABASE_URL, REDIS_URL and the three GitHub App settings', () => {
    const result = apiEnvSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.')).sort()).toEqual([
      'DATABASE_URL',
      'GITHUB_APP_ID',
      'GITHUB_APP_PRIVATE_KEY_PATH',
      'GITHUB_APP_WEBHOOK_SECRET',
      'NODE_ENV',
      'REDIS_URL',
    ]);
  });

  it('ignores unrelated environment variables', () => {
    expect(parseConfig({ ...requiredInput, SHELL: '/bin/zsh', HOME: '/home/dev' })).toEqual(
      expectedDefaults,
    );
  });

  it.each(['0', '65536', '80.5', '0x1F90', ' 8080'])('rejects PORT=%j', (port) => {
    expect(failingFields({ PORT: port })).toEqual(['PORT']);
  });

  describe('server timeouts', () => {
    const timeouts = [
      { field: 'HTTP_REQUEST_TIMEOUT_MS', min: 1_000, max: 300_000 },
      { field: 'HTTP_HEADERS_TIMEOUT_MS', min: 1_000, max: 120_000 },
      { field: 'HTTP_KEEP_ALIVE_TIMEOUT_MS', min: 1_000, max: 60_000 },
      { field: 'MIN_HTTP_DRAIN_MS', min: 1_000, max: 10_000 },
    ] as const;

    // Small database timeouts and a large request timeout keep the cross-field rules quiet.
    const quiet = {
      HTTP_REQUEST_TIMEOUT_MS: '300000',
      HTTP_HEADERS_TIMEOUT_MS: '1000',
      HTTP_KEEP_ALIVE_TIMEOUT_MS: '1000',
      SHUTDOWN_TIMEOUT_MS: '120000',
      DB_CONNECTION_TIMEOUT_MS: '100',
      DB_STATEMENT_TIMEOUT_MS: '100',
      DB_READINESS_TIMEOUT_MS: '100',
      MIN_HTTP_DRAIN_MS: '1000',
    };

    it.each(timeouts)('accepts both boundaries of $field', ({ field, min, max }) => {
      expect(failingFields({ ...quiet, [field]: String(min) })).toEqual([]);
      expect(failingFields({ ...quiet, [field]: String(max) })).toEqual([]);
    });

    it.each(timeouts)('rejects one past each boundary of $field', ({ field, min, max }) => {
      expect(failingFields({ ...quiet, [field]: String(min - 1) })).toContain(field);
      expect(failingFields({ ...quiet, [field]: String(max + 1) })).toContain(field);
    });

    it('accepts the SHUTDOWN_TIMEOUT_MS maximum and rejects one above it', () => {
      expect(failingFields({ ...quiet, SHUTDOWN_TIMEOUT_MS: '120000' })).toEqual([]);
      expect(failingFields({ ...quiet, SHUTDOWN_TIMEOUT_MS: '120001' })).toContain(
        'SHUTDOWN_TIMEOUT_MS',
      );
    });

    it('rejects SHUTDOWN_TIMEOUT_MS one below its 5000 minimum', () => {
      expect(failingFields({ ...quiet, SHUTDOWN_TIMEOUT_MS: '4999' })).toContain(
        'SHUTDOWN_TIMEOUT_MS',
      );
    });

    it('rejects the 5000 SHUTDOWN_TIMEOUT_MS minimum through the drain rule even with the smallest other timeouts', () => {
      expect(issuesFor({ ...quiet, SHUTDOWN_TIMEOUT_MS: '5000' })).toEqual([
        expect.objectContaining({
          path: ['SHUTDOWN_TIMEOUT_MS'],
          message:
            'Shutdown timeout must be at least MIN_HTTP_DRAIN_MS + DB_CONNECTION_TIMEOUT_MS + DB_STATEMENT_TIMEOUT_MS + 4000 ms',
        }),
      ]);
    });

    it('accepts 5200 as the smallest SHUTDOWN_TIMEOUT_MS the drain rule allows', () => {
      expect(failingFields({ ...quiet, SHUTDOWN_TIMEOUT_MS: '5200' })).toEqual([]);
      expect(failingFields({ ...quiet, SHUTDOWN_TIMEOUT_MS: '5199' })).toEqual([
        'SHUTDOWN_TIMEOUT_MS',
      ]);
    });

    it('rejects a timeout past the Node timer limit instead of letting it fire after 1 ms', () => {
      expect(failingFields({ SHUTDOWN_TIMEOUT_MS: '3000000000' })).toEqual(['SHUTDOWN_TIMEOUT_MS']);
    });
  });

  describe('rules across fields', () => {
    it.each([
      ['59999', true],
      ['60000', true],
      ['60001', false],
    ])('header timeout %s against a 60000 request timeout → valid=%s', (headers, valid) => {
      expect(
        failingFields({ HTTP_REQUEST_TIMEOUT_MS: '60000', HTTP_HEADERS_TIMEOUT_MS: headers }),
      ).toEqual(valid ? [] : ['HTTP_HEADERS_TIMEOUT_MS']);
    });

    it.each([
      ['999', true],
      ['1000', true],
      ['1001', false],
    ])('readiness timeout %s against a 1000 statement timeout → valid=%s', (readiness, valid) => {
      expect(
        failingFields({ DB_STATEMENT_TIMEOUT_MS: '1000', DB_READINESS_TIMEOUT_MS: readiness }),
      ).toEqual(valid ? [] : ['DB_READINESS_TIMEOUT_MS']);
    });

    it.each([
      ['19999', true],
      ['20000', false],
    ])('keep-alive timeout %s against a 20000 shutdown timeout → valid=%s', (keepAlive, valid) => {
      expect(
        failingFields({ SHUTDOWN_TIMEOUT_MS: '20000', HTTP_KEEP_ALIVE_TIMEOUT_MS: keepAlive }),
      ).toEqual(valid ? [] : ['HTTP_KEEP_ALIVE_TIMEOUT_MS']);
    });

    it('names both variables in the keep-alive rule message', () => {
      expect(
        issuesFor({ SHUTDOWN_TIMEOUT_MS: '20000', HTTP_KEEP_ALIVE_TIMEOUT_MS: '25000' }),
      ).toEqual([
        expect.objectContaining({
          path: ['HTTP_KEEP_ALIVE_TIMEOUT_MS'],
          message: 'Keep-alive timeout must be less than shutdown timeout',
        }),
      ]);
    });

    it('keeps the default keep-alive below the default shutdown timeout', () => {
      const { server } = parseConfig(requiredInput);

      expect(server.keepAliveTimeoutMs).toBeLessThan(server.shutdownTimeoutMs);
    });

    it('builds the shutdown margin from the query timeout margin and the Redis quit timeout', () => {
      expect(SHUTDOWN_MARGIN_MS).toBe(QUERY_TIMEOUT_MARGIN_MS + QUIT_TIMEOUT_MS);
    });

    it('uses a 4000 ms shutdown margin', () => {
      expect(SHUTDOWN_MARGIN_MS).toBe(4_000);
    });

    describe('HTTP drain share', () => {
      const drainInput = {
        MIN_HTTP_DRAIN_MS: '3000',
        DB_CONNECTION_TIMEOUT_MS: '1000',
        DB_STATEMENT_TIMEOUT_MS: '2000',
      };

      it.each([
        ['10001', true],
        ['10000', true],
        ['9999', false],
      ])(
        'shutdown timeout %s against a 3000 minimum drain, 1000 connection and 2000 statement timeout → valid=%s',
        (shutdown, valid) => {
          expect(failingFields({ ...drainInput, SHUTDOWN_TIMEOUT_MS: shutdown })).toEqual(
            valid ? [] : ['SHUTDOWN_TIMEOUT_MS'],
          );
        },
      );

      it.each([
        ['MIN_HTTP_DRAIN_MS', '3001'],
        ['DB_CONNECTION_TIMEOUT_MS', '1001'],
        ['DB_STATEMENT_TIMEOUT_MS', '2001'],
      ])('rejects a 10000 shutdown timeout once %s grows by 1 ms to %s', (field, value) => {
        expect(
          failingFields({ ...drainInput, SHUTDOWN_TIMEOUT_MS: '10000', [field]: value }),
        ).toEqual(['SHUTDOWN_TIMEOUT_MS']);
      });

      it.each([
        ['10000', 3_000],
        ['10001', 3_001],
        ['25000', 18_000],
      ])('computes httpDrainMs for a %s shutdown timeout as %i', (shutdown, httpDrainMs) => {
        expect(
          parseConfig({ ...requiredInput, ...drainInput, SHUTDOWN_TIMEOUT_MS: shutdown }).server
            .httpDrainMs,
        ).toBe(httpDrainMs);
      });

      it('subtracts the connection timeout, the statement timeout and the margin from the shutdown timeout', () => {
        const config = parseConfig({
          ...requiredInput,
          MIN_HTTP_DRAIN_MS: '1000',
          SHUTDOWN_TIMEOUT_MS: '40000',
          DB_CONNECTION_TIMEOUT_MS: '7000',
          DB_STATEMENT_TIMEOUT_MS: '11000',
        });

        expect(config.server.httpDrainMs).toBe(40_000 - 7_000 - 11_000 - SHUTDOWN_MARGIN_MS);
        expect(config.server.httpDrainMs).toBe(18_000);
      });

      it('names every term and the margin in the drain rule message', () => {
        expect(issuesFor({ ...drainInput, SHUTDOWN_TIMEOUT_MS: '9999' })).toEqual([
          expect.objectContaining({
            path: ['SHUTDOWN_TIMEOUT_MS'],
            message:
              'Shutdown timeout must be at least MIN_HTTP_DRAIN_MS + DB_CONNECTION_TIMEOUT_MS + DB_STATEMENT_TIMEOUT_MS + 4000 ms',
          }),
        ]);
      });

      it('rejects the old default statement timeout of 15000 with the other defaults', () => {
        expect(failingFields({ DB_STATEMENT_TIMEOUT_MS: '15000' })).toEqual([
          'SHUTDOWN_TIMEOUT_MS',
        ]);
      });

      it('keeps the default drain share above the default 5000 ms minimum', () => {
        expect(parseConfig(requiredInput).server.httpDrainMs).toBeGreaterThanOrEqual(5_000);
        expect(failingFields({ MIN_HTTP_DRAIN_MS: '6000' })).toEqual([]);
        expect(failingFields({ MIN_HTTP_DRAIN_MS: '6001' })).toEqual(['SHUTDOWN_TIMEOUT_MS']);
      });
    });

    it('applies the shared logger rules after merging', () => {
      expect(failingFields({ NODE_ENV: 'production', LOG_PRETTY: 'true' })).toEqual(['LOG_PRETTY']);
      expect(failingFields({ NODE_ENV: 'production', LOG_LEVEL: 'silent' })).toEqual(['LOG_LEVEL']);
    });
  });

  it('freezes the whole config', () => {
    const config = parseConfig(requiredInput);

    expect(Object.isFrozen(config)).toBe(true);
    for (const section of [
      config.logging,
      config.server,
      config.database,
      config.redis,
      config.github,
    ]) {
      expect(Object.isFrozen(section)).toBe(true);
    }
  });

  it('reads only the injected input, not process.env', () => {
    vi.stubEnv('PORT', '65535');

    expect(parseConfig(requiredInput).server.port).toBe(8000);
  });

  it('loadConfig reads process.env and throws a ZodError when it is invalid', () => {
    for (const [key, value] of Object.entries(explicitInput)) {
      vi.stubEnv(key, value);
    }
    expect(loadConfig()).toEqual(expectedExplicit);

    vi.stubEnv('PORT', '70000');
    expect(() => loadConfig()).toThrow(z.ZodError);
  });
});

describe('API configuration: GitHub App settings', () => {
  const githubIssues = (overrides: Record<string, string | undefined>) => {
    const result = apiEnvSchema.safeParse({ ...requiredInput, ...overrides });
    return result.success
      ? []
      : result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
  };

  const keyPathIssues = (path: string) => githubIssues({ GITHUB_APP_PRIVATE_KEY_PATH: path });

  const ed25519Pem = (): string =>
    generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  it.each(['GITHUB_APP_ID', 'GITHUB_APP_WEBHOOK_SECRET', 'GITHUB_APP_PRIVATE_KEY_PATH'] as const)(
    'reports %s as required when it is not set',
    (field) => {
      expect(githubIssues({ [field]: undefined })).toEqual([
        { path: field, message: `${field} is required` },
      ]);
    },
  );

  it('reports an empty GITHUB_APP_PRIVATE_KEY_PATH as required', () => {
    expect(keyPathIssues('')).toEqual([
      { path: 'GITHUB_APP_PRIVATE_KEY_PATH', message: 'GITHUB_APP_PRIVATE_KEY_PATH is required' },
    ]);
  });

  it.each([
    ['abc', 'GITHUB_APP_ID must be a whole number'],
    ['0', 'GITHUB_APP_ID must be at least 1'],
  ])('rejects GITHUB_APP_ID=%j', (appId, message) => {
    expect(githubIssues({ GITHUB_APP_ID: appId })).toEqual([{ path: 'GITHUB_APP_ID', message }]);
  });

  it('accepts GITHUB_APP_ID=1 as the smallest App ID', () => {
    expect(parseConfig({ ...requiredInput, GITHUB_APP_ID: '1' }).github.appId).toBe(1);
  });

  it('accepts the largest safe integer as GITHUB_APP_ID and rejects one above it', () => {
    expect(parseConfig({ ...requiredInput, GITHUB_APP_ID: '9007199254740991' }).github.appId).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(githubIssues({ GITHUB_APP_ID: '9007199254740992' })).toEqual([
      {
        path: 'GITHUB_APP_ID',
        message: 'GITHUB_APP_ID must not exceed 9,007,199,254,740,991',
      },
    ]);
  });

  it('reports a key file that does not exist as unreadable', () => {
    expect(keyPathIssues(join(githubApp.dir, 'missing.pem'))).toEqual([
      {
        path: 'GITHUB_APP_PRIVATE_KEY_PATH',
        message: 'GITHUB_APP_PRIVATE_KEY_PATH could not be read',
      },
    ]);
  });

  it('reports a key path that points at a directory as unreadable', () => {
    expect(keyPathIssues(githubApp.dir)).toEqual([
      {
        path: 'GITHUB_APP_PRIVATE_KEY_PATH',
        message: 'GITHUB_APP_PRIVATE_KEY_PATH could not be read',
      },
    ]);
  });

  it.each([
    ['empty', ''],
    ['garbage', 'garbage-key-content not a pem\n'],
  ])('reports a key file with %s content as not a valid private key', (name, content) => {
    expect(keyPathIssues(githubApp.writeFile(`${name}.pem`, content))).toEqual([
      {
        path: 'GITHUB_APP_PRIVATE_KEY_PATH',
        message: 'GITHUB_APP_PRIVATE_KEY_PATH is not a valid private key',
      },
    ]);
  });

  it('reports a valid Ed25519 private key as not an RSA private key', () => {
    expect(keyPathIssues(githubApp.writeFile('ed25519.pem', ed25519Pem()))).toEqual([
      {
        path: 'GITHUB_APP_PRIVATE_KEY_PATH',
        message: 'GITHUB_APP_PRIVATE_KEY_PATH is not an RSA private key',
      },
    ]);
  });

  it('rejects a 31-character webhook secret and accepts exactly 32 characters', () => {
    expect(githubIssues({ GITHUB_APP_WEBHOOK_SECRET: 's'.repeat(31) })).toEqual([
      {
        path: 'GITHUB_APP_WEBHOOK_SECRET',
        message: 'GITHUB_APP_WEBHOOK_SECRET must be at least 32 characters',
      },
    ]);
    expect(githubIssues({ GITHUB_APP_WEBHOOK_SECRET: 's'.repeat(32) })).toEqual([]);
  });

  it('outputs the App ID as a number, the secret and the loaded RSA private key', () => {
    const { github } = parseConfig(requiredInput);

    expect(github.appId).toBe(123_456);
    expect(github.webhookSecret).toBe(TEST_WEBHOOK_SECRET);
    expect(github.privateKey).toBeInstanceOf(KeyObject);
    expect(github.privateKey.type).toBe('private');
    expect(github.privateKey.asymmetricKeyType).toBe('rsa');
    expect(github.privateKey.equals(githubApp.privateKey)).toBe(true);
  });

  it('accepts an RSA private key exported as PKCS#8 PEM', () => {
    const pkcs8Pem = githubApp.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const keyPath = githubApp.writeFile('pkcs8.pem', pkcs8Pem);

    const { github } = parseConfig({ ...requiredInput, GITHUB_APP_PRIVATE_KEY_PATH: keyPath });

    expect(pkcs8Pem.startsWith('-----BEGIN PRIVATE KEY-----')).toBe(true);
    expect(github.privateKey).toBeInstanceOf(KeyObject);
    expect(github.privateKey.asymmetricKeyType).toBe('rsa');
    expect(github.privateKey.equals(githubApp.privateKey)).toBe(true);
  });

  it('never puts the key path, the key content, the secret or the raw Node error in an issue', () => {
    const shortSecret = 'short-secret-value-0123456789ab';
    const failing = [
      { GITHUB_APP_WEBHOOK_SECRET: shortSecret },
      { GITHUB_APP_PRIVATE_KEY_PATH: join(githubApp.dir, 'missing.pem') },
      { GITHUB_APP_PRIVATE_KEY_PATH: githubApp.dir },
      { GITHUB_APP_PRIVATE_KEY_PATH: githubApp.writeFile('empty-leak.pem', '') },
      {
        GITHUB_APP_PRIVATE_KEY_PATH: githubApp.writeFile(
          'garbage-leak.pem',
          'garbage-key-content not a pem\n',
        ),
      },
      { GITHUB_APP_PRIVATE_KEY_PATH: githubApp.writeFile('ed25519-leak.pem', ed25519Pem()) },
    ];

    for (const overrides of failing) {
      const result = apiEnvSchema.safeParse({ ...requiredInput, ...overrides });

      expect(result.success).toBe(false);
      const reported = `${JSON.stringify(result.error?.issues)}\n${result.error?.message ?? ''}`;
      for (const forbidden of [
        githubApp.dir,
        shortSecret,
        'garbage-key-content',
        'PRIVATE KEY',
        'ENOENT',
        'EISDIR',
        'no such file',
        'DECODER',
        'error:',
      ]) {
        expect(reported).not.toContain(forbidden);
      }
    }
  });
});
