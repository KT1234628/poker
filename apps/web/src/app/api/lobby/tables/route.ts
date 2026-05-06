import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

// Filtered, sorted lobby table search.
//   ?stakes=micro|low|mid|high
//   ?minSeats=2&maxSeats=10
//   ?onlyHasPlayers=true
//   ?favoritesOnly=true
//   ?sortBy=action|stakes|seated&sortDir=asc|desc

const Query = z.object({
  stakes: z.enum(['any', 'micro', 'low', 'mid', 'high']).default('any'),
  minSeats: z.coerce.number().int().min(2).max(10).default(2),
  maxSeats: z.coerce.number().int().min(2).max(10).default(10),
  onlyHasPlayers: z.enum(['true', 'false']).default('false'),
  favoritesOnly: z.enum(['true', 'false']).default('false'),
  sortBy: z.enum(['stakes', 'seated', 'name']).default('stakes'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const url = new URL(req.url);
  const q = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!q.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  let qb = sb.from('tables')
    .select('id, name, kind, max_seats, small_blind, big_blind, ante, min_buyin, max_buyin, straddle_kind, allow_run_it_twice, bomb_pot_every_n_hands, status')
    .eq('status', 'open')
    .eq('is_private', false)
    .gte('max_seats', q.data.minSeats)
    .lte('max_seats', q.data.maxSeats);

  if (q.data.stakes !== 'any') {
    const ranges: Record<string, [number, number]> = {
      micro: [0, 200_000],
      low:   [200_001, 2_000_000],
      mid:   [2_000_001, 10_000_000],
      high:  [10_000_001, Number.MAX_SAFE_INTEGER],
    };
    const [lo, hi] = ranges[q.data.stakes]!;
    qb = qb.gte('big_blind', lo).lte('big_blind', hi);
  }

  if (q.data.sortBy === 'stakes') qb = qb.order('big_blind', { ascending: q.data.sortDir === 'asc' });
  else if (q.data.sortBy === 'name') qb = qb.order('name', { ascending: q.data.sortDir === 'asc' });
  // (sort by seated count: client-side after we fetch; PostgREST can't aggregate over join cheaply)

  const { data: tables, error } = await qb.limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Annotate with seated count + favorited flag
  const ids = (tables ?? []).map(t => t.id);
  const [{ data: seats }, { data: favs }, { data: { user } }] = await Promise.all([
    sb.from('table_seats').select('table_id, user_id').in('table_id', ids),
    sb.auth.getUser().then(async ({ data }) => {
      if (!data.user) return { data: [] };
      return await sb.from('table_favorites').select('table_id').eq('user_id', data.user.id).in('table_id', ids);
    }),
    sb.auth.getUser(),
  ]);
  const seatedById = new Map<string, number>();
  for (const s of (seats ?? [])) {
    if (s.user_id) seatedById.set(s.table_id, (seatedById.get(s.table_id) ?? 0) + 1);
  }
  const favSet = new Set((favs ?? []).map((f: { table_id: string }) => f.table_id));

  let result = (tables ?? []).map(t => ({
    ...t,
    seated: seatedById.get(t.id) ?? 0,
    favorited: favSet.has(t.id),
  }));
  if (q.data.onlyHasPlayers === 'true') result = result.filter(t => t.seated > 0);
  if (q.data.favoritesOnly === 'true') result = result.filter(t => t.favorited);
  if (q.data.sortBy === 'seated') {
    result.sort((a, b) => q.data.sortDir === 'asc' ? a.seated - b.seated : b.seated - a.seated);
  }
  return NextResponse.json({ tables: result, userId: user?.id ?? null });
}

// Add/remove favorite
export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = await req.json() as { tableId: string };
  await sb.from('table_favorites').insert({ user_id: user.id, table_id: body.tableId });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  const tableId = url.searchParams.get('tableId');
  if (!tableId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await sb.from('table_favorites').delete().eq('user_id', user.id).eq('table_id', tableId);
  return NextResponse.json({ ok: true });
}
