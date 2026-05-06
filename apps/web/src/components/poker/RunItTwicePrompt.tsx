'use client';

import { useEffect, useState } from 'react';

interface Props {
  visible: boolean;
  decisionSeats: number[];
  mySeat: number | null;
  maxRunCount: 1 | 2 | 3;
  deadline: number;
  onVote: (runCount: 1 | 2 | 3) => void;
}

export function RunItTwicePrompt({ visible, decisionSeats, mySeat, maxRunCount, deadline, onVote }: Props) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  if (!visible || mySeat === null || !decisionSeats.includes(mySeat)) return null;
  const remaining = Math.max(0, deadline - now);
  const pct = Math.max(0, Math.min(100, (remaining / 8000) * 100));

  return (
    <div className="fixed inset-x-0 top-1/3 z-40 mx-auto max-w-md rounded-lg border border-gold-500 bg-black/95 p-6 backdrop-blur">
      <h2 className="font-display text-xl font-bold text-gold-400">Run It Twice?</h2>
      <p className="mt-2 text-sm text-white/70">
        All chips committed. You can run the remaining streets up to {maxRunCount} times — pot splits evenly per board.
      </p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-gold-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button onClick={() => onVote(1)} className="btn btn-ghost">Run once</button>
        {maxRunCount >= 2 && (
          <button onClick={() => onVote(2)} className="btn btn-primary">Run twice</button>
        )}
        {maxRunCount >= 3 && (
          <button onClick={() => onVote(3)} className="btn btn-primary">Run three times</button>
        )}
      </div>
      <p className="mt-2 text-xs text-white/50">
        Lowest vote wins. No vote = run once.
      </p>
    </div>
  );
}
