// Credit play-money chips to a tester's account.
//
// Usage:
//   pnpm tsx scripts/seed-test-chips.ts <username-or-email> <usd_amount>
//
// Example:
//   pnpm tsx scripts/seed-test-chips.ts kt1234628 100      # 100 USDC equivalent
//
// Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in env.
//
// This bypasses on-chain custody — purely play money for friends-and-family
// testing. Do not use in production.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const target = process.argv[2];
const usd = Number(process.argv[3] ?? 100);
if (!target || !Number.isFinite(usd) || usd <= 0) {
  console.error('Usage: tsx scripts/seed-test-chips.ts <username-or-email> <usd_amount>');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // Look up the user — try username first, then email via auth.admin
  let userId: string | null = null;

  const { data: byUsername } = await sb
    .from('profiles')
    .select('id')
    .eq('username', target.toLowerCase())
    .maybeSingle();
  if (byUsername?.id) userId = byUsername.id;

  if (!userId && target.includes('@')) {
    const { data, error } = await sb.auth.admin.listUsers();
    if (error) { console.error(error.message); process.exit(1); }
    const u = (data?.users ?? []).find(u => u.email?.toLowerCase() === target.toLowerCase());
    if (u) userId = u.id;
  }

  if (!userId) {
    console.error(`No user found for "${target}".`);
    process.exit(1);
  }

  const micros = Math.floor(usd * 1_000_000);

  // Use the credit_chips SQL fn so this writes a real ledger entry.
  const { error } = await sb.rpc('credit_chips', {
    p_user_id: userId,
    p_amount: micros,
    p_kind: 'adjustment',
    p_ref_table: 'manual_seed',
    p_ref_id: null,
    p_metadata: { reason: 'test_seed', usd },
  });
  if (error) {
    console.error('credit_chips failed:', error.message);
    process.exit(1);
  }

  // Mark KYC approved so they can sit at tables (the game-server enforces KYC).
  await sb.from('profiles').update({ kyc_status: 'approved' }).eq('id', userId);

  const { data: bal } = await sb.from('balances').select('chips, locked_chips').eq('user_id', userId).maybeSingle();
  console.log(`✓ Credited $${usd.toFixed(2)} to ${target} (user_id ${userId.slice(0, 8)})`);
  console.log(`  Now: chips=$${(Number(bal?.chips ?? 0) / 1e6).toFixed(2)} locked=$${(Number(bal?.locked_chips ?? 0) / 1e6).toFixed(2)}`);
  console.log(`  KYC: approved (test mode)`);
}

main().catch(e => { console.error(e); process.exit(1); });
