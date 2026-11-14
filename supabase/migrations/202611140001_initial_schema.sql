create table if not exists public.infrastructure_sectors (
  id text primary key,
  name text not null unique,
  baseline_demand_mw numeric(8, 3) not null check (baseline_demand_mw >= 0),
  minimum_safe_capacity_mw numeric(8, 3) not null check (minimum_safe_capacity_mw >= 0),
  priority_weight numeric(5, 3) not null check (priority_weight > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minimum_safe_capacity_mw <= baseline_demand_mw)
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,
  incident_type text not null check (
    incident_type in (
      'medical',
      'fire',
      'flood',
      'infrastructure',
      'telecommunications',
      'other'
    )
  ),
  severity text not null check (severity in ('critical', 'urgent', 'stable')),
  status text not null default 'active' check (
    status in ('active', 'contained', 'resolved')
  ),
  location text not null,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

create table if not exists public.incident_impacts (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  sector_id text not null references public.infrastructure_sectors(id),
  demand_delta_mw numeric(8, 3) not null check (demand_delta_mw >= 0),
  impact_score numeric(5, 3) not null check (impact_score between 0 and 1),
  rationale text not null,
  created_at timestamptz not null default now(),
  unique (incident_id, sector_id)
);

create table if not exists public.allocation_plans (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null check (
    status in ('recommended', 'approved', 'rejected', 'superseded')
  ),
  total_capacity_mw numeric(8, 3) not null default 0
    check (total_capacity_mw between 0 and 45),
  rationale jsonb not null default '{}'::jsonb
    check (jsonb_typeof(rationale) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.allocation_plan_items (
  id uuid primary key default gen_random_uuid(),
  allocation_plan_id uuid not null
    references public.allocation_plans(id) on delete cascade,
  sector_id text not null references public.infrastructure_sectors(id),
  allocated_capacity_mw numeric(8, 3) not null
    check (allocated_capacity_mw between 0 and 45),
  created_at timestamptz not null default now(),
  unique (allocation_plan_id, sector_id)
);

create table if not exists public.authority_reviews (
  id uuid primary key default gen_random_uuid(),
  allocation_plan_id uuid not null
    references public.allocation_plans(id) on delete restrict,
  decision text not null check (decision in ('approved', 'modified', 'rejected')),
  reviewer text not null,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.emergency_reports (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  reporter_alias text not null default 'Anonymous',
  description text not null,
  location text not null,
  severity text not null check (severity in ('critical', 'urgent', 'stable')),
  is_anonymous boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.telemetry_snapshots (
  id uuid primary key default gen_random_uuid(),
  available_capacity_mw numeric(8, 3) not null
    check (available_capacity_mw between 0 and 45),
  allocated_capacity_mw numeric(8, 3) not null
    check (allocated_capacity_mw between 0 and 45),
  sector_demand_mw jsonb not null default '{}'::jsonb
    check (jsonb_typeof(sector_demand_mw) = 'object'),
  captured_at timestamptz not null default now()
);

create index if not exists incidents_status_created_at_idx
  on public.incidents (status, created_at desc);
create index if not exists incident_impacts_incident_id_idx
  on public.incident_impacts (incident_id);
create index if not exists allocation_plans_status_created_at_idx
  on public.allocation_plans (status, created_at desc);
create index if not exists audit_logs_entity_created_at_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists telemetry_snapshots_captured_at_idx
  on public.telemetry_snapshots (captured_at desc);

create or replace function public.enforce_allocation_plan_item_limits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_minimum numeric(8, 3);
  v_total numeric(10, 3);
  v_plan_id uuid;
begin
  if tg_op = 'DELETE' then
    v_plan_id := old.allocation_plan_id;
  else
    v_plan_id := new.allocation_plan_id;

    select minimum_safe_capacity_mw
      into v_minimum
      from public.infrastructure_sectors
      where id = new.sector_id;

    if not found then
      raise exception 'Unknown infrastructure sector: %', new.sector_id;
    end if;

    if new.allocated_capacity_mw < v_minimum then
      raise exception
        'Allocation for % MW is below its % MW minimum safe capacity.',
        new.sector_id, v_minimum;
    end if;

    select coalesce(sum(allocated_capacity_mw), 0)
      into v_total
      from public.allocation_plan_items
      where allocation_plan_id = new.allocation_plan_id
        and id is distinct from new.id;

    if v_total + new.allocated_capacity_mw > 45 then
      raise exception 'Total allocation cannot exceed 45 MW.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    select coalesce(sum(allocated_capacity_mw), 0)
      into v_total
      from public.allocation_plan_items
      where allocation_plan_id = v_plan_id
        and id is distinct from old.id;
  else
    select coalesce(sum(allocated_capacity_mw), 0)
      into v_total
      from public.allocation_plan_items
      where allocation_plan_id = v_plan_id
        and id is distinct from new.id;
    v_total := v_total + new.allocated_capacity_mw;
  end if;

  update public.allocation_plans
    set total_capacity_mw = v_total, updated_at = now()
    where id = v_plan_id;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists allocation_plan_items_enforce_limits
  on public.allocation_plan_items;
create trigger allocation_plan_items_enforce_limits
  after insert or update or delete on public.allocation_plan_items
  for each row execute function public.enforce_allocation_plan_item_limits();

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
           or (item->>'allocated_capacity_mw')::numeric > 45
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
    id, title, status, total_capacity_mw, rationale
  ) values (
    v_plan_id,
    coalesce(nullif(p_plan->>'title', ''), 'Recommended emergency allocation'),
    'recommended',
    v_total,
    coalesce(p_plan->'rationale', '{}'::jsonb)
  );

  for v_item in select value from jsonb_array_elements(p_plan->'items')
  loop
    insert into public.allocation_plan_items (
      allocation_plan_id, sector_id, allocated_capacity_mw
    ) values (
      v_plan_id,
      v_item->>'sector_id',
      (v_item->>'allocated_capacity_mw')::numeric
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
    actor, action, entity_type, entity_id, details
  ) values (
    p_actor,
    'allocation_plan.recommended',
    'allocation_plan',
    v_plan_id::text,
    jsonb_build_object('total_capacity_mw', v_total)
  );

  return v_plan_id;
end;
$$;

create or replace function public.create_allocation_plan(
  p_plan jsonb,
  p_actor text
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.write_allocation_plan(p_plan, p_actor);
$$;

create or replace function public.submit_emergency_report(
  p_incident jsonb,
  p_report jsonb,
  p_impacts jsonb,
  p_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_incident_id uuid;
  v_report_id uuid;
  v_plan_id uuid;
  v_impact jsonb;
begin
  if jsonb_typeof(p_impacts) is distinct from 'array'
    or jsonb_array_length(p_impacts) <>
      (select count(*) from public.infrastructure_sectors) then
    raise exception 'Incident impacts must include every infrastructure sector.';
  end if;

  v_incident_id := coalesce(
    nullif(p_incident->>'id', '')::uuid,
    gen_random_uuid()
  );
  v_report_id := coalesce(
    nullif(p_report->>'id', '')::uuid,
    gen_random_uuid()
  );

  insert into public.incidents (
    id, title, description, incident_type, severity, status, location,
    latitude, longitude
  ) values (
    v_incident_id,
    p_incident->>'title',
    p_incident->>'description',
    p_incident->>'incident_type',
    p_incident->>'severity',
    'active',
    p_incident->>'location',
    nullif(p_incident->>'latitude', '')::double precision,
    nullif(p_incident->>'longitude', '')::double precision
  );

  insert into public.emergency_reports (
    id, incident_id, reporter_alias, description, location, severity,
    is_anonymous
  ) values (
    v_report_id,
    v_incident_id,
    coalesce(nullif(p_report->>'reporter_alias', ''), 'Anonymous'),
    p_report->>'description',
    p_report->>'location',
    p_report->>'severity',
    coalesce((p_report->>'is_anonymous')::boolean, true)
  );

  for v_impact in select value from jsonb_array_elements(p_impacts)
  loop
    insert into public.incident_impacts (
      incident_id, sector_id, demand_delta_mw, impact_score, rationale
    ) values (
      v_incident_id,
      v_impact->>'sector_id',
      (v_impact->>'demand_delta_mw')::numeric,
      (v_impact->>'impact_score')::numeric,
      v_impact->>'rationale'
    );
  end loop;

  v_plan_id := public.write_allocation_plan(p_plan, 'crisisgrid-simulation');

  insert into public.audit_logs (
    actor, action, entity_type, entity_id, details
  ) values (
    'crisisgrid-simulation',
    'emergency_report.submitted',
    'incident',
    v_incident_id::text,
    jsonb_build_object(
      'report_id', v_report_id,
      'allocation_plan_id', v_plan_id
    )
  );

  return jsonb_build_object(
    'incident_id', v_incident_id,
    'report_id', v_report_id,
    'allocation_plan_id', v_plan_id
  );
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
             or (item->>'allocated_capacity_mw')::numeric > 45
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
        allocation_plan_id, sector_id, allocated_capacity_mw
      ) values (
        p_plan_id,
        v_item->>'sector_id',
        (v_item->>'allocated_capacity_mw')::numeric
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
    allocation_plan_id, decision, reviewer, notes
  ) values (
    p_plan_id, v_review_decision, p_reviewer, coalesce(p_notes, '')
  );

  insert into public.audit_logs (
    actor, action, entity_type, entity_id, details
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
    )
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
    actor, action, entity_type, entity_id, details
  ) values (
    'crisisgrid-simulation',
    'incident.' || p_status,
    'incident',
    p_incident_id::text,
    jsonb_build_object('allocation_plan_id', v_plan_id)
  );

  return jsonb_build_object(
    'incident_id', p_incident_id,
    'allocation_plan_id', v_plan_id,
    'status', p_status
  );
end;
$$;

alter table public.infrastructure_sectors enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_impacts enable row level security;
alter table public.allocation_plans enable row level security;
alter table public.allocation_plan_items enable row level security;
alter table public.authority_reviews enable row level security;
alter table public.emergency_reports enable row level security;
alter table public.audit_logs enable row level security;
alter table public.telemetry_snapshots enable row level security;

revoke all on function public.write_allocation_plan(jsonb, text) from public;
revoke all on function public.create_allocation_plan(jsonb, text) from public;
revoke all on function public.submit_emergency_report(jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.review_allocation_plan(uuid, text, text, text, jsonb) from public;
revoke all on function public.update_incident_status(uuid, text, jsonb) from public;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on function public.create_allocation_plan(jsonb, text) to service_role;
grant execute on function public.submit_emergency_report(jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.review_allocation_plan(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.update_incident_status(uuid, text, jsonb) to service_role;
