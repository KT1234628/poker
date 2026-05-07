// Withdrawal submission worker.
//
// Pulls 'submitted' withdrawals (user-signed + oracle-signed; canonical_msg
// persisted on the row), builds a VersionedTransaction with:
//   ix[0] = Ed25519 verify instruction (oracle's sig over canonical_msg)
//   ix[1] = poker_vault `withdraw` instruction
// Signs with oracle as fee payer + user-signing-via-published-sig is NOT
// possible (the user is not online); on-chain `withdraw` requires user as
// signer. So this worker actually serves as a *relay-builder* — it pre-signs
// with oracle keys, then a separate flow co-signs with the user (via wallet
// adapter) at signing time.
//
// SHIPPING NOTE: For a v1 launch, withdrawals require the user to be online
// to co-sign the on-chain tx. Future work: implement a signature-aggregator
// flow where the user delegates a session signer for withdrawal-only intents.
//
// This worker handles the watch-and-confirm side: poll Solana for tx
// confirmation status, mark `confirmed` or `failed` + refund.

import { Connection, Keypair, Transaction, sendAndConfirmRawTransaction, type VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import { db } from './db.js';
import { log } from './log.js';

const POLL_INTERVAL_MS = 10_000;
const MAX_ATTEMPTS = 5;
const WITHDRAW_TX_TIMEOUT_MS = 60_000;

let oracle: Keypair | null = null;
function loadOracle() {
  if (oracle) return oracle;
  const path = process.env.ORACLE_KEYPAIR_PATH;
  if (!path) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    oracle = Keypair.fromSecretKey(new Uint8Array(raw));
    return oracle;
  } catch (e) {
    log.error({ err: (e as Error).message }, 'failed to load oracle keypair');
    return null;
  }
}

export function startWithdrawalWorker() {
  setInterval(() => void tick().catch(err => log.error({ err }, 'withdraw worker err')), POLL_INTERVAL_MS);
}

async function tick() {
  if (!loadOracle()) return;                                    // no-op if oracle unavailable
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpc, 'confirmed');

  // 1. Confirm any submitted txs that have a tx_signature: poll Solana.
  await reconcileSubmittedTxs(conn);

  // 2. Sweep expired or stuck withdrawals: refund.
  await sweepExpiredAndStuck();
}

/** Poll Solana for status of withdrawals already on-chain. */
async function reconcileSubmittedTxs(conn: Connection) {
  const { data: pending } = await db
    .from('withdrawals')
    .select('id, tx_signature, submit_attempts, requested_at')
    .eq('status', 'submitted')
    .not('tx_signature', 'is', null)
    .order('requested_at', { ascending: true })
    .limit(50);

  for (const w of pending ?? []) {
    try {
      const status = await conn.getSignatureStatus(w.tx_signature, { searchTransactionHistory: true });
      if (!status.value) continue;                                  // not yet on-chain
      const conf = status.value.confirmationStatus;
      if (status.value.err) {
        log.warn({ id: w.id, err: status.value.err }, 'withdraw tx errored on-chain');
        await failAndRefund(w.id, 'tx_failed_onchain');
      } else if (conf === 'confirmed' || conf === 'finalized') {
        await db.from('withdrawals').update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        }).eq('id', w.id);
        log.info({ id: w.id, sig: w.tx_signature }, 'withdraw confirmed');
      }
    } catch (e) {
      log.warn({ err: (e as Error).message, id: w.id }, 'withdraw status poll error');
    }
  }
}

/** Refund withdrawals that expired before submit, or stuck for too long. */
async function sweepExpiredAndStuck() {
  // Pending past expiry (user never came back to sign)
  const { data: expired } = await db
    .from('withdrawals')
    .select('id')
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .limit(50);
  for (const w of expired ?? []) {
    await failAndRefund(w.id, 'user_did_not_sign');
  }

  // Submitted but tx never landed (no tx_signature) — shouldn't happen with
  // user-online flow but defensive.
  const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data: stuck } = await db
    .from('withdrawals')
    .select('id, submit_attempts')
    .eq('status', 'submitted')
    .is('tx_signature', null)
    .lt('requested_at', cutoff)
    .limit(20);
  for (const w of stuck ?? []) {
    await failAndRefund(w.id, 'never_landed');
  }
}

async function failAndRefund(withdrawalId: string, reason: string) {
  try {
    await db.rpc('fail_withdrawal_with_refund', { p_withdrawal_id: withdrawalId, p_reason: reason });
    log.info({ id: withdrawalId, reason }, 'withdraw refunded');
  } catch (e) {
    log.error({ err: (e as Error).message, id: withdrawalId }, 'refund failed');
  }
}
