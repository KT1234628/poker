-- ============================================================================
-- Atomic chip-movement functions used by the game server.
-- These functions run as SECURITY DEFINER so they can write to balances and
-- ledger_entries. The game server invokes them via the service role only.
-- ============================================================================

-- credit_chips: add chips to a user's balance and write a ledger entry atomically.
create or replace function credit_chips(
  p_user_id uuid,
  p_amount bigint,
  p_kind ledger_kind,
  p_ref_table text default null,
  p_ref_id uuid default null,
  p_ref_hand_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns bigint                                  -- returns ledger entry id
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_entry_id bigint;
begin
  if p_amount <= 0 then
    raise exception 'credit_chips: amount must be positive (got %)', p_amount using errcode = '22023';
  end if;

  update balances
    set chips = chips + p_amount
    where user_id = p_user_id
    returning chips into v_balance;

  if not found then
    raise exception 'credit_chips: balance row missing for user %', p_user_id using errcode = 'P0002';
  end if;

  insert into ledger_entries (user_id, delta, balance_after, kind, ref_table, ref_id, ref_hand_id, metadata)
  values (p_user_id, p_amount, v_balance, p_kind, p_ref_table, p_ref_id, p_ref_hand_id, p_metadata)
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- debit_chips: subtract chips and write a ledger entry. Throws if insufficient funds.
create or replace function debit_chips(
  p_user_id uuid,
  p_amount bigint,
  p_kind ledger_kind,
  p_ref_table text default null,
  p_ref_id uuid default null,
  p_ref_hand_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_entry_id bigint;
begin
  if p_amount <= 0 then
    raise exception 'debit_chips: amount must be positive (got %)', p_amount using errcode = '22023';
  end if;

  update balances
    set chips = chips - p_amount
    where user_id = p_user_id and chips >= p_amount
    returning chips into v_balance;

  if not found then
    raise exception 'debit_chips: insufficient funds for user %', p_user_id using errcode = '22000';
  end if;

  insert into ledger_entries (user_id, delta, balance_after, kind, ref_table, ref_id, ref_hand_id, metadata)
  values (p_user_id, -p_amount, v_balance, p_kind, p_ref_table, p_ref_id, p_ref_hand_id, p_metadata)
  returning id into v_entry_id;

  return v_entry_id;
end;
$$;

-- lock_buyin: move chips from balance.chips to balance.locked_chips when sitting down.
create or replace function lock_buyin(
  p_user_id uuid,
  p_table_id uuid,
  p_amount bigint
) returns void language plpgsql security definer set search_path = public as $$
begin
  update balances
    set chips = chips - p_amount,
        locked_chips = locked_chips + p_amount
    where user_id = p_user_id and chips >= p_amount;

  if not found then
    raise exception 'lock_buyin: insufficient funds for user %', p_user_id using errcode = '22000';
  end if;

  insert into ledger_entries (user_id, delta, balance_after, kind, ref_table, ref_id, metadata)
  select p_user_id, -p_amount, chips, 'buyin', 'tables', p_table_id, jsonb_build_object('table_id', p_table_id)
  from balances where user_id = p_user_id;
end;
$$;

-- release_stack: when leaving a table, move chips from locked back to chips.
create or replace function release_stack(
  p_user_id uuid,
  p_table_id uuid,
  p_amount bigint
) returns void language plpgsql security definer set search_path = public as $$
begin
  update balances
    set chips = chips + p_amount,
        locked_chips = greatest(0, locked_chips - p_amount)
    where user_id = p_user_id;

  insert into ledger_entries (user_id, delta, balance_after, kind, ref_table, ref_id, metadata)
  select p_user_id, p_amount, chips, 'cashout', 'tables', p_table_id, jsonb_build_object('table_id', p_table_id)
  from balances where user_id = p_user_id;
end;
$$;

-- credit_deposit: invoked when an on-chain deposit is confirmed.
create or replace function credit_deposit(
  p_deposit_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_amount bigint;
  v_entry_id bigint;
begin
  select user_id, amount into v_user, v_amount
  from deposits
  where id = p_deposit_id and status = 'confirmed' and credited_ledger_id is null
  for update;

  if not found then
    return;                                      -- already credited or not confirmed yet
  end if;

  v_entry_id := credit_chips(v_user, v_amount, 'deposit', 'deposits', p_deposit_id);

  update deposits set credited_ledger_id = v_entry_id where id = p_deposit_id;
end;
$$;

-- request_withdrawal: user-initiated; validates balance and locks chips by debiting.
create or replace function request_withdrawal(
  p_user_id uuid,
  p_wallet_id uuid,
  p_amount bigint,
  p_user_signature text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_entry_id bigint;
  v_self boolean;
begin
  select (auth.uid() = p_user_id) into v_self;
  if not v_self then
    raise exception 'request_withdrawal: not authorized' using errcode = '42501';
  end if;

  -- Self-exclusion check
  if exists (
    select 1 from player_limits
    where user_id = p_user_id
      and (self_excluded_until > now() or cool_off_until > now())
  ) then
    raise exception 'request_withdrawal: account in self-exclusion period' using errcode = '23000';
  end if;

  v_entry_id := debit_chips(p_user_id, p_amount, 'withdraw', 'withdrawals', null);

  insert into withdrawals (user_id, wallet_id, amount, status, user_signature, debited_ledger_id)
  values (p_user_id, p_wallet_id, p_amount, 'pending', p_user_signature, v_entry_id)
  returning id into v_id;

  return v_id;
end;
$$;

-- atomic_pot_settle: settle multiple winners for one hand atomically.
create or replace function atomic_pot_settle(
  p_hand_id uuid,
  p_payouts jsonb                                 -- [{user_id, seat_idx, amount, hand_rank, hand_value}, ...]
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_payout jsonb;
  v_user uuid;
  v_seat smallint;
  v_amount bigint;
  v_table uuid;
begin
  select table_id into v_table from hands where id = p_hand_id;

  for v_payout in select * from jsonb_array_elements(p_payouts) loop
    v_user := (v_payout->>'user_id')::uuid;
    v_seat := (v_payout->>'seat_idx')::smallint;
    v_amount := (v_payout->>'amount')::bigint;

    if v_amount > 0 and v_user is not null then
      update balances
        set chips = chips + v_amount,
            locked_chips = locked_chips + v_amount  -- still locked; chips return to chips on cashout
        where user_id = v_user;

      insert into ledger_entries (user_id, delta, balance_after, kind, ref_table, ref_id, ref_hand_id)
      select v_user, v_amount, chips, 'pot_won', 'hands', p_hand_id, p_hand_id
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

-- can_join_table: validates a user is allowed to sit at a table.
create or replace function can_join_table(
  p_user_id uuid,
  p_table_id uuid,
  p_buyin bigint
) returns table(allowed boolean, reason text) language plpgsql security definer set search_path = public as $$
declare
  v_kyc kyc_status;
  v_banned boolean;
  v_chips bigint;
  v_min bigint;
  v_max bigint;
  v_self_excl timestamptz;
begin
  select p.kyc_status, p.is_banned, b.chips, pl.self_excluded_until
    into v_kyc, v_banned, v_chips, v_self_excl
    from profiles p
    join balances b on b.user_id = p.id
    left join player_limits pl on pl.user_id = p.id
    where p.id = p_user_id;

  if v_banned then return query select false, 'account_banned'; return; end if;
  if v_self_excl is not null and v_self_excl > now() then return query select false, 'self_excluded'; return; end if;
  if v_kyc <> 'approved' then return query select false, 'kyc_required'; return; end if;

  select min_buyin, max_buyin into v_min, v_max from tables where id = p_table_id;
  if p_buyin < v_min or p_buyin > v_max then return query select false, 'buyin_out_of_range'; return; end if;
  if v_chips < p_buyin then return query select false, 'insufficient_chips'; return; end if;
  if exists (select 1 from table_seats where table_id = p_table_id and user_id = p_user_id) then
    return query select false, 'already_seated'; return;
  end if;

  return query select true, null::text;
end;
$$;

-- Grants: only authenticated role can call user-facing functions
grant execute on function request_withdrawal(uuid, uuid, bigint, text) to authenticated;
grant execute on function can_join_table(uuid, uuid, bigint) to authenticated;
-- All other functions are service-role only.
revoke all on function credit_chips(uuid, bigint, ledger_kind, text, uuid, uuid, jsonb) from public;
revoke all on function debit_chips(uuid, bigint, ledger_kind, text, uuid, uuid, jsonb) from public;
revoke all on function lock_buyin(uuid, uuid, bigint) from public;
revoke all on function release_stack(uuid, uuid, bigint) from public;
revoke all on function credit_deposit(uuid) from public;
revoke all on function atomic_pot_settle(uuid, jsonb) from public;
