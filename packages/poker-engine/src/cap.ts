// Cap games — limit on total chips committed per hand.
//
// Once a player's `committedTotal` reaches the cap, further chips can't go in
// from anyone (further bets/raises are constrained). This is most common in
// Pot Limit Omaha cap games and some No-Limit lab tables.

import type { GameState } from './state';

export interface CapEnforcement {
  capReached: boolean;
  /** Adjusted maximum amount this seat can put in. */
  maxAdditional: number;
}

/** Returns the cap-enforced limit for a seat's next contribution. */
export function capLimit(state: GameState, seatIdx: number): CapEnforcement {
  const cap = (state.config as unknown as { capAmount?: number }).capAmount ?? 0;
  if (cap === 0) return { capReached: false, maxAdditional: Number.MAX_SAFE_INTEGER };
  const seat = state.seats[seatIdx];
  if (!seat) return { capReached: false, maxAdditional: 0 };
  const room = Math.max(0, cap - seat.committedTotal);
  return {
    capReached: room === 0,
    maxAdditional: room,
  };
}

/** Helper: are all in-hand seats capped? If so, no more action; deal the rest. */
export function everyoneCapped(state: GameState): boolean {
  const cap = (state.config as unknown as { capAmount?: number }).capAmount ?? 0;
  if (cap === 0) return false;
  const inHand = state.seats.filter(s => s.status === 'active' || s.status === 'all_in');
  if (inHand.length === 0) return false;
  return inHand.every(s => s.committedTotal >= cap);
}
