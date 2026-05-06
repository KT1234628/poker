import { redirect } from 'next/navigation';
import { TournamentDashboard } from '@/components/tournament/TournamentDashboard';
import { supabaseServer } from '@/lib/supabase/server';
import { TournamentRegisterButton } from './register-button';

export const dynamic = 'force-dynamic';

export default async function TournamentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ embed?: string }> }) {
  const { id } = await params;
  const { embed } = await searchParams;
  const sb = await supabaseServer();
  const { data: t } = await sb
    .from('tournaments')
    .select('*, blind_structures(*)')
    .eq('id', id)
    .maybeSingle();
  if (!t) redirect('/tournaments');

  const { data: { user } } = await sb.auth.getUser();
  let myEntry: { status: string; stack: number; bounty_balance: number; position: number | null } | null = null;
  if (user) {
    const { data: e } = await sb
      .from('tournament_entries')
      .select('status, stack, bounty_balance, position')
      .eq('tournament_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    myEntry = e ?? null;
  }

  const lateRegOpen = ['scheduled','registering','late_reg'].includes(t.status);
  const reEntryAllowed = t.allow_re_entry && myEntry?.status === 'busted' && t.current_level <= (t.re_entry_until_level || 999);
  const buyIn = Number(t.buy_in) + Number(t.fee);

  // Embedded mode (multi-tabling iframe / table side panel) shows just the dashboard
  if (embed) {
    return (
      <div className="p-3">
        <TournamentDashboard tournamentId={id} initial={{ registeredCount: t.registered_count, prizePool: Number(t.prize_pool), currentLevel: t.current_level }} />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="flex flex-wrap gap-1.5 text-[10px] font-bold uppercase">
            <span className="rounded bg-white/10 px-2 py-0.5 text-gold-400">{t.kind}</span>
            {t.format !== 'freezeout' && <span className="rounded bg-fuchsia-500/30 px-2 py-0.5">{t.format.replace('_', ' ')}</span>}
            {t.is_freeroll && <span className="rounded bg-green-500/30 px-2 py-0.5">freeroll</span>}
            {Number(t.bounty_amount ?? 0) > 0 && <span className="rounded bg-red-500/30 px-2 py-0.5">${(Number(t.bounty_amount)/1e6).toFixed(0)} bounty</span>}
            {t.synchronized_start && <span className="rounded bg-blue-500/30 px-2 py-0.5">sync start</span>}
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold md:text-4xl">{t.name}</h1>
          <p className="mt-1 text-sm text-white/70">{t.blind_structures?.name} structure · {t.starting_stack?.toLocaleString()} starting stack</p>
        </div>

        <div className="text-right">
          {myEntry && (
            <p className="text-xs uppercase text-white/40">Your status</p>
          )}
          {myEntry?.status === 'playing' && (
            <p className="font-display text-2xl font-bold text-green-400">In · {myEntry.stack.toLocaleString()} chips</p>
          )}
          {myEntry?.status === 'registered' && (
            <p className="font-display text-2xl font-bold text-blue-400">Registered</p>
          )}
          {myEntry?.status === 'busted' && (
            <p className="font-display text-2xl font-bold text-red-400">Busted #{myEntry.position}</p>
          )}
          {myEntry?.status === 'paid' && (
            <p className="font-display text-2xl font-bold text-gold-400">Paid #{myEntry.position}</p>
          )}
        </div>
      </header>

      <div className="mt-6">
        <TournamentDashboard
          tournamentId={id}
          initial={{
            registeredCount: t.registered_count,
            prizePool: Number(t.prize_pool),
            currentLevel: t.current_level,
            activeCount: t.active_count,
          }}
        />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {!myEntry && lateRegOpen && (
          <TournamentRegisterButton tournamentId={id} alreadyEntered={false} buyIn={buyIn} />
        )}
        {reEntryAllowed && (
          <TournamentRegisterButton tournamentId={id} alreadyEntered={false} buyIn={buyIn} />
        )}
        {myEntry?.status === 'registered' && (
          <span className="rounded-md border border-blue-500/40 bg-blue-950/40 px-3 py-2 text-sm">✓ You're registered. Tournament starts {t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : 'soon'}.</span>
        )}
        {myEntry?.status === 'playing' && (
          <a href={`/table/${myEntry?.position ? '' : ''}`} className="btn btn-primary">Go to my table</a>
        )}
        {Number(t.bounty_amount ?? 0) > 0 && myEntry && (
          <span className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-sm">
            Your head bounty: <span className="font-mono font-bold">${(Number(myEntry.bounty_balance)/1e6).toFixed(2)}</span>
          </span>
        )}
      </div>

      <section className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h2 className="font-display text-xl font-bold">Blind structure</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-white/60">
              <tr><th>Level</th><th>SB</th><th>BB</th><th>Ante</th></tr>
            </thead>
            <tbody>
              {(t.blind_structures?.levels ?? []).map((l: { level: number; sb: number; bb: number; ante: number }) => (
                <tr key={l.level} className={`border-t border-white/5 font-mono ${l.level === t.current_level ? 'bg-gold-500/10' : ''}`}>
                  <td className="p-1">{l.level}</td><td className="p-1">{l.sb}</td><td className="p-1">{l.bb}</td><td className="p-1">{l.ante}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h2 className="font-display text-xl font-bold">Pay table</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-white/60">
              <tr><th>Place</th><th className="text-right">Prize</th></tr>
            </thead>
            <tbody>
              {((t.payout_structure ?? []) as Array<{ place: number; pctBps: number }>).map(p => (
                <tr key={p.place} className="border-t border-white/5 font-mono">
                  <td className="p-1">#{p.place}</td>
                  <td className="p-1 text-right text-gold-400">${(Math.floor(Number(t.prize_pool) * p.pctBps / 10000) / 1e6).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
