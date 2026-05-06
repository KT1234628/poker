// Multi-table tournament balancing.
//
// When a player busts, table sizes drift. Rebalancing rules:
//   1. If any table has 1 player, break it (move all to other tables).
//   2. If max(seats) - min(seats) >= 2, move ONE player from the largest
//      to the smallest table (the "next big blind" — most common online rule).
//   3. When down to one table — final table — stop balancing.
//
// We don't move players mid-hand: rebalance happens between hands.

export interface TableSnapshot {
  tableId: string;
  seats: Array<{ userId: string; seatIdx: number; stack: number; isInHand?: boolean }>;
  maxSeats: number;
}

export interface Move {
  userId: string;
  fromTableId: string;
  toTableId: string;
  fromSeatIdx: number;
  toSeatIdx: number;
}

export interface BreakDecision {
  breakTableId: string;
  moves: Move[];
}

export interface RebalancePlan {
  moves: Move[];
  breaks: BreakDecision[];
}

export function planRebalance(tables: TableSnapshot[]): RebalancePlan {
  const moves: Move[] = [];
  const breaks: BreakDecision[] = [];

  if (tables.length <= 1) return { moves, breaks };

  // Sort by player count (desc)
  const sorted = [...tables].sort((a, b) => b.seats.length - a.seats.length);

  // Step 1: break tables with 0 or 1 players (rare; usually triggered when 2 tables remain)
  // Only break if doing so keeps every other table at <= maxSeats.
  for (const t of [...sorted]) {
    if (t.seats.length === 0) continue;
    if (t.seats.length === 1) {
      const targetCapacity = sorted
        .filter(o => o.tableId !== t.tableId)
        .reduce((sum, o) => sum + (o.maxSeats - o.seats.length), 0);
      if (targetCapacity >= 1) {
        const planned = movePlayers(t, sorted.filter(o => o.tableId !== t.tableId));
        breaks.push({ breakTableId: t.tableId, moves: planned });
        // Apply moves to the in-memory snapshot for further planning
        for (const m of planned) {
          const dst = sorted.find(o => o.tableId === m.toTableId)!;
          dst.seats.push({ userId: m.userId, seatIdx: m.toSeatIdx, stack: 0 });
        }
        t.seats = [];
      }
    }
  }

  // Step 2: even out the rest
  for (let i = 0; i < 50; i++) {
    const live = sorted.filter(t => t.seats.length > 0);
    if (live.length <= 1) break;
    const big = live.reduce((a, b) => (a.seats.length >= b.seats.length ? a : b));
    const small = live.reduce((a, b) => (a.seats.length <= b.seats.length ? a : b));
    if (big.seats.length - small.seats.length < 2) break;

    // Pick the player about to post the big blind (we approximate as the one
    // at the highest seat number with `isInHand=false`)
    const candidate =
      big.seats.find(s => !s.isInHand) ?? big.seats[big.seats.length - 1]!;
    const dstSeat = firstFreeSeat(small);
    if (dstSeat < 0) break;

    moves.push({
      userId: candidate.userId,
      fromTableId: big.tableId,
      toTableId: small.tableId,
      fromSeatIdx: candidate.seatIdx,
      toSeatIdx: dstSeat,
    });
    big.seats = big.seats.filter(s => s.userId !== candidate.userId);
    small.seats.push({ userId: candidate.userId, seatIdx: dstSeat, stack: candidate.stack });
  }

  return { moves, breaks };
}

function movePlayers(src: TableSnapshot, dsts: TableSnapshot[]): Move[] {
  const moves: Move[] = [];
  for (const player of src.seats) {
    // Choose smallest destination with space
    const dst = dsts
      .filter(t => t.seats.length < t.maxSeats)
      .sort((a, b) => a.seats.length - b.seats.length)[0];
    if (!dst) break;
    const dstSeat = firstFreeSeat(dst);
    moves.push({
      userId: player.userId,
      fromTableId: src.tableId,
      toTableId: dst.tableId,
      fromSeatIdx: player.seatIdx,
      toSeatIdx: dstSeat,
    });
    dst.seats.push({ userId: player.userId, seatIdx: dstSeat, stack: player.stack });
  }
  return moves;
}

function firstFreeSeat(t: TableSnapshot): number {
  const taken = new Set(t.seats.map(s => s.seatIdx));
  for (let i = 0; i < t.maxSeats; i++) if (!taken.has(i)) return i;
  return -1;
}
