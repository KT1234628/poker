'use client';

import clsx from 'clsx';

const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const SUITS = ['♠','♥','♦','♣'];
const SUIT_COLORS = ['text-black', 'text-red-600', 'text-red-600', 'text-black'];

export function Card({ index, hidden, animated, className }: { index?: number; hidden?: boolean; animated?: boolean; className?: string }) {
  if (hidden || index === undefined) {
    return <div className={clsx('card-back', animated && 'animate-deal', className)} />;
  }
  const rank = RANKS[index >> 2]!;
  const suitIdx = index & 3;
  const suit = SUITS[suitIdx]!;
  return (
    <div className={clsx('card flex flex-col items-center justify-center', animated && 'animate-deal', className)}>
      <span className={clsx('text-base font-bold sm:text-2xl', SUIT_COLORS[suitIdx])}>{rank}</span>
      <span className={clsx('text-xl sm:text-3xl', SUIT_COLORS[suitIdx])}>{suit}</span>
    </div>
  );
}
