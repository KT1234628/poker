import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/auth?next=/profile');

  const [{ data: profile }, { data: balance }, { data: limits }, { data: stats }] = await Promise.all([
    sb.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    sb.from('balances').select('*').eq('user_id', user.id).maybeSingle(),
    sb.from('player_limits').select('*').eq('user_id', user.id).maybeSingle(),
    sb.from('hand_results')
      .select('hand_id, winnings.sum()')
      .eq('user_id', user.id)
      .returns<{ hand_id: string; winnings: number }[]>(),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="mb-8 font-display text-4xl font-bold">Profile</h1>

      <section className="mb-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="Username" value={profile?.username ?? '—'} />
        <Stat label="KYC" value={profile?.kyc_status ?? 'none'} />
        <Stat label="Chips" value={`$${(Number(balance?.chips ?? 0) / 1e6).toFixed(2)}`} />
      </section>

      <section className="mb-10 rounded-lg border border-white/10 bg-black/30 p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Responsible gambling</h2>
        <p className="mb-4 text-sm text-white/70">
          Limits help keep play under control. They take effect immediately and can only be relaxed after a 24h cool-off.
        </p>
        <form action="/api/limits" method="post" className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field name="daily_deposit_limit" label="Daily deposit limit (USDC)" defaultValue={limits?.daily_deposit_limit} />
          <Field name="weekly_deposit_limit" label="Weekly deposit limit" defaultValue={limits?.weekly_deposit_limit} />
          <Field name="daily_loss_limit" label="Daily loss limit" defaultValue={limits?.daily_loss_limit} />
          <Field name="session_minutes_limit" label="Session length (minutes)" defaultValue={limits?.session_minutes_limit} />
          <button className="btn btn-primary md:col-span-2">Save limits</button>
        </form>
        <hr className="my-6 border-white/10" />
        <form action="/api/limits/exclude" method="post" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs uppercase text-white/50">Self-exclude until</label>
            <input type="date" name="until" className="mt-1 rounded-md bg-white/5 px-3 py-2 ring-1 ring-white/10" />
          </div>
          <button className="btn btn-danger">Self-exclude</button>
        </form>
      </section>

      <section className="rounded-lg border border-white/10 bg-black/30 p-6">
        <h2 className="mb-4 font-display text-xl font-bold">Stats</h2>
        <p className="text-sm text-white/70">Hands played: <span className="font-mono">{stats?.length ?? 0}</span></p>
        <Link href="/profile/hands" className="text-gold-400 underline">View hand history</Link>
      </section>
    </main>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue?: number | null }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase text-white/50">{label}</span>
      <input
        type="number"
        name={name}
        min={0}
        step={1}
        defaultValue={defaultValue ? Number(defaultValue) / 1e6 : undefined}
        className="mt-1 w-full rounded-md bg-white/5 px-3 py-2 ring-1 ring-white/10"
      />
    </label>
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
