import { z } from 'zod';

// ─── WebSocket protocol (client ↔ game server) ────────────────────────────────
//
// All messages are JSON envelopes:
//   { v: 1, type: '...', id?: '...', payload: { ... } }
//
// Client → Server messages have an optional `id` for correlated replies.
// Server → Client messages are either directed replies (same id), errors,
// or broadcasts (no id).

export const WS_PROTOCOL_VERSION = 1;

// ─── Inbound (client → server) ────────────────────────────────────────────────

export const ClientHelloSchema = z.object({
  type: z.literal('hello'),
  v: z.literal(1),
  id: z.string().min(1).max(64).optional(),
  payload: z.object({
    sessionToken: z.string(),                 // signed by web app, contains userId + scope
    deviceFingerprint: z.string().min(8).max(128),
    userAgent: z.string().max(512),
  }),
});

export const JoinTableSchema = z.object({
  type: z.literal('join_table'),
  v: z.literal(1),
  id: z.string().min(1).max(64).optional(),
  payload: z.object({
    tableId: z.string().uuid(),
    seatIdx: z.number().int().min(0).max(9),
    buyin: z.number().int().positive(),
  }),
});

export const LeaveTableSchema = z.object({
  type: z.literal('leave_table'),
  v: z.literal(1),
  id: z.string().min(1).max(64).optional(),
  payload: z.object({
    tableId: z.string().uuid(),
    seatIdx: z.number().int().min(0).max(9),
  }),
});

export const SitOutSchema = z.object({
  type: z.literal('sit_out'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ tableId: z.string().uuid() }),
});

export const SitInSchema = z.object({
  type: z.literal('sit_in'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ tableId: z.string().uuid() }),
});

export const PlayerActionSchema = z.object({
  type: z.literal('action'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({
    tableId: z.string().uuid(),
    handId: z.string().uuid(),
    action: z.enum(['fold', 'check', 'call', 'bet', 'raise', 'all_in']),
    amount: z.number().int().min(0).optional(),
    clientNonce: z.string().min(8).max(64),    // dedupe window
  }),
});

export const ChatSchema = z.object({
  type: z.literal('chat'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({
    tableId: z.string().uuid(),
    content: z.string().min(1).max(280),
  }),
});

export const HeartbeatSchema = z.object({
  type: z.literal('ping'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ ts: z.number() }),
});

export const ShowCardsSchema = z.object({
  type: z.literal('show_cards'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ tableId: z.string().uuid(), handId: z.string().uuid() }),
});

export const RegisterTournamentSchema = z.object({
  type: z.literal('tournament_register'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ tournamentId: z.string().uuid() }),
});

// ── New protocol messages for engine + tournament features ───────────────────

// Run-It-Twice vote (client → server). Player votes whether to run multiple
// boards when an all-in lock occurs.
export const RunItVoteSchema = z.object({
  type: z.literal('rit_vote'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({
    tableId: z.string().uuid(),
    handId: z.string().uuid(),
    runCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
});

// Show one / show both at end of hand
export const ShowOptionSchema = z.object({
  type: z.literal('show_option'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({
    tableId: z.string().uuid(),
    handId: z.string().uuid(),
    choice: z.enum(['show_both', 'show_one_low', 'show_one_high', 'muck']),
  }),
});

// Straddle declaration (preflop, before any cards)
export const StraddleSchema = z.object({
  type: z.literal('straddle'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({
    tableId: z.string().uuid(),
    amount: z.number().int().positive(),
  }),
});

// Re-entry into a tournament after busting
export const ReEntrySchema = z.object({
  type: z.literal('tournament_re_entry'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ tournamentId: z.string().uuid() }),
});

// Unregister from a satellite (cash-out the ticket value)
export const UnregisterSatelliteSchema = z.object({
  type: z.literal('satellite_unregister_for_cash'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ ticketId: z.string().uuid() }),
});

// Use a time-bank "tick" — invoke when the action timer expires
export const TimeBankUseSchema = z.object({
  type: z.literal('time_bank_use'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ tableId: z.string().uuid() }),
});

// Join the waitlist for a table
export const WaitlistJoinSchema = z.object({
  type: z.literal('waitlist_join'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ tableId: z.string().uuid() }),
});
export const WaitlistLeaveSchema = z.object({
  type: z.literal('waitlist_leave'),
  v: z.literal(1),
  id: z.string().optional(),
  payload: z.object({ tableId: z.string().uuid() }),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientHelloSchema,
  JoinTableSchema,
  LeaveTableSchema,
  SitOutSchema,
  SitInSchema,
  PlayerActionSchema,
  ChatSchema,
  HeartbeatSchema,
  ShowCardsSchema,
  RegisterTournamentSchema,
  RunItVoteSchema,
  ShowOptionSchema,
  StraddleSchema,
  ReEntrySchema,
  UnregisterSatelliteSchema,
  TimeBankUseSchema,
  WaitlistJoinSchema,
  WaitlistLeaveSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ─── Outbound (server → client) ───────────────────────────────────────────────

export interface ServerErrorMessage {
  type: 'error';
  v: 1;
  id?: string;
  payload: { code: string; message: string; retryAfterMs?: number };
}

export interface ServerOkMessage {
  type: 'ok';
  v: 1;
  id?: string;
  payload?: Record<string, unknown>;
}

export interface PongMessage {
  type: 'pong';
  v: 1;
  payload: { ts: number; serverTs: number };
}

// Public seat (visible to all observers)
export interface PublicSeat {
  idx: number;
  userId: string | null;
  username?: string;
  avatarUrl?: string;
  stack: number;
  status: 'empty' | 'active' | 'sitting_out' | 'all_in' | 'folded' | 'reserved';
  isDealer: boolean;
  isSb: boolean;
  isBb: boolean;
  committedThisRound: number;
  hasActed: boolean;
}

// State broadcast at every visible change
export interface TableStateSnapshot {
  tableId: string;
  handId: string | null;
  handNumber: number;
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete' | 'idle';
  seats: PublicSeat[];
  dealerSeat: number;
  pot: number;
  sidePots: Array<{ amount: number; eligibleSeats: number[] }>;
  board: number[];                              // 0..51 cards
  toAct: number | null;
  currentBet: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  minRaise: number;
  actionDeadline: number | null;                // unix ms
  serverTs: number;
}

// Sent privately to the seated player (their hole cards)
export interface PrivateHoleCards {
  type: 'hole_cards';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    seatIdx: number;
    cards: [number, number];
    commitment: string;                         // sha256 commitment to deck
  };
}

// Public action announcement
export interface ActionEventMessage {
  type: 'action_event';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    seatIdx: number;
    action: 'post_blind' | 'post_ante' | 'check' | 'call' | 'bet' | 'raise' | 'fold' | 'all_in' | 'time_out';
    amount: number;
    potAfter: number;
    serverTs: number;
  };
}

export interface PhaseEventMessage {
  type: 'phase_event';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    phase: 'flop' | 'turn' | 'river' | 'showdown';
    board: number[];
  };
}

export interface ShowdownEventMessage {
  type: 'showdown';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    reveals: Array<{ seatIdx: number; cards: [number, number]; rank: number; description: string }>;
    payouts: Array<{ seatIdx: number; userId: string | null; amount: number }>;
    seedReveal: { serverSeed: string; nonce: string; clientEntropy: string }; // for verification
  };
}

export interface ChatEventMessage {
  type: 'chat_event';
  v: 1;
  payload: {
    tableId: string;
    userId: string;
    username: string;
    content: string;
    serverTs: number;
  };
}

export interface LobbyUpdateMessage {
  type: 'lobby_update';
  v: 1;
  payload: {
    addedTables?: TableSummary[];
    removedTableIds?: string[];
    updatedTables?: Array<Partial<TableSummary> & { id: string }>;
  };
}

export interface TableSummary {
  id: string;
  name: string;
  kind: 'cash' | 'sng' | 'mtt';
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  seated: number;
  avgPot: number;
  handsPerHour: number;
}

export interface BalanceUpdateMessage {
  type: 'balance_update';
  v: 1;
  payload: { chips: number; lockedChips: number };
}

// ─── New event messages for engine + tournament features ────────────────────

export interface RitOfferMessage {
  type: 'rit_offer';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    /** Seats whose votes are needed (subset of in-hand seats). */
    decisionSeats: number[];
    /** Max run-count permitted by the table. */
    maxRunCount: 1 | 2 | 3;
    /** Vote deadline (unix ms). */
    deadline: number;
  };
}

export interface RitDecidedMessage {
  type: 'rit_decided';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    runCount: 1 | 2 | 3;
    /** All boards (5 cards each) that will be run. */
    boards: number[][];
  };
}

/** Multi-board showdown (replaces the standard `showdown` event when runCount > 1). */
export interface MultiShowdownEventMessage {
  type: 'showdown_multi';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    runCount: 1 | 2 | 3;
    boards: number[][];
    reveals: Array<{ seatIdx: number; cards: [number, number] }>;
    /** Per-board payouts. Index 0 = first run, etc. */
    boardPayouts: Array<Array<{
      seatIdx: number;
      userId: string | null;
      amount: number;
      rank: number;
      description: string;
    }>>;
    seedReveal: { serverSeed: string; nonce: string; clientEntropy: string };
  };
}

export interface BombPotEventMessage {
  type: 'bomb_pot';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    ante: number;
    contributors: number[];
    flop: number[];
  };
}

export interface BountyEventMessage {
  type: 'bounty_collected';
  v: 1;
  payload: {
    tournamentId: string;
    handId: string;
    koUserId: string;
    koByUserId: string;
    bountyAmount: number;
    addedToHead: number;
    isMystery: boolean;
    mysteryBucket?: string;
  };
}

export interface TournamentTickerMessage {
  type: 'tournament_ticker';
  v: 1;
  payload: {
    tournamentId: string;
    registeredCount: number;
    activeCount: number;
    averageStack: number;
    currentLevel: number;
    blindLevel: { sb: number; bb: number; ante: number };
    secondsLeftInLevel: number;
    inBreak: boolean;
    prizePool: number;
    nextPayout?: { place: number; prize: number };
  };
}

export interface SatelliteAwardMessage {
  type: 'satellite_award';
  v: 1;
  payload: {
    tournamentId: string;
    targetTournamentId: string;
    place: number;
    ticketId: string;
  };
}

export interface WaitlistMessage {
  type: 'waitlist_update';
  v: 1;
  payload: {
    tableId: string;
    position: number;     // 1-based
    notified: boolean;
  };
}

export interface SitOutWarningMessage {
  type: 'sit_out_warning';
  v: 1;
  payload: {
    tableId: string;
    consecutive: number;
    max: number;
    handsUntilStandUp: number;
  };
}

export interface DisconnectProtectionMessage {
  type: 'disconnect_protection';
  v: 1;
  payload: {
    tableId: string;
    handId: string;
    seatIdx: number;
    secondsRemaining: number;
  };
}

export type ServerMessage =
  | ServerErrorMessage
  | ServerOkMessage
  | PongMessage
  | { type: 'state'; v: 1; payload: TableStateSnapshot }
  | PrivateHoleCards
  | ActionEventMessage
  | PhaseEventMessage
  | ShowdownEventMessage
  | ChatEventMessage
  | LobbyUpdateMessage
  | BalanceUpdateMessage
  | RitOfferMessage
  | RitDecidedMessage
  | MultiShowdownEventMessage
  | BombPotEventMessage
  | BountyEventMessage
  | TournamentTickerMessage
  | SatelliteAwardMessage
  | WaitlistMessage
  | SitOutWarningMessage
  | DisconnectProtectionMessage;

// ─── HTTP API schemas (for /api routes) ───────────────────────────────────────

export const WalletConnectChallengeSchema = z.object({
  walletAddress: z.string().min(32).max(64),
  chain: z.literal('solana').default('solana'),
});

export const WalletVerifySchema = z.object({
  walletAddress: z.string().min(32).max(64),
  signature: z.string(),                        // base58
  challenge: z.string(),
});

export const WithdrawRequestSchema = z.object({
  amount: z.number().int().positive(),
  walletAddress: z.string().min(32).max(64),
  userSignature: z.string(),                   // signed: "withdraw:<amount>:<wallet>:<nonce>"
  nonce: z.string(),
});

export const DepositConfirmSchema = z.object({
  txSignature: z.string(),
  walletAddress: z.string(),
});

export const LiveKitTokenRequestSchema = z.object({
  tableId: z.string().uuid(),
});

// ─── Common ────────────────────────────────────────────────────────────────────

export const ErrorCodes = {
  AUTH_REQUIRED: 'auth_required',
  INVALID_TOKEN: 'invalid_token',
  RATE_LIMITED: 'rate_limited',
  KYC_REQUIRED: 'kyc_required',
  INSUFFICIENT_FUNDS: 'insufficient_funds',
  INVALID_ACTION: 'invalid_action',
  NOT_YOUR_TURN: 'not_your_turn',
  TABLE_FULL: 'table_full',
  ALREADY_SEATED: 'already_seated',
  SEAT_TAKEN: 'seat_taken',
  GEO_BLOCKED: 'geo_blocked',
  SELF_EXCLUDED: 'self_excluded',
  BANNED: 'banned',
  PROTOCOL_ERROR: 'protocol_error',
  SERVER_ERROR: 'server_error',
  NOT_FOUND: 'not_found',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
