// Bomb pots.
//
// Every Nth hand, every active player posts a forced ante (typically
// 4-5× BB) and the flop is dealt immediately — no preflop betting round.
// Action begins at the first seat left of the dealer on the flop.
//
// Variants:
//   • Standard bomb pot — single board, normal betting from flop onward.
//   • Double-board bomb pot — two boards run from the flop, pot split.
//
// We support standard. Double-board piggy-backs on RIT machinery
// (run_count = 2 for the entire hand).

import type { Seat, Phase } from './state.js';

export interface BombPotConfig {
  /** Trigger every Nth hand (counted from the start of the session/orbit). */
  everyNHands: number;
  /** Forced ante size in micro-USDC. */
  ante: number;
  /** Run two boards by default? */
  doubleBoard: boolean;
}

export interface BombPotResult {
  triggered: boolean;
  pot: number;                          // chips contributed
  perSeatContribution: Map<number, number>;
  /** Seat to start action on at the flop (first active left of dealer). */
  firstActor: number;
  /** Initial phase after dealing — always 'flop'. */
  startPhase: Extract<Phase, 'flop'>;
  doubleBoard: boolean;
}

export function maybeTriggerBombPot(
  cfg: BombPotConfig,
  handCountSinceLastBomb: number,
  seats: Seat[],
  dealerSeat: number
): BombPotResult | null {
  if (cfg.everyNHands <= 0) return null;
  if (handCountSinceLastBomb < cfg.everyNHands) return null;

  const eligible = seats.filter(s => (s.status === 'active' || s.status === 'sitting_out') && s.userId && s.stack > 0);
  if (eligible.length < 2) return null;

  let pot = 0;
  const contrib = new Map<number, number>();
  for (const s of eligible) {
    const amt = Math.min(s.stack, cfg.ante);
    s.stack -= amt;
    s.committedThisRound += amt;
    s.committedTotal += amt;
    if (s.stack === 0) s.status = 'all_in';
    else s.status = 'active';
    pot += amt;
    contrib.set(s.idx, amt);
  }

  // First actor at flop: first seat left of dealer that's still in
  let firstActor = -1;
  const n = seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (dealerSeat + i) % n;
    if (seats[idx]!.status === 'active') { firstActor = idx; break; }
  }

  return {
    triggered: true,
    pot,
    perSeatContribution: contrib,
    firstActor,
    startPhase: 'flop',
    doubleBoard: cfg.doubleBoard,
  };
}
