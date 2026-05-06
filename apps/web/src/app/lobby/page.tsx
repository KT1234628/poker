import Link from 'next/link';
import { LobbyView } from '@/components/lobby/LobbyView';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LobbyPage() {
  const sb = await supabaseServer();
  const [tourneysRes, balanceRes, vipRes] = await Promise.all([
    sb.from('tournaments')
      .select('id, name, kind, format, buy_in, fee, prize_pool, max_players, status, scheduled_at, registered_count, is_freeroll, bounty_amount')
      .in('status', ['scheduled', 'registering', 'late_reg', 'running'])
      .order('scheduled_at', { ascending: true })
      .limit(50),
    sb.from('balances').select('chips, locked_chips').maybeSingle(),
    sb.from('vip_status').select('tier, points_30d, rakeback_bps, next_tier_progress_bps').maybeSingle(),
  ]);

  const tourneys = tourneysRes.data ?? [];
  const balance = balanceRes.data;
  const vip = vipRes.data;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl font-bold">Lobby</h1>
        <div className="flex items-center gap-3 text-sm">
          {vip && (
            <Link href="/profile/vip" className="rounded-md bg-gradient-to-br from-gold-600 to-gold-400 px-3 py-2 font-bold uppercase text-black">
              {vip.tier} · {vip.rakeback_bps / 100}% rakeback
            </Link>
          )}
          <span className="rounded-md bg-black/40 px-3 py-2 font-mono">
            {balance ? `$${(Number(balance.chips) / 1_000_000).toFixed(2)}` : '$0.00'} <span className="text-white/50">USDC</span>
          </span>
          <Link href="/wallet" className="btn btn-ghost">Wallet</Link>
          <Link href="/profile" className="btn btn-ghost">Profile</Link>
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2 text-sm">
        <Link href="/lobby" className="btn btn-primary">Tables</Link>
        <Link href="/tournaments" className="btn btn-ghost">Tournaments</Link>
        <Link href="/missions" className="btn btn-ghost">Missions</Link>
        <Link href="/leaderboards" className="btn btn-ghost">Leaderboards</Link>
        <Link href="/friends" className="btn btn-ghost">Friends</Link>
        <Link href="/profile/vip" className="btn btn-ghost">VIP</Link>
      </nav>

      <LobbyView />

      <section className="mt-12">
        <h2 className="mb-4 font-display text-2xl">Tournaments</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {tourneys.length === 0 && <p className="text-white/50">No tournaments scheduled.</p>}
          {tourneys.map(t => (
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
      </section>
    </main>
  );
}
