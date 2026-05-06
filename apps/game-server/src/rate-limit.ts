// Per-connection token-bucket rate limiter.
// Supports per-message-type buckets (e.g. action vs chat).

export interface BucketConfig {
  capacity: number;
  refillPerSec: number;
}

export interface RateLimiter {
  consume(key: string, cost?: number): boolean;
}

export function createLimiter(buckets: Record<string, BucketConfig>): RateLimiter {
  const state = new Map<string, { tokens: number; last: number }>();
  return {
    consume(key, cost = 1) {
      const cfg = buckets[key];
      if (!cfg) return true;
      const now = Date.now();
      let s = state.get(key);
      if (!s) {
        s = { tokens: cfg.capacity, last: now };
        state.set(key, s);
      }
      const delta = (now - s.last) / 1000;
      s.tokens = Math.min(cfg.capacity, s.tokens + delta * cfg.refillPerSec);
      s.last = now;
      if (s.tokens < cost) return false;
      s.tokens -= cost;
      return true;
    },
  };
}

export const DEFAULT_BUCKETS: Record<string, BucketConfig> = {
  // Player can fire ~3 actions/sec sustained, burst of 10
  action: { capacity: 10, refillPerSec: 3 },
  // Chat: 1 msg/sec sustained, burst of 5
  chat: { capacity: 5, refillPerSec: 1 },
  // Pings: 1/sec sustained, burst of 3
  ping: { capacity: 3, refillPerSec: 1 },
  // Catch-all
  any: { capacity: 30, refillPerSec: 10 },
};
