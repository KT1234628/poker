import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { awardLeaderboardPrizes } from '@/lib/retention/leaderboards';
import { supabaseAdmin } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
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

