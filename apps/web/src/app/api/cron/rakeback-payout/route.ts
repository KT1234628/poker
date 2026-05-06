import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { payoutRakebackForPeriod } from '@/lib/retention/rakeback';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const to = new Date();
  const from = new Date(to.getTime() - 7 * 86400_000);
  const r = await payoutRakebackForPeriod(from, to);
  return NextResponse.json(r);
}

