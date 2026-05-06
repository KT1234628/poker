import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LeaderboardsPage() {
  const sb = await supabaseServer();
  const { data: lbs } = await sb.from('leaderboards')
    .select('*')
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString())
    .eq('is_published', true);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Leaderboards</h1>
      {(!lbs || lbs.length === 0) && (
        <p className="mt-6 text-white/60">No active leaderboards. Check back later.</p>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {(lbs ?? []).map(lb => (
          <Link key={lb.id} href={`/leaderboards/${lb.id}`} className="block rounded-lg border border-white/10 bg-black/30 p-5 hover:border-gold-500/40">
            <h2 className="font-display text-xl font-bold">{lb.name}</h2>
            <p className="mt-1 text-sm text-white/70">{lb.description}</p>
            <p className="mt-2 font-mono text-xs text-white/50">
              Metric: {lb.metric.replace('_', ' ')} · Prize ${(Number(lb.prize_pool)/1e6).toFixed(0)}
            </p>
            <p className="mt-1 text-xs text-white/40">
              Ends {new Date(lb.ends_at).toLocaleString()}
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
