# Scaling to 1M concurrent players

The capacity math, target by target.

## Reference numbers

- A 9-handed cash table sustains ~80 hands/hr → ~720 actions/hr → 0.2 actions/sec/table.
- A WebSocket message averages ~600 bytes encoded.
- A LiveKit room with 9 participants at simulcast 360p ≈ 1.5 Mbps egress per subscriber × 9 = 13.5 Mbps total subscribed → ~1.5 Mbps publish per camera.
- Postgres at 4xlarge handles ~10k transactions/sec sustained.

## Capacity per shard (game-server)

A shard is a single Fly machine `performance-2x` (8 vCPU, 4 GB RAM):
- Handles 500 tables × 9 seats = 4,500 connections (plus observers ~10× = 45k).
- WebSocket overhead: ~5 KB per connection sustained (heartbeat + state burst).
- 50,000 connections × 5 KB = 250 MB working set — fits.
- CPU: each action runs the engine in <1ms. 500 tables × 0.2/sec = 100/sec → 100ms/sec ≈ 1% CPU.
- Real bottleneck: WebSocket-frame send fan-out. At 50k connections we hit ~30k msgs/sec → 18 MB/sec → 1.4 Gbps → fine on a modern NIC.

So: **1 Fly machine ≈ 50k concurrent players** as long as table state churn stays in this band. To reach 1M concurrent: **20 shards minimum**, plan 40 for headroom.

## Database

Supabase Pro (`compute_size: large`) handles ~2k concurrent connections through PgBouncer. For 1M users:
- Most users idle — the active write path is action persistence: 500 tables/shard × 40 shards × 0.2 actions/sec = 4,000 writes/sec. Spec'd for 10k/sec on 4xlarge.
- Read path (lobby refresh, profile, hand history) goes through 3 read replicas on Supabase.
- The biggest table is `hand_actions` (~bn rows/yr at scale). Partition by month; archive to cold storage after 6 mo (still queryable for compliance, just slower).

Recommended Supabase plan progression:
1. Free / Pro through ~5k concurrent
2. Team + read replica through ~50k
3. Enterprise (with Citus extension or schema-per-region) at 1M+

## Redis

Upstash Pro handles 100k commands/sec. Pub/sub across 40 shards averages a few hundred messages/sec — comfortable.
At 1M concurrent, consider self-hosted Redis Cluster on Fly so latency stays single-digit ms across regions.

## LiveKit

Each LiveKit SFU node handles ~3,000 concurrent participants on dedicated hardware (2x AMD EPYC, 100 Gbps NIC).
1M players ÷ 3,000 = **350 SFU nodes**. LiveKit Cloud auto-scales but priced per-minute — at scale, self-hosting is dramatically cheaper.

Voice-only fallback: when bandwidth is constrained, drop video. The LiveKit client config in `PokerTable.tsx` enables `adaptiveStream` + `dynacast` so this is automatic.

## CDN

All static assets (cards, sprites, fonts) on Vercel / Cloudflare CDN. Cold cache penalty is one-time per region.

## Cost rough cut at 1M concurrent

| Component | Monthly cost |
|---|---|
| Vercel Enterprise | $25k |
| Supabase Enterprise + 3 replicas | $30k |
| Fly.io 40 shards × $200 | $8k |
| Upstash Redis Cluster | $2k |
| LiveKit (self-hosted on K8s, 350 nodes × $80) | $28k |
| Cloudflare Magic Transit + WAF | $10k |
| Persona KYC (averaged) | $20k |
| Solana RPC (Triton One enterprise) | $5k |
| Sentry + Grafana + observability | $3k |
| **Total infra** | **~$130k/mo** |

Industry rake at 5% on $1B/mo handle = $50M/mo gross. Even at half utilization the unit economics work.

## Bottlenecks to watch

1. **Postgres connection limit** — even with PgBouncer, 1M users hammering /api/audit/totals can exhaust pool. Cache that endpoint at Vercel for 30s minimum.
2. **WebSocket fan-out** — at 50k connections per shard, broadcasting a state update to a full 9-seat table is fine, but a tournament rebalance event broadcast to 1k tables = 9k sends. Batch via Redis pub/sub and let each shard handle its own fan-out.
3. **LiveKit join storm** — when a tournament starts, 1000 players join 100 tables in 30 seconds. Solution: pre-warm SFU nodes; the LiveKit Cloud autoscaler is too slow.
4. **On-chain RPC** — a popular Solana RPC will rate-limit you at high TPS. Use Triton, QuickNode, or Helius enterprise tier. Cache `getTokenAccountBalance` aggressively (1s TTL is fine for the audit endpoint).

## Geographic distribution

- Game shards in IAD, LHR, SYD, NRT, GRU. Players auto-route to nearest via Fly anycast.
- Database in IAD with read replicas in LHR + SYD. Writes go to primary (acceptable for poker — turn-based; <100ms RTT is fine).
- LiveKit SFUs co-located with shards.
