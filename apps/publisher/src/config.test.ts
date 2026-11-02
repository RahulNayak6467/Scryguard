import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';

import { loadConfig, parseConfig, publisherEnvSchema } from './config.js';

const failingFields = (env: Record<string, string>): string[] => {
  const result = publisherEnvSchema.safeParse(env);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
};

describe('publisher configuration', () => {
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

  it.each(['999', '120001', '10s', ''])('rejects SHUTDOWN_TIMEOUT_MS=%j', (value) => {
    expect(failingFields({ NODE_ENV: 'test', SHUTDOWN_TIMEOUT_MS: value })).toEqual([
      'SHUTDOWN_TIMEOUT_MS',
    ]);
  });

  it('applies the shared logger rules', () => {
    expect(failingFields({ NODE_ENV: 'development', LOG_LEVEL: 'silent' })).toEqual(['LOG_LEVEL']);
  });

  it('freezes the config, including the logging section', () => {
    const config = parseConfig({ NODE_ENV: 'test' });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.logging)).toBe(true);
  });

  it('loadConfig reads process.env and throws a ZodError when it is invalid', () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect(loadConfig().environment).toBe('test');

    vi.stubEnv('NODE_ENV', 'staging');
    expect(() => loadConfig()).toThrow(z.ZodError);
  });
});
