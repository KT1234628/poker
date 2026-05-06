import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

const PostBody = z.object({
  username: z.string().min(3).max(24),
});

const PatchBody = z.object({
  friendUserId: z.string().uuid(),
  status: z.enum(['accepted', 'declined', 'blocked']),
});

export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const { data } = await sb
    .from('friendships')
    .select('user_id, friend_user_id, status, initiated_by, created_at, responded_at')
    .or(`user_id.eq.${user.id},friend_user_id.eq.${user.id}`);
  return NextResponse.json({ friendships: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = PostBody.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const { data: target } = await sb.from('profiles').select('id').eq('username', body.data.username.toLowerCase()).maybeSingle();
  if (!target) return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
  if (target.id === user.id) return NextResponse.json({ error: 'self' }, { status: 400 });

  const [a, b] = [user.id, target.id].sort();          // canonical ordering avoids dupes
  const { error } = await sb.from('friendships').upsert({
    user_id: a,
    friend_user_id: b,
    initiated_by: user.id,
    status: 'pending',
  }, { onConflict: 'user_id,friend_user_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = PatchBody.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const [a, b] = [user.id, body.data.friendUserId].sort();
  const { error } = await sb.from('friendships').update({
    status: body.data.status,
    responded_at: new Date().toISOString(),
  }).eq('user_id', a).eq('friend_user_id', b);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const url = new URL(req.url);
  const friendUserId = url.searchParams.get('friendUserId');
  if (!friendUserId) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const [a, b] = [user.id, friendUserId].sort();
  await sb.from('friendships').delete().eq('user_id', a).eq('friend_user_id', b);
  return NextResponse.json({ ok: true });
}
