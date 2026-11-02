import {
  applyLoggerRules,
  environmentEnvSchema,
  integerEnv,
  loggerEnvSchema,
  type EnvironmentSource,
} from '@scryguard/config';
import * as z from 'zod';

export const workerEnvSchema = z
  .object({
    ...environmentEnvSchema.shape,
    ...loggerEnvSchema.shape,
    SHUTDOWN_TIMEOUT_MS: integerEnv('SHUTDOWN_TIMEOUT_MS', {
      min: 1_000,
      max: 120_000,
      fallback: 20_000,
      unit: 'milliseconds',
    }),
  })
  .superRefine(applyLoggerRules)
  .transform((env) =>
    Object.freeze({
      environment: env.NODE_ENV,
      logging: Object.freeze({ level: env.LOG_LEVEL, pretty: env.LOG_PRETTY }),
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    }),
  );

export type WorkerConfig = z.output<typeof workerEnvSchema>;

export const parseConfig = (env: EnvironmentSource): WorkerConfig => workerEnvSchema.parse(env);

export const loadConfig = (): WorkerConfig => parseConfig(process.env);
