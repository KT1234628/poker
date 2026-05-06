import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { enforce } from '@/lib/rate-limit';
import { supabaseServer } from '@/lib/supabase/server';

const Body = z.object({ walletAddress: z.string().min(32).max(64) });

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('wallet_challenge', user.id, { tokens: 8, window: '5 m' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const challenge = `Stacks Poker — wallet linking
Sign this message to prove ownership of ${body.data.walletAddress}.

User: ${user.id}
Issued: ${new Date().toISOString()}
Nonce: ${crypto.randomUUID()}`;
  const expires = new Date(Date.now() + 5 * 60_000).toISOString();

  await sb.from('wallets').upsert({
    user_id: user.id,
    address: body.data.walletAddress,
    chain: 'solana',
    challenge,
    challenge_expires_at: expires,
  }, { onConflict: 'user_id,address' });

  return NextResponse.json({ message: challenge, expires });
}
