import type { GameState, Seat, SidePot } from './state';

// Build side pots from per-seat `committedTotal`.
// Algorithm:
//   - Sort active+all-in players by committedTotal asc.
//   - For each unique commitment level, the contribution per active contributor is
//     (level - prevLevel), and contributors are everyone (including folders) who put
//     in at least `level`. Eligibility for winning = active+all-in only.
//   - The chip math: at level L (delta = L - prev), every contributor c with total >= L
//     contributes delta to that pot. Eligible winners = contributors at >= L who haven't folded.
//
// Folded players' chips are still in the pots they contributed to but they can't win.

export function buildSidePots(state: GameState): SidePot[] {
  // All seats that put any chips in
  const contributors = state.seats.filter(s => s.committedTotal > 0);
  if (contributors.length === 0) return [];

  // Distinct commitment levels
  const levels = [...new Set(contributors.map(s => s.committedTotal))].sort((a, b) => a - b);

  const pots: SidePot[] = [];
  let prev = 0;
  for (const lvl of levels) {
    const delta = lvl - prev;
    const inThisPot = contributors.filter(s => s.committedTotal >= lvl);
    const amount = inThisPot.length * delta;
    if (amount > 0) {
      const eligible = inThisPot
        .filter(s => s.status === 'active' || s.status === 'all_in')
        .map(s => s.idx);
      // Merge with previous if eligibility identical (keeps pots minimal)
      const last = pots[pots.length - 1];
      if (last && sameEligible(last.eligibleSeats, eligible)) {
        last.amount += amount;
      } else {
        pots.push({ amount, eligibleSeats: eligible });
      }
    }
    prev = lvl;
  }
  return pots;
}

function sameEligible(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const x of b) if (!set.has(x)) return false;
  return true;
}
