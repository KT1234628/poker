import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

function getRedis() {
  if (redis) return redis;
  const url = process.env.RATE_LIMIT_REDIS_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url) return null;
  redis = token
    ? new Redis({ url, token })
    : Redis.fromEnv();                            // falls back to env vars
  return redis;
}

const limiters = new Map<string, Ratelimit>();

export function rateLimit(key: string, opts: { tokens: number; window: `${number} s` | `${number} m` | `${number} h` }) {
  const r = getRedis();
  if (!r) return null;
  let lim = limiters.get(key);
  if (!lim) {
    lim = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(opts.tokens, opts.window),
      analytics: true,
      prefix: `stacks:rl:${key}`,
    });
    limiters.set(key, lim);
  }
  return lim;
}

export async function enforce(key: string, identifier: string, opts: { tokens: number; window: `${number} s` | `${number} m` | `${number} h` }) {
  const lim = rateLimit(key, opts);
  if (!lim) return { ok: true, remaining: opts.tokens };
  const r = await lim.limit(identifier);
  return { ok: r.success, remaining: r.remaining, retryAfter: r.reset };
}
