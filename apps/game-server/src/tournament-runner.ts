import {
  advance,
  applyFixedPercent,
  defaultPayoutStructure,
  levelOf,
  makeClock,
  planRebalance,
  shouldAdvanceLevel,
  type BlindClock,
  type BlindStructure,
} from '@stacks/tournament-engine';
import { db } from './db.js';
import { log } from './log.js';
import { manager } from './manager.js';

interface TournamentRuntime {
  id: string;
  name: string;
  prizePool: number;
  startingStack: number;
  structure: BlindStructure;
  clock: BlindClock;
  tables: string[];               // table ids
  payouts: Record<number, number>;
  bustedCount: number;
  status: 'registering' | 'late_reg' | 'running' | 'paused' | 'completed';
}

const tourneys = new Map<string, TournamentRuntime>();

export async function runTournamentTick() {
  for (const t of tourneys.values()) {
    if (t.status !== 'running') continue;
    if (shouldAdvanceLevel(t.structure, t.clock)) {
      t.clock = advance(t.structure, t.clock);
      const lvl = levelOf(t.structure, t.clock);
      log.info({ tournamentId: t.id, level: t.clock.currentLevel }, 'level advance');
      // Update each table's blinds in DB and in-memory
      for (const tableId of t.tables) {
        await db.from('tables')
          .update({ small_blind: lvl.sb, big_blind: lvl.bb, ante: lvl.ante })
          .eq('id', tableId);
        const room = await manager.getOrCreate(tableId);
        if (room) {
          room.config.smallBlind = lvl.sb;
          room.config.bigBlind = lvl.bb;
          room.config.ante = lvl.ante;
        }
      }
    }
    await rebalanceIfNeeded(t);
    await checkBust(t);
  }
}

async function rebalanceIfNeeded(t: TournamentRuntime) {
  if (t.tables.length <= 1) return;
  const snapshots = await Promise.all(
    t.tables.map(async (tid) => {
      const { data } = await db.from('table_seats').select('*').eq('table_id', tid);
      const { data: tdata } = await db.from('tables').select('max_seats').eq('id', tid).maybeSingle();
      return {
        tableId: tid,
        maxSeats: tdata?.max_seats ?? 9,
        seats: (data ?? []).filter((s: { user_id: string | null }) => !!s.user_id).map((s: { user_id: string; seat_idx: number; stack: number; status: string }) => ({
          userId: s.user_id!,
          seatIdx: s.seat_idx,
          stack: Number(s.stack),
          isInHand: s.status === 'active' || s.status === 'all_in',
        })),
      };
    })
  );
  const plan = planRebalance(snapshots);
  for (const m of plan.moves) {
    const fromRoom = await manager.getOrCreate(m.fromTableId);
    const toRoom = await manager.getOrCreate(m.toTableId);
    if (!fromRoom || !toRoom) continue;
    const fromSeat = fromRoom.state.seats[m.fromSeatIdx];
    if (!fromSeat || !fromSeat.userId) continue;
    const stack = fromSeat.stack;
    await fromRoom.standUp({ userId: fromSeat.userId, seatIdx: m.fromSeatIdx });
    await toRoom.sitDown({
      userId: fromSeat.userId,
      username: '',
      seatIdx: m.toSeatIdx,
      buyin: stack,
    });
  }
  for (const b of plan.breaks) {
    log.info({ tournamentId: t.id, broken: b.breakTableId }, 'tournament: break table');
    t.tables = t.tables.filter(x => x !== b.breakTableId);
    manager.closeTable(b.breakTableId);
  }
}

async function checkBust(t: TournamentRuntime) {
  // Mark anyone with stack=0 as busted
  const { data: entries } = await db
    .from('tournament_entries')
    .select('*')
    .eq('tournament_id', t.id)
    .eq('status', 'playing');
  for (const e of entries ?? []) {
    if (Number(e.stack) <= 0) {
      // Determine finishing position (current active count + 1)
      const { count } = await db
        .from('tournament_entries')
        .select('*', { count: 'exact', head: true })
        .eq('tournament_id', t.id)
        .eq('status', 'playing');
      const place = (count ?? 1);
      const prize = t.payouts[place] ?? 0;
      await db.from('tournament_entries').update({
        status: prize > 0 ? 'paid' : 'busted',
        position: place,
        prize,
        busted_at: new Date().toISOString(),
      }).eq('tournament_id', t.id).eq('user_id', e.user_id);

      if (prize > 0) {
        await db.rpc('credit_chips', {
          p_user_id: e.user_id,
          p_amount: prize,
          p_kind: 'tournament_prize',
          p_ref_table: 'tournaments',
          p_ref_id: t.id,
        });
      }
    }
  }

  // Tournament complete?
  const { count: alive } = await db
    .from('tournament_entries')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', t.id)
    .eq('status', 'playing');
  if ((alive ?? 0) <= 1) {
    await db.from('tournaments').update({ status: 'completed', ended_at: new Date().toISOString() }).eq('id', t.id);
    t.status = 'completed';
  }
}

export async function loadTournaments() {
  const { data } = await db
    .from('tournaments')
    .select('*, blind_structures(*)')
    .in('status', ['registering', 'late_reg', 'running']);
  for (const tr of data ?? []) {
    const structure: BlindStructure = {
      name: tr.blind_structures?.name,
      startingStack: Number(tr.starting_stack),
      levelSeconds: tr.blind_structures?.level_seconds,
      breakAfterLevels: tr.blind_structures?.break_after_levels ?? [],
      breakMinutes: tr.blind_structures?.break_minutes ?? 5,
      levels: tr.blind_structures?.levels ?? [],
    };
    const { data: ttables } = await db.from('tables').select('id').eq('tournament_id', tr.id);
    const tables = (ttables ?? []).map((x: { id: string }) => x.id);

    const payoutStructure = tr.payout_structure ?? defaultPayoutStructure(tr.registered_count);
    const payouts = applyFixedPercent(Number(tr.prize_pool), payoutStructure);

    tourneys.set(tr.id, {
      id: tr.id,
      name: tr.name,
      prizePool: Number(tr.prize_pool),
      startingStack: Number(tr.starting_stack),
      structure,
      clock: makeClock(),
      tables,
      payouts,
      bustedCount: 0,
      status: tr.status,
    });
  }
}

export function startTournamentTicker() {
  setInterval(() => {
    void runTournamentTick().catch(err => log.error({ err }, 'tournament tick err'));
  }, 5_000);
}
