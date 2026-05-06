-- ============================================================================
-- Stacks Poker — Core schema
-- All money is represented in micro-units (1 USDC = 1_000_000 micro-units).
-- All chips in a player's balance are backed 1:1 by USDC in the on-chain vault.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_stat_statements;
create extension if not exists "uuid-ossp";

-- ─── Enums ────────────────────────────────────────────────────────────────────

create type kyc_status as enum ('none', 'pending', 'approved', 'rejected', 'expired');
create type table_kind as enum ('cash', 'sng', 'mtt');
create type table_status as enum ('open', 'paused', 'closing', 'closed');
create type seat_status as enum ('active', 'sitting_out', 'reserved', 'leaving');
create type hand_phase as enum ('preflop', 'flop', 'turn', 'river', 'showdown', 'complete');
create type action_type as enum ('post_blind', 'post_ante', 'check', 'call', 'bet', 'raise', 'fold', 'all_in', 'time_out', 'show', 'muck');
create type tournament_status as enum ('scheduled', 'registering', 'late_reg', 'running', 'paused', 'completed', 'cancelled');
create type tournament_entry_status as enum ('registered', 'playing', 'busted', 'paid', 'refunded');
create type ledger_kind as enum ('deposit', 'withdraw', 'buyin', 'cashout', 'pot_won', 'pot_lost', 'fee', 'rake', 'tournament_buyin', 'tournament_prize', 'refund', 'adjustment');
create type tx_status as enum ('pending', 'submitted', 'confirmed', 'failed', 'cancelled');

-- ─── Profiles ─────────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext unique not null,
  display_name text,
  avatar_url text,
  country_code char(2),
  kyc_status kyc_status not null default 'none',
  kyc_inquiry_id text,
  is_banned boolean not null default false,
  ban_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,24}$')
);

create extension if not exists citext;

create index profiles_kyc_idx on profiles (kyc_status) where kyc_status <> 'approved';

-- ─── Wallets (users may link multiple Solana wallets) ─────────────────────────

create table wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  address text not null,
  chain text not null default 'solana',
  is_primary boolean not null default false,
  verified_at timestamptz,
  challenge text,
  challenge_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chain, address),
  unique (user_id, address)
);

create unique index wallets_one_primary_per_user on wallets (user_id) where is_primary;

-- ─── Balances + ledger ────────────────────────────────────────────────────────

create table balances (
  user_id uuid primary key references profiles(id) on delete cascade,
  chips bigint not null default 0 check (chips >= 0),
  locked_chips bigint not null default 0 check (locked_chips >= 0),
  updated_at timestamptz not null default now(),
  constraint locked_le_chips check (locked_chips <= chips)
);

-- Append-only ledger. Every chip movement is recorded here.
create table ledger_entries (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete restrict,
  delta bigint not null,                     -- positive = credit, negative = debit
  balance_after bigint not null,             -- chips after this entry
  kind ledger_kind not null,
  ref_table text,                            -- tables.id, tournaments.id, etc.
  ref_id uuid,
  ref_hand_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index ledger_user_created_idx on ledger_entries (user_id, created_at desc);
create index ledger_kind_idx on ledger_entries (kind, created_at desc);
create index ledger_ref_idx on ledger_entries (ref_table, ref_id);

-- ─── Cash & tournament tables ─────────────────────────────────────────────────

create table tables (
  id uuid primary key default gen_random_uuid(),
  shard int not null default 0,                   -- which game-server shard owns this table
  kind table_kind not null,
  name text not null,
  max_seats smallint not null check (max_seats between 2 and 10),
  small_blind bigint not null check (small_blind > 0),
  big_blind bigint not null check (big_blind >= small_blind),
  ante bigint not null default 0 check (ante >= 0),
  min_buyin bigint not null check (min_buyin >= big_blind * 20),
  max_buyin bigint not null check (max_buyin >= min_buyin),
  rake_bps int not null default 500 check (rake_bps between 0 and 1000), -- basis points (5% default)
  rake_cap bigint not null default 0,             -- 0 = no cap; otherwise max rake in micros
  is_private boolean not null default false,
  status table_status not null default 'open',
  tournament_id uuid,                              -- non-null for tournament tables
  current_hand_id uuid,
  hand_count bigint not null default 0,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create index tables_kind_status_idx on tables (kind, status) where status = 'open';
create index tables_tournament_idx on tables (tournament_id) where tournament_id is not null;
create index tables_shard_idx on tables (shard, status);

create table table_seats (
  table_id uuid not null references tables(id) on delete cascade,
  seat_idx smallint not null check (seat_idx between 0 and 9),
  user_id uuid references profiles(id) on delete set null,
  stack bigint not null default 0 check (stack >= 0),
  status seat_status not null default 'active',
  reserved_until timestamptz,
  sat_at timestamptz default now(),
  is_dealer boolean not null default false,
  is_sb boolean not null default false,
  is_bb boolean not null default false,
  dead_button boolean not null default false,
  primary key (table_id, seat_idx),
  unique (table_id, user_id)
);

create index table_seats_user_idx on table_seats (user_id) where user_id is not null;

-- ─── Hands ────────────────────────────────────────────────────────────────────

create table hands (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references tables(id) on delete cascade,
  hand_number bigint not null,
  dealer_seat smallint not null,
  sb_seat smallint not null,
  bb_seat smallint not null,
  seed_commitment text not null,                  -- SHA-256 of (server_seed || client_entropy)
  client_entropy text not null,                   -- aggregated from player joins
  seed_reveal text,                               -- revealed at showdown for verification
  deck_order int[] not null,                      -- 0..51, ordered after deal
  board_cards smallint[],                         -- 0..4, dealt incrementally
  small_blind bigint not null,
  big_blind bigint not null,
  ante bigint not null default 0,
  pot bigint not null default 0,
  rake bigint not null default 0,
  phase hand_phase not null default 'preflop',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  unique (table_id, hand_number)
);

create index hands_table_started_idx on hands (table_id, started_at desc);

-- Hole cards stored encrypted-at-rest; only readable by service role.
-- Each player's row is removed after showdown if they mucked, retained if shown.
create table hand_hole_cards (
  hand_id uuid not null references hands(id) on delete cascade,
  seat_idx smallint not null,
  user_id uuid not null references profiles(id) on delete cascade,
  cards smallint[2] not null,                     -- 0..51, two cards
  shown boolean not null default false,
  primary key (hand_id, seat_idx)
);

create table hand_actions (
  id bigserial primary key,
  hand_id uuid not null references hands(id) on delete cascade,
  sequence int not null,
  seat_idx smallint not null,
  user_id uuid references profiles(id) on delete set null,
  phase hand_phase not null,
  action action_type not null,
  amount bigint not null default 0,
  pot_after bigint not null,
  to_call bigint not null default 0,
  time_taken_ms int,
  created_at timestamptz not null default now(),
  unique (hand_id, sequence)
);

create index hand_actions_hand_idx on hand_actions (hand_id, sequence);

create table hand_results (
  hand_id uuid not null references hands(id) on delete cascade,
  seat_idx smallint not null,
  user_id uuid references profiles(id) on delete set null,
  winnings bigint not null default 0,
  hand_rank int,                                  -- 0..9 (high card .. straight flush)
  hand_value bigint,                              -- packed tiebreakers
  hole_cards smallint[2],                         -- nullable if mucked
  shown boolean not null default false,
  primary key (hand_id, seat_idx)
);

create index hand_results_user_idx on hand_results (user_id, hand_id);

-- ─── Tournaments ──────────────────────────────────────────────────────────────

create table blind_structures (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  levels jsonb not null,                          -- [{level, sb, bb, ante, duration_seconds}, ...]
  starting_stack bigint not null,
  level_seconds int not null default 600,
  break_minutes int not null default 5,
  break_after_levels int[] not null default '{}',
  created_at timestamptz not null default now()
);

create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind table_kind not null check (kind in ('sng', 'mtt')),
  buy_in bigint not null check (buy_in >= 0),
  fee bigint not null default 0 check (fee >= 0),
  rake_bps int not null default 0,
  prize_pool bigint not null default 0,
  guaranteed_prize_pool bigint not null default 0,
  blind_structure_id uuid not null references blind_structures(id),
  starting_stack bigint not null,
  max_players int not null,
  min_players int not null,
  late_reg_minutes int not null default 0,
  rebuy_allowed boolean not null default false,
  rebuy_levels int not null default 0,
  addon_allowed boolean not null default false,
  payout_structure jsonb not null,                -- [{place, pct_bps}, ...]
  scheduled_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  status tournament_status not null default 'scheduled',
  current_level int not null default 0,
  registered_count int not null default 0,
  active_count int not null default 0,
  created_at timestamptz not null default now()
);

create index tournaments_status_scheduled_idx on tournaments (status, scheduled_at);

create table tournament_entries (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status tournament_entry_status not null default 'registered',
  table_id uuid references tables(id) on delete set null,
  seat_idx smallint,
  stack bigint not null,
  position int,                                   -- finishing position (1 = winner)
  prize bigint not null default 0,
  registered_at timestamptz not null default now(),
  busted_at timestamptz,
  rebuys int not null default 0,
  primary key (tournament_id, user_id)
);

create index tournament_entries_status_idx on tournament_entries (tournament_id, status);

-- ─── On-chain custody ─────────────────────────────────────────────────────────

create table deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete restrict,
  wallet_id uuid references wallets(id) on delete set null,
  amount bigint not null check (amount > 0),
  tx_signature text unique not null,
  slot bigint,
  status tx_status not null default 'pending',
  confirmed_at timestamptz,
  credited_ledger_id bigint references ledger_entries(id),
  created_at timestamptz not null default now()
);

create index deposits_user_status_idx on deposits (user_id, status);

create table withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete restrict,
  wallet_id uuid not null references wallets(id) on delete restrict,
  amount bigint not null check (amount > 0),
  status tx_status not null default 'pending',
  user_signature text,                            -- user's wallet sig over withdrawal intent
  oracle_signed_at timestamptz,
  oracle_signature text,                          -- server oracle sig
  tx_signature text unique,                       -- final on-chain tx
  debited_ledger_id bigint references ledger_entries(id),
  rejection_reason text,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index withdrawals_status_idx on withdrawals (status, requested_at);

-- ─── Chat ─────────────────────────────────────────────────────────────────────

create table table_messages (
  id bigserial primary key,
  table_id uuid not null references tables(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  content text not null check (length(content) between 1 and 280),
  is_system boolean not null default false,
  created_at timestamptz not null default now()
);

create index table_messages_table_idx on table_messages (table_id, created_at desc);

-- ─── Security & integrity ────────────────────────────────────────────────────

create table session_events (
  id bigserial primary key,
  user_id uuid references profiles(id) on delete set null,
  event text not null,
  ip inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index session_events_user_created_idx on session_events (user_id, created_at desc);
create index session_events_event_idx on session_events (event, created_at desc);

create table security_flags (
  id bigserial primary key,
  user_id uuid references profiles(id) on delete cascade,
  kind text not null,                             -- 'collusion', 'multi_account', 'bot', 'abuse'
  severity smallint not null default 1 check (severity between 1 and 5),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'open',            -- 'open', 'reviewed', 'dismissed', 'enforced'
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer uuid references profiles(id)
);

create index security_flags_status_idx on security_flags (status, severity desc, created_at desc);

create table device_fingerprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  fingerprint text not null,
  ip inet,
  user_agent text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  count int not null default 1,
  unique (user_id, fingerprint)
);

create index device_fingerprints_fp_idx on device_fingerprints (fingerprint);

-- ─── Player limits (responsible gambling) ────────────────────────────────────

create table player_limits (
  user_id uuid primary key references profiles(id) on delete cascade,
  daily_deposit_limit bigint,
  weekly_deposit_limit bigint,
  monthly_deposit_limit bigint,
  daily_loss_limit bigint,
  session_minutes_limit int,
  self_excluded_until timestamptz,
  cool_off_until timestamptz,
  updated_at timestamptz not null default now()
);

-- ─── Triggers: updated_at + balance invariants ───────────────────────────────

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

create trigger balances_updated_at before update on balances
  for each row execute function set_updated_at();

create trigger player_limits_updated_at before update on player_limits
  for each row execute function set_updated_at();

-- ─── Auto-create profile + balance on auth signup ─────────────────────────────

create or replace function handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
begin
  v_username := lower(coalesce(
    new.raw_user_meta_data->>'username',
    'player_' || substr(replace(new.id::text, '-', ''), 1, 10)
  ));

  insert into public.profiles (id, username) values (new.id, v_username);
  insert into public.balances (user_id) values (new.id);
  insert into public.player_limits (user_id) values (new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
