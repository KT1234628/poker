import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const form = await req.formData();
  const until = form.get('until');
  if (typeof until !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const date = new Date(until);
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) {
    return NextResponse.json({ error: 'date_in_past' }, { status: 400 });
  }
  await sb
    .from('player_limits')
    .update({ self_excluded_until: date.toISOString() })
    .eq('user_id', user.id);
  return NextResponse.redirect(new URL('/profile?excluded=1', req.url));
}
