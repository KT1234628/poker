-- ============================================================================
-- 0010 — Audit fixes: data integrity, RLS gaps, money-loss prevention.
-- Replaces or hardens functions defined in earlier migrations.
-- Safe to re-run; all DDL is idempotent.
-- ============================================================================

-- ─── 1. atomic_pot_settle: idempotent + correct chip vs locked_chips invariant
-- Pre-fix bugs:
--   • Adds winnings to BOTH chips and locked_chips → chips can exceed real
--     deposits when the winner cashes out (release_stack only decrements locked).
--   • Re-running with the same hand_id double-credits because hand_results UPSERT
--     does not idempotency-gate the balances mutation.
--
-- Post-fix: locks the hands row FOR UPDATE, aborts if already settled, only
-- credits locked_chips (chips are released at cashout), settle is one-shot.

create or replace function atomic_pot_settle(
  p_hand_id uuid,
  p_payouts jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_payout jsonb;
  v_user uuid;
  v_seat smallint;
  v_amount bigint;
  v_table uuid;
  v_already_settled boolean;
begin
  -- Lock the hand row to serialize concurrent settle attempts.
  select table_id, (ended_at is not null)
    into v_table, v_already_settled
    from hands where id = p_hand_id for update;
  if v_already_settled then
    -- idempotent: silently no-op
    return;
  end if;

  for v_payout in select * from jsonb_array_elements(p_payouts) loop
    v_user := (v_payout->>'user_id')::uuid;
    v_seat := (v_payout->>'seat_idx')::smallint;
    v_amount := (v_payout->>'amount')::bigint;

    if v_amount > 0 and v_user is not null then
      -- Pot wins are credited to LOCKED_CHIPS only (chips at the table).
      -- They become spendable only after release_stack on cashout / table-leave.
      update balances
        set locked_chips = locked_chips + v_amount
        where user_id = v_user;

      insert into ledger_entries (user_id, delta, balance_after, kind, ref_table, ref_id, ref_hand_id, metadata)
      select v_user, v_amount, chips, 'pot_won', 'hands', p_hand_id, p_hand_id,
             jsonb_build_object('seat', v_seat)
      from balances where user_id = v_user;

      update table_seats
        set stack = stack + v_amount
        where table_id = v_table and seat_idx = v_seat;
    end if;

    insert into hand_results (hand_id, seat_idx, user_id, winnings, hand_rank, hand_value)
    values (p_hand_id, v_seat, v_user, v_amount,
            (v_payout->>'hand_rank')::int,
            nullif(v_payout->>'hand_value','')::bigint)
    on conflict (hand_id, seat_idx) do update
      set winnings = excluded.winnings,
          hand_rank = excluded.hand_rank,
          hand_value = excluded.hand_value;
  end loop;

  update hands set ended_at = now(), phase = 'complete' where id = p_hand_id;
end;
$$;

-- ─── 2. lock_buyin / release_stack: capture balance via RETURNING; require lock
create or replace function lock_buyin(
  p_user_id uuid,
  p_table_id uuid,
  p_amount bigint
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
begin
  update balances
    set chips = chips - p_amount,
        locked_chips = locked_chips + p_amount
    where user_id = p_user_id and chips >= p_amount
    returning chips into v_balance;

  if not found then
    raise exception 'lock_buyin: insufficient funds for user %', p_user_id using errcode = '22000';
  end if;

  insert into ledger_entries (user_id, delta, balance_after, kind, ref_table, ref_id, metadata)
  values (p_user_id, -p_amount, v_balance, 'buyin', 'tables', p_table_id, jsonb_build_object('table_id', p_table_id));
end;
$$;

create or replace function release_stack(
  p_user_id uuid,
  p_table_id uuid,
  p_amount bigint
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
begin
  update balances
    set chips = chips + p_amount,
        locked_chips = locked_chips - p_amount
    where user_id = p_user_id and locked_chips >= p_amount
    returning chips into v_balance;

  if not found then
    raise exception 'release_stack: locked_chips < amount for user %', p_user_id using errcode = '22000';
  end if;

  insert into ledger_entries (user_id, delta, balance_after, kind, ref_table, ref_id, metadata)
  values (p_user_id, p_amount, v_balance, 'cashout', 'tables', p_table_id, jsonb_build_object('table_id', p_table_id));
end;
$$;

-- ─── 3. bbj_contribute: SECURITY DEFINER + amount > 0 check + revoke from public
create or replace function bbj_contribute(p_pot_amount bigint, p_scope text default 'global')
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_jackpot_id uuid;
  v_bps int;
  v_contribution bigint;
begin
  if p_pot_amount <= 0 then return 0; end if;          -- reject negatives & zero
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

revoke all on function bbj_contribute(bigint, text) from public;
grant execute on function bbj_contribute(bigint, text) to service_role;

-- ─── 4. bbj_award + increment_mission_progress: revoke from public
revoke all on function bbj_award(uuid, uuid, uuid, uuid, uuid[]) from public;
grant execute on function bbj_award(uuid, uuid, uuid, uuid, uuid[]) to service_role;

revoke all on function increment_mission_progress(uuid, uuid, bigint) from public;
grant execute on function increment_mission_progress(uuid, uuid, bigint) to service_role;

revoke all on function refresh_user_rake_30d() from public;
grant execute on function refresh_user_rake_30d() to service_role;

-- ─── 5. Wallets: only enforce uniqueness on VERIFIED addresses
-- A user can claim an unverified wallet but cannot block legitimate ownership.
do $$ begin
  if exists (
    select 1 from pg_constraint where conname = 'wallets_chain_address_key'
  ) then
    alter table wallets drop constraint wallets_chain_address_key;
  end if;
exception when undefined_table or undefined_object then null;
end $$;

create unique index if not exists wallets_verified_chain_address_uniq
  on wallets (chain, address)
  where verified_at is not null;

-- ─── 6. Self-exclusion: monotonic-only (cannot shorten)
create or replace function set_self_exclusion(
  p_user_id uuid,
  p_until timestamptz
) returns void language plpgsql security definer set search_path = public as $$
begin
  update player_limits
    set self_excluded_until = greatest(coalesce(self_excluded_until, now()), p_until),
        updated_at = now()
    where user_id = p_user_id;
end;
$$;
revoke all on function set_self_exclusion(uuid, timestamptz) from public;
grant execute on function set_self_exclusion(uuid, timestamptz) to authenticated;

-- ─── 7. Deposits + Withdrawals: partial indexes for queue-scan paths
create index if not exists deposits_pending_idx on deposits (created_at) where status = 'pending';
create index if not exists withdrawals_pending_idx on withdrawals (requested_at) where status in ('pending', 'submitted');

-- ─── 8. hand_actions sanity checks
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hand_actions_seq_nonneg')
  then alter table hand_actions add constraint hand_actions_seq_nonneg check (sequence >= 0); end if;
  if not exists (select 1 from pg_constraint where conname = 'hand_actions_amount_nonneg')
  then alter table hand_actions add constraint hand_actions_amount_nonneg check (amount >= 0); end if;
end $$;

-- ─── 9. hands.deck_order must be exactly 52 cards
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hands_deck_order_len_chk')
  then alter table hands add constraint hands_deck_order_len_chk
    check (deck_order is null or array_length(deck_order, 1) = 52); end if;
end $$;

-- ─── 10. hand_hole_cards must be 2 distinct cards in [0,51]
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hand_hole_cards_valid_chk')
  then alter table hand_hole_cards add constraint hand_hole_cards_valid_chk
    check (
      cards is not null
      and array_length(cards, 1) = 2
      and cards[1] between 0 and 51
      and cards[2] between 0 and 51
      and cards[1] <> cards[2]
    ); end if;
end $$;

-- ─── 11. tournaments prize_pool / payout_structure shape
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_prize_pool_nonneg')
  then alter table tournaments add constraint tournaments_prize_pool_nonneg check (prize_pool >= 0); end if;
  if not exists (select 1 from pg_constraint where conname = 'tournaments_payout_is_array')
  then alter table tournaments add constraint tournaments_payout_is_array
    check (jsonb_typeof(payout_structure) = 'array'); end if;
end $$;

-- ─── 12. bonus_offers consistency
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bonus_offers_release_consistency')
  then alter table bonus_offers add constraint bonus_offers_release_consistency
    check (released_amount + pending_amount <= max_amount); end if;
end $$;

-- ─── 13. user_rake_30d matview: revoke from public
do $$ begin
  execute 'revoke all on user_rake_30d from public, anon, authenticated';
exception when others then null;
end $$;

-- ─── 14. table_messages: only seated active/sitting_out users insert
drop policy if exists "table_messages: seated user inserts" on table_messages;
create policy "table_messages: seated user inserts"
  on table_messages for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from table_seats ts
      where ts.table_id = table_messages.table_id
        and ts.user_id = auth.uid()
        and ts.status in ('active', 'sitting_out')
    )
  );

-- ─── 15. handle_new_auth_user: tolerate username collision
create or replace function handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_attempts int := 0;
  v_unique_suffix text;
begin
  v_username := lower(coalesce(
    new.raw_user_meta_data->>'username',
    'player_' || substr(replace(new.id::text, '-', ''), 1, 10)
  ));

  -- Collision retry: suffix with random hex up to 5 attempts
  loop
    begin
      insert into public.profiles (id, username) values (new.id, v_username);
      exit;
    exception when unique_violation then
      v_attempts := v_attempts + 1;
      if v_attempts >= 5 then
        v_username := 'player_' || substr(replace(new.id::text, '-', ''), 1, 12);
        insert into public.profiles (id, username) values (new.id, v_username);
        exit;
      end if;
      v_unique_suffix := substr(md5(random()::text), 1, 4);
      v_username := substr(v_username, 1, 19) || '_' || v_unique_suffix;
    end;
  end loop;

  insert into public.balances (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.player_limits (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ─── 16. ensure_user_preferences: tolerate missing thresholds
create or replace function ensure_user_preferences() returns trigger language plpgsql as $$
begin
  insert into user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into vip_status (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
exception when others then
  -- never block profile creation on prefs/vip seeding errors
  return new;
end;
$$;

-- ─── 17. tournament_register_atomic: single-fn atomic registration to prevent race
create or replace function tournament_register_atomic(
  p_tournament_id uuid,
  p_user_id uuid,
  p_buy_in bigint,
  p_fee bigint,
  p_starting_stack bigint,
  p_is_re_entry boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_t record;
  v_total bigint := p_buy_in + p_fee;
  v_rake_bps int;
  v_rake bigint;
  v_existing_count int := 0;
begin
  -- Lock tournament row
  select id, max_players, registered_count, status, allow_re_entry,
         re_entry_max, current_level, re_entry_until_level, prize_pool,
         rake_bps
    into v_t
    from tournaments where id = p_tournament_id for update;
  if v_t is null then raise exception 'tournament_not_found' using errcode = 'P0001'; end if;
  if v_t.status not in ('scheduled', 'registering', 'late_reg') then
    raise exception 'tournament_closed' using errcode = 'P0001';
  end if;
  if v_t.registered_count >= v_t.max_players then
    raise exception 'tournament_full' using errcode = 'P0001';
  end if;

  if p_is_re_entry then
    select coalesce(re_entry_count, 0) into v_existing_count
      from tournament_entries
      where tournament_id = p_tournament_id and user_id = p_user_id;
    if v_t.allow_re_entry is not true then
      raise exception 're_entry_disabled' using errcode = 'P0001';
    end if;
    if v_t.re_entry_max > 0 and v_existing_count >= v_t.re_entry_max then
      raise exception 're_entry_cap_reached' using errcode = 'P0001';
    end if;
    if v_t.re_entry_until_level > 0 and v_t.current_level > v_t.re_entry_until_level then
      raise exception 're_entry_window_closed' using errcode = 'P0001';
    end if;
  end if;

  -- Debit chips
  perform debit_chips(p_user_id, v_total, 'tournament_buyin', 'tournaments', p_tournament_id, null,
                      jsonb_build_object('re_entry', p_is_re_entry));

  -- Insert / update entry
  insert into tournament_entries (tournament_id, user_id, status, stack, is_re_entry, re_entry_count)
  values (p_tournament_id, p_user_id, 'registered', p_starting_stack, p_is_re_entry, v_existing_count + (case when p_is_re_entry then 1 else 0 end))
  on conflict (tournament_id, user_id) do update
    set status = 'registered',
        stack = excluded.stack,
        is_re_entry = excluded.is_re_entry,
        re_entry_count = excluded.re_entry_count,
        busted_at = null;

  v_rake := floor((p_buy_in * coalesce(v_t.rake_bps, 0)) / 10000);
  update tournaments
    set registered_count = v_t.registered_count + 1,
        prize_pool = v_t.prize_pool + (p_buy_in - v_rake)
    where id = p_tournament_id;
end;
$$;
revoke all on function tournament_register_atomic(uuid, uuid, bigint, bigint, bigint, boolean) from public;
grant execute on function tournament_register_atomic(uuid, uuid, bigint, bigint, bigint, boolean) to service_role;

-- ─── 18. mission_claim_atomic: TOCTOU-safe claim
create or replace function mission_claim_atomic(
  p_user_id uuid,
  p_template_id uuid
) returns table (ok boolean, reward bigint, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_reward bigint;
  v_kind text;
  v_name text;
begin
  -- Atomic claim: set claimed_at only if completed_at is set and claimed_at is null.
  update mission_progress
    set claimed_at = now()
    where user_id = p_user_id and template_id = p_template_id
      and completed_at is not null and claimed_at is null;
  if not found then
    return query select false, 0::bigint, 'not_complete_or_already_claimed'::text; return;
  end if;

  select reward_kind, reward_amount, name
    into v_kind, v_reward, v_name
    from mission_templates where id = p_template_id;
  if v_kind in ('chips', 'bonus_chips') and v_reward > 0 then
    perform credit_chips(p_user_id, v_reward, 'tournament_prize', 'mission_progress', null, null,
                         jsonb_build_object('mission', v_name));
  end if;
  return query select true, coalesce(v_reward, 0), null::text;
end;
$$;
revoke all on function mission_claim_atomic(uuid, uuid) from public;
grant execute on function mission_claim_atomic(uuid, uuid) to service_role;
