import { NextResponse, type NextRequest } from 'next/server';
import { startRegistration } from '@/lib/webauthn/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { data: profile } = await sb.from('profiles').select('username').eq('id', user.id).maybeSingle();
  const options = await startRegistration({
    userId: user.id,
    username: profile?.username ?? user.email ?? user.id,
    request: req,
  });
  return NextResponse.json(options);
}
