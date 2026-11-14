begin;

alter table public.incidents
  add column if not exists is_escalated boolean not null default false,
  add column if not exists automated_triage boolean not null default true,
  add column if not exists dispatch_details text not null default 'No response units assigned.',
  add column if not exists evacuation_radius_m integer not null default 0
    check (evacuation_radius_m between 0 and 100000),
  add column if not exists residents_alerted integer not null default 0
    check (residents_alerted between 0 and 10000000),
  add column if not exists perimeter_details text not null default 'No evacuation perimeter issued.';

update public.incidents
set is_escalated = true,
    automated_triage = true,
    dispatch_details = '8 Fire Engines · 3 HAZMAT · 4 ALS',
    evacuation_radius_m = 450,
    residents_alerted = 1420,
    perimeter_details = '450 m perimeter around Indiranagar Industrial Complex; residents alerted for hazardous-material response.'
where incident_code = 'INC-8092';

alter table public.allocation_plans
  drop constraint if exists allocation_plans_status_check;
alter table public.allocation_plans
  add constraint allocation_plans_status_check
  check (status in ('recommended', 'pending_review', 'approved', 'rejected', 'superseded'));

create index if not exists allocation_plans_pending_review_created_at_idx
  on public.allocation_plans (created_at desc)
  where status = 'pending_review';

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
    where status in ('recommended', 'pending_review');

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
    coalesce(nullif(p_plan->>'total_available_capacity_mw', '')::numeric, 45),
    coalesce(p_plan->'rationale', '{}'::jsonb),
    p_actor
  );

  for v_item in select value from jsonb_array_elements(p_plan->'items')
  loop
    insert into public.allocation_plan_items (
      allocation_plan_id, sector_id, allocated_capacity_mw,
      previous_allocation_mw, recommended_allocation_mw, delta_mw,
      rationale, safety_status
    ) select
      v_plan_id,
      v_item->>'sector_id',
      (v_item->>'allocated_capacity_mw')::numeric,
      coalesce(nullif(v_item->>'previous_allocation_mw', '')::numeric, 0),
      coalesce(
        nullif(v_item->>'recommended_allocation_mw', '')::numeric,
        (v_item->>'allocated_capacity_mw')::numeric
      ),
      coalesce(
        nullif(v_item->>'delta_mw', '')::numeric,
        (v_item->>'allocated_capacity_mw')::numeric
          - coalesce(nullif(v_item->>'previous_allocation_mw', '')::numeric, 0)
      ),
      coalesce(v_item->>'rationale', 'Simulation allocation item.'),
      case
        when (v_item->>'allocated_capacity_mw')::numeric >= sector.minimum_safe_capacity_mw
          then 'safe'
        else 'below_minimum'
      end
    from public.infrastructure_sectors sector
    where sector.id = v_item->>'sector_id';
  end loop;

  insert into public.telemetry_snapshots (
    available_capacity_mw, allocated_capacity_mw, sector_demand_mw
  ) values (
    coalesce(nullif(p_plan->>'total_available_capacity_mw', '')::numeric, 45),
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

create or replace function public.submit_allocation_plan_for_review(
  p_plan jsonb,
  p_actor text,
  p_manual_override jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
begin
  v_plan_id := public.create_allocation_plan(p_plan, p_actor);

  update public.allocation_plans
    set status = 'pending_review',
        rationale = case
          when p_manual_override is null then rationale
          else rationale || jsonb_build_object('manual_override', p_manual_override)
        end,
        updated_at = now()
    where id = v_plan_id;

  insert into public.audit_logs (
    actor, action, entity_type, entity_id, details,
    event_type, description, metadata
  ) values (
    p_actor,
    case when p_manual_override is null
      then 'allocation_plan.submitted_for_review'
      else 'allocation_plan.manual_override_submitted'
    end,
    'allocation_plan',
    v_plan_id::text,
    jsonb_build_object(
      'incident_id', p_plan->>'incident_id',
      'manual_override', p_manual_override,
      'total_capacity_mw', p_plan->'total_capacity_mw'
    ),
    case when p_manual_override is null
      then 'allocation_plan.submitted_for_review'
      else 'allocation_plan.manual_override_submitted'
    end,
    case when p_manual_override is null
      then 'Incident allocation was submitted for authority review.'
      else 'Authorized demo operator submitted a manual allocation override for authority review.'
    end,
    jsonb_build_object('simulation_only', true)
  );

  return v_plan_id;
end;
$$;

create or replace function public.review_allocation_plan_from_queue(
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
begin
  select * into v_plan
    from public.allocation_plans
    where id = p_plan_id
    for update;

  if not found or v_plan.status not in ('recommended', 'pending_review') then
    raise exception 'Plan is no longer pending authority review.';
  end if;

  if v_plan.status = 'pending_review' then
    update public.allocation_plans
      set status = 'recommended', updated_at = now()
      where id = p_plan_id;
  end if;

  return public.review_allocation_plan(
    p_plan_id,
    p_decision,
    p_reviewer,
    p_notes,
    p_items
  );
end;
$$;

revoke all on function public.submit_allocation_plan_for_review(jsonb, text, jsonb) from public;
revoke all on function public.review_allocation_plan_from_queue(uuid, text, text, text, jsonb) from public;
grant execute on function public.submit_allocation_plan_for_review(jsonb, text, jsonb) to service_role;
grant execute on function public.review_allocation_plan_from_queue(uuid, text, text, text, jsonb) to service_role;

commit;
