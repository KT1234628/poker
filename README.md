# Stacks — Provably Fair On-Chain Poker

A production-grade Texas Hold'em platform with on-chain custody, indestructible voice/video at every table, cash games, and tournaments. Designed to scale to 1M+ concurrent players.

## What's in the box

| Component | Stack | Hosting |
|---|---|---|
| Frontend (lobby, table, wallet) | Next.js 15 + React 19 + Tailwind | **Vercel** |
| Database, Auth, Realtime | Postgres + Supabase Auth + Supabase Realtime | **Supabase** |
| Game server (WebSocket, authoritative state) | Node 22 + `ws` + ioredis | Fly.io / Railway |
| Voice + Video per table | LiveKit (SFU + TURN) | LiveKit Cloud |
| On-chain vault (USDC deposits/withdrawals) | Anchor / Solana | Solana mainnet-beta |
| KYC / AML | Persona webhooks | Persona |

You only have to provision **Supabase** and **Vercel**. Everything else has a free-tier path documented in `docs/DEPLOYMENT.md`.

## Architecture at a glance

```
┌─────────┐  HTTPS  ┌──────────────┐  Realtime   ┌──────────────┐
│ Browser ├────────►│  Next.js     ├────────────►│  Supabase    │
│ + Wallet│         │  (Vercel)    │             │  (Postgres)  │
└────┬────┘         └──────┬───────┘             └──────▲───────┘
     │ WSS                 │ REST                        │
     │                     ▼                             │
┌────▼─────────┐    ┌──────────────┐    pub/sub   ┌──────┴───────┐
│ Game Server  │◄───┤ Redis Cluster├─────────────►│ Game Server  │
│  (table 1-N) │    └──────────────┘              │  (table N+1) │
└────┬─────────┘                                  └──────────────┘
     │ RTC                                                │
┌────▼─────────────────────────────────────────────────────▼────┐
│            LiveKit SFU cluster — voice + video                 │
└────────────────────────────────────────────────────────────────┘
                            │
                  ┌─────────▼─────────┐
                  │  Solana Mainnet   │
                  │  Vault Program    │
                  │  (USDC custody)   │
                  └───────────────────┘
```

## Quick start

```bash
# 1. Install
pnpm install

# 2. Environment
cp .env.example .env.local
# Fill in Supabase + Vercel + LiveKit + Solana keys

# 3. Database
pnpm db:push           # Applies all migrations to Supabase
pnpm db:seed           # Seeds blind structures, default tables

# 4. Local dev (everything)
pnpm dev               # Web on :3000, game server on :4000

# 5. Deploy
pnpm deploy:vercel     # Web
pnpm deploy:game       # Game server (fly.io)
pnpm deploy:solana     # Anchor program (mainnet-beta)
```

See `docs/DEPLOYMENT.md` for the full path including LiveKit, Persona, and Solana mainnet setup.

## Repo layout

```
.
├── apps/
│   ├── web/              # Next.js 15 (App Router) — Vercel
│   ├── game-server/      # WebSocket authoritative server — Fly.io
│   └── solana-program/   # Anchor program (Rust) — Solana
├── packages/
│   ├── poker-engine/     # Pure Texas Hold'em logic (hand eval, betting, side pots)
│   ├── tournament-engine/# Blind structure, rebalancing, ICM payouts
│   └── shared-types/     # Zod schemas, TS types shared across apps
├── supabase/
│   └── migrations/       # SQL migrations (schema + RLS + functions)
└── docs/
    ├── DEPLOYMENT.md
    ├── ARCHITECTURE.md
    ├── SECURITY.md
    └── COMPLIANCE.md
```

## Trust model — how on-chain custody works

1. User connects Solana wallet (Phantom / Backpack / Solflare).
2. They deposit USDC into the **Vault PDA** owned by the `poker-vault` program.
3. The deposit emits an on-chain event; the indexer credits chips 1:1 in the database.
4. Withdrawals require **two signatures**: the user's wallet *and* a server-side oracle key (multi-sig in production).
5. The vault never approves a withdrawal beyond the user's on-chain balance, so even if the server is fully compromised the attacker cannot drain other users' funds.

Every chip in the system is backed 1:1 by USDC in the vault, and **anyone** can verify the vault balance equals the sum of credited chips by querying the vault PDA on-chain. That's the trust mechanism.

## Anti-cheat & integrity

- Server is fully authoritative — clients receive only the state they're entitled to see (their own hole cards, public board cards, action prompts).
- Hole cards are sealed per-recipient: each player's `hole_cards` payload is encrypted to their session key.
- Deck shuffling uses a commit-reveal scheme: server publishes a SHA-256 commitment to the shuffled deck before the hand starts, then reveals the seed at showdown. Players can verify the deal was not manipulated.
- Action timer enforces auto-fold; no client clock trust.
- Collusion detection runs over hand histories (relationship graph + bet pattern analysis).
- Anti-bot: behavioral biometrics, action-timing variance, optional in-table CAPTCHA.

## Compliance — read this before going live

This codebase **does not** make you legally compliant to operate real-money poker. You need:

- A gaming license in every jurisdiction you accept players from.
- KYC + AML procedures (Persona hooks are wired in `apps/web/src/app/api/kyc/`).
- Geofencing (IP + GPS) — Cloudflare WAF rule template in `infra/waf-rules.json`.
- Player protection (deposit limits, self-exclusion, session timers).
- Responsible gambling resources.

Most cheap path: **Curaçao eGaming sublicense (~$25k/yr, 4–8 weeks)**. For US/UK/EU, expect $250k+ and 6–12 months.

## Scaling to 1M concurrent

- Horizontal sharding: each `game-server` instance owns a slice of `table_id` space (consistent hashing). Redis pub/sub handles cross-instance routing for tournament rebalancing.
- Database: Supabase Pro (`compute_size: '4xlarge'`) handles ~100K connections through pgBouncer. Read replicas for hand history.
- LiveKit: each SFU node handles ~3000 concurrent participants; cluster of 350 nodes for 1M.
- Edge runtime for static + lobby pages; Node runtime only for stateful APIs.
- See `docs/SCALING.md` for the capacity plan.

---

License: see LICENSE. Not legal advice. Not financial advice. Operate at your own risk in your jurisdiction.
