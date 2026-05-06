// Equity calculator (Monte Carlo for >= 2 players, exhaustive for ≤ 2 + flop).
//
// Used by:
//   • Auto-pre-action UI ("equity vs. random")
//   • Showdown all-in display ("you have 73% equity to win")
//   • Pro tooling HUD support
//
// We don't simulate ranges in this v1 — players supply hole cards. Range
// modeling (e.g. opponent in the top 10% of starting hands) can be added by
// expanding the input to multiple [Card, Card] pairs per opponent and
// averaging.

import { FRESH_DECK, type Card } from './cards';
import { compareHands, evaluate } from './evaluator';

export interface EquityInput {
  hands: Array<[Card, Card]>;
  board: Card[];
  /** For exhaustive mode (default 200_000 trials). */
  trials?: number;
}

export interface EquityResult {
  /** Win probability per hand. */
  win: number[];
  tie: number[];
  /** Equity = win + tie/N (rough "expected share of pot"). */
  equity: number[];
  trials: number;
}

export function equity(input: EquityInput): EquityResult {
  const handCount = input.hands.length;
  if (handCount < 2) throw new Error('need at least 2 hands');

  // Build dead cards
  const dead = new Set<Card>(input.board);
  for (const h of input.hands) { dead.add(h[0]); dead.add(h[1]); }

  const stub = FRESH_DECK.filter(c => !dead.has(c));
  const need = 5 - input.board.length;
  if (need < 0) throw new Error('board has too many cards');
  if (stub.length < need) throw new Error('not enough cards left');

  const trials = input.trials ?? (need <= 1 ? Math.min(stub.length, 52) : 50_000);

  const win = new Array(handCount).fill(0);
  const tie = new Array(handCount).fill(0);

  if (need <= 1 && trials < stub.length) {
    // Exhaustive single-card runout (turn or river)
    for (const c of stub) {
      tally([...input.board, ...(need === 1 ? [c] : [])], input.hands, win, tie);
    }
    const total = stub.length;
    return finalize(win, tie, total, handCount);
  }

  for (let t = 0; t < trials; t++) {
    const dealt: Card[] = [...input.board];
    const used = new Set<Card>();
    while (dealt.length < 5) {
      const idx = Math.floor(Math.random() * stub.length);
      const c = stub[idx]!;
      if (used.has(c)) continue;
      used.add(c);
      dealt.push(c);
    }
    tally(dealt, input.hands, win, tie);
  }
  return finalize(win, tie, trials, handCount);
}

function tally(board: Card[], hands: Array<[Card, Card]>, win: number[], tie: number[]) {
  const evals = hands.map(h => evaluate([...h, ...board]));
  let bestVal = -1n;
  for (const e of evals) if (e.value > bestVal) bestVal = e.value;
  const winners: number[] = [];
  for (let i = 0; i < evals.length; i++) if (evals[i]!.value === bestVal) winners.push(i);
  if (winners.length === 1) {
    win[winners[0]!]!++;
  } else {
    for (const w of winners) tie[w]!++;
  }
}

function finalize(win: number[], tie: number[], total: number, handCount: number): EquityResult {
  return {
    win: win.map(w => w / total),
    tie: tie.map(t => t / total),
    equity: win.map((w, i) => (w + tie[i]! / handCount) / total),
    trials: total,
  };
}
