-- ============================================================================
-- Engine extensions: cash-game features that match the major operators.
--   • Run It Twice / Three Times (multi-board showdowns when all-in pre-river)
--   • Straddle (UTG, button, Mississippi)
--   • Cap games (max committed chips per hand)
--   • Bomb pots (every Nth hand, all players ante and the flop is dealt blind)
--   • Show one / show both (winner reveal options)
--   • Sit-out timer (anti-grinder: too many sit-outs → forced stand-up)
--   • Disconnect protection (all-in protection until reconnect window expires)
-- ============================================================================

create type straddle_kind as enum ('none', 'utg', 'button', 'mississippi');

alter table tables
  add column if not exists straddle_kind  straddle_kind not null default 'none',
  add column if not exists allow_re_straddle boolean not null default true,
  add column if not exists cap_amount     bigint not null default 0,             -- 0 = no cap
  add column if not exists allow_run_it_twice boolean not null default true,
  add column if not exists max_run_count  smallint not null default 2 check (max_run_count between 1 and 3),
  add column if not exists bomb_pot_every_n_hands int not null default 0,        -- 0 = disabled
  add column if not exists bomb_pot_ante  bigint not null default 0,
  add column if not exists hand_count_since_bomb int not null default 0,
  add column if not exists time_bank_enabled boolean not null default true,
  add column if not exists action_timer_seconds smallint not null default 20,
  add column if not exists time_bank_seconds smallint not null default 30,
  add column if not exists max_sit_outs   smallint not null default 6,           -- consecutive sit-outs before forced stand-up
  add column if not exists disconnect_protect_seconds smallint not null default 90;  -- all-in protection window

-- Per-seat sit-out counter (resets on action)
alter table table_seats
  add column if not exists consecutive_sit_outs smallint not null default 0,
  add column if not exists last_disconnect_at timestamptz,
  add column if not exists straddle_committed bigint not null default 0,
  add column if not exists time_bank_remaining_ms int not null default 30000;

-- Hand-level run tracking
alter table hands
  add column if not exists run_count smallint not null default 1 check (run_count between 1 and 3),
  add column if not exists boards smallint[][],                 -- array of board_cards arrays, one per run
  add column if not exists is_bomb_pot boolean not null default false,
  add column if not exists straddle_amount bigint not null default 0,
  add column if not exists straddle_seats smallint[] not null default '{}',
  add column if not exists rit_voters smallint[] not null default '{}',          -- seats that voted yes to RIT
  add column if not exists rit_decision smallint;                                 -- final run count agreed

-- Per-hand-per-board winnings (RIT splits the pot per board)
create table if not exists hand_board_results (
  hand_id uuid not null references hands(id) on delete cascade,
  board_idx smallint not null check (board_idx between 0 and 2),
  seat_idx smallint not null,
  user_id uuid references profiles(id) on delete set null,
  winnings bigint not null default 0,
  hand_rank int,
  hand_value bigint,
  primary key (hand_id, board_idx, seat_idx)
);
create index if not exists hand_board_results_user_idx on hand_board_results (user_id);

-- Show-card decisions (after pot awarded, optional reveal)
alter table hand_results
  add column if not exists show_choice text check (show_choice in ('show_both', 'show_one_low', 'show_one_high', 'muck')) default 'muck';

-- Reservation table for waiting lists in the lobby
create table if not exists table_waitlist (
  id bigserial primary key,
  table_id uuid not null references tables(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  notified_at timestamptz,
  unique (table_id, user_id)
);
create index if not exists table_waitlist_table_idx on table_waitlist (table_id, joined_at);

-- RLS: waitlist is public read, owner write
alter table table_waitlist enable row level security;
create policy "table_waitlist: public read" on table_waitlist for select using (true);
create policy "table_waitlist: owner inserts" on table_waitlist for insert with check (auth.uid() = user_id);
create policy "table_waitlist: owner deletes" on table_waitlist for delete using (auth.uid() = user_id);
alter table hand_board_results enable row level security;
create policy "hand_board_results: public read" on hand_board_results for select using (true);
