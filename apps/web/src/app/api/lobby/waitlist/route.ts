import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

const PostBody = z.object({ tableId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  const tableId = url.searchParams.get('tableId');
  const q = sb.from('table_waitlist').select('table_id, user_id, joined_at, notified_at').eq('user_id', user.id);
  const { data } = tableId ? await q.eq('table_id', tableId) : await q;
  return NextResponse.json({ waitlist: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const body = PostBody.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const { error } = await sb.from('table_waitlist').insert({ table_id: body.data.tableId, user_id: user.id });
  if (error && !error.message.includes('duplicate')) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const url = new URL(req.url);
  const tableId = url.searchParams.get('tableId');
  if (!tableId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  await sb.from('table_waitlist').delete().eq('user_id', user.id).eq('table_id', tableId);
  return NextResponse.json({ ok: true });
}
