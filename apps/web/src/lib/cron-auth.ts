import type { NextRequest } from 'next/server';

/**
 * Cron auth gate.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` (when CRON_SECRET is
 * set in project env) — that's the canonical mechanism. We previously also
 * accepted a plain `x-vercel-cron: 1` header, which is FORGEABLE by any caller
 * — that path is now removed.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;                                  // fail closed
  const auth = req.headers.get('authorization') ?? '';
  return timingSafeEqualString(auth, `Bearer ${expected}`);
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
