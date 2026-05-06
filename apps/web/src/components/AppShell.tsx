'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { supabase } from '@/lib/supabase/client';
import { usePreferences } from '@/lib/preferences-context';

interface AppMeta {
  username: string;
  chips: number;
  vipTier: string;
  rakebackBps: number;
  pendingMissionClaims: number;
  pendingFriendRequests: number;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { isMobile } = usePreferences();
  const [meta, setMeta] = useState<AppMeta | null>(null);
  const isTablePage = path?.startsWith('/table/');

  // Fetch nav meta + subscribe to live updates
  useEffect(() => {
    let cancelled = false;
    let ch: import('@supabase/supabase-js').RealtimeChannel | null = null;
    const sb = supabase();

    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (!user || cancelled) return;

      async function refresh() {
        if (cancelled) return;
        const [{ data: profile }, { data: balance }, { data: vip }, { count: missionClaims }, { count: friendReqs }] = await Promise.all([
          sb.from('profiles').select('username').eq('id', user!.id).maybeSingle(),
          sb.from('balances').select('chips').eq('user_id', user!.id).maybeSingle(),
          sb.from('vip_status').select('tier, rakeback_bps').eq('user_id', user!.id).maybeSingle(),
          sb.from('mission_progress').select('*', { count: 'exact', head: true })
            .eq('user_id', user!.id).not('completed_at', 'is', null).is('claimed_at', null),
          sb.from('friendships').select('*', { count: 'exact', head: true })
            .or(`user_id.eq.${user!.id},friend_user_id.eq.${user!.id}`)
            .eq('status', 'pending')
            .neq('initiated_by', user!.id),
        ]);
        if (cancelled) return;
        setMeta({
          username: profile?.username ?? user!.email ?? user!.id.slice(0, 8),
          chips: Number(balance?.chips ?? 0),
          vipTier: vip?.tier ?? 'bronze',
          rakebackBps: vip?.rakeback_bps ?? 1500,
          pendingMissionClaims: missionClaims ?? 0,
          pendingFriendRequests: friendReqs ?? 0,
        });
      }
      void refresh();

      ch = sb.channel(`shell:${user.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'balances', filter: `user_id=eq.${user.id}` }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vip_status', filter: `user_id=eq.${user.id}` }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mission_progress', filter: `user_id=eq.${user.id}` }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, refresh)
        .subscribe();
    })().catch(() => {});

    return () => {
      cancelled = true;
      if (ch) void sb.removeChannel(ch);
    };
  }, []);

  // Don't render shell at the table page (full-bleed felt UI)
  if (isTablePage) return <>{children}</>;

  return (
    <>
      <TopNav meta={meta} />
      <main className="pb-24 md:pb-0">{children}</main>
      {isMobile && <BottomTabs meta={meta} />}
    </>
  );
}

function TopNav({ meta }: { meta: AppMeta | null }) {
  const path = usePathname() ?? '/';
  const isPage = (p: string) => path === p || path.startsWith(p + '/');

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-black/50">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 md:px-6">
        <Link href="/" className="font-display text-xl font-bold tracking-tight text-gold-400">
          STACKS
        </Link>
        <nav className="hidden flex-1 items-center gap-2 md:flex">
          <NavLink href="/lobby" active={isPage('/lobby')}>Tables</NavLink>
          <NavLink href="/tournaments" active={isPage('/tournaments')}>Tournaments</NavLink>
          <NavLink href="/missions" active={isPage('/missions')} badge={meta?.pendingMissionClaims}>Missions</NavLink>
          <NavLink href="/leaderboards" active={isPage('/leaderboards')}>Leaderboards</NavLink>
          <NavLink href="/friends" active={isPage('/friends')} badge={meta?.pendingFriendRequests}>Friends</NavLink>
        </nav>
        <div className="flex flex-1 items-center justify-end gap-2 md:flex-none">
          {meta && (
            <Link href="/profile/vip" className="hidden rounded-md bg-gradient-to-br from-gold-700 to-gold-400 px-3 py-1.5 text-xs font-bold uppercase text-black md:inline-block">
              {meta.vipTier} · {meta.rakebackBps / 100}%
            </Link>
          )}
          <Link href="/wallet" className="rounded-md bg-black/60 px-3 py-1.5 font-mono text-sm ring-1 ring-white/10 hover:ring-gold-500/40">
            {meta ? `$${(meta.chips / 1e6).toFixed(2)}` : '— —'}
          </Link>
          <UserMenu meta={meta} />
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, active, badge, children }: { href: string; active: boolean; badge?: number; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={clsx(
        'relative rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
        active ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'
      )}
    >
      {children}
      {!!badge && (
        <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold">
          {badge}
        </span>
      )}
    </Link>
  );
}

function UserMenu({ meta }: { meta: AppMeta | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-sm font-bold ring-2 ring-transparent hover:ring-gold-500"
      >
        {(meta?.username ?? '??').slice(0, 2).toUpperCase()}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} className="absolute right-0 top-12 w-56 rounded-md border border-white/10 bg-black/95 p-1 text-sm shadow-2xl backdrop-blur">
          <MenuLink href="/profile">Profile</MenuLink>
          <MenuLink href="/profile/preferences">Settings</MenuLink>
          <MenuLink href="/profile/kyc">KYC</MenuLink>
          <MenuLink href="/profile/hands">Hand history</MenuLink>
          <MenuLink href="/profile/vip">VIP & rakeback</MenuLink>
          <hr className="my-1 border-white/5" />
          <MenuLink href="/audit">Vault audit</MenuLink>
          <button
            onClick={async () => { await supabase().auth.signOut(); window.location.href = '/'; }}
            className="block w-full rounded px-3 py-2 text-left text-red-400 hover:bg-red-950/40"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="block rounded px-3 py-2 hover:bg-white/10">{children}</Link>;
}

function BottomTabs({ meta }: { meta: AppMeta | null }) {
  const path = usePathname() ?? '/';
  const tabs = [
    { href: '/lobby', label: 'Tables', icon: '🃏' },
    { href: '/tournaments', label: 'Events', icon: '🏆' },
    { href: '/missions', label: 'Missions', icon: '⭐', badge: meta?.pendingMissionClaims },
    { href: '/profile', label: 'Profile', icon: '👤' },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-white/10 bg-black/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {tabs.map(t => {
        const active = path === t.href || path.startsWith(t.href + '/');
        return (
          <Link key={t.href} href={t.href} className={clsx('relative flex flex-col items-center justify-center py-2 text-xs', active ? 'text-gold-400' : 'text-white/60')}>
            <span className="text-xl">{t.icon}</span>
            <span>{t.label}</span>
            {!!t.badge && <span className="absolute right-1/3 top-1 h-2 w-2 rounded-full bg-red-500" />}
          </Link>
        );
      })}
    </nav>
  );
}
