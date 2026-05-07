// Step 2 of withdrawal flow:
//   • Verifies the user-signed canonical message bytes (ed25519 over the
//     same bytes that the on-chain program will check from the oracle).
//   • Oracle co-signs the same message bytes server-side.
//   • Marks withdrawal as `submitted`. The withdrawal-worker will pick it up
//     and submit on-chain.

import { Keypair, PublicKey } from '@solana/web3.js';
import { NextResponse, type NextRequest } from 'next/server';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { z } from 'zod';
import fs from 'node:fs';
import { enforce } from '@/lib/rate-limit';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

const Body = z.object({
  withdrawalId: z.string().uuid(),
  userSignatureB58: z.string(),    // base58 encoded ed25519 signature
});

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('withdraw_sign', user.id, { tokens: 5, window: '1 h' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: w } = await admin
    .from('withdrawals')
    .select('id, user_id, amount, status, on_chain_nonce, expires_at, wallet_id')
    .eq('id', body.data.withdrawalId).maybeSingle();
  if (!w || w.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (w.status !== 'pending')      return NextResponse.json({ error: 'not_pending' }, { status: 400 });
  if (new Date(w.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 400 });
  }

  // Pull wallet pubkey + canonical message
  const { data: wallet } = await admin.from('wallets').select('address').eq('id', w.wallet_id).maybeSingle();
  if (!wallet) return NextResponse.json({ error: 'wallet_missing' }, { status: 400 });
  const walletPk = new PublicKey(wallet.address);

  // Rebuild canonical bytes from server-of-record values
  const msg = canonicalMessage({
    user: walletPk,
    amount: BigInt(w.amount),
    nonce: BigInt(String(w.on_chain_nonce)),
    expiresUnix: BigInt(Math.floor(new Date(w.expires_at).getTime() / 1000)),
  });

  // Verify user's wallet signature over those bytes
  let userSigOk = false;
  try {
    userSigOk = nacl.sign.detached.verify(msg, bs58.decode(body.data.userSignatureB58), walletPk.toBytes());
  } catch {}
  if (!userSigOk) return NextResponse.json({ error: 'bad_user_signature' }, { status: 400 });

  // Oracle co-sign
  const oracle = loadOracleKeypair();
  if (!oracle) return NextResponse.json({ error: 'oracle_unavailable' }, { status: 503 });
  const oracleSig = nacl.sign.detached(msg, oracle.secretKey);

  // Mark as submitted; persist signatures + canonical bytes for the worker.
  const { error: updErr } = await admin.from('withdrawals').update({
    user_signature: body.data.userSignatureB58,
    oracle_signature: bs58.encode(Buffer.from(oracleSig)),
    oracle_signed_at: new Date().toISOString(),
    canonical_msg: Buffer.from(msg),
    status: 'submitted',
  }).eq('id', body.data.withdrawalId).eq('status', 'pending');
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}

// Read-back the oracle pubkey + signature so the user can co-sign the
// on-chain tx (worker confirms after broadcast).
export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  const id = url.searchParams.get('withdrawalId');
  if (!id) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { data: w } = await supabaseAdmin().from('withdrawals')
    .select('user_id, status, oracle_signature').eq('id', id).maybeSingle();
  if (!w || w.user_id !== user.id) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (w.status !== 'submitted')    return NextResponse.json({ error: 'not_signed' }, { status: 400 });

  const oracle = loadOracleKeypair();
  return NextResponse.json({
    oraclePubkeyB58: oracle?.publicKey.toBase58() ?? null,
    oracleSignatureB58: w.oracle_signature,
  });
}

// Persist the final on-chain tx signature.
const PatchBody = z.object({
  withdrawalId: z.string().uuid(),
  txSignature: z.string().min(40).max(120),
});
export async function PATCH(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = PatchBody.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const admin = supabaseAdmin();
  await admin.from('withdrawals')
    .update({ tx_signature: body.data.txSignature })
    .eq('id', body.data.withdrawalId).eq('user_id', user.id).eq('status', 'submitted');
  return NextResponse.json({ ok: true });
}

function canonicalMessage(opts: { user: PublicKey; amount: bigint; nonce: bigint; expiresUnix: bigint }): Uint8Array {
  const out = new Uint8Array(16 + 32 + 8 + 8 + 8);
  out.set(new TextEncoder().encode('stacks_withdraw:'), 0);
  out.set(opts.user.toBytes(), 16);
  const view = new DataView(out.buffer, out.byteOffset);
  view.setBigUint64(48, opts.amount, true);
  view.setBigUint64(56, opts.nonce, true);
  view.setBigInt64(64, opts.expiresUnix, true);
  return out;
}

function loadOracleKeypair(): Keypair | null {
  try {
    const path = process.env.ORACLE_KEYPAIR_PATH;
    if (!path) return null;
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    return Keypair.fromSecretKey(new Uint8Array(raw));
  } catch { return null; }
}
