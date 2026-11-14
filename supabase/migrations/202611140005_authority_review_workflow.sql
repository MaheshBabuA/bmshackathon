begin;

-- Extend allocation_plans with dispatch and dual-signature columns
alter table public.allocation_plans
  add column if not exists dispatch_status text not null default 'pending'
    check (dispatch_status in ('pending', 'active', 'standby', 'cancelled')),
  add column if not exists signatures jsonb not null default '[]'::jsonb
    check (jsonb_typeof(signatures) = 'array'),
  add column if not exists required_signatures integer not null default 2
    check (required_signatures between 1 and 5);

-- Ensure command_center_state has dispatch_status
alter table public.command_center_state
  add column if not exists dispatch_status text not null default 'standby'
    check (dispatch_status in ('standby', 'active', 'contained')),
  add column if not exists last_dispatched_at timestamptz;

-- Ensure authority_reviews has authority_role and signature_hash
alter table public.authority_reviews
  add column if not exists signature_hash text,
  add column if not exists user_role text not null default 'AUTHORITY'
    check (user_role in ('CITIZEN', 'OPERATOR', 'AUTHORITY'));

-- Seed the initial dual-signature state on the seeded recommended plan INC-8092
-- Gov. Operations Lead S. Mukherjee is Signature 1 (1 of 2 signed)
update public.allocation_plans
set status = 'pending_review',
    dispatch_status = 'pending',
    required_signatures = 2,
    signatures = jsonb_build_array(
      jsonb_build_object(
        'role', 'Gov. Operations Lead',
        'signer_name', 'S. Mukherjee',
        'signature_hash', '0x9F4C7A1B8E2D9914F6B2C8E4A01234B2',
        'signed_at', '2026-03-30T14:38:22+05:30'
      )
    )
where id = '00000000-0000-4000-8000-000000000202';

-- Comprehensive stored procedure for dual-key authority review and dispatch
create or replace function public.authorize_and_dispatch_plan(
  p_plan_id uuid,
  p_decision text,
  p_reviewer text,
  p_user_role text default 'AUTHORITY',
  p_signer_role text default 'Disaster Coordinator',
  p_signature_hash text default null,
  p_notes text default '',
  p_items jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.allocation_plans%rowtype;
  v_current_signatures jsonb;
  v_new_signatures jsonb;
  v_sig_obj jsonb;
  v_sig_hash text;
  v_is_already_signed boolean := false;
  v_sig_count integer;
  v_is_approved boolean := false;
  v_item jsonb;
  v_total numeric(10, 3) := 0;
  v_count integer;
begin
  -- 1. RBAC Check: Only AUTHORITY role can approve or reject
  if p_user_role is null or p_user_role <> 'AUTHORITY' then
    insert into public.audit_logs (
      actor, action, entity_type, entity_id, details,
      event_type, description, metadata
    ) values (
      coalesce(p_reviewer, 'Unknown User'),
      'allocation_plan.authorization_denied',
      'allocation_plan',
      p_plan_id::text,
      jsonb_build_object(
        'attempted_role', p_user_role,
        'decision', p_decision,
        'reason', 'Only AUTHORITY users can approve or reject allocation plans.'
      ),
      'security.rbac_denial',
      'Unauthorized review attempt was rejected.',
      jsonb_build_object('user_role', p_user_role)
    );
    raise exception 'Authorization Denied: Only AUTHORITY users can approve or reject plans.';
  end if;

  -- 2. Fetch the plan
  select * into v_plan
    from public.allocation_plans
    where id = p_plan_id
    for update;

  if not found or v_plan.status not in ('recommended', 'pending_review') then
    raise exception 'Plan is no longer pending authority review.';
  end if;

  -- 3. Handle Rejection
  if p_decision = 'reject' then
    update public.allocation_plans
      set status = 'rejected',
          rejected_at = now(),
          updated_at = now()
      where id = p_plan_id;

    insert into public.authority_reviews (
      allocation_plan_id, decision, reviewer, notes,
      authority_name, authority_role, user_role, comments, decided_at
    ) values (
      p_plan_id, 'rejected', p_reviewer, coalesce(p_notes, ''),
      p_reviewer, coalesce(p_signer_role, 'Emergency Authority'), 'AUTHORITY',
      coalesce(p_notes, ''), now()
    );

    insert into public.audit_logs (
      actor, action, entity_type, entity_id, details,
      event_type, description, metadata
    ) values (
      p_reviewer,
      'allocation_plan.rejected',
      'allocation_plan',
      p_plan_id::text,
      jsonb_build_object('decision', 'rejected', 'notes', p_notes),
      'allocation_plan.rejected',
      'Authority rejected recommendation and maintained baseline allocation.',
      jsonb_build_object('status', 'rejected')
    );

    return jsonb_build_object(
      'plan_id', p_plan_id,
      'status', 'rejected',
      'is_approved', false,
      'dispatch_status', 'standby'
    );
  end if;

  -- 4. If modified items are passed, validate and update items
  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    select count(*), coalesce(sum((item->>'allocated_capacity_mw')::numeric), 0)
      into v_count, v_total
      from jsonb_array_elements(p_items) as item;

    if v_count <> (select count(*) from public.infrastructure_sectors)
      or (select count(distinct item->>'sector_id') from jsonb_array_elements(p_items) as item) <> v_count
      or exists (
        select 1
          from jsonb_array_elements(p_items) as item
          left join public.infrastructure_sectors sector on sector.id = item->>'sector_id'
          where sector.id is null
             or jsonb_typeof(item->'allocated_capacity_mw') <> 'number'
             or (item->>'allocated_capacity_mw')::numeric < 0
             or (item->>'allocated_capacity_mw')::numeric < sector.minimum_safe_capacity_mw
             or (item->>'allocated_capacity_mw')::numeric > sector.maximum_capacity_mw
      ) then
      raise exception 'Allocations must respect safety floors and non-negative constraints for all sectors.';
    end if;

    if v_total > 45 then
      raise exception 'Total allocation cannot exceed 45 MW available capacity.';
    end if;

    delete from public.allocation_plan_items where allocation_plan_id = p_plan_id;

    for v_item in select value from jsonb_array_elements(p_items)
    loop
      insert into public.allocation_plan_items (
        allocation_plan_id, sector_id, allocated_capacity_mw,
        previous_allocation_mw, recommended_allocation_mw, delta_mw, rationale, safety_status
      ) select
        p_plan_id,
        v_item->>'sector_id',
        (v_item->>'allocated_capacity_mw')::numeric,
        coalesce(nullif(v_item->>'previous_allocation_mw', '')::numeric, sector.current_allocation_mw),
        (v_item->>'allocated_capacity_mw')::numeric,
        (v_item->>'allocated_capacity_mw')::numeric - coalesce(nullif(v_item->>'previous_allocation_mw', '')::numeric, sector.current_allocation_mw),
        coalesce(v_item->>'rationale', 'Authority adjusted allocation.'),
        'safe'
      from public.infrastructure_sectors sector
      where sector.id = v_item->>'sector_id';
    end loop;

    update public.allocation_plans
      set total_capacity_mw = v_total, updated_at = now()
      where id = p_plan_id;
  end if;

  -- 5. Validation of current items before allowing approval
  select coalesce(sum(allocated_capacity_mw), 0) into v_total
    from public.allocation_plan_items
    where allocation_plan_id = p_plan_id;

  if v_total > 45 then
    raise exception 'Total allocation cannot exceed 45 MW available capacity.';
  end if;

  if exists (
    select 1
      from public.allocation_plan_items item
      join public.infrastructure_sectors sector on sector.id = item.sector_id
      where item.allocation_plan_id = p_plan_id
        and (item.allocated_capacity_mw < 0 or item.allocated_capacity_mw < sector.minimum_safe_capacity_mw)
  ) then
    raise exception 'Critical safety floors must be respected for all sectors; negative allocations are prohibited.';
  end if;

  -- 6. Process dual-signature quorum
  v_current_signatures := coalesce(v_plan.signatures, '[]'::jsonb);
  v_sig_hash := coalesce(p_signature_hash, '0x' || upper(encode(gen_random_bytes(16), 'hex')));

  -- Check if already signed by this role
  for v_sig_obj in select value from jsonb_array_elements(v_current_signatures)
  loop
    if v_sig_obj->>'role' = p_signer_role then
      v_is_already_signed := true;
    end if;
  end loop;

  if not v_is_already_signed then
    v_new_signatures := v_current_signatures || jsonb_build_array(
      jsonb_build_object(
        'role', p_signer_role,
        'signer_name', p_reviewer,
        'signature_hash', v_sig_hash,
        'signed_at', now()
      )
    );
  else
    v_new_signatures := v_current_signatures;
  end if;

  v_sig_count := jsonb_array_length(v_new_signatures);

  -- 7. Check if Quorum is met (>= required_signatures)
  if v_sig_count >= v_plan.required_signatures then
    v_is_approved := true;

    -- Supersede any previously approved plan
    update public.allocation_plans
      set status = 'superseded', updated_at = now()
      where status = 'approved' and id <> p_plan_id;

    -- Approve current plan
    update public.allocation_plans
      set status = 'approved',
          approved_at = now(),
          dispatch_status = 'active',
          signatures = v_new_signatures,
          updated_at = now()
      where id = p_plan_id;

    -- Update current sector allocations
    update public.infrastructure_sectors sector
      set current_allocation_mw = item.allocated_capacity_mw,
          operational_status = case
            when item.sector_id = 'water_infrastructure' then 'surge'
            when item.sector_id = 'emergency_operations' then 'elevated'
            else 'operational'
          end,
          updated_at = now()
      from public.allocation_plan_items item
      where item.allocation_plan_id = p_plan_id
        and item.sector_id = sector.id;

    -- Update Command Center state
    update public.command_center_state
      set dispatch_status = 'active',
          last_dispatched_at = now(),
          updated_at = now()
      where id = 'bengaluru';

    -- Insert Telemetry Snapshot
    insert into public.telemetry_snapshots (
      available_capacity_mw, allocated_capacity_mw, sector_demand_mw
    ) values (
      45,
      v_total,
      coalesce(v_plan.rationale->'sector_demand_mw', '{}'::jsonb)
    );

    -- Insert Review Record
    insert into public.authority_reviews (
      allocation_plan_id, decision, reviewer, notes,
      authority_name, authority_role, user_role, signature_hash, comments, decided_at
    ) values (
      p_plan_id, 'approved', p_reviewer, coalesce(p_notes, ''),
      p_reviewer, p_signer_role, 'AUTHORITY', v_sig_hash, coalesce(p_notes, ''), now()
    );

    -- Immutable Audit Logs
    insert into public.audit_logs (
      actor, action, entity_type, entity_id, details,
      event_type, description, metadata
    ) values (
      p_reviewer || ' (' || p_signer_role || ')',
      'allocation_plan.approved',
      'allocation_plan',
      p_plan_id::text,
      jsonb_build_object(
        'decision', 'approved',
        'quorum', v_sig_count || ' of ' || v_plan.required_signatures,
        'total_capacity_mw', v_total,
        'signatures', v_new_signatures
      ),
      'allocation_plan.approved',
      'Dual-key quorum complete. Capacity plan approved by ' || p_reviewer || '.',
      jsonb_build_object('approved_at', now(), 'dispatch_status', 'active')
    );

    insert into public.audit_logs (
      actor, action, entity_type, entity_id, details,
      event_type, description, metadata
    ) values (
      p_reviewer,
      'dispatch.activated',
      'allocation_plan',
      p_plan_id::text,
      jsonb_build_object('total_capacity_mw', v_total, 'dispatch_status', 'active'),
      'dispatch.activated',
      'Capacity plan dispatched to municipal grid controllers and Command Center.',
      jsonb_build_object('simulation_only', true)
    );

  else
    -- Quorum not yet complete (e.g. 1 of 2 signed)
    update public.allocation_plans
      set signatures = v_new_signatures,
          status = 'pending_review',
          updated_at = now()
      where id = p_plan_id;

    insert into public.authority_reviews (
      allocation_plan_id, decision, reviewer, notes,
      authority_name, authority_role, user_role, signature_hash, comments, decided_at
    ) values (
      p_plan_id, 'signed', p_reviewer, coalesce(p_notes, ''),
      p_reviewer, p_signer_role, 'AUTHORITY', v_sig_hash, coalesce(p_notes, ''), now()
    );

    insert into public.audit_logs (
      actor, action, entity_type, entity_id, details,
      event_type, description, metadata
    ) values (
      p_reviewer || ' (' || p_signer_role || ')',
      'allocation_plan.signed',
      'allocation_plan',
      p_plan_id::text,
      jsonb_build_object(
        'decision', 'signed',
        'quorum', v_sig_count || ' of ' || v_plan.required_signatures,
        'signatures', v_new_signatures
      ),
      'allocation_plan.signed',
      'Authority signature recorded for ' || p_signer_role || '. Awaiting quorum completion.',
      jsonb_build_object('pending_signatures', v_plan.required_signatures - v_sig_count)
    );
  end if;

  return jsonb_build_object(
    'plan_id', p_plan_id,
    'status', case when v_is_approved then 'approved' else 'pending_review' end,
    'is_approved', v_is_approved,
    'signatures', v_new_signatures,
    'signatures_count', v_sig_count,
    'required_signatures', v_plan.required_signatures,
    'dispatch_status', case when v_is_approved then 'active' else 'pending' end
  );
end;
$$;

revoke all on function public.authorize_and_dispatch_plan(uuid, text, text, text, text, text, text, jsonb) from public;
grant execute on function public.authorize_and_dispatch_plan(uuid, text, text, text, text, text, text, jsonb) to service_role;

commit;
