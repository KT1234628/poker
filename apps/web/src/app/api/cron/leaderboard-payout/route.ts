import { NextResponse, type NextRequest } from 'next/server';
import { awardLeaderboardPrizes } from '@/lib/retention/leaderboards';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const admin = supabaseAdmin();
  const { data: ended } = await admin.from('leaderboards')
    .select('id')
    .lte('ends_at', new Date().toISOString())
    .eq('is_published', true);
  let paid = 0;
  for (const lb of ended ?? []) {
    await awardLeaderboardPrizes(lb.id);
    paid++;
  }
  return NextResponse.json({ paid });
}

function isCron(req: NextRequest): boolean {
  const fromVercel = req.headers.get('x-vercel-cron') === '1';
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization') === `Bearer ${expected}`;
  return fromVercel || provided;
}
