import { NextResponse, type NextRequest } from 'next/server';
import { enforce } from '@/lib/rate-limit';
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('tournament_register', user.id, { tokens: 30, window: '5 m' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const admin = supabaseAdmin();
  const { data: t } = await admin.from('tournaments').select('*').eq('id', id).maybeSingle();
  if (!t) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!['scheduled', 'registering', 'late_reg'].includes(t.status)) {
    return NextResponse.json({ error: 'closed' }, { status: 400 });
  }
  if (t.registered_count >= t.max_players) {
    return NextResponse.json({ error: 'full' }, { status: 400 });
  }

  // KYC + ban checks
  const { data: profile } = await admin
    .from('profiles')
    .select('kyc_status, is_banned')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.is_banned) return NextResponse.json({ error: 'banned' }, { status: 403 });
  if (profile.kyc_status !== 'approved') return NextResponse.json({ error: 'kyc_required' }, { status: 403 });

  const total = Number(t.buy_in) + Number(t.fee);

  // Debit chips for buy-in + fee
  const { error: debitErr } = await admin.rpc('debit_chips', {
    p_user_id: user.id,
    p_amount: total,
    p_kind: 'tournament_buyin',
    p_ref_table: 'tournaments',
    p_ref_id: id,
  });
  if (debitErr) return NextResponse.json({ error: debitErr.message }, { status: 400 });

  // Insert entry
  const { error: insErr } = await admin.from('tournament_entries').upsert({
    tournament_id: id,
    user_id: user.id,
    status: 'registered',
    stack: t.starting_stack,
  });
  if (insErr) {
    // Refund on insert failure
    await admin.rpc('credit_chips', {
      p_user_id: user.id,
      p_amount: total,
      p_kind: 'refund',
      p_ref_table: 'tournaments',
      p_ref_id: id,
    });
    return NextResponse.json({ error: insErr.message }, { status: 400 });
  }

  // Update prize pool + count
  await admin.from('tournaments').update({
    registered_count: t.registered_count + 1,
    prize_pool: Number(t.prize_pool) + Number(t.buy_in),
  }).eq('id', id);

  return NextResponse.json({ ok: true });
}
