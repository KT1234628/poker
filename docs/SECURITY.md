# Security

This is the threat-by-threat checklist. Anything marked ⚠️ is currently best-effort and would need hardening before high-value real money operation.

## Threats addressed

### Account takeover
- Supabase Auth handles password hashing (Argon2id) and email verification.
- 2FA / TOTP is configurable in the Supabase dashboard — enable it before going live.
- Session JWTs rotate and expire (1 hour by default).
- WebSocket session token (game-server) has 30-minute TTL and is unique per page load.

### Cheating in-hand
- All game state is server-authoritative. The poker engine runs on the game-server only; clients never compute pot sizes, action validity, or shuffles.
- Hole cards are sent only to the WebSocket of the seat that owns them. They're encrypted at rest in `hand_hole_cards` (RLS prevents reads except by the owning user or after showdown for shown cards).
- Action timer enforced server-side; auto-folds clients who hang.
- ⚠️ Collusion detection is stubbed. The hooks in `security_flags` are wired but the analysis job is not in this repo. Plug in tools like POKERTRACKER-style hand-history analysis or commercial fraud services (e.g. Aristocrat, Yolo Group's Tools).

### Provably-fair shuffles
- Server publishes `commitment = SHA256(serverSeed || nonce)` before the deal.
- After showdown, the seed is revealed in the `showdown` event payload (and persisted in `hands.seed_reveal`).
- Anyone can re-derive the deck and verify. Sample verifier code in `packages/poker-engine/src/shuffle.ts:buildVerification`.

### Insider deck manipulation (operator)
- ⚠️ This is the hardest threat to mitigate at the protocol level. The current design relies on operator integrity for shuffle generation. The commit-reveal scheme proves the seed wasn't *changed* after the fact, but a malicious operator could pre-compute many seeds and pick one favorable to them before publishing the commitment.
- Mitigation: include `clientEntropy` from each player's join nonce, mixed in via HMAC. As long as one player's nonce is unpredictable, the deck is unpredictable.
- True elimination requires Mental Poker protocols (zk-SNARK or threshold encryption with all players holding shares). That's a major build, not in this repo. Documented as a roadmap item.

### On-chain fund theft
- Vault funds are held by a program-owned PDA. The program can only authorize withdrawals when both the user and the oracle sign.
- A user's withdrawal cannot exceed their `UserBalance.deposited - UserBalance.withdrawn` — even with a fully compromised oracle, the attacker can only drain what each user has put in (capped per user).
- Replay attack: each withdrawal carries a `nonce` that must be greater than `last_nonce`.
- Time bomb: oracle signatures include `expires_at`. Stale approvals fail.
- The on-chain program has an emergency pause flag (`set_paused`) callable by admin only.
- ⚠️ The oracle key in this repo loads from a JSON file (`ORACLE_KEYPAIR_PATH`). For production, swap to AWS KMS / GCP KMS / HashiCorp Vault and have the oracle service co-sign over a signed RPC, never with a local key.

### XSS / CSRF
- CSP is strict (no `'unsafe-inline'` for connect-src, no foreign script hosts).
- HSTS preload header is set.
- Cookie-based session uses Supabase's SameSite=Lax cookies. Mutating endpoints additionally enforce JWT presence.
- React renders all user content through React text nodes (auto-escaped). Dangerous HTML insertion is forbidden by lint rules.

### Injection
- All database access goes through Supabase parameterized queries (`.from().select()` etc.) or RPC (`db.rpc('credit_chips', ...)`). No string concatenation into SQL.
- WebSocket messages are validated by Zod schemas before reaching any handler.
- Frame size capped at 16 KB; larger frames close the connection.

### DDoS / abuse
- Cloudflare in front of Vercel + Fly.io for WAF + L7 protection (recommended).
- Per-user rate limiting via Upstash Redis sliding windows on every API route and per-message-type buckets in-WebSocket.
- Connection cap per shard (`MAX_CONNECTIONS=50000`) to keep one bad actor from exhausting a shard.
- ⚠️ At 1M concurrent users you'll need DDoS protection at the network edge. Cloudflare Magic Transit or AWS Shield Advanced is the right answer.

### Bot detection
- ⚠️ Stubbed: `device_fingerprints` table exists but the analysis job is not implemented. Recommended providers: Castle, Sift, FingerprintJS Pro.
- Action-timing variance and behavioral biometrics can be added — the data is logged into `session_events` and `hand_actions`.

### Geofencing & jurisdiction
- Country-level block via Vercel `x-vercel-ip-country` in `middleware.ts`.
- ⚠️ VPN detection is not built in. Add IPQualityScore or MaxMind for VPN/proxy detection.

### Player protection
- Self-exclusion + cool-off period in `player_limits`. Enforced before any join, deposit, or withdrawal.
- Daily/weekly/monthly deposit limits in `player_limits`. Enforced server-side.
- Session length limits warning the user on `session_events`.

### Multi-accounting
- ⚠️ Stubbed. `device_fingerprints` table records joins; pair-wise fingerprint similarity scoring is the analysis to build.
- KYC matching across accounts (same SSN / passport) handled by Persona's `inquiry-list` API.

### Audit trail
- Every chip movement is in `ledger_entries` (append-only, with `balance_after` for tamper-evidence).
- Every hand has a full action log in `hand_actions` plus the verifiable seed.
- Session events (login, disconnect, IP, fingerprint) in `session_events`.
- Every API write goes through Supabase service-role; RLS on read-side keeps tenants isolated.

## Threat-modeling checklist before going live

- [ ] Pen-test by a third-party firm (we use Trail of Bits for the chain side, Doyensec for app side)
- [ ] Solana program audit (Halborn / OtterSec / Sec3)
- [ ] Bug bounty program (Immunefi)
- [ ] Penetration retest after fixes
- [ ] DDoS simulation (e.g. via BreakingPoint)
- [ ] Tabletop incident response — operator key compromise drill
- [ ] Cold-storage rotation plan for vault excess
