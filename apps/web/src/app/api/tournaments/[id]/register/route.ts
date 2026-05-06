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

  // Atomic registration via SQL function: locks the tournament row, validates
  // capacity + re-entry rules, debits chips, inserts entry, bumps counters,
  // all in one transaction.
  const { error: regErr } = await admin.rpc('tournament_register_atomic', {
    p_tournament_id: id,
    p_user_id: user.id,
    p_buy_in: Number(t.buy_in),
    p_fee: Number(t.fee),
    p_starting_stack: Number(t.starting_stack),
    p_is_re_entry: false,
  });
  if (regErr) {
    const msg = regErr.message ?? 'register_failed';
    const code = msg.includes('full') ? 400 : msg.includes('insufficient') ? 400 : 400;
    return NextResponse.json({ error: msg }, { status: code });
  }

  return NextResponse.json({ ok: true });
}
