import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const db: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'X-Stacks-Origin': 'game-server' } },
});

// Wraps a Supabase RPC call so callers can `await rpc('credit_chips', ...)` safely.
export async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`rpc ${name}: ${error.message}`);
  return data as T;
}
