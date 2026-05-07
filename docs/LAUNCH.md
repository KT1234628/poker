# Launch checklist — friends-and-family testing

A linear path from "code on disk" to "table running with three friends." Total
time: ~45 minutes if you have all the accounts ready.

**Before you start:** this is a **play-money** launch. Real-money requires the
Solana program audit + multisig oracle + license — see `docs/CUSTODY.md` and
`docs/COMPLIANCE.md`. Do not let testers deposit real USDC.

## 0. Prerequisites

You need accounts at:
- [x] Supabase (already set up — `nytqqmucwyizhgsiafnl`)
- [ ] [Vercel](https://vercel.com) — frontend
- [ ] [Fly.io](https://fly.io) — game server
- [ ] [Upstash](https://upstash.com) — Redis (free tier)
- [ ] [LiveKit Cloud](https://livekit.io) — voice/video (free tier)

CLI tools:
```bash
brew install flyctl
npm i -g vercel
```

## 1. Upstash Redis (5 min)

1. Go to https://upstash.com → sign in with GitHub.
2. Create database → Type: **Redis**, region: closest to where you'll deploy
   the game server (e.g. `eu-west-1` if you put Fly in Frankfurt; `us-east-1`
   if Fly in Virginia).
3. Copy the **TLS endpoint** that looks like
   `rediss://default:<password>@<host>.upstash.io:<port>`.
4. Stash it in your shell:
   ```bash
   export REDIS_URL='rediss://default:...@.upstash.io:6379'
   ```

## 2. LiveKit Cloud (5 min)

1. Sign up at https://livekit.io.
2. Create a project (free tier: 1000 connection-minutes/mo, plenty for F&F).
3. Settings → Keys → copy:
   - `wss://...livekit.cloud` → `LIVEKIT_URL`
   - API Key → `LIVEKIT_API_KEY`
   - API Secret → `LIVEKIT_API_SECRET`

## 3. Vercel — frontend (10 min)

```bash
cd apps/web
vercel link                            # accept defaults
```

In the Vercel dashboard for this project, add these env vars (Settings →
Environment Variables):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://nytqqmucwyizhgsiafnl.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (from your `.env.local`) |
| `SUPABASE_SERVICE_ROLE_KEY` | (from your `.env.local`) |
| `SUPABASE_JWT_SECRET` | (from your `.env.local`) |
| `LIVEKIT_URL` | from step 2 |
| `LIVEKIT_API_KEY` | from step 2 |
| `LIVEKIT_API_SECRET` | from step 2 |
| `NEXT_PUBLIC_SOLANA_NETWORK` | `devnet` |
| `NEXT_PUBLIC_SOLANA_RPC` | `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_VAULT_PROGRAM_ID` | `11111111111111111111111111111111` (placeholder; deposits will fail safely) |
| `NEXT_PUBLIC_USDC_MINT` | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` (mainnet USDC mint, fine as a constant) |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `GAME_SERVER_URL` | `wss://stacks-game.fly.dev` (you set this in step 4; come back to update) |

Then deploy:
```bash
vercel --prod
```

You'll get a URL like `https://stacks-poker.vercel.app`.

## 4. Fly.io — game server (15 min)

```bash
flyctl auth signup    # or 'flyctl auth login' if you have an account
cd apps/game-server
flyctl launch --no-deploy --copy-config --name stacks-game --region iad
# (use 'fra' for Frankfurt; pick close to your testers)
```

Set secrets (these don't appear in `fly.toml`):

```bash
flyctl secrets set \
  SUPABASE_URL='https://nytqqmucwyizhgsiafnl.supabase.co' \
  SUPABASE_SERVICE_ROLE_KEY='<from .env.local>' \
  SUPABASE_JWT_SECRET='<from .env.local>' \
  REDIS_URL="$REDIS_URL" \
  GAME_SERVER_SHARED_SECRET="$(openssl rand -hex 32)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  LIVEKIT_URL='<from step 2>' \
  LIVEKIT_API_KEY='<from step 2>' \
  LIVEKIT_API_SECRET='<from step 2>'

flyctl deploy
```

Once deployed, your game server is at `wss://stacks-game.fly.dev`.

**Important:** go back to Vercel and update `GAME_SERVER_URL` to the actual
Fly URL, then redeploy: `vercel --prod`.

Verify the game server is alive:
```bash
curl https://stacks-game.fly.dev/health
# {"status":"ok","shard":0,"total":1,"tables":0,"ts":...}
```

## 5. Seed your testers (2 min per person)

Each tester signs up at your Vercel URL via email. Then, from your laptop:

```bash
cd /path/to/repo
# Credit $200 of play chips and mark them KYC-approved
NEXT_PUBLIC_SUPABASE_URL='https://nytqqmucwyizhgsiafnl.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<from .env.local>' \
pnpm tsx scripts/seed-test-chips.ts <their-username> 200
```

## 6. Send them to a table

The seed script `scripts/seed.ts` already created 16 cash tables. The lowest
stakes is "Micro 0.05/0.10" — perfect for first hands. Share the lobby URL,
they pick a table, take a seat, and you're playing.

Voice and video light up automatically. If anyone has a flaky connection,
LiveKit's adaptive bitrate handles it.

## 7. Things to test

- [ ] Sign up + sit at a table together
- [ ] Voice + video work (test in different browsers)
- [ ] A whole hand to showdown
- [ ] An all-in / RIT prompt fires (intentionally lose with two players all-in)
- [ ] A bomb-pot table (set `bomb_pot_every_n_hands = 3` in the `tables` row;
      you can do this via Supabase Studio → tables editor)
- [ ] Mobile — Safari iPhone + Chrome Android
- [ ] Auto-fold on disconnect (force-quit a tab mid-hand)
- [ ] Tournament — start the Daily Turbo from the lobby
- [ ] Mission claim flow (`/missions`)

## 8. What to expect to break

This is a brand-new system that has never run a real hand end-to-end with
multiple humans. Expect:
- Edge cases in the engine (especially around multi-way all-ins on weird
  streets; report any "wait, who won?" moments)
- The first hand on each table may take a few seconds longer (cold-start)
- LiveKit free tier limits per-room participant minutes; if you blow past the
  cap, voice/video silently degrades
- The disconnect-protection auto-fold timer can be slightly off (we extend
  the action timer once but don't refund time bank yet)

When something breaks, grab the hand id from the URL or the chat log and
file an issue with the timestamp — the seed-reveal in `hands.seed_reveal`
plus `hand_actions` is enough to fully replay any hand.

## 9. Stopping

```bash
flyctl scale count 0   # game server idle
# (Vercel and Supabase free tiers idle on their own)
```

To resume: `flyctl scale count 1`.

## 10. Path to real money

When you're ready to collect actual deposits, follow `docs/CUSTODY.md`:
1. Deploy `apps/solana-program` to Solana devnet first; test deposits with
   devnet USDC.
2. Get an audit (Halborn / OtterSec / Sec3 — $30-80k, 4-8 weeks).
3. Set up a multisig oracle (Squads 3-of-5).
4. Get a license (Curaçao $25k starter; see `docs/COMPLIANCE.md`).
5. Deploy program to mainnet.
6. Wire `NEXT_PUBLIC_VAULT_PROGRAM_ID` to the real address.
7. Re-run the audit on the deployed binary (Sec3 publishes per-deployment
   reports cheaply).

Until those are done: stay in play-money mode and tell everyone the chips
are not real.
