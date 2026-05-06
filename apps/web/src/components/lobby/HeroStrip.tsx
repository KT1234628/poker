'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

interface HeroData {
  bbjAmount: number;
  nextTournament: { id: string; name: string; scheduledAt: string; prizePool: number; registered: number; max: number } | null;
  pendingMissions: number;
  vipTier: string;
  vipProgress: number;
  vipRakeback: number;
  totalDealsThisWeek: number;        // total chips paid out this week (community proof)
}

export function HeroStrip() {
  const [data, setData] = useState<HeroData | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    void (async () => {
      const sb = supabase();
      const { data: { user } } = await sb.auth.getUser();
      const [bbj, next, missions, vip] = await Promise.all([
        sb.from('bad_beat_jackpots').select('pot_amount').eq('scope', 'global').maybeSingle(),
        sb.from('tournaments')
          .select('id, name, scheduled_at, prize_pool, registered_count, max_players')
          .gt('scheduled_at', new Date().toISOString())
          .in('status', ['scheduled', 'registering'])
          .order('scheduled_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
        user
          ? sb.from('mission_progress')
              .select('*', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .not('completed_at', 'is', null)
              .is('claimed_at', null)
          : { count: 0 },
        user
          ? sb.from('vip_status').select('tier, next_tier_progress_bps, rakeback_bps').eq('user_id', user.id).maybeSingle()
          : { data: null },
      ]);

      setData({
        bbjAmount: Number(bbj.data?.pot_amount ?? 0),
        nextTournament: next.data
          ? {
              id: next.data.id,
              name: next.data.name,
              scheduledAt: next.data.scheduled_at,
              prizePool: Number(next.data.prize_pool),
              registered: next.data.registered_count,
              max: next.data.max_players,
            }
          : null,
        pendingMissions: missions.count ?? 0,
        vipTier: vip.data?.tier ?? 'bronze',
        vipProgress: vip.data?.next_tier_progress_bps ?? 0,
        vipRakeback: vip.data?.rakeback_bps ?? 1500,
        totalDealsThisWeek: 0,
      });

      // Live: subscribe to BBJ updates
      const ch = sb.channel('hero:bbj')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bad_beat_jackpots' }, payload => {
          const n = payload.new as { pot_amount: number };
          setData(prev => prev ? { ...prev, bbjAmount: Number(n.pot_amount) } : prev);
        })
        .subscribe();
      return () => { void sb.removeChannel(ch); };
    })();
  }, []);

  if (!data) return <div className="h-32 animate-pulse rounded-lg bg-white/5" />;

  const remainingMs = data.nextTournament ? Math.max(0, new Date(data.nextTournament.scheduledAt).getTime() - now) : 0;

  return (
    <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-4">
      {/* BBJ ticker */}
      <div className="overflow-hidden rounded-xl border border-fuchsia-500/40 bg-gradient-to-br from-fuchsia-950/80 to-black/80 p-5">
        <p className="text-[11px] uppercase tracking-widest text-fuchsia-300">Bad Beat Jackpot</p>
        <p className="mt-1 font-display text-3xl font-bold text-fuchsia-100">${(data.bbjAmount / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
        <p className="mt-1 text-[11px] text-fuchsia-200/70">Lose with quad 8s+ and split the jackpot.</p>
      </div>

      {/* Next tournament countdown */}
      {data.nextTournament ? (
        <Link href={`/tournaments/${data.nextTournament.id}`} className="block overflow-hidden rounded-xl border border-gold-500/40 bg-gradient-to-br from-gold-900/40 to-black/80 p-5 hover:border-gold-400">
          <p className="text-[11px] uppercase tracking-widest text-gold-300">Next event</p>
          <p className="mt-1 font-display text-lg font-bold">{data.nextTournament.name}</p>
          <p className="mt-1 font-mono text-2xl text-gold-100">{formatCountdown(remainingMs)}</p>
          <p className="mt-1 text-[11px] text-gold-200/70">
            ${(data.nextTournament.prizePool / 1e6).toFixed(0)} prize · {data.nextTournament.registered}/{data.nextTournament.max}
          </p>
        </Link>
      ) : (
        <div className="rounded-xl border border-white/10 bg-black/30 p-5">
          <p className="text-[11px] uppercase tracking-widest text-white/40">Next event</p>
          <p className="mt-1 text-white/70">No tournaments scheduled.</p>
        </div>
      )}

      {/* My VIP progress */}
      <Link href="/profile/vip" className="block rounded-xl border border-white/10 bg-black/30 p-5 hover:border-gold-500/40">
        <p className="text-[11px] uppercase tracking-widest text-white/40">My VIP</p>
        <p className="mt-1 font-display text-lg font-bold uppercase">{data.vipTier}</p>
        <p className="font-mono text-2xl text-gold-300">{(data.vipRakeback / 100).toFixed(0)}% rakeback</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-gold-500" style={{ width: `${(data.vipProgress / 100).toFixed(1)}%` }} />
        </div>
      </Link>

      {/* Missions */}
      <Link href="/missions" className={`hidden rounded-xl border bg-black/30 p-5 lg:block ${data.pendingMissions > 0 ? 'border-gold-500/60 hover:border-gold-400' : 'border-white/10 hover:border-white/20'}`}>
        <p className="text-[11px] uppercase tracking-widest text-white/40">Missions</p>
        {data.pendingMissions > 0 ? (
          <>
            <p className="mt-1 font-display text-lg font-bold">{data.pendingMissions} ready to claim</p>
            <p className="mt-1 text-sm text-gold-300">Tap to grab your rewards →</p>
          </>
        ) : (
          <>
            <p className="mt-1 font-display text-lg font-bold">Daily missions</p>
            <p className="mt-1 text-sm text-white/60">Earn chips for everyday play.</p>
          </>
        )}
      </Link>
    </section>
  );
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'starting now';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d ${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${ss.toString().padStart(2,'0')}`;
  return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${ss.toString().padStart(2,'0')}`;
}
