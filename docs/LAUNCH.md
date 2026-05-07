# Launch checklist — friends-and-family testing on Fly.io

Single-platform: **everything runs on Fly.io.** No Vercel needed.
Total time: ~30 minutes if you have the accounts ready.

> **Play-money launch.** Real-money requires the Solana program audit +
> multisig oracle + license — see `docs/CUSTODY.md` and `docs/COMPLIANCE.md`.
> Don't let testers deposit real USDC.

## What runs where

| Service | Where | Cost (idle / 1k DAU) |
|---|---|---|
| Web (Next.js) | **Fly.io** — `stacks-web` | $5 / $15 |
| Game server (WebSocket) | **Fly.io** — `stacks-game` | $5 / $15 |
| Database + Auth + Realtime | **Supabase** (already provisioned) | $0 / $25 |
| Redis pub/sub | **Upstash** | $0 / $10 |
| Voice + video SFU | **LiveKit Cloud** | $0 / $20 |
| Cron jobs | **Supabase pg_cron** (free) | $0 / $0 |
| Geofencing | **Cloudflare** in front of Fly (free) | $0 / $0 |
| **Total** | | **$10 / $85** |

## 0. Prerequisites

You need accounts at:
- [x] Supabase — already set up (project `nytqqmucwyizhgsiafnl`)
- [ ] [Fly.io](https://fly.io) — install with `brew install flyctl`
- [ ] [Upstash](https://upstash.com) — Redis (free tier)
- [ ] [LiveKit Cloud](https://livekit.io) — voice/video (free tier)
- [ ] [Cloudflare](https://cloudflare.com) — optional but recommended for geofencing

## 1. Upstash Redis (5 min)

1. https://upstash.com → sign in with GitHub.
2. Create database → Type **Redis**, region close to where Fly will run
   (`iad` Fly region → `us-east-1` Upstash region).
3. Copy the **TLS endpoint**: `rediss://default:<pass>@<host>.upstash.io:<port>`.
4. Stash it: `export REDIS_URL='rediss://default:...'`

## 2. LiveKit Cloud (5 min)

1. https://livekit.io → sign up.
2. Create project → free tier.
3. Settings → Keys: copy `wss://...livekit.cloud` (`LIVEKIT_URL`),
   API Key, API Secret.

## 3. Two Fly apps (15 min)

```bash
flyctl auth signup        # or login
```

### Web app

```bash
cd apps/web
flyctl launch --no-deploy --copy-config --name stacks-web --region iad
# Accept all defaults. fly.toml is already in repo.
```

Set secrets (these never appear in `fly.toml`):

```bash
flyctl secrets set \
  NEXT_PUBLIC_SUPABASE_URL='https://nytqqmucwyizhgsiafnl.supabase.co' \
  NEXT_PUBLIC_SUPABASE_ANON_KEY='<your anon key>' \
  SUPABASE_SERVICE_ROLE_KEY='<your service role key>' \
  SUPABASE_JWT_SECRET='<your jwt secret>' \
  SUPABASE_DB_URL='postgresql://postgres.nytqqmucwyizhgsiafnl:<pwd>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres' \
  LIVEKIT_URL='<from step 2>' \
  LIVEKIT_API_KEY='<from step 2>' \
  LIVEKIT_API_SECRET='<from step 2>' \
  NEXT_PUBLIC_SOLANA_NETWORK='devnet' \
  NEXT_PUBLIC_SOLANA_RPC='https://api.devnet.solana.com' \
  NEXT_PUBLIC_VAULT_PROGRAM_ID='11111111111111111111111111111111' \
  NEXT_PUBLIC_USDC_MINT='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' \
  CRON_SECRET="$(openssl rand -hex 32)" \
  GAME_SERVER_URL='wss://stacks-game.fly.dev' \
  --app stacks-web

flyctl deploy --app stacks-web
```

You'll get `https://stacks-web.fly.dev`.

### Game server

```bash
cd ../game-server
flyctl launch --no-deploy --copy-config --name stacks-game --region iad

flyctl secrets set \
  SUPABASE_URL='https://nytqqmucwyizhgsiafnl.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='<your service role key>' \
  SUPABASE_JWT_SECRET='<your jwt secret>' \
  REDIS_URL="$REDIS_URL" \
  GAME_SERVER_SHARED_SECRET="$(openssl rand -hex 32)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  LIVEKIT_URL='<from step 2>' \
  LIVEKIT_API_KEY='<from step 2>' \
  LIVEKIT_API_SECRET='<from step 2>' \
  --app stacks-game

flyctl deploy --app stacks-game
```

Verify both:

```bash
curl https://stacks-game.fly.dev/health
# {"status":"ok","shard":0,"total":1,"tables":0,"ts":...}

curl -I https://stacks-web.fly.dev/
# HTTP/2 200
```

## 4. Wire the cron jobs (2 min)

The `0012_pg_cron.sql` migration already runs in your Supabase. You just need
to point it at your Fly URL and give it the bearer token:

```sql
-- in Supabase SQL editor
update system_config set value = 'https://stacks-web.fly.dev' where key = 'cron.base_url';
update system_config set value = '<the CRON_SECRET you set on stacks-web>' where key = 'cron.secret';
```

That's it. `pg_cron` will now hit `/api/cron/vip-refresh` daily, rakeback
weekly on Mondays, leaderboard refresh every 10 min, leaderboard payouts
daily. View status:

```sql
select jobname, schedule, last_run_status from cron.job_run_details
join cron.job using (jobid) order by last_run_at desc limit 10;
```

## 5. (Optional) Cloudflare in front (5 min)

Strongly recommended for two reasons:

1. Real geofencing via `cf-ipcountry` (Fly's IP-country detection is coarse).
2. WAF + DDoS shielding free.

Steps:
1. Add your domain to Cloudflare (free plan).
2. Create CNAMEs: `app.example.com → stacks-web.fly.dev`,
   `game.example.com → stacks-game.fly.dev` — both **Proxied** (orange cloud).
3. In Cloudflare dashboard, set SSL/TLS to **Full (strict)**.
4. Update Fly app domains: `flyctl certs add app.example.com --app stacks-web`
   and the same for the game server.
5. In Vercel … wait, no Vercel. Just update `GAME_SERVER_URL` to
   `wss://game.example.com` via `flyctl secrets set --app stacks-web` and redeploy.

## 6. Seed your testers (2 min per person)

Each tester signs up at your Fly URL. Then locally:

```bash
NEXT_PUBLIC_SUPABASE_URL='https://nytqqmucwyizhgsiafnl.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<your service role key>' \
pnpm tsx scripts/seed-test-chips.ts <their-username> 200
```

That credits 200 USD-equivalent of play chips and auto-marks them KYC-approved
for testing.

## 7. Send them to a table

The seed script already created 16 cash tables. The lowest stakes is "Micro
0.05/0.10" — perfect for first hands. Share the lobby link, they pick a table,
take a seat, and you're playing.

Voice and video light up automatically. LiveKit's adaptive bitrate handles
flaky connections.

## 8. Things to test

- [ ] Sign up + sit at a table together
- [ ] Voice + video work (test in different browsers)
- [ ] A whole hand to showdown
- [ ] Run It Twice — intentionally lose with two players all-in
- [ ] Bomb-pot (set `bomb_pot_every_n_hands = 3` on a table row)
- [ ] Mobile: Safari iOS + Chrome Android
- [ ] Auto-fold on disconnect (force-quit a tab mid-hand)
- [ ] Tournament — start the Daily Turbo from the lobby
- [ ] Mission claim flow at `/missions`

## 9. What to expect to break

- Edge cases in the engine on multi-way all-ins on weird streets — file the
  `hand_id`, the `seed_reveal` + `hand_actions` table is enough to fully
  replay.
- LiveKit free tier has connection-minute limits; if you blow past them voice
  silently degrades.
- First hand on each table has a ~2-3s cold-start.
- iOS Safari may need a permission prompt for camera the first time.

## 10. Stopping (zero idle cost)

```bash
flyctl scale count 0 --app stacks-web
flyctl scale count 0 --app stacks-game
```

Resume with `flyctl scale count 1` on each. (Supabase / Upstash / LiveKit free
tiers idle on their own.)

## 11. Path to real money

When you're ready to take real USDC, follow `docs/CUSTODY.md`:
1. Deploy `apps/solana-program` to Solana devnet; test deposits with devnet USDC.
2. Audit (Halborn / OtterSec / Sec3 — $30–80k, 4–8 weeks).
3. Multisig oracle (Squads 3-of-5).
4. License (Curaçao $25k starter; see `docs/COMPLIANCE.md`).
5. Deploy program to mainnet, set `NEXT_PUBLIC_VAULT_PROGRAM_ID` to the
   real address.

Until then: stay in play-money mode and tell everyone the chips aren't real.

---

### Why no Vercel?

Vercel is amazing for marketing sites and Next-only stacks, but for a poker
app you have a **second persistent service** (the WebSocket game server) that
can't run on Vercel. Once you're already on Fly for that, putting the web app
there too saves you a platform, a billing relationship, and 30+ ms of
cross-cloud latency on every internal call. The Next.js standalone build is
fully portable; you can move back to Vercel any time without code changes.

The `vercel.json` file is left in the repo as a fallback — if you ever want
to deploy to Vercel, it'll work; just turn off the pg_cron jobs first to
avoid double-firing.
