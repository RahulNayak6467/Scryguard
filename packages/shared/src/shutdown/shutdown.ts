export type ShutdownReason = 'SIGTERM' | 'SIGINT' | 'uncaught_exception' | 'unhandled_rejection';

type ShutdownState = 'running' | 'shutting-down' | 'stopped';

export interface ShutdownLogger {
  fatal(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export type Steps = {
  name: string;
  run: () => Promise<void>;
}[];

export type CrashReason = 'uncaught_exception' | 'unhandled_rejection';

export const createShutdownHandlers = (logger: ShutdownLogger, steps: Steps, timeoutMs: number) => {
  let state: ShutdownState = 'running';

  let failed = false;

  const cleanupResources = async () => {
    for (const step of steps) {
      try {
        await step.run();
        logger.info({ event: 'step_done', step: step.name }, 'Step done');
      } catch (error) {
        failed = true;
        logger.error({ event: 'step_failed', step: step.name, err: error }, 'Step failed');
      }
    }

    if (failed) {
      process.exitCode = 1;
    }
  };

  const handleShutdown = async (signal: ShutdownReason) => {
    if (state === 'shutting-down') {
      logger.warn({ event: 'prevent_duplicate_shutdown' }, 'Preventing duplicate shutdown');
      return;
    }
    if (state === 'stopped') {
      logger.warn({ event: 'server_already_shutdown' }, 'Server already shutdown');
      return;
    }
    state = 'shutting-down';

    logger.info({ event: 'shutdown_signal_received' }, `${signal} received`);

    const timeout = setTimeout(() => {
      logger.error(
        { event: 'shutdown_deadline_exceeded', timeoutMs },
        'Shutdown deadline exceeded forcing exit',
      );
      process.exit(1);
    }, timeoutMs);

    try {
      await cleanupResources();
      state = 'stopped';

      logger.info({ event: 'server_shutdown_successfully' }, 'server graceful shutdown successful');
    } catch (error) {
      logger.error({ event: 'shutdown_failed', error }, 'Server shutdown failed');
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  };

  const handleCrash = async (crash: CrashReason, error: unknown): Promise<void> => {
    if (crash === 'uncaught_exception') {
      logger.fatal(
        { event: 'uncaught_exception', err: error },
        'Uncaught exception; shutting down',
      );
    } else if (crash === 'unhandled_rejection') {
      logger.fatal(
        { event: 'unhandled_rejection', err: error },
        'Unhandled promise rejection; shutting down',
      );
    }
    process.exitCode = 1;
    await handleShutdown(crash);
  };

  const install = () => {
    process.on('SIGINT', () => void handleShutdown('SIGINT'));
    process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
      void handleCrash('uncaught_exception', error);
    });
    process.on('unhandledRejection', (reason) => {
      void handleCrash('unhandled_rejection', reason);
    });
  };

  const isDraining = (): boolean => state !== 'running';

  return { handleCrash, handleShutdown, install, isDraining };
};
