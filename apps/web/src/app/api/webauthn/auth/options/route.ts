import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { enforce } from '@/lib/rate-limit';
import { startAuthentication } from '@/lib/webauthn/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const Q = z.object({ usernameHint: z.string().min(3).max(24) });

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = await enforce('webauthn_auth_options', ip, { tokens: 30, window: '5 m' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = Q.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Always require a username hint so the challenge is bound to a user. This
  // closes the cross-user replay where any valid passkey could log in as any
  // user. To avoid the username-enumeration oracle, we always return a valid
  // options object even when the user doesn't exist (with a dummy credential
  // list of identical shape).
  const { data } = await supabaseAdmin()
    .from('profiles').select('id').eq('username', body.data.usernameHint.toLowerCase()).maybeSingle();
  const userId = data?.id;
  const options = await startAuthentication({ userId, request: req });
  return NextResponse.json(options);
}
