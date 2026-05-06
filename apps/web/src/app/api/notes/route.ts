import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

const Body = z.object({
  targetUserId: z.string().uuid(),
  note: z.string().max(2000).default(''),
  colorTag: z.enum(['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'pink']).nullable().optional(),
});

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  const target = url.searchParams.get('targetUserId');
  const q = sb.from('player_notes').select('*').eq('user_id', user.id);
  const { data } = target ? await q.eq('target_user_id', target).maybeSingle() : await q;
  return NextResponse.json({ notes: data });
}

export async function PUT(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = Body.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { error } = await sb.from('player_notes').upsert({
    user_id: user.id,
    target_user_id: body.data.targetUserId,
    note: body.data.note,
    color_tag: body.data.colorTag ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,target_user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  const target = url.searchParams.get('targetUserId');
  if (!target) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await sb.from('player_notes').delete().eq('user_id', user.id).eq('target_user_id', target);
  return NextResponse.json({ ok: true });
}
