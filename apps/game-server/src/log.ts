import pino from 'pino';
import { env } from './env.js';

export const log = pino({
  level: env.LOG_LEVEL,
  base: { shard: env.SHARD_ID, total: env.TOTAL_SHARDS },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['payload.sessionToken', 'payload.password', '*.holeCards', 'cards', '*.signature'],
    remove: true,
  },
});
