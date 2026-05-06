import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { enforce } from '@/lib/rate-limit';
import { verifyAuthentication } from '@/lib/webauthn/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const Body = z.object({
  challenge: z.string(),
  response: z.unknown(),
});

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = await enforce('webauthn_auth_verify', ip, { tokens: 30, window: '5 m' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const admin = supabaseAdmin();
  // Atomic claim-of-challenge: only proceed if used_at can be flipped by us.
  const { data: claimed } = await admin
    .from('webauthn_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('challenge', body.data.challenge)
    .eq('type', 'authenticate')
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('user_id')
    .maybeSingle();
  if (!claimed) return NextResponse.json({ error: 'bad_challenge' }, { status: 400 });

  const result = await verifyAuthentication({
    expectedChallenge: body.data.challenge,
    response: body.data.response as Parameters<typeof verifyAuthentication>[0]['response'],
    request: req,
  });
  if (!result.verified) return NextResponse.json({ error: result.reason ?? 'verify_failed' }, { status: 400 });

  // The challenge MUST have been issued for this user — otherwise reject.
  // (When `claimed.user_id` is null, the challenge was issued via the
  // discoverable-credential path; we require an explicit user binding here.)
  if (!claimed.user_id || claimed.user_id !== result.userId) {
    return NextResponse.json({ error: 'challenge_user_mismatch' }, { status: 401 });
  }

  // Issue a Supabase session by minting a one-time magic link, then redirect to it
  // server-side (HTTP 303) so the action_link is never exposed in the JSON body.
  const { data: u } = await admin.auth.admin.getUserById(result.userId);
  const email = u?.user?.email;
  if (!email) return NextResponse.json({ error: 'no_email' }, { status: 500 });
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkErr || !link?.properties?.action_link) {
    return NextResponse.json({ error: linkErr?.message ?? 'no_link' }, { status: 500 });
  }

  return NextResponse.redirect(link.properties.action_link, { status: 303 });
}
