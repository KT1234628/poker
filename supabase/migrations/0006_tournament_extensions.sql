-- ============================================================================
-- Tournament extensions: features that match GGPoker / PokerStars.
--   • Synchronized starts (all tables start L1 at the same UTC second)
--   • Re-entry tournaments (re-buy after busting until level N)
--   • Knockout / Progressive KO / Mystery Bounty
--   • Satellites (winners get tickets to a target tournament)
--   • Time bank (per-player extra-action seconds)
--   • Live dashboard fields (registered_count, prize_pool ticker)
-- ============================================================================

create type tournament_format as enum (
  'freezeout',
  're_entry',
  'rebuy_addon',
  'knockout',
  'progressive_ko',
  'mystery_bounty',
  'satellite'
);

alter table tournaments
  add column if not exists format             tournament_format not null default 'freezeout',
  add column if not exists synchronized_start boolean not null default true,
  add column if not exists allow_re_entry     boolean not null default false,
  add column if not exists re_entry_max       int not null default 0,             -- 0 = unlimited
  add column if not exists re_entry_until_level int not null default 0,           -- last level allowed
  add column if not exists rebuy_chips        bigint not null default 0,
  add column if not exists addon_chips        bigint not null default 0,
  add column if not exists bounty_amount      bigint not null default 0,
  add column if not exists bounty_progressive_bps int not null default 5000,      -- 50% to player, 50% added to head
  add column if not exists mystery_bounty_pool jsonb,                              -- [{ amount, count, weight }, ...]
  add column if not exists satellite_target_id uuid references tournaments(id) on delete set null,
  add column if not exists satellite_seats_awarded int not null default 0,
  add column if not exists time_bank_seconds  smallint not null default 30,
  add column if not exists action_timer_seconds smallint not null default 20,
  add column if not exists tables_count       int not null default 0,             -- live count, ticker
  add column if not exists average_chip_stack bigint;

-- Per-entry bounty tracking
alter table tournament_entries
  add column if not exists bounty_balance     bigint not null default 0,           -- live bounty value on this player's head
  add column if not exists bounties_won       int not null default 0,
  add column if not exists bounties_won_total bigint not null default 0,
  add column if not exists is_re_entry        boolean not null default false,
  add column if not exists re_entry_count     int not null default 0,
  add column if not exists time_bank_remaining_ms int not null default 30000,
  add column if not exists ticket_award_id    uuid;                                 -- if won satellite, points to target tournament

-- Bounty payouts table
create table if not exists bounty_payouts (
  id bigserial primary key,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  hand_id uuid references hands(id) on delete set null,
  ko_user_id uuid not null references profiles(id),                        -- the player who got KO'd
  ko_by_user_id uuid not null references profiles(id),                     -- the player who eliminated them
  bounty_amount bigint not null,                                            -- amount paid for this KO
  added_to_head bigint not null default 0,                                  -- amount added to KO'er's bounty (PKO)
  is_mystery boolean not null default false,
  mystery_bucket text,                                                      -- e.g. 'small', 'medium', 'big', 'super'
  created_at timestamptz not null default now()
);
create index if not exists bounty_payouts_tour_idx on bounty_payouts (tournament_id, created_at desc);
create index if not exists bounty_payouts_kober_idx on bounty_payouts (ko_by_user_id);

-- Satellite ticket awards
create table if not exists satellite_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source_tournament_id uuid not null references tournaments(id) on delete cascade,
  target_tournament_id uuid not null references tournaments(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  used_at timestamptz,
  status text not null default 'unused' check (status in ('unused', 'used', 'expired', 'unregistered_for_cash'))
);
create index if not exists satellite_tickets_user_idx on satellite_tickets (user_id, status);

-- Tournament series (group of related events — e.g. "Sunday Series")
create table if not exists tournament_series (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total_guaranteed bigint not null default 0,
  banner_url text,
  created_at timestamptz not null default now()
);
alter table tournaments
  add column if not exists series_id uuid references tournament_series(id) on delete set null;

-- Tournament leaderboard (for series)
create table if not exists series_leaderboard (
  series_id uuid not null references tournament_series(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  points int not null default 0,
  cashes int not null default 0,
  final_tables int not null default 0,
  wins int not null default 0,
  primary key (series_id, user_id)
);
create index if not exists series_leaderboard_points_idx on series_leaderboard (series_id, points desc);

-- RLS
alter table bounty_payouts enable row level security;
alter table satellite_tickets enable row level security;
alter table tournament_series enable row level security;
alter table series_leaderboard enable row level security;

create policy "bounty_payouts: public read" on bounty_payouts for select using (true);
create policy "satellite_tickets: owner reads" on satellite_tickets for select using (auth.uid() = user_id);
create policy "tournament_series: public read" on tournament_series for select using (true);
create policy "series_leaderboard: public read" on series_leaderboard for select using (true);
