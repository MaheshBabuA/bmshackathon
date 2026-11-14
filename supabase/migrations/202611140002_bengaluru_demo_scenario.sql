alter table public.infrastructure_sectors
  add column if not exists icon text not null default 'domain',
  add column if not exists current_allocation_mw numeric(8, 3) not null default 0
    check (current_allocation_mw between 0 and 45),
  add column if not exists maximum_capacity_mw numeric(8, 3) not null default 45
    check (maximum_capacity_mw between 0 and 45),
  add column if not exists operational_flexibility numeric(4, 3) not null default 0.5
    check (operational_flexibility between 0 and 1),
  add column if not exists life_critical boolean not null default false,
  add column if not exists operational_status text not null default 'operational',
  add column if not exists metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object');

alter table public.infrastructure_sectors
  drop constraint if exists infrastructure_sectors_operational_status_check;
alter table public.infrastructure_sectors
  add constraint infrastructure_sectors_operational_status_check
    check (operational_status in (
      'operational', 'elevated', 'surge', 'degraded', 'offline'
    ));
alter table public.infrastructure_sectors
  drop constraint if exists infrastructure_sectors_current_within_maximum_check;
alter table public.infrastructure_sectors
  add constraint infrastructure_sectors_current_within_maximum_check
    check (current_allocation_mw <= maximum_capacity_mw);

alter table public.incidents
  add column if not exists incident_code text,
  add column if not exists address text;

update public.incidents
  set incident_code = 'INC-' || upper(replace(id::text, '-', ''))
  where incident_code is null
    or incident_code = 'INC-' ||
      upper(substr(replace(id::text, '-', ''), 1, 8));
update public.incidents set address = location where address is null;

alter table public.incidents
  alter column incident_code set not null,
  alter column address set not null;

create unique index if not exists incidents_incident_code_uidx
  on public.incidents (incident_code);

alter table public.incidents
  drop constraint if exists incidents_incident_type_check;
alter table public.incidents
  add constraint incidents_incident_type_check check (
    incident_type in (
      'medical',
      'fire',
      'fire_hazmat',
      'flood',
      'infrastructure',
      'telecommunications',
      'other'
    )
  );

alter table public.incident_impacts
  drop constraint if exists incident_impacts_demand_delta_mw_check;
alter table public.incident_impacts
  add constraint incident_impacts_demand_delta_mw_check
    check (demand_delta_mw between -45 and 45),
  add column if not exists impact_level text not null default 'moderate',
  add column if not exists reason text not null default '';

alter table public.incident_impacts
  drop constraint if exists incident_impacts_impact_level_check;
alter table public.incident_impacts
  add constraint incident_impacts_impact_level_check
    check (impact_level in ('critical', 'high', 'moderate', 'low', 'none'));

alter table public.allocation_plans
  add column if not exists incident_id uuid
    references public.incidents(id) on delete set null,
  add column if not exists total_available_capacity_mw numeric(8, 3)
    not null default 45 check (total_available_capacity_mw between 0 and 45),
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_at timestamptz,
  add column if not exists created_by text not null default 'system';

alter table public.allocation_plan_items
  add column if not exists previous_allocation_mw numeric(8, 3),
  add column if not exists recommended_allocation_mw numeric(8, 3),
  add column if not exists delta_mw numeric(8, 3),
  add column if not exists rationale text,
  add column if not exists safety_status text;

update public.allocation_plan_items item
  set previous_allocation_mw = coalesce(sector.current_allocation_mw, 0),
      recommended_allocation_mw = item.allocated_capacity_mw,
      delta_mw = item.allocated_capacity_mw -
        coalesce(sector.current_allocation_mw, 0),
      rationale = 'Existing allocation plan item.',
      safety_status = case
        when item.allocated_capacity_mw >= sector.minimum_safe_capacity_mw
          then 'safe'
        else 'below_minimum'
      end
  from public.infrastructure_sectors sector
  where sector.id = item.sector_id
    and (item.previous_allocation_mw is null
      or item.recommended_allocation_mw is null
      or item.delta_mw is null
      or item.rationale is null
      or item.safety_status is null);

alter table public.allocation_plan_items
  alter column previous_allocation_mw set not null,
  alter column recommended_allocation_mw set not null,
  alter column delta_mw set not null,
  alter column rationale set not null,
  alter column safety_status set not null;

alter table public.allocation_plan_items
  drop constraint if exists allocation_plan_items_delta_mw_check,
  drop constraint if exists allocation_plan_items_safety_status_check;
alter table public.allocation_plan_items
  add constraint allocation_plan_items_delta_mw_check
    check (delta_mw between -45 and 45),
  add constraint allocation_plan_items_safety_status_check
    check (safety_status in ('safe', 'below_minimum'));

alter table public.authority_reviews
  add column if not exists authority_name text not null default 'City Authority',
  add column if not exists authority_role text not null default 'Emergency Coordinator',
  add column if not exists comments text not null default '',
  add column if not exists decided_at timestamptz not null default now();

alter table public.emergency_reports
  add column if not exists category text not null default 'other',
  add column if not exists urgency text not null default 'urgent',
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists address text not null default '',
  add column if not exists language text not null default 'en',
  add column if not exists status text not null default 'received';

alter table public.emergency_reports
  drop constraint if exists emergency_reports_urgency_check,
  drop constraint if exists emergency_reports_status_check;
alter table public.emergency_reports
  add constraint emergency_reports_urgency_check
    check (urgency in ('critical', 'urgent', 'stable')),
  add constraint emergency_reports_status_check
    check (status in ('received', 'accepted', 'triaged', 'closed'));

update public.emergency_reports
  set address = location
  where address = '';

create or replace function public.sync_emergency_report_details()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_incident public.incidents%rowtype;
begin
  select * into v_incident
    from public.incidents
    where id = new.incident_id;
  if found then
    if new.category = 'other' then
      new.category := v_incident.incident_type;
    end if;
    if new.address = '' then
      new.address := coalesce(v_incident.address, new.location);
    end if;
    if new.latitude is null then
      new.latitude := v_incident.latitude;
    end if;
    if new.longitude is null then
      new.longitude := v_incident.longitude;
    end if;
  elsif new.address = '' then
    new.address := new.location;
  end if;
  if new.urgency = 'urgent' then
    new.urgency := new.severity;
  end if;
  return new;
end;
$$;

drop trigger if exists emergency_reports_sync_details
  on public.emergency_reports;
create trigger emergency_reports_sync_details
  before insert or update on public.emergency_reports
  for each row execute function public.sync_emergency_report_details();

alter table public.audit_logs
  add column if not exists event_type text not null default 'system.event',
  add column if not exists description text not null default '',
  add column if not exists metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object');

create or replace function public.sync_audit_log_details()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.event_type = 'system.event' then
    new.event_type := new.action;
  end if;
  if new.description = '' then
    new.description := new.action;
  end if;
  if new.metadata = '{}'::jsonb then
    new.metadata := new.details;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_logs_sync_details on public.audit_logs;
create trigger audit_logs_sync_details
  before insert or update on public.audit_logs
  for each row execute function public.sync_audit_log_details();

alter table public.telemetry_snapshots
  add column if not exists sector_id text
    references public.infrastructure_sectors(id),
  add column if not exists load_mw numeric(8, 3),
  add column if not exists capacity_mw numeric(8, 3),
  add column if not exists utilization_percentage numeric(6, 2),
  add column if not exists status text;

alter table public.telemetry_snapshots
  drop constraint if exists telemetry_snapshots_utilization_percentage_check,
  drop constraint if exists telemetry_snapshots_load_mw_check,
  drop constraint if exists telemetry_snapshots_capacity_mw_check;
alter table public.telemetry_snapshots
  add constraint telemetry_snapshots_utilization_percentage_check
    check (utilization_percentage is null or utilization_percentage between 0 and 100),
  add constraint telemetry_snapshots_load_mw_check
    check (load_mw is null or load_mw >= 0),
  add constraint telemetry_snapshots_capacity_mw_check
    check (capacity_mw is null or capacity_mw > 0);

create or replace function public.sync_incident_compatibility_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.incident_code is null or new.incident_code = '' then
    new.incident_code := 'INC-' || upper(replace(new.id::text, '-', ''));
  end if;
  if new.address is null or new.address = '' then
    new.address := new.location;
  end if;
  if new.location is null or new.location = '' then
    new.location := new.address;
  end if;
  return new;
end;
$$;

drop trigger if exists incidents_sync_compatibility_fields on public.incidents;
create trigger incidents_sync_compatibility_fields
  before insert or update on public.incidents
  for each row execute function public.sync_incident_compatibility_fields();

create or replace function public.sync_incident_impact_details()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.impact_level := case
    when new.impact_score >= 0.8 then 'high'
    when new.impact_score >= 0.5 then 'moderate'
    when new.impact_score > 0 then 'low'
    else 'none'
  end;
  if new.reason is null or new.reason = '' then
    new.reason := new.rationale;
  end if;
  return new;
end;
$$;

drop trigger if exists incident_impacts_sync_details on public.incident_impacts;
create trigger incident_impacts_sync_details
  before insert or update on public.incident_impacts
  for each row execute function public.sync_incident_impact_details();

create or replace function public.sync_allocation_plan_item_details()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_current numeric(8, 3);
  v_minimum numeric(8, 3);
  v_maximum numeric(8, 3);
begin
  select current_allocation_mw, minimum_safe_capacity_mw, maximum_capacity_mw
    into v_current, v_minimum, v_maximum
    from public.infrastructure_sectors
    where id = new.sector_id;

  if not found then
    raise exception 'Unknown infrastructure sector: %', new.sector_id;
  end if;

  new.previous_allocation_mw :=
    coalesce(new.previous_allocation_mw, v_current, 0);
  new.recommended_allocation_mw :=
    coalesce(new.recommended_allocation_mw, new.allocated_capacity_mw);
  new.allocated_capacity_mw := new.recommended_allocation_mw;
  if new.recommended_allocation_mw > v_maximum then
    raise exception
      'Allocation for % MW exceeds its % MW maximum capacity.',
      new.sector_id, v_maximum;
  end if;
  new.delta_mw :=
    new.recommended_allocation_mw - new.previous_allocation_mw;
  new.rationale :=
    coalesce(nullif(new.rationale, ''), 'Rules-based simulation recommendation.');
  new.safety_status := case
    when new.recommended_allocation_mw >= v_minimum then 'safe'
    else 'below_minimum'
  end;
  return new;
end;
$$;

drop trigger if exists allocation_plan_items_sync_details
  on public.allocation_plan_items;
create trigger allocation_plan_items_sync_details
  before insert or update on public.allocation_plan_items
  for each row execute function public.sync_allocation_plan_item_details();

create or replace function public.sync_allocation_plan_status()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_at := coalesce(new.approved_at, now());
    new.rejected_at := null;
  elsif new.status = 'rejected' and old.status is distinct from 'rejected' then
    new.rejected_at := coalesce(new.rejected_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists allocation_plans_sync_status on public.allocation_plans;
create trigger allocation_plans_sync_status
  before update of status on public.allocation_plans
  for each row execute function public.sync_allocation_plan_status();

create or replace function public.apply_active_plan_to_sector_allocations()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update public.infrastructure_sectors sector
      set current_allocation_mw = item.allocated_capacity_mw,
          updated_at = now()
      from public.allocation_plan_items item
      where item.allocation_plan_id = new.id
        and item.sector_id = sector.id;
  end if;
  return new;
end;
$$;

drop trigger if exists allocation_plans_apply_active_allocations
  on public.allocation_plans;
create trigger allocation_plans_apply_active_allocations
  after update of status on public.allocation_plans
  for each row execute function public.apply_active_plan_to_sector_allocations();

create or replace function public.write_allocation_plan(
  p_plan jsonb,
  p_actor text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
  v_item jsonb;
  v_total numeric(10, 3) := 0;
  v_count integer;
begin
  if jsonb_typeof(p_plan->'items') is distinct from 'array' then
    raise exception 'A plan must include an allocation item for every sector.';
  end if;

  select count(*), coalesce(sum((item->>'allocated_capacity_mw')::numeric), 0)
    into v_count, v_total
    from jsonb_array_elements(p_plan->'items') as item;

  if v_count <> (select count(*) from public.infrastructure_sectors)
    or (select count(distinct item->>'sector_id')
        from jsonb_array_elements(p_plan->'items') as item) <> v_count
    or exists (
      select 1
        from jsonb_array_elements(p_plan->'items') as item
        left join public.infrastructure_sectors sector
          on sector.id = item->>'sector_id'
        where sector.id is null
           or jsonb_typeof(item->'allocated_capacity_mw') <> 'number'
           or (item->>'allocated_capacity_mw')::numeric
                < sector.minimum_safe_capacity_mw
           or (item->>'allocated_capacity_mw')::numeric
                > sector.maximum_capacity_mw
    ) then
    raise exception 'Plan items must contain each sector exactly once and respect its safety floor.';
  end if;

  if v_total > 45 then
    raise exception 'Total allocation cannot exceed 45 MW.';
  end if;

  update public.allocation_plans
    set status = 'superseded', updated_at = now()
    where status = 'recommended';

  v_plan_id := coalesce(
    nullif(p_plan->>'id', '')::uuid,
    gen_random_uuid()
  );

  insert into public.allocation_plans (
    id, incident_id, title, status, total_capacity_mw,
    total_available_capacity_mw, rationale, created_by
  ) values (
    v_plan_id,
    nullif(p_plan->>'incident_id', '')::uuid,
    coalesce(nullif(p_plan->>'title', ''), 'Recommended emergency allocation'),
    'recommended',
    v_total,
    45,
    coalesce(p_plan->'rationale', '{}'::jsonb),
    p_actor
  );

  for v_item in select value from jsonb_array_elements(p_plan->'items')
  loop
    insert into public.allocation_plan_items (
      allocation_plan_id, sector_id, allocated_capacity_mw,
      previous_allocation_mw, recommended_allocation_mw, delta_mw, rationale
    ) values (
      v_plan_id,
      v_item->>'sector_id',
      (v_item->>'allocated_capacity_mw')::numeric,
      nullif(v_item->>'previous_allocation_mw', '')::numeric,
      coalesce(
        nullif(v_item->>'recommended_allocation_mw', '')::numeric,
        (v_item->>'allocated_capacity_mw')::numeric
      ),
      nullif(v_item->>'delta_mw', '')::numeric,
      v_item->>'rationale'
    );
  end loop;

  insert into public.telemetry_snapshots (
    available_capacity_mw, allocated_capacity_mw, sector_demand_mw
  ) values (
    45,
    v_total,
    coalesce(p_plan->'rationale'->'sector_demand_mw', '{}'::jsonb)
  );

  insert into public.audit_logs (
    actor, action, entity_type, entity_id, details,
    event_type, description, metadata
  ) values (
    p_actor,
    'allocation_plan.recommended',
    'allocation_plan',
    v_plan_id::text,
    jsonb_build_object('total_capacity_mw', v_total),
    'allocation_plan.recommended',
    'A simulation allocation recommendation was generated.',
    jsonb_build_object('total_capacity_mw', v_total)
  );

  return v_plan_id;
end;
$$;

create or replace function public.review_allocation_plan(
  p_plan_id uuid,
  p_decision text,
  p_reviewer text,
  p_notes text,
  p_items jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.allocation_plans%rowtype;
  v_item jsonb;
  v_total numeric(10, 3) := 0;
  v_review_decision text;
  v_plan_status text;
  v_has_modified_items boolean := false;
  v_count integer;
begin
  if p_decision not in ('approve', 'modify', 'reject') then
    raise exception 'Decision must be approve, modify, or reject.';
  end if;

  select * into v_plan
    from public.allocation_plans
    where id = p_plan_id
    for update;

  if not found or v_plan.status <> 'recommended' then
    raise exception 'Plan is no longer pending authority review.';
  end if;

  if p_decision = 'modify' then
    if jsonb_typeof(p_items) is distinct from 'array'
      or jsonb_array_length(p_items) <>
        (select count(*) from public.infrastructure_sectors) then
      raise exception 'Modified plans must include every infrastructure sector.';
    end if;

    select count(*), coalesce(sum((item->>'allocated_capacity_mw')::numeric), 0)
      into v_count, v_total
      from jsonb_array_elements(p_items) as item;

    if v_count <> (select count(*) from public.infrastructure_sectors)
      or (select count(distinct item->>'sector_id')
          from jsonb_array_elements(p_items) as item) <>
          (select count(*) from public.infrastructure_sectors)
      or exists (
        select 1
          from jsonb_array_elements(p_items) as item
          left join public.infrastructure_sectors sector
            on sector.id = item->>'sector_id'
          where sector.id is null
             or jsonb_typeof(item->'allocated_capacity_mw') <> 'number'
             or (item->>'allocated_capacity_mw')::numeric
                  < sector.minimum_safe_capacity_mw
             or (item->>'allocated_capacity_mw')::numeric
                  > sector.maximum_capacity_mw
      ) then
      raise exception 'Modified allocations must include each sector once and respect safety floors.';
    end if;

    if v_total > 45 then
      raise exception 'Total allocation cannot exceed 45 MW.';
    end if;

    delete from public.allocation_plan_items
      where allocation_plan_id = p_plan_id;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
      insert into public.allocation_plan_items (
        allocation_plan_id, sector_id, allocated_capacity_mw,
        previous_allocation_mw, recommended_allocation_mw, delta_mw, rationale
      ) values (
        p_plan_id,
        v_item->>'sector_id',
        (v_item->>'allocated_capacity_mw')::numeric,
        nullif(v_item->>'previous_allocation_mw', '')::numeric,
        coalesce(
          nullif(v_item->>'recommended_allocation_mw', '')::numeric,
          (v_item->>'allocated_capacity_mw')::numeric
        ),
        nullif(v_item->>'delta_mw', '')::numeric,
        v_item->>'rationale'
      );
    end loop;
    v_review_decision := 'modified';
    v_has_modified_items := true;
  elsif p_decision = 'approve' then
    v_review_decision := 'approved';
  else
    v_review_decision := 'rejected';
  end if;

  if p_decision <> 'reject' then
    update public.allocation_plans
      set status = 'superseded', updated_at = now()
      where status = 'approved';
    v_plan_status := 'approved';
  else
    v_plan_status := 'rejected';
  end if;

  update public.allocation_plans
    set status = v_plan_status, updated_at = now()
    where id = p_plan_id;

  insert into public.authority_reviews (
    allocation_plan_id, decision, reviewer, notes,
    authority_name, authority_role, comments, decided_at
  ) values (
    p_plan_id, v_review_decision, p_reviewer, coalesce(p_notes, ''),
    p_reviewer, 'Emergency Authority', coalesce(p_notes, ''), now()
  );

  insert into public.audit_logs (
    actor, action, entity_type, entity_id, details,
    event_type, description, metadata
  ) values (
    p_reviewer,
    case when p_decision = 'reject'
      then 'allocation_plan.rejected'
      when v_has_modified_items
      then 'allocation_plan.modified_and_approved'
      else 'allocation_plan.approved'
    end,
    'allocation_plan',
    p_plan_id::text,
    jsonb_build_object(
      'decision', v_review_decision,
      'total_capacity_mw', (
        select total_capacity_mw
          from public.allocation_plans
          where id = p_plan_id
      )
    ),
    'allocation_plan.' || v_review_decision,
    'Authority recorded a decision on the simulation allocation.',
    jsonb_build_object('decision', v_review_decision)
  );

  if p_decision <> 'reject' then
    insert into public.telemetry_snapshots (
      available_capacity_mw,
      allocated_capacity_mw,
      sector_demand_mw
    ) values (
      45,
      (
        select total_capacity_mw
          from public.allocation_plans
          where id = p_plan_id
      ),
      coalesce(v_plan.rationale->'sector_demand_mw', '{}'::jsonb)
    );
  end if;

  return p_plan_id;
end;
$$;

create or replace function public.update_incident_status(
  p_incident_id uuid,
  p_status text,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_incident public.incidents%rowtype;
  v_plan_id uuid;
begin
  if p_status not in ('contained', 'resolved') then
    raise exception 'Incident status must be contained or resolved.';
  end if;

  select * into v_incident
    from public.incidents
    where id = p_incident_id
    for update;

  if not found then
    raise exception 'Incident not found.';
  end if;
  if v_incident.status <> 'active' then
    raise exception 'Only active incidents can be contained or resolved.';
  end if;

  update public.incidents
    set status = p_status, updated_at = now()
    where id = p_incident_id;

  v_plan_id := public.write_allocation_plan(p_plan, 'crisisgrid-simulation');

  insert into public.audit_logs (
    actor, action, entity_type, entity_id, details,
    event_type, description, metadata
  ) values (
    'crisisgrid-simulation',
    'incident.' || p_status,
    'incident',
    p_incident_id::text,
    jsonb_build_object('allocation_plan_id', v_plan_id),
    'incident.' || p_status,
    'Incident status changed and a new simulation recommendation was generated.',
    jsonb_build_object('allocation_plan_id', v_plan_id)
  );

  return jsonb_build_object(
    'incident_id', p_incident_id,
    'allocation_plan_id', v_plan_id,
    'status', p_status
  );
end;
$$;

revoke all on function public.update_incident_status(uuid, text, jsonb) from public;
grant execute on function public.create_allocation_plan(jsonb, text) to service_role;
grant execute on function public.submit_emergency_report(jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.review_allocation_plan(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.update_incident_status(uuid, text, jsonb) to service_role;
