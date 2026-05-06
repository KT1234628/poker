// Bad Beat Jackpot detection.
//
// Industry-standard rule (PokerStars / GG / WSOP variants):
//   • The "loser" must lose a hand having a very strong made hand —
//     typically aces full of jacks (or higher) — when they were beaten.
//     We use a configurable minimum rank (default = full house with
//     specific kickers) but operators tune by stake and table.
//   • Both the loser's and the winner's full 5-card hand must use both
//     hole cards (a "real" cooler — not just board-only better hands).
//   • All players dealt into the hand share part of the jackpot.
//
// Inputs: a finished showdown state with revealed hole cards.

import { evaluate, type HandValue } from './evaluator';
import type { Card } from './cards';

export interface BbjConfig {
  /** Minimum rank class the LOSER must have. 7 = full house, 8 = quads. */
  minLoserRank: number;
  /** Optional minimum rank value (e.g. quad eights). */
  minLoserValue?: bigint;
  /** Both players' best hand must use both hole cards. */
  requireBothHoleCardsUsed: boolean;
}

export interface BbjCandidate {
  loser: { seatIdx: number; userId: string | null; cards: [Card, Card]; eval: HandValue };
  winner: { seatIdx: number; userId: string | null; cards: [Card, Card]; eval: HandValue };
  /** All seats dealt into the hand (eligible for the table-share split). */
  allDealtUserIds: string[];
}

export interface BbjFinishedHand {
  board: Card[];
  reveals: Array<{ seatIdx: number; userId: string | null; cards: [Card, Card] }>;
}

export function detectBadBeat(cfg: BbjConfig, hand: BbjFinishedHand): BbjCandidate | null {
  if (hand.reveals.length < 2) return null;
  const evals = hand.reveals.map(r => ({
    ...r,
    eval: evaluate([...r.cards, ...hand.board]),
  }));

  // Find best (winner) and second-best (loser candidate)
  evals.sort((a, b) => (a.eval.value < b.eval.value ? 1 : a.eval.value > b.eval.value ? -1 : 0));
  const winner = evals[0]!;
  const loser = evals[1]!;

  if (loser.eval.rank < cfg.minLoserRank) return null;
  if (cfg.minLoserValue !== undefined && loser.eval.value < cfg.minLoserValue) return null;

  if (cfg.requireBothHoleCardsUsed) {
    if (!usesBothHoleCards(loser.cards, hand.board, loser.eval.best5)) return null;
    if (!usesBothHoleCards(winner.cards, hand.board, winner.eval.best5)) return null;
  }

  return {
    loser: { seatIdx: loser.seatIdx, userId: loser.userId, cards: loser.cards, eval: loser.eval },
    winner: { seatIdx: winner.seatIdx, userId: winner.userId, cards: winner.cards, eval: winner.eval },
    allDealtUserIds: hand.reveals.map(r => r.userId).filter((u): u is string => !!u),
  };
}

function usesBothHoleCards(holeCards: [Card, Card], board: Card[], best5: Card[]): boolean {
  const setBest = new Set(best5);
  return setBest.has(holeCards[0]) && setBest.has(holeCards[1]);
}
