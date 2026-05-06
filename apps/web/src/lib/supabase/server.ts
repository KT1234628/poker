import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return store.getAll().map(c => ({ name: c.name, value: c.value }));
        },
        setAll(list: Array<{ name: string; value: string; options?: CookieOptions }>) {
          for (const c of list) {
            try { store.set({ name: c.name, value: c.value, ...(c.options ?? {}) }); } catch {}
          }
        },
      },
    }
  );
}

// Service-role client (bypasses RLS). USE SPARINGLY.
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
