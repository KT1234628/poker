// Re-entry tournaments.
//
// After busting, a player may re-register before the late-reg cutoff (and
// before any per-player cap is reached). Their original entry is not "merged"
// — for tournament accounting, each re-entry counts as a separate registration
// (separate buy-in, separate prize-pool contribution).
//
// Re-entry rules vary:
//   • PokerStars: usually unlimited until end of late reg.
//   • GGPoker: most events unlimited; some are 1-re-entry, some freezeout.
//   • WSOP: "1-bullet" or "2-bullet" re-entry.
//
// For multi-day events: re-entry ends after Day 1 / late-reg level
// regardless of player count.

export interface ReEntryRule {
  enabled: boolean;
  /** 0 = unlimited; otherwise max re-entries per player */
  maxPerPlayer: number;
  /** Last level after which re-entry is closed. 0 = uses tournament late-reg. */
  closesAfterLevel: number;
}

export interface ReEntryRequest {
  userId: string;
  currentLevel: number;
  /** Previous re-entries this user has done in this tournament */
  priorReEntryCount: number;
  /** Whether late-reg window is still open */
  lateRegOpen: boolean;
}

export type ReEntryDecision =
  | { allowed: true; reason: 'ok' }
  | { allowed: false; reason: 'disabled' | 'cap_reached' | 'late_reg_closed' | 'level_too_high' };

export function evaluateReEntry(rule: ReEntryRule, req: ReEntryRequest): ReEntryDecision {
  if (!rule.enabled) return { allowed: false, reason: 'disabled' };
  if (rule.maxPerPlayer > 0 && req.priorReEntryCount >= rule.maxPerPlayer) {
    return { allowed: false, reason: 'cap_reached' };
  }
  if (rule.closesAfterLevel > 0 && req.currentLevel > rule.closesAfterLevel) {
    return { allowed: false, reason: 'level_too_high' };
  }
  if (!req.lateRegOpen) return { allowed: false, reason: 'late_reg_closed' };
  return { allowed: true, reason: 'ok' };
}

/**
 * Compute the impact of a re-entry on the prize pool.
 * Each re-entry adds (buyIn - rake) to the prize pool, and (rake) to operator.
 */
export function reEntryPrizePoolDelta(buyIn: number, rakeBps: number): { prize: number; rake: number } {
  const rake = Math.floor((buyIn * rakeBps) / 10000);
  return { prize: buyIn - rake, rake };
}
