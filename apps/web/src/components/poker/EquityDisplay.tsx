'use client';

import { useEffect, useState } from 'react';
import { equity, type Card } from '@stacks/poker-engine';

interface Props {
  myHole: [Card, Card] | null;
  opponentHoles: Array<[Card, Card]>;          // populated only at showdown
  board: Card[];
  enabledPreShowdown: boolean;
  isAtShowdown: boolean;
  enabledAtShowdown: boolean;
}

export function EquityDisplay({ myHole, opponentHoles, board, enabledPreShowdown, isAtShowdown, enabledAtShowdown }: Props) {
  const [eq, setEq] = useState<number | null>(null);
  const enabled = isAtShowdown ? enabledAtShowdown : enabledPreShowdown;

  useEffect(() => {
    if (!enabled || !myHole) { setEq(null); return; }

    // Pre-showdown vs random opponents (rough but useful "you have ~63% equity" feel)
    if (!isAtShowdown) {
      // 1 random opponent — fast
      const opp = randomHand([myHole[0], myHole[1], ...board]);
      if (!opp) { setEq(null); return; }
      const r = equity({ hands: [myHole, opp], board, trials: 8000 });
      setEq(r.equity[0] ?? 0);
      return;
    }
    // Showdown: actual hands
    if (opponentHoles.length === 0) { setEq(null); return; }
    const r = equity({ hands: [myHole, ...opponentHoles], board, trials: 5000 });
    setEq(r.equity[0] ?? 0);
  }, [myHole?.[0], myHole?.[1], board.length, isAtShowdown, enabled, opponentHoles.length]);

  if (!enabled || eq === null) return null;
  const pct = Math.round(eq * 100);
  const color = pct >= 65 ? 'text-green-400' : pct >= 45 ? 'text-yellow-300' : 'text-red-400';

  return (
    <div className="absolute right-3 top-14 z-20 rounded-md bg-black/70 px-3 py-1.5 text-center text-xs backdrop-blur">
      <p className="text-[10px] uppercase text-white/50">Your equity</p>
      <p className={`font-mono text-xl font-bold ${color}`}>{pct}%</p>
    </div>
  );
}

function randomHand(dead: number[]): [number, number] | null {
  const deadSet = new Set(dead);
  const live: number[] = [];
  for (let i = 0; i < 52; i++) if (!deadSet.has(i)) live.push(i);
  if (live.length < 2) return null;
  const a = Math.floor(Math.random() * live.length);
  let b: number;
  do { b = Math.floor(Math.random() * live.length); } while (b === a);
  return [live[a]!, live[b]!];
}
