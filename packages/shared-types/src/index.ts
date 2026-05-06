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
  | BalanceUpdateMessage;

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
