// Synchronized tournament starts.
//
// Every table in the tournament starts level 1 at the same UTC second.
// New hands at every table follow a single global blind clock (not a
// per-table clock). This is the GGPoker / PokerStars convention and
// matters for fairness — otherwise late-starting tables are at slower
// blinds than early ones and have a competitive advantage.
//
// We model this as: the tournament owns the clock, and each table queries
// "what level is it now?" before starting each hand. If a level change
// crosses a hand boundary, the new blinds take effect on the next hand.
//
// Implementation note: hand-in-progress is unaffected by mid-hand level
// changes; the new blinds simply apply on the next deal.

export interface SyncClock {
  /** Tournament starts at this UTC ms. */
  startedAt: number;
  /** Total seconds spent in level breaks so far. */
  totalBreakSeconds: number;
  /** Total seconds paused (admin pause). */
  totalPausedSeconds: number;
  /** Currently paused since this ms (or null). */
  pausedAt: number | null;
}

export interface LevelDef {
  level: number;
  durationSeconds: number;
}

export function newSyncClock(startsAtMs: number): SyncClock {
  return {
    startedAt: startsAtMs,
    totalBreakSeconds: 0,
    totalPausedSeconds: 0,
    pausedAt: null,
  };
}

/** Currently running level (1-indexed) for a synchronized clock. */
export function currentLevel(
  clock: SyncClock,
  levels: LevelDef[],
  breaks: { afterLevel: number; durationSeconds: number }[],
  now = Date.now()
): { level: number; inBreak: boolean; secondsIntoLevel: number; secondsLeftInLevel: number } {
  if (now < clock.startedAt) {
    return { level: 0, inBreak: false, secondsIntoLevel: 0, secondsLeftInLevel: 0 };
  }
  const pausedTotal =
    clock.totalPausedSeconds + (clock.pausedAt !== null ? Math.floor((now - clock.pausedAt) / 1000) : 0);
  let elapsed = Math.floor((now - clock.startedAt) / 1000) - pausedTotal;

  for (let i = 0; i < levels.length; i++) {
    const l = levels[i]!;
    if (elapsed < l.durationSeconds) {
      return { level: l.level, inBreak: false, secondsIntoLevel: elapsed, secondsLeftInLevel: l.durationSeconds - elapsed };
    }
    elapsed -= l.durationSeconds;
    const brk = breaks.find(b => b.afterLevel === l.level);
    if (brk) {
      if (elapsed < brk.durationSeconds) {
        return { level: l.level, inBreak: true, secondsIntoLevel: 0, secondsLeftInLevel: brk.durationSeconds - elapsed };
      }
      elapsed -= brk.durationSeconds;
    }
  }
  // After all levels — return last level
  const last = levels[levels.length - 1]!;
  return { level: last.level, inBreak: false, secondsIntoLevel: 0, secondsLeftInLevel: 0 };
}

export function pause(clock: SyncClock, now = Date.now()): SyncClock {
  if (clock.pausedAt !== null) return clock;
  return { ...clock, pausedAt: now };
}

export function resume(clock: SyncClock, now = Date.now()): SyncClock {
  if (clock.pausedAt === null) return clock;
  const addPaused = Math.floor((now - clock.pausedAt) / 1000);
  return { ...clock, pausedAt: null, totalPausedSeconds: clock.totalPausedSeconds + addPaused };
}
