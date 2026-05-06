import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function TournamentsPage() {
  const sb = await supabaseServer();
  const { data: list } = await sb
    .from('tournaments')
    .select('id, name, kind, buy_in, fee, prize_pool, registered_count, max_players, scheduled_at, status')
    .order('scheduled_at', { ascending: true });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="mb-8 font-display text-4xl font-bold">Tournaments</h1>
      <div className="overflow-hidden rounded-lg border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-black/40 text-white/60">
            <tr>
              <th className="p-3">Tournament</th>
              <th className="p-3">Format</th>
              <th className="p-3">Buy-in</th>
              <th className="p-3">Prize</th>
              <th className="p-3">Players</th>
              <th className="p-3">Starts</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {(list ?? []).map(t => (
              <tr key={t.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="p-3 font-medium">{t.name}</td>
                <td className="p-3 uppercase text-gold-400">{t.kind}</td>
                <td className="p-3 font-mono">${(Number(t.buy_in) / 1e6).toFixed(0)}+${(Number(t.fee) / 1e6).toFixed(0)}</td>
                <td className="p-3 font-mono">${(Number(t.prize_pool) / 1e6).toFixed(0)}</td>
                <td className="p-3">{t.registered_count}/{t.max_players}</td>
                <td className="p-3 text-white/70">{t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : '—'}</td>
                <td className="p-3 text-right">
                  <Link href={`/tournaments/${t.id}`} className="btn btn-primary">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
