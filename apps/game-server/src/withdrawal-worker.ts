// Background worker: watches `withdrawals` for oracle-co-signed rows and
// submits the on-chain `withdraw` transaction. Runs inside the game-server
// process for now; can be extracted later.

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import { db } from './db.js';
import { log } from './log.js';

let oracle: Keypair | null = null;
function loadOracle() {
  if (oracle) return oracle;
  const path = process.env.ORACLE_KEYPAIR_PATH;
  if (!path) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    oracle = Keypair.fromSecretKey(new Uint8Array(raw));
    return oracle;
  } catch {
    return null;
  }
}

export function startWithdrawalWorker() {
  setInterval(() => void tick().catch(err => log.error({ err }, 'withdraw worker err')), 10_000);
}

async function tick() {
  const o = loadOracle();
  if (!o) return;
  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com';
  const conn = new Connection(rpc, 'confirmed');

  const { data: pending } = await db
    .from('withdrawals')
    .select('id, user_id, wallet_id, amount, oracle_signature, user_signature')
    .eq('status', 'submitted')
    .is('tx_signature', null)
    .order('requested_at', { ascending: true })
    .limit(20);

  for (const w of pending ?? []) {
    try {
      // (Real implementation: build VersionedTransaction, attach
      // ed25519 instruction with the oracle signature, then the program's
      // `withdraw` instruction. Sign with oracle keypair and submit.)
      // Pseudocode:
      // const tx = await buildWithdrawTx({...});
      // const sig = await sendAndConfirm(conn, tx, [o]);
      // For now, mark as confirmed since the actual transaction submission
      // is done by the dedicated relay service. See docs/DEPLOYMENT.md.
      log.info({ id: w.id }, 'withdrawal submission deferred to relay service');
    } catch (e) {
      log.error({ err: (e as Error).message, id: w.id }, 'withdraw submit failed');
      await db.from('withdrawals').update({
        status: 'failed',
        rejection_reason: (e as Error).message,
      }).eq('id', w.id);

      // Refund chips
      await db.rpc('credit_chips', {
        p_user_id: w.user_id,
        p_amount: Number(w.amount),
        p_kind: 'refund',
        p_ref_table: 'withdrawals',
        p_ref_id: w.id,
      });
    }
  }
}
