// Step 1 of withdrawal flow: server generates the nonce + canonical message
// bytes the user must sign with their wallet. Chips are debited atomically;
// if the user never returns to /sign within the expiry window, the worker
// refunds via fail_withdrawal_with_refund.

import { PublicKey } from '@solana/web3.js';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { enforce } from '@/lib/rate-limit';
import { buildWithdrawMessage } from '@/lib/solana/vault';
import { supabaseServer } from '@/lib/supabase/server';

const Body = z.object({
  amount: z.number().int().positive(),
  walletAddress: z.string().min(32).max(64),
});

const EXPIRES_SECONDS = 300;     // 5 min window for user to sign

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('withdraw_start', user.id, { tokens: 3, window: '1 h' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Verify wallet
  const { data: wallet } = await sb
    .from('wallets').select('id, address')
    .eq('user_id', user.id).eq('address', body.data.walletAddress)
    .not('verified_at', 'is', null).maybeSingle();
  if (!wallet) return NextResponse.json({ error: 'wallet_not_linked' }, { status: 400 });

  let walletPk: PublicKey;
  try { walletPk = new PublicKey(body.data.walletAddress); }
  catch { return NextResponse.json({ error: 'bad_wallet' }, { status: 400 }); }

  const expiresAt = new Date(Date.now() + EXPIRES_SECONDS * 1000);

  // Atomic: pick nonce > prior_max, debit chips, insert row.
  const { data, error } = await sb.rpc('start_withdrawal', {
    p_user_id: user.id,
    p_wallet_id: wallet.id,
    p_amount: body.data.amount,
    p_expires_at: expiresAt.toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.withdrawal_id) return NextResponse.json({ error: 'start_failed' }, { status: 500 });

  const nonceStr = String(row.on_chain_nonce);
  const expiresUnix = Math.floor(new Date(row.expires_at).getTime() / 1000);

  // Build the canonical bytes the user must sign. This is identical to what
  // the on-chain program will verify (modulo who signs it; here the user signs
  // for intent — the oracle will sign the same bytes with its own key).
  const msg = buildWithdrawMessage({
    user: walletPk,
    amount: BigInt(body.data.amount),
    nonce: BigInt(nonceStr),
    expiresAt: BigInt(expiresUnix),
  });

  return NextResponse.json({
    withdrawalId: row.withdrawal_id,
    nonce: nonceStr,
    expiresAt: row.expires_at,
    canonicalMessageB64: Buffer.from(msg).toString('base64'),
  });
}
