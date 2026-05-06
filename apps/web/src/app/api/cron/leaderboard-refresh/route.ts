import { NextResponse, type NextRequest } from 'next/server';
import { refreshLeaderboardScores } from '@/lib/retention/leaderboards';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const admin = supabaseAdmin();
  const { data: active } = await admin.from('leaderboards')
    .select('id')
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString())
    .eq('is_published', true);
  for (const lb of active ?? []) await refreshLeaderboardScores(lb.id);
  return NextResponse.json({ refreshed: (active ?? []).length });
}

function isCron(req: NextRequest): boolean {
  const fromVercel = req.headers.get('x-vercel-cron') === '1';
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization') === `Bearer ${expected}`;
  return fromVercel || provided;
}
