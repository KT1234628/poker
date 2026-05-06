import Link from 'next/link';

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center gap-12 px-6 py-20 text-center">
      <div className="space-y-4">
        <p className="font-mono text-xs tracking-widest text-gold-400">PROVABLY FAIR · ON-CHAIN CUSTODY · WORLDWIDE TABLES</p>
        <h1 className="font-display text-5xl font-bold leading-tight md:text-7xl">
          The poker room <span className="text-gold-400">you can audit</span>.
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-white/80">
          Texas Hold&apos;em with USDC custody secured on Solana. Voice and face cam at every seat. Cash games up to 10 handed, scheduled tournaments running 24/7.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <Link href="/lobby" className="btn btn-primary">Play now</Link>
        <Link href="/tournaments" className="btn btn-ghost">Tournament schedule</Link>
        <Link href="/audit" className="btn btn-ghost">View vault audit</Link>
      </div>

      <section className="grid w-full grid-cols-1 gap-6 pt-12 md:grid-cols-3">
        <Feature
          title="Provably fair shuffles"
          body="Every hand publishes a SHA-256 commitment before dealing. The seed is revealed at showdown — anyone can re-derive the deck and verify."
        />
        <Feature
          title="On-chain custody"
          body="Deposits go straight into the program-owned vault on Solana. Withdrawals require dual signatures (you + the oracle). The vault total is publicly verifiable against user balances."
        />
        <Feature
          title="Indestructible voice"
          body="LiveKit SFU at every table with TURN fallback, simulcast, automatic reconnection, and per-seat face cam. Plays through Wi-Fi drops and bad networks."
        />
      </section>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-6 text-left">
      <h3 className="font-display text-xl font-bold text-gold-400">{title}</h3>
      <p className="mt-2 text-sm text-white/75">{body}</p>
    </div>
  );
}
