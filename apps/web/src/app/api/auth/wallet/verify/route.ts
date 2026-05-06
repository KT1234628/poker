import { PublicKey } from '@solana/web3.js';
import { NextResponse, type NextRequest } from 'next/server';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { z } from 'zod';
import { enforce } from '@/lib/rate-limit';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

const Body = z.object({
  walletAddress: z.string().min(32).max(64),
  signature: z.string(),
  challenge: z.string(),
});

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('wallet_verify', user.id, { tokens: 8, window: '5 m' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Look up the stored challenge
  const { data: wallet } = await sb
    .from('wallets')
    .select('id, challenge, challenge_expires_at')
    .eq('user_id', user.id)
    .eq('address', body.data.walletAddress)
    .maybeSingle();

  if (!wallet || !wallet.challenge) return NextResponse.json({ error: 'no_challenge' }, { status: 400 });
  if (wallet.challenge !== body.data.challenge) return NextResponse.json({ error: 'challenge_mismatch' }, { status: 400 });
  if (!wallet.challenge_expires_at || new Date(wallet.challenge_expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 400 });
  }

  // Verify the signature
  let pubkey: PublicKey;
  try {
    pubkey = new PublicKey(body.data.walletAddress);
  } catch {
    return NextResponse.json({ error: 'bad_address' }, { status: 400 });
  }
  const sig = bs58.decode(body.data.signature);
  const ok = nacl.sign.detached.verify(
    new TextEncoder().encode(body.data.challenge),
    sig,
    pubkey.toBytes()
  );
  if (!ok) return NextResponse.json({ error: 'bad_signature' }, { status: 400 });

  // Mark as verified, set primary if first
  const admin = supabaseAdmin();
  const { count } = await admin
    .from('wallets')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .not('verified_at', 'is', null);
  await admin
    .from('wallets')
    .update({
      verified_at: new Date().toISOString(),
      challenge: null,
      challenge_expires_at: null,
      is_primary: count === 0,
    })
    .eq('id', wallet.id);

  return NextResponse.json({ ok: true });
}
