// Satellite tournaments.
//
// A satellite is a tournament where most/all of the prize pool is paid out
// as TICKETS to a target tournament (e.g. $5 satellite with 100 entries
// awarding 10 tickets to a $50 buy-in).
//
// The bottom finishers below the threshold typically get nothing
// (or 1 cent for tax-reporting purposes — common in regulated markets).
// Top N finishers win one ticket each.
//
// Special edge cases:
//   • Cash-out option: a satellite winner who already has a ticket can
//     "unregister for cash" — typical convention pays the ticket value back
//     in chips/cash.
//   • Last-longer / final-table deals: not standard in satellites.

export interface SatelliteConfig {
  /** Total tickets to award (top N finishers get a seat). */
  seatsAwarded: number;
  /** Target tournament whose ticket is awarded. */
  targetTournamentId: string;
  /** Cash equivalent of one ticket (used for unregistration / overlay). */
  ticketValue: number;
  /** Optional small cash to remaining places (penny prize). */
  pennyPrize?: number;
}

export interface SatellitePayout {
  /** Place finished (1-indexed). */
  place: number;
  userId: string;
  /** Whether they win a ticket. */
  ticket: boolean;
  /** Cash awarded (used for penny prizes or overlay). */
  cash: number;
}

/**
 * Compute payouts for a finished satellite. `finishOrder` is the list of
 * user IDs in finishing order (1st place first).
 */
export function computeSatellitePayouts(
  cfg: SatelliteConfig,
  finishOrder: string[]
): SatellitePayout[] {
  const out: SatellitePayout[] = [];
  for (let i = 0; i < finishOrder.length; i++) {
    const place = i + 1;
    const userId = finishOrder[i]!;
    if (place <= cfg.seatsAwarded) {
      out.push({ place, userId, ticket: true, cash: 0 });
    } else {
      out.push({ place, userId, ticket: false, cash: cfg.pennyPrize ?? 0 });
    }
  }
  return out;
}

/**
 * Overlay handling: if total entries × buy-in < seatsAwarded × ticketValue,
 * the operator must cover the gap (overlay). Returns the overlay needed.
 */
export function computeOverlay(
  cfg: SatelliteConfig,
  totalEntries: number,
  buyIn: number
): number {
  const collected = totalEntries * buyIn;
  const required = cfg.seatsAwarded * cfg.ticketValue;
  return Math.max(0, required - collected);
}

/**
 * Edge case: ICM-decision in late satellites — "the bubble" where the average
 * stack is enough to fold into the seats. Returns true if the chip leader
 * folding still locks the seat, given current chip distribution.
 */
export function isLockedSeat(stacks: number[], seatsAwarded: number, blindCost: number): boolean {
  const sortedDesc = [...stacks].sort((a, b) => b - a);
  if (seatsAwarded >= sortedDesc.length) return true;
  // A seat is "locked" if the smallest stack inside the seat-line is bigger
  // than the largest stack on the bubble plus a few orbits of blinds.
  const insideMin = sortedDesc[seatsAwarded - 1] ?? 0;
  const bubble = sortedDesc[seatsAwarded] ?? 0;
  return insideMin > bubble + blindCost * 3;
}
