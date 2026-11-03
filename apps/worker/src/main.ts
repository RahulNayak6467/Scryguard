import { loadConfigOrExit } from '@scryguard/config';
import { createLogger } from '@scryguard/logger';
import { createShutdownHandlers } from '@scryguard/shared';

import { loadConfig } from './config.js';

const SERVICE_NAME = 'scryguard-worker';
const IDLE_HEARTBEAT_INTERVAL_MS = 60_000;

const config = loadConfigOrExit(SERVICE_NAME, loadConfig);

const logger = createLogger({
  level: config.logging.level,
  pretty: config.logging.pretty,
  service: SERVICE_NAME,
  environment: config.environment,
});

// Keeps the process alive until the queue consumer exists.
const idleLoop = setInterval(() => {
  logger.debug({ event: 'worker_idle' }, 'Worker idle');
}, IDLE_HEARTBEAT_INTERVAL_MS);

const steps = [
  {
    name: 'idle_loop',
    run: () => {
      clearInterval(idleLoop);
      return Promise.resolve();
    },
  },
];

createShutdownHandlers(logger, steps, config.shutdownTimeoutMs).install();

logger.info({ event: 'worker_started' }, 'Worker started');
