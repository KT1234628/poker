import { NextResponse, type NextRequest } from 'next/server';
import { payoutRakebackForPeriod } from '@/lib/retention/rakeback';

export async function GET(req: NextRequest) {
  if (!isCron(req)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86400_000);
  const r = await payoutRakebackForPeriod(from, to);
  return NextResponse.json(r);
}

function isCron(req: NextRequest): boolean {
  const fromVercel = req.headers.get('x-vercel-cron') === '1';
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization') === `Bearer ${expected}`;
  return fromVercel || provided;
}
