import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { renderHandPokerStars } from '@/lib/hand-history/pokerstars';
import { enforce } from '@/lib/rate-limit';
import { supabaseServer } from '@/lib/supabase/server';

const Q = z.object({
  format: z.enum(['pokerstars', 'json']).default('pokerstars'),
  fromIso: z.string().optional(),
  toIso: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('hh_export', user.id, { tokens: 4, window: '1 h' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const url = new URL(req.url);
  const q = Q.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const from = q.data.fromIso ? new Date(q.data.fromIso) : new Date(Date.now() - 30 * 86_400_000);
  const to = q.data.toIso ? new Date(q.data.toIso) : new Date();

  // List hands the user was dealt into
  const { data: hands } = await sb.from('hand_results')
    .select('hand_id')
    .eq('user_id', user.id)
    .gte('hand_id', '00000000-0000-0000-0000-000000000000')
    .returns<{ hand_id: string }[]>();
  if (!hands || hands.length === 0) {
    return new NextResponse('# No hands found in this period.', {
      headers: { 'content-type': 'text/plain' },
    });
  }

  // Filter by date via separate hands query (joins are expensive in PostgREST)
  const ids = hands.map(h => h.hand_id);
  const { data: handRows } = await sb.from('hands')
    .select('id, started_at')
    .in('id', ids)
    .gte('started_at', from.toISOString())
    .lte('started_at', to.toISOString())
    .order('started_at', { ascending: true });

  const ordered = (handRows ?? []).map(r => r.id);

  if (q.data.format === 'json') {
    return NextResponse.json({ count: ordered.length, hands: ordered });
  }

  let body = '';
  for (const id of ordered) {
    const text = await renderHandPokerStars(sb, id);
    if (text) body += text + '\n\n\n';
  }

  // Optional: persist export record
  await sb.from('hand_history_exports').insert({
    user_id: user.id,
    format: 'pokerstars',
    period_start: from.toISOString(),
    period_end: to.toISOString(),
    hand_count: ordered.length,
    size_bytes: body.length,
  });

  return new NextResponse(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="stacks-hh-${from.toISOString().slice(0,10)}.txt"`,
    },
  });
}
