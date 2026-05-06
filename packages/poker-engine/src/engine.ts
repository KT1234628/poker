import type { Card } from './cards';
import { evaluate, type HandValue } from './evaluator';
import { buildSidePots } from './sidepots';
import {
  type ActionType,
  type GameConfig,
  type GameState,
  type Phase,
  type Seat,
  emptyTable,
  inHandSeats,
  nextActionableSeat,
  nextOccupiedSeat,
} from './state';

// ─── Hand-start machinery ─────────────────────────────────────────────────────

export function seatPlayer(state: GameState, seatIdx: number, userId: string, stack: number): GameState {
  const seats = state.seats.map(s => ({ ...s }));
  const s = seats[seatIdx];
  if (!s) throw new Error(`bad seat ${seatIdx}`);
  if (s.status !== 'empty') throw new Error(`seat ${seatIdx} occupied`);
  s.userId = userId;
  s.stack = stack;
  s.status = 'sitting_out';                   // sit-out until next hand
  return { ...state, seats };
}

export function activateSeat(state: GameState, seatIdx: number): GameState {
  const seats = state.seats.map(s => ({ ...s }));
  const s = seats[seatIdx];
  if (!s || !s.userId) throw new Error(`bad seat ${seatIdx}`);
  if (s.status === 'sitting_out') s.status = 'active';
  return { ...state, seats };
}

export function leaveSeat(state: GameState, seatIdx: number): GameState {
  const seats = state.seats.map(s => ({ ...s }));
  const s = seats[seatIdx];
  if (!s) return state;
  s.userId = null;
  s.stack = 0;
  s.holeCards = null;
  s.status = 'empty';
  s.committedThisRound = 0;
  s.committedTotal = 0;
  s.hasActed = false;
  s.isDealer = s.isSb = s.isBb = false;
  return { ...state, seats };
}

// Start a new hand. Caller supplies the (already-shuffled) deck.
export function startHand(
  prev: GameState,
  args: { handId: string; deck: Card[]; dealerSeat: number; handNumber: number }
): GameState {
  const config = prev.config;
  const seats = prev.seats.map(s => ({
    ...s,
    holeCards: null,
    committedThisRound: 0,
    committedTotal: 0,
    hasActed: false,
    isDealer: false,
    isSb: false,
    isBb: false,
    showCards: false,
    status: s.status === 'folded' ? 'active' : s.status,
  }));

  // Activate sit-out players who have stack >= big blind (auto sit-in)
  for (const s of seats) {
    if (s.status === 'sitting_out' && s.userId && s.stack >= config.bigBlind) {
      s.status = 'active';
    }
  }

  const occupied = seats
    .map((s, i) => (s.userId && (s.status === 'active' || s.status === 'sitting_out') ? i : -1))
    .filter(i => i >= 0);
  if (occupied.length < 2) throw new Error('need at least 2 seated players');

  // Move dealer to next occupied seat starting from args.dealerSeat
  const occSet = new Set(occupied);
  const dealer = occSet.has(args.dealerSeat) ? args.dealerSeat : occupied[0]!;
  seats[dealer]!.isDealer = true;

  // SB / BB. Heads-up: dealer is SB.
  let sbSeat: number, bbSeat: number;
  const active = seats
    .map((s, i) => (s.status === 'active' ? i : -1))
    .filter(i => i >= 0);

  if (active.length === 2) {
    sbSeat = dealer;
    bbSeat = nextActiveAfter(seats, dealer);
  } else {
    sbSeat = nextActiveAfter(seats, dealer);
    bbSeat = nextActiveAfter(seats, sbSeat);
  }
  seats[sbSeat]!.isSb = true;
  seats[bbSeat]!.isBb = true;

  // Antes
  let pot = 0;
  if (config.ante > 0) {
    for (const s of seats) {
      if (s.status === 'active') {
        const a = Math.min(s.stack, config.ante);
        s.stack -= a;
        s.committedTotal += a;
        pot += a;
        if (s.stack === 0) s.status = 'all_in';
      }
    }
  }

  // Post blinds (committedThisRound counts toward call requirement)
  const postBlind = (idx: number, amt: number) => {
    const s = seats[idx]!;
    const a = Math.min(s.stack, amt);
    s.stack -= a;
    s.committedThisRound += a;
    s.committedTotal += a;
    pot += a;
    if (s.stack === 0) s.status = 'all_in';
  };
  postBlind(sbSeat, config.smallBlind);
  postBlind(bbSeat, config.bigBlind);

  // Deal hole cards (2 each, alternating, starting from SB)
  const deck = [...args.deck];
  let pos = 0;
  const order = activeSeatsClockwise(seats, sbSeat);
  for (let r = 0; r < 2; r++) {
    for (const i of order) {
      const s = seats[i]!;
      if (s.status === 'active' || s.status === 'all_in') {
        if (!s.holeCards) s.holeCards = [deck[pos++]!, deck[pos++]!] as [Card, Card];
        else s.holeCards = [s.holeCards[0], deck[pos++]!];
      }
    }
  }

  // First to act preflop: left of BB (heads-up: SB which is dealer acts first)
  const firstAct = active.length === 2 ? sbSeat : nextActiveAfter(seats, bbSeat);

  const state: GameState = {
    ...prev,
    handId: args.handId,
    handNumber: args.handNumber,
    phase: 'preflop',
    seats,
    dealerSeat: dealer,
    sbSeat,
    bbSeat,
    pot,
    sidePots: [],
    board: [],
    toAct: firstAct,
    currentBet: config.bigBlind,
    lastRaise: config.bigBlind,
    raiseCount: 0,
    actionDeadline: Date.now() + config.actionTimeoutMs,
    deck,
    deckPos: pos,
    log: [],
    rakeTaken: 0,
  };
  return state;
}

function activeSeatsClockwise(seats: Seat[], start: number): number[] {
  const out: number[] = [];
  const n = seats.length;
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n;
    const s = seats[idx]!;
    if (s.status === 'active' || s.status === 'all_in') out.push(idx);
  }
  return out;
}

function nextActiveAfter(seats: Seat[], from: number): number {
  const n = seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    if (seats[idx]!.status === 'active') return idx;
  }
  return -1;
}

// ─── Action validation + application ─────────────────────────────────────────

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  minBet: number;
  canRaise: boolean;
  minRaise: number;       // minimum raise-to amount
  maxRaise: number;       // = stack (NL)
  canAllIn: boolean;
  allInAmount: number;
}

export function legalActions(state: GameState, seatIdx: number): LegalActions | null {
  if (state.toAct !== seatIdx) return null;
  const s = state.seats[seatIdx];
  if (!s || s.status !== 'active') return null;

  const toCall = state.currentBet - s.committedThisRound;
  const canCheck = toCall === 0;
  const canCall = toCall > 0 && s.stack > 0;
  const callAmount = Math.min(toCall, s.stack);

  // Bet/raise: NL minimums
  const minRaiseAmount = Math.max(state.lastRaise, state.config.bigBlind);
  const minRaiseTo = state.currentBet + minRaiseAmount;

  const canBet = state.currentBet === 0 && s.stack > 0;
  const minBet = state.config.bigBlind;

  const canRaise = state.currentBet > 0 && s.stack > toCall;
  const minRaise = Math.min(s.committedThisRound + s.stack, minRaiseTo);
  const maxRaise = s.committedThisRound + s.stack;        // total commitment shoving

  return {
    canFold: true,
    canCheck,
    canCall,
    callAmount,
    canBet,
    minBet,
    canRaise,
    minRaise,
    maxRaise,
    canAllIn: s.stack > 0,
    allInAmount: s.committedThisRound + s.stack,
  };
}

export interface ApplyResult {
  state: GameState;
  endedPhase: boolean;
  endedHand: boolean;
  showdownNeeded: boolean;
}

export function applyAction(
  state: GameState,
  action: { seat: number; type: ActionType; amount?: number; userId?: string }
): ApplyResult {
  if (state.phase === 'showdown' || state.phase === 'complete') {
    throw new Error(`hand already complete (phase=${state.phase})`);
  }
  if (state.toAct !== action.seat) {
    throw new Error(`not your turn (toAct=${state.toAct}, seat=${action.seat})`);
  }
  const seats = state.seats.map(s => ({ ...s }));
  const s = seats[action.seat];
  if (!s) throw new Error('bad seat');
  if (s.status !== 'active') throw new Error(`seat status ${s.status}`);

  let pot = state.pot;
  let currentBet = state.currentBet;
  let lastRaise = state.lastRaise;
  let raiseCount = state.raiseCount;
  const log = state.log.slice();

  const seq = log.length + 1;
  const phase = state.phase as Phase;
  const toCall = currentBet - s.committedThisRound;

  let logged: { action: ActionType; amount: number; toCall: number };

  switch (action.type) {
    case 'fold': {
      s.status = 'folded';
      logged = { action: 'fold', amount: 0, toCall };
      break;
    }
    case 'check': {
      if (toCall !== 0) throw new Error('cannot check; bet to call');
      logged = { action: 'check', amount: 0, toCall: 0 };
      break;
    }
    case 'call': {
      if (toCall === 0) throw new Error('nothing to call');
      const pay = Math.min(toCall, s.stack);
      s.stack -= pay;
      s.committedThisRound += pay;
      s.committedTotal += pay;
      pot += pay;
      if (s.stack === 0) s.status = 'all_in';
      logged = { action: 'call', amount: pay, toCall };
      break;
    }
    case 'bet': {
      if (currentBet !== 0) throw new Error('cannot bet; raise instead');
      const amt = action.amount ?? 0;
      if (amt < state.config.bigBlind && amt < s.stack) {
        throw new Error(`bet must be >= bigBlind (got ${amt})`);
      }
      const pay = Math.min(amt, s.stack);
      s.stack -= pay;
      s.committedThisRound += pay;
      s.committedTotal += pay;
      pot += pay;
      currentBet = s.committedThisRound;
      lastRaise = currentBet;
      raiseCount = 1;
      // Re-open action: everyone else who has acted needs to act again
      reopenAction(seats, action.seat);
      if (s.stack === 0) s.status = 'all_in';
      logged = { action: 'bet', amount: pay, toCall: 0 };
      break;
    }
    case 'raise':
    case 'all_in': {
      const amt = action.amount ?? (s.committedThisRound + s.stack);
      if (amt <= currentBet) throw new Error('raise must exceed current bet');
      const totalCommit = Math.min(amt, s.committedThisRound + s.stack);
      const raiseIncrement = totalCommit - currentBet;
      const minRaiseInc = Math.max(lastRaise, state.config.bigBlind);
      const isAllIn = totalCommit === s.committedThisRound + s.stack;

      if (!isAllIn && raiseIncrement < minRaiseInc) {
        throw new Error(`raise increment < min (${raiseIncrement} < ${minRaiseInc})`);
      }
      const pay = totalCommit - s.committedThisRound;
      s.stack -= pay;
      s.committedThisRound = totalCommit;
      s.committedTotal += pay;
      pot += pay;

      // Reopen action only if raise meets min-raise requirement.
      // Short all-in (less than min raise) does NOT reopen for players who already acted.
      const reopens = raiseIncrement >= minRaiseInc;
      currentBet = totalCommit;
      if (reopens) {
        lastRaise = raiseIncrement;
        raiseCount++;
        reopenAction(seats, action.seat);
      }
      if (s.stack === 0) s.status = 'all_in';
      logged = { action: action.type, amount: pay, toCall };
      break;
    }
    case 'time_out': {
      // auto-fold (or auto-check if free)
      if (toCall === 0) {
        logged = { action: 'check', amount: 0, toCall: 0 };
      } else {
        s.status = 'folded';
        logged = { action: 'fold', amount: 0, toCall };
      }
      break;
    }
    default:
      throw new Error(`unknown action: ${action.type}`);
  }

  s.hasActed = true;

  log.push({
    seq,
    seat: action.seat,
    userId: s.userId,
    action: logged.action,
    amount: logged.amount,
    phase,
    potAfter: pot,
    toCall: logged.toCall,
  });

  // Determine next state
  let next: GameState = {
    ...state,
    seats,
    pot,
    currentBet,
    lastRaise,
    raiseCount,
    log,
  };

  // If only one seat left in hand → award immediately, no showdown needed.
  const remaining = seats.filter(x => x.status === 'active' || x.status === 'all_in');
  if (remaining.length === 1) {
    next = awardUncontested(next, remaining[0]!.idx);
    return { state: next, endedPhase: true, endedHand: true, showdownNeeded: false };
  }

  // If betting round complete → advance phase
  if (bettingRoundComplete(next)) {
    next = advancePhase(next);
    if (next.phase === 'showdown' || next.phase === 'complete') {
      return { state: next, endedPhase: true, endedHand: true, showdownNeeded: next.phase === 'showdown' };
    }
    return { state: next, endedPhase: true, endedHand: false, showdownNeeded: false };
  }

  // Otherwise: pass action to next active seat
  const nxt = nextActionableSeat(next, action.seat);
  next = { ...next, toAct: nxt >= 0 ? nxt : null, actionDeadline: Date.now() + state.config.actionTimeoutMs };
  return { state: next, endedPhase: false, endedHand: false, showdownNeeded: false };
}

function reopenAction(seats: Seat[], aggressor: number) {
  // Everyone who is active and not the aggressor must re-act.
  for (const s of seats) {
    if (s.idx === aggressor) continue;
    if (s.status === 'active') s.hasActed = false;
  }
}

function bettingRoundComplete(state: GameState): boolean {
  const inHand = state.seats.filter(s => s.status === 'active' || s.status === 'all_in');
  if (inHand.length <= 1) return true;

  // All active players must have acted and matched currentBet (or be all-in)
  for (const s of state.seats) {
    if (s.status === 'active') {
      if (!s.hasActed) return false;
      if (s.committedThisRound < state.currentBet) return false;
    }
  }

  // If preflop and only the BB hasn't been raised on, BB still has option to raise
  // (handled by hasActed flag — BB.hasActed starts false; advancing requires BB to act)
  // Special case: heads-up preflop — SB acts first, BB acts last.

  return true;
}

// ─── Phase progression ───────────────────────────────────────────────────────

function advancePhase(state: GameState): GameState {
  const seats = state.seats.map(s => ({ ...s, committedThisRound: 0, hasActed: false }));

  // If all but one are all-in, run out remaining streets without action
  const stillActing = seats.filter(s => s.status === 'active');
  let phase: Phase = state.phase;
  let board = [...state.board];
  let deck = state.deck;
  let deckPos = state.deckPos;

  const nextPhase = (p: Phase): Phase => {
    switch (p) {
      case 'preflop': return 'flop';
      case 'flop':    return 'turn';
      case 'turn':    return 'river';
      case 'river':   return 'showdown';
      default:        return p;
    }
  };

  phase = nextPhase(phase);
  // Burn + deal community (1 burn + 3/1/1)
  const dealCount = phase === 'flop' ? 3 : phase === 'turn' || phase === 'river' ? 1 : 0;
  if (dealCount > 0) {
    deckPos += 1; // burn
    for (let i = 0; i < dealCount; i++) board.push(deck[deckPos++]!);
  }

  const next: GameState = {
    ...state,
    seats,
    phase,
    board,
    deckPos,
    currentBet: 0,
    lastRaise: state.config.bigBlind,
    raiseCount: 0,
  };

  // If only ≤1 player can still act, skip betting and run all streets to showdown.
  if (stillActing.length <= 1 && phase !== 'showdown') {
    return advancePhase({ ...next, toAct: null });
  }

  if (phase === 'showdown') {
    return { ...next, toAct: null };
  }

  // First to act post-flop: first active seat clockwise from dealer
  const firstAct = nextActiveAfter(seats, state.dealerSeat);
  return {
    ...next,
    toAct: firstAct >= 0 ? firstAct : null,
    actionDeadline: Date.now() + state.config.actionTimeoutMs,
  };
}

// ─── Award uncontested pot (everyone else folded) ─────────────────────────────

function awardUncontested(state: GameState, winnerSeat: number): GameState {
  const winner = state.seats[winnerSeat]!;
  const rake = computeRake(state, state.pot, /*contested=*/ false);
  const award = state.pot - rake;
  const seats = state.seats.map(s => ({ ...s }));
  seats[winnerSeat]!.stack += award;

  return {
    ...state,
    seats,
    pot: 0,
    rakeTaken: state.rakeTaken + rake,
    phase: 'complete',
    toAct: null,
    pendingPayouts: [
      { seat: winnerSeat, userId: winner.userId, amount: award, rank: 0, value: 0n },
    ],
  };
}

// ─── Showdown: build side pots, evaluate, distribute ────────────────────────

export function showdown(state: GameState): GameState {
  const sidePots = buildSidePots(state);
  const evals = new Map<number, HandValue>();
  for (const s of state.seats) {
    if ((s.status === 'active' || s.status === 'all_in') && s.holeCards) {
      const cards = [...s.holeCards, ...state.board];
      evals.set(s.idx, evaluate(cards));
    }
  }

  const seats = state.seats.map(s => ({ ...s }));
  const payouts: Array<{ seat: number; userId: string | null; amount: number; rank: number; value: bigint }> = [];
  let totalRakeTaken = state.rakeTaken;

  for (const pot of sidePots) {
    const eligibles = pot.eligibleSeats.filter(i => evals.has(i));
    if (eligibles.length === 0) continue;

    // Find best hand among eligibles
    let bestVal = -1n;
    for (const i of eligibles) {
      const v = evals.get(i)!.value;
      if (v > bestVal) bestVal = v;
    }
    const winners = eligibles.filter(i => evals.get(i)!.value === bestVal);

    const rake = computeRake(state, pot.amount, /*contested=*/ true);
    const distributable = pot.amount - rake;
    totalRakeTaken += rake;

    const share = Math.floor(distributable / winners.length);
    let remainder = distributable - share * winners.length;

    // Remainder goes to first winner left of dealer (poker convention)
    const orderedWinners = orderClockwiseFromDealer(state.dealerSeat, winners, state.seats.length);

    for (const w of orderedWinners) {
      const give = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      seats[w]!.stack += give;
      const ev = evals.get(w)!;
      payouts.push({ seat: w, userId: seats[w]!.userId, amount: give, rank: ev.rank, value: ev.value });
    }
  }

  return {
    ...state,
    seats,
    sidePots,
    pot: 0,
    rakeTaken: totalRakeTaken,
    phase: 'complete',
    toAct: null,
    pendingPayouts: payouts,
  };
}

function orderClockwiseFromDealer(dealer: number, seats: number[], total: number): number[] {
  return [...seats].sort((a, b) => {
    const da = (a - dealer + total) % total;
    const db = (b - dealer + total) % total;
    return da - db;
  });
}

function computeRake(state: GameState, potSize: number, contested: boolean): number {
  if (!contested) return 0;
  if (state.config.rakeBps === 0) return 0;
  // Don't rake if the flop wasn't seen
  if (state.phase === 'preflop' || state.board.length === 0) return 0;
  const rake = Math.floor((potSize * state.config.rakeBps) / 10000);
  if (state.config.rakeCap > 0) return Math.min(rake, state.config.rakeCap);
  return rake;
}

// ─── Multi-board showdown (Run It Twice / Three Times) ────────────────────────
//
// When the action is locked (everyone in the hand is committed) and at least
// one street remains undealt, players can agree to run the remaining streets
// 2 or 3 times. The pot is split into N equal shares (rake taken from each).
// Each share is awarded to the winner of one independent run.
//
// Caller responsibilities:
//   • Build the alternate boards via buildRunBoards() in run-it-twice.ts.
//   • Pass them in here as `boards` (length === runCount).
//
// Each board is fully evaluated against each player's hole cards.

import { buildRunBoards } from './run-it-twice';

export interface MultiBoardResult extends GameState {
  /** Per-board, per-seat winnings. */
  boardPayouts: Array<Array<{ seat: number; userId: string | null; amount: number; rank: number; value: bigint }>>;
  /** All boards (5 cards each). */
  boards: number[][];
}

export function showdownMulti(
  state: GameState,
  boards: number[][]
): MultiBoardResult {
  const runCount = boards.length;
  if (runCount < 1 || runCount > 3) throw new Error(`bad run count: ${runCount}`);

  const sidePots = buildSidePots(state);
  const seats = state.seats.map(s => ({ ...s }));
  const allPayouts: Array<{ seat: number; userId: string | null; amount: number; rank: number; value: bigint }> = [];
  const boardPayouts: MultiBoardResult['boardPayouts'] = [];
  let totalRakeTaken = state.rakeTaken;

  for (let r = 0; r < runCount; r++) {
    const board = boards[r]!;
    const evals = new Map<number, HandValue>();
    for (const s of state.seats) {
      if ((s.status === 'active' || s.status === 'all_in') && s.holeCards) {
        evals.set(s.idx, evaluate([...s.holeCards, ...board]));
      }
    }
    const thisRunPayouts: typeof allPayouts = [];

    for (const pot of sidePots) {
      const eligibles = pot.eligibleSeats.filter(i => evals.has(i));
      if (eligibles.length === 0) continue;
      let bestVal = -1n;
      for (const i of eligibles) {
        const v = evals.get(i)!.value;
        if (v > bestVal) bestVal = v;
      }
      const winners = eligibles.filter(i => evals.get(i)!.value === bestVal);

      // Each run gets 1/runCount of each pot. Rake is taken proportionally.
      const runShareGross = Math.floor(pot.amount / runCount);
      const remainderRun = (r === runCount - 1) ? (pot.amount - runShareGross * runCount) : 0;
      const runShare = runShareGross + remainderRun;

      const rake = computeRake(state, runShare, /*contested=*/ true);
      const distributable = runShare - rake;
      totalRakeTaken += rake;

      const each = Math.floor(distributable / winners.length);
      let extra = distributable - each * winners.length;
      const orderedWinners = orderClockwiseFromDealer(state.dealerSeat, winners, state.seats.length);
      for (const w of orderedWinners) {
        const give = each + (extra > 0 ? 1 : 0);
        if (extra > 0) extra--;
        seats[w]!.stack += give;
        const ev = evals.get(w)!;
        thisRunPayouts.push({ seat: w, userId: seats[w]!.userId, amount: give, rank: ev.rank, value: ev.value });
        allPayouts.push({ seat: w, userId: seats[w]!.userId, amount: give, rank: ev.rank, value: ev.value });
      }
    }
    boardPayouts.push(thisRunPayouts);
  }

  return {
    ...state,
    seats,
    sidePots,
    pot: 0,
    rakeTaken: totalRakeTaken,
    phase: 'complete',
    toAct: null,
    pendingPayouts: allPayouts,
    boardPayouts,
    boards,
  };
}

/** Convenience: build the boards from current state and run multi showdown. */
export function showdownRunMultiple(
  state: GameState,
  runCount: 1 | 2 | 3
): MultiBoardResult {
  const phase = state.phase;
  const remaining: Array<'flop' | 'turn' | 'river'> =
    phase === 'preflop' ? ['flop', 'turn', 'river'] :
    phase === 'flop'    ? ['turn', 'river'] :
    phase === 'turn'    ? ['river'] : [];

  if (remaining.length === 0 || runCount === 1) {
    const r = showdown(state);
    return { ...r, boards: [state.board], boardPayouts: [r.pendingPayouts ?? []] };
  }
  const built = buildRunBoards(
    { deck: state.deck, deckPos: state.deckPos, remainingStreets: remaining, runCount },
    state.board
  );
  return showdownMulti(state, built.map(b => b.board));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export { emptyTable };
export type { GameState, Seat, GameConfig, ActionType, Phase };
