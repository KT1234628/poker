// Rakeback + VIP tier calculator.
// Run on a daily / weekly schedule (Vercel Cron, Supabase scheduled function, etc.).
//
// Algorithm:
//   1. For each user, compute rake paid in the last 30 days (from ledger_entries
//      with kind = 'rake').
//   2. Map points → tier via vip_tier_thresholds.
//   3. Update vip_status with new tier, rakeback_bps, progress to next tier.
//   4. (Weekly) issue rakeback_payouts: rake_paid * rakeback_bps / 10000 → ledger.

import { supabaseAdmin } from '@/lib/supabase/server';

export async function refreshAllVipStatuses() {
  const admin = supabaseAdmin();

  // Refresh the materialized view first (cheap if user count is small).
  // Supabase rpc returns a thenable, not a real Promise, so call .then() then ignore errors.
  try { await admin.rpc('refresh_user_rake_30d'); } catch {}

  const { data: thresholds } = await admin.from('vip_tier_thresholds')
    .select('*').order('min_points_30d', { ascending: true });
  if (!thresholds) return { updated: 0 };

  // Pull all rake-30d rows
  const { data: rows } = await admin.from('user_rake_30d').select('user_id, rake_30d');
  if (!rows) return { updated: 0 };

  let updated = 0;
  for (const r of rows) {
    const points = Number(r.rake_30d ?? 0);
    let tier = thresholds[0]!;
    let nextTier: typeof tier | null = null;
    for (let i = 0; i < thresholds.length; i++) {
      if (points >= Number(thresholds[i]!.min_points_30d)) {
        tier = thresholds[i]!;
        nextTier = thresholds[i + 1] ?? null;
      } else break;
    }
    let progressBps = 10000;
    if (nextTier) {
      const range = Number(nextTier.min_points_30d) - Number(tier.min_points_30d);
      progressBps = Math.max(0, Math.min(10000, Math.floor(((points - Number(tier.min_points_30d)) / Math.max(1, range)) * 10000)));
    }
    await admin.from('vip_status').upsert({
      user_id: r.user_id,
      tier: tier.tier,
      points_30d: points,
      rakeback_bps: tier.rakeback_bps,
      next_tier_progress_bps: progressBps,
    }, { onConflict: 'user_id' });
    updated++;
  }
  return { updated };
}

/**
 * Issue rakeback payouts for the period [from, to). Returns total chips paid.
 * Idempotent: safe to call again with the same period — uniqueness constraint on
 * (user_id, period_start, period_end) prevents double-credit.
 */
export async function payoutRakebackForPeriod(from: Date, to: Date): Promise<{ paid: number; users: number }> {
  const admin = supabaseAdmin();

  const { data: vipRows } = await admin.from('vip_status').select('user_id, rakeback_bps');
  if (!vipRows) return { paid: 0, users: 0 };
  const rateByUser = new Map(vipRows.map(v => [v.user_id, v.rakeback_bps]));

  // Aggregate rake per user in the period
  const { data: rake } = await admin.from('ledger_entries')
    .select('user_id, delta')
    .eq('kind', 'rake')
    .gte('created_at', from.toISOString())
    .lt('created_at', to.toISOString());
  if (!rake) return { paid: 0, users: 0 };

  const totals = new Map<string, number>();
  for (const r of rake) {
    totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + Math.abs(Number(r.delta)));
  }

  let totalPaid = 0;
  let users = 0;
  for (const [userId, rakePaid] of totals) {
    const bps = rateByUser.get(userId) ?? 1500;
    const amount = Math.floor((rakePaid * bps) / 10000);
    if (amount === 0) continue;

    // Idempotent insert; on conflict ignore
    const { data: existing } = await admin.from('rakeback_payouts')
      .select('id').eq('user_id', userId).eq('period_start', from.toISOString()).eq('period_end', to.toISOString())
      .maybeSingle();
    if (existing) continue;

    const { data: ledgerId } = await admin.rpc('credit_chips', {
      p_user_id: userId,
      p_amount: amount,
      p_kind: 'rakeback' as never,                  // some installs treat as 'adjustment'
      p_ref_table: 'rakeback_payouts',
      p_ref_id: null,
      p_metadata: { rake_paid: rakePaid, bps },
    });
    await admin.from('rakeback_payouts').insert({
      user_id: userId,
      period_start: from.toISOString(),
      period_end: to.toISOString(),
      rake_paid: rakePaid,
      rakeback_bps: bps,
      payout_amount: amount,
      paid_ledger_id: typeof ledgerId === 'number' ? ledgerId : null,
    });
    totalPaid += amount;
    users++;
  }
  return { paid: totalPaid, users };
}
