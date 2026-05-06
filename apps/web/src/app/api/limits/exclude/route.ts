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
  // Monotonic-only: cannot shorten an existing self-exclusion period.
  // Implemented in SQL as `greatest(coalesce(self_excluded_until, now()), $1)`.
  const { error } = await sb.rpc('set_self_exclusion', {
    p_user_id: user.id,
    p_until: date.toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.redirect(new URL('/profile?excluded=1', req.url));
}
