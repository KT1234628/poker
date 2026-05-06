import {
  applyAction,
  buildVerification,
  commit,
  emptyTable,
  legalActions,
  newServerSeed,
  seatPlayer,
  showdown as runShowdown,
  shuffleDeck,
  startHand,
  type ActionType,
  type GameState,
  type Seat,
} from '@stacks/poker-engine';
import type { TableStateSnapshot, PublicSeat, ServerMessage } from '@stacks/shared-types';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { db, rpc } from './db.js';
import { log } from './log.js';
import { Channels, publish, redis } from './redis.js';

interface ConnectedSeat {
  userId: string;
  username: string;
  send: (msg: ServerMessage) => void;
}

export interface RoomConfig {
  tableId: string;
  shard: number;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  rakeBps: number;
  rakeCap: number;
  actionTimeoutMs: number;
  timeBankMs: number;
  kind: 'cash' | 'sng' | 'mtt';
  tournamentId: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Room
// ─────────────────────────────────────────────────────────────────────────────

export class Room {
  state: GameState;
  config: RoomConfig;
  connections = new Map<number /*seatIdx*/, ConnectedSeat>();
  observers = new Set<{ userId: string; send: (msg: ServerMessage) => void }>();
  /** dealer seat index of the *previous* hand (for advancing the button) */
  private lastDealer = -1;
  private clientEntropy = '';
  private serverSeed = '';
  private nonce = '';
  private commitment = '';
  private actionTimer: NodeJS.Timeout | null = null;
  private starting = false;
  private destroyed = false;

  constructor(cfg: RoomConfig) {
    this.config = cfg;
    this.state = emptyTable(cfg.tableId, '', {
      maxSeats: cfg.maxSeats,
      smallBlind: cfg.smallBlind,
      bigBlind: cfg.bigBlind,
      ante: cfg.ante,
      rakeBps: cfg.rakeBps,
      rakeCap: cfg.rakeCap,
      actionTimeoutMs: cfg.actionTimeoutMs,
      timeBankMs: cfg.timeBankMs,
    });
  }

  destroy() {
    if (this.actionTimer) clearTimeout(this.actionTimer);
    this.destroyed = true;
    for (const [, c] of this.connections) {
      c.send({ type: 'state', v: 1, payload: this.snapshot() });
    }
    this.connections.clear();
    this.observers.clear();
  }

  // ─── Connection management ─────────────────────────────────────────────────

  attachObserver(o: { userId: string; send: (msg: ServerMessage) => void }) {
    this.observers.add(o);
    o.send({ type: 'state', v: 1, payload: this.snapshot() });
  }

  detachObserver(o: { userId: string; send: (msg: ServerMessage) => void }) {
    this.observers.delete(o);
  }

  attachSeat(seatIdx: number, conn: ConnectedSeat) {
    const seat = this.state.seats[seatIdx];
    if (!seat || seat.userId !== conn.userId) {
      log.warn({ seatIdx, userId: conn.userId }, 'attachSeat: seat mismatch');
      return;
    }
    this.connections.set(seatIdx, conn);
    conn.send({ type: 'state', v: 1, payload: this.snapshot() });
    // If a hand is in progress, send their hole cards
    const hc = seat.holeCards;
    if (hc) {
      conn.send({
        type: 'hole_cards',
        v: 1,
        payload: {
          tableId: this.config.tableId,
          handId: this.state.handId,
          seatIdx,
          cards: hc,
          commitment: this.commitment,
        },
      });
    }
  }

  detachSeat(seatIdx: number) {
    this.connections.delete(seatIdx);
  }

  // ─── Seat management ───────────────────────────────────────────────────────

  async sitDown(opts: {
    userId: string;
    username: string;
    seatIdx: number;
    buyin: number;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.state.seats[opts.seatIdx]?.status !== 'empty') {
      return { ok: false, reason: 'seat_taken' };
    }
    if (this.state.seats.find(s => s.userId === opts.userId)) {
      return { ok: false, reason: 'already_seated' };
    }

    // Validate via DB function (checks KYC, balance, table limits)
    try {
      const res = await rpc<Array<{ allowed: boolean; reason: string | null }>>(
        'can_join_table',
        { p_user_id: opts.userId, p_table_id: this.config.tableId, p_buyin: opts.buyin }
      );
      const decision = res[0];
      if (!decision || !decision.allowed) {
        return { ok: false, reason: decision?.reason ?? 'rejected' };
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, 'can_join_table failed');
      return { ok: false, reason: 'server_error' };
    }

    // Lock buyin from balance into stack
    try {
      await rpc('lock_buyin', {
        p_user_id: opts.userId,
        p_table_id: this.config.tableId,
        p_amount: opts.buyin,
      });
    } catch (e) {
      log.error({ err: (e as Error).message }, 'lock_buyin failed');
      return { ok: false, reason: 'insufficient_chips' };
    }

    // Reflect in memory
    this.state = seatPlayer(this.state, opts.seatIdx, opts.userId, opts.buyin);

    // Persist to DB
    await db.from('table_seats').upsert({
      table_id: this.config.tableId,
      seat_idx: opts.seatIdx,
      user_id: opts.userId,
      stack: opts.buyin,
      status: 'sitting_out',
    });

    this.broadcastState();

    // Try to start a hand
    void this.maybeStartHand();
    return { ok: true };
  }

  async standUp(opts: { userId: string; seatIdx: number }): Promise<void> {
    const s = this.state.seats[opts.seatIdx];
    if (!s || s.userId !== opts.userId) return;
    const stack = s.stack;
    // If currently in a hand, mark as leaving — they'll be removed at hand end
    if (s.status === 'active' || s.status === 'all_in') {
      this.state.seats[opts.seatIdx]!.status = 'sitting_out';   // sit out for next hand
    }
    // Refund stack to balance
    if (stack > 0) {
      try {
        await rpc('release_stack', {
          p_user_id: opts.userId,
          p_table_id: this.config.tableId,
          p_amount: stack,
        });
      } catch (e) {
        log.error({ err: (e as Error).message }, 'release_stack failed');
      }
    }
    this.state.seats[opts.seatIdx] = {
      idx: opts.seatIdx,
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
    };
    this.connections.delete(opts.seatIdx);
    await db
      .from('table_seats')
      .delete()
      .eq('table_id', this.config.tableId)
      .eq('seat_idx', opts.seatIdx);
    this.broadcastState();
  }

  // ─── Hand lifecycle ────────────────────────────────────────────────────────

  async maybeStartHand() {
    if (this.starting || this.destroyed) return;
    if (this.state.phase !== 'complete' && this.state.handId !== '') return;
    const ready = this.state.seats.filter(s => s.userId && s.stack >= this.config.bigBlind);
    if (ready.length < 2) return;
    this.starting = true;
    try {
      await this.startHand();
    } finally {
      this.starting = false;
    }
  }

  private async startHand() {
    // Build deck material
    this.serverSeed = newServerSeed();
    this.nonce = randomBytes(8).toString('hex');
    // clientEntropy: hash of the userIds present (deterministic) + random session-time entropy
    const userBytes = this.state.seats
      .filter(s => s.userId)
      .map(s => s.userId)
      .sort()
      .join(':');
    this.clientEntropy = createHash('sha256')
      .update(userBytes + ':' + Date.now() + ':' + randomBytes(16).toString('hex'), 'utf8')
      .digest('hex');
    this.commitment = commit({ serverSeed: this.serverSeed, nonce: this.nonce });
    const deck = shuffleDeck({
      serverSeed: this.serverSeed,
      clientEntropy: this.clientEntropy,
      nonce: this.nonce,
    });

    const handId = randomUUID();
    const handNumber = (this.state.handNumber || 0) + 1;

    // Find next dealer
    const dealerSeat = this.nextDealer();
    this.lastDealer = dealerSeat;

    // Persist hand row
    await db.from('hands').insert({
      id: handId,
      table_id: this.config.tableId,
      hand_number: handNumber,
      dealer_seat: dealerSeat,
      sb_seat: 0,                                // overwritten after startHand
      bb_seat: 0,
      seed_commitment: this.commitment,
      client_entropy: this.clientEntropy,
      deck_order: deck,
      small_blind: this.config.smallBlind,
      big_blind: this.config.bigBlind,
      ante: this.config.ante,
    });

    this.state = startHand(this.state, { handId, deck, dealerSeat, handNumber });

    // Update SB/BB on the hand row
    await db
      .from('hands')
      .update({ sb_seat: this.state.sbSeat, bb_seat: this.state.bbSeat })
      .eq('id', handId);

    // Persist hole cards (server-authoritative; players never see opponents')
    const hc = this.state.seats
      .filter(s => s.holeCards)
      .map(s => ({
        hand_id: handId,
        seat_idx: s.idx,
        user_id: s.userId!,
        cards: s.holeCards!,
      }));
    if (hc.length) {
      await db.from('hand_hole_cards').insert(hc);
    }

    // Broadcast public state
    this.broadcastState();

    // Send each player their hole cards
    for (const s of this.state.seats) {
      if (!s.holeCards) continue;
      const conn = this.connections.get(s.idx);
      conn?.send({
        type: 'hole_cards',
        v: 1,
        payload: {
          tableId: this.config.tableId,
          handId,
          seatIdx: s.idx,
          cards: s.holeCards,
          commitment: this.commitment,
        },
      });
    }

    this.scheduleTimeout();
  }

  private nextDealer(): number {
    // First hand: pick first occupied seat
    const occ = this.state.seats
      .map((s, i) => (s.userId && s.stack >= this.config.bigBlind ? i : -1))
      .filter(i => i >= 0);
    if (occ.length === 0) return 0;
    if (this.lastDealer < 0) return occ[0]!;
    // Move clockwise from previous dealer
    for (let i = 1; i <= this.state.seats.length; i++) {
      const idx = (this.lastDealer + i) % this.state.seats.length;
      if (occ.includes(idx)) return idx;
    }
    return occ[0]!;
  }

  private scheduleTimeout() {
    if (this.actionTimer) clearTimeout(this.actionTimer);
    if (this.state.toAct === null) return;
    const delay = Math.max(0, this.state.actionDeadline - Date.now());
    this.actionTimer = setTimeout(() => {
      void this.timeoutCurrentSeat();
    }, delay + 50);
  }

  private async timeoutCurrentSeat() {
    if (this.state.toAct === null) return;
    const seat = this.state.toAct;
    log.info({ tableId: this.config.tableId, seat, handId: this.state.handId }, 'auto-fold timeout');
    await this.applyPlayerAction({ seatIdx: seat, type: 'time_out' });
  }

  // ─── Actions ───────────────────────────────────────────────────────────────

  legalActionsFor(seatIdx: number) {
    return legalActions(this.state, seatIdx);
  }

  async applyPlayerAction(args: {
    seatIdx: number;
    type: ActionType;
    amount?: number;
    userId?: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    if (this.state.toAct !== args.seatIdx) return { ok: false, reason: 'not_your_turn' };
    const seat = this.state.seats[args.seatIdx];
    if (!seat) return { ok: false, reason: 'bad_seat' };
    if (args.userId && seat.userId !== args.userId) return { ok: false, reason: 'not_your_seat' };

    let result;
    try {
      result = applyAction(this.state, {
        seat: args.seatIdx,
        type: args.type,
        amount: args.amount,
        userId: seat.userId ?? undefined,
      });
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    this.state = result.state;

    // Persist action
    const actLog = this.state.log[this.state.log.length - 1]!;
    await db.from('hand_actions').insert({
      hand_id: this.state.handId,
      sequence: actLog.seq,
      seat_idx: actLog.seat,
      user_id: actLog.userId,
      phase: actLog.phase,
      action: actLog.action,
      amount: actLog.amount,
      pot_after: actLog.potAfter,
      to_call: actLog.toCall,
    });

    // Broadcast public action
    const ev: ServerMessage = {
      type: 'action_event',
      v: 1,
      payload: {
        tableId: this.config.tableId,
        handId: this.state.handId,
        seatIdx: actLog.seat,
        action: actLog.action,
        amount: actLog.amount,
        potAfter: actLog.potAfter,
        serverTs: Date.now(),
      },
    };
    this.broadcast(ev);

    if (result.endedPhase) {
      // Broadcast phase change (with new board cards)
      this.broadcast({
        type: 'phase_event',
        v: 1,
        payload: {
          tableId: this.config.tableId,
          handId: this.state.handId,
          phase: this.state.phase as 'flop' | 'turn' | 'river' | 'showdown',
          board: this.state.board,
        },
      });
    }

    if (result.endedHand) {
      await this.completeHand(result.showdownNeeded);
      // Schedule next hand after a short delay
      setTimeout(() => void this.maybeStartHand(), 3000);
    } else {
      this.broadcastState();
      this.scheduleTimeout();
    }
    return { ok: true };
  }

  private async completeHand(showdownNeeded: boolean) {
    if (showdownNeeded) {
      this.state = runShowdown(this.state);
    }

    const payouts = (this.state.pendingPayouts ?? []).map(p => ({
      user_id: p.userId,
      seat_idx: p.seat,
      amount: p.amount,
      hand_rank: p.rank,
      hand_value: p.value.toString(),
    }));

    try {
      await rpc('atomic_pot_settle', {
        p_hand_id: this.state.handId,
        p_payouts: payouts,
      });
    } catch (e) {
      log.error({ err: (e as Error).message }, 'atomic_pot_settle failed');
    }

    // Persist seed reveal for verification
    await db
      .from('hands')
      .update({ seed_reveal: this.serverSeed, board_cards: this.state.board, ended_at: new Date().toISOString() })
      .eq('id', this.state.handId);

    if (showdownNeeded) {
      // Broadcast showdown event with reveals
      const reveals: Array<{ seatIdx: number; cards: [number, number]; rank: number; description: string }> = [];
      for (const s of this.state.seats) {
        if ((s.status === 'active' || s.status === 'all_in') && s.holeCards) {
          const v = this.state.pendingPayouts?.find(p => p.seat === s.idx);
          reveals.push({
            seatIdx: s.idx,
            cards: s.holeCards,
            rank: v?.rank ?? 0,
            description: '',
          });
        }
      }
      this.broadcast({
        type: 'showdown',
        v: 1,
        payload: {
          tableId: this.config.tableId,
          handId: this.state.handId,
          reveals,
          payouts: (this.state.pendingPayouts ?? []).map(p => ({
            seatIdx: p.seat,
            userId: p.userId,
            amount: p.amount,
          })),
          seedReveal: {
            serverSeed: this.serverSeed,
            nonce: this.nonce,
            clientEntropy: this.clientEntropy,
          },
        },
      });
    }

    // Update all balances broadcast for live UI
    for (const s of this.state.seats) {
      if (s.userId) {
        const conn = this.connections.get(s.idx);
        if (conn) {
          // We could fetch the new balance, but the stack delta is enough for UI
          conn.send({ type: 'balance_update', v: 1, payload: { chips: s.stack, lockedChips: s.stack } });
        }
      }
    }

    // Mark folded seats as 'active' for next hand
    for (const s of this.state.seats) {
      if (s.status === 'folded') s.status = s.stack > 0 ? 'active' : 'sitting_out';
      if (s.status === 'all_in') s.status = s.stack > 0 ? 'active' : 'sitting_out';
    }

    this.broadcastState();
  }

  // ─── Chat ──────────────────────────────────────────────────────────────────

  async chat(opts: { userId: string; username: string; content: string }) {
    const msg = opts.content.trim().slice(0, 280);
    if (!msg) return;
    await db.from('table_messages').insert({
      table_id: this.config.tableId,
      user_id: opts.userId,
      content: msg,
    });
    this.broadcast({
      type: 'chat_event',
      v: 1,
      payload: {
        tableId: this.config.tableId,
        userId: opts.userId,
        username: opts.username,
        content: msg,
        serverTs: Date.now(),
      },
    });
  }

  // ─── Snapshots / broadcast ────────────────────────────────────────────────

  snapshot(): TableStateSnapshot {
    const publicSeats: PublicSeat[] = this.state.seats.map(s => ({
      idx: s.idx,
      userId: s.userId,
      stack: s.stack,
      status: s.status,
      isDealer: s.isDealer,
      isSb: s.isSb,
      isBb: s.isBb,
      committedThisRound: s.committedThisRound,
      hasActed: s.hasActed,
    }));
    return {
      tableId: this.config.tableId,
      handId: this.state.handId || null,
      handNumber: this.state.handNumber,
      phase: this.state.phase,
      seats: publicSeats,
      dealerSeat: this.state.dealerSeat,
      pot: this.state.pot,
      sidePots: this.state.sidePots,
      board: this.state.board,
      toAct: this.state.toAct,
      currentBet: this.state.currentBet,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      ante: this.config.ante,
      minRaise: this.state.lastRaise,
      actionDeadline: this.state.toAct === null ? null : this.state.actionDeadline,
      serverTs: Date.now(),
    };
  }

  broadcastState() {
    const snap = this.snapshot();
    const msg: ServerMessage = { type: 'state', v: 1, payload: snap };
    for (const [, c] of this.connections) c.send(msg);
    for (const o of this.observers) o.send(msg);
  }

  broadcast(msg: ServerMessage) {
    for (const [, c] of this.connections) c.send(msg);
    for (const o of this.observers) o.send(msg);
  }
}

// Helper for verifying a published hand (used by replay endpoints)
export function verifyHand(opts: {
  serverSeed: string;
  clientEntropy: string;
  nonce: string;
  expectedCommitment: string;
}) {
  const v = buildVerification(opts);
  return v.commitment === opts.expectedCommitment;
}

// Re-export so the manager doesn't have to import from the engine directly
export type { Seat };
export { Channels, publish, redis };
