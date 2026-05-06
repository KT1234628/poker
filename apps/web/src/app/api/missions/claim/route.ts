import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { claimMissionReward } from '@/lib/retention/missions';
import { supabaseServer } from '@/lib/supabase/server';

const Body = z.object({ templateId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const r = await claimMissionReward(user.id, body.data.templateId);
  return NextResponse.json(r);
}
