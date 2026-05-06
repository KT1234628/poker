import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const form = await req.formData();
  const num = (k: string) => {
    const v = form.get(k);
    if (typeof v !== 'string' || v.trim() === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n * 1e6);
  };

  const update = {
    daily_deposit_limit: num('daily_deposit_limit'),
    weekly_deposit_limit: num('weekly_deposit_limit'),
    monthly_deposit_limit: num('monthly_deposit_limit'),
    daily_loss_limit: num('daily_loss_limit'),
    session_minutes_limit: form.get('session_minutes_limit') ? Number(form.get('session_minutes_limit')) : null,
  };

  await sb.from('player_limits').upsert({ user_id: user.id, ...update });
  return NextResponse.redirect(new URL('/profile', req.url));
}
