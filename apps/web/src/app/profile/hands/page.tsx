import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_COLORS = ['text-white', 'text-red-400', 'text-red-400', 'text-white'];
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];

function fmtCard(idx: number) {
  const r = idx >> 2, s = idx & 3;
  return { rank: RANKS[r]!, suit: SUITS[s]!, color: SUIT_COLORS[s]! };
}

export default async function HandHistoryPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/auth?next=/profile/hands');

  const { data: hands } = await sb
    .from('hand_results')
    .select(`
      hand_id,
      seat_idx,
      winnings,
      hand_rank,
      hands(id, table_id, hand_number, board_cards, started_at, ended_at, pot, seed_commitment, seed_reveal),
      hand_actions:hand_actions!hand_actions_hand_id_fkey(seq, seat_idx, action, amount, phase, pot_after)
    `)
    .eq('user_id', user.id)
    .order('hand_id', { ascending: false })
    .limit(50);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Hand history</h1>
      <p className="mt-2 text-sm text-white/70">
        Every hand you played is verifiable from its seed commitment. Click a hand to see the full action log.
      </p>

      <div className="mt-8 space-y-2">
        {(hands ?? []).map((row: any) => {
          const h = row.hands;
          if (!h) return null;
          const winLabel = row.winnings > 0
            ? <span className="text-green-400">+${(Number(row.winnings) / 1e6).toFixed(2)}</span>
            : <span className="text-white/50">—</span>;
          return (
            <details key={row.hand_id} className="rounded-lg border border-white/10 bg-black/30 p-3 open:bg-black/40">
              <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-white/40">#{h.hand_number}</span>
                  <span>{new Date(h.started_at).toLocaleString()}</span>
                  <span className="font-mono text-xs">pot ${(Number(h.pot)/1e6).toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    {(h.board_cards ?? []).map((c: number, i: number) => {
                      const f = fmtCard(c);
                      return (
                        <span key={i} className={`inline-block w-7 rounded bg-white px-1 py-0.5 text-center font-mono text-[10px] font-bold ${f.color === 'text-red-400' ? 'text-red-600' : 'text-black'}`}>
                          {f.rank}{f.suit}
                        </span>
                      );
                    })}
                  </div>
                  <span className="font-mono text-sm font-bold">{winLabel}</span>
                </div>
              </summary>
              <div className="mt-3 border-t border-white/5 pt-3 text-xs">
                <div className="mb-2 text-white/60">
                  <span className="font-mono">commitment:</span> <span className="font-mono">{h.seed_commitment.slice(0, 16)}…</span>
                  {h.seed_reveal && <> · <span className="font-mono">seed:</span> <span className="font-mono">{h.seed_reveal.slice(0, 16)}…</span></>}
                </div>
                <table className="w-full text-left">
                  <thead className="text-white/50">
                    <tr><th className="p-1">Phase</th><th className="p-1">Seat</th><th className="p-1">Action</th><th className="p-1 text-right">Amount</th><th className="p-1 text-right">Pot</th></tr>
                  </thead>
                  <tbody>
                    {(row.hand_actions ?? []).sort((a: any, b: any) => a.seq - b.seq).map((a: any) => (
                      <tr key={a.seq} className="border-t border-white/5 font-mono">
                        <td className="p-1 uppercase text-white/50">{a.phase}</td>
                        <td className="p-1">s{a.seat_idx}</td>
                        <td className="p-1">{a.action}</td>
                        <td className="p-1 text-right">{a.amount > 0 ? `$${(a.amount/1e6).toFixed(2)}` : '—'}</td>
                        <td className="p-1 text-right text-white/60">${(a.pot_after/1e6).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
        {(hands ?? []).length === 0 && (
          <p className="text-center text-white/50">You haven&apos;t played any hands yet.</p>
        )}
      </div>

      <div className="mt-8">
        <Link href="/profile" className="btn btn-ghost">← Back to profile</Link>
      </div>
    </main>
  );
}
