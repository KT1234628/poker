// Run-It-Twice (RIT) / Run-It-Three-Times (RI3T)
//
// When all action is locked (everyone in the hand is all-in or only one player
// has chips left), all eligible players can vote to "run" the remaining streets
// multiple times. The pot is split into N equal parts and each part is awarded
// to the winner of one independent run-out.
//
// Eligibility:
//   • At least 2 players are still in (active or all_in)
//   • All players are committed (no further action possible — typically all-in
//     pre-river, but also valid when one player is all-in and the others have
//     called for their entire remaining stack on the relevant street)
//   • Every eligible player must consent. If anyone declines, run once.
//
// Standard rule: each run uses cards drawn sequentially from the deck. The
// first run uses cards starting at deckPos+1 (after a burn). The second run
// uses the next set after burning again. We don't re-burn between runs in
// every operator's house rules — but we do here for consistency with live
// poker tradition and to match GGPoker.

import type { Card } from './cards.js';
import type { Phase, GameState } from './state.js';

export interface RitContext {
  /** Deck order produced by the original shuffle. */
  deck: readonly Card[];
  /** Position into the deck just past the last community card already dealt. */
  deckPos: number;
  /** Which streets still need to be dealt — 'flop', 'turn', 'river'. */
  remainingStreets: Array<'flop' | 'turn' | 'river'>;
  /** How many times to run (1, 2, or 3). */
  runCount: 1 | 2 | 3;
}

export interface RitBoard {
  /** index 0..runCount-1 */
  runIdx: number;
  /** All 5 community cards on this run (existing board cards prepended unchanged). */
  board: Card[];
}

/**
 * Build N independent boards from the remaining deck.
 *
 * Cards already on the board (e.g. flop dealt before action went all-in on the
 * turn) are shared across all runs. Only the unrevealed streets vary.
 *
 * Burn-card convention (Hellmuth/Negreanu standard): we burn 1 between each
 * dealt street, AND we burn 1 between the last card of run N and the first
 * deal of run N+1. This is the "live" convention; some online sites skip the
 * inter-run burn — we follow live to keep the verification trivial for users.
 */
export function buildRunBoards(
  ctx: RitContext,
  boardSoFar: readonly Card[]
): RitBoard[] {
  const out: RitBoard[] = [];
  let pos = ctx.deckPos;

  for (let r = 0; r < ctx.runCount; r++) {
    const board: Card[] = [...boardSoFar];
    for (const street of ctx.remainingStreets) {
      // Each new street starts with a burn
      pos += 1;
      const need = street === 'flop' ? 3 : 1;
      for (let i = 0; i < need; i++) {
        board.push(ctx.deck[pos++]!);
      }
    }
    out.push({ runIdx: r, board });
  }
  return out;
}

/**
 * Determine if RIT can be offered given current game state.
 * Returns the set of seats that still have decision power (must consent).
 */
export function ritEligibility(state: GameState): {
  eligible: boolean;
  decisionSeats: number[];
  remainingStreets: Array<'flop' | 'turn' | 'river'>;
} {
  const inHand = state.seats.filter(
    s => s.status === 'active' || s.status === 'all_in'
  );
  if (inHand.length < 2) return { eligible: false, decisionSeats: [], remainingStreets: [] };

  // No further betting can happen if there is at most one player with chips left.
  const playersWithChips = inHand.filter(s => s.stack > 0);
  if (playersWithChips.length > 1) {
    return { eligible: false, decisionSeats: [], remainingStreets: [] };
  }

  // Determine remaining streets
  const phase: Phase = state.phase;
  const map: Record<Phase, Array<'flop' | 'turn' | 'river'>> = {
    preflop: ['flop', 'turn', 'river'],
    flop:    ['turn', 'river'],
    turn:    ['river'],
    river:   [],
    showdown: [],
    complete: [],
  };
  const remainingStreets = map[phase];
  if (remainingStreets.length === 0) {
    return { eligible: false, decisionSeats: [], remainingStreets };
  }

  // Both players whose chips are at risk get to decide. In practice, the
  // covering player (the one with chips left) and any all-in opponents.
  const decisionSeats = inHand.map(s => s.idx);
  return { eligible: true, decisionSeats, remainingStreets };
}

/**
 * Tally votes. We treat absence of vote as "no" by default.
 * Returns the agreed-upon run count (1, 2, or 3) — the **lowest** vote wins
 * (so a single objector forces single run).
 */
export function tallyRunCount(
  votes: Map<number, 1 | 2 | 3>,
  decisionSeats: number[],
  maxAllowed: 1 | 2 | 3
): 1 | 2 | 3 {
  let lowest: 1 | 2 | 3 = maxAllowed;
  for (const seat of decisionSeats) {
    const v = votes.get(seat) ?? 1;
    if (v < lowest) lowest = v;
  }
  return lowest;
}
