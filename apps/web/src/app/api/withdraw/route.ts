import { Ed25519Program, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { NextResponse, type NextRequest } from 'next/server';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { z } from 'zod';
import fs from 'node:fs';
import { enforce } from '@/lib/rate-limit';
import { buildWithdrawMessage } from '@/lib/solana/vault';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

const Body = z.object({
  amount: z.number().int().positive(),
  walletAddress: z.string().min(32).max(64),
  userSignature: z.string(),
  nonce: z.string(),
});

// Withdraws require:
//   1. The user signs an off-chain intent (verified here).
//   2. We debit chips immediately (atomic in DB).
//   3. We co-sign with the oracle key.
//   4. The signed pair lands in the on-chain `withdraw` instruction
//      (a separate worker watches the withdrawals table and submits the tx).
export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('withdraw_request', user.id, { tokens: 8, window: '1 h' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Verify the user-signed intent
  const expectedMessage = `withdraw:${body.data.amount}:${body.data.walletAddress}:${body.data.nonce}`;
  let sigOk = false;
  try {
    sigOk = nacl.sign.detached.verify(
      new TextEncoder().encode(expectedMessage),
      bs58.decode(body.data.userSignature),
      new PublicKey(body.data.walletAddress).toBytes()
    );
  } catch {}
  if (!sigOk) return NextResponse.json({ error: 'bad_user_signature' }, { status: 400 });

  // Verify wallet belongs to user
  const { data: wallet } = await sb
    .from('wallets')
    .select('id')
    .eq('user_id', user.id)
    .eq('address', body.data.walletAddress)
    .not('verified_at', 'is', null)
    .maybeSingle();
  if (!wallet) return NextResponse.json({ error: 'wallet_not_linked' }, { status: 400 });

  // Debit chips (will throw on insufficient funds, self-exclusion, etc.)
  const { data: withdrawalId, error: rpcErr } = await sb.rpc('request_withdrawal', {
    p_user_id: user.id,
    p_wallet_id: wallet.id,
    p_amount: body.data.amount,
    p_user_signature: body.data.userSignature,
  });
  if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 400 });

  // Oracle co-sign
  const oracle = loadOracleKeypair();
  if (!oracle) {
    return NextResponse.json({ error: 'oracle_unavailable', withdrawalId }, { status: 503 });
  }
  const onChainNonce = BigInt('0x' + body.data.nonce.replace(/-/g, '').slice(0, 16));
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 600);
  const message = buildWithdrawMessage({
    user: new PublicKey(body.data.walletAddress),
    amount: BigInt(body.data.amount),
    nonce: onChainNonce,
    expiresAt,
  });
  const oracleSig = nacl.sign.detached(message, oracle.secretKey);

  await supabaseAdmin().from('withdrawals').update({
    oracle_signed_at: new Date().toISOString(),
    oracle_signature: bs58.encode(Buffer.from(oracleSig)),
    status: 'submitted',
  }).eq('id', withdrawalId);

  return NextResponse.json({ ok: true, withdrawalId });
}

function loadOracleKeypair(): Keypair | null {
  try {
    const path = process.env.ORACLE_KEYPAIR_PATH;
    if (!path) return null;
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Keypair.fromSecretKey(new Uint8Array(raw));
  } catch {
    return null;
  }
}
