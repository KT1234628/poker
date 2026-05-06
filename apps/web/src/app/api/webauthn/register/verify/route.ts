import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyRegistration } from '@/lib/webauthn/server';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

const Body = z.object({
  response: z.unknown(),
  nickname: z.string().max(40).optional(),
  challenge: z.string(),
});

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Verify the challenge belongs to this user and is fresh.
  const admin = supabaseAdmin();
  const { data: ch } = await admin
    .from('webauthn_challenges')
    .select('user_id, expires_at, used_at')
    .eq('challenge', body.data.challenge)
    .eq('type', 'register')
    .maybeSingle();
  if (!ch || ch.user_id !== user.id || ch.used_at) {
    return NextResponse.json({ error: 'bad_challenge' }, { status: 400 });
  }
  if (new Date(ch.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 400 });
  }

  const result = await verifyRegistration({
    userId: user.id,
    expectedChallenge: body.data.challenge,
    response: body.data.response as Parameters<typeof verifyRegistration>[0]['response'],
    nickname: body.data.nickname,
    request: req,
  });
  if (!result.verified) return NextResponse.json({ error: 'verification_failed' }, { status: 400 });

  return NextResponse.json({ ok: true, credentialId: result.credentialId });
}
