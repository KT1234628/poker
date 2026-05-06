import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { TournamentRegisterButton } from './register-button';

export const dynamic = 'force-dynamic';

export default async function TournamentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: t } = await sb
    .from('tournaments')
    .select('*, blind_structures(*)')
    .eq('id', id)
    .maybeSingle();
  if (!t) redirect('/tournaments');

  const { data: { user } } = await sb.auth.getUser();
  let entered = false;
  if (user) {
    const { data: e } = await sb
      .from('tournament_entries')
      .select('status')
      .eq('tournament_id', id)
      .eq('user_id', user.id)
      .maybeSingle();
    entered = !!e;
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">{t.name}</h1>
      <p className="mt-2 text-white/70">{t.kind === 'mtt' ? 'Multi-table tournament' : 'Sit & Go'} · {t.blind_structures?.name} structure</p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Buy-in" value={`$${(Number(t.buy_in)/1e6).toFixed(0)} + $${(Number(t.fee)/1e6).toFixed(0)}`} />
        <Stat label="Prize pool" value={`$${(Number(t.prize_pool)/1e6).toFixed(0)}`} />
        <Stat label="Players" value={`${t.registered_count}/${t.max_players}`} />
        <Stat label="Status" value={t.status} />
      </div>

      <div className="mt-6">
        <TournamentRegisterButton tournamentId={id} alreadyEntered={entered} buyIn={Number(t.buy_in) + Number(t.fee)} />
      </div>

      <h2 className="mt-10 font-display text-xl font-bold">Blind structure</h2>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-white/60">
          <tr>
            <th>Level</th><th>SB</th><th>BB</th><th>Ante</th>
          </tr>
        </thead>
        <tbody>
          {(t.blind_structures?.levels ?? []).map((l: { level: number; sb: number; bb: number; ante: number }) => (
            <tr key={l.level} className="border-t border-white/5 font-mono">
              <td>{l.level}</td><td>{l.sb}</td><td>{l.bb}</td><td>{l.ante}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-4">
      <p className="text-xs uppercase text-white/50">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold">{value}</p>
    </div>
  );
}
