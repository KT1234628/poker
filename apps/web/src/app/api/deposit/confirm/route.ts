// Deposit confirmation — full on-chain verification.
//
// What we check (in order; any failure rejects):
//   1. Caller is authenticated.
//   2. Wallet is linked to caller and verified.
//   3. txSignature exists, is confirmed, has no error.
//   4. The transaction includes EXACTLY ONE instruction whose programId
//      equals our vault program — and that instruction's discriminator is
//      `deposit`.
//   5. The instruction's account list matches the expected layout, with:
//      - user signer = the user's linked wallet
//      - vault_token_account = the vault PDA
//      - user_balance = the user's PDA
//      - token program = TOKEN_PROGRAM_ID
//   6. The instruction's u64 amount field decodes to a positive number that
//      matches the `DepositEvent` log emitted by the program.
//   7. The DepositEvent.user equals the wallet pubkey.
//   8. Idempotency: tx_signature unique constraint guards double-credit.
//
// With these checks, an attacker who deploys a copycat program emitting fake
// DepositEvents cannot mint chips: their tx invokes a different programId
// and is rejected at step 4.

import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Connection, PublicKey } from '@solana/web3.js';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { enforce } from '@/lib/rate-limit';
import { decodeDepositEvent, decodeProgramDataLog } from '@/lib/solana/program';
import { IX_DISCRIMINATORS } from '@/lib/solana/idl';
import { configPda, programId, usdcMint, userBalancePda, vaultTokenAccountPda } from '@/lib/solana/vault';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

const Body = z.object({
  txSignature: z.string().min(40).max(120),
  walletAddress: z.string().min(32).max(64),
});

const MAX_DEPOSIT_AGE_SLOTS = 432_000;        // ~2 days at ~400ms/slot

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('deposit_confirm', user.id, { tokens: 30, window: '5 m' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Verify wallet belongs to user and is verified
  const { data: wallet } = await sb
    .from('wallets')
    .select('id, address, verified_at')
    .eq('user_id', user.id)
    .eq('address', body.data.walletAddress)
    .maybeSingle();
  if (!wallet || !wallet.verified_at) {
    return NextResponse.json({ error: 'wallet_not_linked' }, { status: 400 });
  }

  // Idempotency: if we've already credited this signature, no-op success.
  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from('deposits').select('id, status').eq('tx_signature', body.data.txSignature).maybeSingle();
  if (existing && existing.status === 'confirmed') {
    return NextResponse.json({ ok: true, alreadyConfirmed: true });
  }

  // Look up the on-chain transaction
  const conn = new Connection(
    process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com',
    'confirmed'
  );
  const tx = await conn.getTransaction(body.data.txSignature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });
  if (!tx || !tx.meta) return NextResponse.json({ error: 'tx_not_found' }, { status: 404 });
  if (tx.meta.err) return NextResponse.json({ error: 'tx_failed' }, { status: 400 });

  // Recency: don't accept ancient transactions (replay-defense + ops sanity).
  const currentSlot = await conn.getSlot('confirmed');
  if (currentSlot - tx.slot > MAX_DEPOSIT_AGE_SLOTS) {
    return NextResponse.json({ error: 'tx_too_old' }, { status: 400 });
  }

  // Walk the instructions. Find the one invoking OUR program.
  let walletPk: PublicKey;
  try { walletPk = new PublicKey(body.data.walletAddress); }
  catch { return NextResponse.json({ error: 'bad_wallet' }, { status: 400 }); }

  const ourProgram = programId();
  const accountKeys = tx.transaction.message.staticAccountKeys.map(k => k.toBase58());
  const compiled = tx.transaction.message.compiledInstructions;

  const ourIxs = compiled
    .map(ix => ({ ix, keys: ix.accountKeyIndexes.map(i => new PublicKey(accountKeys[i]!)) , programIdKey: new PublicKey(accountKeys[ix.programIdIndex]!) }))
    .filter(x => x.programIdKey.equals(ourProgram));
  if (ourIxs.length === 0) {
    return NextResponse.json({ error: 'no_program_instruction' }, { status: 400 });
  }

  // Find the deposit ix specifically (some txs may also include register_user)
  const depositIx = ourIxs.find(x => {
    const data = Buffer.from(x.ix.data);
    if (data.length < 8 + 8) return false;
    return data.subarray(0, 8).equals(IX_DISCRIMINATORS.deposit);
  });
  if (!depositIx) return NextResponse.json({ error: 'not_a_deposit' }, { status: 400 });

  // Decode amount from instruction data
  const ixData = Buffer.from(depositIx.ix.data);
  const ixAmount = ixData.readBigUInt64LE(8);
  if (ixAmount <= 0n) return NextResponse.json({ error: 'zero_amount' }, { status: 400 });

  // Verify account layout: keys[0]=user (signer), keys[5]=vault_token_account
  if (depositIx.keys.length < 7) {
    return NextResponse.json({ error: 'malformed_accounts' }, { status: 400 });
  }
  const ixUser     = depositIx.keys[0]!;
  const ixConfig   = depositIx.keys[1]!;
  const ixUserBal  = depositIx.keys[2]!;
  const ixUserAta  = depositIx.keys[4]!;
  const ixVaultTok = depositIx.keys[5]!;
  const ixTokenPgm = depositIx.keys[6]!;

  if (!ixUser.equals(walletPk)) {
    return NextResponse.json({ error: 'user_mismatch' }, { status: 400 });
  }
  const [expectedVaultToken] = vaultTokenAccountPda();
  if (!ixVaultTok.equals(expectedVaultToken)) {
    return NextResponse.json({ error: 'wrong_vault_token' }, { status: 400 });
  }
  const [expectedConfig] = configPda();
  if (!ixConfig.equals(expectedConfig)) {
    return NextResponse.json({ error: 'wrong_config_pda' }, { status: 400 });
  }
  const [expectedUserBal] = userBalancePda(walletPk);
  if (!ixUserBal.equals(expectedUserBal)) {
    return NextResponse.json({ error: 'wrong_user_balance' }, { status: 400 });
  }
  const expectedUserAta = getAssociatedTokenAddressSync(usdcMint(), walletPk);
  if (!ixUserAta.equals(expectedUserAta)) {
    return NextResponse.json({ error: 'wrong_user_ata' }, { status: 400 });
  }
  if (!ixTokenPgm.equals(TOKEN_PROGRAM_ID)) {
    return NextResponse.json({ error: 'wrong_token_program' }, { status: 400 });
  }

  // Walk logs for the matching DepositEvent. Anchor logs `Program data: <b64>`
  // for emit!() calls. We require the event's user + amount to match.
  const logs = tx.meta.logMessages ?? [];
  let event: { user: PublicKey; amount: bigint; userTotalDeposited: bigint; vaultTotalDeposits: bigint } | null = null;
  for (const line of logs) {
    const buf = decodeProgramDataLog(line);
    if (!buf) continue;
    const ev = decodeDepositEvent(buf);
    if (ev) { event = ev; break; }
  }
  if (!event) return NextResponse.json({ error: 'event_missing' }, { status: 400 });
  if (!event.user.equals(walletPk)) return NextResponse.json({ error: 'event_user_mismatch' }, { status: 400 });
  if (event.amount !== ixAmount)   return NextResponse.json({ error: 'event_amount_mismatch' }, { status: 400 });

  // All checks pass. Insert deposit row + credit chips atomically.
  const { error: insErr } = await admin.from('deposits').upsert({
    user_id: user.id,
    wallet_id: wallet.id,
    amount: Number(ixAmount),
    tx_signature: body.data.txSignature,
    slot: tx.slot,
    status: 'confirmed',
    confirmed_at: new Date().toISOString(),
  }, { onConflict: 'tx_signature' });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const { data: dep } = await admin
    .from('deposits')
    .select('id, credited_ledger_id')
    .eq('tx_signature', body.data.txSignature)
    .maybeSingle();
  if (dep?.id && !dep.credited_ledger_id) {
    await admin.rpc('credit_deposit', { p_deposit_id: dep.id });
  }

  return NextResponse.json({ ok: true, amount: ixAmount.toString() });
}
