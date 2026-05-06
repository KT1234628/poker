'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

interface FriendOnline { user_id: string; username: string }
interface LbRow { user_id: string; username: string; score: number; rank: number }

export function SideRail() {
  const [friends, setFriends] = useState<FriendOnline[]>([]);
  const [lb, setLb] = useState<{ id: string; name: string; rows: LbRow[] } | null>(null);
  const [hotd, setHotd] = useState<{ description: string; potSize: number; handId: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const sb = supabase();
      const { data: { user } } = await sb.auth.getUser();
      if (user) {
        // Friends + currently-active sessions (last 10 min)
        const { data: friendships } = await sb
          .from('friendships')
          .select('user_id, friend_user_id, status')
          .eq('status', 'accepted')
          .or(`user_id.eq.${user.id},friend_user_id.eq.${user.id}`);
        const friendIds = (friendships ?? []).map(f => (f.user_id === user.id ? f.friend_user_id : f.user_id));
        if (friendIds.length > 0) {
          const since = new Date(Date.now() - 10 * 60_000).toISOString();
          const { data: active } = await sb
            .from('session_events')
            .select('user_id, profiles:profiles!session_events_user_id_fkey(username)')
            .in('user_id', friendIds)
            .eq('event', 'connected')
            .gte('created_at', since)
            .returns<{ user_id: string; profiles: { username: string } }[]>();
          const byUser = new Map<string, string>();
          for (const a of active ?? []) byUser.set(a.user_id, a.profiles?.username ?? a.user_id.slice(0, 8));
          setFriends([...byUser.entries()].slice(0, 10).map(([user_id, username]) => ({ user_id, username })));
        }
      }

      // Active leaderboard
      const { data: lbs } = await sb.from('leaderboards')
        .select('id, name')
        .lte('starts_at', new Date().toISOString())
        .gte('ends_at', new Date().toISOString())
        .eq('is_published', true)
        .limit(1);
      const lbId = lbs?.[0]?.id;
      if (lbId) {
        const { data: rows } = await sb.from('leaderboard_scores')
          .select('user_id, score, rank, profiles:profiles!leaderboard_scores_user_id_fkey(username)')
          .eq('leaderboard_id', lbId)
          .order('rank', { ascending: true })
          .limit(5)
          .returns<{ user_id: string; score: number; rank: number; profiles: { username: string } | null }[]>();
        setLb({
          id: lbId,
          name: lbs![0]!.name,
          rows: (rows ?? []).map(r => ({
            user_id: r.user_id,
            username: r.profiles?.username ?? r.user_id.slice(0, 8),
            score: Number(r.score),
            rank: r.rank,
          })),
        });
      }

      // Hand of the day
      const { data: h } = await sb
        .from('hand_of_the_day')
        .select('description, pot_size, hand_id')
        .order('shown_on', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (h) setHotd({ description: h.description ?? 'Big hand', potSize: Number(h.pot_size ?? 0), handId: h.hand_id });
    })();
  }, []);

  return (
    <aside className="space-y-4">
      {/* Friends online */}
      <Card title="Friends online">
        {friends.length === 0 ? (
          <p className="text-sm text-white/50">
            <Link href="/friends" className="underline hover:text-white">Add friends</Link> to see when they're playing.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {friends.map(f => (
              <li key={f.user_id} className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                <span className="font-mono">@{f.username}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Leaderboard preview */}
      {lb && (
        <Card title={lb.name} action={<Link href={`/leaderboards/${lb.id}`} className="text-xs text-gold-400 hover:underline">view all</Link>}>
          <ol className="space-y-1.5 text-sm">
            {lb.rows.map((r, i) => (
              <li key={r.user_id} className="flex items-center gap-2">
                <span className="w-5 font-mono text-white/50">#{r.rank}</span>
                <span className="flex-1 truncate font-mono">@{r.username}</span>
                <span className="font-mono text-gold-300">{r.score.toLocaleString()}</span>
              </li>
            ))}
            {lb.rows.length === 0 && <li className="text-white/50">No scores yet.</li>}
          </ol>
        </Card>
      )}

      {/* Hand of the day */}
      {hotd && (
        <Card title="Hand of the day">
          <p className="text-sm text-white/80">{hotd.description}</p>
          <p className="mt-1 font-mono text-xs text-white/50">Pot: ${(hotd.potSize / 1e6).toFixed(2)}</p>
        </Card>
      )}
    </aside>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/30 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-white/50">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
