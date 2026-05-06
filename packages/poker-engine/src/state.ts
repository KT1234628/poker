import type { Card } from './cards';

export type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';
export type SeatStatus = 'empty' | 'active' | 'sitting_out' | 'all_in' | 'folded';
export type ActionType =
  | 'post_blind'
  | 'post_ante'
  | 'check'
  | 'call'
  | 'bet'
  | 'raise'
  | 'fold'
  | 'all_in'
  | 'time_out';

export interface Seat {
  idx: number;
  userId: string | null;
  stack: number;
  holeCards: [Card, Card] | null;
  status: SeatStatus;
  committedThisRound: number;       // chips put in pot in current betting round
  committedTotal: number;           // chips put in pot this hand (across rounds)
  hasActed: boolean;                // has acted in current betting round
  isDealer: boolean;
  isSb: boolean;
  isBb: boolean;
  showCards: boolean;               // chose to show at showdown
}

export interface SidePot {
  amount: number;                   // total chips in this pot
  eligibleSeats: number[];          // seats that can win this pot
}

export interface ActionLog {
  seq: number;
  seat: number;
  userId: string | null;
  action: ActionType;
  amount: number;
  phase: Phase;
  potAfter: number;
  toCall: number;
}

export interface GameConfig {
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  rakeBps: number;                  // basis points
  rakeCap: number;                  // 0 = no cap
  actionTimeoutMs: number;
  timeBankMs: number;
}

export interface GameState {
  tableId: string;
  handId: string;
  handNumber: number;
  phase: Phase;
  seats: Seat[];
  dealerSeat: number;
  sbSeat: number;
  bbSeat: number;
  pot: number;                      // total chips committed to all pots (incl current round)
  sidePots: SidePot[];              // computed at showdown
  board: Card[];
  toAct: number | null;
  currentBet: number;               // amount any active player must match
  lastRaise: number;                // last raise increment (for min-raise)
  raiseCount: number;
  actionDeadline: number;           // unix ms
  config: GameConfig;
  deck: Card[];
  deckPos: number;
  log: ActionLog[];
  rakeTaken: number;
  // Showdown / award:
  pendingPayouts?: Array<{ seat: number; userId: string | null; amount: number; rank: number; value: bigint }>;
}

export function emptyTable(tableId: string, handId: string, config: GameConfig): GameState {
  const seats: Seat[] = [];
  for (let i = 0; i < config.maxSeats; i++) {
    seats.push({
      idx: i,
      userId: null,
      stack: 0,
      holeCards: null,
      status: 'empty',
      committedThisRound: 0,
      committedTotal: 0,
      hasActed: false,
      isDealer: false,
      isSb: false,
      isBb: false,
      showCards: false,
    });
  }
  return {
    tableId,
    handId,
    handNumber: 0,
    phase: 'complete',
    seats,
    dealerSeat: -1,
    sbSeat: -1,
    bbSeat: -1,
    pot: 0,
    sidePots: [],
    board: [],
    toAct: null,
    currentBet: 0,
    lastRaise: 0,
    raiseCount: 0,
    actionDeadline: 0,
    config,
    deck: [],
    deckPos: 0,
    log: [],
    rakeTaken: 0,
  };
}

export function activeSeats(state: GameState): Seat[] {
  return state.seats.filter(s => s.status === 'active' || s.status === 'all_in');
}

export function inHandSeats(state: GameState): Seat[] {
  return state.seats.filter(s => s.status !== 'empty' && s.status !== 'sitting_out' && s.status !== 'folded');
}

export function nextOccupiedSeat(state: GameState, from: number): number {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const s = state.seats[idx]!;
    if (s.status !== 'empty' && s.status !== 'sitting_out') return idx;
  }
  return -1;
}

export function nextActionableSeat(state: GameState, from: number): number {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const s = state.seats[idx]!;
    if (s.status === 'active') return idx;
  }
  return -1;
}
