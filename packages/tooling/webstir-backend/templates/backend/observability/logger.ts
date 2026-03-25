import pino, { stdTimeFunctions, type Logger } from 'pino';

import type { AppEnv } from '../env.js';

export function createBaseLogger(env: AppEnv): Logger {
  return pino({
    level: env.logging.level,
    base: {
      service: env.logging.serviceName,
      environment: env.NODE_ENV,
    },
    timestamp: stdTimeFunctions.isoTime,
  });
}
