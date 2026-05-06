// Disconnect protection / time bank.
//
// House rule (matches GGPoker, PokerStars):
//   • Each seat has a per-session time bank (default 30s). When the action
//     timer expires, the time bank starts auto-consuming.
//   • A disconnected player gets the full disconnect-protect window (typically
//     90s) for any all-in decision. After that, auto-fold.
//   • If a player is all-in pre-river, no further action is needed; the
//     remaining streets run regardless. Disconnect protection is irrelevant.
//
// We model this as a per-seat clock the game server ticks down. When it hits
// zero, a `time_out` action fires.

export interface TimeBankState {
  remainingMs: number;
  isUsing: boolean;
  startedAt: number | null;
}

export function newTimeBank(seconds: number): TimeBankState {
  return {
    remainingMs: seconds * 1000,
    isUsing: false,
    startedAt: null,
  };
}

export function startUsingBank(tb: TimeBankState): TimeBankState {
  return { ...tb, isUsing: true, startedAt: Date.now() };
}

export function tick(tb: TimeBankState, now = Date.now()): TimeBankState {
  if (!tb.isUsing || tb.startedAt === null) return tb;
  const elapsed = now - tb.startedAt;
  const remaining = Math.max(0, tb.remainingMs - elapsed);
  return { remainingMs: remaining, isUsing: remaining > 0, startedAt: now };
}

export function refund(tb: TimeBankState, amountMs: number): TimeBankState {
  return { ...tb, remainingMs: tb.remainingMs + amountMs };
}

export function isExhausted(tb: TimeBankState): boolean {
  return tb.remainingMs <= 0;
}

// ─── Disconnect tracking ───────────────────────────────────────────────────

export interface DisconnectState {
  disconnectedAt: number | null;
  protectUntil: number | null;          // unix ms; after this auto-fold
}

export function onDisconnect(seconds: number): DisconnectState {
  const now = Date.now();
  return {
    disconnectedAt: now,
    protectUntil: now + seconds * 1000,
  };
}

export function onReconnect(_prev: DisconnectState): DisconnectState {
  return { disconnectedAt: null, protectUntil: null };
}

export function isProtected(s: DisconnectState, now = Date.now()): boolean {
  return s.protectUntil !== null && now < s.protectUntil;
}
