import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LeaderboardDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: lb } = await sb.from('leaderboards').select('*').eq('id', id).maybeSingle();
  if (!lb) redirect('/leaderboards');

  const { data: scores } = await sb.from('leaderboard_scores')
    .select('user_id, score, rank, profiles(username)')
    .eq('leaderboard_id', id)
    .order('rank', { ascending: true })
    .limit(100);

  const structure = lb.payout_structure as Array<{ rank: number; prize_bps: number }>;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">{lb.name}</h1>
      <p className="mt-1 text-white/70">{lb.description}</p>
      <p className="mt-2 font-mono text-sm">
        Prize pool ${(Number(lb.prize_pool)/1e6).toFixed(0)} · Ends {new Date(lb.ends_at).toLocaleString()}
      </p>

      <h2 className="mt-8 font-display text-xl">Ranking</h2>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-white/60"><tr><th>#</th><th>Player</th><th>Score</th><th className="text-right">Prize</th></tr></thead>
        <tbody>
          {(scores ?? []).map((s, i) => {
            const slot = structure.find(p => p.rank === (s.rank ?? i + 1));
            const prize = slot ? Math.floor((Number(lb.prize_pool) * slot.prize_bps) / 10000) : 0;
            return (
              <tr key={s.user_id} className="border-t border-white/5">
                <td className="p-2 font-mono">{s.rank ?? i + 1}</td>
                <td className="p-2">{username(s) ?? s.user_id.slice(0, 8)}</td>
                <td className="p-2 font-mono">{Number(s.score).toLocaleString()}</td>
                <td className="p-2 text-right font-mono text-gold-400">{prize > 0 ? `$${(prize/1e6).toFixed(0)}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}

// Supabase joined `profiles(username)` may return either a single object or an
// array depending on relation cardinality inference. Normalize both shapes.
function username(row: { profiles?: { username?: string } | { username?: string }[] | null }): string | null {
  const p = row.profiles;
  if (!p) return null;
  if (Array.isArray(p)) return p[0]?.username ?? null;
  return p.username ?? null;
}
