import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().int().default(4000),
  SHARD_ID: z.coerce.number().int().default(0),
  TOTAL_SHARDS: z.coerce.number().int().default(1),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(40),
  SUPABASE_JWT_SECRET: z.string().min(32),

  REDIS_URL: z.string().min(8),

  GAME_SERVER_SHARED_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().length(64),

  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),

  ACTION_TIMEOUT_MS: z.coerce.number().int().default(20_000),
  TIME_BANK_MS: z.coerce.number().int().default(30_000),
  MAX_TABLES_PER_SHARD: z.coerce.number().int().default(500),
  MAX_CONNECTIONS: z.coerce.number().int().default(50_000),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export const env = Env.parse(process.env);
