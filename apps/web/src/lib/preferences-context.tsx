'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface Preferences {
  theme: 'felt-classic' | 'felt-dark' | 'felt-blue' | 'felt-noir';
  card_back: 'red-classic' | 'navy' | 'gold-foil' | 'minimal' | 'retro';
  sound_pack: 'standard' | 'quiet' | 'tournament' | 'retro';
  master_volume: number;
  enable_chip_sounds: boolean;
  enable_voice: boolean;
  enable_video: boolean;
  default_video_quality: 'auto' | 'low' | 'medium' | 'high';
  show_action_animations: boolean;
  show_equity_at_showdown: boolean;
  show_equity_pre_showdown: boolean;
  auto_rebuy: boolean;
  auto_rebuy_threshold_bps: number;
  auto_rebuy_amount_bps: number;
  auto_topup: boolean;
  auto_topup_threshold_bps: number;
  multi_tabling_enabled: boolean;
  max_simultaneous_tables: number;
  fast_fold_warn: boolean;
  big_blind_display: 'chips' | 'bb_count';
}

const DEFAULT: Preferences = {
  theme: 'felt-classic',
  card_back: 'red-classic',
  sound_pack: 'standard',
  master_volume: 80,
  enable_chip_sounds: true,
  enable_voice: true,
  enable_video: true,
  default_video_quality: 'auto',
  show_action_animations: true,
  show_equity_at_showdown: true,
  show_equity_pre_showdown: false,
  auto_rebuy: false,
  auto_rebuy_threshold_bps: 5000,
  auto_rebuy_amount_bps: 10000,
  auto_topup: false,
  auto_topup_threshold_bps: 5000,
  multi_tabling_enabled: true,
  max_simultaneous_tables: 4,
  fast_fold_warn: true,
  big_blind_display: 'chips',
};

interface Ctx {
  prefs: Preferences;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => Promise<void>;
  isMobile: boolean;
  isLoaded: boolean;
}

const PrefsContext = createContext<Ctx>({
  prefs: DEFAULT,
  setPref: async () => {},
  isMobile: false,
  isLoaded: false,
});

const THEME_VARS: Record<Preferences['theme'], { topGrad: string; bottomGrad: string; accent: string }> = {
  'felt-classic': { topGrad: '#0f5c3e', bottomGrad: '#0a3d2a', accent: '#d4af37' },
  'felt-dark':    { topGrad: '#1f1f1f', bottomGrad: '#0a0a0a', accent: '#22d3ee' },
  'felt-blue':    { topGrad: '#1e3a8a', bottomGrad: '#0c1e4d', accent: '#fbbf24' },
  'felt-noir':    { topGrad: '#3b0a0a', bottomGrad: '#1a0303', accent: '#f87171' },
};

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Mobile detection
  useEffect(() => {
    const check = () => {
      const narrow = window.innerWidth <= 768;
      const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      setIsMobile(narrow || coarse);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Load preferences
  useEffect(() => {
    let cancelled = false;
    let ch: import('@supabase/supabase-js').RealtimeChannel | null = null;
    const sb = supabase();

    (async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (cancelled) return;
      if (!user) { setIsLoaded(true); return; }
      const { data } = await sb.from('user_preferences').select('*').eq('user_id', user.id).maybeSingle();
      if (cancelled) return;
      if (data) setPrefs({ ...DEFAULT, ...data } as Preferences);
      setIsLoaded(true);

      ch = sb.channel(`prefs:${user.id}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${user.id}`,
        }, payload => {
          if (cancelled) return;
          if (payload.new) setPrefs(prev => ({ ...prev, ...payload.new as Partial<Preferences> }));
        })
        .subscribe();
    })().catch(() => {});

    return () => {
      cancelled = true;
      if (ch) void sb.removeChannel(ch);
    };
  }, []);

  // Apply theme CSS variables
  useEffect(() => {
    const t = THEME_VARS[prefs.theme];
    document.documentElement.style.setProperty('--felt-top', t.topGrad);
    document.documentElement.style.setProperty('--felt-bottom', t.bottomGrad);
    document.documentElement.style.setProperty('--accent', t.accent);
  }, [prefs.theme]);

  async function setPref<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPrefs(p => ({ ...p, [key]: value }));
    await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => {});
  }

  const ctx = useMemo<Ctx>(() => ({ prefs, setPref, isMobile, isLoaded }), [prefs, isMobile, isLoaded]);
  return <PrefsContext.Provider value={ctx}>{children}</PrefsContext.Provider>;
}

export function usePreferences(): Ctx {
  return useContext(PrefsContext);
}
