// Texas Hold'em hand evaluator.
// Given 5..7 cards, return the best 5-card hand classified as:
//   9 = straight flush, 8 = quads, 7 = full house, 6 = flush, 5 = straight,
//   4 = trips, 3 = two pair, 2 = pair, 1 = high card.
//
// We pack the result into a single bigint so hands compare with `<`/`>`:
//   value = (rank << 60) | (kicker1 << 48) | (kicker2 << 36) | ... up to 5 kickers
// (each kicker uses 12 bits, plenty for rank values 0..12).

import { rankOf, suitOf, type Card } from './cards.js';

export interface HandValue {
  rank: number;          // 1..9
  rankName: string;      // 'flush', 'two_pair', etc.
  best5: Card[];         // the 5 cards making up the hand
  value: bigint;         // packed comparable value
  description: string;   // 'Aces full of Kings'
}

const RANK_NAMES = [
  'high_card',
  'pair',
  'two_pair',
  'three_of_a_kind',
  'straight',
  'flush',
  'full_house',
  'four_of_a_kind',
  'straight_flush',
];

const RANK_DESC = ['2','3','4','5','6','7','8','9','10','Jack','Queen','King','Ace'];

function pack(rank: number, kickers: number[]): bigint {
  let v = BigInt(rank) << 60n;
  for (let i = 0; i < kickers.length && i < 5; i++) {
    v |= BigInt(kickers[i]!) << BigInt(48 - i * 12);
  }
  return v;
}

// Evaluate exactly 5 cards.
function eval5(cards: readonly Card[]): { value: bigint; rank: number; best5: Card[] } {
  const ranks = cards.map(rankOf);
  const suits = cards.map(suitOf);

  // Rank counts
  const counts = new Array<number>(13).fill(0);
  for (const r of ranks) counts[r]!++;

  // Group rank values by count desc, then rank desc
  const grouped: Array<[count: number, rank: number]> = [];
  for (let r = 12; r >= 0; r--) if (counts[r]! > 0) grouped.push([counts[r]!, r]);
  grouped.sort((a, b) => b[0] - a[0] || b[1] - a[1]);

  const isFlush = suits.every(s => s === suits[0]);

  // Straight: distinct ranks, span = 4. Special: A-2-3-4-5 (wheel).
  const distinct = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = -1;
  if (distinct.length === 5) {
    if (distinct[0]! - distinct[4]! === 4) straightHigh = distinct[0]!;
    // wheel: A,5,4,3,2 -> distinct sorted desc = [12,3,2,1,0]
    else if (distinct[0] === 12 && distinct[1] === 3 && distinct[2] === 2 && distinct[3] === 1 && distinct[4] === 0)
      straightHigh = 3; // 5-high straight
  }

  if (isFlush && straightHigh >= 0) {
    return { value: pack(9, [straightHigh]), rank: 9, best5: [...cards] };
  }
  if (grouped[0]![0] === 4) {
    const quad = grouped[0]![1], kicker = grouped[1]![1];
    return { value: pack(8, [quad, kicker]), rank: 8, best5: [...cards] };
  }
  if (grouped[0]![0] === 3 && grouped[1]?.[0] === 2) {
    return { value: pack(7, [grouped[0]![1], grouped[1]![1]]), rank: 7, best5: [...cards] };
  }
  if (isFlush) {
    return { value: pack(6, distinct.slice(0, 5)), rank: 6, best5: [...cards] };
  }
  if (straightHigh >= 0) {
    return { value: pack(5, [straightHigh]), rank: 5, best5: [...cards] };
  }
  if (grouped[0]![0] === 3) {
    const trip = grouped[0]![1];
    const k = grouped.slice(1).map(g => g[1]).slice(0, 2);
    return { value: pack(4, [trip, ...k]), rank: 4, best5: [...cards] };
  }
  if (grouped[0]![0] === 2 && grouped[1]?.[0] === 2) {
    const high = grouped[0]![1], low = grouped[1]![1], k = grouped[2]!.[1];
    return { value: pack(3, [high, low, k]), rank: 3, best5: [...cards] };
  }
  if (grouped[0]![0] === 2) {
    const pair = grouped[0]![1];
    const k = grouped.slice(1).map(g => g[1]).slice(0, 3);
    return { value: pack(2, [pair, ...k]), rank: 2, best5: [...cards] };
  }
  return { value: pack(1, distinct.slice(0, 5)), rank: 1, best5: [...cards] };
}

// 21 combinations of 5-from-7 (precomputed indices)
const C5_7: ReadonlyArray<readonly number[]> = (() => {
  const out: number[][] = [];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++)
            out.push([a, b, c, d, e]);
  return out;
})();

export function evaluate(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new Error(`evaluate: need 5..7 cards, got ${cards.length}`);
  }
  let best: { value: bigint; rank: number; best5: Card[] } | null = null;

  if (cards.length === 5) {
    best = eval5(cards);
  } else if (cards.length === 6) {
    for (let skip = 0; skip < 6; skip++) {
      const five: Card[] = [];
      for (let i = 0; i < 6; i++) if (i !== skip) five.push(cards[i]!);
      const r = eval5(five);
      if (!best || r.value > best.value) best = r;
    }
  } else {
    for (const idx of C5_7) {
      const five: Card[] = [cards[idx[0]!]!, cards[idx[1]!]!, cards[idx[2]!]!, cards[idx[3]!]!, cards[idx[4]!]!];
      const r = eval5(five);
      if (!best || r.value > best.value) best = r;
    }
  }

  return {
    rank: best!.rank,
    rankName: RANK_NAMES[best!.rank - 1]!,
    best5: best!.best5,
    value: best!.value,
    description: describe(best!.rank, best!.best5),
  };
}

export function compareHands(a: HandValue, b: HandValue): number {
  if (a.value === b.value) return 0;
  return a.value > b.value ? 1 : -1;
}

function describe(rank: number, best5: Card[]): string {
  const ranks = best5.map(rankOf).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  switch (rank) {
    case 9: return ranks[0] === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_DESC[ranks[0]!]} high`;
    case 8: return `Four of a Kind, ${RANK_DESC[sorted[0]![0]]}s`;
    case 7: return `${RANK_DESC[sorted[0]![0]]}s full of ${RANK_DESC[sorted[1]![0]]}s`;
    case 6: return `Flush, ${RANK_DESC[ranks[0]!]} high`;
    case 5: return `Straight, ${RANK_DESC[ranks[0]!]} high`;
    case 4: return `Three ${RANK_DESC[sorted[0]![0]]}s`;
    case 3: return `Two Pair, ${RANK_DESC[sorted[0]![0]]}s and ${RANK_DESC[sorted[1]![0]]}s`;
    case 2: return `Pair of ${RANK_DESC[sorted[0]![0]]}s`;
    default: return `${RANK_DESC[ranks[0]!]} high`;
  }
}
