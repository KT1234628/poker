// Seed script: creates a handful of cash tables and a daily MTT so the lobby
// is populated. Run with `pnpm db:seed`.
//
// Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  // ─── Cash tables ───────────────────────────────────────────────────────────
  const stakes = [
    { name: 'Micro 0.05/0.10', sb: 50_000n,    bb: 100_000n,    min: 2_000_000n,    max: 10_000_000n },
    { name: 'Low 0.25/0.50',   sb: 250_000n,   bb: 500_000n,    min: 10_000_000n,   max: 50_000_000n },
    { name: 'Mid 1/2',         sb: 1_000_000n, bb: 2_000_000n,  min: 40_000_000n,   max: 200_000_000n },
    { name: 'High 5/10',       sb: 5_000_000n, bb: 10_000_000n, min: 200_000_000n,  max: 1_000_000_000n },
  ] as const;

  for (const s of stakes) {
    for (let i = 1; i <= 4; i++) {
      const name = `${s.name} #${i}`;
      const { error } = await sb.from('tables').upsert({
        name,
        kind: 'cash',
        max_seats: i % 2 === 0 ? 6 : 9,
        small_blind: s.sb.toString(),
        big_blind: s.bb.toString(),
        ante: '0',
        min_buyin: s.min.toString(),
        max_buyin: s.max.toString(),
        rake_bps: 500,
        rake_cap: (BigInt(s.bb) * 5n).toString(),
        is_private: false,
        status: 'open',
      }, { onConflict: 'name' });
      if (error) console.error(name, error.message);
    }
  }
  console.log('Cash tables seeded.');

  // ─── Tournament: daily $10 freezeout ──────────────────────────────────────
  const { data: turbo } = await sb
    .from('blind_structures')
    .select('id, starting_stack')
    .eq('name', 'turbo')
    .maybeSingle();
  if (!turbo) {
    console.error('No turbo blind structure found — did 0004_seed_blinds.sql run?');
    return;
  }

  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 19, 0);

  const { error: tErr } = await sb.from('tournaments').upsert({
    name: 'Daily $10 Turbo',
    kind: 'mtt',
    buy_in: '9_000_000'.replace(/_/g, ''),
    fee:    '1_000_000'.replace(/_/g, ''),
    rake_bps: 0,
    prize_pool: 0,
    guaranteed_prize_pool: '500_000_000'.replace(/_/g, ''),    // $500 GTD
    blind_structure_id: turbo.id,
    starting_stack: turbo.starting_stack,
    max_players: 1000,
    min_players: 4,
    late_reg_minutes: 30,
    payout_structure: [
      { place: 1, pctBps: 3500 },
      { place: 2, pctBps: 2000 },
      { place: 3, pctBps: 1300 },
      { place: 4, pctBps: 900 },
      { place: 5, pctBps: 700 },
      { place: 6, pctBps: 500 },
      { place: 7, pctBps: 400 },
      { place: 8, pctBps: 300 },
      { place: 9, pctBps: 200 },
      { place: 10, pctBps: 200 },
    ],
    scheduled_at: tomorrow.toISOString(),
    status: 'scheduled',
  }, { onConflict: 'name' });
  if (tErr) console.error('Tournament:', tErr.message);
  else console.log('Daily Turbo tournament scheduled at', tomorrow.toISOString());

  console.log('Seed complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
