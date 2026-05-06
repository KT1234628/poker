# Deployment

This is the from-zero path to a working production deployment. You explicitly said you only want to provision Supabase + Vercel — that's the minimum. The other services (Solana program, LiveKit, game-server, oracle relay) are listed in order of importance.

The whole stack runs in three logical tiers:
- **Tier 1 (must)**: Supabase + Vercel — gives you website, auth, database, lobby.
- **Tier 2 (must for real-time poker)**: Game-server (Fly.io) + Redis (Upstash) + LiveKit Cloud. Without these, the table page renders but no hands are dealt.
- **Tier 3 (must for real money)**: Solana program + oracle key + KYC. Without these, you're playing for monopoly money.

## 0. One-time prereqs

```bash
brew install pnpm node@22 supabase/tap/supabase
pnpm install
cp .env.example .env.local
```

## 1. Supabase (5 minutes)

1. Create a project at https://supabase.com.
2. Copy these values into `.env.local`:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`
   - `JWT secret` → `SUPABASE_JWT_SECRET`
   - `Database connection string (URI mode)` → `SUPABASE_DB_URL`
3. Apply the schema:

   ```bash
   supabase link --project-ref <your-project-ref>
   pnpm db:push
   ```

4. Enable email auth (Authentication → Providers → Email). Disable email confirmations during development.

## 2. Vercel (5 minutes)

1. `vercel link` from `apps/web/`.
2. Set the env vars from `.env.local` in Vercel project settings (paste them all).
3. `vercel --prod`.

That's the **minimum for the lobby/profile pages** to be live.

## 3. Game server on Fly.io (15 minutes)

```bash
fly auth signup    # if needed
cd apps/game-server
fly launch --no-deploy   # accept defaults; this writes fly.toml (we already provided ours)
fly secrets set \
  SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
  SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
  SUPABASE_JWT_SECRET=$SUPABASE_JWT_SECRET \
  REDIS_URL=$REDIS_URL \
  GAME_SERVER_SHARED_SECRET=$(openssl rand -hex 32) \
  ENCRYPTION_KEY=$(openssl rand -hex 32) \
  LIVEKIT_API_KEY=$LIVEKIT_API_KEY \
  LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET \
  LIVEKIT_URL=$LIVEKIT_URL
fly deploy
fly scale count 2 --max-per-region 1   # start with 2 shards
```

Update `GAME_SERVER_URL` in Vercel to the Fly URL (e.g. `wss://stacks-game.fly.dev`).

## 4. Redis (Upstash, free tier)

1. Create a database at https://upstash.com.
2. Copy the **TLS** connection URL → `REDIS_URL` in both `.env.local` and Fly secrets.

## 5. LiveKit Cloud (10 minutes)

1. Sign up at https://livekit.io.
2. Create a project and an API key.
3. Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in `.env.local` and Fly secrets.
4. Verify the table page now shows your camera tile.

## 6. Solana program

Even on devnet you'll need ~2 SOL for deployment costs. Mainnet deployment costs ~6 SOL.

```bash
# 1. Install Anchor + Solana
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.30.1 && avm use 0.30.1

# 2. Generate program keypair
cd apps/solana-program
solana-keygen new -o target/deploy/poker_vault-keypair.json
PROGRAM_ID=$(solana address -k target/deploy/poker_vault-keypair.json)
# Update declare_id! in lib.rs and `[programs.*]` in Anchor.toml with this id

# 3. Build & deploy
anchor build
anchor deploy --provider.cluster devnet      # start with devnet
# (When ready, swap to mainnet-beta — but get it audited first.)

# 4. Initialize the vault
ts-node scripts/init-vault.ts                 # see /scripts/init-vault.ts (you'll write this once you have the program id)
```

Set `NEXT_PUBLIC_VAULT_PROGRAM_ID` to the printed address.

## 7. Oracle key

```bash
solana-keygen new -o ./.solana/oracle.json
ORACLE_PUBKEY=$(solana address -k ./.solana/oracle.json)
# Tell the program the oracle pubkey
anchor run set-oracle -- --new-oracle $ORACLE_PUBKEY
```

In production, **store the oracle key in a KMS** (AWS KMS, Google Cloud KMS, HashiCorp Vault). Treat it like a hot wallet — minimal funds, dedicated machine. The provided `request_withdrawal` route reads from `ORACLE_KEYPAIR_PATH`; replace this with a KMS-backed signer before going live.

## 8. KYC (Persona)

1. Sign up at https://withpersona.com.
2. Create a template (Government ID + Selfie is the standard).
3. Set `PERSONA_API_KEY`, `PERSONA_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET`.
4. Configure Persona to webhook `https://<your-domain>/api/kyc/webhook`.

Without KYC the game server rejects every WebSocket upgrade (`kyc !== 'approved'`).

## 9. Geofencing

Edit `BLOCKED_COUNTRIES` in `apps/web/src/middleware.ts`. Vercel's `x-vercel-ip-country` header is automatic.

## 10. Health check

```bash
curl https://<your-domain>/api/audit/totals     # solvency
curl https://stacks-game.fly.dev/health         # game server
```

## Scaling checklist

| Concurrent players | Action |
|---|---|
| < 1,000 | Single Fly machine, Supabase free, Upstash free, LiveKit free |
| 10,000 | 4 Fly machines (1 per region), Supabase Pro, Upstash Pro |
| 100,000 | 16 Fly machines, Supabase Team + read replica, dedicated LiveKit cluster |
| 1,000,000 | 200+ Fly machines via Cloudflare Load Balancer; Supabase Enterprise + Citus; self-hosted LiveKit on K8s; CDN-pinned static assets; Postgres read replicas across 3 regions |

See `docs/SCALING.md` for the actual capacity math.
