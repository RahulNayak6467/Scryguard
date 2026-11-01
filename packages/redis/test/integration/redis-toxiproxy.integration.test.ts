import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRedisClient,
  QUIT_TIMEOUT_MS,
  type RedisConnection,
  type RedisLogger,
} from '../../src/index.js';
import { requireToxiproxyRedisUrl, requireToxiproxyUrl } from '../support/test-redis.js';
import { createToxiproxy } from '../support/toxiproxy.js';

const COMMAND_TIMEOUT_MS = 300;
const LATENCY_MS = 2_000;

const createLogger = () =>
  ({
    debug: vi.fn<RedisLogger['debug']>(),
    info: vi.fn<RedisLogger['info']>(),
    warn: vi.fn<RedisLogger['warn']>(),
    error: vi.fn<RedisLogger['error']>(),
  }) satisfies RedisLogger;

describe('Redis client through Toxiproxy', () => {
  let toxiproxy: ReturnType<typeof createToxiproxy>;
  const openConnections: RedisConnection[] = [];

  beforeAll(() => {
    toxiproxy = createToxiproxy(requireToxiproxyUrl());
  });

  beforeEach(async () => {
    await toxiproxy.reset();
  });

  afterEach(async () => {
    await toxiproxy.reset();
    for (const connection of openConnections.splice(0)) connection.redisClient.disconnect();
  });

  const connectThroughProxy = async (logger = createLogger()): Promise<RedisConnection> => {
    const connection = createRedisClient(
      {
        url: requireToxiproxyRedisUrl(),
        commandTimeoutMs: COMMAND_TIMEOUT_MS,
        connectTimeoutMs: 1_000,
      },
      logger,
    );
    openConnections.push(connection);
    await vi.waitFor(() => {
      expect(connection.redisClient.status).toBe('ready');
    });
    return connection;
  };

  const slowDown = () =>
    toxiproxy.addRedisToxic({
      name: 'slow_redis',
      type: 'latency',
      stream: 'downstream',
      attributes: { latency: LATENCY_MS },
    });

  it('rejects a command at the command timeout when Redis is slower than it', async () => {
    const { redisClient } = await connectThroughProxy();
    await slowDown();

    const startedAt = performance.now();
    await expect(redisClient.get('any-key')).rejects.toThrow('Command timed out');
    const elapsedMs = performance.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(COMMAND_TIMEOUT_MS - 50);
    expect(elapsedMs).toBeLessThan(COMMAND_TIMEOUT_MS + 500);
  });

  it('answers commands normally once the latency is removed', async () => {
    const { redisClient } = await connectThroughProxy();
    await slowDown();
    await expect(redisClient.ping()).rejects.toThrow('Command timed out');

    await toxiproxy.removeRedisToxic('slow_redis');
    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));

    await expect(redisClient.ping()).resolves.toBe('PONG');
  });

  it('returns from close() within the quit timeout and ends the client when Redis is slow', async () => {
    const logger = createLogger();
    const { redisClient, close } = await connectThroughProxy(logger);
    await slowDown();

    const startedAt = performance.now();
    await expect(close()).resolves.toBeUndefined();

    expect(performance.now() - startedAt).toBeLessThan(QUIT_TIMEOUT_MS);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'redis_quit_failed' }),
      expect.any(String),
    );
    // disconnect() ends the socket politely, so the slow link delays the final close too.
    await vi.waitFor(
      () => {
        expect(redisClient.status).toBe('end');
      },
      { timeout: LATENCY_MS + 2_000 },
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
