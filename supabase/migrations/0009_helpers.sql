-- Small helpers used by the game server.

create or replace function increment_mission_progress(
  p_user_id uuid,
  p_template_id uuid,
  p_target bigint
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into mission_progress (user_id, template_id, progress, target_at_assign)
  values (p_user_id, p_template_id, 1, p_target)
  on conflict (user_id, template_id) do update
    set progress = mission_progress.progress + 1,
        completed_at = case
          when mission_progress.completed_at is not null then mission_progress.completed_at
          when (mission_progress.progress + 1) >= mission_progress.target_at_assign then now()
          else null
        end
  where mission_progress.claimed_at is null;
end;
$$;

create or replace function refresh_user_rake_30d() returns void language plpgsql security definer as $$
begin
  refresh materialized view concurrently user_rake_30d;
exception when others then
  refresh materialized view user_rake_30d;
end;
$$;

grant execute on function increment_mission_progress(uuid, uuid, bigint) to service_role;
grant execute on function refresh_user_rake_30d() to service_role;
