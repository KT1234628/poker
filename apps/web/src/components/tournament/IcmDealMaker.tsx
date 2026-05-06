'use client';

import { useState } from 'react';
import { icm } from '@stacks/tournament-engine';

interface Player { userId: string; username: string; stack: number }

export function IcmDealMaker({
  remainingPlayers,
  remainingPrizes,
  onProposeDeal,
  myUserId,
}: {
  remainingPlayers: Player[];
  remainingPrizes: number[];
  onProposeDeal: (deal: { userId: string; amount: number }[]) => void;
  myUserId: string;
}) {
  const [proposed, setProposed] = useState<{ userId: string; amount: number }[] | null>(null);

  function compute() {
    const ev = icm({
      stacks: remainingPlayers.map(p => p.stack),
      prizes: remainingPrizes,
    });
    const deal = remainingPlayers.map((p, i) => ({ userId: p.userId, amount: Math.floor(ev[i]!) }));
    setProposed(deal);
  }

  return (
    <div className="rounded-lg border border-gold-500/40 bg-gradient-to-br from-gold-950/60 to-black/80 p-4">
      <h3 className="font-display text-base font-bold text-gold-300">Final-table deal</h3>
      <p className="mt-1 text-xs text-white/70">
        Run an ICM-fair deal calculation. Each player gets a chip-EV-weighted share of the remaining prize pool.
        Requires unanimous accept.
      </p>
      {!proposed && (
        <button onClick={compute} className="mt-3 btn btn-primary">Compute ICM proposal</button>
      )}
      {proposed && (
        <>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-white/60"><tr><th>Player</th><th className="text-right">Cash</th></tr></thead>
            <tbody>
              {proposed.map(p => (
                <tr key={p.userId} className={`border-t border-white/5 ${p.userId === myUserId ? 'bg-gold-500/10' : ''}`}>
                  <td className="p-1 font-mono">@{remainingPlayers.find(x => x.userId === p.userId)?.username ?? p.userId.slice(0,8)}</td>
                  <td className="p-1 text-right font-mono text-gold-300">${(p.amount/1e6).toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 flex gap-2">
            <button onClick={() => onProposeDeal(proposed)} className="btn btn-primary">Propose to table</button>
            <button onClick={() => setProposed(null)} className="btn btn-ghost">Recompute</button>
          </div>
        </>
      )}
    </div>
  );
}
