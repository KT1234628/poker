export interface BlindLevel {
  level: number;
  sb: number;
  bb: number;
  ante: number;
  durationSeconds?: number;
}

export interface BlindStructure {
  name: string;
  startingStack: number;
  levelSeconds: number;
  breakAfterLevels: number[];     // after these levels, take a break
  breakMinutes: number;
  levels: BlindLevel[];
}

export interface BlindClock {
  currentLevel: number;           // 1-indexed
  levelStartedAt: number;         // unix ms
  pausedAt: number | null;
  totalPausedMs: number;
  inBreak: boolean;
  breakEndsAt: number | null;
}

export function makeClock(): BlindClock {
  return {
    currentLevel: 1,
    levelStartedAt: Date.now(),
    pausedAt: null,
    totalPausedMs: 0,
    inBreak: false,
    breakEndsAt: null,
  };
}

export function elapsedInLevel(clock: BlindClock): number {
  if (clock.pausedAt !== null) return clock.pausedAt - clock.levelStartedAt - clock.totalPausedMs;
  return Date.now() - clock.levelStartedAt - clock.totalPausedMs;
}

export function levelOf(structure: BlindStructure, clock: BlindClock): BlindLevel {
  const idx = Math.max(0, Math.min(clock.currentLevel - 1, structure.levels.length - 1));
  return structure.levels[idx]!;
}

export function shouldAdvanceLevel(structure: BlindStructure, clock: BlindClock): boolean {
  if (clock.pausedAt !== null) return false;
  if (clock.inBreak) return Date.now() >= (clock.breakEndsAt ?? 0);
  const lvl = levelOf(structure, clock);
  const dur = (lvl.durationSeconds ?? structure.levelSeconds) * 1000;
  return elapsedInLevel(clock) >= dur;
}

export function advance(structure: BlindStructure, clock: BlindClock): BlindClock {
  const isLast = clock.currentLevel >= structure.levels.length;
  if (clock.inBreak) {
    return {
      ...clock,
      inBreak: false,
      breakEndsAt: null,
      levelStartedAt: Date.now(),
      totalPausedMs: 0,
    };
  }
  if (structure.breakAfterLevels.includes(clock.currentLevel)) {
    return {
      ...clock,
      inBreak: true,
      breakEndsAt: Date.now() + structure.breakMinutes * 60_000,
      currentLevel: clock.currentLevel + 1,
    };
  }
  if (isLast) return clock;
  return {
    ...clock,
    currentLevel: clock.currentLevel + 1,
    levelStartedAt: Date.now(),
    totalPausedMs: 0,
  };
}

export function pause(clock: BlindClock): BlindClock {
  if (clock.pausedAt !== null) return clock;
  return { ...clock, pausedAt: Date.now() };
}

export function resume(clock: BlindClock): BlindClock {
  if (clock.pausedAt === null) return clock;
  return {
    ...clock,
    totalPausedMs: clock.totalPausedMs + (Date.now() - clock.pausedAt),
    pausedAt: null,
  };
}
