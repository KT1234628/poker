// Straddle support.
//
// Three styles:
//   • UTG straddle ("Mississippi off") — the player UTG (left of BB) posts
//     a blind voluntary 2× the BB before cards are dealt. Action then begins
//     left of the straddle. The straddle acts last preflop.
//   • Button straddle ("Mississippi on") — the dealer button posts the
//     straddle. Action starts left of the BB as normal.
//   • Mississippi straddle — any seat can straddle (typically allowed only
//     in non-blinds positions). Closest to button gets right-of-first-refusal.
//
// Re-straddles: a player further left can re-straddle for 2× the previous
// straddle (cap is configurable; PokerStars caps at 4× BB, GGPoker uncapped).
//
// Straddles cap the *initial* current bet for action; min raise rules apply
// based on the straddle as the new bb.

import type { GameState, Seat } from './state';

export type StraddleKind = 'none' | 'utg' | 'button' | 'mississippi';

export interface StraddleConfig {
  kind: StraddleKind;
  /** Cap on total straddle multiplier of BB. 0 = uncapped. PokerStars uses 4. */
  multiplierCap: number;
  /** Allow re-straddles? */
  allowReStraddle: boolean;
  /** Big blind (used to compute straddle amounts). */
  bigBlind: number;
}

export interface StraddlePost {
  seatIdx: number;
  amount: number;
}

/**
 * Determine which seat would post the initial straddle (and the amount).
 * Returns null if straddle is not configured or the eligible seat doesn't have
 * enough chips to cover it.
 */
export function initialStraddle(
  cfg: StraddleConfig,
  seats: readonly Seat[],
  dealerSeat: number,
  bbSeat: number
): StraddlePost | null {
  if (cfg.kind === 'none') return null;
  const amount = cfg.bigBlind * 2;

  switch (cfg.kind) {
    case 'utg': {
      // Seat to the left of BB
      const utg = nextSeatedActive(seats, bbSeat);
      if (utg < 0) return null;
      const s = seats[utg]!;
      if (s.stack < amount) return null;
      return { seatIdx: utg, amount };
    }
    case 'button': {
      const s = seats[dealerSeat];
      if (!s || s.stack < amount) return null;
      return { seatIdx: dealerSeat, amount };
    }
    case 'mississippi': {
      // Closest to button has first option. We pick deterministically: button
      // straddles by default unless they sit out of straddle (handled by client).
      const s = seats[dealerSeat];
      if (!s || s.stack < amount) return null;
      return { seatIdx: dealerSeat, amount };
    }
  }
  return null;
}

/**
 * Compute the next legal re-straddle amount given the most recent straddle.
 * Returns null if re-straddle isn't allowed or the cap would be exceeded.
 */
export function nextReStraddleAmount(
  cfg: StraddleConfig,
  currentStraddle: number
): number | null {
  if (!cfg.allowReStraddle) return null;
  const next = currentStraddle * 2;
  if (cfg.multiplierCap > 0 && next > cfg.multiplierCap * cfg.bigBlind) return null;
  return next;
}

function nextSeatedActive(seats: readonly Seat[], from: number): number {
  const n = seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const s = seats[idx]!;
    if (s.status === 'active' || s.status === 'all_in') return idx;
  }
  return -1;
}

/**
 * After straddles are posted, the pre-flop action starts at the seat
 * immediately to the left of the highest straddle.
 */
export function preflopFirstActorWithStraddle(
  seats: readonly Seat[],
  highestStraddleSeat: number
): number {
  return nextSeatedActive(seats, highestStraddleSeat);
}

/** Helper: returns the new effective "current bet" after straddles. */
export function effectiveCurrentBetAfterStraddles(
  bigBlind: number,
  straddleAmounts: number[]
): number {
  return Math.max(bigBlind, ...straddleAmounts);
}
