import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LobbyPage() {
  const sb = await supabaseServer();
  const [tablesRes, tourneysRes, balanceRes] = await Promise.all([
    sb.from('tables')
      .select('id, name, kind, max_seats, small_blind, big_blind, ante, min_buyin, max_buyin')
      .eq('status', 'open')
      .eq('is_private', false)
      .order('big_blind', { ascending: true }),
    sb.from('tournaments')
      .select('id, name, kind, buy_in, fee, prize_pool, max_players, status, scheduled_at, registered_count')
      .in('status', ['scheduled', 'registering', 'late_reg', 'running'])
      .order('scheduled_at', { ascending: true })
      .limit(50),
    sb.from('balances').select('chips, locked_chips').maybeSingle(),
  ]);

  const tables = tablesRes.data ?? [];
  const tourneys = tourneysRes.data ?? [];
  const balance = balanceRes.data;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl font-bold">Lobby</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="rounded-md bg-black/40 px-3 py-2 font-mono">
            {balance ? `$${(Number(balance.chips) / 1_000_000).toFixed(2)}` : '$0.00'} <span className="text-white/50">USDC</span>
          </span>
          <Link href="/wallet" className="btn btn-ghost">Wallet</Link>
          <Link href="/profile" className="btn btn-ghost">Profile</Link>
        </div>
      </header>

      <section className="mb-12">
        <h2 className="mb-4 font-display text-2xl">Cash games</h2>
        <div className="overflow-hidden rounded-lg border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-black/40 text-white/60">
              <tr>
                <th className="p-3">Table</th>
                <th className="p-3">Stakes</th>
                <th className="p-3">Buy-in</th>
                <th className="p-3">Seats</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {tables.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-white/50">No tables open right now.</td></tr>
              )}
              {tables.map(t => (
                <tr key={t.id} className="border-t border-white/5 hover:bg-white/5">
                  <td className="p-3 font-medium">{t.name}</td>
                  <td className="p-3">${(Number(t.small_blind)/1e6).toFixed(2)} / ${(Number(t.big_blind)/1e6).toFixed(2)}</td>
                  <td className="p-3">${(Number(t.min_buyin)/1e6).toFixed(0)}-${(Number(t.max_buyin)/1e6).toFixed(0)}</td>
                  <td className="p-3 font-mono">0/{t.max_seats}</td>
                  <td className="p-3 text-right">
                    <Link href={`/table/${t.id}`} className="btn btn-primary">Join</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-4 font-display text-2xl">Tournaments</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tourneys.length === 0 && <p className="text-white/50">No tournaments scheduled.</p>}
          {tourneys.map(t => (
            <Link key={t.id} href={`/tournaments/${t.id}`} className="rounded-lg border border-white/10 bg-black/30 p-5 hover:border-gold-500/40">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="font-display text-lg font-semibold">{t.name}</h3>
                <span className="text-xs uppercase text-gold-400">{t.kind}</span>
              </div>
              <p className="text-sm text-white/70">Buy-in ${(Number(t.buy_in)/1e6).toFixed(0)} + ${(Number(t.fee)/1e6).toFixed(0)}</p>
              <p className="text-sm text-white/70">Prize ${(Number(t.prize_pool)/1e6).toFixed(0)} · {t.registered_count}/{t.max_players}</p>
              <p className="mt-2 font-mono text-xs text-white/50">{t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : 'starting soon'}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
