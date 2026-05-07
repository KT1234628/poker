# Custody — trust model end-to-end

The whole point of putting USDC on Solana for poker is that **anyone can audit
the operator's solvency without trusting them**. This document explains how.

## TL;DR

Every chip credited to a player's account is backed 1:1 by USDC sitting in a
program-owned vault PDA on Solana mainnet. The vault is verifiable on-chain
at any moment. The operator never has unilateral authority to drain user funds:

- **Deposits** require a real on-chain transaction. The server credits chips
  only after verifying the program ID + instruction layout + accounts +
  emitted event.
- **Withdrawals** require **two signatures**: the user's wallet AND a
  server-controlled oracle. The on-chain program enforces that no user can
  withdraw more than they personally deposited (independent of the oracle).
- **Solvency** can be verified in one query:
  `vault_token_balance >= sum(user_balance.deposited - user_balance.withdrawn)`.

## Components

```
                          Solana mainnet
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Vault PDA (program-owned token account)                    │
│   - holds all USDC                                          │
│   - signed for by the program (not any human)               │
│                                                             │
│  Per-user `UserBalance` PDAs                                │
│   { owner, deposited, withdrawn, last_nonce }               │
│   - independent for each Solana wallet                      │
│   - withdrawn cannot exceed deposited                       │
│                                                             │
│  VaultConfig PDA                                            │
│   { admin, oracle, usdc_mint, totals, paused }              │
│                                                             │
└──────────────────▲────────────────▲─────────────────────────┘
                   │                │
       Deposit ix  │                │ Withdraw ix (user sig + oracle ed25519 ix)
       (user signs)│                │
                   │                │
              ┌────┴───┐       ┌────┴────┐
              │ Player │       │ Oracle  │  (server keypair; future:
              └────────┘       └─────────┘   multisig 3-of-5 via Squads)
                   ▲                ▲
                   │                │
        ┌──────────┴──────────┐     │
        │  apps/web (Next.js) │─────┘
        │  - /api/deposit/    │
        │  - /api/withdraw/*  │ ──── verifies tx, stamps DB ledger
        └─────────────────────┘
```

## Deposit flow

1. Player connects Solana wallet (Phantom, Backpack, Solflare).
2. Player enters an amount; client calls
   `apps/web/src/lib/solana/deposit-tx.ts:buildDepositTx` which constructs:
   - `register_user` instruction (only the first time, idempotent)
   - `deposit(amount)` instruction with the exact account layout the program
     expects — using PDAs derived deterministically from the program ID +
     USDC mint.
3. Player's wallet signs the transaction; client submits to Solana RPC.
4. Once confirmed, client calls `POST /api/deposit/confirm { txSignature, walletAddress }`.
5. **Server verifies, in order**, in `apps/web/src/app/api/deposit/confirm/route.ts`:
   - Caller is authenticated.
   - The wallet is linked + verified for this user.
   - The transaction exists, is `confirmed`, and has no error.
   - The transaction is no older than 432,000 slots (~2 days).
   - At least one instruction has `programId == OUR_VAULT_PROGRAM`.
   - Among those, exactly one matches the `deposit` discriminator
     `[242,35,198,137,82,225,242,182]`.
   - The instruction's account list matches expected PDAs:
     `user == walletPk`, `vault_token_account == vaultTokenAccountPda()`,
     `config == configPda()`, `user_balance == userBalancePda(walletPk)`,
     `user_token_account == ATA(walletPk, USDC)`, `token_program ==
     TOKEN_PROGRAM_ID`.
   - Decode `DepositEvent` from `Program data:` log (Anchor BorshCoder).
   - Event's `user` matches the wallet, event's `amount` matches the
     instruction's amount.
6. Server inserts a `deposits` row (unique `tx_signature` prevents replay)
   then calls `credit_deposit(deposit_id)` SQL function which atomically
   credits chips + writes a ledger entry.

**Why this is safe:** A malicious user who deploys a copycat program emitting
a fake `DepositEvent` cannot mint chips: their tx invokes a different
`programId`, which is rejected at step 5d. The amount the server credits is
the amount inside the instruction (not just the log), making forgery require
both program-ID forgery and instruction-layout forgery.

## Withdrawal flow

Withdrawals are deliberately a **two-step** flow, with the nonce generated
by the server (not the user):

### Step 1 — `POST /api/withdraw/start`
Server calls `start_withdrawal()` SQL fn which atomically:
- Picks `on_chain_nonce = max(prior_nonces, 0) + 1` (strictly monotonic per
  user). The on-chain program rejects replays via `nonce > last_nonce`.
- Debits chips (so a stalled flow doesn't allow double-spending).
- Inserts a `pending` withdrawal row with a 5-minute expiry.

Returns the **canonical bytes** the user must sign:

```
"stacks_withdraw:" || user_pubkey(32) || amount_le(8) || nonce_le(8) || expires_unix_le(8)
```

### Step 2 — `POST /api/withdraw/sign`
- User has signed the canonical bytes with their wallet (via `signMessage`).
- Server verifies the user's signature.
- Server's oracle co-signs the same bytes.
- Stores both signatures + canonical bytes; flips status to `submitted`.

### Step 3 — On-chain tx
- Client (`apps/web/src/lib/solana/withdraw-tx.ts:buildWithdrawTx`) builds:
  - **ix[0]**: ed25519 verify instruction with the oracle's signature over
    the canonical bytes.
  - **ix[1]**: `withdraw(amount, nonce, expires_at, oracle_sig_index=0)`.
- User wallet signs the transaction (proving intent on-chain).
- Submits.

### Step 4 — Worker confirmation
`apps/game-server/src/withdrawal-worker.ts` polls `submitted` rows:
- If on-chain status confirmed → mark `confirmed`.
- If on-chain error → call `fail_withdrawal_with_refund` (atomic refund).
- If pending past expiry → refund.
- If submitted but never landed for 24h → refund.

### What the on-chain program enforces

`apps/solana-program/programs/poker-vault/src/lib.rs`:
- The ed25519 instruction at index 0 must verify the EXACT canonical bytes
  with the OS-stored oracle pubkey from `VaultConfig`.
- `nonce > user_balance.last_nonce` (replay protection).
- `now <= expires_at` (oracle co-signs are time-bound).
- `amount <= user_balance.deposited - user_balance.withdrawn` — even if the
  oracle is fully compromised, an attacker can only drain what each user
  has personally deposited, not other users' funds.

## Solvency audit

`GET /api/audit/totals` (no auth) returns:
- `vault_onchain_balance` — live read from `vault_token_account_pda`
- `vault_total_user_balance` — `sum(balances.chips + balances.locked_chips)`
- `solvent: vault_onchain >= vault_total_user_balance`

Anyone can independently verify by:
1. Reading `vault_token_account_pda` from Solana RPC.
2. Summing all `UserBalance.deposited - UserBalance.withdrawn` PDAs.
3. Comparing against the operator's reported `vault_total_user_balance`.

If `vault_onchain < user_balances`, the operator is **insolvent** and
withdrawals must take priority over new deposits — file a complaint with
the regulator.

## Roadmap to production-grade

| Today | Production |
|---|---|
| Single oracle keypair on disk (`ORACLE_KEYPAIR_PATH`) | **Multisig oracle** via Squads (3-of-5 keys held by separate teams) |
| Admin = single keypair | **Time-locked admin** via Realms (3-day delay on `set_oracle` / `set_paused`) |
| Server submits unaudited program | **Audit by Halborn / OtterSec / Sec3** ($30–80k, 4–8 wk) |
| Anchor program code | + **bug bounty** (Immunefi: $50k–500k) |
| Deposit verifies via JSON-RPC | + **second-opinion** RPC (Triton or Helius) reconfirm before credit |
| BBJ contribution from raked pots | + **on-chain BBJ vault** with public Merkle-root proof |

## Failure modes & mitigations

| Failure | Effect | Mitigation |
|---|---|---|
| Oracle keypair stolen | Attacker can co-sign withdrawal intents — but **only up to each user's deposited amount** | Per-user balance enforced on-chain; rotate oracle via `set_oracle` |
| Server compromised, attacker forges deposit | None — `/api/deposit/confirm` requires real on-chain tx with real `programId` | n/a |
| Server compromised, attacker forges withdrawal | Withdrawal still needs user wallet signature (or a stolen wallet); can't drain other users | Require multisig oracle; log all oracle co-sign events publicly |
| RPC node lies about a tx | Server confirms via RPC; if RPC poisoned, server credits a fake deposit | Use second-opinion RPC; sample on-chain account state independently |
| Program has a bug | Funds at risk | Audit + bug bounty + admin pause (timelock) |
| User loses wallet | Their `UserBalance.deposited - withdrawn` is recoverable; need new oracle co-sign with court order or KYC re-verification (operational, not protocol) | Document operational recovery flow |

## Testing the flow

Devnet:
```bash
# 1. Deploy program
cd apps/solana-program && anchor build && anchor deploy --provider.cluster devnet

# 2. Initialize the vault
ts-node scripts/init-vault.ts <oracle-pubkey>

# 3. Try a deposit (uses devnet USDC mint by default)
NEXT_PUBLIC_SOLANA_RPC=https://api.devnet.solana.com pnpm dev

# 4. Withdraw — needs ORACLE_KEYPAIR_PATH set on the API server
ORACLE_KEYPAIR_PATH=./.solana/oracle.json pnpm dev
```

Mainnet:
**Do not enable real-money deposits without a third-party audit and a
multisig oracle.** The single-keypair oracle in this scaffold is a known
risk documented above; it works for devnet but is not safe at scale.
