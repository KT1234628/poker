import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

const Body = z.object({
  theme: z.enum(['felt-classic','felt-dark','felt-blue','felt-noir']).optional(),
  card_back: z.enum(['red-classic','navy','gold-foil','minimal','retro']).optional(),
  sound_pack: z.enum(['standard','quiet','tournament','retro']).optional(),
  master_volume: z.number().int().min(0).max(100).optional(),
  enable_chip_sounds: z.boolean().optional(),
  enable_voice: z.boolean().optional(),
  enable_video: z.boolean().optional(),
  default_video_quality: z.enum(['auto','low','medium','high']).optional(),
  show_action_animations: z.boolean().optional(),
  show_equity_at_showdown: z.boolean().optional(),
  show_equity_pre_showdown: z.boolean().optional(),
  auto_rebuy: z.boolean().optional(),
  auto_rebuy_threshold_bps: z.number().int().min(0).max(10000).optional(),
  auto_rebuy_amount_bps: z.number().int().min(0).max(10000).optional(),
  auto_topup: z.boolean().optional(),
  auto_topup_threshold_bps: z.number().int().min(0).max(10000).optional(),
  multi_tabling_enabled: z.boolean().optional(),
  max_simultaneous_tables: z.number().int().min(1).max(24).optional(),
  fast_fold_warn: z.boolean().optional(),
  big_blind_display: z.enum(['chips','bb_count']).optional(),
});

export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const { data } = await sb.from('user_preferences').select('*').eq('user_id', user.id).maybeSingle();
  return NextResponse.json({ preferences: data });
}

export async function PATCH(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await sb.from('user_preferences').upsert({
    user_id: user.id,
    ...body.data,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  return NextResponse.json({ ok: true });
}
