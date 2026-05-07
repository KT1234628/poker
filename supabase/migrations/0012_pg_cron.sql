-- ============================================================================
-- 0012 — Replace Vercel cron with pg_cron + pg_net.
--
-- Why: when self-hosting on Fly (or anywhere except Vercel) we lose the
-- vercel.json crons. Supabase ships with pg_cron + pg_net out of the box;
-- this migration schedules HTTP calls into our existing /api/cron/* endpoints
-- using the CRON_SECRET bearer.
--
-- One-time post-deploy step (NOT auto-applied — replace placeholder values):
--   update system_config set value = 'https://stacks-web.fly.dev' where key = 'cron.base_url';
--   update system_config set value = '<CRON_SECRET hex>'           where key = 'cron.secret';
--
-- After that, the four jobs at the bottom of this file run on schedule.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- A tiny KV table for runtime config that needs to be available to pg_cron
-- jobs (which can't read application env). Service-role only.
create table if not exists system_config (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table system_config enable row level security;

-- No SELECT/INSERT policies on purpose: only the service role accesses this.
-- (RLS-enabled with no policy = no rows visible to authenticated/anon.)

insert into system_config (key, value) values
  ('cron.base_url', 'http://localhost:3000'),     -- replace post-deploy
  ('cron.secret',   '')                            -- replace post-deploy
on conflict (key) do nothing;

-- Helper that fires an HTTP GET to one of our /api/cron/* endpoints with the
-- shared bearer. Returns the request id from pg_net (which exec is async; the
-- response status / body lives in net.http_response_collect).
create or replace function call_cron_endpoint(p_path text)
returns bigint language plpgsql security definer set search_path = public, net as $$
declare
  v_base text;
  v_secret text;
  v_req_id bigint;
begin
  select value into v_base   from system_config where key = 'cron.base_url';
  select value into v_secret from system_config where key = 'cron.secret';
  if v_base is null or v_base = '' or v_secret is null or v_secret = '' then
    raise notice 'cron skipped: base_url or secret not set';
    return null;
  end if;
  select net.http_get(
    url := v_base || p_path,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Accept',        'application/json'
    ),
    timeout_milliseconds := 30000
  ) into v_req_id;
  return v_req_id;
end;
$$;

revoke all on function call_cron_endpoint(text) from public;
grant execute on function call_cron_endpoint(text) to service_role;

-- Idempotently schedule each job. cron.schedule will INSERT or UPDATE.
do $$
declare
  v_jobs jsonb := jsonb_build_array(
    jsonb_build_object('name', 'vip-refresh',          'schedule', '0 3 * * *',  'path', '/api/cron/vip-refresh'),
    jsonb_build_object('name', 'rakeback-payout',      'schedule', '0 4 * * 1',  'path', '/api/cron/rakeback-payout'),
    jsonb_build_object('name', 'leaderboard-refresh',  'schedule', '*/10 * * * *','path', '/api/cron/leaderboard-refresh'),
    jsonb_build_object('name', 'leaderboard-payout',   'schedule', '5 0 * * *',  'path', '/api/cron/leaderboard-payout')
  );
  v_job jsonb;
  v_existing_id bigint;
begin
  for v_job in select * from jsonb_array_elements(v_jobs) loop
    select jobid into v_existing_id from cron.job where jobname = v_job->>'name';
    if v_existing_id is not null then
      perform cron.unschedule(v_existing_id);
    end if;
    perform cron.schedule(
      v_job->>'name',
      v_job->>'schedule',
      format('select call_cron_endpoint(%L)', v_job->>'path')
    );
  end loop;
end $$;

-- Optional: prune pg_net response buffer monthly so it doesn't grow forever.
do $$
declare
  v_existing_id bigint;
begin
  select jobid into v_existing_id from cron.job where jobname = 'pg_net-cleanup';
  if v_existing_id is not null then
    perform cron.unschedule(v_existing_id);
  end if;
  perform cron.schedule(
    'pg_net-cleanup',
    '0 5 1 * *',
    $clean$ delete from net._http_response where created < now() - interval '7 days' $clean$
  );
exception when others then null;  -- pg_net might rename internals; skip if it does
end $$;
