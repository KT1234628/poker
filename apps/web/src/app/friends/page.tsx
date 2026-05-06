'use client';

import { useEffect, useState } from 'react';

interface Friendship {
  user_id: string;
  friend_user_id: string;
  status: 'pending' | 'accepted' | 'declined' | 'blocked';
  initiated_by: string;
  created_at: string;
}

export default function FriendsPage() {
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [username, setUsername] = useState('');
  const [me, setMe] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch('/api/friends').then(r => r.json());
    setFriends(r.friendships ?? []);
    if (typeof window !== 'undefined') {
      const meRes = await fetch('/api/me').then(r => r.json()).catch(() => null);
      setMe(meRes?.id ?? null);
    }
  }
  useEffect(() => { void load(); }, []);

  async function send() {
    if (!username) return;
    setBusy(true);
    await fetch('/api/friends', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    setUsername('');
    setBusy(false);
    void load();
  }

  async function respond(friendUserId: string, status: 'accepted' | 'declined' | 'blocked') {
    await fetch('/api/friends', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ friendUserId, status }),
    });
    void load();
  }

  async function remove(friendUserId: string) {
    await fetch(`/api/friends?friendUserId=${friendUserId}`, { method: 'DELETE' });
    void load();
  }

  const incoming = friends.filter(f => f.status === 'pending' && f.initiated_by !== me);
  const outgoing = friends.filter(f => f.status === 'pending' && f.initiated_by === me);
  const accepted = friends.filter(f => f.status === 'accepted');

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="font-display text-4xl font-bold">Friends</h1>

      <div className="mt-6 flex gap-2">
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="Add by username"
          className="flex-1 rounded-md bg-white/5 px-3 py-2 ring-1 ring-white/10"
        />
        <button onClick={send} disabled={busy} className="btn btn-primary">Send request</button>
      </div>

      {incoming.length > 0 && (
        <Section title="Incoming requests">
          {incoming.map(f => {
            const otherId = f.user_id === me ? f.friend_user_id : f.user_id;
            return (
              <Row key={otherId} userId={otherId}>
                <button onClick={() => respond(otherId, 'accepted')} className="btn btn-primary">Accept</button>
                <button onClick={() => respond(otherId, 'declined')} className="btn btn-ghost">Decline</button>
              </Row>
            );
          })}
        </Section>
      )}
      {outgoing.length > 0 && (
        <Section title="Pending">
          {outgoing.map(f => {
            const otherId = f.user_id === me ? f.friend_user_id : f.user_id;
            return <Row key={otherId} userId={otherId}><span className="text-xs text-white/50">Awaiting reply</span></Row>;
          })}
        </Section>
      )}
      {accepted.length > 0 && (
        <Section title="Friends">
          {accepted.map(f => {
            const otherId = f.user_id === me ? f.friend_user_id : f.user_id;
            return (
              <Row key={otherId} userId={otherId}>
                <button onClick={() => remove(otherId)} className="text-xs text-red-400 hover:underline">Remove</button>
              </Row>
            );
          })}
        </Section>
      )}
      {accepted.length === 0 && incoming.length === 0 && outgoing.length === 0 && (
        <p className="mt-6 text-white/60">No friends yet. Add someone by username.</p>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-xs uppercase text-white/50">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Row({ userId, children }: { userId: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-white/10 bg-black/30 p-3">
      <span className="font-mono text-sm">@{userId.slice(0, 12)}</span>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
