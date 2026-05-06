import { NextResponse, type NextRequest } from 'next/server';
import { LiveKitTokenRequestSchema } from '@stacks/shared-types';
import { issueLiveKitToken } from '@/lib/livekit/server';
import { enforce } from '@/lib/rate-limit';
import { supabaseServer } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const rl = await enforce('livekit_token', user.id, { tokens: 30, window: '5 m' });
  if (!rl.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });

  const body = LiveKitTokenRequestSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // Verify user is at this table
  const { data: seat } = await sb
    .from('table_seats')
    .select('seat_idx')
    .eq('table_id', body.data.tableId)
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: profile } = await sb.from('profiles').select('username').eq('id', user.id).maybeSingle();

  if (!seat && !profile) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const token = await issueLiveKitToken({
    room: `table_${body.data.tableId}`,
    identity: user.id,
    name: profile?.username,
  });
  return NextResponse.json({ token, url: process.env.LIVEKIT_URL });
}
