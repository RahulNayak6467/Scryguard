import { createServer } from 'node:http';

import { loadConfigOrExit } from '@scryguard/config';
import { closeDatabase, createPool } from '@scryguard/database';
import { createLogger } from '@scryguard/logger';
import { createRedisClient } from '@scryguard/redis';
import { createShutdownHandlers, systemClock } from '@scryguard/shared';

import { createApp } from './http/app.js';
import { loadConfig } from './config.js';
import { createReadinessChecker } from './health/readiness.js';

const CONNECTIONS_CHECK_INTERVAL_MS = 5_000;
const SERVICE_NAME = 'scryguard-api';
const config = loadConfigOrExit(SERVICE_NAME, loadConfig);

const httpDrainMs = config.server.httpDrainMs;

const closeHttpServer = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      logger.warn(
        { event: 'http_drain_timeout', httpDrainMs },
        'HTTP drain timed out; closing remaining connections',
      );
      server.closeAllConnections();
    }, httpDrainMs);
    server.close((error) => {
      clearTimeout(timeout);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const steps = [
  { name: 'http_server', run: closeHttpServer },
  { name: 'database', run: () => closeDatabase(databasePool) },
  { name: 'redis', run: () => redis.close() },
];
const logger = createLogger({
  level: config.logging.level,
  pretty: config.logging.pretty,
  service: SERVICE_NAME,
  environment: config.environment,
});

const databasePool = createPool({ ...config.database, applicationName: SERVICE_NAME }, logger);

const redis = createRedisClient(config.redis, logger, systemClock);

const shutdownHandler = createShutdownHandlers(logger, steps, config.server.shutdownTimeoutMs);
const isDraining = shutdownHandler.isDraining;

const checkReadiness = createReadinessChecker({
  databasePool,
  isDraining,
  timeoutMs: config.database.readinessTimeoutMs,
  logger,
});

const app = createApp({ logger, clock: systemClock, checkReadiness, isDraining });

const server = createServer({ connectionsCheckingInterval: CONNECTIONS_CHECK_INTERVAL_MS }, app);
server.requestTimeout = config.server.requestTimeoutMs;
server.headersTimeout = config.server.headersTimeoutMs;
server.keepAliveTimeout = config.server.keepAliveTimeoutMs;

shutdownHandler.install();
server.listen(config.server.port, () => {
  logger.info({ event: 'server_listening', port: config.server.port }, 'API listening');
});
