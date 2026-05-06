# Architecture

## Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  apps/web                                                        │
│   ├── Next.js 15 App Router (Vercel)                             │
│   ├── React 19 Server Components for lobby/wallet/profile        │
│   ├── Client Components for the table (PokerTable, ActionBar)    │
│   └── API routes for auth/wallet/livekit/withdraw/kyc            │
├──────────────────────────────────────────────────────────────────┤
│  apps/game-server                                                │
│   ├── ws server, sharded by table_id                             │
│   ├── Authoritative GameState (in memory)                        │
│   ├── Persists hands + actions via supabase service role         │
│   └── Tournament runner (blinds, rebalancing, payouts)           │
├──────────────────────────────────────────────────────────────────┤
│  apps/solana-program                                             │
│   ├── Anchor program: vault PDA + per-user balance               │
│   └── deposit / withdraw (user + oracle dual sig)                │
├──────────────────────────────────────────────────────────────────┤
│  packages/poker-engine                                           │
│   ├── Pure card / shuffle / evaluator / state machine            │
│   └── Used by both game-server and (for legal-action UI) web     │
├──────────────────────────────────────────────────────────────────┤
│  packages/tournament-engine                                      │
│   └── blind clock, ICM, rebalancing                              │
└──────────────────────────────────────────────────────────────────┘
```

## Data flow — one hand of poker

1. Two players connect via WebSocket and send `hello` with a Supabase-issued JWT.
2. They `join_table` with seat index + buy-in.
3. `Room.maybeStartHand()` triggers when ≥ 2 seated players.
4. Server generates `serverSeed`, `nonce`, computes SHA-256 commitment, broadcasts it to the room.
5. Server shuffles deck (Fisher-Yates with HMAC-SHA256 keystream) and deals.
6. Each player receives their `hole_cards` privately (their own WebSocket only).
7. The action loop:
   - `state.toAct` is the next seat with an action timer attached.
   - Player sends `action` message → server validates with `applyAction()` from the engine → broadcasts `action_event` and updated `state`.
   - Auto-fold timer fires `time_out` if the player doesn't act.
8. End of betting round → `phase_event` with new board cards.
9. River + final betting → showdown → `showdown` event with reveals + `seedReveal`.
10. `atomic_pot_settle` SQL function moves chips and records `hand_results`.

The server is fully authoritative. Clients render whatever state the server says is real; their own action requests can be rejected (e.g. `not_your_turn`).

## Provably-fair shuffles

Standard commit/reveal:
1. Server picks a random `serverSeed` (kept secret).
2. Server publishes `commitment = SHA256(serverSeed || nonce)`.
3. Player join messages contribute `clientEntropy` (mixed in via HMAC).
4. Deck is generated deterministically from `(serverSeed, clientEntropy, nonce)`.
5. At showdown, server reveals `serverSeed`. Anyone can re-derive the deck and verify the commitment.

Side benefit: hand histories are fully replayable from the seed alone.

## On-chain custody

```
USDC ─┐                                             ┌─→ chips ledger
      │                                             │
      ├─→ Vault PDA  ───────── User Balance PDA  ───┤
      │   (token account)        (per user)         │
      │                                             │
      └─ withdraw ←── user sig + oracle sig ────────┘
```

Invariant: `vault.token_balance ≥ Σ user_balances.deposited - Σ user_balances.withdrawn`.

The `/api/audit/totals` endpoint proves solvency: it queries the on-chain vault balance and compares it to the sum of credited chips.

## Sharding

`game-server` instances each handle a slice of `table_id` space:
```
shard_id = fnv1a(table_id) mod TOTAL_SHARDS
```

Each shard:
- Holds its tables' state in memory.
- Subscribes to its own Redis channel for cross-shard broadcasts.
- Subscribes to the global `lobby:updates` channel.

To scale: increase `TOTAL_SHARDS` and roll the deployment. New shards take over their portion of new tables on next assignment; existing tables stay on their original shard until they close (this avoids state migration).

## Reliability

- WebSocket reconnect: client uses exponential backoff up to 8s.
- Game state is reconstructible from the database on shard restart (Room.attachSeat reads `table_seats`, current hand from `hands`).
- LiveKit handles voice/video reconnect transparently with TURN fallback.
- Solana program is paused-by-admin in case of emergency.

## Security boundary summary

- Auth: Supabase Auth (email + password, MFA available).
- Session-to-game-server: JWT signed by Supabase JWT secret, 30-minute TTL.
- Wallet binding: ed25519 signed challenge.
- Withdrawals: user signature + oracle signature.
- RLS: every table; service role only for game-server writes.
- Rate limits: per-user via Upstash sliding window.
- CSP: strict, see `next.config.ts`.
- Geofence: middleware drops blocked countries before any auth happens.
