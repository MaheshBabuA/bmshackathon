begin;

alter table public.incidents
  add column if not exists response_units integer not null default 0
    check (response_units between 0 and 500);

create table if not exists public.command_center_state (
  id text primary key check (id = 'bengaluru'),
  emergency_capacity_mw numeric(8, 3) not null
    check (emergency_capacity_mw between 0 and 45),
  emergency_capacity_limit_mw numeric(8, 3) not null default 45
    check (emergency_capacity_limit_mw between 0 and 45),
  city_grid_capacity_mw numeric(8, 3) not null
    check (city_grid_capacity_mw > 0),
  city_grid_base_load_mw numeric(8, 3) not null
    check (city_grid_base_load_mw >= 0),
  telemetry_nodes_active integer not null
    check (telemetry_nodes_active >= 0),
  telemetry_online_percentage numeric(5, 2) not null
    check (telemetry_online_percentage between 0 and 100),
  grid_stability_index numeric(5, 2) not null
    check (grid_stability_index between 0 and 100),
  ambient_temperature_c numeric(5, 2) not null,
  updated_at timestamptz not null default now(),
  check (emergency_capacity_mw <= emergency_capacity_limit_mw)
);

alter table public.command_center_state enable row level security;

create or replace function public.sync_recommended_plan_capacity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_capacity_mw numeric(8, 3);
begin
  if new.status = 'recommended' then
    select emergency_capacity_mw into current_capacity_mw
    from public.command_center_state
    where id = 'bengaluru';
    if found then
      new.total_available_capacity_mw := current_capacity_mw;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists allocation_plans_sync_recommended_capacity
  on public.allocation_plans;
create trigger allocation_plans_sync_recommended_capacity
  before insert on public.allocation_plans
  for each row execute function public.sync_recommended_plan_capacity();

create or replace function public.sync_telemetry_available_capacity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_capacity_mw numeric(8, 3);
begin
  select emergency_capacity_mw into current_capacity_mw
  from public.command_center_state
  where id = 'bengaluru';
  if found then
    new.available_capacity_mw := current_capacity_mw;
  end if;
  return new;
end;
$$;

drop trigger if exists telemetry_snapshots_sync_available_capacity
  on public.telemetry_snapshots;
create trigger telemetry_snapshots_sync_available_capacity
  before insert on public.telemetry_snapshots
  for each row execute function public.sync_telemetry_available_capacity();

create or replace function public.transfer_emergency_reserve(p_amount_mw numeric)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  state_row public.command_center_state%rowtype;
  active_allocation_mw numeric(8, 3);
  city_grid_load_mw numeric(8, 3);
  transferred boolean := false;
  reason text;
begin
  if p_amount_mw is null or p_amount_mw <= 0 or p_amount_mw > 1 then
    raise exception 'Reserve transfer must be greater than 0 and at most 1 MW.';
  end if;

  select * into state_row
  from public.command_center_state
  where id = 'bengaluru'
  for update;

  if not found then
    raise exception 'Command Center state is not configured.';
  end if;

  select coalesce(total_capacity_mw, 0) into active_allocation_mw
  from public.allocation_plans
  where status = 'approved'
  order by approved_at desc nulls last, created_at desc
  limit 1;
  active_allocation_mw := coalesce(active_allocation_mw, 0);
  city_grid_load_mw := state_row.city_grid_base_load_mw + active_allocation_mw;

  if state_row.emergency_capacity_mw + p_amount_mw >
     state_row.emergency_capacity_limit_mw then
    reason := 'The emergency reserve is already at its 45 MW allocation cap.';
  elsif city_grid_load_mw + p_amount_mw > state_row.city_grid_capacity_mw then
    reason := 'The city grid has insufficient headroom for this reserve transfer.';
  else
    update public.command_center_state
    set emergency_capacity_mw = emergency_capacity_mw + p_amount_mw,
        updated_at = now()
    where id = 'bengaluru';
    update public.allocation_plans
    set total_available_capacity_mw = state_row.emergency_capacity_mw + p_amount_mw,
        updated_at = now()
    where id = (
      select id
      from public.allocation_plans
      where status = 'approved'
      order by approved_at desc nulls last, created_at desc
      limit 1
    );
    update public.telemetry_snapshots
    set available_capacity_mw = state_row.emergency_capacity_mw + p_amount_mw
    where id = (
      select id
      from public.telemetry_snapshots
      where sector_id is null
      order by captured_at desc
      limit 1
    );
    transferred := true;
    reason := 'Reserve capacity transferred within the city-grid and emergency-capacity limits.';
  end if;

  insert into public.audit_logs (
    actor, action, entity_type, entity_id, details,
    event_type, description, metadata
  ) values (
    'City Authority',
    case when transferred then 'reserve.transfer.completed' else 'reserve.transfer.denied' end,
    'command_center_state',
    'bengaluru',
    jsonb_build_object(
      'requested_capacity_mw', p_amount_mw,
      'previous_capacity_mw', state_row.emergency_capacity_mw,
      'new_capacity_mw', case
        when transferred then state_row.emergency_capacity_mw + p_amount_mw
        else state_row.emergency_capacity_mw
      end,
      'emergency_capacity_limit_mw', state_row.emergency_capacity_limit_mw,
      'city_grid_load_mw', city_grid_load_mw,
      'city_grid_capacity_mw', state_row.city_grid_capacity_mw,
      'transferred', transferred,
      'reason', reason
    ),
    case when transferred then 'reserve.transfer.completed' else 'reserve.transfer.denied' end,
    reason,
    jsonb_build_object('simulation_only', true)
  );

  return jsonb_build_object(
    'transferred', transferred,
    'reason', reason,
    'requestedCapacityMw', p_amount_mw,
    'availableCapacityMw', case
      when transferred then state_row.emergency_capacity_mw + p_amount_mw
      else state_row.emergency_capacity_mw
    end,
    'maximumCapacityMw', state_row.emergency_capacity_limit_mw,
    'cityGridLoadMw', city_grid_load_mw,
    'cityGridCapacityMw', state_row.city_grid_capacity_mw
  );
end;
$$;

revoke all on function public.transfer_emergency_reserve(numeric) from public;
grant execute on function public.transfer_emergency_reserve(numeric) to service_role;

commit;
