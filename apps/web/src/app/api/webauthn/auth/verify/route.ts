import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyAuthentication } from '@/lib/webauthn/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const Body = z.object({
  challenge: z.string(),
  response: z.unknown(),
});

export async function POST(req: NextRequest) {
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: ch } = await admin
    .from('webauthn_challenges')
    .select('expires_at, used_at')
    .eq('challenge', body.data.challenge)
    .eq('type', 'authenticate')
    .maybeSingle();
  if (!ch || ch.used_at) return NextResponse.json({ error: 'bad_challenge' }, { status: 400 });
  if (new Date(ch.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'expired' }, { status: 400 });
  }

  const result = await verifyAuthentication({
    expectedChallenge: body.data.challenge,
    response: body.data.response as Parameters<typeof verifyAuthentication>[0]['response'],
    request: req,
  });
  if (!result.verified) return NextResponse.json({ error: result.reason ?? 'verify_failed' }, { status: 400 });

  // Issue a Supabase session via magic-link sign-in (admin generates; client redeems).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: ((await admin.from('profiles').select('id').eq('id', result.userId!).maybeSingle()).data?.id) ?
      // We can't get the user's email directly without user.email; use admin.getUserById
      ((await admin.auth.admin.getUserById(result.userId!)).data.user?.email ?? '') : '',
  });
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, magic: link.properties?.action_link });
}
