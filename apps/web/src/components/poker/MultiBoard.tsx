'use client';

import { Card } from './Card';

export interface BoardPayout {
  seatIdx: number;
  userId: string | null;
  amount: number;
  rank: number;
  description: string;
}

export function MultiBoard({ boards, boardPayouts, mySeat }: {
  boards: number[][];
  boardPayouts: BoardPayout[][];
  mySeat: number | null;
}) {
  if (boards.length <= 1) return null;
  return (
    <div className="absolute inset-x-0 top-1/2 z-20 mx-auto flex -translate-y-1/2 flex-col items-center gap-3">
      {boards.map((board, i) => {
        const wins = boardPayouts[i] ?? [];
        const myWin = mySeat !== null ? wins.find(w => w.seatIdx === mySeat) : null;
        return (
          <div key={i} className="flex items-center gap-3 rounded-md bg-black/60 px-4 py-2 backdrop-blur">
            <span className="font-display text-xs text-gold-400">Run {i + 1}</span>
            <div className="flex gap-1">
              {board.map((c, ci) => <Card key={ci} index={c} />)}
            </div>
            {myWin && myWin.amount > 0 && (
              <span className="rounded bg-green-600/30 px-2 py-0.5 font-mono text-xs text-green-300">
                +${(myWin.amount / 1e6).toFixed(2)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
