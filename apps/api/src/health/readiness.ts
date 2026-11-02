import { checkDatabaseHealth, type Pool } from '@scryguard/database';
import type { Logger } from '@scryguard/logger';

type FailureReason = 'database_unavailable' | 'timeout';

export type ReadinessResult =
  | { readonly status: 'ready' }
  | { readonly status: 'not_ready'; readonly reason: 'draining' | FailureReason };

export type ReadinessChecker = () => Promise<ReadinessResult>;

export interface ReadinessOptions {
  readonly databasePool: Pick<Pool, 'query'>;
  readonly isDraining: () => boolean;
  readonly timeoutMs: number;
  readonly logger: Pick<Logger, 'warn' | 'info'>;
}

export const createReadinessChecker = ({
  databasePool,
  isDraining,
  timeoutMs,
  logger,
}: ReadinessOptions): ReadinessChecker => {
  // Overlapping probes share one query, so a slow database can't drain the pool.
  let inFlight: Promise<void> | undefined;
  let failing = false;

  const sharedDatabaseCheck = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight;

    const check = checkDatabaseHealth(databasePool);
    inFlight = check;
    const clear = () => {
      if (inFlight === check) inFlight = undefined;
    };
    void check.then(clear, clear);
    return check;
  };

  const fail = (reason: FailureReason, error?: unknown): ReadinessResult => {
    if (!failing) {
      failing = true;
      logger.warn(
        {
          event: 'readiness_failed',
          reason,
          ...(reason === 'timeout' ? { timeoutMs } : {}),
          ...(error === undefined ? {} : { err: error }),
        },
        'Readiness check started failing',
      );
    }
    return { status: 'not_ready', reason };
  };

  const succeed = (): ReadinessResult => {
    if (failing) {
      failing = false;
      logger.info({ event: 'readiness_recovered' }, 'Readiness check recovered');
    }
    return { status: 'ready' };
  };

  return async () => {
    if (isDraining()) return { status: 'not_ready', reason: 'draining' };

    let timer: NodeJS.Timeout | undefined;
    try {
      // The deadline doesn't cancel the query; statement_timeout and query_timeout bound it.
      const deadline = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const outcome = await Promise.race([sharedDatabaseCheck(), deadline]);
      return outcome === 'timeout' ? fail('timeout') : succeed();
    } catch (error) {
      return fail('database_unavailable', error);
    } finally {
      clearTimeout(timer);
    }
  };
};
