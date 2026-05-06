import { db } from './db.js';
import { env } from './env.js';
import { log } from './log.js';
import { Room, type RoomConfig } from './room.js';

// Tables are sharded by hashing tableId mod TOTAL_SHARDS.
// Each shard runs an instance of the game-server.

export class RoomManager {
  private rooms = new Map<string, Room>();

  ownsTable(tableId: string): boolean {
    return shardOf(tableId, env.TOTAL_SHARDS) === env.SHARD_ID;
  }

  async getOrCreate(tableId: string): Promise<Room | null> {
    if (!this.ownsTable(tableId)) return null;
    const existing = this.rooms.get(tableId);
    if (existing) return existing;

    if (this.rooms.size >= env.MAX_TABLES_PER_SHARD) {
      log.warn({ tableId, count: this.rooms.size }, 'shard at capacity');
      return null;
    }

    const { data, error } = await db
      .from('tables')
      .select(`
        id, kind, max_seats, small_blind, big_blind, ante, rake_bps, rake_cap,
        tournament_id, straddle_kind, allow_re_straddle, cap_amount,
        allow_run_it_twice, max_run_count, bomb_pot_every_n_hands, bomb_pot_ante,
        max_sit_outs, disconnect_protect_seconds, action_timer_seconds, time_bank_seconds
      `)
      .eq('id', tableId)
      .maybeSingle();
    if (error || !data) {
      log.warn({ tableId, error }, 'getOrCreate: table not found');
      return null;
    }

    const cfg: RoomConfig = {
      tableId,
      shard: env.SHARD_ID,
      maxSeats: data.max_seats,
      smallBlind: Number(data.small_blind),
      bigBlind: Number(data.big_blind),
      ante: Number(data.ante),
      rakeBps: data.rake_bps,
      rakeCap: Number(data.rake_cap),
      actionTimeoutMs: ((data.action_timer_seconds as number | null) ?? 0) > 0
        ? Number(data.action_timer_seconds) * 1000
        : env.ACTION_TIMEOUT_MS,
      timeBankMs: ((data.time_bank_seconds as number | null) ?? 0) > 0
        ? Number(data.time_bank_seconds) * 1000
        : env.TIME_BANK_MS,
      kind: data.kind,
      tournamentId: data.tournament_id,
      straddleKind: (data.straddle_kind as RoomConfig['straddleKind']) ?? 'none',
      allowReStraddle: !!data.allow_re_straddle,
      capAmount: Number(data.cap_amount ?? 0),
      allowRunItTwice: data.allow_run_it_twice !== false,
      maxRunCount: ((data.max_run_count as 1 | 2 | 3 | null) ?? 2),
      bombPotEveryNHands: Number(data.bomb_pot_every_n_hands ?? 0),
      bombPotAnte: Number(data.bomb_pot_ante ?? 0),
      maxSitOuts: Number(data.max_sit_outs ?? 6),
      disconnectProtectSeconds: Number(data.disconnect_protect_seconds ?? 90),
      ritVoteWindowMs: 8_000,
    };
    const room = new Room(cfg);

    // Restore existing seats from DB (in case the server restarted)
    const { data: seats } = await db
      .from('table_seats')
      .select('*, profiles:profiles!table_seats_user_id_fkey(username)')
      .eq('table_id', tableId);
    for (const s of seats ?? []) {
      if (s.user_id) {
        room.state.seats[s.seat_idx] = {
          idx: s.seat_idx,
          userId: s.user_id,
          stack: Number(s.stack),
          holeCards: null,
          status: s.status,
          committedThisRound: 0,
          committedTotal: 0,
          hasActed: false,
          isDealer: !!s.is_dealer,
          isSb: !!s.is_sb,
          isBb: !!s.is_bb,
          showCards: false,
        };
      }
    }

    this.rooms.set(tableId, room);
    return room;
  }

  closeTable(tableId: string) {
    const r = this.rooms.get(tableId);
    if (r) {
      r.destroy();
      this.rooms.delete(tableId);
    }
  }

  list(): Room[] {
    return [...this.rooms.values()];
  }
}

// Consistent hashing: simple 32-bit hash mod numShards.
function shardOf(tableId: string, numShards: number): number {
  let h = 2166136261;
  for (let i = 0; i < tableId.length; i++) {
    h ^= tableId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % numShards;
}

export const manager = new RoomManager();
