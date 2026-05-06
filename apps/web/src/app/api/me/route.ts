import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { data: profile } = await sb.from('profiles').select('username, kyc_status').eq('id', user.id).maybeSingle();
  return NextResponse.json({ id: user.id, email: user.email, ...profile });
}
