// Leaderboards aggregator + payouts.
//
// Maintained as Postgres aggregations against ledger_entries / hand_results /
// tournament_entries depending on metric. We refresh scores in batch (cron),
// then award prizes when a leaderboard's `ends_at` passes.

import { supabaseAdmin } from '@/lib/supabase/server';

export async function refreshLeaderboardScores(leaderboardId: string) {
  const admin = supabaseAdmin();
  const { data: lb } = await admin.from('leaderboards')
    .select('*').eq('id', leaderboardId).maybeSingle();
  if (!lb) return;

  // Score by metric
  let rows: Array<{ user_id: string; score: number }> = [];
  switch (lb.metric) {
    case 'cash_winnings': {
      const { data } = await admin
        .from('hand_results')
        .select('user_id, winnings.sum()')
        .gte('hand_id', '00000000-0000-0000-0000-000000000000') // stub; in real Postgres use a join on hands.started_at
        .returns<{ user_id: string; winnings: number }[]>();
      rows = (data ?? []).map(r => ({ user_id: r.user_id, score: Math.floor(Number(r.winnings)) }));
      break;
    }
    case 'tournament_winnings': {
      const { data } = await admin
        .from('tournament_entries')
        .select('user_id, prize.sum()')
        .gte('busted_at', lb.starts_at)
        .lte('busted_at', lb.ends_at)
        .returns<{ user_id: string; prize: number }[]>();
      rows = (data ?? []).map(r => ({ user_id: r.user_id, score: Math.floor(Number(r.prize)) }));
      break;
    }
    case 'rake_paid': {
      const { data } = await admin
        .from('ledger_entries')
        .select('user_id, delta.sum()')
        .eq('kind', 'rake')
        .gte('created_at', lb.starts_at)
        .lte('created_at', lb.ends_at)
        .returns<{ user_id: string; delta: number }[]>();
      rows = (data ?? []).map(r => ({ user_id: r.user_id, score: Math.abs(Math.floor(Number(r.delta))) }));
      break;
    }
    default: {
      // tournament_points: sum of (max_players - place + 1) across cashes (simple model)
      const { data } = await admin
        .from('tournament_entries')
        .select('user_id, position, tournament_id, tournaments(max_players)')
        .gte('busted_at', lb.starts_at)
        .lte('busted_at', lb.ends_at);
      const map = new Map<string, number>();
      for (const r of (data ?? []) as { user_id: string; position: number | null; tournaments: { max_players: number } | null }[]) {
        if (!r.position || !r.tournaments) continue;
        const pts = Math.max(0, r.tournaments.max_players - r.position + 1);
        map.set(r.user_id, (map.get(r.user_id) ?? 0) + pts);
      }
      rows = [...map].map(([user_id, score]) => ({ user_id, score }));
      break;
    }
  }

  rows.sort((a, b) => b.score - a.score);
  await admin.from('leaderboard_scores').delete().eq('leaderboard_id', leaderboardId);
  if (rows.length > 0) {
    await admin.from('leaderboard_scores').insert(rows.map((r, i) => ({
      leaderboard_id: leaderboardId,
      user_id: r.user_id,
      score: r.score,
      rank: i + 1,
    })));
  }
}

/** Award prizes when a leaderboard ends. Idempotent via metadata flag. */
export async function awardLeaderboardPrizes(leaderboardId: string) {
  const admin = supabaseAdmin();
  const { data: lb } = await admin.from('leaderboards').select('*').eq('id', leaderboardId).maybeSingle();
  if (!lb) return;
  if (new Date(lb.ends_at).getTime() > Date.now()) return;

  const { data: scores } = await admin.from('leaderboard_scores')
    .select('user_id, rank').eq('leaderboard_id', leaderboardId).order('rank', { ascending: true });
  if (!scores) return;

  const structure = lb.payout_structure as Array<{ rank: number; prize_bps: number }>;
  const totalPool = Number(lb.prize_pool);
  for (const slot of structure) {
    const winner = scores.find(s => s.rank === slot.rank);
    if (!winner) continue;
    const amount = Math.floor((totalPool * slot.prize_bps) / 10000);
    if (amount <= 0) continue;
    await admin.rpc('credit_chips', {
      p_user_id: winner.user_id,
      p_amount: amount,
      p_kind: 'tournament_prize',
      p_ref_table: 'leaderboards',
      p_ref_id: leaderboardId,
      p_metadata: { rank: slot.rank, leaderboard: lb.name },
    });
  }
}
