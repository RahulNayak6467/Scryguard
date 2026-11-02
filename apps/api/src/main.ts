import { createServer } from 'node:http';

import { loadConfigOrExit } from '@scryguard/config';
import { closeDatabase, createPool } from '@scryguard/database';
import { createLogger } from '@scryguard/logger';
import { createRedisClient } from '@scryguard/redis';
import { installShutdownHandlers, isDraining, systemClock } from '@scryguard/shared';

import { createApp } from './http/app.js';
import { loadConfig } from './config.js';
import { createReadinessChecker } from './health/readiness.js';

const SERVICE_NAME = 'scryguard-api';

const config = loadConfigOrExit(SERVICE_NAME, loadConfig);

const logger = createLogger({
  level: config.logging.level,
  pretty: config.logging.pretty,
  service: SERVICE_NAME,
  environment: config.environment,
});

const databasePool = createPool({ ...config.database, applicationName: SERVICE_NAME }, logger);

const redis = createRedisClient(config.redis, logger, systemClock);

const checkReadiness = createReadinessChecker({
  databasePool,
  isDraining,
  timeoutMs: config.database.readinessTimeoutMs,
  logger,
});

const app = createApp({ logger, clock: systemClock, checkReadiness });

const server = createServer(app);
server.requestTimeout = config.server.requestTimeoutMs;
server.headersTimeout = config.server.headersTimeoutMs;
server.keepAliveTimeout = config.server.keepAliveTimeoutMs;

const closeHttpServer = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    server.close((error) => {
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

installShutdownHandlers(logger, steps, config.server.shutdownTimeoutMs);

server.listen(config.server.port, () => {
  logger.info({ event: 'server_listening', port: config.server.port }, 'API listening');
});
