import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const TIER_ORDER = ['bronze','silver','gold','platinum','diamond','black'] as const;

export default async function VipPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/auth?next=/profile/vip');

  const [{ data: status }, { data: thresholds }, { data: payouts }] = await Promise.all([
    sb.from('vip_status').select('*').eq('user_id', user.id).maybeSingle(),
    sb.from('vip_tier_thresholds').select('*').order('min_points_30d', { ascending: true }),
    sb.from('rakeback_payouts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(10),
  ]);

  const tier = status?.tier ?? 'bronze';
  const tierIdx = TIER_ORDER.indexOf(tier as typeof TIER_ORDER[number]);
  const next = thresholds?.[tierIdx + 1];
  const pct = (status?.next_tier_progress_bps ?? 0) / 100;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">VIP Program</h1>
      <p className="mt-2 text-sm text-white/70">Earn points by paying rake. Higher tiers unlock more rakeback, reload bonuses, and concierge perks.</p>

      <div className="mt-6 rounded-lg border border-white/10 bg-black/40 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase text-white/50">Current tier</p>
            <p className="font-display text-3xl font-bold uppercase">{tier}</p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase text-white/50">Rakeback rate</p>
            <p className="font-mono text-3xl font-bold text-gold-400">{(status?.rakeback_bps ?? 1500) / 100}%</p>
          </div>
        </div>
        {next && (
          <>
            <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-gold-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-white/60">{pct.toFixed(1)}% to {next.tier}</p>
          </>
        )}
      </div>

      <h2 className="mt-10 font-display text-2xl">All tiers</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        {(thresholds ?? []).map(t => {
          const perks = t.perks as { rakeback_pct?: number; reload_bonus_pct?: number; monthly_bonus?: number; personal_manager?: boolean; invite_only?: boolean };
          return (
            <div key={t.tier} className="rounded-md border border-white/10 bg-black/30 p-4" style={{ borderColor: t.display_color }}>
              <h3 className="font-display text-xl font-bold uppercase" style={{ color: t.display_color }}>{t.tier}</h3>
              <p className="text-sm text-white/70">≥ {(Number(t.min_points_30d) / 1e6).toLocaleString()} chips raked / 30d</p>
              <ul className="mt-2 list-inside list-disc text-sm">
                <li>{perks.rakeback_pct ?? 0}% rakeback</li>
                {perks.reload_bonus_pct && <li>{perks.reload_bonus_pct}% reload bonus</li>}
                {perks.monthly_bonus && <li>${(perks.monthly_bonus / 1e6).toFixed(0)} monthly bonus</li>}
                {perks.personal_manager && <li>Personal account manager</li>}
                {perks.invite_only && <li><em>Invite only</em></li>}
              </ul>
            </div>
          );
        })}
      </div>

      <h2 className="mt-10 font-display text-2xl">Recent rakeback payouts</h2>
      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-white/60">
          <tr><th>Period</th><th>Rake paid</th><th>Rate</th><th className="text-right">Payout</th></tr>
        </thead>
        <tbody>
          {(payouts ?? []).length === 0 && <tr><td colSpan={4} className="p-3 text-white/50">No payouts yet.</td></tr>}
          {(payouts ?? []).map(p => (
            <tr key={p.id} className="border-t border-white/5 font-mono">
              <td className="p-2">{new Date(p.period_start).toLocaleDateString()}–{new Date(p.period_end).toLocaleDateString()}</td>
              <td className="p-2">${(Number(p.rake_paid)/1e6).toFixed(2)}</td>
              <td className="p-2">{Number(p.rakeback_bps)/100}%</td>
              <td className="p-2 text-right text-gold-400">+${(Number(p.payout_amount)/1e6).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
