// Engine-feature helpers for the Room class.
//
// Encapsulates state for:
//   • Run-It-Twice voting + decision
//   • Bomb-pot trigger counter
//   • Sit-out warning + auto stand-up
//   • Disconnect protection
//   • Time bank per seat
//
// Each helper is a pure-ish state container that the Room owns.

import {
  ritEligibility,
  type GameState,
  type StraddleConfig,
  type StraddleKind,
  initialStraddle,
} from '@stacks/poker-engine';

// ─── Run-It-Twice voting ─────────────────────────────────────────────────────

export interface RitSession {
  decisionSeats: Set<number>;
  votes: Map<number, 1 | 2 | 3>;
  deadline: number;
  maxRunCount: 1 | 2 | 3;
  resolved: boolean;
}

export function openRitVote(
  state: GameState,
  maxRunCount: 1 | 2 | 3,
  voteWindowMs: number
): RitSession | null {
  const elig = ritEligibility(state);
  if (!elig.eligible) return null;
  return {
    decisionSeats: new Set(elig.decisionSeats),
    votes: new Map(),
    deadline: Date.now() + voteWindowMs,
    maxRunCount,
    resolved: false,
  };
}

export function recordRitVote(
  session: RitSession,
  seatIdx: number,
  runCount: 1 | 2 | 3
): boolean {
  if (!session.decisionSeats.has(seatIdx)) return false;
  if (session.resolved) return false;
  // Clamp to maxRunCount (table-config max)
  const clamped: 1 | 2 | 3 = Math.min(runCount, session.maxRunCount) as 1 | 2 | 3;
  session.votes.set(seatIdx, clamped);
  return true;
}

export function resolveRit(session: RitSession): 1 | 2 | 3 {
  session.resolved = true;
  // Lowest vote wins. Missing votes count as 1 (single run).
  let lowest: 1 | 2 | 3 = session.maxRunCount;
  for (const seat of session.decisionSeats) {
    const v = session.votes.get(seat) ?? 1;
    if (v < lowest) lowest = v;
  }
  return lowest;
}

export function ritAllVoted(session: RitSession): boolean {
  for (const s of session.decisionSeats) {
    if (!session.votes.has(s)) return false;
  }
  return true;
}

// ─── Bomb-pot trigger ────────────────────────────────────────────────────────

export interface BombPotTracker {
  everyNHands: number;
  ante: number;
  handsSinceLast: number;
}

export function newBombPotTracker(everyNHands: number, ante: number): BombPotTracker {
  return { everyNHands, ante, handsSinceLast: 0 };
}

export function shouldTriggerBombPot(t: BombPotTracker): boolean {
  if (t.everyNHands <= 0) return false;
  return t.handsSinceLast + 1 >= t.everyNHands;
}

export function tickBombPot(t: BombPotTracker, triggered: boolean): BombPotTracker {
  return { ...t, handsSinceLast: triggered ? 0 : t.handsSinceLast + 1 };
}

// ─── Sit-out & anti-grinder ──────────────────────────────────────────────────

export interface SitOutTracker {
  perSeat: Map<number, number>;
  max: number;
}

export function newSitOutTracker(max: number): SitOutTracker {
  return { perSeat: new Map(), max };
}

/** Call when a player misses a hand (sat out). Returns warning info if approaching limit. */
export function recordSitOut(t: SitOutTracker, seatIdx: number): {
  consecutive: number;
  shouldStandUp: boolean;
  warningHandsLeft: number;
} {
  const next = (t.perSeat.get(seatIdx) ?? 0) + 1;
  t.perSeat.set(seatIdx, next);
  return {
    consecutive: next,
    shouldStandUp: next >= t.max,
    warningHandsLeft: Math.max(0, t.max - next),
  };
}

export function resetSitOut(t: SitOutTracker, seatIdx: number) {
  t.perSeat.delete(seatIdx);
}

// ─── Disconnect protection ───────────────────────────────────────────────────

export interface DisconnectTracker {
  protectSeconds: number;
  perSeat: Map<number, { protectUntil: number; disconnectedAt: number }>;
}

export function newDisconnectTracker(protectSeconds: number): DisconnectTracker {
  return { protectSeconds, perSeat: new Map() };
}

export function markDisconnect(t: DisconnectTracker, seatIdx: number) {
  const now = Date.now();
  t.perSeat.set(seatIdx, { protectUntil: now + t.protectSeconds * 1000, disconnectedAt: now });
}

export function clearDisconnect(t: DisconnectTracker, seatIdx: number) {
  t.perSeat.delete(seatIdx);
}

export function isDisconnectProtected(t: DisconnectTracker, seatIdx: number): boolean {
  const e = t.perSeat.get(seatIdx);
  if (!e) return false;
  return Date.now() < e.protectUntil;
}

// ─── Straddle setup helper ───────────────────────────────────────────────────

export interface StraddleSetup {
  cfg: StraddleConfig;
  pendingStraddleSeats: number[];      // seats that opted in for the next hand
}

export function newStraddleSetup(kind: StraddleKind, bigBlind: number, allowReStraddle: boolean): StraddleSetup {
  return {
    cfg: { kind, bigBlind, allowReStraddle, multiplierCap: 0 },
    pendingStraddleSeats: [],
  };
}

export function optInStraddle(setup: StraddleSetup, seatIdx: number) {
  if (!setup.pendingStraddleSeats.includes(seatIdx)) setup.pendingStraddleSeats.push(seatIdx);
}

export function applyStraddlesToHand(
  setup: StraddleSetup,
  state: GameState,
  dealerSeat: number,
  bbSeat: number
): { straddledSeats: number[]; totalStraddleAmount: number } {
  const initial = initialStraddle(setup.cfg, state.seats, dealerSeat, bbSeat);
  if (!initial) return { straddledSeats: [], totalStraddleAmount: 0 };
  const seat = state.seats[initial.seatIdx];
  if (!seat) return { straddledSeats: [], totalStraddleAmount: 0 };

  // Only auto-apply if seat opted in
  if (!setup.pendingStraddleSeats.includes(initial.seatIdx)) {
    return { straddledSeats: [], totalStraddleAmount: 0 };
  }
  const pay = Math.min(seat.stack, initial.amount);
  seat.stack -= pay;
  seat.committedThisRound += pay;
  seat.committedTotal += pay;
  if (seat.stack === 0) seat.status = 'all_in';
  setup.pendingStraddleSeats = [];          // straddle opt-in is per-hand
  return { straddledSeats: [initial.seatIdx], totalStraddleAmount: pay };
}
