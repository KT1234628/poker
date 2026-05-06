'use client';

import { useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Subscribe to a Supabase Realtime channel with proper cleanup.
 *
 * The async-IIFE-inside-useEffect pattern silently leaks channels because the
 * cleanup function returned from the inner async function is ignored by React.
 * This helper does it correctly.
 */
export function useRealtimeChannel(
  setup: ((sb: ReturnType<typeof supabase>) => Promise<RealtimeChannel | null> | RealtimeChannel | null) | null,
  deps: React.DependencyList = []
): void {
  useEffect(() => {
    if (!setup) return;
    let ch: RealtimeChannel | null = null;
    let cancelled = false;
    const sb = supabase();
    Promise.resolve(setup(sb))
      .then(c => {
        if (cancelled && c) { void sb.removeChannel(c); return; }
        ch = c;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (ch) void sb.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
