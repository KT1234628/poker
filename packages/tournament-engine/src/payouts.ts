// Tournament payout calculation.
//
// Two strategies:
//   1. fixedPercent — typical published payout structure (e.g., 50/30/20 for top 3).
//   2. icm          — Independent Chip Model for deal-making (used when remaining
//                     players want to chop based on stack sizes).
//
// We expose both because:
//   - When a player busts, fixedPercent decides their cash prize.
//   - For final-table deals, ICM is the fair calculation.

export interface PayoutSlot {
  place: number;          // 1-indexed (1 = winner)
  pctBps: number;         // share in basis points (10000 = 100%)
}

// Standard payout structures from PokerStars, scaled to N entrants.
export function defaultPayoutStructure(entrants: number): PayoutSlot[] {
  const places = Math.max(1, Math.min(entrants, Math.floor(entrants * 0.15) + 1));
  const out: PayoutSlot[] = [];
  // Use a geometric-ish curve (top-heavy)
  const weights: number[] = [];
  for (let i = 1; i <= places; i++) weights.push(Math.pow(0.62, i - 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let allocated = 0;
  for (let i = 1; i <= places; i++) {
    const pct = Math.floor((weights[i - 1]! / total) * 10000);
    out.push({ place: i, pctBps: pct });
    allocated += pct;
  }
  // Adjust rounding into 1st place
  out[0]!.pctBps += 10000 - allocated;
  return out;
}

export function applyFixedPercent(prizePool: number, structure: PayoutSlot[]): Record<number, number> {
  const map: Record<number, number> = {};
  let allocated = 0;
  for (const s of structure) {
    const amt = Math.floor((prizePool * s.pctBps) / 10000);
    map[s.place] = amt;
    allocated += amt;
  }
  // Rounding remainder to first place
  if (structure[0]) map[structure[0].place] = (map[structure[0].place] ?? 0) + (prizePool - allocated);
  return map;
}

// ─── ICM (Malmuth-Harville algorithm) ────────────────────────────────────────

export interface IcmInput {
  stacks: number[];          // chip stacks of remaining players (in arbitrary order)
  prizes: number[];          // prizes for places 1..N (length >= remaining)
}

// Returns each player's expected prize, in the same order as `stacks`.
export function icm(input: IcmInput): number[] {
  const { stacks, prizes } = input;
  const n = stacks.length;
  if (n === 0) return [];
  if (n === 1) return [prizes[0] ?? 0];

  // For exact computation with small n (<= 9 typical at final tables), enumerate
  // all permutations weighted by probability per Harville (chip-proportional finishing).
  // For n > 9 we fall back to a Monte Carlo approximation.
  if (n <= 9) return icmExact(stacks, prizes);
  return icmMonteCarlo(stacks, prizes, 50_000);
}

function icmExact(stacks: number[], prizes: number[]): number[] {
  const n = stacks.length;
  const ev = new Array(n).fill(0);
  // Recursive: pick winner among remaining, distribute prize, recurse.
  const recurse = (remaining: number[], place: number, prob: number) => {
    const total = remaining.reduce((a, i) => a + stacks[i]!, 0);
    if (total === 0 || place > prizes.length) return;
    for (const i of remaining) {
      const p = prob * (stacks[i]! / total);
      ev[i] += p * (prizes[place - 1] ?? 0);
      if (place < prizes.length && remaining.length > 1) {
        recurse(remaining.filter(x => x !== i), place + 1, p);
      }
    }
  };
  const indices = stacks.map((_, i) => i);
  recurse(indices, 1, 1);
  return ev;
}

function icmMonteCarlo(stacks: number[], prizes: number[], iters: number): number[] {
  const n = stacks.length;
  const ev = new Array(n).fill(0);
  for (let it = 0; it < iters; it++) {
    // Sample a finishing order proportional to stacks.
    const remaining = stacks.map((s, i) => ({ i, s }));
    let place = 1;
    while (remaining.length > 0 && place <= prizes.length) {
      const total = remaining.reduce((a, r) => a + r.s, 0);
      const t = Math.random() * total;
      let acc = 0;
      let pickIdx = 0;
      for (let k = 0; k < remaining.length; k++) {
        acc += remaining[k]!.s;
        if (t <= acc) { pickIdx = k; break; }
      }
      const winner = remaining[pickIdx]!;
      ev[winner.i] += prizes[place - 1] ?? 0;
      remaining.splice(pickIdx, 1);
      place++;
    }
  }
  return ev.map(v => v / iters);
}
