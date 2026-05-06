import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { startAuthentication } from '@/lib/webauthn/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const Q = z.object({ usernameHint: z.string().min(3).max(24).optional() });

export async function POST(req: NextRequest) {
  const body = Q.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Optional username hint: lookup user, return only their creds (better UX).
  let userId: string | undefined;
  if (body.data.usernameHint) {
    const { data } = await supabaseAdmin()
      .from('profiles').select('id').eq('username', body.data.usernameHint.toLowerCase()).maybeSingle();
    userId = data?.id;
  }
  const options = await startAuthentication({ userId, request: req });
  return NextResponse.json(options);
}
