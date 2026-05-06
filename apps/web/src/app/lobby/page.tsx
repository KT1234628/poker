import Link from 'next/link';
import { HeroStrip } from '@/components/lobby/HeroStrip';
import { LobbyView } from '@/components/lobby/LobbyView';
import { SideRail } from '@/components/lobby/SideRail';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LobbyPage() {
  const sb = await supabaseServer();
  const { data: tourneys } = await sb.from('tournaments')
    .select('id, name, kind, format, buy_in, fee, prize_pool, max_players, status, scheduled_at, registered_count, is_freeroll, bounty_amount')
    .in('status', ['scheduled', 'registering', 'late_reg', 'running'])
    .order('scheduled_at', { ascending: true })
    .limit(20);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
      <HeroStrip />

      <section className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_18rem]">
        <div>
          <header className="mb-4 flex items-baseline justify-between">
            <h1 className="font-display text-2xl font-bold md:text-3xl">Cash games</h1>
            <Link href="/multi-table" className="text-xs text-white/60 underline-offset-2 hover:underline">Multi-table view →</Link>
          </header>
          <LobbyView />

          <h2 className="mb-4 mt-10 font-display text-2xl font-bold">Tournaments</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(!tourneys || tourneys.length === 0) && <p className="text-white/50">No tournaments scheduled.</p>}
            {(tourneys ?? []).map(t => (
              <Link key={t.id} href={`/tournaments/${t.id}`} className="rounded-lg border border-white/10 bg-black/30 p-5 hover:border-gold-500/40">
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-lg font-semibold">{t.name}</h3>
                  <div className="flex flex-wrap gap-1 text-[10px] uppercase">
                    <span className="rounded bg-white/10 px-1 text-gold-400">{t.kind}</span>
                    {t.format !== 'freezeout' && <span className="rounded bg-fuchsia-500/30 px-1">{t.format.replace('_', ' ')}</span>}
                    {t.is_freeroll && <span className="rounded bg-green-500/30 px-1">free</span>}
                    {Number(t.bounty_amount ?? 0) > 0 && <span className="rounded bg-red-500/30 px-1">KO</span>}
                  </div>
                </div>
                <p className="text-sm text-white/70">
                  {t.is_freeroll ? 'Freeroll' : `Buy-in $${(Number(t.buy_in)/1e6).toFixed(0)} + $${(Number(t.fee)/1e6).toFixed(0)}`}
                </p>
                <p className="text-sm text-white/70">Prize ${(Number(t.prize_pool)/1e6).toFixed(0)} · {t.registered_count}/{t.max_players}</p>
                <p className="mt-2 font-mono text-xs text-white/50">{t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : 'starting soon'}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="hidden lg:block">
          <SideRail />
        </div>
      </section>
    </main>
  );
}
