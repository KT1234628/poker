import { NextResponse, type NextRequest } from 'next/server';
import { refreshAllVipStatuses } from '@/lib/retention/rakeback';

export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const r = await refreshAllVipStatuses();
  return NextResponse.json(r);
}

function isCron(req: NextRequest): boolean {
  // Vercel injects 'x-vercel-cron-signature' for verified cron invocations.
  // In production, also accept a shared CRON_SECRET header.
  const fromVercel = req.headers.get('x-vercel-cron') === '1';
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization') === `Bearer ${expected}`;
  return fromVercel || provided;
}
