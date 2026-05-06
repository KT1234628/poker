import { ClientMessageSchema, ErrorCodes, type ServerMessage } from '@stacks/shared-types';
import type { WebSocket } from 'ws';
import { verifySessionToken, type SessionClaims } from './auth.js';
import { db } from './db.js';
import { log } from './log.js';
import { manager } from './manager.js';
import { createLimiter, DEFAULT_BUCKETS } from './rate-limit.js';

interface ConnectionState {
  ws: WebSocket;
  ip: string;
  claims: SessionClaims | null;
  username: string | null;
  attachedTableId: string | null;
  attachedSeat: number | null;
  helloDeadline: NodeJS.Timeout | null;
  pingInterval: NodeJS.Timeout | null;
  closed: boolean;
}

const HELLO_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 30_000;
const MAX_FRAME_BYTES = 16 * 1024;

export function handleConnection(ws: WebSocket, ip: string) {
  const limiter = createLimiter(DEFAULT_BUCKETS);
  const conn: ConnectionState = {
    ws,
    ip,
    claims: null,
    username: null,
    attachedTableId: null,
    attachedSeat: null,
    helloDeadline: setTimeout(() => closeWithError(conn, 'auth_required', 'no hello'), HELLO_TIMEOUT_MS),
    pingInterval: null,
    closed: false,
  };

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return closeWithError(conn, 'protocol_error', 'binary not allowed');
    if (raw instanceof Buffer && raw.length > MAX_FRAME_BYTES) return closeWithError(conn, 'protocol_error', 'frame too large');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return closeWithError(conn, 'protocol_error', 'invalid json');
    }

    const msg = ClientMessageSchema.safeParse(parsed);
    if (!msg.success) return sendError(conn, 'protocol_error', msg.error.message);

    if (!limiter.consume(msg.data.type === 'action' ? 'action' : msg.data.type === 'chat' ? 'chat' : msg.data.type === 'ping' ? 'ping' : 'any')) {
      return sendError(conn, 'rate_limited', `too many ${msg.data.type}`, msg.data.id);
    }

    void route(conn, msg.data).catch(err => {
      log.error({ err: (err as Error).message, type: msg.data.type }, 'route error');
      sendError(conn, 'server_error', 'internal error', msg.data.id);
    });
  });

  ws.on('close', () => onClose(conn));
  ws.on('error', err => log.warn({ err }, 'ws error'));
}

async function route(conn: ConnectionState, msg: import('@stacks/shared-types').ClientMessage) {
  switch (msg.type) {
    case 'hello': {
      let claims: SessionClaims;
      try {
        claims = await verifySessionToken(msg.payload.sessionToken);
      } catch (e) {
        return closeWithError(conn, 'invalid_token', (e as Error).message);
      }
      // KYC gate
      if (claims.kyc !== 'approved') {
        return closeWithError(conn, 'kyc_required', 'kyc required');
      }
      conn.claims = claims;
      conn.username = claims.username;
      if (conn.helloDeadline) {
        clearTimeout(conn.helloDeadline);
        conn.helloDeadline = null;
      }
      conn.pingInterval = setInterval(() => {
        if (conn.ws.readyState === conn.ws.OPEN) conn.ws.ping();
      }, PING_INTERVAL_MS);

      await db.from('session_events').insert({
        user_id: claims.sub,
        event: 'connected',
        ip: conn.ip,
        user_agent: msg.payload.userAgent.slice(0, 256),
        metadata: { fp: msg.payload.deviceFingerprint, sid: claims.jti },
      });

      sendOk(conn, { sub: claims.sub, jti: claims.jti }, msg.id);
      return;
    }

    case 'ping': {
      send(conn, { type: 'pong', v: 1, payload: { ts: msg.payload.ts, serverTs: Date.now() } });
      return;
    }
  }

  if (!conn.claims) return sendError(conn, 'auth_required', 'hello first', msg.id);

  switch (msg.type) {
    case 'join_table': {
      const room = await manager.getOrCreate(msg.payload.tableId);
      if (!room) return sendError(conn, 'not_found', 'table not on this shard', msg.id);
      const result = await room.sitDown({
        userId: conn.claims.sub,
        username: conn.claims.username,
        seatIdx: msg.payload.seatIdx,
        buyin: msg.payload.buyin,
      });
      if (!result.ok) return sendError(conn, mapReason(result.reason), result.reason, msg.id);

      conn.attachedTableId = msg.payload.tableId;
      conn.attachedSeat = msg.payload.seatIdx;
      room.attachSeat(msg.payload.seatIdx, {
        userId: conn.claims.sub,
        username: conn.claims.username,
        send: m => send(conn, m),
      });
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'leave_table': {
      const room = await manager.getOrCreate(msg.payload.tableId);
      if (!room) return sendError(conn, 'not_found', '', msg.id);
      await room.standUp({ userId: conn.claims.sub, seatIdx: msg.payload.seatIdx });
      conn.attachedTableId = null;
      conn.attachedSeat = null;
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'action': {
      const room = await manager.getOrCreate(msg.payload.tableId);
      if (!room) return sendError(conn, 'not_found', '', msg.id);
      // Map external action names to engine action types
      const map: Record<string, import('@stacks/poker-engine').ActionType> = {
        fold: 'fold', check: 'check', call: 'call', bet: 'bet', raise: 'raise', all_in: 'all_in',
      };
      const type = map[msg.payload.action];
      if (!type) return sendError(conn, 'invalid_action', 'bad action', msg.id);
      const seatIdx = conn.attachedSeat ?? -1;
      const result = await room.applyPlayerAction({
        seatIdx, type, amount: msg.payload.amount, userId: conn.claims.sub,
      });
      if (!result.ok) return sendError(conn, mapReason(result.reason), result.reason, msg.id);
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'chat': {
      const room = await manager.getOrCreate(msg.payload.tableId);
      if (!room) return sendError(conn, 'not_found', '', msg.id);
      await room.chat({
        userId: conn.claims.sub,
        username: conn.claims.username,
        content: msg.payload.content,
      });
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'rit_vote': {
      const room = await manager.getOrCreate(msg.payload.tableId);
      if (!room || conn.attachedSeat === null) return sendError(conn, 'not_found', '', msg.id);
      const ok = await room.submitRitVote(conn.attachedSeat, msg.payload.runCount);
      if (!ok) return sendError(conn, 'invalid_action', 'no active vote', msg.id);
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'sit_out': {
      const room = await manager.getOrCreate(msg.payload.tableId);
      if (!room) return sendError(conn, 'not_found', '', msg.id);
      room.sitOutSeat(conn.claims.sub);
      sendOk(conn, undefined, msg.id);
      return;
    }
    case 'sit_in': {
      const room = await manager.getOrCreate(msg.payload.tableId);
      if (!room) return sendError(conn, 'not_found', '', msg.id);
      room.sitInSeat(conn.claims.sub);
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'straddle': {
      const room = await manager.getOrCreate(msg.payload.tableId);
      if (!room) return sendError(conn, 'not_found', '', msg.id);
      room.optInStraddleForNextHand(conn.claims.sub);
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'show_option': {
      // Persist the player's show-card choice; the winner-reveal logic at
      // showdown reads `hand_results.show_choice`.
      await db.from('hand_results').update({ show_choice: msg.payload.choice })
        .eq('hand_id', msg.payload.handId)
        .eq('user_id', conn.claims.sub);
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'tournament_register':
    case 'tournament_re_entry': {
      // Tournament registrations go through the HTTP /api/tournaments route — but
      // we accept this message to ack from a connected player so the client can
      // single-source through the WS.
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'time_bank_use': {
      // Server-side time-bank tick is automatic when action timer expires.
      // This message is a no-op stub kept for future per-action requests.
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'waitlist_join': {
      await db.from('table_waitlist').insert({
        table_id: msg.payload.tableId,
        user_id: conn.claims.sub,
      });
      sendOk(conn, undefined, msg.id);
      return;
    }
    case 'waitlist_leave': {
      await db.from('table_waitlist').delete()
        .eq('table_id', msg.payload.tableId)
        .eq('user_id', conn.claims.sub);
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'satellite_unregister_for_cash': {
      // Refund the ticket value via the satellite handler (handled in route).
      // Wire-only ack here.
      sendOk(conn, undefined, msg.id);
      return;
    }

    case 'show_cards': {
      // Public message that triggers reveal at showdown — already routed via
      // show_option.
      sendOk(conn, undefined, msg.id);
      return;
    }

    default:
      sendError(conn, 'protocol_error', 'unhandled', msg.id);
  }
}

function onClose(conn: ConnectionState) {
  if (conn.closed) return;
  conn.closed = true;
  if (conn.helloDeadline) clearTimeout(conn.helloDeadline);
  if (conn.pingInterval) clearInterval(conn.pingInterval);
  if (conn.attachedTableId !== null && conn.attachedSeat !== null) {
    void manager.getOrCreate(conn.attachedTableId).then(room => {
      if (!room) return;
      room.detachSeat(conn.attachedSeat!);
    });
  }
  if (conn.claims) {
    void db.from('session_events').insert({
      user_id: conn.claims.sub,
      event: 'disconnected',
      ip: conn.ip,
      metadata: { sid: conn.claims.jti },
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function send(conn: ConnectionState, msg: ServerMessage) {
  if (conn.closed || conn.ws.readyState !== conn.ws.OPEN) return;
  conn.ws.send(JSON.stringify(msg), { binary: false });
}

function sendOk(conn: ConnectionState, payload?: unknown, id?: string) {
  send(conn, { type: 'ok', v: 1, ...(id ? { id } : {}), payload: payload as Record<string, unknown> | undefined });
}

function sendError(conn: ConnectionState, code: string, message: string, id?: string) {
  send(conn, { type: 'error', v: 1, ...(id ? { id } : {}), payload: { code, message } });
}

function closeWithError(conn: ConnectionState, code: string, message: string) {
  sendError(conn, code, message);
  try { conn.ws.close(4000, code); } catch {}
}

function mapReason(reason: string): string {
  if (reason === 'kyc_required') return ErrorCodes.KYC_REQUIRED;
  if (reason === 'insufficient_chips') return ErrorCodes.INSUFFICIENT_FUNDS;
  if (reason === 'self_excluded') return ErrorCodes.SELF_EXCLUDED;
  if (reason === 'account_banned') return ErrorCodes.BANNED;
  if (reason === 'seat_taken') return ErrorCodes.SEAT_TAKEN;
  if (reason === 'already_seated') return ErrorCodes.ALREADY_SEATED;
  if (reason === 'not_your_turn') return ErrorCodes.NOT_YOUR_TURN;
  return ErrorCodes.INVALID_ACTION;
}
