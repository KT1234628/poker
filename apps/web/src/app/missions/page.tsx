import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { ClaimButton } from './claim-button';

export const dynamic = 'force-dynamic';

export default async function MissionsPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/auth?next=/missions');

  const [{ data: templates }, { data: progress }] = await Promise.all([
    sb.from('mission_templates').select('id, name, description, kind, target, reward_kind, reward_amount, period, display_order').order('display_order', { ascending: true }),
    sb.from('mission_progress').select('template_id, progress, target_at_assign, completed_at, claimed_at').eq('user_id', user.id),
  ]);
  const progByTpl = new Map((progress ?? []).map(p => [p.template_id, p]));

  const groups: Record<string, typeof templates> = { daily: [], weekly: [], monthly: [], seasonal: [], one_off: [] };
  for (const t of templates ?? []) groups[t.period]!.push(t);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Missions</h1>
      <p className="mt-2 text-sm text-white/60">Daily, weekly, and one-off objectives. Complete to earn chips, bonus chips, and tournament tickets.</p>

      {(['daily','weekly','monthly','seasonal','one_off'] as const).map(period => (
        groups[period]!.length === 0 ? null : (
          <section key={period} className="mt-8">
            <h2 className="mb-3 font-display text-xl uppercase text-gold-400">{period.replace('_',' ')}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {groups[period]!.map(m => {
                const p = progByTpl.get(m.id);
                const target = (m.target as { count?: number; hands?: number; days?: number; amount?: number }).count ?? (m.target as { hands?: number }).hands ?? (m.target as { days?: number }).days ?? (m.target as { amount?: number }).amount ?? 1;
                const cur = p?.progress ?? 0;
                const pct = Math.min(100, Math.floor((Number(cur) / target) * 100));
                const completed = !!p?.completed_at;
                const claimed = !!p?.claimed_at;
                return (
                  <div key={m.id} className="rounded-lg border border-white/10 bg-black/30 p-4">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-bold">{m.name}</h3>
                      <span className="font-mono text-sm text-gold-400">+{(Number(m.reward_amount)/1e6).toFixed(0)} {m.reward_kind === 'chips' ? 'USDC' : m.reward_kind}</span>
                    </div>
                    <p className="mt-1 text-sm text-white/70">{m.description}</p>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full bg-gold-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-mono text-white/60">{Number(cur).toLocaleString()} / {target.toLocaleString()}</span>
                      {claimed
                        ? <span className="text-green-400">Claimed ✓</span>
                        : completed
                        ? <ClaimButton templateId={m.id} />
                        : <span className="text-white/40">In progress…</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )
      ))}
    </main>
  );
}
