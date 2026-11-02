import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { loadConfig, parseConfig, workerEnvSchema } from './config.js';

const failingFields = (env: Record<string, string>): string[] => {
  const result = workerEnvSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('worker configuration', () => {
  it('fills defaults when only NODE_ENV is set', () => {
    expect(parseConfig({ NODE_ENV: 'development' })).toEqual({
      environment: 'development',
      logging: { level: 'info', pretty: false },
      shutdownTimeoutMs: 20_000,
    });
  });

  it('requires NODE_ENV', () => {
    expect(failingFields({})).toEqual(['NODE_ENV']);
  });

  it.each([
    ['1000', 1_000],
    ['120000', 120_000],
  ])('accepts SHUTDOWN_TIMEOUT_MS=%s', (value, expected) => {
    expect(parseConfig({ NODE_ENV: 'test', SHUTDOWN_TIMEOUT_MS: value }).shutdownTimeoutMs).toBe(
      expected,
    );
  });

  it.each(['999', '120001', '10s', '1e4', ' 5000', ''])(
    'rejects SHUTDOWN_TIMEOUT_MS=%j',
    (value) => {
      expect(failingFields({ NODE_ENV: 'test', SHUTDOWN_TIMEOUT_MS: value })).toEqual([
        'SHUTDOWN_TIMEOUT_MS',
      ]);
    },
  );

  it('applies the shared logger rules', () => {
    expect(failingFields({ NODE_ENV: 'production', LOG_PRETTY: 'true' })).toEqual(['LOG_PRETTY']);
  });

  it('freezes the config, including the logging section', () => {
    const config = parseConfig({ NODE_ENV: 'test' });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.logging)).toBe(true);
  });

  it('loadConfig reads process.env and throws a ZodError when it is invalid', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SHUTDOWN_TIMEOUT_MS', '30000');
    expect(loadConfig().shutdownTimeoutMs).toBe(30_000);

    vi.stubEnv('SHUTDOWN_TIMEOUT_MS', '1');
    expect(() => loadConfig()).toThrow(z.ZodError);
  });
});
