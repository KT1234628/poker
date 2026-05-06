import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { refreshAllVipStatuses } from '@/lib/retention/rakeback';

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const r = await refreshAllVipStatuses();
  return NextResponse.json(r);
}

