-- ============================================================================
-- Player retention + Pro tooling + Lobby/search.
--   • VIP tiers, rakeback, missions, leaderboards, freerolls, bad-beat-jackpot
--   • Player notes, preferences (themes, auto-rebuy/top-up)
--   • Friends, table favorites, observer mode flags
-- ============================================================================

-- ─── VIP tiers + Rakeback ────────────────────────────────────────────────────

create type vip_tier as enum ('bronze', 'silver', 'gold', 'platinum', 'diamond', 'black');

create table if not exists vip_status (
  user_id uuid primary key references profiles(id) on delete cascade,
  tier vip_tier not null default 'bronze',
  points_30d bigint not null default 0,            -- rolling-window points used for tier
  points_lifetime bigint not null default 0,
  rakeback_bps int not null default 1500 check (rakeback_bps between 0 and 10000),
  next_tier_progress_bps int not null default 0,   -- 0..10000 visible progress to next tier
  updated_at timestamptz not null default now()
);

-- Points awarded per chip raked. Tunable per region/promotion.
create table if not exists vip_tier_thresholds (
  tier vip_tier primary key,
  min_points_30d bigint not null,
  rakeback_bps int not null,
  display_color text,
  perks jsonb not null default '{}'::jsonb
);

-- Seeded thresholds (reasonable industry-standard targets, in micro-USDC rake).
insert into vip_tier_thresholds (tier, min_points_30d, rakeback_bps, display_color, perks) values
  ('bronze',   0,            1500, '#a16207', jsonb_build_object('rakeback_pct', 15)),
  ('silver',   25_000_000,   2500, '#94a3b8', jsonb_build_object('rakeback_pct', 25)),
  ('gold',     150_000_000,  4000, '#d4af37', jsonb_build_object('rakeback_pct', 40, 'reload_bonus_pct', 25)),
  ('platinum', 500_000_000,  5500, '#e2e8f0', jsonb_build_object('rakeback_pct', 55, 'reload_bonus_pct', 50, 'monthly_bonus', 100_000_000)),
  ('diamond',  1_500_000_000,6500, '#22d3ee', jsonb_build_object('rakeback_pct', 65, 'reload_bonus_pct', 75, 'monthly_bonus', 500_000_000, 'personal_manager', true)),
  ('black',    5_000_000_000,7500, '#0f172a', jsonb_build_object('rakeback_pct', 75, 'reload_bonus_pct', 100, 'monthly_bonus', 2_000_000_000, 'personal_manager', true, 'invite_only', true))
on conflict (tier) do update set
  min_points_30d = excluded.min_points_30d,
  rakeback_bps = excluded.rakeback_bps,
  display_color = excluded.display_color,
  perks = excluded.perks;

create table if not exists rakeback_payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  rake_paid bigint not null,                       -- chips of rake the user contributed
  rakeback_bps int not null,                       -- rate at time of payout
  payout_amount bigint not null,                   -- chips returned to player
  paid_ledger_id bigint references ledger_entries(id),
  created_at timestamptz not null default now(),
  unique (user_id, period_start, period_end)
);
create index if not exists rakeback_payouts_user_idx on rakeback_payouts (user_id, created_at desc);

-- Per-user 30-day rolling rake ledger view (refreshed by cron job)
create materialized view if not exists user_rake_30d as
select user_id,
       sum(case when kind = 'rake' then -delta else 0 end) as rake_30d
from ledger_entries
where created_at > now() - interval '30 days'
group by user_id;
create unique index if not exists user_rake_30d_idx on user_rake_30d (user_id);

-- ─── Reload bonuses + welcome bonuses ────────────────────────────────────────

create type bonus_kind as enum ('welcome', 'reload', 'tier_upgrade', 'seasonal', 'referral', 'first_deposit_match');
create type bonus_status as enum ('offered', 'claimed', 'fully_released', 'expired', 'revoked');

create table if not exists bonus_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind bonus_kind not null,
  match_bps int not null default 10000,            -- 100% match by default
  max_amount bigint not null,
  /** chips required to be raked to release the bonus (typical 25–35× bonus). */
  release_rake_required bigint not null default 0,
  release_rake_paid bigint not null default 0,
  pending_amount bigint not null default 0,
  released_amount bigint not null default 0,
  expires_at timestamptz,
  claimed_at timestamptz,
  status bonus_status not null default 'offered',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bonus_offers_user_idx on bonus_offers (user_id, status, expires_at);

-- ─── Missions / quests ───────────────────────────────────────────────────────

create type mission_kind as enum (
  'play_n_hands', 'win_n_hands', 'win_with_specific_hand', 'reach_showdown_with_x',
  'win_pots_total', 'play_n_tournaments', 'final_table', 'cash_in_tournament',
  'rakeback_n_chips', 'streak_n_days'
);
create type mission_period as enum ('daily', 'weekly', 'monthly', 'seasonal', 'one_off');

create table if not exists mission_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  kind mission_kind not null,
  target jsonb not null,                           -- e.g. { hands: 100 } or { rank: 8, type: 'pocket_aces' }
  reward_kind text not null check (reward_kind in ('chips', 'tournament_ticket', 'bonus_chips', 'cosmetic', 'vip_points')),
  reward_amount bigint not null default 0,
  reward_metadata jsonb not null default '{}'::jsonb,
  period mission_period not null,
  active_from timestamptz not null default now(),
  active_until timestamptz,
  display_order int not null default 0
);

create table if not exists mission_progress (
  user_id uuid not null references profiles(id) on delete cascade,
  template_id uuid not null references mission_templates(id) on delete cascade,
  progress bigint not null default 0,
  target_at_assign bigint not null,
  assigned_at timestamptz not null default now(),
  completed_at timestamptz,
  claimed_at timestamptz,
  primary key (user_id, template_id)
);
create index if not exists mission_progress_user_state_idx on mission_progress (user_id, completed_at, claimed_at);

-- Seed 10 starter missions
insert into mission_templates (name, description, kind, target, reward_kind, reward_amount, period, display_order) values
  ('Daily Hands', 'Play 50 hands today', 'play_n_hands', jsonb_build_object('hands', 50), 'chips', 1_000_000, 'daily', 1),
  ('Weekly Marathon', 'Play 1,000 hands this week', 'play_n_hands', jsonb_build_object('hands', 1000), 'chips', 25_000_000, 'weekly', 2),
  ('Pocket Rockets', 'Win a pot with pocket aces', 'win_with_specific_hand', jsonb_build_object('hand', 'AA'), 'chips', 5_000_000, 'weekly', 3),
  ('Big Slick', 'Win a pot with AK suited', 'win_with_specific_hand', jsonb_build_object('hand', 'AKs'), 'chips', 3_000_000, 'weekly', 4),
  ('Tournament Time', 'Play 3 tournaments this week', 'play_n_tournaments', jsonb_build_object('count', 3), 'chips', 10_000_000, 'weekly', 5),
  ('Final Table', 'Reach a tournament final table', 'final_table', '{}'::jsonb, 'chips', 20_000_000, 'weekly', 6),
  ('Cash Out', 'Cash in any tournament', 'cash_in_tournament', '{}'::jsonb, 'chips', 5_000_000, 'weekly', 7),
  ('Hand Hunter', 'Win 10 hands today', 'win_n_hands', jsonb_build_object('count', 10), 'chips', 2_000_000, 'daily', 8),
  ('Rake Hero', 'Generate 100k chips of rake', 'rakeback_n_chips', jsonb_build_object('amount', 100_000_000), 'bonus_chips', 10_000_000, 'weekly', 9),
  ('Login Streak', 'Log in 7 days in a row', 'streak_n_days', jsonb_build_object('days', 7), 'chips', 30_000_000, 'one_off', 10)
on conflict do nothing;

-- ─── Leaderboards ────────────────────────────────────────────────────────────

create type leaderboard_metric as enum (
  'tournament_winnings', 'cash_winnings', 'rake_paid', 'hands_won', 'pots_won_size', 'tournament_points'
);

create table if not exists leaderboards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  metric leaderboard_metric not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  prize_pool bigint not null,
  payout_structure jsonb not null,                  -- [{ rank, prize_bps }]
  is_published boolean not null default true
);
create index if not exists leaderboards_active_idx on leaderboards (starts_at, ends_at) where is_published;

create table if not exists leaderboard_scores (
  leaderboard_id uuid not null references leaderboards(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  score bigint not null default 0,
  rank int,
  primary key (leaderboard_id, user_id)
);
create index if not exists leaderboard_scores_lb_score_idx on leaderboard_scores (leaderboard_id, score desc);

-- ─── Freerolls (zero buy-in tournaments — referenced via tournaments table) ─

-- Already supported via tournaments.buy_in = 0 + tournaments.fee = 0. We just
-- add a flag to surface them in the lobby.
alter table tournaments
  add column if not exists is_freeroll boolean generated always as (buy_in = 0 and fee = 0) stored;

-- ─── Bad-Beat Jackpot ────────────────────────────────────────────────────────

create table if not exists bad_beat_jackpots (
  id uuid primary key default gen_random_uuid(),
  scope text not null unique,                       -- 'global' | 'cash_micro' | 'cash_low' | etc.
  pot_amount bigint not null default 0,
  contribution_bps int not null default 50,         -- 0.5% of every raked pot
  qualifying_hand_min_rank int not null default 8,  -- e.g. quad 8s+ to lose with
  qualifying_hand_min_value bigint,                 -- packed comparable value
  loser_share_bps int not null default 5000,        -- 50% to loser
  winner_share_bps int not null default 3000,       -- 30% to winner of hand
  table_share_bps int not null default 2000,        -- 20% split among all dealt-in players
  last_won_at timestamptz,
  last_winner_user_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

insert into bad_beat_jackpots (scope, contribution_bps, qualifying_hand_min_rank, loser_share_bps, winner_share_bps, table_share_bps)
values
  ('global', 50, 8, 5000, 3000, 2000)
on conflict (scope) do nothing;

create table if not exists bad_beat_payouts (
  id bigserial primary key,
  jackpot_id uuid not null references bad_beat_jackpots(id) on delete cascade,
  hand_id uuid not null references hands(id) on delete set null,
  loser_user_id uuid not null references profiles(id),
  loser_amount bigint not null,
  winner_user_id uuid not null references profiles(id),
  winner_amount bigint not null,
  table_user_ids uuid[] not null,
  table_share_per_player bigint not null,
  total_paid bigint not null,
  paid_at timestamptz not null default now()
);

-- ─── Hand-of-the-day (community spotlight) ───────────────────────────────────

create table if not exists hand_of_the_day (
  id bigserial primary key,
  hand_id uuid not null references hands(id) on delete cascade,
  reason text,
  pot_size bigint,
  description text,
  shown_on date not null default current_date,
  unique (shown_on)
);

-- ─── Player notes (Pro tooling) ──────────────────────────────────────────────

create table if not exists player_notes (
  user_id uuid not null references profiles(id) on delete cascade,
  target_user_id uuid not null references profiles(id) on delete cascade,
  note text not null default '',
  color_tag text check (color_tag in ('red', 'orange', 'yellow', 'green', 'blue', 'purple', 'gray', 'pink')),
  updated_at timestamptz not null default now(),
  primary key (user_id, target_user_id),
  check (user_id <> target_user_id)
);
create index if not exists player_notes_user_idx on player_notes (user_id);

-- ─── User preferences (themes, auto-rebuy, etc.) ─────────────────────────────

create table if not exists user_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  theme text not null default 'felt-classic',           -- felt-classic | felt-dark | felt-blue | felt-noir
  card_back text not null default 'red-classic',        -- red-classic | navy | gold-foil | minimal | retro
  sound_pack text not null default 'standard',          -- standard | quiet | tournament | retro
  master_volume int not null default 80 check (master_volume between 0 and 100),
  enable_chip_sounds boolean not null default true,
  enable_voice boolean not null default true,
  enable_video boolean not null default true,
  default_video_quality text not null default 'auto' check (default_video_quality in ('auto', 'low', 'medium', 'high')),
  show_action_animations boolean not null default true,
  show_equity_at_showdown boolean not null default true,
  show_equity_pre_showdown boolean not null default false,
  auto_rebuy boolean not null default false,
  auto_rebuy_threshold_bps int not null default 5000,   -- when stack drops below 50% of max_buyin
  auto_rebuy_amount_bps int not null default 10000,     -- rebuy back to max
  auto_topup boolean not null default false,
  auto_topup_threshold_bps int not null default 5000,
  multi_tabling_enabled boolean not null default true,
  max_simultaneous_tables int not null default 4 check (max_simultaneous_tables between 1 and 24),
  fast_fold_warn boolean not null default true,
  big_blind_display text not null default 'chips' check (big_blind_display in ('chips', 'bb_count')),
  updated_at timestamptz not null default now()
);

-- ─── Friends ─────────────────────────────────────────────────────────────────

create type friendship_status as enum ('pending', 'accepted', 'declined', 'blocked');

create table if not exists friendships (
  user_id uuid not null references profiles(id) on delete cascade,
  friend_user_id uuid not null references profiles(id) on delete cascade,
  status friendship_status not null default 'pending',
  initiated_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_id, friend_user_id),
  check (user_id <> friend_user_id)
);
create index if not exists friendships_friend_idx on friendships (friend_user_id, status);

-- ─── Table favorites ─────────────────────────────────────────────────────────

create table if not exists table_favorites (
  user_id uuid not null references profiles(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (user_id, table_id)
);

-- ─── Observer mode flags (already supported by RLS — public tables are
-- observable by default; private tables: need an entry here to observe).

create table if not exists table_observers (
  table_id uuid not null references tables(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (table_id, user_id)
);

-- ─── Hand history exports (for download tracking) ─────────────────────────

create table if not exists hand_history_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  format text not null check (format in ('pokerstars', 'gg', 'json', 'csv')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  hand_count int not null default 0,
  size_bytes bigint not null default 0,
  storage_path text,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
create index if not exists hand_history_exports_user_idx on hand_history_exports (user_id, created_at desc);

-- ─── Login streak tracking ───────────────────────────────────────────────────

create table if not exists login_streaks (
  user_id uuid primary key references profiles(id) on delete cascade,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_login_date date not null default current_date,
  updated_at timestamptz not null default now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table vip_status enable row level security;
alter table vip_tier_thresholds enable row level security;
alter table rakeback_payouts enable row level security;
alter table bonus_offers enable row level security;
alter table mission_templates enable row level security;
alter table mission_progress enable row level security;
alter table leaderboards enable row level security;
alter table leaderboard_scores enable row level security;
alter table bad_beat_jackpots enable row level security;
alter table bad_beat_payouts enable row level security;
alter table hand_of_the_day enable row level security;
alter table player_notes enable row level security;
alter table user_preferences enable row level security;
alter table friendships enable row level security;
alter table table_favorites enable row level security;
alter table table_observers enable row level security;
alter table hand_history_exports enable row level security;
alter table login_streaks enable row level security;

-- Public reads for leaderboards / VIP thresholds / mission templates / jackpots
create policy "vip_thresholds: public" on vip_tier_thresholds for select using (true);
create policy "vip_status: owner" on vip_status for select using (auth.uid() = user_id);
create policy "leaderboards: public" on leaderboards for select using (is_published);
create policy "leaderboard_scores: public" on leaderboard_scores for select using (true);
create policy "missions: public templates" on mission_templates for select using (active_until is null or active_until > now());
create policy "mission_progress: owner" on mission_progress for select using (auth.uid() = user_id);
create policy "bonus_offers: owner" on bonus_offers for select using (auth.uid() = user_id);
create policy "rakeback_payouts: owner" on rakeback_payouts for select using (auth.uid() = user_id);
create policy "bbj: public" on bad_beat_jackpots for select using (true);
create policy "bbj_payouts: public" on bad_beat_payouts for select using (true);
create policy "hotd: public" on hand_of_the_day for select using (true);

create policy "notes: owner only" on player_notes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "prefs: owner read"  on user_preferences for select using (auth.uid() = user_id);
create policy "prefs: owner write" on user_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "friendships: read involving me"
  on friendships for select using (auth.uid() = user_id or auth.uid() = friend_user_id);
create policy "friendships: I initiate"
  on friendships for insert with check (auth.uid() = initiated_by and auth.uid() in (user_id, friend_user_id));
create policy "friendships: I respond"
  on friendships for update using (auth.uid() in (user_id, friend_user_id))
                          with check (auth.uid() in (user_id, friend_user_id));
create policy "friendships: delete mine"
  on friendships for delete using (auth.uid() in (user_id, friend_user_id));

create policy "favorites: owner" on table_favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "observers: owner" on table_observers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "hh_exports: owner" on hand_history_exports for select using (auth.uid() = user_id);
create policy "login_streaks: owner" on login_streaks for select using (auth.uid() = user_id);

-- ─── Triggers ────────────────────────────────────────────────────────────────

create or replace function ensure_user_preferences() returns trigger language plpgsql as $$
begin
  insert into user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into vip_status (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_user_prefs on profiles;
create trigger trg_user_prefs after insert on profiles for each row execute function ensure_user_preferences();

-- ─── BBJ contribution helper (called by atomic_pot_settle on raked pots) ────

create or replace function bbj_contribute(p_pot_amount bigint, p_scope text default 'global')
returns bigint language plpgsql as $$
declare
  v_jackpot_id uuid;
  v_bps int;
  v_contribution bigint;
begin
  select id, contribution_bps into v_jackpot_id, v_bps
    from bad_beat_jackpots where scope = p_scope;
  if v_jackpot_id is null then return 0; end if;
  v_contribution := floor((p_pot_amount * v_bps) / 10000);
  if v_contribution > 0 then
    update bad_beat_jackpots set pot_amount = pot_amount + v_contribution where id = v_jackpot_id;
  end if;
  return v_contribution;
end;
$$;

-- ─── BBJ trigger settler ─────────────────────────────────────────────────────

create or replace function bbj_award(
  p_jackpot_id uuid,
  p_hand_id uuid,
  p_loser_user_id uuid,
  p_winner_user_id uuid,
  p_table_user_ids uuid[]
) returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_pot bigint;
  v_loser_share bigint;
  v_winner_share bigint;
  v_table_share bigint;
  v_table_per_player bigint;
  v_loser_share_bps int;
  v_winner_share_bps int;
  v_table_share_bps int;
  v_seat_count int;
  v_uid uuid;
begin
  select pot_amount, loser_share_bps, winner_share_bps, table_share_bps
    into v_pot, v_loser_share_bps, v_winner_share_bps, v_table_share_bps
    from bad_beat_jackpots where id = p_jackpot_id for update;
  if v_pot is null or v_pot = 0 then return 0; end if;

  v_loser_share := floor((v_pot * v_loser_share_bps) / 10000);
  v_winner_share := floor((v_pot * v_winner_share_bps) / 10000);
  v_table_share := v_pot - v_loser_share - v_winner_share;
  v_seat_count := coalesce(array_length(p_table_user_ids, 1), 0);
  v_table_per_player := case when v_seat_count > 0 then floor(v_table_share / v_seat_count) else 0 end;

  -- Loser
  perform credit_chips(p_loser_user_id, v_loser_share, 'pot_won', 'bad_beat_jackpots', p_jackpot_id, p_hand_id,
    jsonb_build_object('bbj', true, 'role', 'loser'));
  -- Winner
  perform credit_chips(p_winner_user_id, v_winner_share, 'pot_won', 'bad_beat_jackpots', p_jackpot_id, p_hand_id,
    jsonb_build_object('bbj', true, 'role', 'winner'));
  -- Each seat at the table gets table_per_player
  if v_table_per_player > 0 then
    foreach v_uid in array p_table_user_ids loop
      if v_uid is not null and v_uid <> p_loser_user_id and v_uid <> p_winner_user_id then
        perform credit_chips(v_uid, v_table_per_player, 'pot_won', 'bad_beat_jackpots', p_jackpot_id, p_hand_id,
          jsonb_build_object('bbj', true, 'role', 'seated'));
      end if;
    end loop;
  end if;

  insert into bad_beat_payouts (jackpot_id, hand_id, loser_user_id, loser_amount, winner_user_id, winner_amount,
    table_user_ids, table_share_per_player, total_paid)
  values (p_jackpot_id, p_hand_id, p_loser_user_id, v_loser_share, p_winner_user_id, v_winner_share,
    p_table_user_ids, v_table_per_player, v_pot);

  update bad_beat_jackpots set pot_amount = 0, last_won_at = now(), last_winner_user_id = p_loser_user_id
    where id = p_jackpot_id;
  return v_pot;
end;
$$;
