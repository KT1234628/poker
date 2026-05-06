'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

interface TickerData {
  registeredCount: number;
  activeCount: number;
  averageStack: number;
  currentLevel: number;
  blindLevel: { sb: number; bb: number; ante: number };
  secondsLeftInLevel: number;
  inBreak: boolean;
  prizePool: number;
}

export function TournamentDashboard({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial?: Partial<TickerData>;
}) {
  const [data, setData] = useState<Partial<TickerData>>(initial ?? {});
  const [recentBounties, setRecentBounties] = useState<Array<{ ko: string; by: string; amount: number; mystery?: boolean }>>([]);

  useEffect(() => {
    const sb = supabase();
    const channel = sb.channel(`tournament:${tournamentId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'tournaments',
        filter: `id=eq.${tournamentId}`,
      }, payload => {
        const n = payload.new as { registered_count: number; active_count: number; average_chip_stack: number; current_level: number; prize_pool: number };
        setData(d => ({ ...d,
          registeredCount: n.registered_count,
          activeCount: n.active_count,
          averageStack: Number(n.average_chip_stack ?? 0),
          currentLevel: n.current_level,
          prizePool: Number(n.prize_pool),
        }));
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'bounty_payouts',
        filter: `tournament_id=eq.${tournamentId}`,
      }, payload => {
        const n = payload.new as { ko_user_id: string; ko_by_user_id: string; bounty_amount: number; is_mystery: boolean };
        setRecentBounties(b => [
          { ko: n.ko_user_id, by: n.ko_by_user_id, amount: Number(n.bounty_amount), mystery: n.is_mystery },
          ...b.slice(0, 9),
        ]);
      })
      .subscribe();

    return () => { void sb.removeChannel(channel); };
  }, [tournamentId]);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Stat label="Registered" value={`${data.registeredCount ?? 0}`} />
      <Stat label="Players left" value={`${data.activeCount ?? 0}`} />
      <Stat label="Prize pool" value={`$${((data.prizePool ?? 0) / 1e6).toFixed(0)}`} />
      <Stat label="Level" value={`${data.currentLevel ?? 1}`} />
      <Stat label="Avg stack" value={(data.averageStack ?? 0).toLocaleString()} />
      <Stat
        label={data.inBreak ? 'Break ends in' : 'Level ends in'}
        value={data.secondsLeftInLevel ? formatSeconds(data.secondsLeftInLevel) : '—'}
      />

      {recentBounties.length > 0 && (
        <div className="rounded-md border border-white/10 bg-black/30 p-4 md:col-span-3">
          <h3 className="mb-2 text-xs uppercase text-white/50">Recent knockouts</h3>
          <ul className="space-y-1 text-sm">
            {recentBounties.map((b, i) => (
              <li key={i}>
                <span className="font-mono text-white/70">{b.by.slice(0, 6)}</span>{' '}
                eliminated{' '}
                <span className="font-mono text-white/70">{b.ko.slice(0, 6)}</span>{' '}
                <span className={b.mystery ? 'text-fuchsia-400' : 'text-gold-400'}>
                  +${(b.amount / 1e6).toFixed(2)}{b.mystery ? ' 🎁' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-4">
      <p className="text-xs uppercase text-white/50">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold">{value}</p>
    </div>
  );
}

function formatSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${ss.toString().padStart(2, '0')}`;
}
