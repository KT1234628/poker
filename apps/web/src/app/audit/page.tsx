import Link from 'next/link';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

export default async function AuditPage() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const r = await fetch(`${base}/api/audit/totals`, { next: { revalidate: 30 } }).then(x => x.json()).catch(() => null);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Solvency audit</h1>
      <p className="mt-2 max-w-2xl text-white/70">
        Anyone — players, regulators, or curious bystanders — can verify that every credited chip is backed by USDC in the on-chain vault.
        The vault address is{' '}
        <code className="rounded bg-black/40 px-2 py-0.5 font-mono text-sm">
          {process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID}
        </code>.
      </p>

      <div className="my-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Stat label="On-chain vault USDC" value={`$${(r?.vault_onchain_balance ?? 0) / 1e6}`} />
        <Stat label="Total credited chips" value={`$${(r?.vault_total_user_balance ?? 0) / 1e6}`} />
        <Stat
          label="Status"
          value={r?.solvent ? '✓ solvent' : '✗ insolvent'}
          valueClass={r?.solvent ? 'text-green-400' : 'text-red-400'}
        />
      </div>

      <p className="text-sm text-white/60">
        Verified at <span className="font-mono">{r?.timestamp ?? '—'}</span>.
        Stacks Poker maintains 1:1 backing between credited chips and on-chain vault USDC.
        If this page ever shows insolvent, withdrawals must take precedence over new deposits — file a complaint with the operator and your jurisdiction's regulator.
      </p>

      <div className="mt-8 flex gap-4">
        <Link href="/" className="btn btn-ghost">Home</Link>
        <a href={`https://explorer.solana.com/address/${process.env.NEXT_PUBLIC_VAULT_PROGRAM_ID}`} target="_blank" className="btn btn-ghost">
          View on Solana Explorer
        </a>
      </div>
    </main>
  );
}

function Stat({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-5">
      <p className="text-xs uppercase text-white/50">{label}</p>
      <p className={`mt-2 font-mono text-3xl font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}
