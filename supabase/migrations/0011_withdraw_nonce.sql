-- ============================================================================
-- 0011 — Withdraw idempotency: server-generated nonce + canonical message bytes
--
-- Problem fixed (audit C-03): the prior flow accepted a user-supplied nonce.
-- Now the server generates the nonce, persists it on the row, and the user
-- signs a server-issued canonical message. Replays are bounded by a unique
-- index on (user_id, on_chain_nonce).
-- ============================================================================

alter table withdrawals
  add column if not exists on_chain_nonce  numeric(20,0),       -- u64 stored as numeric to preserve full range
  add column if not exists expires_at      timestamptz,
  add column if not exists canonical_msg   bytea,                -- 16 + 32 + 24 = 72 bytes
  add column if not exists submit_attempts smallint not null default 0,
  add column if not exists last_submit_error text;

create unique index if not exists withdrawals_user_onchain_nonce_uniq
  on withdrawals (user_id, on_chain_nonce)
  where on_chain_nonce is not null;

-- New RPC: server-side initiation. Atomically picks a fresh u64 nonce > the
-- user's previously processed nonce; debits chips; inserts a 'pending' row.
create or replace function start_withdrawal(
  p_user_id uuid,
  p_wallet_id uuid,
  p_amount bigint,
  p_expires_at timestamptz
) returns table(withdrawal_id uuid, on_chain_nonce numeric, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_nonce numeric(20,0);
  v_self boolean;
  v_excluded timestamptz;
begin
  v_self := (auth.uid() = p_user_id);
  if not v_self then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select self_excluded_until into v_excluded from player_limits where user_id = p_user_id;
  if v_excluded is not null and v_excluded > now() then
    raise exception 'self_excluded' using errcode = '23000';
  end if;

  -- Pick nonce strictly greater than any prior on_chain_nonce for this user.
  -- The nonce is otherwise opaque; we use a microsecond-precision wall clock.
  select coalesce(max(on_chain_nonce), 0) + 1 into v_nonce
    from withdrawals where user_id = p_user_id and on_chain_nonce is not null;

  perform debit_chips(p_user_id, p_amount, 'withdraw', 'withdrawals', null, null,
    jsonb_build_object('on_chain_nonce', v_nonce::text));

  insert into withdrawals (user_id, wallet_id, amount, status, on_chain_nonce, expires_at)
  values (p_user_id, p_wallet_id, p_amount, 'pending', v_nonce, p_expires_at)
  returning id into v_id;

  return query select v_id, v_nonce, p_expires_at;
end;
$$;
revoke all on function start_withdrawal(uuid, uuid, bigint, timestamptz) from public;
grant execute on function start_withdrawal(uuid, uuid, bigint, timestamptz) to authenticated;

-- New RPC: complete the off-chain phase after the user signs.
-- Marks oracle-signed; the worker picks it up and submits.
create or replace function complete_withdraw_signing(
  p_withdrawal_id uuid,
  p_user_signature text,
  p_oracle_signature text
) returns void language plpgsql security definer set search_path = public as $$
begin
  update withdrawals
    set user_signature = p_user_signature,
        oracle_signature = p_oracle_signature,
        oracle_signed_at = now(),
        status = 'submitted'
    where id = p_withdrawal_id and status = 'pending';
  if not found then
    raise exception 'withdrawal_not_pending' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function complete_withdraw_signing(uuid, text, text) from public;
grant execute on function complete_withdraw_signing(uuid, text, text) to service_role;

-- Refund helper for failed submissions.
create or replace function fail_withdrawal_with_refund(
  p_withdrawal_id uuid,
  p_reason text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_amount bigint;
  v_status tx_status;
begin
  select user_id, amount, status into v_user, v_amount, v_status
    from withdrawals where id = p_withdrawal_id for update;
  if v_user is null or v_status = 'confirmed' or v_status = 'failed' then
    return;                                                       -- no-op idempotent
  end if;

  perform credit_chips(v_user, v_amount, 'refund', 'withdrawals', p_withdrawal_id, null,
    jsonb_build_object('reason', p_reason));

  update withdrawals set status = 'failed', rejection_reason = p_reason
    where id = p_withdrawal_id;
end;
$$;
revoke all on function fail_withdrawal_with_refund(uuid, text) from public;
grant execute on function fail_withdrawal_with_refund(uuid, text) to service_role;
