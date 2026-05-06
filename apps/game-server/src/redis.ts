import Redis from 'ioredis';
import { env } from './env.js';
import { log } from './log.js';

// Two clients: one for general ops, one dedicated subscriber (pub/sub mode
// blocks regular commands on the same connection).
export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});
redis.on('error', err => log.error({ err }, 'redis error'));

export const sub = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: null, // pubsub clients should never time out
});
sub.on('error', err => log.error({ err }, 'redis sub error'));

// Channels:
//   - lobby:updates       — table lifecycle, lobby summaries
//   - tournament:<id>      — tournament state changes
//   - presence:user:<id>   — single-session enforcement
//   - shard:<id>:events    — cross-shard direct messages
export const Channels = {
  lobby: 'lobby:updates',
  tournament: (id: string) => `tournament:${id}`,
  presenceUser: (id: string) => `presence:user:${id}`,
  shard: (id: number) => `shard:${id}:events`,
} as const;

export async function publish(channel: string, payload: unknown) {
  await redis.publish(channel, JSON.stringify(payload));
}
