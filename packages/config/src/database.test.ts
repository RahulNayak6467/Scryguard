import * as z from 'zod';
import { describe, expect, it } from 'vitest';

import { databaseEnvSchema, databaseUrlSchema } from './database.js';

const VALID_URL = 'postgres://app:local-pass@127.0.0.1:5432/app';

const POOL_SETTINGS_MESSAGE =
  'DATABASE_URL may only set sslmode; use the DB_* variables for pool settings';

const DATABASE_NAME_MESSAGE = 'DATABASE_URL must include a database name';

const messages = (schema: z.ZodType, input: unknown): string[] => {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('databaseUrlSchema', () => {
  it.each([VALID_URL, 'postgresql://app@db.internal/app'])('accepts %j', (value) => {
    expect(databaseUrlSchema.parse(value)).toBe(value);
  });

  it.each(['redis://127.0.0.1:6379/0', 'mysql://app@127.0.0.1:3306/app'])(
    'rejects the non-PostgreSQL URL %j',
    (value) => {
      expect(messages(databaseUrlSchema, value)).toEqual([
        'DATABASE_URL must use the postgres:// or postgresql:// protocol',
      ]);
    },
  );

  it.each(['postgres://127.0.0.1:5432', 'postgres://127.0.0.1:5432/'])(
    'rejects %j without a database name',
    (value) => {
      expect(messages(databaseUrlSchema, value)).toEqual([
        'DATABASE_URL must include a database name',
      ]);
    },
  );

  it('accepts sslmode in the query string', () => {
    const value = `${VALID_URL}?sslmode=require`;

    expect(databaseUrlSchema.parse(value)).toBe(value);
  });

  it('accepts a URL with no query string', () => {
    expect(databaseUrlSchema.parse(VALID_URL)).toBe(VALID_URL);
  });

  it.each([
    `${VALID_URL}?statement_timeout=0`,
    `${VALID_URL}?options=-c%20statement_timeout%3D0`,
    `${VALID_URL}?application_name=x`,
    `${VALID_URL}?sslmode=require&statement_timeout=0`,
    `${VALID_URL}#frag`,
  ])('rejects %j because only sslmode may be set', (value) => {
    expect(messages(databaseUrlSchema, value)).toEqual([POOL_SETTINGS_MESSAGE]);
  });

  it.each([
    'postgres://127.0.0.1:5432?sslmode=require',
    'postgres://127.0.0.1:5432/?sslmode=require',
  ])('reports only the database name for %j', (value) => {
    expect(messages(databaseUrlSchema, value)).toEqual([DATABASE_NAME_MESSAGE]);
  });

  it.each(['postgres://127.0.0.1:5432/?statement_timeout=0', 'postgres://127.0.0.1:5432#frag'])(
    'reports both the database name and the query string for %j',
    (value) => {
      expect(messages(databaseUrlSchema, value)).toEqual([
        DATABASE_NAME_MESSAGE,
        POOL_SETTINGS_MESSAGE,
      ]);
    },
  );
});

describe('databaseEnvSchema', () => {
  it('returns the documented defaults when only DATABASE_URL is set', () => {
    expect(databaseEnvSchema.parse({ DATABASE_URL: VALID_URL })).toEqual({
      DATABASE_URL: VALID_URL,
      DB_POOL_MAX: 10,
      DB_CONNECTION_TIMEOUT_MS: 5_000,
      DB_POOL_IDLE_TIMEOUT_MS: 10_000,
      DB_STATEMENT_TIMEOUT_MS: 5_000,
      DB_READINESS_TIMEOUT_MS: 1_000,
    });
  });

  it('reports a missing DATABASE_URL at its field', () => {
    const result = databaseEnvSchema.safeParse({});

    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['DATABASE_URL'], message: 'DATABASE_URL is required' }),
    ]);
  });

  it.each([
    `${VALID_URL}?statement_timeout=0`,
    `${VALID_URL}?options=-c%20statement_timeout%3D0`,
    `${VALID_URL}?application_name=x`,
    `${VALID_URL}?sslmode=require&statement_timeout=0`,
    `${VALID_URL}#frag`,
  ])('reports the disallowed query string in %j at DATABASE_URL', (value) => {
    const result = databaseEnvSchema.safeParse({ DATABASE_URL: value });

    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['DATABASE_URL'], message: POOL_SETTINGS_MESSAGE }),
    ]);
  });

  it.each([
    ['statement_timeout', 'postgres://app:Pw-7c1e9f@127.0.0.1:5432/app?statement_timeout=48213'],
    ['application_name', 'postgres://app:Pw-7c1e9f@127.0.0.1:5432/app?application_name=leak-5k2q'],
    ['fragment', 'postgres://app:Pw-7c1e9f@127.0.0.1:5432/app#leak-5k2q'],
  ])('keeps the password and the rejected %s value out of the error', (_case, value) => {
    const result = databaseEnvSchema.safeParse({ DATABASE_URL: value });
    const output = [
      result.error?.message,
      JSON.stringify(result.error?.issues),
      result.error ? z.prettifyError(result.error) : undefined,
    ].join('\n');

    expect(result.success).toBe(false);
    expect(output).toContain(POOL_SETTINGS_MESSAGE);
    expect(output).not.toContain('Pw-7c1e9f');
    expect(output).not.toContain('48213');
    expect(output).not.toContain('leak-5k2q');
  });

  it.each([
    ['DB_POOL_MAX', '0', '51'],
    ['DB_CONNECTION_TIMEOUT_MS', '99', '30001'],
    ['DB_POOL_IDLE_TIMEOUT_MS', '999', '300001'],
    ['DB_STATEMENT_TIMEOUT_MS', '99', '120001'],
    ['DB_READINESS_TIMEOUT_MS', '99', '5001'],
  ])('enforces the bounds of %s', (field, below, above) => {
    expect(databaseEnvSchema.safeParse({ DATABASE_URL: VALID_URL, [field]: below }).success).toBe(
      false,
    );
    expect(databaseEnvSchema.safeParse({ DATABASE_URL: VALID_URL, [field]: above }).success).toBe(
      false,
    );
  });

  it('ignores unrelated variables', () => {
    expect(databaseEnvSchema.parse({ DATABASE_URL: VALID_URL, UNRELATED: 'x' })).not.toHaveProperty(
      'UNRELATED',
    );
  });
});
