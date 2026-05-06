import { redirect } from 'next/navigation';
import { mintGameToken } from '@/lib/session-token';
import { supabaseServer } from '@/lib/supabase/server';
import { PokerTable } from '@/components/poker/PokerTable';
import { issueLiveKitToken } from '@/lib/livekit/server';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

export default async function TablePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/auth?next=' + encodeURIComponent(`/table/${id}`));

  const { data: profile } = await sb
    .from('profiles')
    .select('username, kyc_status, is_banned')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || profile.is_banned) redirect('/blocked');

  const { data: table } = await sb
    .from('tables')
    .select('id, name, kind, max_seats, small_blind, big_blind, status, is_private, tournament_id, allow_run_it_twice, bomb_pot_every_n_hands, straddle_kind')
    .eq('id', id)
    .maybeSingle();
  if (!table || table.status === 'closed') redirect('/lobby?error=table_closed');

  const fingerprint = crypto.randomBytes(16).toString('hex');
  const sessionToken = await mintGameToken({
    userId: user.id,
    username: profile.username,
    kyc: profile.kyc_status as 'approved' | 'pending' | 'none' | 'rejected' | 'expired',
    fingerprint,
  });
  const livekitToken = await issueLiveKitToken({
    room: `table_${id}`,
    identity: user.id,
    name: profile.username,
  });

  return (
    <PokerTable
      tableId={id}
      gameWsUrl={process.env.GAME_SERVER_URL ?? 'wss://stacks-game.fly.dev'}
      livekitUrl={process.env.LIVEKIT_URL ?? ''}
      livekitToken={livekitToken}
      sessionToken={sessionToken}
      myUserId={user.id}
      fingerprint={fingerprint}
      tournamentId={table.tournament_id ?? null}
      tableName={table.name}
      stakes={{ sb: Number(table.small_blind), bb: Number(table.big_blind) }}
      features={{
        rit: !!table.allow_run_it_twice,
        bombPot: Number(table.bomb_pot_every_n_hands ?? 0),
        straddle: (table.straddle_kind as string) ?? 'none',
      }}
    />
  );
}
