import {
  applyLoggerRules,
  databaseEnvSchema,
  environmentEnvSchema,
  integerEnv,
  loggerEnvSchema,
  redisEnvSchema,
  type EnvironmentSource,
} from '@scryguard/config';
import { QUERY_TIMEOUT_MARGIN_MS } from '@scryguard/database';
import { QUIT_TIMEOUT_MS } from '@scryguard/redis';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as z from 'zod';

export const SHUTDOWN_MARGIN_MS = QUERY_TIMEOUT_MARGIN_MS + QUIT_TIMEOUT_MS;

interface ShutdownTimeouts {
  readonly SHUTDOWN_TIMEOUT_MS: number;
  readonly DB_CONNECTION_TIMEOUT_MS: number;
  readonly DB_STATEMENT_TIMEOUT_MS: number;
}

const httpDrainMsOf = (env: ShutdownTimeouts): number =>
  env.SHUTDOWN_TIMEOUT_MS -
  env.DB_CONNECTION_TIMEOUT_MS -
  env.DB_STATEMENT_TIMEOUT_MS -
  SHUTDOWN_MARGIN_MS;

const serverEnvSchema = z.object({
  PORT: integerEnv('PORT', { min: 1, max: 65_535, fallback: 8000 }),
  MIN_HTTP_DRAIN_MS: integerEnv('MIN_HTTP_DRAIN_MS', {
    min: 1_000,
    max: 10_000,
    fallback: 5_000,
    unit: 'milliseconds',
  }),
  HTTP_REQUEST_TIMEOUT_MS: integerEnv('HTTP_REQUEST_TIMEOUT_MS', {
    min: 1_000,
    max: 300_000,
    fallback: 30_000,
    unit: 'milliseconds',
  }),
  HTTP_HEADERS_TIMEOUT_MS: integerEnv('HTTP_HEADERS_TIMEOUT_MS', {
    min: 1_000,
    max: 120_000,
    fallback: 20_000,
    unit: 'milliseconds',
  }),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: integerEnv('HTTP_KEEP_ALIVE_TIMEOUT_MS', {
    min: 1_000,
    max: 60_000,
    fallback: 5_000,
    unit: 'milliseconds',
  }),
  SHUTDOWN_TIMEOUT_MS: integerEnv('SHUTDOWN_TIMEOUT_MS', {
    min: 5_000,
    max: 120_000,
    fallback: 20_000,
    unit: 'milliseconds',
  }),
});

const githubEnvSchema = z.object({
  GITHUB_APP_ID: integerEnv('GITHUB_APP_ID', { min: 1, max: Number.MAX_SAFE_INTEGER }),
  GITHUB_APP_WEBHOOK_SECRET: z
    .string({ error: 'GITHUB_APP_WEBHOOK_SECRET is required' })
    .min(32, { error: 'GITHUB_APP_WEBHOOK_SECRET must be at least 32 characters' }),
  GITHUB_APP_PRIVATE_KEY_PATH: z
    .string({ error: 'GITHUB_APP_PRIVATE_KEY_PATH is required' })
    .min(1, { error: 'GITHUB_APP_PRIVATE_KEY_PATH is required', abort: true })
    .transform((path, context): KeyObject => {
      const fail = (message: string): never => {
        context.addIssue({ code: 'custom', message });
        return z.NEVER;
      };

      let pem: string;
      try {
        pem = readFileSync(path, 'utf8');
      } catch {
        return fail('GITHUB_APP_PRIVATE_KEY_PATH could not be read');
      }

      let key: KeyObject;
      try {
        key = createPrivateKey(pem);
      } catch {
        return fail('GITHUB_APP_PRIVATE_KEY_PATH is not a valid private key');
      }

      if (key.asymmetricKeyType !== 'rsa') {
        return fail('GITHUB_APP_PRIVATE_KEY_PATH is not an RSA private key');
      }

      return key;
    }),
});

export const apiEnvSchema = z
  .object({
    ...environmentEnvSchema.shape,
    ...loggerEnvSchema.shape,
    ...serverEnvSchema.shape,
    ...databaseEnvSchema.shape,
    ...redisEnvSchema.shape,
    ...githubEnvSchema.shape,
  })
  .superRefine((env, context) => {
    applyLoggerRules(env, context);

    if (env.HTTP_HEADERS_TIMEOUT_MS > env.HTTP_REQUEST_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        path: ['HTTP_HEADERS_TIMEOUT_MS'],
        message: 'Header timeout must not exceed request timeout',
      });
    }

    if (env.DB_READINESS_TIMEOUT_MS > env.DB_STATEMENT_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        path: ['DB_READINESS_TIMEOUT_MS'],
        message: 'Database readiness timeout must not exceed statement timeout',
      });
    }

    // A connection that just finished a request stays open until keep-alive expires.
    if (env.HTTP_KEEP_ALIVE_TIMEOUT_MS >= env.SHUTDOWN_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        path: ['HTTP_KEEP_ALIVE_TIMEOUT_MS'],
        message: 'Keep-alive timeout must be less than shutdown timeout',
      });
    }

    // After the HTTP drain, a cut request may still wait for a connection, run its query and
    // hit the query_timeout margin before the Redis quit; all of it must fit in the deadline.
    if (httpDrainMsOf(env) < env.MIN_HTTP_DRAIN_MS) {
      context.addIssue({
        code: 'custom',
        path: ['SHUTDOWN_TIMEOUT_MS'],
        message: `Shutdown timeout must be at least MIN_HTTP_DRAIN_MS + DB_CONNECTION_TIMEOUT_MS + DB_STATEMENT_TIMEOUT_MS + ${String(SHUTDOWN_MARGIN_MS)} ms`,
      });
    }
  })
  .transform((env) =>
    Object.freeze({
      environment: env.NODE_ENV,
      logging: Object.freeze({ level: env.LOG_LEVEL, pretty: env.LOG_PRETTY }),
      server: Object.freeze({
        port: env.PORT,
        requestTimeoutMs: env.HTTP_REQUEST_TIMEOUT_MS,
        headersTimeoutMs: env.HTTP_HEADERS_TIMEOUT_MS,
        keepAliveTimeoutMs: env.HTTP_KEEP_ALIVE_TIMEOUT_MS,
        shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
        httpDrainMs: httpDrainMsOf(env),
      }),
      database: Object.freeze({
        url: env.DATABASE_URL,
        poolMax: env.DB_POOL_MAX,
        connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
        idleTimeoutMs: env.DB_POOL_IDLE_TIMEOUT_MS,
        statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
        readinessTimeoutMs: env.DB_READINESS_TIMEOUT_MS,
      }),
      redis: Object.freeze({
        url: env.REDIS_URL,
        commandTimeoutMs: env.REDIS_COMMAND_TIMEOUT_MS,
        connectTimeoutMs: env.REDIS_CONNECT_TIMEOUT_MS,
      }),
      github: Object.freeze({
        appId: env.GITHUB_APP_ID,
        webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
        privateKey: env.GITHUB_APP_PRIVATE_KEY_PATH,
      }),
    }),
  );

export type ApiConfig = z.output<typeof apiEnvSchema>;

export const parseConfig = (env: EnvironmentSource): ApiConfig => apiEnvSchema.parse(env);

export const loadConfig = (): ApiConfig => parseConfig(process.env);
